// Refresh an existing, byte-verified synthetic file without creating duplicate entities.
// All parts receive max() in one batch, so their absolute expiry remains identical.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,ExpirationTime,MAX_LIFETIME} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {and,eq} from '@arkiv-network/sdk/query';
import {key,str} from '@arkiv-network/sdk/schema';
import {custom,http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {downloadFile,VERSION} from 'arkiv-chunking';

const journalAt=process.argv.indexOf('--journal');
assert.ok(journalAt>=0&&process.argv[journalAt+1],'Pass --journal <new-file> for the persistent operation receipt.');
const journal=path.resolve(process.argv[journalAt+1]);
assert.ok(!fs.existsSync(journal),'Existing journal: reconcile it before another invocation; never resend blindly.');
const descriptorAt=process.argv.indexOf('--descriptor');
assert.ok(descriptorAt<0||process.argv[descriptorAt+1],'Pass a file after --descriptor.');
const descriptorPath=descriptorAt<0?new URL('../sample/public/sample.json',import.meta.url):path.resolve(process.argv[descriptorAt+1]);
const descriptor=JSON.parse(fs.readFileSync(descriptorPath,'utf8'));
assert.equal(JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json','utf8')).version,'1.0.1');
const account=privateKeyToAccount(process.env.TEST_CHUNKING_PRIVATE_KEY);
assert.equal(account.address.toLowerCase(),process.env.TEST_CHUNKING_ADDRESS.toLowerCase());
assert.notEqual(account.address.toLowerCase(),'0x2f6e6adb6bc8f79799cb479fb5cb237fa3caa690');
const chain=rabdi({accessKey:process.env.ARKIV_ACCESS_KEY_A});
let queries=0;
const transport=config=>{
  const base=http(undefined,{retryCount:0,timeout:30000,fetchOptions:{cache:'no-store'}})(config);
  return {...base,request:args=>{if(args.method==='arkiv_query')queries++;return base.request(args);}};
};
const reader=createPublicClient({chain,transport,cacheTime:0});
const signer=createWalletClient({chain,account,transport,cacheTime:0});
const report={package:VERSION,sdk:'1.0.1',chainId:await reader.getChainId(),account:account.address,
  manifestKey:descriptor.manifestKey,phase:'inspecting',writes:0,attempts:0,creates:0,transactions:[],queries:0,
  minimumDate:'2026-12-31',operation:'coordinated Lifetime Extension'};
assert.equal(report.chainId,7794095);
fs.mkdirSync(path.dirname(journal),{recursive:true});
fs.writeFileSync(journal,'',{flag:'wx',mode:0o600});
const save=()=>{report.queries=queries;fs.writeFileSync(journal,JSON.stringify(report,null,2)+'\n',{mode:0o600});};
save();
try {
  const original=new TextEncoder().encode(('Public Rabdi sample. Arkiv entities store indexed metadata and non-indexed binary columns.\n').repeat(20)).slice(0,1536);
  const restored=await downloadFile({publicClient:reader,manifestKey:descriptor.manifestKey,expectedSha256:descriptor.sha256});
  assert.deepEqual(restored.bytes,original);
  assert.equal(restored.filename,descriptor.filename);
  assert.equal(restored.chunkCount,descriptor.chunkCount);
  const root=await reader.getEntity(descriptor.manifestKey);
  assert.equal(root.$owner.toLowerCase(),account.address.toLowerCase());
  assert.equal(root.$creator.toLowerCase(),account.address.toLowerCase());
  const parts=await reader.select({$key:true,$owner:true,$creator:true,$expiresAt:true,$creationFlags:true})
    .where(and(eq('manifest',key(descriptor.manifestKey)),eq('type',str('arkiv-chunking/chunk/v2'))))
    .ownedBy(account.address).createdBy(account.address).limit(100).fetch();
  assert.equal(parts.entities.length,restored.chunkCount);
  const entities=[root,...parts.entities];
  assert.equal(new Set(entities.map(e=>e.$key)).size,restored.chunkCount+1);
  for(const entity of entities){
    assert.equal(entity.$owner.toLowerCase(),account.address.toLowerCase());
    assert.equal(entity.$creator.toLowerCase(),account.address.toLowerCase());
    // Legacy seeded parts may outlive their manifest; the public downloader supports them.
    assert.ok(entity.$expiresAt>=root.$expiresAt,'A chunk must not expire before the manifest.');
  }
  const head=await reader.getBlock({blockTag:'latest'});
  assert.ok(root.$expiresAt>head.number,'Expired fixtures require the create-only seed, not extension.');
  // Use the chain's actual block timing, not a fixed wall-clock estimate.
  const timing=await reader.transport.request({method:'arkiv_getBlockTiming',params:[]});
  assert.ok(Number.isSafeInteger(timing.current_block)&&Number.isSafeInteger(timing.current_block_time)&&Number.isSafeInteger(timing.duration)&&timing.duration>0);
  const minimumTimestamp=Math.floor(Date.parse('2027-01-01T00:00:00Z')/1000);
  const requiredBlock=BigInt(timing.current_block)+BigInt(Math.max(0,Math.ceil((minimumTimestamp-timing.current_block_time)/timing.duration)));
  report.before=entities.map(e=>({entityKey:e.$key,expiresAt:String(e.$expiresAt)}));
  report.requiredBlock=String(requiredBlock);
  save();
  if(entities.some(e=>e.$expiresAt<requiredBlock)){
    const extensions=entities.map(e=>({entityKey:e.$key,expiration:ExpirationTime.max()}));
    let unsignedRequest;
    const unsigned=createWalletClient({chain,account:account.address,transport:custom({request:async args=>{
      if(args.method==='eth_sendTransaction'){unsignedRequest=args.params[0];throw Error('Unsigned request captured; this client cannot sign.');}
      assert.ok(['eth_chainId','eth_blockNumber'].includes(args.method),'Unexpected unsigned request');
      return reader.transport.request(args);
    }},{retryCount:0}),cacheTime:0});
    try{await unsigned.executeBatch({extensions},{gas:1000000n,gasPrice:1n,nonce:0});}catch(error){if(!unsignedRequest)throw error;}
    assert.ok(unsignedRequest);
    const estimate=BigInt(await reader.transport.request({method:'eth_estimateGas',params:[{from:account.address,to:unsignedRequest.to,data:unsignedRequest.data},'latest']}));
    assert.ok(estimate>0n);
    const gas=estimate*2n>1000000n?estimate*2n:1000000n;
    const [gasPrice,nonce,latest,balance]=await Promise.all([reader.getGasPrice(),reader.getTransactionCount({address:account.address,blockTag:'latest'}),reader.getBlock({blockTag:'latest'}),reader.getBalance({address:account.address,blockTag:'latest'})]);
    assert.ok(gas<=latest.gasLimit/2n,'Batch exceeds half the head block gas limit.');
    assert.ok(balance>=gas*gasPrice,'Insufficient dedicated test funds.');
    report.parameters={estimate:String(estimate),gas:String(gas),gasPrice:String(gasPrice),nonce};
    report.phase='sending';report.attempts=1;save();
    let result;
    try{result=await signer.executeBatch({extensions},{gas,gasPrice,nonce});}
    catch(error){report.phase='uncertain';if(/^0x[\da-f]{64}$/i.test(error.txHash??''))report.transactions.push({hash:error.txHash});save();throw error;}
    report.transactions.push({hash:result.txHash});report.phase='submitted';report.writes=1;save();
    // No path sends again after success, an uncertain error or a disagreeing lookup.
    const [receipt,transaction]=await Promise.all([reader.getTransactionReceipt({hash:result.txHash}),reader.getTransaction({hash:result.txHash})]);
    assert.equal(receipt.status,'success');assert.equal(transaction.from.toLowerCase(),account.address.toLowerCase());
    assert.equal(transaction.gas,gas);assert.equal(transaction.gasPrice,gasPrice);assert.equal(transaction.nonce,nonce);
    Object.assign(report.transactions[0],{status:receipt.status,blockNumber:String(receipt.blockNumber),gasUsed:String(receipt.gasUsed)});save();
    assert.deepEqual(result.extendedEntities,entities.map(e=>e.$key));
    const expected=receipt.blockNumber+MAX_LIFETIME;
    const renewed=await Promise.all(entities.map(e=>reader.getEntity(e.$key)));
    for(const entity of renewed)assert.equal(entity.$expiresAt,expected);
    assert.ok(expected>=requiredBlock);
    report.after=renewed.map(e=>({entityKey:e.$key,expiresAt:String(e.$expiresAt)}));
  }else report.after=report.before;
  const verified=await downloadFile({publicClient:reader,manifestKey:descriptor.manifestKey,expectedSha256:descriptor.sha256});
  assert.deepEqual(verified.bytes,original);
  const current={...descriptor,expiresAt:String(verified.expiresAt)};
  if(descriptor.expiresAt!==current.expiresAt)fs.writeFileSync(descriptorPath,JSON.stringify(current,null,2)+'\n');
  report.phase='complete';report.byteExact=true;report.byteLength=verified.bytes.length;save();
  console.log(JSON.stringify(report,null,2));
}catch(error){report.error=error.code??error.name;save();console.error(JSON.stringify(report,null,2));process.exitCode=1;}

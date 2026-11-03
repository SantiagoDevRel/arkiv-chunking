// Explicit, create-only synthetic data loader. A second run reuses byte-verified entities.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createPublicClient,createWalletClient,MissingAccessKeyError} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {and,eq} from '@arkiv-network/sdk/query';
import {str} from '@arkiv-network/sdk/schema';
import {http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {uploadFile,downloadFile,ManifestSchema,VERSION} from 'arkiv-chunking';
import {serialRabdiWallet} from './rabdi-wallet.mjs';

const accessKey = process.env.ARKIV_ACCESS_KEY_A;
if (!accessKey) throw new MissingAccessKeyError('Rabdi; set ARKIV_ACCESS_KEY_A locally. Get a free key at https://hub.arkiv.network/access-keys');
const chain = rabdi({accessKey});
let queries = 0, writes = 0;
const transport = config => {
  const base = http(undefined,{retryCount:0,timeout:30000,fetchOptions:{cache:'no-store'}})(config);
  return {...base,request:args => {if(args.method === 'arkiv_query') queries++; return base.request(args);}};
};
const client = createPublicClient({chain,transport});
if (!process.env.TEST_CHUNKING_PRIVATE_KEY) throw Error('Configure the dedicated TEST_CHUNKING_PRIVATE_KEY locally. Never paste it into chat.');
const account = privateKeyToAccount(process.env.TEST_CHUNKING_PRIVATE_KEY);
if (process.env.TEST_CHUNKING_ADDRESS && account.address.toLowerCase() !== process.env.TEST_CHUNKING_ADDRESS.toLowerCase()) throw Error('Dedicated CHUNKING wallet address mismatch.');
const signer = serialRabdiWallet(createWalletClient({chain,transport,account}),client);
const bytes = new TextEncoder().encode(('Public Rabdi sample. Arkiv entities store indexed metadata and non-indexed binary columns.\n').repeat(20)).slice(0,1536);
const sha256 = '0x'+createHash('sha256').update(bytes).digest('hex');
const filename = 'rabdi-chunking-demo.txt';
const report = {package:VERSION,sdk:JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json','utf8')).version,node:process.version,network:'Rabdi',chainId:await client.getChainId(),owner:account.address,sha256,bytes:bytes.length,transactionPolicy:'unsigned latest estimate, max(1000000, 2*estimate), latest nonce, network gas price; one retry only after confirmed gas-exhausted revert',startedAt:new Date().toISOString()};
assert.equal(report.chainId,7794095);
const journalAt=process.argv.indexOf('--journal');
assert.ok(journalAt>=0&&process.argv[journalAt+1],'Pass --journal <new-private-file>; reconcile existing receipts before another invocation.');
const journal=path.resolve(process.argv[journalAt+1]);
fs.mkdirSync(path.dirname(journal),{recursive:true});fs.writeFileSync(journal,'',{flag:'wx',mode:0o600});
report.operationState='inspecting';report.observedTransactions=[];
const save=()=>fs.writeFileSync(journal,JSON.stringify({...report,queries,writes},null,2)+'\n',{mode:0o600});save();
async function recorded(method,args){
  report.operationState='sending';save();
  try{const result=await signer[method](...args);report.observedTransactions.push({hash:result.txHash,method});report.operationState='submitted';save();return result;}
  catch(error){report.operationState='uncertain';if(/^0x[\da-f]{64}$/i.test(error.txHash??''))report.observedTransactions.push({hash:error.txHash,method});save();throw error;}
}
const wallet={...signer,createEntity:(...args)=>recorded('createEntity',args),patchEntity:(...args)=>recorded('patchEntity',args)};
const descriptorAt=process.argv.indexOf('--descriptor');
assert.ok(descriptorAt<0||process.argv[descriptorAt+1],'Pass a file after --descriptor.');
const descriptorPath=descriptorAt<0?new URL('../sample/public/sample.json',import.meta.url):path.resolve(process.argv[descriptorAt+1]);
try {
  const existing = await client.select({$key:true,complete:true}).from(ManifestSchema,{onMismatch:'throw'})
    .where(and(eq('sha256',str(sha256)))).ownedBy(account.address).limit(100).fetch();
  let manifestKey;
  if (existing.entities.length) {
    const complete = existing.entities.find(e => e.complete.value === true);
    if (!complete) {
      console.log(JSON.stringify({...report,status:'incomplete',manifestKeys:existing.entities.map(e=>e.$key),queries,writes}));
      throw Error('An incomplete seed already exists. Inspect its confirmed transactions before authorizing a fresh upload.');
    }
    manifestKey = complete.$key;
  } else {
    if (process.argv.includes('--verify-only')) throw Error('Seed is absent; verification never writes.');
    const stored = await uploadFile({publicClient:client,walletClient:wallet,bytes,filename,contentType:'text/plain',expirationBlocks:604800,chunkSize:512,
      onProgress:p => {if(p.manifestKey) console.log(JSON.stringify({phase:p.phase,manifestKey:p.manifestKey,completed:p.completed}));}});
    manifestKey = stored.manifestKey; writes = stored.transactionHashes.length;
    report.transactions = [];
    for (const hash of stored.transactionHashes) {
      const receipt = await client.getTransactionReceipt({hash});
      assert.equal(receipt.status,'success');
      report.transactions.push({hash,block:String(receipt.blockNumber),gasUsed:String(receipt.gasUsed)});
    }
  }
  const restored = await downloadFile({publicClient:client,manifestKey,expectedSha256:sha256});
  assert.deepEqual(restored.bytes,bytes);
  assert.equal(restored.filename,filename);
  assert.ok(restored.chunkCount >= 3);
  const sample = {chainId:7794095,manifestKey,sha256,filename,totalBytes:bytes.length,chunkCount:restored.chunkCount,expiresAt:String(restored.expiresAt)};
  if (!process.argv.includes('--verify-only')) fs.writeFileSync(descriptorPath,JSON.stringify(sample,null,2)+'\n');
  report.operationState='complete';save();
  console.log(JSON.stringify({...report,...sample,byteExact:true,queries,writes,finishedAt:new Date().toISOString()},null,2));
} catch (error) {
  writes = Math.max(writes,error.transactionHashes?.length ?? 0);
  save();
  console.log(JSON.stringify({...report,status:'failed',errorCode:error.code ?? error.name,manifestKey:error.manifestKey,transactionHashes:error.transactionHashes,queries,writes}));
  process.exitCode=1;
}

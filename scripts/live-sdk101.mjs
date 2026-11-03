// Authorized small synthetic roundtrip. Only this invocation's returned entity keys may be cleaned.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createPublicClient,createWalletClient,ExpirationTime,randomSalt} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {defineSchema,bytes,str} from '@arkiv-network/sdk/schema';
import {http,custom,hexToBytes} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
const manifest=JSON.parse(fs.readFileSync('package.json'));
const lane={'arkiv-chunking':'CHUNKING','arkiv-images':'IMAGES','arkiv-encryption':'ENCRYPTION'}[manifest.name];
assert.ok(lane);assert.equal(JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json')).version,'1.0.1');
const account=privateKeyToAccount(process.env[`TEST_${lane}_PRIVATE_KEY`]);
assert.equal(account.address.toLowerCase(),process.env[`TEST_${lane}_ADDRESS`].toLowerCase());
assert.notEqual(account.address.toLowerCase(),'0x2f6e6adb6bc8f79799cb479fb5cb237fa3caa690');
const chain=rabdi({accessKey:process.env.ARKIV_ACCESS_KEY_A});let queries=0;
const transport=config=>{const base=http(undefined,{retryCount:0,timeout:30000,fetchOptions:{cache:'no-store'}})(config);return {...base,request:args=>{if(args.method==='arkiv_query')queries++;return base.request(args);}};};
const reader=createPublicClient({chain,transport,cacheTime:0});
const signer=createWalletClient({chain,account,transport,cacheTime:0});
assert.equal(await reader.getChainId(),7794095);
fs.mkdirSync('.sdk101',{recursive:true});
const journal='.sdk101/live.json';assert.ok(!fs.existsSync(journal),'Existing operation journal: inspect and reconcile; never automatically repeat.');
const report={package:manifest.name,version:manifest.version,sdk:'1.0.1',chainId:7794095,account:account.address,funderSigned:false,phase:'sending',created:[],transactions:[],cleanup:[],queries:0};
const save=()=>{report.queries=queries;fs.writeFileSync(journal,JSON.stringify(report,null,2),{mode:0o600});};save();
async function receipt(result,estimate,parameters){
 report.transactions.push({hash:result.txHash,estimate:estimate?.toString(),gas:parameters.gas.toString(),gasPrice:parameters.gasPrice.toString(),nonce:parameters.nonce});save();
 const [r,t]=await Promise.all([reader.getTransactionReceipt({hash:result.txHash}),reader.getTransaction({hash:result.txHash})]);
 assert.equal(r.status,'success');assert.ok(t.gas>=1000000n);assert.ok(!estimate||t.gas>=2n*estimate);
 assert.equal(t.nonce,parameters.nonce);assert.equal(t.gasPrice,parameters.gasPrice);
 Object.assign(report.transactions.at(-1),{status:r.status,gasUsed:r.gasUsed.toString(),blockNumber:r.blockNumber.toString()});save();return r;
}
async function explicit(call){
 let request;
 const unsigned=createWalletClient({chain,account:account.address,transport:custom({request:async args=>{
  if(args.method==='eth_sendTransaction'){request=args.params[0];throw Error('Captured unsigned operation; signing is disabled.');}
  if(!['eth_chainId','eth_blockNumber'].includes(args.method))throw Error('Unexpected unsigned request');return reader.transport.request(args);
 }},{retryCount:0}),cacheTime:0});
 try{await call(unsigned,{gas:1000000n,gasPrice:1n,nonce:0});}catch(error){if(!request)throw error;}
 assert.ok(request);
 const estimate=BigInt(await reader.transport.request({method:'eth_estimateGas',params:[{from:account.address,to:request.to,data:request.data},'latest']}));
 assert.ok(estimate>0n);const gas=estimate*2n>1000000n?estimate*2n:1000000n;
 const gasPrice=await reader.getGasPrice(),nonce=await reader.getTransactionCount({address:account.address,blockTag:'latest'});
 assert.ok(gas<=(await reader.getBlock({blockTag:'latest'})).gasLimit/2n);
 assert.ok(await reader.getBalance({address:account.address,blockTag:'latest'})>=gas*gasPrice,'Insufficient dedicated test funds');
 const parameters={gas,gasPrice,nonce};const result=await call(signer,parameters);if(result.entityKey&&!report.created.includes(result.entityKey)){report.created.push(result.entityKey);save();}
 await receipt(result,estimate,parameters);return result;
}
const contexts=[];
const wallet={...signer,createEntity:async(schema,values,options,parameters)=>{
 const result=await signer.createEntity(schema,values,options,parameters);report.created.push(result.entityKey);save();await receipt(result,contexts.at(-1)?.estimate,parameters);return result;
},patchEntity:async(schema,key,values,parameters)=>{const result=await signer.patchEntity(schema,key,values,parameters);await receipt(result,contexts.at(-1)?.estimate,parameters);return result;}};
const txParams=async context=>{contexts.push(context);assert.ok(await reader.getBalance({address:account.address,blockTag:'latest'})>=context.defaults.gas*context.defaults.gasPrice,'Insufficient dedicated test funds');return {};};
try{
 const lib=await import(manifest.name);let original,key;
 if(lane==='CHUNKING'){
  original=new TextEncoder().encode('SDK 1.0.1 public chunking check.');
  const stored=await lib.uploadFile({publicClient:reader,walletClient:wallet,bytes:original,filename:'sdk101-check.txt',expirationBlocks:3600,txParams});key=stored.manifestKey;
  assert.deepEqual((await lib.downloadFile({publicClient:reader,manifestKey:key,expectedSha256:stored.sha256})).bytes,original);
 }else if(lane==='IMAGES'){
  original=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4V+L2HwAG5AK4X5zdSAAAAABJRU5ErkJggg==','base64'));
  const stored=await lib.storeImage({publicClient:reader,walletClient:wallet,bytes:original,filename:'sdk101-check.png',expirationBlocks:3600,txParams});key=stored.imageKey;
  assert.deepEqual((await lib.retrieveImage({publicClient:reader,imageKey:key,expectedSha256:stored.sha256})).bytes,original);
 }else{
  original=new TextEncoder().encode('SDK 1.0.1 synthetic encryption check.');const secret=await lib.importKey(lib.generateKey());
  const ciphertext=await lib.encryptBytes(secret,original),schema=defineSchema('sdk101.encryption.check',{data:bytes(),kind:str().indexed()});
  const options={expiration:ExpirationTime.fromBlocks(3600),salt:randomSalt()};
  const stored=await explicit((client,parameters)=>client.createEntity(schema,{data:ciphertext,kind:'sdk101-check'},options,parameters));key=stored.entityKey;
  const entity=await reader.getEntity(key,schema),encrypted=hexToBytes(entity.data.value);assert.deepEqual(await lib.decryptBytes(secret,encrypted),original);
  await assert.rejects(lib.decryptBytes(await lib.importKey(lib.generateKey()),encrypted),{code:'DECRYPTION_FAILED'});
  encrypted[encrypted.length-1]^=1;await assert.rejects(lib.decryptBytes(secret,encrypted),{code:'DECRYPTION_FAILED'});
  report.wrongKeyRejected=true;report.tamperingRejected=true;
 }
 report.byteExact=true;report.byteLength=original.length;report.root=key;report.phase='verified';save();
 // The libraries expose no file/image removal API. Use the SDK's public delete action, with
 // the same unsigned estimate recipe, only for keys returned by this invocation's creates.
 for(const entityKey of [...report.created].reverse()){
  const entity=await reader.getEntity(entityKey);assert.equal(entity.$owner.toLowerCase(),account.address.toLowerCase());
  const result=await explicit((client,parameters)=>client.deleteEntity({entityKey},parameters));report.cleanup.push({entityKey,hash:result.txHash});save();
  await assert.rejects(reader.getEntity(entityKey),error=>error.name==='NoEntityFoundError');
 }
 report.phase='complete';save();console.log(JSON.stringify(report,null,2));
}catch(error){report.phase='needs-reconciliation';report.error=error.code??error.name;save();console.error(JSON.stringify(report,null,2));process.exitCode=1;}

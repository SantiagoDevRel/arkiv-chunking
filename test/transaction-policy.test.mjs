import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient,createWalletClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {custom} from 'viem';
import {uploadFile,MAX_EXPIRATION_BLOCKS,ChunkingError} from '../dist/index.js';
import {rpcHarness,TEST_ACCOUNT} from './rpc-harness.mjs';
const chain=rabdi({accessKey:'controlled-test'});
function setup(rpc) {
 return {publicClient:createPublicClient({chain,transport:custom(rpc,{retryCount:0})}),walletClient:createWalletClient({chain,account:TEST_ACCOUNT,transport:custom(rpc,{retryCount:0}),pollingInterval:1})};
}
const input={bytes:new Uint8Array(250001),filename:'policy.bin',expirationBlocks:3600};

test('public upload sends explicit per-write estimate headroom, gas price and fresh latest nonce; expiration is coordinated',async()=>{
 const rpc=rpcHarness(),contexts=[];
 const result=await uploadFile({...setup(rpc),...input,txParams:context=>{contexts.push(context);return {gas:context.defaults.gas+123n,gasPrice:3n};}});
 assert.equal(result.chunkCount,3);assert.equal(rpc.transactions.length,5);
 assert.deepEqual(contexts.map(c=>c.phase),['manifest','chunks','chunks','chunks','finalize']);
 assert.deepEqual(contexts.filter(c=>c.phase==='chunks').map(c=>c.chunkIndex),[0,1,2]);
 for(const [i,tx] of rpc.transactions.entries()) {
  assert.equal(BigInt(tx.gas),contexts[i].defaults.gas+123n);
  assert.equal(BigInt(tx.gasPrice),3n);assert.equal(BigInt(tx.nonce),BigInt(i));
  assert.ok(contexts[i].defaults.gas>=1000000n);assert.ok(contexts[i].defaults.gas>=2n*contexts[i].estimate);
 }
 assert.ok(contexts.some(c=>c.estimate===4904531n));
 const estimates=rpc.requests.filter(r=>r.method==='eth_estimateGas');
 assert.equal(estimates.length,5);
 for(const r of estimates){assert.equal(r.params[1],'latest');assert.equal(r.params[0].from,TEST_ACCOUNT);assert.equal(r.params[0].gas,undefined);assert.equal(r.params[0].nonce,undefined);}
 assert.ok(rpc.requests.filter(r=>r.method==='eth_getTransactionCount').every(r=>r.params[1]==='latest'));
 assert.equal(new Set(rpc.entities.map(e=>e.expiresAt)).size,1);assert.equal(result.expiresAt,3642n);
});

test('maximum lifetime admission includes margin; larger values stop before RPC',async()=>{
 const rpc=rpcHarness(),clients=setup(rpc);
 await assert.rejects(uploadFile({...clients,...input,expirationBlocks:MAX_EXPIRATION_BLOCKS+1}),e=>e.code==='INVALID_INPUT');
 assert.equal(rpc.requests.length,0);
 const stored=await uploadFile({...clients,...input,bytes:new Uint8Array(),expirationBlocks:MAX_EXPIRATION_BLOCKS});
 assert.equal(stored.expiresAt,42n+BigInt(MAX_EXPIRATION_BLOCKS));
});

test('an unsigned estimate error or unsafe caller override stops before a signing request',async()=>{
 for(const scenario of ['estimate','gas','nonce','price']) {
  const rpc=rpcHarness();const provider={request:args=>{if(scenario==='estimate'&&args.method==='eth_estimateGas')throw Error('head-only estimate rejected');return rpc.request(args);}};
  const txParams=scenario==='gas'?()=>({gas:999999n}):scenario==='nonce'?()=>({nonce:7}):scenario==='price'?()=>({gasPrice:0n}):undefined;
  await assert.rejects(uploadFile({...setup(provider),...input,txParams}),e=>e.code==='UPLOAD_FAILED');
  assert.equal(rpc.transactions.length,0);
 }
});

test('a confirmed gas-exhausted revert is retried once with a fresh nonce and doubled gas',async()=>{
 const rpc=rpcHarness({revertAt:[2],exhaustGas:true}),contexts=[];
 const stored=await uploadFile({...setup(rpc),...input,bytes:new Uint8Array([1]),txParams:c=>{contexts.push(c);return {};}});
 assert.equal(rpc.transactions.length,4);assert.equal(stored.transactionHashes.length,4);
 assert.equal(BigInt(rpc.transactions[2].gas),2n*BigInt(rpc.transactions[1].gas));
 assert.equal(BigInt(rpc.transactions[2].nonce),2n);
 assert.deepEqual(contexts.map(c=>c.attempt),[0,0,1,0]);
});

test('semantic reverts and a second exhausted revert stop and preserve confirmed hashes',async()=>{
 for(const options of [{revertAt:[1],exhaustGas:false},{revertAt:[1,2],exhaustGas:true}]) {
  const rpc=rpcHarness(options);
  await assert.rejects(uploadFile({...setup(rpc),...input}),e=>{assert.equal(e.code,'UPLOAD_FAILED');assert.equal(e.transactionHashes.length,options.revertAt.length);return true;});
  assert.equal(rpc.transactions.length,options.revertAt.length);assert.equal(rpc.entities.length,0);
 }
});

test('an uncertain send or failure without an SDK result still requires a receipt and never retries without it',async()=>{
 for(const scenario of ['send','receipt-failure','sdk-result']) {
  const rpc=rpcHarness(scenario==='sdk-result'?{omitLogsAt:[1]}:scenario==='receipt-failure'?{revertAt:[1],exhaustGas:true}:{});let receiptReads=0;
  const provider={request:async args=>{
   if(scenario==='receipt-failure'&&args.method==='eth_getTransactionReceipt'&&++receiptReads===2)return null;
   const result=await rpc.request(args);
   if(scenario==='send'&&args.method==='eth_sendTransaction')throw Error('Connection lost after submission');
   return result;
  }};
  await assert.rejects(uploadFile({...setup(provider),...input}),e=>{
   assert.equal(e.code,'UPLOAD_FAILED');
   if(scenario==='receipt-failure')assert.deepEqual(e.transactionHashes,[]);
   return true;
  });
  assert.equal(rpc.transactions.length,1);
 }
});

test('SDK success with persistently missing receipt preserves every hash and key as confirmation pending, including finalize',async()=>{
 for(const blockedWrite of [1,2,4]) {
  const rpc=rpcHarness(),reads=new Map();
  const provider={request:async args=>{
   if(args.method==='eth_getTransactionReceipt') {
    const hash=args.params[0],count=(reads.get(hash)??0)+1;reads.set(hash,count);
    if(hash===rpc.transactions[blockedWrite-1]?.hash&&count>1)return null;
   }
   return rpc.request(args);
  }};
  await assert.rejects(uploadFile({...setup(provider),...input,bytes:new Uint8Array([1,2]),chunkSize:1}),error=>{
   assert.ok(error instanceof ChunkingError);assert.equal(error.code,'CONFIRMATION_PENDING');
   assert.equal(error.manifestKey,rpc.entities[0].key);
   assert.deepEqual(error.chunkKeys,rpc.entities.slice(1).map(e=>e.key));
   assert.deepEqual(error.transactionHashes,rpc.transactions.map(tx=>tx.hash));
   assert.equal(reads.get(rpc.transactions.at(-1).hash),6); // SDK receipt plus five bounded rechecks.
   return true;
  });
  assert.equal(rpc.transactions.length,blockedWrite);
  if(blockedWrite===4)assert.equal(rpc.entities[0].attributes.find(a=>a.name==='complete').value,true);
 }
});

test('SDK success with a delayed receipt completes without another send at manifest, chunk and finalize',async()=>{
 for(const delayedWrite of [1,2,4]) {
  const rpc=rpcHarness(),reads=new Map();
  const provider={request:async args=>{
   if(args.method==='eth_getTransactionReceipt') {
    const hash=args.params[0],count=(reads.get(hash)??0)+1;reads.set(hash,count);
    if(hash===rpc.transactions[delayedWrite-1]?.hash&&count===2)return null;
   }
   return rpc.request(args);
  }};
  const stored=await uploadFile({...setup(provider),...input,bytes:new Uint8Array([1,2]),chunkSize:1});
  assert.equal(stored.manifestKey,rpc.entities[0].key);
  assert.deepEqual(stored.transactionHashes,rpc.transactions.map(tx=>tx.hash));
  assert.equal(rpc.transactions.length,4);assert.equal(reads.get(rpc.transactions[delayedWrite-1].hash),3);
 }
});

test('a receipt contradicting SDK success cannot authorize a resend or erase recovery evidence',async()=>{
 const rpc=rpcHarness();let reads=0;
 const provider={request:async args=>{
  const result=await rpc.request(args);
  if(args.method==='eth_getTransactionReceipt'&&++reads===2)return {...result,status:'0x0',gasUsed:rpc.transactions[0].gas};
  return result;
 }};
 await assert.rejects(uploadFile({...setup(provider),...input}),error=>{
  assert.equal(error.code,'CONFIRMATION_PENDING');assert.equal(error.manifestKey,rpc.entities[0].key);
  assert.deepEqual(error.transactionHashes,rpc.transactions.map(tx=>tx.hash));return true;
 });
 assert.equal(rpc.transactions.length,1);
});

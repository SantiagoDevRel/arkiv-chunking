import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletClient,ExpirationTime,randomSalt} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {bytes,defineSchema} from '@arkiv-network/sdk/schema';
import {custom,toHex} from 'viem';
import {writeWithPolicy} from '../dist/index.js';
import {rpcHarness,TEST_ACCOUNT} from './rpc-harness.mjs';
const Schema=defineSchema('half.block.test.v1',{data:bytes()}),message='Transaction gas budget exceeds half the latest block gas limit.';
function operation({limits=[30_000_000n],gas,exhaust=false,afterPolicy}={}){
 const rpc=rpcHarness(exhaust?{revertAt:[1],exhaustGas:true}:{}),blockReads=[],signatures=[];let policyDone=false;
 const provider={request:async args=>{
  if(args.method==='eth_getBlockByNumber'){
   assert.deepEqual(args.params,['latest',false]);const limit=afterPolicy&&policyDone?1_999_999n:limits[Math.min(blockReads.length,limits.length-1)];blockReads.push(limit);return {gasLimit:toHex(limit)};
  }
  if(args.method==='eth_sendTransaction')signatures.push(args.params[0]);
  return rpc.request(args);
 }};
 const wallet=createWalletClient({chain:rabdi({accessKey:'controlled-test'}),account:TEST_ACCOUNT,transport:custom(provider,{retryCount:0}),pollingInterval:1}),values={data:new Uint8Array([1])},options={expiration:ExpirationTime.atBlock(3642n),salt:randomSalt()};
 const hashes=[];const promise=writeWithPolicy(wallet,{phase:'manifest'},unsigned=>unsigned.createEntity(Schema,values,options,{gas:1_000_000n,gasPrice:1n,nonce:0}),parameters=>wallet.createEntity(Schema,values,options,parameters),hashes,async()=>{policyDone=true;return gas===undefined?{}:{gas};});
 return {promise,signatures,blockReads,hashes};
}
for(const limit of [30_000_000n,30_000_001n]){
 test(`gas exactly floor half of ${limit} passes`,async()=>{const x=operation({limits:[limit],gas:limit/2n});await x.promise;assert.equal(x.signatures.length,1);assert.equal(BigInt(x.signatures[0].gas),limit/2n);});
 test(`gas floor half plus one of ${limit} rejects with zero signatures`,async()=>{const x=operation({limits:[limit],gas:limit/2n+1n});await assert.rejects(x.promise,e=>{assert.equal(e.message,message);return true;});assert.equal(x.signatures.length,0);});
}
test('full block gas rejects with zero signatures',async()=>{const x=operation({gas:30_000_000n});await assert.rejects(x.promise,{message});assert.equal(x.signatures.length,0);});
test('retry rechecks a freshly reduced latest block and rejects before a second signature',async()=>{const x=operation({exhaust:true,limits:[30_000_000n,3_999_999n]});await assert.rejects(x.promise,{message});assert.deepEqual(x.blockReads,[30_000_000n,3_999_999n]);assert.equal(x.signatures.length,1);assert.equal(x.hashes.length,1);});
test('retry gas exactly half of its fresh latest block passes once',async()=>{const x=operation({exhaust:true,limits:[30_000_000n,4_000_000n]});await x.promise;assert.deepEqual(x.blockReads,[30_000_000n,4_000_000n]);assert.equal(x.signatures.length,2);assert.equal(BigInt(x.signatures[1].gas),2_000_000n);assert.equal(x.hashes.length,2);});
test('latest gas bound is read after an asynchronous caller policy before signing',async()=>{const x=operation({afterPolicy:true});await assert.rejects(x.promise,{message});assert.equal(x.signatures.length,0);assert.deepEqual(x.blockReads,[1_999_999n]);});

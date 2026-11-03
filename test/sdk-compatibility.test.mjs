import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as sdk from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {defineSchema,bytes} from '@arkiv-network/sdk/schema';
import {custom,toHex,encodeErrorResult,parseAbi,ContractFunctionRevertedError} from 'viem';
import {rpcHarness,TEST_ACCOUNT} from './rpc-harness.mjs';
import {uploadFile,MAX_EXPIRATION_BLOCKS} from '../dist/index.js';
const version=JSON.parse(fs.readFileSync('node_modules/@arkiv-network/sdk/package.json')).version;
const current=version==='1.0.1';
const chain=rabdi({accessKey:'controlled-test'}),schema=defineSchema('sdk101.check',{data:bytes()});
function wallet(provider){return sdk.createWalletClient({chain,account:TEST_ACCOUNT,transport:custom(provider,{retryCount:0}),pollingInterval:1,cacheTime:0});}
test('SDK compatibility: over-maximum expiry never reaches the signer on the verified SDK',async()=>{
 const rpc=rpcHarness({revertAt:[1]});
 const abi=parseAbi(['error ExpiryBeyondMaxLifetime(uint64 target,uint64 currentBlock,uint64 maxLifetime)']);
 const data=encodeErrorResult({abi,errorName:'ExpiryBeyondMaxLifetime',args:[7884162n,43n,7884000n]});
 const provider={request:args=>{if(args.method==='eth_call')throw new ContractFunctionRevertedError({abi,data,functionName:'execute'});return rpc.request(args);}};
 await assert.rejects(wallet(provider).createEntity(schema,{data:new Uint8Array([1])},{expiration:sdk.ExpirationTime.fromBlocks(7884120)},{gas:1000000n,gasPrice:1n,nonce:0}),error=>{
  if(current){assert.ok(error instanceof sdk.InvalidExpiryError);assert.equal(error.txHash,undefined);}else{assert.ok(error instanceof sdk.EntityMutationError);assert.equal(error.txHash,rpc.transactions[0].hash);assert.match(error.message,/maximum lifetime|ExpiryBeyondMaxLifetime/);}
  return true;
 });
 assert.equal(rpc.transactions.length,current?0:1);
 console.log(JSON.stringify({sdk:version,expiryPreSend:current,sends:rpc.transactions.length}));
});
test('SDK compatibility: library admission rejects excessive file lifetimes before either SDK path',async()=>{
 const rpc=rpcHarness();
 await assert.rejects(uploadFile({publicClient:sdk.createPublicClient({chain,transport:custom(rpc)}),walletClient:wallet(rpc),bytes:new Uint8Array([1]),filename:'lifetime.bin',expirationBlocks:MAX_EXPIRATION_BLOCKS+1}),{code:'INVALID_INPUT'});
 assert.equal(rpc.requests.length,0);
});
test('SDK compatibility: omitted gas padding and explicit gas preservation',async()=>{
 for(const estimate of [200000n,16000000n,20000000n]){
  const rpc=rpcHarness();
  const p={request:args=>args.method==='eth_estimateGas'?Promise.resolve(toHex(estimate)):rpc.request(args)};
  await wallet(p).createEntity(schema,{data:new Uint8Array([1])},{expiration:sdk.ExpirationTime.fromBlocks(3600)},{gasPrice:1n,nonce:0});
  const padded=estimate>2n**24n?estimate:estimate*125n/100n>2n**24n?2n**24n:estimate*125n/100n;
  if(current)assert.equal(BigInt(rpc.transactions[0].gas),padded);
  else{assert.equal(rpc.transactions[0].gas,undefined);assert.equal(rpc.requests.filter(r=>r.method==='eth_estimateGas').length,0);}
 }
 const rpc=rpcHarness();await wallet(rpc).createEntity(schema,{data:new Uint8Array([1])},{expiration:sdk.ExpirationTime.fromBlocks(3600)},{gas:1234567n,gasPrice:1n,nonce:0});
 assert.equal(BigInt(rpc.transactions[0].gas),1234567n);
});
test('SDK compatibility: authoritative gas-exhausted receipts retain the hash and typed failure',async()=>{
 const rpc=rpcHarness({revertAt:[1],exhaustGas:true});
 await assert.rejects(wallet(rpc).createEntity(schema,{data:new Uint8Array([1])},{expiration:sdk.ExpirationTime.fromBlocks(3600)},{gas:1000000n,gasPrice:1n,nonce:0}),error=>{
  assert.ok(error instanceof sdk.EntityMutationError);assert.equal(error.txHash,rpc.transactions[0].hash);
  if(current)assert.match(error.message,/ran out of gas/);return true;
 });assert.equal(rpc.transactions.length,1);
});
test('SDK compatibility: maximum helper uses the landing block without a subtraction',async()=>{
 if(!current){assert.equal(sdk.ExpirationTime.max,undefined);return;}
 assert.equal(sdk.MAX_LIFETIME,7884000n);
 const entity=await import('@arkiv-network/sdk/entity');assert.equal(entity.MAX_LIFETIME,sdk.MAX_LIFETIME);
 const rpc=rpcHarness();const result=await wallet(rpc).createEntity(schema,{data:new Uint8Array([1])},{expiration:sdk.ExpirationTime.max()},{gas:1000000n,gasPrice:1n,nonce:0});
 assert.equal(result.expiresAt,43n+7884000n);
});

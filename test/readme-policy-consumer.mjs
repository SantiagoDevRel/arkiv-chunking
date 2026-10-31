// Executed only from the fresh packed consumer; the helper is extracted from its installed README.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {custom, toHex} from 'viem';
import {rpcHarness, TEST_ACCOUNT} from './rpc-harness.mjs';
import {storeBinary, binaryOperations} from './readme-example.mjs';

function setup(id, options={}, scenario='normal') {
  const rpc=rpcHarness(options);let receiptReads=0;
  const provider={request:async args=>{
    assert.ok(binaryOperations.has(id),'Operation guard must precede every RPC, including the first.');
    const result=await rpc.request(args);
    if(args.method==='eth_getBlockByNumber')return {...result,gasLimit:toHex(30_000_000)};
    if(args.method==='eth_sendTransaction'&&scenario.startsWith('uncertain')) {
      const error=Error('Connection lost after submission');
      if(scenario==='uncertain-hash')error.txHash=result;
      throw error;
    }
    if(args.method==='eth_getTransactionReceipt') {
      receiptReads++;
      if(receiptReads>1&&['missing','disagrees'].includes(scenario)) {
        const operation=binaryOperations.get(id);
        assert.equal(operation.state,'submitted');assert.equal(operation.txHash,rpc.transactions[0].hash);
        assert.equal(operation.entityKey,rpc.entities[0].key);
        return scenario==='missing'?null:{...result,status:'0x0',gasUsed:rpc.transactions[0].gas};
      }
      if(scenario==='uncertain-hash')return null;
    }
    return result;
  }};
  const wallet=createWalletClient({chain:rabdi({accessKey:'controlled-test'}),account:TEST_ACCOUNT,transport:custom(provider,{retryCount:0}),pollingInterval:1});
  return {rpc,wallet,receiptReads:()=>receiptReads};
}
const small=new Uint8Array([1,2,3]);
async function repeatedClick(id,fixture,operation,data=small) {
  const before=fixture.rpc.requests.length;
  assert.equal(await storeBinary(id,fixture.wallet,data),operation);
  assert.equal(fixture.rpc.requests.length,before,'A repeated click must not even query, let alone resend.');
}

test('README: concurrent and repeated clicks after SDK success make one send',async()=>{
  const id='success',fixture=setup(id);
  const first=storeBinary(id,fixture.wallet,small),second=storeBinary(id,fixture.wallet,small);
  const [operation,again]=await Promise.all([first,second]);assert.equal(operation,again);
  assert.equal(operation.state,'confirmed');assert.equal(operation.attempts,1);
  assert.equal(fixture.rpc.transactions.length,1);await repeatedClick(id,fixture,operation);
});
test('README: SDK success plus missing lookup retains submitted key/hash across new clicks',async()=>{
  const id='missing',fixture=setup(id,{},'missing');
  const operation=await storeBinary(id,fixture.wallet,small);
  assert.equal(operation.state,'submitted');assert.equal(operation.confirmation,'pending');
  assert.equal(operation.txHash,fixture.rpc.transactions[0].hash);assert.equal(operation.entityKey,fixture.rpc.entities[0].key);
  assert.deepEqual(operation.transactionHashes,[operation.txHash]);assert.equal(fixture.receiptReads(),6);
  await repeatedClick(id,fixture,operation);assert.equal(fixture.rpc.transactions.length,1);
});
test('README: SDK success plus a disagreeing gas-exhausted receipt cannot resend',async()=>{
  const id='disagrees',fixture=setup(id,{},'disagrees');
  const operation=await storeBinary(id,fixture.wallet,small);
  assert.equal(operation.state,'submitted');assert.equal(operation.confirmation,'pending');
  await repeatedClick(id,fixture,operation);assert.equal(fixture.rpc.transactions.length,1);
});
test('README: confirmed non-gas revert is terminal with one send',async()=>{
  const id='semantic',fixture=setup(id,{revertAt:[1],exhaustGas:false});
  const operation=await storeBinary(id,fixture.wallet,small);
  assert.equal(operation.state,'terminal');assert.equal(operation.attempts,1);
  assert.equal(operation.transactionHashes.length,1);await repeatedClick(id,fixture,operation);
  assert.equal(fixture.rpc.transactions.length,1);
});
test('README: confirmed gas-exhausted revert permits exactly two sends, ever',async()=>{
  const id='gas-retry',fixture=setup(id,{revertAt:[1],exhaustGas:true});
  const operation=await storeBinary(id,fixture.wallet,small);
  assert.equal(operation.state,'confirmed');assert.equal(operation.attempts,2);
  assert.equal(operation.transactionHashes.length,2);assert.equal(fixture.rpc.transactions.length,2);
  assert.equal(BigInt(fixture.rpc.transactions[1].gas),2n*BigInt(fixture.rpc.transactions[0].gas)+100_000n);
  assert.ok(fixture.rpc.transactions.every(tx=>BigInt(tx.gas)<=15_000_000n));await repeatedClick(id,fixture,operation);
});
test('README: two confirmed exhausted attempts terminate and cannot restart on a new click',async()=>{
  const id='two-reverts',fixture=setup(id,{revertAt:[1,2],exhaustGas:true});
  const operation=await storeBinary(id,fixture.wallet,small);
  assert.equal(operation.state,'terminal');assert.equal(operation.attempts,2);await repeatedClick(id,fixture,operation);
  assert.equal(fixture.rpc.transactions.length,2);
});
test('README: uncertain submissions, with or without a known hash, stay blocked',async()=>{
  for(const scenario of ['uncertain','uncertain-hash']) {
    const id=scenario,fixture=setup(id,{},scenario);
    const operation=await storeBinary(id,fixture.wallet,small);
    assert.equal(operation.state,'uncertain');assert.equal(operation.attempts,1);
    if(scenario==='uncertain-hash')assert.equal(operation.txHash,fixture.rpc.transactions[0].hash);
    await repeatedClick(id,fixture,operation);assert.equal(fixture.rpc.transactions.length,1);
  }
});
test('README: 19,918,124-gas retry is refused above the 15,000,000 cap',async()=>{
  const id='over-cap',fixture=setup(id,{revertAt:[1],exhaustGas:true});
  const data=new Uint8Array(100_000),operation=await storeBinary(id,fixture.wallet,data);
  assert.equal(operation.state,'terminal');assert.equal(operation.reason,'gas-cap');
  assert.equal(operation.attempts,1);assert.equal(fixture.rpc.transactions.length,1);
  assert.equal(BigInt(fixture.rpc.transactions[0].gas),9_909_062n);
  assert.equal(2n*BigInt(fixture.rpc.transactions[0].gas)+100_000n,19_918_124n);
  assert.equal(fixture.rpc.requests.filter(r=>r.method==='eth_estimateGas').length,2);
  assert.ok(fixture.rpc.requests.filter(r=>r.method==='eth_getBlockByNumber').every(r=>r.params[0]==='latest'));
  await repeatedClick(id,fixture,operation,data);
});

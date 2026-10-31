import test from 'node:test';
import assert from 'node:assert/strict';
import {serialRabdiWallet} from '../scripts/rabdi-wallet.mjs';
test('serialized Rabdi adapter uses a fresh latest nonce for each write and refuses a gas budget above the block limit',async()=>{
  let nonce=7,limit=20000000n;
  const writes=[];
  const signer={account:{address:'0x'+'12'.repeat(20)},
    createEntity:async(...args)=>{writes.push(args);nonce++;},
    patchEntity:async(...args)=>{writes.push(args);nonce++;},
  };
  const reader={
    getTransactionCount:async options=>{assert.equal(options.blockTag,'latest');return nonce;},
    request:async args=>{assert.equal(args.method,'eth_gasPrice');return '0x2';},
    getBlock:async options=>{assert.equal(options.blockTag,'latest');return {gasLimit:limit};},
  };
  const wallet=serialRabdiWallet(signer,reader);
  await wallet.createEntity('schema',{},{});await wallet.patchEntity('schema','key',{});
  assert.deepEqual(writes.map(args=>args[3]),[{nonce:7,gas:15000000n,gasPrice:2n},{nonce:8,gas:1000000n,gasPrice:2n}]);
  limit=100000n;
  await assert.rejects(wallet.createEntity('schema',{},{}),/exceeds/);assert.equal(writes.length,2);
});

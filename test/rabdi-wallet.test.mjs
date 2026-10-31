import test from 'node:test';
import assert from 'node:assert/strict';
import {serialRabdiWallet} from '../scripts/rabdi-wallet.mjs';
test('script adapter preserves explicit library parameters and refuses bypassing the public policy',async()=>{
  let nonce=7;
  const writes=[];
  const signer={account:{address:'0x'+'12'.repeat(20)},
    createEntity:async(...args)=>{writes.push(args);nonce++;},
    patchEntity:async(...args)=>{writes.push(args);nonce++;},
  };
  const wallet=serialRabdiWallet(signer);
  const first={nonce:7,gas:9809062n,gasPrice:2n},second={nonce:8,gas:1000000n,gasPrice:2n};
  await wallet.createEntity('schema',{},{},first);await wallet.patchEntity('schema','key',{},second);
  assert.deepEqual(writes.map(args=>args[3]),[first,second]);
  await assert.rejects(wallet.createEntity('schema',{},{}),/Explicit/);assert.equal(writes.length,2);
});

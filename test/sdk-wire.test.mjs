import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicClient, createWalletClient} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {custom} from 'viem';
import {uploadFile, downloadFile, MAX_CHUNK_BYTES} from '../dist/index.js';
import {rpcHarness, TEST_ACCOUNT} from './rpc-harness.mjs';
const chain = rabdi({accessKey: 'controlled-test'});
function clients(rpc) {
  return {
    publicClient: createPublicClient({chain, transport: custom(rpc, {retryCount: 0})}),
    walletClient: createWalletClient({chain, account: TEST_ACCOUNT, transport: custom(rpc, {retryCount: 0}), pollingInterval: 1}),
  };
}
test('SDK 1.0 ABI writes indexed columns and unindexed binary data; boundary bytes round trip', async () => {
  const rpc = rpcHarness(), c = clients(rpc);
  const bytes = Uint8Array.from({length: MAX_CHUNK_BYTES + 1}, (_,i) => i % 251);
  const stored = await uploadFile({...c, bytes, filename: 'boundary.bin', expirationBlocks: 3600, chunkSize: MAX_CHUNK_BYTES});
  assert.equal(rpc.transactions.length, 4);
  assert.ok(rpc.transactions.every(tx => tx.calldataBytes <= 128 * 1024));
  assert.deepEqual((await downloadFile({publicClient: c.publicClient, manifestKey: stored.manifestKey})).bytes, bytes);
  const attrs = rpc.entities[1].attributes;
  assert.equal(attrs.find(a => a.name === 'data').type, 'bytes');
  assert.equal(attrs.find(a => a.name === 'data').indexed, false);
  for (const name of ['type','manifest','seq','arkiv.schema']) assert.equal(attrs.find(a => a.name === name).indexed, true);
  assert.equal(rpc.entities[1].creationFlags.raw, 1);
});
test('SDK named projections and three keyset pages recover 205 chunks; a page failure returns no bytes', async () => {
  const rpc = rpcHarness(); let rejectPage = false;
  const provider = {request(args) {
    if (rejectPage && args.method === 'arkiv_query' && args.params[0].includes('$key >')) throw Error('Controlled page failure');
    return rpc.request(args);
  }};
  const c = clients(provider), bytes = Uint8Array.from({length:410}, (_,i) => i % 251);
  const stored = await uploadFile({...c,bytes,filename:'pages.bin',expirationBlocks:3600,chunkSize:2});
  const before = rpc.requests.length;
  assert.deepEqual((await downloadFile({publicClient:c.publicClient,manifestKey:stored.manifestKey})).bytes,bytes);
  const reads = rpc.requests.slice(before).filter(r => r.method === 'arkiv_query');
  assert.equal(reads.length,5);
  assert.equal(reads[1].params[1].limit,'0x64');
  assert.match(reads[2].params[0], /\$key > key/);
  assert.match(reads[1].params[0], /\$owner = addr/);
  assert.match(reads[1].params[0], /\$creator = addr/);
  assert.equal(reads[1].params[1].select.attributes.data,true);
  const writes = rpc.transactions.length; rejectPage = true;
  await assert.rejects(downloadFile({publicClient:c.publicClient,manifestKey:stored.manifestKey}), e => e.code === 'READ_FAILED');
  assert.equal(rpc.transactions.length,writes);
});

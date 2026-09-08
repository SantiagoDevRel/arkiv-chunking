import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { custom } from 'viem';
import { uploadFile, downloadFile, MAX_CHUNK_BYTES } from '../dist/index.js';
import { rpcHarness, TEST_ACCOUNT } from './rpc-harness.mjs';

test('real SDK writes ABI calldata and decodes receipt events; maximum chunks fit the conservative transaction budget', async () => {
  const rpc = rpcHarness();
  const publicClient = createPublicClient({ chain: tiramisu, transport: custom(rpc, { retryCount: 0 }) });
  const walletClient = createWalletClient({ chain: tiramisu, account: TEST_ACCOUNT, transport: custom(rpc, { retryCount: 0 }), pollingInterval: 1 });
  const bytes = Uint8Array.from({ length: MAX_CHUNK_BYTES + 1 }, (_, i) => i % 251);
  const stored = await uploadFile({ publicClient, walletClient, bytes, filename: 'max-chunk.bin', expirationBlocks: 3600, chunkSize: MAX_CHUNK_BYTES }).catch(error => {
    for (let cause = error; cause; cause = cause.cause) console.error(cause.name, String(cause.message).slice(0, 220));
    console.error(rpc.requests.map(r => r.method));
    throw error;
  });
  assert.equal(rpc.transactions.length, 4);
  assert.ok(rpc.transactions.every(tx => tx.calldataBytes <= 122880));
  assert.deepEqual((await downloadFile({ publicClient, manifestKey: stored.manifestKey })).bytes, bytes);
  assert.equal(rpc.entities[1].creationFlags.raw, 1);
  console.log('maximum-chunk-calldata-bytes', Math.max(...rpc.transactions.map(tx => tx.calldataBytes)));
});

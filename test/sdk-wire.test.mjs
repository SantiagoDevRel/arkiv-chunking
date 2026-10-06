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

function clientsWithProjection(rpc, override) {
  const provider = {
    async request(args) {
      if (override) await override(args);
      const result = await rpc.request(args);
      if (args.method !== 'arkiv_query') return result;
      const select = args.params[1].select;
      return { ...result, data: result.data.map(entity => Object.fromEntries(
        Object.entries(entity).filter(([field]) => select[field]).map(([field, value]) => [
          field,
          field === 'attributes' && typeof select.attributes === 'object'
            ? value.filter(attribute => select.attributes[attribute.name])
            : value,
        ]),
      )) };
    },
  };
  return {
    publicClient: createPublicClient({ chain: tiramisu, transport: custom(provider, { retryCount: 0 }) }),
    walletClient: createWalletClient({ chain: tiramisu, account: TEST_ACCOUNT, transport: custom(provider, { retryCount: 0 }), pollingInterval: 1 }),
  };
}

test('SDK 0.8.1 named projections and two cursor pages recover 205 ABI-written chunks at one block', async () => {
  const rpc = rpcHarness(), clients = clientsWithProjection(rpc);
  const bytes = Uint8Array.from({ length: 410 }, (_, index) => index % 251);
  const stored = await uploadFile({ ...clients, bytes, filename: 'pages.bin', expirationBlocks: 3600, chunkSize: 2 });
  assert.equal(rpc.transactions.length, 207);
  const before = rpc.requests.length;
  const restored = await downloadFile({ publicClient: clients.publicClient, manifestKey: stored.manifestKey, expectedSha256: stored.sha256 });
  assert.deepEqual(restored.bytes, bytes);
  const reads = rpc.requests.slice(before).filter(request => request.method === 'arkiv_query');
  assert.equal(reads.length, 3);
  assert.deepEqual(reads[0].params[1].select.attributes, { type: true, complete: true, sha256: true, totalbytes: true, chunkcount: true, chunksize: true });
  assert.deepEqual(reads[1].params[1].select.attributes, { seq: true });
  assert.equal(reads[2].params[1].cursor, '200');
  assert.equal(reads[1].params[1].atBlock, reads[2].params[1].atBlock);
  assert.match(reads[1].params[0], /\$owner = addr\(/);
  assert.match(reads[1].params[0], /\$creator = addr\(/);
});

test('a real SDK cursor error rejects the whole file without retrying writes or returning partial bytes', async () => {
  const rpc = rpcHarness();
  let failCursor = false, cursorFailures = 0;
  const clients = clientsWithProjection(rpc, args => {
    if (failCursor && args.method === 'arkiv_query' && args.params[1].cursor) {
      cursorFailures++;
      throw Object.assign(new Error('Controlled expired cursor'), { code: -32005 });
    }
  });
  const stored = await uploadFile({ ...clients, bytes: new Uint8Array(410), filename: 'cursor.bin', expirationBlocks: 3600, chunkSize: 2 });
  const beforeWrites = rpc.transactions.length;
  failCursor = true;
  await assert.rejects(downloadFile({ publicClient: clients.publicClient, manifestKey: stored.manifestKey }), error => {
    assert.equal(error.code, 'READ_FAILED');
    assert.equal(error.cause.kind, 'cursor');
    return true;
  });
  assert.equal(cursorFailures, 1);
  assert.equal(rpc.transactions.length, beforeWrites);
  failCursor = false;
  assert.equal((await downloadFile({ publicClient: clients.publicClient, manifestKey: stored.manifestKey })).bytes.length, 410);
});

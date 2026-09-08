import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createPublicClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { custom, toHex } from 'viem';
import { splitFile, hashFile, reconstructFile, uploadFile, downloadFile, MAX_CHUNK_BYTES, MAX_FILE_BYTES, VERSION } from '../dist/index.js';

const owner = '0x' + '12'.repeat(20);
const hex = n => `0x${n.toString(16).padStart(64, '0')}`;
const checksum = bytes => `0x${createHash('sha256').update(bytes).digest('hex')}`;
const code = expected => error => { assert.equal(error.code, expected); return true; };

// Real SDK queries, decoding, selection, predicates and pagination; only RPC storage and writes are simulated.
function network() {
  const entities = [];
  const calls = [];
  let failWriteAt = 0, writes = 0, failRead = false, readFailuresLeft = 0;
  const rpc = async ({ method, params }) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return toHex(tiramisu.id);
    if (method !== 'arkiv_query') throw Error(`Unexpected method ${method}`);
    if (failRead) throw Error('simulated RPC outage');
    if (readFailuresLeft > 0) { readFailuresLeft--; throw Error('simulated transient RPC failure'); }
    const [query, options] = params;
    let selected;
    if (query.includes('$key')) selected = entities.filter(e => query.toLowerCase().includes(e.key.toLowerCase()));
    else {
      assert.match(query, /manifest = key\(0x[0-9a-f]{64}\)/);
      assert.match(query, /\$owner = addr\(/);
      assert.match(query, /\$creator = addr\(/);
      assert.equal(options.atBlock, '0x2a');
      selected = entities.filter(e => e.attributes.some(a => a.name === 'manifest' && query.toLowerCase().includes(a.value.toLowerCase())) && query.toLowerCase().includes(e.owner.toLowerCase()) && query.toLowerCase().includes(e.creator.toLowerCase())).reverse();
    }
    selected = selected.filter(e => BigInt(e.expiresAt) > 42n);
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = Number(BigInt(options.limit));
    return { data: selected.slice(start, start + limit), blockNumber: '0x2a', ...(start + limit < selected.length ? { cursor: String(start + limit) } : {}) };
  };
  const publicClient = createPublicClient({ chain: tiramisu, transport: custom({ request: rpc }, { retryCount: 0 }) });
  const tick = () => { writes++; if (writes === failWriteAt) throw Error('simulated write failure'); return hex(1000 + writes); };
  const walletClient = {
    chain: tiramisu, account: { address: owner }, transport: { request: rpc },
    async createEntity(input) {
      const txHash = tick(), entityKey = hex(entities.length + 1);
      entities.push({ key: entityKey, owner, creator: owner, payload: toHex(input.payload), contentType: input.contentType,
        attributes: Object.entries(input.attributes).map(([name, a]) => ({ name, type: a.type, value: typeof a.value === 'bigint' ? toHex(a.value) : a.value })),
        creationFlags: { raw: input.flags?.readonly ? 1 : 0 }, expiresAt: '0x1000',
      });
      // The SDK write response estimates expiry; the authoritative query can differ.
      return { entityKey, txHash, expiresAt: 4000n };
    },
    async patchEntity(input) {
      const txHash = tick();
      const manifest = entities.find(e => e.key === input.entityKey);
      for (const [name, a] of Object.entries(input.set)) manifest.attributes.find(x => x.name === name).value = a.value;
      return { entityKey: input.entityKey, txHash };
    },
  };
  return { publicClient, walletClient, entities, calls,
    failWrite(n) { failWriteAt = n; }, failReads() { failRead = true; }, failReadTimes(n) { readFailuresLeft = n; },
    upload(bytes = new Uint8Array(randomBytes(250001)), more = {}) { return uploadFile({ publicClient, walletClient, bytes, filename: 'example.bin', expirationBlocks: 3600, ...more }); },
    download(manifestKey = hex(1), more = {}) { return downloadFile({ publicClient, manifestKey, ...more }); },
  };
}

test('public VERSION matches the packed package version', async () => {
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, metadata.version);
});
test('split/reconstruct binary, UTF-8, empty and exact boundaries against independent Node SHA-256', async () => {
  for (const bytes of [new Uint8Array(), new TextEncoder().encode('Bogotá 🧩 '.repeat(33)), new Uint8Array(randomBytes(200000)), new Uint8Array(randomBytes(200001))]) {
    const chunks = splitFile(bytes);
    assert.equal(chunks.length, Math.max(1, Math.ceil(bytes.length / 100000)));
    assert.equal(await hashFile(bytes), checksum(bytes));
    assert.deepEqual(await reconstructFile(chunks, checksum(bytes)), bytes);
  }
});
test('split copies Buffer and typed-array slices without sharing mutable bytes', () => {
  const bytes = Buffer.from([1, 2, 3, 4]); const chunks = splitFile(bytes.subarray(1, 3), { chunkSize: 1 });
  bytes.fill(9); assert.deepEqual(chunks, [new Uint8Array([2]), new Uint8Array([3])]);
});
test('input bounds are checked before network calls', async () => {
  for (const chunkSize of [0, -1, 1.5, Infinity, NaN, MAX_CHUNK_BYTES + 1]) assert.throws(() => splitFile(new Uint8Array(1), { chunkSize }), code('INVALID_INPUT'));
  assert.throws(() => splitFile(new Uint8Array(MAX_FILE_BYTES + 1)), code('INVALID_INPUT'));
  assert.throws(() => splitFile(new Uint8Array(4097), { chunkSize: 1 }), code('INVALID_INPUT'));
  for (const more of [{ filename: '../secret' }, { filename: 'x'.repeat(256) }, { filename: '🙂'.repeat(64) }, { filename: 'a\n.txt' }, { contentType: 'text/html;script' }, { expirationBlocks: 3 }, { expirationBlocks: NaN }, { expirationBlocks: 31536002 }]) {
    const n = network(); await assert.rejects(n.upload(undefined, more), code('INVALID_INPUT')); assert.equal(n.calls.length, 0);
  }
});
test('multi-transaction roundtrip produces ready manifest, immutable chunks and identical bytes', async () => {
  const n = network(), bytes = new Uint8Array(randomBytes(250001)), progress = [];
  const stored = await n.upload(bytes, { onProgress: p => progress.push(p) });
  assert.equal(stored.chunkCount, 3); assert.equal(stored.transactionHashes.length, 5);
  assert.equal(stored.expiresAt, 4096n);
  assert.ok(n.entities.slice(1).every(e => e.creationFlags.raw === 1));
  const file = await n.download(stored.manifestKey, { expectedSha256: checksum(bytes) });
  assert.deepEqual(file.bytes, bytes); assert.equal(file.sha256, checksum(bytes));
  assert.equal(file.expiresAt, stored.expiresAt);
  assert.equal(progress.at(-1).phase, 'finalize');
});
test('empty file is stored, retrieved and verified', async () => {
  const n = network(); const stored = await n.upload(new Uint8Array());
  assert.equal(stored.chunkCount, 1); assert.equal((await n.download()).bytes.length, 0);
});
test('all 205 shuffled chunks retrieved across real SDK cursor pages at manifest snapshot', async () => {
  const n = network(), bytes = new Uint8Array(randomBytes(2050));
  await n.upload(bytes, { chunkSize: 10 });
  const beforeRead = n.calls.length;
  assert.deepEqual((await n.download()).bytes, bytes);
  const queries = n.calls.slice(beforeRead).filter(c => c.method === 'arkiv_query');
  assert.equal(queries.length, 3); assert.equal(queries[2].params[1].cursor, '200');
  assert.equal(queries[2].params[1].atBlock, '0x2a');
});
test('caller byte mutation after invocation cannot corrupt upload snapshot', async () => {
  const n = network(), bytes = Buffer.from([1, 2, 3]);
  const promise = n.upload(bytes); bytes.fill(9); await promise;
  assert.deepEqual((await n.download()).bytes, new Uint8Array([1, 2, 3]));
});
test('block lifetime rejects too-small budgets before RPC or spending', async () => {
  for (const more of [{ expirationBlocks: 31 }, { expirationBlocks: 102, chunkSize: 1 }]) {
    const n = network();
    await assert.rejects(n.upload(new Uint8Array(100), more), code('INVALID_INPUT'));
    assert.equal(n.calls.length, 0); assert.equal(n.entities.length, 0);
  }
});
test('expired or near-expiry manifest stops further writes and retains confirmed evidence', async () => {
  for (const expiresAt of ['0x2a', '0x2c']) {
    const n = network(), create = n.walletClient.createEntity;
    n.walletClient.createEntity = async input => {
      const result = await create(input);
      n.entities[0].expiresAt = expiresAt;
      return result;
    };
    await assert.rejects(n.upload(), error => {
      assert.equal(error.code, 'UPLOAD_FAILED');
      assert.equal(error.cause.code, 'INCOMPLETE_UPLOAD');
      assert.equal(error.manifestKey, hex(1)); assert.equal(error.transactionHashes.length, 1);
      return true;
    });
    assert.equal(n.entities.length, 1);
  }
});
test('progress callback exceptions do not change network success', async () => {
  const n = network(); await n.upload(undefined, { onProgress() { throw Error('UI bug'); } });
  await n.download(hex(1), { onProgress() { throw Error('UI bug'); } });
});
test('a confirmed finalization succeeds without a post-write query that can misreport failure', async () => {
  const n = network(), patch = n.walletClient.patchEntity;
  n.walletClient.patchEntity = async input => { const result = await patch(input); n.failReadTimes(1); return result; };
  const stored = await n.upload();
  assert.equal(stored.transactionHashes.length, 5); assert.equal(stored.expiresAt, 4096n);
  assert.equal(n.calls.filter(c => c.method === 'arkiv_query').length, 4);
  n.failReadTimes(0);
  assert.equal((await n.download()).bytes.length, 250001);
});
test('a transient liveness read retries once without duplicating a write', async () => {
  const n = network(); n.failReadTimes(1);
  const stored = await n.upload(new Uint8Array([1]));
  assert.equal(stored.transactionHashes.length, 3); assert.equal(n.entities.length, 2);
  assert.equal(n.calls.filter(c => c.method === 'arkiv_query').length, 3);
});
test('persistent liveness transport failure is distinct from expiry and stops further spending', async () => {
  const n = network(); n.failReads();
  await assert.rejects(n.upload(), error => {
    assert.equal(error.code, 'UPLOAD_FAILED'); assert.equal(error.cause.code, 'READ_FAILED');
    assert.equal(error.transactionHashes.length, 1); assert.equal(error.manifestKey, hex(1)); return true;
  });
  assert.equal(n.calls.filter(c => c.method === 'arkiv_query').length, 2);
  assert.equal(n.entities.length, 1);
});
test('async progress rejection does not become an unhandled rejection after confirmed writes', async () => {
  const n = network();
  const onProgress = async () => { await Promise.resolve(); throw Error('async UI failure'); };
  await n.upload(new Uint8Array([1]), { onProgress });
  await n.download(hex(1), { onProgress });
  await new Promise(resolve => setImmediate(resolve));
});
test('wrong chain and missing wallet fail before any write', async () => {
  for (const variant of ['public', 'wallet', 'mainnet', 'account']) {
    const n = network();
    if (variant === 'public') n.publicClient.chain = { ...tiramisu, id: tiramisu.id + 1 };
    if (variant === 'wallet') n.walletClient.transport.request = async () => '0x1';
    if (variant === 'mainnet') n.walletClient.chain = { ...tiramisu, testnet: false };
    if (variant === 'account') n.walletClient.account = undefined;
    await assert.rejects(n.upload(), code('NETWORK_MISMATCH')); assert.equal(n.entities.length, 0);
  }
});
test('missing, never-created or expired manifest is explicit', async () => { await assert.rejects(network().download(), code('NOT_FOUND')); });
test('failed middle write retains audit details and remains incomplete', async () => {
  const n = network(); n.failWrite(3);
  await assert.rejects(n.upload(), error => { assert.equal(error.code, 'UPLOAD_FAILED'); assert.equal(error.manifestKey, hex(1)); assert.equal(error.transactionHashes.length, 2); return true; });
  assert.equal(n.entities.length, 2); await assert.rejects(n.download(), code('INCOMPLETE_UPLOAD'));
});
test('failed finalize never advertises a completed file', async () => {
  const n = network(); n.failWrite(5); await assert.rejects(n.upload(), code('UPLOAD_FAILED')); await assert.rejects(n.download(), code('INCOMPLETE_UPLOAD'));
});
test('missing chunk never returns truncated bytes', async () => {
  const n = network(); await n.upload(); n.entities.splice(2, 1); await assert.rejects(n.download(), code('MISSING_CHUNK'));
});
test('duplicate index, invalid index and length mismatch are rejected', async () => {
  for (const mutate of [n => n.entities.push(structuredClone(n.entities[1])), n => { n.entities[1].attributes.find(a => a.name === 'seq').value = '0xff'; }, n => { n.entities[1].payload = '0x00'; }]) {
    const n = network(); await n.upload(); mutate(n); await assert.rejects(n.download(), code('INVALID_CHUNK'));
  }
});
test('same-length corruption and independent expected digest mismatch fail closed', async () => {
  const n = network(); await n.upload();
  n.entities[1].payload = '0x' + '00'.repeat(100000);
  await assert.rejects(n.download(), code('HASH_MISMATCH'));
  await assert.rejects(n.download(hex(1), { expectedSha256: hex(0) }), code('HASH_MISMATCH'));
});
test('malformed manifest bounds, metadata, tag and count fail before chunk reads', async () => {
  for (const mutate of [
    e => { e.payload = '0xff'; }, e => { e.payload = toHex(new TextEncoder().encode('{"filename":"../x","contentType":"text/plain"}')); },
    e => { e.attributes.find(a => a.name === 'type').value = 'not-our-format'; },
    e => { e.attributes.find(a => a.name === 'chunkcount').value = '0x0'; },
    e => { e.attributes.find(a => a.name === 'chunksize').value = '0x0'; },
    e => { e.attributes.find(a => a.name === 'totalbytes').value = '0xffffffffffffffff'; },
    e => { e.attributes.find(a => a.name === 'chunkcount').type = 'u256'; },
  ]) {
    const n = network(); await n.upload(); mutate(n.entities[0]);
    await assert.rejects(n.download(), code('INVALID_MANIFEST'));
  }
});
test('foreign owner cannot inject a duplicate into reconstruction', async () => {
  const n = network(); await n.upload(); const injected = structuredClone(n.entities[1]); injected.owner = '0x' + '34'.repeat(20); n.entities.push(injected);
  assert.equal((await n.download()).bytes.length, 250001);
});
test('RPC outage is distinguishable from an empty result', async () => { const n = network(); n.failReads(); await assert.rejects(n.download(), code('READ_FAILED')); });
test('out-of-order local reconstruction with equal-length chunks is rejected', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]); const chunks = splitFile(bytes, { chunkSize: 2 });
  await assert.rejects(reconstructFile(chunks.reverse(), checksum(bytes)), code('HASH_MISMATCH'));
});

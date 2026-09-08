// Creates only synthetic public test data. Never deletes existing or newly created entities.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { uploadFile, downloadFile, VERSION, MAX_CHUNK_BYTES } from 'arkiv-chunking';

if (!process.env.ARKIV_PRIVATE_KEY) throw new Error('Set ARKIV_PRIVATE_KEY locally for this explicit testnet write test.');
const transport = () => http(process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0], { timeout: 30000, retryCount: 0, fetchOptions: { cache: 'no-store' } });
const account = privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: tiramisu, transport: transport() });
const walletClient = createWalletClient({ chain: tiramisu, account, transport: transport() });
const report = { package: VERSION, node: process.version, chainId: await publicClient.getChainId(), account: account.address, started: new Date().toISOString(), cases: [] };
assert.equal(report.chainId, tiramisu.id);
for (const [filename, bytes, chunkSize] of [
  ['synthetic-roundtrip.txt', new TextEncoder().encode('Public test data.\n'.repeat(15000)), 100000],
  ['synthetic-empty.bin', new Uint8Array(), 100000],
  ['synthetic-boundary.bin', Uint8Array.from({ length: MAX_CHUNK_BYTES + 1 }, (_, i) => i % 251), MAX_CHUNK_BYTES],
]) {
  try {
    const stored = await uploadFile({ publicClient, walletClient, bytes, filename, expirationBlocks: 3600, chunkSize,
      onProgress: p => console.log(JSON.stringify({ filename, progress: p })),
    });
    const expectedSha256 = `0x${createHash('sha256').update(bytes).digest('hex')}`;
    const restored = await downloadFile({ publicClient, manifestKey: stored.manifestKey, expectedSha256 });
    assert.deepEqual(restored.bytes, bytes);
    const transactions = [];
    for (const hash of stored.transactionHashes) {
      const [tx, receipt] = await Promise.all([publicClient.getTransaction({ hash }), publicClient.getTransactionReceipt({ hash })]);
      assert.equal(receipt.status, 'success');
      transactions.push({ hash, blockNumber: String(receipt.blockNumber), calldataBytes: (tx.input.length - 2) / 2, gasUsed: String(receipt.gasUsed) });
    }
    await assert.rejects(downloadFile({ publicClient, manifestKey: stored.manifestKey, expectedSha256: `0x${'00'.repeat(32)}` }), e => e.code === 'HASH_MISMATCH');
    report.cases.push({ filename, totalBytes: bytes.length, chunkSize, chunkCount: stored.chunkCount, manifestKey: stored.manifestKey, expiresAt: String(stored.expiresAt), sha256: expectedSha256, byteExact: true, transactions });
  } catch (error) {
    console.log(JSON.stringify({ failed: filename, code: error.code ?? error.name, manifestKey: error.manifestKey, transactionHashes: error.transactionHashes }));
    process.exitCode = 1;
    break;
  }
}
await assert.rejects(downloadFile({ publicClient, manifestKey: `0x${'00'.repeat(32)}` }), e => e.code === 'NOT_FOUND');
console.log(JSON.stringify({ ...report, finished: new Date().toISOString() }, null, 2));

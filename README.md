# arkiv-chunking

Split a file into queryable Arkiv entities on the Web3 database, then recover exactly its original bytes. Indexed manifest references and sequence columns connect each file to its binary chunks. Every download checks chunk indexes, byte lengths and SHA-256 before returning anything.

**Candidate: arkiv-chunking 1.0.0, SDK 1.0.0, Rabdi DB-Chain testnet (7794095).** This branch is awaiting review and publication. Its preview installs the packed candidate; it does not claim a registry release. See [verification](docs/verification.md) and [breaking changes](CHANGELOG.md).

## Local use without credentials

Use Node.js 22.10+ or a browser secure context, ESM, SDK 1.0.0 and viem 2.56.3. From this checkout:

```sh
npm ci
npm run build
npm pack
```

Install the resulting tarball into a clean consumer:

```sh
npm init -y
npm pkg set type=module
npm install /absolute/path/to/arkiv-chunking-1.0.0.tgz @arkiv-network/sdk@1.0.0 viem@2.56.3
```

After publication, replace the tarball argument with `arkiv-chunking@1.0.0`. Check `npm view arkiv-chunking version` first.

```js
import {splitFile, hashFile, reconstructFile} from 'arkiv-chunking';
const original = new TextEncoder().encode('Hello, Arkiv!');
const chunks = splitFile(original, {chunkSize: 5});
const restored = await reconstructFile(chunks, await hashFile(original));
console.log(chunks.length, new TextDecoder().decode(restored)); // 3, Hello, Arkiv!
```

Splitting, hashing and local reconstruction need no network, signing wallet or access key.

## Store and retrieve on Rabdi

Get a free [access key](https://hub.arkiv.network/access-keys) and fund a dedicated test wallet with test GLM at the [Hub faucet](https://hub.arkiv.network/faucet). Use matching explicit Rabdi configurations for the RPC and wallet. The [explorer](https://rabdi.explorer.arkiv.network) shows entities and transactions. No mainnet support is claimed.

Configure `ARKIV_ACCESS_KEY` and `ARKIV_PRIVATE_KEY` locally, outside source control. Never paste a signing key into chat, a browser app or a bundle. An access key is required for practical network use; it does not sign transactions. The SDK throws `MissingAccessKeyError` if the accessKey option is missing. Obtain a key from the Hub and pass it explicitly rather than bypassing the check.

```js
import {createPublicClient, createWalletClient, MissingAccessKeyError} from '@arkiv-network/sdk';
import {rabdi} from '@arkiv-network/sdk/chains';
import {http} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {uploadFile, downloadFile} from 'arkiv-chunking';

if (!process.env.ARKIV_ACCESS_KEY) throw new MissingAccessKeyError('Rabdi');
if (!process.env.ARKIV_PRIVATE_KEY) throw new Error('Configure a dedicated signing key locally.');
const chain = rabdi({accessKey: process.env.ARKIV_ACCESS_KEY});
const transport = () => http(undefined, {retryCount: 0, timeout: 30000, fetchOptions: {cache: 'no-store'}});
const publicClient = createPublicClient({chain, transport: transport()});
const signer = createWalletClient({
  chain, transport: transport(), account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY),
});
const parameters = async gas => {
  const [nonce, price, block] = await Promise.all([
    publicClient.getTransactionCount({address: signer.account.address, blockTag: 'latest'}),
    publicClient.request({method: 'eth_gasPrice'}),
    publicClient.getBlock({blockTag: 'latest'}),
  ]);
  if (gas > block.gasLimit) throw new Error('Current block cannot fit this gas budget.');
  return {nonce, gas, gasPrice: BigInt(price)};
};
const walletClient = {
  ...signer,
  createEntity: async (schema, values, options) =>
    signer.createEntity(schema, values, options, await parameters(15000000n)),
  patchEntity: async (schema, key, changes) =>
    signer.patchEntity(schema, key, changes, await parameters(1000000n)),
};
const original = new TextEncoder().encode('Public test data.\n'.repeat(15000));
const stored = await uploadFile({
  publicClient, walletClient, bytes: original, filename: 'example.txt',
  contentType: 'text/plain', expirationBlocks: 3600,
});
const restored = await downloadFile({
  publicClient, manifestKey: stored.manifestKey, expectedSha256: stored.sha256,
});
if (original.length !== restored.bytes.length ||
    original.some((byte, index) => byte !== restored.bytes[index])) throw new Error('Byte comparison failed.');
console.log({manifestKey: stored.manifestKey, chunks: stored.chunkCount, bytes: restored.bytes.length});
```

Save this as roundtrip.mjs. Run `node --env-file=/absolute/path/to/your-secret.env roundtrip.mjs`, with ARKIV_ACCESS_KEY and ARKIV_PRIVATE_KEY configured outside the checkout. This example writes public synthetic bytes in at least three chunks. All bytes and metadata are publicly readable. Entity Expiration is not historical erasure.

Rabdi's measured wallet workaround uses a fresh nonce from latest and the network gas price before each serialized write, with explicit gas. The seed and live-smoke scripts apply it through a wallet adapter (15,000,000 gas for binary creates, 1,000,000 for the small finalization patch), and reject budgets above the current block limit. The sample uses the same policy. These budgets are verified on the candidate's bounded chunks; they are not universal network limits. The package passes its supplied wallet through and never retries an ambiguous write.

## Public API

Import only from `arkiv-chunking`; types ship with the package.

| Export | Contract |
|---|---|
| `splitFile(bytes, {chunkSize?})` | Copies input into ordered Uint8Array chunks. An empty file has one empty chunk. |
| `hashFile(bytes)` | Promise of a 32-byte SHA-256 hex string. |
| `reconstructFile(orderedChunks, expectedSha256)` | Verified bytes, or an error. Caller supplies order. No RPC. |
| `uploadFile(options)` | Requires publicClient, walletClient, bytes, filename, expirationBlocks; optional contentType, chunkSize, onProgress. Resolves only after finalization. |
| `downloadFile(options)` | Requires publicClient and manifestKey; optional trusted expectedSha256 and onProgress. No wallet needed. |
| `ManifestSchema`, `ChunkSchema` | SDK 1.0 schemas for reads and integrations. Do not independently mutate a stored file. |
| `ChunkingError` | code, optional manifestKey, confirmed transactionHashes and a local-only cause. Never expose raw provider causes publicly. |
| `VERSION`, `DEFAULT_CHUNK_BYTES`, `MAX_CHUNK_BYTES`, `MAX_FILE_BYTES`, `MAX_CHUNKS` | Package version and enforced limits. |
| `UploadOptions`, `UploadResult`, `DownloadOptions`, `DownloadResult`, `Progress`, `ChunkingErrorCode`, `ChunkingPublicClient`, `ChunkingWalletClient` | Public TypeScript types. |

UploadResult contains manifestKey, sha256, chunkCount, totalBytes, expiresAt (bigint block) and confirmed transactionHashes. DownloadResult contains bytes, filename, contentType, sha256, chunkCount and expiresAt. Progress is {phase, completed, total, manifestKey?}; phases are manifest, chunks and finalize. Callback failures are ignored, and async callbacks are not awaited. Only the operation's resolved promise means success.

## Storage format and Entity Expiration

Format v2 uses named SDK schemas:

| Schema | Indexed columns | Stored columns |
|---|---|---|
| Manifest | type, complete, sha256, arkiv.schema | totalbytes, chunkcount, chunksize, metadata (bytes) |
| Chunk | type, manifest (key), seq (u64), arkiv.schema | data (bytes, never indexed) |

Metadata is UTF-8 JSON with filename and contentType; a filename can be 255 UTF-8 bytes, without fitting it into an SDK str column. The digest is a 66-character str. Chunk bytes are selected as `data.value` (hex in SDK 1.0).

Upload creates an incomplete manifest, writes immutable chunks sequentially, then patches complete to true. There are N+2 transactions. Every chunk receives the same relative Entity Expiration as the manifest and is created later, so it outlives the manifest. Before every chunk and finalization, a read checks that the manifest has enough blocks remaining. One failed liveness read receives one read-only retry; writes are never automatically retried.

The reader scopes chunks by manifest, type, owner and creator. It uses ascending immutable keys and a strict greater-than key predicate for later pages, then orders by seq. SDK 1.0 reads the latest block per request; this is not a pinned snapshot. After checking the complete count, exact lengths and SHA-256, the reader queries the manifest again and rejects a changed or expired manifest. It rejects mutable chunks, duplicate keys/indexes and missing parts. No partial bytes are returned.

Ownership transfer, independent mutations and extending a subset of the file are unsupported. An independently trusted expectedSha256 pins integrity beyond the manifest's current claim; a digest alone does not prove publisher identity.

## Limits and recovery

| Policy | Limit |
|---|---|
| File | 0–33,554,432 bytes (32 MiB), in memory |
| Chunk | Default 100,000 bytes; configurable 1–120,000 |
| Chunks | At most 4,096 |
| Filename | Basename, 1–255 UTF-8 bytes; no separators/control characters |
| Content type | MIME type/subtype without parameters, at most 128 bytes |
| Entity Expiration | Whole blocks, min max(32, chunkCount+3), max 15,768,000 |
| Query page | At most 100 entities; smaller binary pages keep responses around 2 MB |

Blocks are not a reliable clock, and wallet delays consume the selected lifetime. A queried expiresAt is authoritative at that read; the upload returns the pre-finalization check. There is no post-finalization read that could turn a confirmed final write into an apparent failure.

If upload fails, retain error.manifestKey and error.transactionHashes. Inspect their receipts and the complete column before deciding to create another file. Confirmed parts remain; an ambiguous timeout may follow a transaction that landed but whose confirmation was not observed. Do not automatically repeat a write or independently patch the manifest to complete. Recovery means inspecting preserved evidence and retrying only a read of a finalized file. There is no automatic upload resume, rollback, cleanup, encryption or read authorization.

| Error | Action |
|---|---|
| NETWORK_MISMATCH | Match Rabdi chain 7794095 across the clients, wallet and RPC. |
| MissingAccessKeyError, HTTP 401/403/429 | Configure an access key from the Hub; check its provider quota. |
| UPLOAD_FAILED | Preserve manifest and confirmed hashes; inspect receipts before another upload. |
| NOT_FOUND | Check manifest key, network and Entity Expiration. |
| INCOMPLETE_UPLOAD, MISSING_CHUNK | Inspect upload receipts; reconstruction refuses partial bytes. |
| INVALID_MANIFEST, INVALID_CHUNK, HASH_MISMATCH | Reject the file. Never bypass validation. |
| READ_FAILED | Retry a complete read from the manifest; do not re-upload. |

## Sample and verification

The [sample guide](sample/README.md) covers browser-wallet storage, read-only public samples and the bounded server read proxy. The existing production site is promoted only after release approval; this branch's preview uses the candidate tarball.

```sh
npm test
npm run typecheck
npm run lint
node scripts/verify.mjs
```

verify.mjs installs the locked existing toolchain, checks the package, packs it, exercises an independent ESM consumer, and builds the preview against that tarball. It expects TMPDIR (as supplied by the DGX job runner). It never publishes.

The explicit synthetic Rabdi seed is `node scripts/seed-rabdi.mjs`, with ARKIV_ACCESS_KEY_A and TEST_CHUNKING_PRIVATE_KEY configured locally. It queries by digest and owner, reuses a byte-verified complete file, refuses ambiguous incomplete seeds, and writes sample/public/sample.json. Run it again to prove writes: 0. `--verify-only` performs no writes. These are dedicated test credentials, never a server signer.

Read [AGENTS.md](AGENTS.md) explicitly when integrating, and include [CLAUDE.md](CLAUDE.md) for Claude consumers. Dated historical evidence stays in docs; [the current report](docs/verification.md) distinguishes live writes from simulations and unpublished artifacts.

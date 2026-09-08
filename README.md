# arkiv-chunking

Split a file into queryable Arkiv entities, store it, and retrieve exactly the original bytes. A typed `key` attribute links each chunk to its manifest. The reader fetches every page at one block, restores sequence order, and verifies the length and SHA-256 before returning anything.

**These packages are intended for testnet use.**

Version: **0.1.0**. Release candidate: **not yet published**. The commands below name the intended npm version; registry installation and sample checkout are not available until publication is verified. Local package tests use `npm pack`, explicitly distinguished in [verification](docs/verification.md).

## Install and run without a wallet

Requirements: Node.js **22.10+** with Web Crypto (tested: **22.22.3**), or a browser secure context. This is an **ESM** package. SDK **0.8.0** and viem **2.56.3** are the tested combination; old SDK 0.7 and earlier are incompatible. Other SDK releases, Bun and Deno have not been verified.

```sh
mkdir chunking-consumer
cd chunking-consumer
npm init -y
npm pkg set type=module
npm install --save-exact arkiv-chunking@0.1.0 @arkiv-network/sdk@0.8.0 viem@2.56.3
```

Save this as `example.mjs`:

```js
import { splitFile, hashFile, reconstructFile } from 'arkiv-chunking';

const original = new TextEncoder().encode('Hello, Arkiv!');
const expectedSha256 = await hashFile(original);
const chunks = splitFile(original, { chunkSize: 5 });
const restored = await reconstructFile(chunks, expectedSha256);
console.log(chunks.length); // 3
console.log(new TextDecoder().decode(restored)); // Hello, Arkiv!
```

```sh
node example.mjs
```

This example is entirely local. It requires no network, wallet, funds, or access key and does not demonstrate persistence. The next example does.

## Store and retrieve on Tiramisu

1. Use **Tiramisu testnet**, chain ID **7738577**, from `@arkiv-network/sdk/chains`. Choose the same network in your wallet and RPC configuration. The package refuses missing chains, chains without `testnet: true`, and mismatched RPC/wallet chain IDs. Custom testnet configurations are accepted but have not been tested.
2. Fund a dedicated test wallet with **test GLM** using the [Hub faucet](https://hub.arkiv.network/faucet). Connect and sign in with that wallet. Test tokens have no monetary value. The [network page](https://hub.arkiv.network/networks) provides current connection details.
3. Reads through `https://rpc.tiramisu.db-chain.testnet.arkiv.network` are anonymous. If your write RPC requires an access key, obtain a Tiramisu key at [Access Keys](https://hub.arkiv.network/api-keys), then use its connection instructions. Access policy and quotas belong to the provider and may change. A wallet signs writes; an RPC access key does not replace it.
4. For Node, put `ARKIV_PRIVATE_KEY` in a local secret file **outside your checkout** or your process environment. Optional `ARKIV_RPC_URL` selects your authenticated RPC. Never paste secrets into code, docs, a chat, or a browser bundle. For the browser flow, use the [sample](https://github.com/SantiagoDevRel/arkiv-chunking/tree/feat/file-chunking/sample), which asks your wallet to sign and never accepts a private key.

Save as `roundtrip.mjs` in the consumer directory:

```js
import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { uploadFile, downloadFile } from 'arkiv-chunking';

if (!process.env.ARKIV_PRIVATE_KEY) throw new Error('Set ARKIV_PRIVATE_KEY locally.');
const rpc = process.env.ARKIV_RPC_URL ?? tiramisu.rpcUrls.default.http[0];
const transport = () => http(rpc, {
  retryCount: 0,
  timeout: 30_000,
  fetchOptions: { cache: 'no-store' },
});
const publicClient = createPublicClient({ chain: tiramisu, transport: transport() });
const walletClient = createWalletClient({
  chain: tiramisu,
  transport: transport(),
  account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY),
});
const original = new TextEncoder().encode('Public test data.\n'.repeat(15000));
const stored = await uploadFile({
  publicClient, walletClient, bytes: original,
  filename: 'example.txt', contentType: 'text/plain',
  expirationBlocks: 3600,
});
const restored = await downloadFile({
  publicClient, manifestKey: stored.manifestKey,
  expectedSha256: stored.sha256,
});
const matches = original.length === restored.bytes.length &&
  original.every((value, index) => value === restored.bytes[index]);
if (!matches) throw new Error('Byte comparison failed');
console.log({ manifestKey: stored.manifestKey, expiresAt: String(stored.expiresAt), chunks: stored.chunkCount,
  bytes: restored.bytes.length, matches });
```

```sh
node --env-file=/absolute/path/to/your-secret.env roundtrip.mjs
```

The secret file uses ordinary `NAME=value` syntax: `ARKIV_PRIVATE_KEY` and optionally `ARKIV_RPC_URL`. Supply your own values locally. If already in the process environment, run `node roundtrip.mjs`.

Expected: a new 32-byte manifest key, the queried expiration block in `expiresAt`, `chunks: 3`, `bytes: 270000`, `matches: true`. This creates five transactions: the manifest, three chunks, and finalization. All bytes and metadata become publicly readable. **Entity Expiration stops current queries from returning entities; it does not erase historical bytes.**

## Public API

Types ship with the package. Import the types you need from `arkiv-chunking`; no internal path imports.

| Export | Contract |
|---|---|
| `splitFile(bytes, { chunkSize? })` | Synchronous `Uint8Array[]`, in order; copies input. Empty file becomes one empty chunk. |
| `hashFile(bytes)` | `Promise<Hex>` with SHA-256 of the bytes. |
| `reconstructFile(orderedChunks, expectedSha256)` | `Promise<Uint8Array>`; rejects oversized input or digest mismatch. It cannot infer order; callers provide it. |
| `uploadFile(options)` | `Promise<UploadResult>`: manifest key, digest, byte/chunk counts, queried `expiresAt: bigint` block and confirmed transaction hashes. Required: public/wallet clients, bytes, filename, expirationBlocks. Optional: MIME contentType, chunkSize, onProgress. |
| `downloadFile(options)` | `Promise<DownloadResult>`: verified bytes, filename, MIME contentType, digest, chunkCount, `expiresAt: bigint` block. Required: publicClient, manifestKey. Optional: expectedSha256, onProgress. No wallet. |
| `ChunkingError` | `code`, `manifestKey?`, `transactionHashes`, and `cause` for local diagnostics. Never display raw `cause` publicly: SDK/provider errors may contain sensitive RPC URLs. |
| `VERSION`, `DEFAULT_CHUNK_BYTES`, `MAX_CHUNK_BYTES`, `MAX_FILE_BYTES`, `MAX_CHUNKS` | Version and enforced package limits. |
| `UploadOptions`, `UploadResult`, `DownloadOptions`, `DownloadResult`, `Progress`, `ChunkingErrorCode`, `ChunkingPublicClient`, `ChunkingWalletClient` | Public TypeScript integration types. |

`onProgress` receives `{ phase, completed, total, manifestKey? }`. Phases are `manifest`, `chunks`, and `finalize`; downloads report `chunks`. Completion counts chunks, not transactions. Only a resolved promise signals success. Callbacks are observational: thrown errors and rejected callback promises are ignored so they cannot turn a confirmed write into an apparent failed upload. Callback promises are not awaited and cannot delay a write.

## Limits and failure semantics

| Constraint | Value / behavior |
|---|---|
| File size | 0–33,554,432 bytes (32 MiB), in memory; no streaming |
| Default chunk | 100,000 bytes |
| Configurable chunk | 1–120,000 bytes, at most 4,096 chunks |
| Filename | Basename only, 1–255 UTF-8 bytes; no separators or control characters |
| MIME type | At most 128 bytes, `type/subtype`, without parameters |
| Entity lifetime | Explicit whole blocks: at least `max(32, chunkCount + 3)`, at most 15,768,000; starts during upload |
| Write pattern | One manifest + N sequential chunk transactions + one finalization patch; N+2 confirmations and wallet approvals |
| Upload checks | Manifest queried before each chunk, before finalization and after its receipt (N+2 queries); stops new writes when insufficient blocks remain |
| Read pattern | One chain check, one manifest query, then all chunk pages, 200 entities per page, pinned to the manifest's query block |

These are package policies, not universal network maxima. The chunk ceiling leaves space for the entire signed transaction and its fixed attributes; **a payload maximum is not a transaction maximum**. The conservative budget comes from the existing cookbook and Sourcify chunking implementation. Actual compatibility and measured sizes live in [verification](docs/verification.md).

The manifest is created with `complete: false`, typed count/size/hash attributes, and JSON filename/MIME metadata. Each chunk has a versioned `type`, a `manifest: key(...)` reference, `seq: u64(...)`, raw bytes and the read-only creation flag. The final patch sets `complete: true` only after all chunk receipts succeed. Chunks receive the same relative block lifetime later, so they outlive the manifest. The lifetime is **not** a guarantee of a full interval after upload completion.

`expirationBlocks` uses the SDK's `ExpirationTime.fromBlocks`. Blocks are not a reliable clock: no duration in seconds, hours or days is promised. Returned `expiresAt` comes from querying the entity, not the SDK write receipt's estimate. The minimum block budget is a conservative admission rule, not a completion guarantee. Slow wallet approval, block advancement or a stalled provider can still exhaust the lifetime. Liveness checks stop subsequent writes with `UPLOAD_FAILED` (cause `INCOMPLETE_UPLOAD`), but cannot cancel a signature or transaction already in flight. Choose enough blocks for the upload and intended retrieval window; automatic lifetime extension is outside scope.

The reader scopes chunks by manifest reference **and manifest owner/creator**, validates exact indexes and lengths, rejects duplicates, and verifies SHA-256. A hash proves integrity against that manifest, not publisher identity. The owner can change the manifest; supply an independently trusted `expectedSha256` when you need a pinned file. Ownership transfer and extending a subset of entities are not supported workflows.

There is no whole-file atomicity, automatic retry/resume, deduplication, cleanup, encryption, compression, access control or storage service. The package never deletes entities. If a write fails, confirmed parts remain and incur testnet costs. A timeout may follow a successful transaction; `transactionHashes` includes only confirmations observed by this call, not every transaction that might have landed. Inspect receipts and any returned manifest key before deciding to start another upload. Concurrent uploads from the same signing account require caller serialization to avoid nonce races.

The package never returns partial bytes on an error. Missing/expired manifest → `NOT_FOUND`; unfinished manifest → `INCOMPLETE_UPLOAD`; missing part → `MISSING_CHUNK`; duplicate/index/size problem → `INVALID_CHUNK`; invalid manifest → `INVALID_MANIFEST`; wrong bytes → `HASH_MISMATCH`. An expired snapshot cursor or provider error → `READ_FAILED`; start a new read from the manifest instead of reusing an old cursor.

## Troubleshooting

| Error / symptom | Action |
|---|---|
| npm E404 for this release candidate | Publication has not been verified yet. Use the explicit local verification procedure below; do not advertise a published artifact. |
| `NETWORK_MISMATCH` | Configure Tiramisu on both clients and switch your browser wallet to chain 7738577. Verify the RPC's `eth_chainId`. |
| `UPLOAD_FAILED` / wallet rejection | Inspect `manifestKey` and confirmed hashes. Rejection does not roll back earlier chunks. Keep provider details local. If the manifest expired or has too few blocks left, inspect confirmed writes before choosing a larger block budget for a new upload. |
| Insufficient gas balance | Claim test GLM for the signing address on Tiramisu, then check its balance. |
| RPC 401/403 or 429 | Check your network-specific access key or provider quota; avoid automatic write retries. |
| `NOT_FOUND` | Verify key/network and Entity Expiration. No fallback network is selected automatically. |
| `INCOMPLETE_UPLOAD`, `MISSING_CHUNK` | Inspect original upload receipts and expiration; the tool refuses reconstruction. A new upload is a new set of entities. |
| `INVALID_MANIFEST`, `INVALID_CHUNK`, `HASH_MISMATCH` | Treat the file as invalid. Do not bypass validation or offer a partial download. |
| `crypto.subtle` unavailable | Use Node 22.10+ or an HTTPS/localhost browser context. |
| `require()` import failure | Use ESM `import`; CommonJS is not a supported export. |

## Sample, agents and development

- [Sample app and clean checkout commands](https://github.com/SantiagoDevRel/arkiv-chunking/tree/feat/file-chunking/sample): wallet-signed upload, retrieve, byte comparison, and downloadable result. It pins the npm release and does not duplicate the package implementation.
- [Consumer agent guide](AGENTS.md) and [sample agent guide](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/sample/AGENTS.md). Give these files or links explicitly to your agent; do not assume it reads instructions in `node_modules`.
- [Verification evidence](docs/verification.md): distinguishes simulated RPC tests, local tarball consumers and actual network checks.

For a source checkout, then Node 22.22.3 and npm:

```sh
git clone --branch feat/file-chunking https://github.com/SantiagoDevRel/arkiv-chunking.git
cd arkiv-chunking
npm ci
npm test
npm run typecheck
npm pack --pack-destination /absolute/path/to/output
```

To verify an unpublished candidate in a clean consumer, use the same consumer setup above but replace `arkiv-chunking@0.1.0` with the absolute `.tgz` path produced by `npm pack`. Run `example.mjs`. This proves the packed artifact, **not** registry publication. The sample release dependency must remain the exact published version; local tarball testing does not satisfy its final release gate.

Optional real write verification from the source checkout:

```sh
node --env-file=/absolute/path/to/your-secret.env scripts/live-smoke.mjs
```

This deliberately spends test GLM to upload only synthetic public data (270,000-byte text, an empty file, and a maximum-chunk boundary case). It compares actual recovered bytes and independent Node SHA-256, checks receipts and prints manifest keys and transaction evidence. Do not run with a wallet whose use has not been authorized.

For the reproducible browser integration check, first start the sample using its README in a separate terminal. Then, from the repository root:

```sh
npx playwright install chromium
npm run test:browser
```

This is a separate required sample verification command; `npm test` runs only the library and SDK transport tests. The browser check uses the real package and SDK with an in-memory RPC and an injected test wallet. It performs upload/retrieval and reads back the browser's downloaded attachment, tests corrupt data and rejected/changed wallets, and captures successful layouts at 390/768/1440 pixels. No live transactions are sent. Screenshots and JSON evidence go to the operating-system temporary directory (`arkiv-chunking-browser`); `ARTIFACTS_DIR` overrides that path. `SAMPLE_URL` overrides localhost:3076. With a locally installed Chrome, `BROWSER_CHANNEL=chrome` selects it instead of the Playwright browser download.

Design provenance: the existing Arkiv cookbook file-manifest/key-reference recipe and the Sourcify POC's checksum-verified chunk lane. This package completes that model with typed SDK 0.8 operations, complete-state gating, snapshot pagination and bounded validation. It does not change the Hub or add a `/tools` entry in this delivery.

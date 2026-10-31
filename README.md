# arkiv-chunking

Split a file into queryable Arkiv entities on the Web3 database, then recover exactly its original bytes. Indexed manifest references and sequence columns connect each file to its binary chunks. Every download checks chunk indexes, byte lengths and SHA-256 before returning anything.

**arkiv-chunking 1.1.2 · SDK 1.0.0 · Rabdi DB-Chain testnet (7794095).** See [verification](docs/verification.md) and [changes](CHANGELOG.md).

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
npm install /absolute/path/to/arkiv-chunking-1.1.2.tgz @arkiv-network/sdk@1.0.0 viem@2.56.3
```

For a registry consumer, install `npm install --save-exact arkiv-chunking@1.1.2 @arkiv-network/sdk@1.0.0 viem@2.56.3`.

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
const walletClient = createWalletClient({
  chain, transport: transport(), account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY),
});
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

`uploadFile` owns the per-write transaction policy, including in the sample and scripts. It uses a signing-disabled SDK client to capture the unsigned request, estimates it at `latest`, and stops before signing if estimation fails. Gas is `max(1_000_000, 2 * estimate)`, with a fresh `latest` nonce and network `gasPrice` passed explicitly to every SDK write. It rejects a budget above the latest block gas limit and checks every authoritative receipt. A measured 100,000-byte chunk consumed 4,904,531 gas; the floor alone is insufficient for large chunks.

Optional `txParams(context)` runs for each write with `{phase, chunkIndex?, attempt, estimate, defaults}`. Return a partial override, for example `txParams: ({defaults}) => ({gas: defaults.gas + 100_000n})`. Gas must retain the minimum headroom; gasPrice must be positive; nonce must match the fresh latest nonce. Policy reads use the wallet's configured RPC. Serialize uploads from one account and disable transport retries as shown above.

A confirmed gas-exhausted revert may be retried once with fresh parameters and at least twice the previous gas. A semantic revert, rejected signature, missing receipt, uncertain submission or successful receipt never authorizes a retry. Confirmed hashes, including reverted attempts, are preserved.

When the SDK returns success, its hash and newly created manifest/chunk keys are saved before any receipt recheck. If that RPC lags, the library polls by hash at the current head up to five times, one second apart; transport timeouts still apply. A delayed receipt permits normal completion. If the recheck remains unavailable, uploadFile throws a typed `ChunkingError` with code `CONFIRMATION_PENDING`, preserving all SDK-success hashes, manifestKey and chunkKeys. It sends no further writes and never resends the successful operation. A hash found only in an SDK error still requires an authoritative receipt before it is treated as confirmed. If that lookup throws or is unavailable, writeWithPolicy throws WriteConfirmationPendingError with the exact txHash; uploadFile exposes it as ChunkingError.txHash with code CONFIRMATION_PENDING. Unverified hashes never enter confirmed transactionHashes, and unavailable entity keys are not invented. Use read-only inspection; never resend automatically.

## Public API

Import only from `arkiv-chunking`; types ship with the package.

| Export | Contract |
|---|---|
| `splitFile(bytes, {chunkSize?})` | Copies input into ordered Uint8Array chunks. An empty file has one empty chunk. |
| `hashFile(bytes)` | Promise of a 32-byte SHA-256 hex string. |
| `reconstructFile(orderedChunks, expectedSha256)` | Verified bytes, or an error. Caller supplies order. No RPC. |
| `uploadFile(options)` | Requires publicClient, walletClient, bytes, filename, expirationBlocks; optional contentType, chunkSize, onProgress, per-write txParams callback. Resolves only after a successful finalization receipt. |
| `downloadFile(options)` | Requires publicClient and manifestKey; optional trusted expectedSha256 and onProgress. No wallet needed. |
| `ManifestSchema`, `ChunkSchema` | SDK 1.0 schemas for reads and integrations. Do not independently mutate a stored file. |
| `ChunkingError` | code, optional manifestKey, confirmed transactionHashes, preserved chunkKeys, optional unresolved txHash and a local-only cause. CONFIRMATION_PENDING preserves an unresolved submitted txHash, including a hash from an SDK error. Never expose raw provider causes publicly. |
| `writeWithPolicy(wallet, context, plan, send, confirmedHashes, policy?, onSdkSuccess?)` | Shared SDK 1.0 write policy, exported from the root since 1.1.0. Captures an unsigned request, estimates at latest, supplies explicit gas/gasPrice/latest nonce, checks receipts and preserves hashes before rechecks. plan uses its supplied unsigned client; send uses the real wallet and supplied parameters. |
| `WriteConfirmationPendingError` | Root-exported Error class with readonly txHash and a local-only cause. The SDK returned success or threw with a txHash, and receipt confirmation remains unresolved. Preserve txHash; never resend. SDK-success rechecks are bounded; an error-only hash needs an authoritative receipt before entering confirmedHashes. |
| `VERSION`, `DEFAULT_CHUNK_BYTES`, `MAX_CHUNK_BYTES`, `MAX_FILE_BYTES`, `MAX_CHUNKS` | Package version and enforced limits. |
| `RABDI_MAX_LIFETIME_BLOCKS`, `EXPIRATION_INCLUSION_MARGIN_BLOCKS`, `MAX_EXPIRATION_BLOCKS`, `MIN_TRANSACTION_GAS` | Network maximum 7,884,000; inclusion margin 30; admitted maximum 7,883,970; transaction gas floor 1,000,000n. |
| `WriteTransactionParameters`, `WriteTransactionContext`, `TransactionParameterPolicy` | Public per-write override contracts. |
| `UploadOptions`, `UploadResult`, `DownloadOptions`, `DownloadResult`, `Progress`, `ChunkingErrorCode`, `ChunkingPublicClient`, `ChunkingWalletClient` | Public TypeScript types. |

UploadResult contains manifestKey, sha256, chunkCount, totalBytes, expiresAt (bigint block) and confirmed transactionHashes. DownloadResult contains bytes, filename, contentType, sha256, chunkCount and expiresAt. Progress is {phase, completed, total, manifestKey?}; phases are manifest, chunks and finalize. Callback failures are ignored, and async callbacks are not awaited. Only the operation's resolved promise means success.

### Reuse the public write policy

Other libraries can import the same policy from the package root; no private subpath is needed. With a configured Rabdi walletClient from the example above, this helper creates a standalone binary entity. It does not mutate a stored file. Prepare the schema, values, absolute expiration and salt once; both callbacks must use the identical inputs. The plan's explicit parameters only capture unsigned encoding and cannot sign or reach a send RPC. The real send receives fresh explicit gas, gasPrice and latest nonce from the shared policy.

```js
import {ExpirationTime, randomSalt} from '@arkiv-network/sdk';
import {bytes, defineSchema} from '@arkiv-network/sdk/schema';
import {writeWithPolicy, WriteConfirmationPendingError, MIN_TRANSACTION_GAS} from 'arkiv-chunking';

const BinarySchema = defineSchema('example.binary.v1', {data: bytes()});
const binaryOperations = new Map(); // Outside the UI component; keep across renders/clicks.
async function storeBinary(operationId, walletClient, data) {
  if (typeof operationId !== 'string' || !operationId) throw new Error('Provide a stable operation id.');
  if (binaryOperations.has(operationId)) return binaryOperations.get(operationId);
  const operation = {state: 'sending', attempts: 0, transactionHashes: []};
  binaryOperations.set(operationId, operation); // Guard BEFORE the first RPC.
  try {
    if (walletClient.chain?.id !== 7794095) throw new Error('Configure Rabdi first.');
    const head = await walletClient.transport.request({method: 'eth_blockNumber'});
    const values = {data};
    const options = {expiration: ExpirationTime.atBlock(BigInt(head) + 3600n), salt: randomSalt()};
    await writeWithPolicy(walletClient, {phase: 'chunks', chunkIndex: 0},
      unsigned => unsigned.createEntity(BinarySchema, values, options,
        {gas: MIN_TRANSACTION_GAS, gasPrice: 1n, nonce: 0}),
      async txParams => {
        operation.state = 'sending'; operation.attempts++;
        try { return await walletClient.createEntity(BinarySchema, values, options, txParams); }
        catch (error) {
          operation.state = 'uncertain';
          for (let cause = error, depth = 0; cause && depth < 8; cause = cause.cause, depth++) {
            if (/^0x[0-9a-fA-F]{64}$/.test(cause.txHash)) { operation.txHash = cause.txHash; break; }
          }
          throw error; // Only the shared policy may authorize a confirmed gas-revert retry.
        }
      }, operation.transactionHashes, async ({defaults}) => {
        const gas = defaults.gas + 100_000n;
        const head = await walletClient.transport.request({method: 'eth_getBlockByNumber', params: ['latest', false]});
        if (gas > BigInt(head.gasLimit) / 2n) {
          operation.reason = 'gas-cap'; throw new Error('Budget exceeds half the latest block gas limit.');
        }
        return {gas};
      }, result => Object.assign(operation, {state: 'submitted', txHash: result.txHash, entityKey: result.entityKey}));
    operation.state = 'confirmed';
  } catch (error) {
    if (error instanceof WriteConfirmationPendingError) {
      operation.txHash = error.txHash; operation.confirmation = 'pending';
    }
    if (operation.state !== 'submitted') {
      operation.state = operation.attempts ? 'uncertain' : 'terminal';
      const hash = operation.transactionHashes.at(-1);
      if (hash && operation.transactionHashes.length === operation.attempts) {
        try {
          const receipt = await walletClient.transport.request({method: 'eth_getTransactionReceipt', params: [hash]});
          if (receipt?.transactionHash === hash && receipt.blockHash && receipt.status === '0x0') operation.state = 'terminal';
        } catch { /* Remain uncertain; never authorize another send. */ }
      }
    }
    operation.message = 'Check the saved transaction hashes before any new operation; do not resend this one.';
  }
  return operation; // Keep the record, including terminal/uncertain outcomes.
}
```

Use the same operationId for repeated clicks on one user intent; never generate a fresh id just to retry. Keep binaryOperations outside UI component state and restore saved entries before enabling writes after a reload. Repeated calls return the existing record without any RPC. SDK success sets submitted with its hash/key before the receipt recheck; missing or disagreeing receipts retain that state with confirmation pending. An uncertain send remains blocked, while a confirmed revert is terminal after the shared policy's at-most-one gas-exhaustion retry. Each budget must fit within half the latest block gas limit. No record is cleared automatically, so there are at most two sends per operation ever. Inspect hashes with reads only and serialize operations from one account. The unchanged headroom and transport rules above still apply.

## Storage format and Entity Expiration

Format v2 uses named SDK schemas:

| Schema | Indexed columns | Stored columns |
|---|---|---|
| Manifest | type, complete, sha256, arkiv.schema | totalbytes, chunkcount, chunksize, metadata (bytes) |
| Chunk | type, manifest (key), seq (u64), arkiv.schema | data (bytes, never indexed) |

Metadata is UTF-8 JSON with filename and contentType; a filename can be 255 UTF-8 bytes, without fitting it into an SDK str column. The digest is a 66-character str. Chunk bytes are selected as `data.value` (hex in SDK 1.0).

Upload creates an incomplete manifest, writes immutable chunks sequentially, then patches complete to true. There are N+2 successful writes; a confirmed gas-exhausted revert can add one attempt per write. Manifest and chunks share one absolute expiration block, computed from the initial chain head and the requested lifetime. Before every chunk and finalization, a read checks that the manifest has enough blocks remaining. One failed liveness read receives one read-only retry.

Rabdi rejects a target more than 7,884,000 blocks after the current block with `ExpiryBeyondMaxLifetime`. The package admits at most 7,883,970 blocks, reserving 30 blocks of inclusion margin; the date picker uses the same exported bound. There is no permanent/no-expiration option. Longer-lived files need coordinated Lifetime Extension; this package does not implement it, and extending only a subset of the file is unsupported.

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
| Entity Expiration | Whole blocks, min max(32, chunkCount+3), max 7,883,970 (7,884,000 network maximum less 30 inclusion blocks) |
| Query page | At most 100 entities; smaller binary pages keep responses around 2 MB |

Blocks are not a reliable clock, and wallet delays consume the selected lifetime. A queried expiresAt is authoritative at that read; the upload returns the pre-finalization check. A lagging receipt recheck after SDK-successful finalization is reported as CONFIRMATION_PENDING with all hashes and keys, rather than a plain upload failure. Verify it through read-only requests; do not resend finalization.

If upload fails, retain error.manifestKey and error.transactionHashes. Inspect their receipts and the complete column before deciding to create another file. Confirmed parts remain; an ambiguous timeout may follow a transaction that landed but whose confirmation was not observed. Do not automatically repeat a write or independently patch the manifest to complete. Recovery means inspecting preserved evidence and retrying only a read of a finalized file. There is no automatic upload resume, rollback, cleanup, encryption or read authorization.

| Error | Action |
|---|---|
| NETWORK_MISMATCH | Match Rabdi chain 7794095 across the clients, wallet and RPC. |
| MissingAccessKeyError, HTTP 401/403/429 | Configure an access key from the Hub; check its provider quota. |
| -32603, "arkiv serves state at the chain head only" | Use `latest` for state reads and unsigned gas estimation. `safe`, `finalized` and old block hashes are unsupported for these calls. Stop before signing when estimation fails. |
| Reverted receipt with gasUsed == gasLimit | The gas budget was exhausted. Use an unsigned `latest` estimate and explicit gas=max(1,000,000, 2*estimate), gasPrice and latest nonce. The library permits one confirmed gas-exhaustion retry with increased gas; never retry a successful or uncertain write. |
| ExpiryBeyondMaxLifetime | Use at most MAX_EXPIRATION_BLOCKS and a coordinated file deadline; longer storage requires Lifetime Extension outside this API. |
| UPLOAD_FAILED | Preserve manifest and confirmed hashes; inspect receipts before another upload. |
| CONFIRMATION_PENDING | The SDK reported success, but a bounded receipt recheck is pending. Preserve manifestKey, chunkKeys and transactionHashes. Inspect receipts and the manifest with reads only; never resend automatically. |
| NOT_FOUND | Check manifest key, network and Entity Expiration. |
| INCOMPLETE_UPLOAD, MISSING_CHUNK | Inspect upload receipts; reconstruction refuses partial bytes. |
| INVALID_MANIFEST, INVALID_CHUNK, HASH_MISMATCH | Reject the file. Never bypass validation. |
| READ_FAILED | Retry a complete read from the manifest; do not re-upload. |

## Sample and verification

The [sample guide](sample/README.md) covers browser-wallet storage, read-only public samples and the bounded server read proxy. The sample pins exact registry 1.1.2 independently of this 1.1.2 library. Tarball verification uses an isolated consumer and preserves that sample pin.

```sh
npm test
npm run typecheck
npm run lint
node scripts/verify.mjs
```

verify.mjs installs the locked existing toolchain, checks the package, packs it, runs test/packed-consumer.mjs against fresh ESM and TypeScript consumers (including the public write policy), and builds a temporary sample against that tarball. It expects TMPDIR (as supplied by the DGX job runner). It never publishes or changes the sample's release dependency.

The explicit synthetic Rabdi seed is `node scripts/seed-rabdi.mjs`, with ARKIV_ACCESS_KEY_A and TEST_CHUNKING_PRIVATE_KEY configured locally. It queries by digest and owner, reuses a byte-verified complete file, refuses ambiguous incomplete seeds, and writes sample/public/sample.json. Run it again to prove writes: 0. `--verify-only` performs no writes. These are dedicated test credentials, never a server signer.

Read [AGENTS.md](AGENTS.md) explicitly when integrating, and include [CLAUDE.md](CLAUDE.md) for Claude consumers. Dated historical evidence stays in docs; [verification procedures](docs/verification.md) distinguish archive checks, controlled transports and historical live observations.


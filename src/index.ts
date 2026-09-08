import { ExpirationTime, type PublicArkivClient, type WalletArkivClient } from '@arkiv-network/sdk';
import { bool, bytes32, key, str, u64 } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import type { Hex } from 'viem';

export const VERSION = '0.1.0';
export const DEFAULT_CHUNK_BYTES = 100_000;
/** Package policy, not a claim about every Arkiv node. Leaves room for transaction framing. */
export const MAX_CHUNK_BYTES = 120_000;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_CHUNKS = 4096;
const MANIFEST_TYPE = 'arkiv-chunking/manifest/v1';
const CHUNK_TYPE = 'arkiv-chunking/chunk/v1';
const encoder = new TextEncoder();

export type ChunkingErrorCode = 'INVALID_INPUT' | 'NETWORK_MISMATCH' | 'NOT_FOUND' | 'INCOMPLETE_UPLOAD' | 'INVALID_MANIFEST' | 'MISSING_CHUNK' | 'INVALID_CHUNK' | 'HASH_MISMATCH' | 'UPLOAD_FAILED' | 'READ_FAILED';

/** Never interpret a failed upload as rolled back. Confirmed entities remain on the network. */
export class ChunkingError extends Error {
  readonly code: ChunkingErrorCode;
  readonly manifestKey?: Hex;
  readonly transactionHashes: readonly Hex[];
  constructor(code: ChunkingErrorCode, message: string, options: { cause?: unknown; manifestKey?: Hex; transactionHashes?: readonly Hex[] } = {}) {
    super(message, { cause: options.cause });
    this.name = 'ChunkingError';
    this.code = code;
    this.manifestKey = options.manifestKey;
    this.transactionHashes = [...(options.transactionHashes ?? [])];
  }
}

export type ChunkingPublicClient = Pick<PublicArkivClient, 'chain' | 'getChainId' | 'select'>;
export type ChunkingWalletClient = Pick<WalletArkivClient, 'chain' | 'account' | 'transport' | 'createEntity' | 'patchEntity'>;
export interface Progress { phase: 'manifest' | 'chunks' | 'finalize'; completed: number; total: number; manifestKey?: Hex }
export interface UploadOptions {
  publicClient: ChunkingPublicClient;
  walletClient: ChunkingWalletClient;
  bytes: Uint8Array;
  filename: string;
  contentType?: string;
  /** Explicit block lifetime. At least max(32, chunkCount + 3); not wall-clock time. */
  expirationBlocks: number;
  chunkSize?: number;
  onProgress?: (progress: Progress) => void | Promise<void>;
}
export interface UploadResult { manifestKey: Hex; sha256: Hex; chunkCount: number; totalBytes: number; expiresAt: bigint; transactionHashes: Hex[] }
export interface DownloadOptions {
  publicClient: ChunkingPublicClient;
  manifestKey: Hex;
  /** Pin an independently trusted digest when authenticity matters. */
  expectedSha256?: Hex;
  onProgress?: (progress: Progress) => void | Promise<void>;
}
export interface DownloadResult { bytes: Uint8Array; filename: string; contentType: string; sha256: Hex; chunkCount: number; expiresAt: bigint }

function fail(code: ChunkingErrorCode, message: string): never { throw new ChunkingError(code, message); }
function isHex32(value: unknown): value is Hex { return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value); }
function requireBytes(bytes: Uint8Array): void {
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_FILE_BYTES) fail('INVALID_INPUT', `Expected Uint8Array of at most ${MAX_FILE_BYTES} bytes.`);
}
function requireChunkSize(size: number, byteLength: number): void {
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_CHUNK_BYTES || Math.max(1, Math.ceil(byteLength / size)) > MAX_CHUNKS) {
    fail('INVALID_INPUT', `Chunk size must be 1..${MAX_CHUNK_BYTES}, producing at most ${MAX_CHUNKS} chunks.`);
  }
}
function requireMetadata(filename: unknown, contentType: unknown, code: ChunkingErrorCode): asserts filename is string {
  if (typeof filename !== 'string' || !filename || encoder.encode(filename).length > 255 || /[\x00-\x1f\x7f/\\]/.test(filename) || filename === '.' || filename === '..') fail(code, 'Filename must be a basename of 1..255 UTF-8 bytes, without control characters.');
  if (typeof contentType !== 'string' || !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(contentType) || encoder.encode(contentType).length > 128) fail(code, 'Content type must be a MIME type without parameters, at most 128 bytes.');
}

/** Copies the input into ordered chunks. An empty file has one empty chunk. No RPC. */
export function splitFile(bytes: Uint8Array, { chunkSize = DEFAULT_CHUNK_BYTES }: { chunkSize?: number } = {}): Uint8Array[] {
  requireBytes(bytes);
  requireChunkSize(chunkSize, bytes.length);
  if (bytes.length === 0) return [new Uint8Array()];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) chunks.push(new Uint8Array(bytes.subarray(offset, offset + chunkSize)));
  return chunks;
}

/** SHA-256 over bytes, in Node 22+ or a browser secure context. No RPC. */
export async function hashFile(bytes: Uint8Array): Promise<Hex> {
  requireBytes(bytes);
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return `0x${Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Reconstruct already ordered bytes and reject any digest mismatch. No partial result. */
export async function reconstructFile(chunks: readonly Uint8Array[], expectedSha256: Hex): Promise<Uint8Array> {
  if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > MAX_CHUNKS || !isHex32(expectedSha256)) fail('INVALID_INPUT', 'Provide 1..4096 ordered chunks and a 32-byte expected SHA-256.');
  let length = 0;
  for (const chunk of chunks) {
    requireBytes(chunk);
    length += chunk.length;
    if (length > MAX_FILE_BYTES) fail('INVALID_INPUT', 'Reconstructed file exceeds the package size limit.');
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if (await hashFile(bytes) !== expectedSha256.toLowerCase()) fail('HASH_MISMATCH', 'Reconstructed bytes do not match the expected SHA-256.');
  return bytes;
}

// A UI callback must not convert a successful network write into an apparent failure.
function notify(callback: UploadOptions['onProgress'], progress: Progress): void {
  try { void Promise.resolve(callback?.(progress)).catch(() => {}); } catch { /* Observational only. */ }
}
async function checkNetwork(client: ChunkingPublicClient): Promise<number> {
  if (!client.chain?.testnet) fail('NETWORK_MISMATCH', 'Configure an explicit testnet chain.');
  const chainId = await client.getChainId();
  if (chainId !== client.chain.id) fail('NETWORK_MISMATCH', 'RPC chain ID differs from the configured testnet.');
  return chainId;
}

async function requireLiveManifest(client: ChunkingPublicClient, manifestKey: Hex, transactionsRemaining: number): Promise<bigint> {
  const page = await client.select({ expiresAt: true }).where(eq('$key', key(manifestKey))).limit(1).fetch();
  const manifest = page.entities[0];
  if (!manifest || manifest.expiresAt <= page.blockNumber + BigInt(transactionsRemaining)) {
    fail('INCOMPLETE_UPLOAD', 'The manifest has expired or has too few remaining blocks to finish. No further writes will be started.');
  }
  return manifest.expiresAt;
}

/** Writes a manifest, sequential chunks, then marks the manifest complete. N+2 transactions. */
export async function uploadFile(options: UploadOptions): Promise<UploadResult> {
  const { publicClient, walletClient, filename, expirationBlocks, onProgress } = options;
  const contentType = options.contentType ?? 'application/octet-stream';
  requireMetadata(filename, contentType, 'INVALID_INPUT');
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_BYTES;
  requireBytes(options.bytes);
  requireChunkSize(chunkSize, options.bytes.length);
  // Snapshot before the first await: caller mutations cannot change what is signed.
  const bytes = new Uint8Array(options.bytes);
  const chunks = splitFile(bytes, { chunkSize });
  const minimumBlocks = Math.max(32, chunks.length + 3);
  if (!Number.isSafeInteger(expirationBlocks) || expirationBlocks < minimumBlocks || expirationBlocks > 15_768_000) fail('INVALID_INPUT', `Expiration must be ${minimumBlocks}..15768000 whole blocks for this upload. Blocks are not wall-clock time.`);
  if (!walletClient.account || !walletClient.chain?.testnet || walletClient.chain.id !== publicClient.chain?.id) fail('NETWORK_MISMATCH', 'A wallet account and matching explicit testnet clients are required.');
  const transactionHashes: Hex[] = [];
  let manifestKey: Hex | undefined;
  try {
    const chainId = await checkNetwork(publicClient);
    const walletChainId = await walletClient.transport.request({ method: 'eth_chainId' });
    if (typeof walletChainId !== 'string' || !/^0x[0-9a-f]+$/i.test(walletChainId) || Number(BigInt(walletChainId)) !== chainId) fail('NETWORK_MISMATCH', 'Wallet is connected to a different network.');
    const sha256 = await hashFile(bytes);
    const expires = ExpirationTime.fromBlocks(expirationBlocks);
    notify(onProgress, { phase: 'manifest', completed: 0, total: chunks.length });
    const manifest = await walletClient.createEntity({
      payload: encoder.encode(JSON.stringify({ filename, contentType })), contentType: 'application/json', expires,
      attributes: { type: str(MANIFEST_TYPE), complete: bool(false), sha256: bytes32(sha256), totalbytes: u64(bytes.length), chunkcount: u64(chunks.length), chunksize: u64(chunkSize) },
    });
    manifestKey = manifest.entityKey;
    transactionHashes.push(manifest.txHash);
    for (const [seq, payload] of chunks.entries()) {
      await requireLiveManifest(publicClient, manifestKey, chunks.length - seq + 1);
      notify(onProgress, { phase: 'chunks', completed: seq, total: chunks.length, manifestKey });
      const result = await walletClient.createEntity({
        payload, contentType: 'application/octet-stream',
        // Chunks created later with the same duration outlive the manifest.
        expires, flags: { readonly: true },
        attributes: { type: str(CHUNK_TYPE), manifest: key(manifestKey), seq: u64(seq) },
      });
      transactionHashes.push(result.txHash);
    }
    await requireLiveManifest(publicClient, manifestKey, 1);
    notify(onProgress, { phase: 'finalize', completed: chunks.length, total: chunks.length, manifestKey });
    const finalized = await walletClient.patchEntity({ entityKey: manifestKey, set: { complete: bool(true) } });
    transactionHashes.push(finalized.txHash);
    const expiresAt = await requireLiveManifest(publicClient, manifestKey, 0);
    return { manifestKey, sha256, chunkCount: chunks.length, totalBytes: bytes.length, expiresAt, transactionHashes };
  } catch (cause) {
    if (cause instanceof ChunkingError && !manifestKey) throw cause;
    throw new ChunkingError('UPLOAD_FAILED', 'Upload failed. Confirmed writes remain; do not automatically retry an ambiguous transaction. Inspect the manifest and transaction receipts before starting a new upload.', { cause, manifestKey, transactionHashes });
  }
}

function attribute(attributes: Record<string, unknown>, name: string, type: string, code: ChunkingErrorCode): unknown {
  const value = attributes[name];
  if (!value || typeof value !== 'object' || !('type' in value) || value.type !== type || !('value' in value)) fail(code, `Missing or incorrectly typed ${name} attribute; expected ${type}.`);
  return value.value;
}
function integerAttribute(attributes: Record<string, unknown>, name: string, max: number, code: ChunkingErrorCode): number {
  const value = attribute(attributes, name, 'u64', code);
  if (typeof value !== 'bigint' || value < 0n || value > BigInt(max)) fail(code, `Invalid ${name}.`);
  return Number(value);
}

/** Reads manifest and all pages at the same block, validates all parts, then returns bytes. */
export async function downloadFile({ publicClient, manifestKey, expectedSha256, onProgress }: DownloadOptions): Promise<DownloadResult> {
  if (!isHex32(manifestKey) || (expectedSha256 !== undefined && !isHex32(expectedSha256))) fail('INVALID_INPUT', 'Manifest key and optional expected SHA-256 must be 32-byte hex strings.');
  try {
    await checkNetwork(publicClient);
    const page = await publicClient.select({ owner: true, creator: true, expiresAt: true, payload: true, attributes: { type: true, complete: true, sha256: true, totalbytes: true, chunkcount: true, chunksize: true } })
      .where(eq('$key', key(manifestKey))).limit(1).fetch();
    const manifest = page.entities[0];
    if (!manifest) fail('NOT_FOUND', 'No live manifest found. Check network and key; the entity may have expired.');
    const a = manifest.attributes;
    if (attribute(a, 'type', 'str', 'INVALID_MANIFEST') !== MANIFEST_TYPE) fail('INVALID_MANIFEST', 'Entity is not an arkiv-chunking v1 manifest.');
    const complete = attribute(a, 'complete', 'bool', 'INVALID_MANIFEST');
    if (complete !== true) fail('INCOMPLETE_UPLOAD', 'The upload was not finalized. No partial bytes are returned.');
    const totalBytes = integerAttribute(a, 'totalbytes', MAX_FILE_BYTES, 'INVALID_MANIFEST');
    const count = integerAttribute(a, 'chunkcount', MAX_CHUNKS, 'INVALID_MANIFEST');
    const chunkSize = integerAttribute(a, 'chunksize', MAX_CHUNK_BYTES, 'INVALID_MANIFEST');
    if (chunkSize < 1 || count !== Math.max(1, Math.ceil(totalBytes / chunkSize))) fail('INVALID_MANIFEST', 'Inconsistent file size, chunk size, or count.');
    const digest = attribute(a, 'sha256', 'bytes32', 'INVALID_MANIFEST');
    if (!isHex32(digest)) fail('INVALID_MANIFEST', 'Manifest SHA-256 is invalid.');
    if (expectedSha256 && digest.toLowerCase() !== expectedSha256.toLowerCase()) fail('HASH_MISMATCH', 'Manifest digest differs from the independently expected SHA-256.');
    if (manifest.payload.length > 2048) fail('INVALID_MANIFEST', 'Manifest metadata is too large.');
    let metadata: unknown;
    try { metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifest.payload)); } catch { fail('INVALID_MANIFEST', 'Manifest metadata is not UTF-8 JSON.'); }
    if (!metadata || typeof metadata !== 'object' || !('filename' in metadata) || !('contentType' in metadata)) fail('INVALID_MANIFEST', 'Manifest metadata is missing.');
    requireMetadata(metadata.filename, metadata.contentType, 'INVALID_MANIFEST');
    const filename = metadata.filename;
    const contentType = metadata.contentType as string;
    const chunks: Uint8Array[] = new Array(count);
    let received = 0;
    notify(onProgress, { phase: 'chunks', completed: 0, total: count, manifestKey });
    const query = publicClient.select({ payload: true, attributes: { seq: true } })
      .where(eq('type', str(CHUNK_TYPE)), eq('manifest', key(manifestKey)))
      .ownedBy(manifest.owner).createdBy(manifest.creator).atBlock(page.blockNumber).limit(200);
    for await (const chunk of query) {
      const seq = integerAttribute(chunk.attributes, 'seq', count - 1, 'INVALID_CHUNK');
      if (chunks[seq]) fail('INVALID_CHUNK', `Duplicate chunk index ${seq}.`);
      const expectedLength = seq === count - 1 ? totalBytes - seq * chunkSize : chunkSize;
      if (chunk.payload.length !== expectedLength) fail('INVALID_CHUNK', `Unexpected byte length for chunk ${seq}.`);
      chunks[seq] = chunk.payload;
      received++;
      notify(onProgress, { phase: 'chunks', completed: received, total: count, manifestKey });
    }
    if (received !== count) fail('MISSING_CHUNK', `Received ${received} of ${count} chunks; a part may be missing or expired.`);
    const bytes = await reconstructFile(chunks, digest);
    return { bytes, filename, contentType, sha256: digest.toLowerCase() as Hex, chunkCount: count, expiresAt: manifest.expiresAt };
  } catch (cause) {
    if (cause instanceof ChunkingError) throw cause;
    throw new ChunkingError('READ_FAILED', 'Retrieval failed. Check the RPC connection, access policy and rate limits. No partial bytes are returned.', { cause, manifestKey });
  }
}

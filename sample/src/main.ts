import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { custom, http, type EIP1193Provider, type Hex } from 'viem';
import { uploadFile, downloadFile, splitFile, ChunkingError, VERSION, DEFAULT_CHUNK_BYTES, MAX_FILE_BYTES } from 'arkiv-chunking';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing required element: ${id}`);
  return found as T;
}

const rpcInput = element<HTMLInputElement>('rpc');
const fileInput = element<HTMLInputElement>('file');
const manifestInput = element<HTMLInputElement>('manifest');
const saveLink = element<HTMLAnchorElement>('save');
let busy = false;
let downloadUrl: string | undefined;
let uploaded: { key: Hex; bytes: Uint8Array; sha256: Hex } | undefined;

rpcInput.value = tiramisu.rpcUrls.default.http[0];
element('version').textContent = `v${VERSION}`;

function status(target: 'upload' | 'download', message: string, state: 'idle' | 'loading' | 'success' | 'error') {
  const output = element(`${target}-status`);
  output.textContent = message;
  output.dataset.state = state;
}

function setBusy(value: boolean) {
  busy = value;
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button').forEach(control => { control.disabled = value; });
  element('upload-form').setAttribute('aria-busy', String(value));
  element('download-form').setAttribute('aria-busy', String(value));
}

function publicClient() {
  const value = rpcInput.value.trim();
  let url: URL;
  try { url = new URL(value); } catch { throw new UserError('Enter a valid RPC URL.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new UserError('Use an HTTPS RPC. HTTP is only allowed for localhost.');
  }
  if (url.username || url.password || url.hash) throw new UserError('Use an RPC URL without a username, password or fragment.');
  return createPublicClient({ chain: tiramisu, transport: http(value, { timeout: 30_000, retryCount: 1, fetchOptions: { cache: 'no-store' } }) });
}

class UserError extends Error {}

function errorMessage(error: unknown): string {
  if (error instanceof UserError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'You rejected the wallet request. You can try again.';
  if (error instanceof ChunkingError) {
    const messages: Record<string, string> = {
      INVALID_INPUT: 'Check the key, file and expiration before trying again.',
      NETWORK_MISMATCH: 'The RPC and wallet must use Tiramisu. Check both configurations.',
      INCOMPLETE_UPLOAD: 'The upload is incomplete. It cannot be reconstructed as a valid file.',
      HASH_MISMATCH: 'Verification detected different bytes. Download was not enabled.',
      INVALID_MANIFEST: 'The manifest format is not valid for this package.',
      INVALID_CHUNK: 'A chunk does not match the manifest. Download was not enabled.',
      MISSING_CHUNK: 'File chunks are missing. They may have expired or changed; download was not enabled.',
      NOT_FOUND: 'The manifest was not found. Check the key, network and expiration.',
      READ_FAILED: 'Reading failed. Check the RPC connection and its access key before trying again.',
      UPLOAD_FAILED: 'Upload failed. Confirmed transactions are not reversed. Check your wallet and its transactions before starting another upload.',
    };
    return messages[String(error.code)] ?? 'The package could not complete the operation. Check the network, chunk availability and testnet balance. Unverified files are not offered for download.';
  }
  // SDK errors may contain the RPC URL or request payload: never render/log them.
  return 'The operation could not be completed. Check the RPC connection and its access key, the wallet network and testnet GLM balance. Resolve any pending request in your wallet.';
}

function clearDownload() {
  element('download-result').hidden = true;
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  saveLink.removeAttribute('href');
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  fileInput.setCustomValidity('');
  if (!file) {
    element('file-info').textContent = 'Select a file to see how many chunks it needs.';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    fileInput.setCustomValidity(`The limit is ${MAX_FILE_BYTES.toLocaleString('en-US')} bytes.`);
  }
  const parts = Math.max(1, Math.ceil(file.size / DEFAULT_CHUNK_BYTES));
  element('file-info').textContent = `${file.name} · ${file.size.toLocaleString('en-US')} bytes · ${parts} ${parts === 1 ? 'chunk' : 'chunks'}. Limit: ${MAX_FILE_BYTES.toLocaleString('en-US')} bytes.`;
});

element<HTMLFormElement>('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const file = fileInput.files?.[0];
  if (!file || !element<HTMLInputElement>('consent').checked) return;
  setBusy(true);
  uploaded = undefined;
  element('upload-result').hidden = true;
  clearDownload();
  manifestInput.value = '';
  status('download', 'Retrieve a manifest to verify the file from this upload.', 'idle');
  let partialKey: Hex | undefined;
  let releaseWalletGuard: (() => void) | undefined;
  try {
    if (file.size > MAX_FILE_BYTES) throw new UserError(`The file exceeds the limit of ${MAX_FILE_BYTES.toLocaleString('en-US')} bytes.`);
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) throw new UserError('No wallet was found. Open the sample in a browser with an Ethereum-compatible wallet.');
    const client = publicClient();
    status('upload', 'Checking the network and requesting a wallet connection…', 'loading');
    const [rpcChain, walletChain] = await Promise.all([client.getChainId(), provider.request({ method: 'eth_chainId' })]);
    if (rpcChain !== tiramisu.id || Number(walletChain) !== tiramisu.id) {
      throw new UserError(`Configure the RPC and your wallet for Tiramisu (chain ID ${tiramisu.id}) and try again.`);
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const account = accounts[0];
    if (!account) throw new UserError('The wallet did not share an account. Authorize an account and try again.');
    let walletChanged = false;
    const markWalletChanged = () => { walletChanged = true; };
    provider.on?.('accountsChanged', markWalletChanged);
    provider.on?.('chainChanged', markWalletChanged);
    releaseWalletGuard = () => {
      provider.removeListener?.('accountsChanged', markWalletChanged);
      provider.removeListener?.('chainChanged', markWalletChanged);
    };
    const guardedProvider = {
      request: async (args: { method: string; params?: unknown }) => {
        if (['eth_sendTransaction', 'eth_signTransaction', 'eth_sendRawTransaction', 'wallet_sendCalls'].includes(args.method)) {
          const [currentAccounts, currentChain] = await Promise.all([
            provider.request({ method: 'eth_accounts' }),
            provider.request({ method: 'eth_chainId' }),
          ]);
          if (walletChanged || currentAccounts[0]?.toLowerCase() !== account.toLowerCase() || Number(currentChain) !== tiramisu.id) {
            throw new UserError('Your wallet account or network changed during upload. Check confirmed transactions before starting another upload.');
          }
        }
        const request = provider.request.bind(provider) as (args: { method: string; params?: unknown }) => Promise<unknown>;
        return request(args);
      },
    } as EIP1193Provider;
    const wallet = createWalletClient({ account, chain: tiramisu, transport: custom(guardedProvider, { retryCount: 0 }) });
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Delegate splitting to the package; no chunking implementation in this app.
    const chunks = splitFile(bytes);
    status('upload', `Preparing ${chunks.length} chunks. Confirm the transactions in your wallet.`, 'loading');
    const result = await uploadFile({
      publicClient: client,
      walletClient: wallet,
      bytes,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      expirationBlocks: Number(element<HTMLSelectElement>('expiration').value),
      onProgress: progress => {
        if (progress.manifestKey) partialKey = progress.manifestKey;
        const phase = { manifest: 'Creating manifest', chunks: 'Saving chunks', finalize: 'Finalizing manifest' }[progress.phase];
        status('upload', `${phase}: ${progress.completed}/${progress.total}. Confirm pending requests in your wallet.`, 'loading');
      },
    });
    uploaded = { key: result.manifestKey, bytes, sha256: result.sha256 };
    manifestInput.value = result.manifestKey;
    element('uploaded-key').textContent = result.manifestKey;
    element('upload-summary').textContent = `${result.totalBytes.toLocaleString('en-US')} bytes · ${result.chunkCount} chunks · ${result.transactionHashes.length} confirmed transactions. Expires at block ${result.expiresAt.toLocaleString('en-US')}.`;
    element('upload-result').hidden = false;
    status('upload', 'File stored. Retrieve it in the next step to verify its bytes.', 'success');
    status('download', 'The manifest is ready. Select Retrieve file to verify it.', 'success');
  } catch (error) {
    if (error instanceof ChunkingError && error.manifestKey) partialKey = error.manifestKey;
    status('upload', `${errorMessage(error)}${partialKey ? ' Keep the key and retrieve the manifest to check its status.' : ''}`, 'error');
    if (partialKey) {
      manifestInput.value = partialKey;
      element('uploaded-key').textContent = partialKey;
      element('upload-summary').textContent = 'Upload status is unconfirmed. Keep this key and check the transactions before uploading again.';
      element('upload-result').hidden = false;
    }
  } finally { releaseWalletGuard?.(); setBusy(false); }
});

element<HTMLFormElement>('download-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  setBusy(true);
  clearDownload();
  try {
    const key = manifestInput.value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new UserError('The manifest key must be 0x followed by 64 hexadecimal characters.');
    const client = publicClient();
    status('download', 'Querying the manifest and its chunks…', 'loading');
    if (await client.getChainId() !== tiramisu.id) throw new UserError('The RPC must use Tiramisu. Check the connection URL.');
    const original = uploaded?.key.toLowerCase() === key.toLowerCase() ? uploaded : undefined;
    const result = await downloadFile({
      publicClient: client,
      manifestKey: key as Hex,
      expectedSha256: original?.sha256,
      onProgress: progress => status('download', `Retrieving chunks: ${progress.completed}/${progress.total}.`, 'loading'),
    });
    if (original && (result.bytes.length !== original.bytes.length || result.bytes.some((byte, index) => byte !== original.bytes[index]))) {
      throw new UserError('The retrieved file does not match the original. Download was blocked.');
    }
    // Serve as an attachment with a neutral MIME type, never render uploaded content.
    downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/octet-stream' }));
    saveLink.href = downloadUrl;
    saveLink.download = result.filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_') || 'file';
    element('download-summary').textContent = `${result.filename} · ${result.bytes.length.toLocaleString('en-US')} bytes · ${result.chunkCount} reconstructed chunks. Expires at block ${result.expiresAt.toLocaleString('en-US')}.`;
    element('download-hash').textContent = result.sha256;
    element('download-result').hidden = false;
    status('download', original ? 'Verified: the bytes exactly match the file you uploaded.' : "Verified: the reconstructed file SHA-256 matches the manifest. This verifies file integrity, not the author's identity.", 'success');
  } catch (error) { status('download', errorMessage(error), 'error'); }
  finally { setBusy(false); }
});

window.addEventListener('pagehide', () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });

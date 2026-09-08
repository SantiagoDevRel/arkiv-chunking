import { createPublicClient, createWalletClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { custom, http, type EIP1193Provider, type Hex } from 'viem';
import { uploadFile, downloadFile, ChunkingError, VERSION, DEFAULT_CHUNK_BYTES, MAX_FILE_BYTES, type DownloadResult } from 'arkiv-chunking';
import { dateToBlocks, estimateExpirationDate, toLocalDateTimeInput } from './expiration';
import { inspectChunks } from './inspection';
import { initTheme } from './theme';
import './style.css';

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: ${id}`);
  return element as T;
}
const client = createPublicClient({ chain: tiramisu, transport: http(tiramisu.rpcUrls.default.http[0], { timeout: 30_000, retryCount: 1, fetchOptions: { cache: 'no-store' } }) });
const explorer = 'https://indexer.tiramisu.db-chain.testnet.arkiv.network';
const demoText = ('Hello from Arkiv!\nThis public sample file is split into queryable chunks, then reconstructed and verified.\n').repeat(1200).slice(0, 120001);
const demo = new File([demoText], 'arkiv-demo.txt', { type: 'text/plain' });
let selectedFile: File = demo;
let busy = false;
let mode: 'upload' | 'open' = 'upload';
let account: Hex | undefined;
let downloadUrl: string | undefined;
let currentKey: Hex | undefined;
let uploaded: { key: Hex; bytes: Uint8Array; sha256: Hex } | undefined;
let verifiedFile: DownloadResult | undefined;
const payloadUrls: string[] = [];
class UserError extends Error {}

function provider(): EIP1193Provider {
  const value = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!value) throw new UserError('No wallet found. Enable an Ethereum-compatible wallet to upload. You can still open an existing file.');
  return value;
}
function safeError(error: unknown): string {
  if (error instanceof UserError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Wallet request declined. No automatic retry will be made.';
  if (error instanceof ChunkingError) {
    const messages: Partial<Record<typeof error.code, string>> = {
      INVALID_INPUT: 'Check the file, manifest key and expiration date.',
      NETWORK_MISMATCH: 'Your wallet must use Tiramisu testnet.',
      INCOMPLETE_UPLOAD: 'This upload is incomplete. Its confirmed chunks remain on the network.',
      HASH_MISMATCH: 'The retrieved bytes failed integrity verification. Download is disabled.',
      INVALID_MANIFEST: 'This manifest is not valid for arkiv-chunking.',
      INVALID_CHUNK: 'A chunk is invalid. Download is disabled.',
      MISSING_CHUNK: 'Some chunks are missing or expired. Download is disabled.',
      NOT_FOUND: 'File not found. Check the manifest key or its expiration.',
      READ_FAILED: 'The network could not return the file. Try retrieving it again.',
      UPLOAD_FAILED: 'Upload could not be confirmed. Check your wallet transactions before starting again.',
    };
    return messages[error.code] ?? 'The file could not be verified.';
  }
  return 'The request could not be completed. Check your connection, wallet and Tiramisu testnet balance.';
}
function setBusy(value: boolean) {
  busy = value;
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button:not(#theme)').forEach(control => { control.disabled = value; });
  el('workspace').setAttribute('aria-busy', String(value));
}
function status(message: string, state: 'idle' | 'loading' | 'success' | 'error') {
  el('workflow-status').textContent = message;
  el('workflow-status').dataset.state = state;
  el('result-panel').dataset.state = state;
}
function clearInspection() {
  payloadUrls.splice(0).forEach(url => URL.revokeObjectURL(url));
  el('chunk-list').replaceChildren(); el('query-code').textContent = '';
  el('query-details').hidden = true; el<HTMLDetailsElement>('query-details').open = false;
  el('reassembly').hidden = true; el('retry-inspection').hidden = true;
  el('chunk-title').textContent = 'File chunks';
  el('inspection-status').textContent = 'Verify the file to inspect its chunks.';
  el('inspection-status').dataset.state = 'idle';
  el('copy-key').textContent = 'Copy file key';
  el('copy-query').textContent = 'Copy query';
}
function clearDownload() {
  if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  downloadUrl = undefined;
  el<HTMLAnchorElement>('save').removeAttribute('href');
  el('save').hidden = true;
}
function clearResult() {
  clearDownload(); clearInspection(); verifiedFile = undefined; currentKey = undefined;
  el('result-content').hidden = true;
  el('result-empty').hidden = false;
  el('retry').hidden = true;
  el<HTMLDetailsElement>('query-details').open = false;
  el('copy-query').textContent = 'Copy query';
}
function formatBytes(bytes: number): string { return bytes.toLocaleString('en-US') + ' bytes'; }
function updateFile() {
  el('selected-name').textContent = selectedFile.name;
  const chunks = Math.max(1, Math.ceil(selectedFile.size / DEFAULT_CHUNK_BYTES));
  el('selected-meta').textContent = `${formatBytes(selectedFile.size)} · ${chunks} ${chunks === 1 ? 'chunk' : 'chunks'}`;
  el('approval-note').textContent = `${chunks + 2} wallet approvals.`;
  el('chunk-approvals').textContent = `Store ${chunks} ${chunks === 1 ? 'chunk' : 'chunks'} — one approval each.`;
  el('file-kind').textContent = selectedFile === demo ? 'SAMPLE FILE' : 'YOUR FILE';
  el('demo').hidden = selectedFile === demo;
}

function showKey(key: Hex) {
  currentKey = key;
  el<HTMLInputElement>('manifest').value = key;
  el('result-empty').hidden = true;
  el('result-content').hidden = false;
  el<HTMLAnchorElement>('explorer').href = `${explorer}/entity/${key}`;
}
function updateWallet() {
  el('connect').textContent = account ? `${account.slice(0,6)}…${account.slice(-4)}` : 'Connect wallet';
  el('connect').title = account ?? 'Connect your testnet wallet';
}
async function connectWallet(): Promise<{ walletProvider: EIP1193Provider; address: Hex }> {
  const walletProvider = provider();
  const addresses = await walletProvider.request({ method: 'eth_requestAccounts' });
  const address = addresses[0];
  if (!address) throw new UserError('Select an account in your wallet to continue.');
  const chain = Number(await walletProvider.request({ method: 'eth_chainId' }));
  if (chain !== tiramisu.id) {
    // An explicit user action asks the wallet to switch; nothing changes on page load.
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${tiramisu.id.toString(16)}` }] });
  }
  if (Number(await walletProvider.request({ method: 'eth_chainId' })) !== tiramisu.id || await client.getChainId() !== tiramisu.id) throw new UserError('Choose Tiramisu testnet in your wallet to continue.');
  const current = await walletProvider.request({ method: 'eth_accounts' });
  if (current[0]?.toLowerCase() !== address.toLowerCase()) throw new UserError('The wallet account changed. Connect the intended test account again.');
  account = address; updateWallet();
  return { walletProvider, address };
}

async function verifyFile(key: Hex) {
  clearDownload(); clearInspection(); verifiedFile = undefined; el('retry').hidden = true; showKey(key); status('Retrieving chunks and checking every byte…', 'loading');
  if (mode === 'open' && matchMedia('(max-width: 700px)').matches) el('result-panel').scrollIntoView({behavior:'smooth',block:'start'});
  const original = uploaded?.key.toLowerCase() === key.toLowerCase() ? uploaded : undefined;
  el('result-title').textContent = original ? 'Stored. Verifying…' : 'Verifying file…';
  try {
    const result = await downloadFile({ publicClient: client, manifestKey: key, expectedSha256: original?.sha256 });
    if (original && (result.bytes.length !== original.bytes.length || result.bytes.some((byte, index) => byte !== original.bytes[index]))) throw new UserError('The retrieved bytes do not match your original file.');
    downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/octet-stream' }));
    const save = el<HTMLAnchorElement>('save'); save.href = downloadUrl; save.download = result.filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_') || 'file'; save.hidden = false;
    verifiedFile = result;
    el('result-title').textContent = 'File verified';
    el('result-filename').textContent = result.filename;
    el('result-size').textContent = formatBytes(result.bytes.length);
    el('result-chunks').textContent = String(result.chunkCount);
    el('result-expiration').textContent = 'Estimate unavailable';
    status(original ? 'Every byte matches your file.' : 'File integrity verified. Publisher identity is not verified.', 'success');
    // Optional presentation metadata must never turn a verified download into failure.
    try {
      const date = estimateExpirationDate(result.expiresAt, await client.getBlockTiming());
      el('result-expiration').textContent = date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { /* Verified bytes remain downloadable if date estimation is unavailable. */ }
    await loadInspection(key, result);
  } catch (error) {
    clearDownload(); el('retry').hidden = false;
    el('result-title').textContent = original ? 'Stored. Verification not completed.' : 'Verification not completed';
    status(`${original ? 'Your upload is confirmed. ' : ''}${safeError(error)} Use Retry verification; it sends no transactions.`, 'error');
  }
}

async function loadInspection(key: Hex, verified: DownloadResult) {
  clearInspection();
  el('inspection-status').textContent = 'Loading chunk entities…';
  el('inspection-status').dataset.state = 'loading';
  try {
    const { chunks, code } = await inspectChunks(client, key, verified);
    el('chunk-title').textContent = `${chunks.length} ${chunks.length === 1 ? 'chunk entity' : 'chunk entities'}`;
    const list = el('chunk-list'); list.dataset.count = String(chunks.length);
    for (const chunk of chunks) {
      const card = document.createElement('article'); card.className = 'chunk-card'; card.dataset.seq = String(chunk.seq);
      const heading = document.createElement('h4'); heading.textContent = `Chunk ${chunk.seq + 1} · ${formatBytes(chunk.payload.length)}`;
      const link = document.createElement('a'); link.className = 'chunk-key'; link.href = `${explorer}/entity/${chunk.key}`; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = chunk.key; link.setAttribute('aria-label', `Open chunk ${chunk.seq + 1} in explorer: ${chunk.key}`);
      const label = document.createElement('p'); label.className = 'help';
      const preview = document.createElement('pre'); preview.className = 'payload-preview';
      const head = chunk.payload.slice(0, 96);
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(head);
        if (/[\u0000-\u0008\u000b-\u001f]/.test(text)) throw new Error('Binary');
        label.textContent = `Payload · ${head.length} of ${chunk.payload.length.toLocaleString('en-US')} bytes`;
      } catch {
        text = Array.from(head, byte => byte.toString(16).padStart(2, '0')).join(' ');
        label.textContent = `Payload (hex) · ${head.length} of ${chunk.payload.length.toLocaleString('en-US')} bytes`;
      }
      preview.textContent = text || '(empty payload)';
      const url = URL.createObjectURL(new Blob([new Uint8Array(chunk.payload)], { type: 'application/octet-stream' })); payloadUrls.push(url);
      const download = document.createElement('a'); download.className = 'chunk-download'; download.href = url; download.download = `chunk-${chunk.seq + 1}.bin`; download.textContent = 'Download payload ↓';
      const attrs = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Attributes';
      const json = document.createElement('pre'); json.textContent = JSON.stringify(chunk.attributes, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2);
      attrs.append(summary, json); card.append(heading, link, label, preview, download, attrs); list.append(card);
    }
    el('query-code').textContent = code; el('query-details').hidden = false;
    el('inspection-status').textContent = `1 manifest + ${chunks.length} ${chunks.length === 1 ? 'chunk' : 'chunks'} = ${chunks.length + 1} entities.`;
    el('inspection-status').dataset.state = 'success';
    el('reassembly').textContent = `${chunks.length <= 4 ? chunks.map(chunk => chunk.payload.length.toLocaleString('en-US')).join(' + ') : `${chunks.length} ordered chunks`} → ${formatBytes(verified.bytes.length)} restored.`;
    el('reassembly').hidden = false;
  } catch {
    clearInspection();
    el('inspection-status').textContent = 'Chunk details are unavailable. Your verified file is still downloadable.';
    el('inspection-status').dataset.state = 'error'; el('retry-inspection').hidden = false;
  }
}

el('connect').addEventListener('click', async () => {
  if (busy) return; setBusy(true);
  try { await connectWallet(); status('Wallet connected. Your file is ready to store.', 'idle'); }
  catch(error) { account = undefined; updateWallet(); status(safeError(error), 'error'); }
  finally { setBusy(false); }
});
el('choose').addEventListener('click', () => el<HTMLInputElement>('file').click());
el<HTMLInputElement>('file').addEventListener('change', () => {
  const file = el<HTMLInputElement>('file').files?.[0]; if (!file) return;
  if (file.size > MAX_FILE_BYTES) { status('Choose a file no larger than 32 MiB.', 'error'); return; }
  selectedFile = file; clearResult(); updateFile(); status('Ready to store and verify.', 'idle');
});
el('demo').addEventListener('click', () => { selectedFile = demo; el<HTMLInputElement>('file').value = ''; clearResult(); updateFile(); status('Sample file ready. No need to find a file.', 'idle'); });
function setMode(next: 'upload' | 'open') {
  if (busy) return; mode = next; clearResult(); el('upload-form').hidden = next !== 'upload'; el('open-form').hidden = next !== 'open';
  for (const value of ['upload','open']) {
    el(`tab-${value}`).setAttribute('aria-selected', String(value === next));
    el(`tab-${value}`).tabIndex = value === next ? 0 : -1;
  }
  el('result-empty-title').textContent = next === 'upload' ? 'Your verified file lands here.' : 'Open a file from its manifest.';
  status('', 'idle');
}
el('tab-upload').addEventListener('click', () => setMode('upload'));
el('tab-open').addEventListener('click', () => setMode('open'));
document.querySelector('[role=tablist]')!.addEventListener('keydown', event => {
  const key = (event as KeyboardEvent).key;
  if (busy || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
  event.preventDefault();
  const next = key === 'Home' ? 'upload' : key === 'End' ? 'open' : mode === 'upload' ? 'open' : 'upload';
  setMode(next); el(`tab-${next}`).focus();
});
el<HTMLFormElement>('upload-form').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || mode !== 'upload') return;
  setBusy(true); clearResult(); uploaded = undefined;
  el('result-filename').textContent = selectedFile.name;
  el('result-size').textContent = formatBytes(selectedFile.size); el('result-chunks').textContent = '—'; el('result-expiration').textContent = '—';
  let partialKey: Hex | undefined; let releaseGuard: (() => void) | undefined;
  try {
    const chunks = Math.max(1, Math.ceil(selectedFile.size / DEFAULT_CHUNK_BYTES));
    const chosenDate = new Date(el<HTMLInputElement>('expiration').value);
    // Check the network/date before requesting any transaction signature.
    if (await client.getChainId() !== tiramisu.id) throw new UserError('Tiramisu could not be confirmed. Try again when the network is available.');
    try { dateToBlocks(chosenDate, await client.getBlockTiming(), chunks); } catch(error) { throw new UserError(error instanceof Error ? error.message : 'Choose a future expiration date.'); }
    status('Connect your wallet to start.', 'loading');
    const {walletProvider,address} = await connectWallet();
    let changed = false; const markChanged = () => { changed = true; account = undefined; updateWallet(); };
    walletProvider.on?.('accountsChanged',markChanged); walletProvider.on?.('chainChanged',markChanged);
    releaseGuard = () => {walletProvider.removeListener?.('accountsChanged',markChanged);walletProvider.removeListener?.('chainChanged',markChanged);};
    const guarded = { request: async (args: {method:string;params?:unknown}) => {
      if (['eth_sendTransaction','eth_signTransaction','eth_sendRawTransaction','wallet_sendCalls'].includes(args.method)) {
        const [addresses,chain] = await Promise.all([walletProvider.request({method:'eth_accounts'}),walletProvider.request({method:'eth_chainId'})]);
        if(changed || addresses[0]?.toLowerCase() !== address.toLowerCase() || Number(chain) !== tiramisu.id) throw new UserError('The wallet account or network changed. Check confirmed transactions before starting again.');
      }
      return (walletProvider.request.bind(walletProvider) as (args:{method:string;params?:unknown})=>Promise<unknown>)(args);
    }} as EIP1193Provider;
    const wallet = createWalletClient({ account: address, chain: tiramisu, transport: custom(guarded,{retryCount:0}) });
    const bytes = new Uint8Array(await selectedFile.arrayBuffer());
    let expirationBlocks: number;
    try { expirationBlocks = dateToBlocks(chosenDate, await client.getBlockTiming(), chunks); } catch(error) { throw new UserError(error instanceof Error ? error.message : 'Choose a future expiration date.'); }
    if (matchMedia('(max-width: 700px)').matches) el('result-panel').scrollIntoView({behavior:'smooth',block:'start'});
    const result = await uploadFile({publicClient:client,walletClient:wallet,bytes,filename:selectedFile.name,contentType:selectedFile.type || 'application/octet-stream',expirationBlocks,
      onProgress: p => { if(p.manifestKey) partialKey=p.manifestKey; const label=p.phase==='manifest'?'Creating file manifest':p.phase==='chunks'?`Storing chunk ${Math.min(p.completed+1,p.total)} of ${p.total}`:'Finalizing file'; status(`${label}. Confirm the pending request in your wallet.`, 'loading'); },
    });
    uploaded = {key:result.manifestKey,bytes,sha256:result.sha256};
    showKey(result.manifestKey);
    await verifyFile(result.manifestKey);
  } catch(error) {
    if(error instanceof ChunkingError && error.manifestKey) partialKey=error.manifestKey;
    if(partialKey){ showKey(partialKey);el('result-title').textContent='Upload status unconfirmed';el('retry').hidden=false; }
    status(`${safeError(error)}${partialKey?' Keep the manifest key and check the explorer before uploading again.':''}`,'error');
  } finally { releaseGuard?.(); setBusy(false); }
});
el<HTMLFormElement>('open-form').addEventListener('submit', async event => {
  event.preventDefault(); if(busy)return;
  const key = el<HTMLInputElement>('manifest').value.trim();
  clearResult(); el('result-filename').textContent='—'; el('result-size').textContent='—'; el('result-chunks').textContent='—'; el('result-expiration').textContent='—';
  if(!/^0x[0-9a-fA-F]{64}$/.test(key)){status('Enter a manifest key: 0x followed by 64 hexadecimal characters.','error');return;}
  setBusy(true); try {await verifyFile(key as Hex);} finally{setBusy(false);}
});
el('retry').addEventListener('click', async () => {if(busy || !currentKey)return;setBusy(true);try{await verifyFile(currentKey);}finally{setBusy(false);}});
el('copy-query').addEventListener('click', async () => {try{await navigator.clipboard.writeText(el('query-code').textContent ?? '');el('copy-query').textContent='Copied';}catch{el('copy-query').textContent='Select code to copy';}});
el('copy-key').addEventListener('click', async () => {
  if (!currentKey) return;
  try { await navigator.clipboard.writeText(currentKey); el('copy-key').textContent = 'Key copied'; }
  catch { el('copy-key').textContent = 'Key in Open existing'; }
});
el('retry-inspection').addEventListener('click', async () => {
  if (busy || !currentKey || !verifiedFile) return;
  setBusy(true); try { await loadInspection(currentKey, verifiedFile); } finally { setBusy(false); }
});
initTheme(el<HTMLButtonElement>('theme'));
el('version').textContent=`v${VERSION}`;
el<HTMLInputElement>('expiration').value=toLocalDateTimeInput(new Date(Date.now()+86400000));
el<HTMLInputElement>('expiration').min=toLocalDateTimeInput(new Date(Date.now()+120000));
el('timezone').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;
updateFile();updateWallet();
window.addEventListener('pagehide',clearDownload);
window.addEventListener('pagehide',clearInspection);

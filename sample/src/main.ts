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
  try { url = new URL(value); } catch { throw new UserError('Ingresa una URL RPC válida.'); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new UserError('Utiliza un RPC HTTPS. HTTP solo se permite para localhost.');
  }
  if (url.username || url.password || url.hash) throw new UserError('Utiliza una URL RPC sin usuario, contraseña ni fragmento.');
  return createPublicClient({ chain: tiramisu, transport: http(value, { timeout: 30_000, retryCount: 1, fetchOptions: { cache: 'no-store' } }) });
}

class UserError extends Error {}

function errorMessage(error: unknown): string {
  if (error instanceof UserError) return error.message;
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (code === 4001 || code === 'ACTION_REJECTED') return 'Rechazaste la solicitud en tu wallet. Puedes intentarlo de nuevo.';
  if (error instanceof ChunkingError) {
    const messages: Record<string, string> = {
      INVALID_INPUT: 'Revisa la clave, el archivo y la expiración antes de intentar de nuevo.',
      NETWORK_MISMATCH: 'El RPC y la wallet deben utilizar Tiramisu. Revisa la configuración de ambos.',
      INCOMPLETE_UPLOAD: 'La subida quedó incompleta. No puede reconstruirse como un archivo válido.',
      HASH_MISMATCH: 'La verificación detectó bytes diferentes. No se habilitó la descarga.',
      INVALID_MANIFEST: 'El manifiesto no tiene un formato válido para este paquete.',
      INVALID_CHUNK: 'Una parte no coincide con el manifiesto. No se habilitó la descarga.',
      MISSING_CHUNK: 'Faltan partes del archivo. Pueden haber expirado o cambiado; no se habilitó la descarga.',
      NOT_FOUND: 'No se encontró el manifiesto. Revisa la clave, la red y la expiración.',
      READ_FAILED: 'Falló la lectura. Revisa la conexión RPC y su access key antes de volver a intentar.',
      UPLOAD_FAILED: 'La subida falló. Las transacciones confirmadas no se revierten. Revisa la wallet y sus transacciones antes de iniciar otra subida.',
    };
    return messages[String(error.code)] ?? 'El paquete no pudo completar la operación. Revisa la red, la disponibilidad de las partes y el saldo de testnet. No se habilitan archivos sin verificar.';
  }
  // SDK errors may contain the RPC URL or request payload: never render/log them.
  return 'No se pudo completar la operación. Revisa la conexión RPC y su access key, la red de la wallet y el saldo de GLM de testnet. Una solicitud pendiente debe resolverse en la wallet.';
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
    element('file-info').textContent = 'Selecciona un archivo para ver cuántas partes necesita.';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    fileInput.setCustomValidity(`El límite es ${MAX_FILE_BYTES.toLocaleString('es-CO')} bytes.`);
  }
  const parts = Math.max(1, Math.ceil(file.size / DEFAULT_CHUNK_BYTES));
  element('file-info').textContent = `${file.name} · ${file.size.toLocaleString('es-CO')} bytes · ${parts} ${parts === 1 ? 'parte' : 'partes'}. Límite: ${MAX_FILE_BYTES.toLocaleString('es-CO')} bytes.`;
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
  status('download', 'Recupera un manifiesto para verificar el archivo de esta subida.', 'idle');
  let partialKey: Hex | undefined;
  let releaseWalletGuard: (() => void) | undefined;
  try {
    if (file.size > MAX_FILE_BYTES) throw new UserError(`El archivo supera el límite de ${MAX_FILE_BYTES.toLocaleString('es-CO')} bytes.`);
    const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
    if (!provider) throw new UserError('No se encontró una wallet. Abre la sample en un navegador con una wallet compatible con Ethereum.');
    const client = publicClient();
    status('upload', 'Comprobando la red y solicitando conexión a tu wallet…', 'loading');
    const [rpcChain, walletChain] = await Promise.all([client.getChainId(), provider.request({ method: 'eth_chainId' })]);
    if (rpcChain !== tiramisu.id || Number(walletChain) !== tiramisu.id) {
      throw new UserError(`Configura el RPC y tu wallet en Tiramisu (chain ID ${tiramisu.id}) y vuelve a intentar.`);
    }
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    const account = accounts[0];
    if (!account) throw new UserError('La wallet no compartió una cuenta. Autoriza una cuenta y vuelve a intentar.');
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
            throw new UserError('La cuenta o red de tu wallet cambió durante la subida. Revisa las transacciones confirmadas antes de iniciar otra subida.');
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
    status('upload', `Preparando ${chunks.length} partes. Confirma las transacciones en tu wallet.`, 'loading');
    const result = await uploadFile({
      publicClient: client,
      walletClient: wallet,
      bytes,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      expirationBlocks: Number(element<HTMLSelectElement>('expiration').value),
      onProgress: progress => {
        if (progress.manifestKey) partialKey = progress.manifestKey;
        const phase = { manifest: 'Creando manifiesto', chunks: 'Guardando partes', finalize: 'Finalizando manifiesto' }[progress.phase];
        status('upload', `${phase}: ${progress.completed}/${progress.total}. Confirma las solicitudes pendientes en tu wallet.`, 'loading');
      },
    });
    uploaded = { key: result.manifestKey, bytes, sha256: result.sha256 };
    manifestInput.value = result.manifestKey;
    element('uploaded-key').textContent = result.manifestKey;
    element('upload-summary').textContent = `${result.totalBytes.toLocaleString('es-CO')} bytes · ${result.chunkCount} partes · ${result.transactionHashes.length} transacciones confirmadas. Expira en el bloque ${result.expiresAt.toLocaleString('es-CO')}.`;
    element('upload-result').hidden = false;
    status('upload', 'Archivo guardado. Recupera el archivo en el siguiente paso para comprobar los bytes.', 'success');
    status('download', 'El manifiesto está listo. Selecciona Recuperar archivo para verificarlo.', 'success');
  } catch (error) {
    if (error instanceof ChunkingError && error.manifestKey) partialKey = error.manifestKey;
    status('upload', `${errorMessage(error)}${partialKey ? ' Conserva la clave y consulta el manifiesto para comprobar su estado.' : ''}`, 'error');
    if (partialKey) {
      manifestInput.value = partialKey;
      element('uploaded-key').textContent = partialKey;
      element('upload-summary').textContent = 'Estado de la subida sin confirmar. Conserva esta clave y comprueba las transacciones antes de volver a subir.';
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
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new UserError('La clave del manifiesto debe ser 0x seguido de 64 caracteres hexadecimales.');
    const client = publicClient();
    status('download', 'Consultando el manifiesto y sus partes…', 'loading');
    if (await client.getChainId() !== tiramisu.id) throw new UserError('El RPC debe utilizar Tiramisu. Revisa la URL de conexión.');
    const original = uploaded?.key.toLowerCase() === key.toLowerCase() ? uploaded : undefined;
    const result = await downloadFile({
      publicClient: client,
      manifestKey: key as Hex,
      expectedSha256: original?.sha256,
      onProgress: progress => status('download', `Recuperando partes: ${progress.completed}/${progress.total}.`, 'loading'),
    });
    if (original && (result.bytes.length !== original.bytes.length || result.bytes.some((byte, index) => byte !== original.bytes[index]))) {
      throw new UserError('El archivo recuperado no coincide con el original. La descarga fue bloqueada.');
    }
    // Serve as an attachment with a neutral MIME type, never render uploaded content.
    downloadUrl = URL.createObjectURL(new Blob([new Uint8Array(result.bytes)], { type: 'application/octet-stream' }));
    saveLink.href = downloadUrl;
    saveLink.download = result.filename.replace(/[\\/\u0000-\u001f\u007f]/g, '_') || 'archivo';
    element('download-summary').textContent = `${result.filename} · ${result.bytes.length.toLocaleString('es-CO')} bytes · ${result.chunkCount} partes reconstruidas. Expira en el bloque ${result.expiresAt.toLocaleString('es-CO')}.`;
    element('download-hash').textContent = result.sha256;
    element('download-result').hidden = false;
    status('download', original ? 'Verificado: los bytes coinciden exactamente con el archivo que subiste.' : 'Verificado: el SHA-256 del archivo reconstruido coincide con el del manifiesto. Esto verifica la integridad del archivo, no la identidad del autor.', 'success');
  } catch (error) { status('download', errorMessage(error), 'error'); }
  finally { setBusy(false); }
});

window.addEventListener('pagehide', () => { if (downloadUrl) URL.revokeObjectURL(downloadUrl); });

import {createWalletClient, type WalletArkivClient} from '@arkiv-network/sdk';
import {custom, type Hex} from 'viem';

type Wallet = Pick<WalletArkivClient, 'chain' | 'account' | 'transport' | 'createEntity' | 'patchEntity'>;
export interface WriteTransactionParameters { gas: bigint; gasPrice: bigint; nonce: number }
export interface WriteTransactionContext {
  phase: 'manifest' | 'chunks' | 'finalize';
  chunkIndex?: number;
  /** 1 only after a confirmed gas-exhausted revert; never after an uncertain write. */
  attempt: 0 | 1;
  estimate: bigint;
  defaults: Readonly<WriteTransactionParameters>;
}
/** May increase gas or change the fee; nonce must still equal the freshly read latest nonce. */
export type TransactionParameterPolicy = (context: WriteTransactionContext) =>
  Partial<WriteTransactionParameters> | Promise<Partial<WriteTransactionParameters>>;
export const MIN_TRANSACTION_GAS = 1_000_000n;
export class WriteConfirmationPendingError extends Error {
  constructor(readonly txHash: Hex, cause?: unknown) {
    super('Transaction was submitted, but receipt confirmation is unresolved. Do not resend.', {cause});
    this.name = 'WriteConfirmationPendingError';
  }
}
const isHash = (value: unknown): value is Hex => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw Error('Invalid transaction RPC quantity.');
  return BigInt(value);
}
function transactionHash(error: unknown): Hex | undefined {
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === 'object'; depth++) {
    if ('txHash' in current && isHash(current.txHash)) return current.txHash;
    current = 'cause' in current ? current.cause : undefined;
  }
}

/** SDK 1.0 keeps its encoders private. A signing-disabled SDK client captures its unsigned request.
 * The only send method is intercepted locally; it can never reach an RPC or a signer.
 * Use the same explicit salt and absolute expiry in this plan and the actual write.
 */
async function unsignedTransaction(wallet: Wallet, plan: (client: Wallet) => Promise<unknown>) {
  const address = wallet.account!.address;
  let transaction: {from: string; to: Hex; data: Hex} | undefined;
  const unsigned = createWalletClient({chain: wallet.chain!, account: address,
    transport: custom({request: async ({method, params}) => {
      if (method === 'eth_sendTransaction') {
        const tx = (params as [{to?: unknown; data?: unknown}])[0];
        if (typeof tx.to !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(tx.to) || typeof tx.data !== 'string' || !/^0x[0-9a-fA-F]*$/.test(tx.data)) throw Error('Invalid unsigned SDK transaction.');
        transaction = {from: address, to: tx.to as Hex, data: tx.data as Hex};
        throw Error('Unsigned request captured; signing and sending are disabled.');
      }
      if (method !== 'eth_chainId' && method !== 'eth_blockNumber') throw Error('Unexpected unsigned SDK request.');
      return wallet.transport.request({method, params});
    }}, {retryCount: 0}),
  });
  try { await plan(unsigned); } catch (error) { if (!transaction) throw error; }
  if (!transaction) throw Error('SDK did not produce an unsigned transaction.');
  return transaction;
}

/** All policy reads use the configured wallet RPC, never a sample's public read proxy. */
export async function writeWithPolicy<T extends {txHash: Hex}>(
  wallet: Wallet,
  context: Pick<WriteTransactionContext, 'phase' | 'chunkIndex'>,
  plan: (client: Wallet) => Promise<unknown>,
  send: (parameters: WriteTransactionParameters) => Promise<T>,
  confirmedHashes: Hex[],
  policy?: TransactionParameterPolicy,
  onSdkSuccess?: (result: T) => void,
): Promise<T> {
  const rpc = wallet.transport.request as (request: {method: string; params?: unknown[]}) => Promise<unknown>;
  let priorGas = 0n;
  for (const attempt of [0, 1] as const) {
    const transaction = await unsignedTransaction(wallet, plan);
    // No signer is called if estimation fails. Never use a historical state hash or tag.
    const estimate = quantity(await rpc({method: 'eth_estimateGas', params: [transaction, 'latest']}));
    if (estimate <= 0n) throw Error('Unsigned gas estimate must be positive.');
    const minimumGas = [MIN_TRANSACTION_GAS, 2n * estimate, 2n * priorGas].reduce((a, b) => a > b ? a : b);
    const [nonceHex, priceHex, block] = await Promise.all([
      rpc({method: 'eth_getTransactionCount', params: [wallet.account!.address, 'latest']}),
      rpc({method: 'eth_gasPrice', params: []}),
      rpc({method: 'eth_getBlockByNumber', params: ['latest', false]}),
    ]);
    const nonce = Number(quantity(nonceHex));
    if (!Number.isSafeInteger(nonce) || nonce < 0) throw Error('Latest nonce exceeds the supported range.');
    const defaults = {nonce, gas: minimumGas, gasPrice: quantity(priceHex)};
    const override = policy ? await policy({...context, attempt, estimate, defaults: Object.freeze({...defaults})}) : {};
    const parameters = {...defaults, ...override};
    if (parameters.nonce !== nonce || typeof parameters.gas !== 'bigint' || parameters.gas < minimumGas || typeof parameters.gasPrice !== 'bigint' || parameters.gasPrice <= 0n) throw Error('Transaction override must retain latest nonce, positive gas price and the minimum gas headroom.');
    if (!block || typeof block !== 'object' || !('gasLimit' in block) || parameters.gas > quantity(block.gasLimit)) throw Error('Transaction gas budget exceeds the latest block gas limit.');
    let result: T | undefined, failure: unknown;
    try { result = await send(parameters); } catch (error) { failure = error; }
    const hash = result?.txHash ?? transactionHash(failure);
    if (!hash) throw failure ?? Error('Wallet returned no transaction hash.');
    // SDK success has already observed a successful receipt. Preserve its evidence before
    // a lagging RPC can obscure it, including the create result needed by upload recovery.
    if (result) {
      if (!confirmedHashes.includes(hash)) confirmedHashes.push(hash);
      onSdkSuccess?.(result);
    }
    const validReceipt = (value: unknown): value is {transactionHash: Hex; blockHash: Hex; status: '0x1' | '0x0'; gasUsed?: unknown} =>
      !!value && typeof value === 'object' && 'transactionHash' in value && value.transactionHash === hash && 'blockHash' in value && isHash(value.blockHash) && 'status' in value && (value.status === '0x1' || value.status === '0x0');
    let receipt: unknown, lookupFailure: unknown;
    for (let lookup = 0; lookup < (result ? 5 : 1); lookup++) {
      // Receipts are looked up by hash at the RPC's current head; this method has no block tag.
      try { receipt = await rpc({method: 'eth_getTransactionReceipt', params: [hash]}); }
      catch (error) { if (!result) throw new WriteConfirmationPendingError(hash, error); lookupFailure = error; }
      if (validReceipt(receipt)) break;
      if (result && lookup < 4) await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!validReceipt(receipt)) {
      throw new WriteConfirmationPendingError(hash, lookupFailure ?? failure);
    }
    if (!confirmedHashes.includes(hash)) confirmedHashes.push(hash);
    // An SDK-success result never authorizes a resend, even if a later read disagrees.
    if (result) {
      if (receipt.status === '0x1') return result;
      throw new WriteConfirmationPendingError(hash, Error('Receipt disagrees with SDK success. Inspect the preserved transaction; do not resend.'));
    }
    if (receipt.status === '0x1') {
      // A successful receipt followed by a missing SDK result is not safe to repeat.
      if (failure) throw failure;
      return result!;
    }
    if (attempt === 0 && 'gasUsed' in receipt && quantity(receipt.gasUsed) === parameters.gas) {
      priorGas = parameters.gas;
      continue;
    }
    throw failure ?? Error('Transaction reverted. Inspect its receipt; no further retry is permitted.');
  }
  throw Error('Transaction retry limit reached.');
}

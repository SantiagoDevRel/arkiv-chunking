import type { EIP1193Provider } from 'viem';

/**
 * The only RPC URL this sample ever offers to a wallet: Rabdi's keyless public endpoint.
 * Access keys stay server-side (the read proxy); they never go into a wallet, the bundle, a URL or a QR.
 */
export const RABDI_PUBLIC_RPC = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';

export function rabdiAddChainParams(chainId: number, explorer: string) {
  return {
    chainId: `0x${chainId.toString(16)}`,
    chainName: 'Rabdi',
    nativeCurrency: { name: 'Golem', symbol: 'tGLM', decimals: 18 },
    rpcUrls: [RABDI_PUBLIC_RPC],
    blockExplorerUrls: [explorer],
  };
}

/**
 * EIP-3326: 4902 means the wallet does not know the chain. MetaMask Mobile wraps it as -32603 with
 * `data.originalError.code` (or `originalError.code`) 4902, or only says "Unrecognized chain ID".
 * Any other error, including an unrelated -32603, is not an unknown chain.
 */
export function isUnknownChainError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const failure = error as { code?: unknown; message?: unknown; originalError?: { code?: unknown } | null; data?: { originalError?: { code?: unknown } | null } | null };
  if (failure.code === 4902 || failure.originalError?.code === 4902 || failure.data?.originalError?.code === 4902) return true;
  return failure.code === -32603 && typeof failure.message === 'string' && /unrecogni[sz]ed chain id/i.test(failure.message);
}

/** Asks the wallet to switch to Rabdi; if the wallet does not know the chain (4902, also wrapped), adds it with the keyless RPC. */
export async function switchToRabdi(walletProvider: EIP1193Provider, chainId: number, explorer: string): Promise<void> {
  const hexId = `0x${chainId.toString(16)}`;
  try {
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await walletProvider.request({ method: 'wallet_addEthereumChain', params: [rabdiAddChainParams(chainId, explorer)] });
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  }
}

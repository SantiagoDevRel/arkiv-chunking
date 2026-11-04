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

/** Asks the wallet to switch to Rabdi; if the wallet does not know the chain (4902), adds it with the keyless RPC. */
export async function switchToRabdi(walletProvider: EIP1193Provider, chainId: number, explorer: string): Promise<void> {
  const hexId = `0x${chainId.toString(16)}`;
  try {
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (error) {
    if ((error as { code?: number }).code !== 4902) throw error;
    await walletProvider.request({ method: 'wallet_addEthereumChain', params: [rabdiAddChainParams(chainId, explorer)] });
    await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  }
}

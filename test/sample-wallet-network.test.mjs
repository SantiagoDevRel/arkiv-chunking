import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// A keyed Rabdi RPC URL (access key in the path) must never reach a wallet, the bundle, a URL or a QR.
const KEYLESS = 'https://rpc.rabdi.db-chain.testnet.arkiv.network';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const loadWalletNetwork = async () => {
  const source = await read('../sample/src/wallet-network.ts');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};
function stubWallet({ knowsRabdi }) {
  const calls = [];
  return { calls, request: async ({ method, params }) => {
    calls.push({ method, params });
    if (method === 'wallet_switchEthereumChain' && !knowsRabdi && !calls.some(call => call.method === 'wallet_addEthereumChain')) throw Object.assign(new Error('Unrecognized chain'), { code: 4902 });
    return null;
  } };
}

test('a wallet without Rabdi is offered only the keyless public RPC', async () => {
  const { switchToRabdi, RABDI_PUBLIC_RPC } = await loadWalletNetwork();
  assert.equal(RABDI_PUBLIC_RPC, KEYLESS);
  const wallet = stubWallet({ knowsRabdi: false });
  await switchToRabdi(wallet, 7794095, 'https://rabdi.explorer.arkiv.network');
  assert.deepEqual(wallet.calls.map(call => call.method), ['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain']);
  const [params] = wallet.calls[1].params;
  assert.equal(params.chainId, '0x76edaf');
  assert.deepEqual(params.rpcUrls, [KEYLESS]);
  for (const url of params.rpcUrls) { const parsed = new URL(url); assert.equal(parsed.pathname, '/'); assert.equal(parsed.search + parsed.hash + parsed.username + parsed.password, ''); }
});

test('a wallet that already has Rabdi is only switched, never re-added', async () => {
  const { switchToRabdi } = await loadWalletNetwork();
  const wallet = stubWallet({ knowsRabdi: true });
  await switchToRabdi(wallet, 7794095, 'https://rabdi.explorer.arkiv.network');
  assert.deepEqual(wallet.calls.map(call => call.method), ['wallet_switchEthereumChain']);
});

test('the sample never asks for a keyed RPC URL or puts one in the wallet', async () => {
  const [html, main, readme, agents] = await Promise.all(['../sample/index.html', '../sample/src/main.ts', '../sample/README.md', '../sample/AGENTS.md'].map(read));
  assert.doesNotMatch(html, /wallet-rpc|wallet RPC URL/i, 'no RPC URL field on the page');
  assert.doesNotMatch(main, /wallet-rpc|rpc\.href|rpcUrls:\s*\[rpc/, 'no user-supplied RPC in wallet requests');
  assert.doesNotMatch(main, /wallet_addEthereumChain/, 'adding the chain goes through wallet-network.ts only');
  assert.match(main, /switchToRabdi\(/);
  for (const doc of [readme, agents]) {
    assert.doesNotMatch(doc, /same RPC in your wallet|user-configured (Rabdi |wallet )?RPC|enter your own HTTPS Rabdi RPC/i);
    assert.match(doc, /rpc\.rabdi\.db-chain\.testnet\.arkiv\.network(?![\w/])/);
  }
  for (const text of [html, main, readme, agents]) assert.doesNotMatch(text, /rpc\.rabdi\.db-chain\.testnet\.arkiv\.network\/(?!['"`\s)])/, 'no keyed RPC URL literal');
});

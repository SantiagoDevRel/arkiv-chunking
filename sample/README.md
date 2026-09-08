# arkiv-chunking sample

A browser sample that stores a file as Arkiv entities, retrieves its chunks, verifies their integrity and downloads the reconstructed file. It imports the public `arkiv-chunking@0.1.0` package; there is no copied chunking implementation or source alias to the parent directory.

**These packages are intended for testnet use.**

## Run from a clean checkout

Requires Node.js 22.12 or newer, npm and a current browser with Web Crypto. Serve over localhost or HTTPS:

```sh
git clone --branch feat/file-chunking https://github.com/SantiagoDevRel/arkiv-chunking.git
cd arkiv-chunking/sample
npm install
npm run build
npm run dev
```

Open <http://127.0.0.1:3076>. The port is fixed: if occupied, stop the process you own using that port or explicitly choose another port with `npm run dev -- --port 3077`. No `.env` file or build-time credentials are required.

The manifest pins `arkiv-chunking` to `0.1.0`, Arkiv SDK to `0.8.0`, viem to `2.56.3`, TypeScript to `5.9.3` and Vite to `8.2.2`. The package version is displayed using its exported `VERSION`, so the visible version describes the actual import.

**Publication status:** until `arkiv-chunking@0.1.0` is available on npm, the clean install above is blocked. A local tarball test is not evidence of publication. The delivery report in the repository root records publication and verification status.

## Perform the complete flow

1. Keep the supplied Tiramisu RPC or enter your own HTTPS RPC URL. It must return chain ID `7738577`. The URL stays in the current form; the sample does not store it in localStorage, analytics or logs. If the provider requires an access key, obtain a browser-appropriate key from that provider; Arkiv Hub provides [access keys](https://hub.arkiv.network/api-keys). A key embedded in a browser URL is visible to that browser and provider; never put an administrative credential here.
2. For upload, use an injected EIP-1193 wallet connected to Tiramisu, with enough GLM **testnet** funds for the transaction fees and entity storage. Follow the [network setup](https://hub.arkiv.network/networks) and obtain funds from the [testnet faucet](https://hub.arkiv.network/faucet). The sample does not request private keys or automatically alter your wallet's network configuration. Retrieval does not need a wallet or funds.
3. Select a small, non-sensitive file. For a reproducible two-part example, create `example.txt` containing 120,001 ASCII characters. The default chunk size is 100,000 bytes, so the preview will show two parts. Empty files are supported as one empty part.
4. Choose Entity Expiration, acknowledge that the bytes and filename will be public, then click **Conectar wallet y subir**. Approve the wallet connection and each transaction. Upload uses one manifest transaction, one transaction per chunk, and one manifest finalization transaction. A two-part file therefore needs four transaction approvals.
5. Copy the returned manifest key and click **Recuperar archivo**. Expected result: `Verificado: los bytes coinciden exactamente con el archivo que subiste.`, with file size, chunk count, SHA-256 and a download link. The byte comparison uses the original in this tab; the package separately checks the complete file's SHA-256 digest and manifest structure.
6. Click **Descargar archivo verificado**. The sample serves an attachment as `application/octet-stream`; it never renders uploaded HTML or executes uploaded content.

Create the two-part fixture from the sample directory with:

```sh
node -e "require('node:fs').writeFileSync('example.txt', 'x'.repeat(120001), {flag:'wx'})"
```

This intentionally fails if `example.txt` already exists, preserving your files.

You can reload the page and paste a manifest key to retrieve an existing file without a wallet. That path verifies the file against the manifest, not against an independently trusted digest or author identity. For authenticity-sensitive applications, use the package's `expectedSha256` option with an independently obtained digest; see the [package README](../README.md).

## Limits and recovery

- Files are buffered in browser memory. The package limit is 32 MiB; this sample uses the default chunk size and displays the actual part count. Start small: every part adds a transaction and testnet storage cost.
- Expiration is availability policy, not deletion from chain history. Do not upload personal, secret or copyrighted material without authorization.
- No wallet: install or enable an injected Ethereum-compatible wallet. No account: grant access to a test account. Wallet rejection: approve only the action you intended and retry deliberately.
- Wrong network: configure both the RPC and wallet for Tiramisu. The sample checks both before upload, and the package checks again.
- RPC errors: verify endpoint reachability, access policy, rate limits and browser CORS. Detailed provider errors are intentionally not rendered because they may include credentials or request payloads.
- Insufficient funds: obtain testnet GLM through the current Arkiv faucet resources. Do not use mainnet funds.
- Interrupted upload: confirmed entities remain. When available, the UI exposes the incomplete manifest key. Inspect your wallet's transaction history before starting another upload; the sample has no automatic write retries, rollback, resume or cleanup.
- Retrieval failure: check the full 32-byte manifest key, network and expiration. Missing, malformed, mismatched or incomplete entities fail closed: the sample provides no partial download.
- A file named `.`/`..`, with control characters, or with a basename longer than 255 UTF-8 bytes is rejected by the package. Rename it before uploading.
- Google Fonts unavailable: system fonts are usable fallbacks. No licensed font files ship in this source.

## Consumer agents and maintenance

Read [AGENTS.md](./AGENTS.md) for integration decisions and verification responsibilities; [CLAUDE.md](./CLAUDE.md) points to the same guide. Explicitly provide those files to an integration agent. For the npm API, also provide the package [AGENTS.md](../AGENTS.md); do not assume an agent discovers documentation in `node_modules`.

### Typography and design provenance

This small vanilla sample mirrors the tokens, section heading and outline button treatments of `Arkiv-Network/arkiv-ui` at commit `aeb2b272fe2d15c6ad3ca59a5e3af045356a2c14` (`registry/styles/arkiv-tokens.css`, `src/components/ui/button.tsx`, `src/components/ui/section-heading.tsx`). Space Grotesk is its documented open fallback for Brutal Type; IBM Plex Mono is its body/control family. The sample distributes no licensed font assets and invents no Arkiv logo.

| Role | Family | Size / weight / line height / letter spacing |
| --- | --- | --- |
| Page heading | Space Grotesk, system sans fallback | 32px / 500 / 1.1 / 0 |
| Section heading | Same heading family | 24px / 500 / 1.1 / 0 |
| Body, labels, controls | IBM Plex Mono, system monospace fallback | 16px / 400 / 1.5 / normal |
| Help, metadata, code | Same body family | 14px / 400 / 1.5 / normal |
| Eyebrow | Same body family | 14px / 500 / 1.5 / 0 |

Single-column layout at all widths; breakpoint `600px` changes outer padding and button width only. Long keys wrap. Dark is the only supported theme. Browser checks must include 390, 768 and 1440px, both sides of the 600px breakpoint, 200% zoom, computed typography and loaded fonts, plus empty/loading/error/success states. See the repository delivery report for checks actually run; this table is the design contract, not a test result.

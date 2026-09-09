# Arkiv Files sample

A compact file workspace built with Claude Design and the Arkiv Design System. It consumes the published **arkiv-chunking@0.1.0** package: choose a file, sign its storage transactions, and get the automatically retrieved and verified result.

**These packages are intended for testnet use.**

## Run from a clean checkout

Use Node.js 22.12+ and npm. Tested: Node 22.22.3, npm 10.9.8, SDK 0.8.0, viem 2.56.3, Vite 8.2.2 and Chrome 152.

```sh
git clone --branch feat/file-chunking https://github.com/SantiagoDevRel/arkiv-chunking.git
cd arkiv-chunking/sample
npm ci
npm run build
npm run dev
```

Open http://127.0.0.1:3076. If that port is occupied, choose another explicitly: `npm run dev -- --port 3077`. No environment file, API key or private key is needed. On Windows, use `npm.cmd` if PowerShell blocks `npm.ps1`.

The lockfile resolves the exact published package from npm, with no alias to parent source. Confirm with `npm ls arkiv-chunking @arkiv-network/sdk viem`. The header displays the imported package's `VERSION`.

## Try the complete flow

1. The **Upload** tab starts with `arkiv-demo.txt` selected: 120,001 bytes of synthetic public text, spanning two chunks. You do not need to create or find a file. **Choose a file** replaces it; **Use sample file** restores it. Zero-byte files are supported.
2. Choose an **Entity Expiration** date and time in your device's timezone, shown beside the field. The default is tomorrow. It is an approximate network date, not an exact wall-clock deadline.
3. Click **Store & verify**. An injected Ethereum-compatible wallet connects and, if necessary, asks to switch to Tiramisu (chain 7738577). The separate **Connect wallet** button lets you connect first. The sample never signs on page load.
4. Approve each transaction. Expand **4 wallet approvals** to see why: one manifest, two chunks, and finalization. Progress appears while the operation runs. All bytes and filenames are public; use synthetic or otherwise approved public files.
5. After finalization, retrieval and integrity verification run **automatically**. Expected result: **File verified**, `120,001 bytes`, `2` chunks, and `Every byte matches your file.`
6. **Download file** saves the reconstructed file. **Copy file key** keeps its manifest key for later; **File manifest** opens that entity in the explorer. Its adjacent info button explains the manifest: an index containing the file metadata, while the bytes live in chunks. The sample file has **three entities** (one manifest and two chunks), written with four approvals because finalization updates the manifest.
7. Each chunk card shows its entity key, byte count and a preview of its actual payload. Click its key to inspect that chunk in the explorer, **Download payload** for all its bytes, or **Attributes** for its manifest reference and zero-based `seq`. The result shows `100,000 + 20,001 → 120,001 bytes restored.` Previews are limited to 96 bytes, rendered as text or hex; they never execute file content.
8. **Query these chunks** shows only the query fetching those entities, with their attributes and payloads. It iterates all pages at the inspected block, restricted to the manifest's owner and creator. Results need ordering by `seq` before reassembly; the published package handles this and integrity checks. The inspection query is an additional read, not another upload. If it fails, **Reload chunk details** retries only that view; the verified file remains downloadable.

For a read-only flow, choose **Open existing**, paste a manifest key and click **Retrieve & verify**. No wallet or funds are needed. Reloading does not lose the on-chain file; keep its manifest key. In that case verification checks integrity against the manifest, not an independently trusted author. See the package's `expectedSha256` option for trusted digest pinning.

The sample starts in **dark mode**. The **sun / moon** button toggles appearance; your choice is saved locally. No preference means dark, independent of the operating system setting. On desktop, both panels have equal dimensions and scroll independently when details expand. On mobile, panels stack and grow with their content.

### Run the displayed query

In a consumer installed using the package README, create `query.mjs` with this setup, paste the exact displayed query after it, then run `node query.mjs`:

```js
import { createPublicClient } from '@arkiv-network/sdk';
import { tiramisu } from '@arkiv-network/sdk/chains';
import { key, str } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import { http } from 'viem';
const client = createPublicClient({ chain: tiramisu, transport: http() });
// Paste the displayed query here. It creates the chunks array.
// Then inspect: console.log(chunks);
```

For the built-in file the query returns two entities, with `seq` values `0n` and `1n` and payload lengths 100,000 and 20,001. Keys and snapshot blocks depend on your upload. The displayed snapshot is not a promise of permanent historical availability. Use `downloadFile` from the package for a fully validated current download.

## Wallet, network and expiration

The sample uses the SDK's public Tiramisu RPC internally. There is no RPC configuration form. Reads and these tested writes required no access key. If that public service changes access policy, update the integration deliberately; do not put administrative credentials in a browser bundle.

Uploads require test GLM in a testnet wallet. Use the [faucet](https://hub.arkiv.network/faucet) and [network setup](https://hub.arkiv.network/networks). If Tiramisu is not installed in your wallet, follow the setup link, then reconnect. Account and network are checked before every signature; a change during upload stops subsequent writes.

The date adapter in `src/expiration.ts` calls SDK `getBlockTiming()` immediately before upload, then converts the selected date into the published package's relative `expirationBlocks`. It validates the package's minimum/maximum budgets and rejects timing more than five minutes away from the device clock. It does not silently clamp dates. Network progress and wallet approval delays can shift actual expiration. The result estimates the date from the actual returned `expiresAt` and fresh network timing. A failed date estimate never removes a verified download. Entity Expiration affects current availability; it does not erase historical bytes.

## Errors and recovery

- **No wallet / unknown network:** enable an injected wallet and configure Tiramisu. Existing-file retrieval still works without a wallet.
- **Rejected signature / changed account or network:** inspect wallet transactions. Confirmed entities remain. Keep any returned manifest key and use the explorer before starting a new upload.
- **Stored, but verification not completed:** storage succeeded. **Retry verification** only reads; it sends no transactions and never repeats the upload.
- **Invalid or past date / stale timing:** choose a later date, check your device clock or try again when network timing is available. No write is submitted for a rejected date.
- **Missing or expired manifest:** check the key and network. No fallback network or partial file is returned.
- **Missing/corrupt chunks or digest mismatch:** download stays disabled. Do not bypass verification. A retry may help a transient read outage, but cannot repair corrupt data.
- **RPC failure / insufficient funds:** check connectivity and test GLM. Raw provider errors are not rendered because they may include sensitive request data.
- **File too large:** the package buffers files in memory and limits them to 32 MiB. Start with the supplied small sample. Basenames must satisfy the package's validation rules.
- **Clipboard unavailable:** select the displayed query text and copy it manually. Serve on localhost or HTTPS for browser Web Crypto and clipboard support.

There is no resume, rollback, cleanup, encryption or file viewer. Downloads use `application/octet-stream`; uploaded HTML is never rendered. No private key enters the app.

## Consumer agents and verification

Give your agent [AGENTS.md](AGENTS.md), its [CLAUDE.md pointer](CLAUDE.md), and the [package guide](../AGENTS.md) explicitly. Do not assume it discovers files in `node_modules`. The package [README](../README.md) owns API contracts and limits; this README owns the sample workflow.

From the repository root, run `npm test` and `npm run typecheck`. For the separate browser suite, keep the sample running and execute:

```sh
npx playwright install chromium
npm run test:browser
```

`SAMPLE_URL` selects a different local URL, `BROWSER_CHANNEL=chrome` uses an installed Chrome, and `ARTIFACTS_DIR` sets the screenshot/evidence directory. The browser suite uses the actual npm package and SDK with controlled RPC and a test wallet; it does not send real transactions. Real-network evidence and unverified boundaries are in [the verification report](../docs/verification.md).

## Design provenance and contract

The user-requested [Claude Design prototype](https://claude.ai/design/p/31e23730-6446-4adf-9b09-c9b8a2db0ad1) used **Arkiv Design System**. The implemented sample adapts its compact topbar, exclusive Upload/Open modes, file tile, date input and adjacent result panel. It replaces every prototype simulation with the published package and real SDK. No prototype runtime, signed preview URL, mock wallet or simulated success ships in the app.

Colors, spacing and button treatments mirror `Arkiv-Network/arkiv-ui`: Ink `#111111`, Sand `#F6F4EF`, Stone `#E9E6DE`, Orange `#FE7446`, Blue `#181EA9`. Dark and light surfaces share these brand tokens; the header stays Ink. The logo is the unmodified **official white SVG**, downloaded from the [official Drive file](https://drive.google.com/file/d/1pUqKsNvDxDf_JNFpQOZVI8u6a979Gd_c/view), not text in a substitute font. Source URLs and verified SHA-256 values are in [brand provenance](public/brand/provenance.json). Space Grotesk is the open fallback for headings; IBM Plex Mono is the body/control font. Google Fonts is the font provider; system fonts remain fallbacks. Licensed font files are not distributed.

| Role | Family | Size / weight / line height |
|---|---|---|
| Wordmark | Official SVG | 130px wide, native 1389:320 aspect ratio |
| App name and section/result headings | Space Grotesk | 24px /500 /1.2 |
| Workspace heading | Space Grotesk | 32px desktop, 24px narrow /500 /1.2 |
| Body and primary controls | IBM Plex Mono | 16px /400 /1.5 |
| Help, secondary actions, field labels | IBM Plex Mono | 14px /400–500 /1.5 |
| Code and metadata labels | IBM Plex Mono | 12px /400 /1.5–1.7 |

At widths above 700px, controls and result sit side by side; below that, the result appears when needed. The 960px breakpoint adjusts padding and result metadata wrapping. Inspect 390/768/1440, both sides of 700/960, empty/prepared/loading/error/success, long names, font loading, overflow and 200% reflow. Do not reduce essential control labels or truncate filenames to force a fit. The typography table is a contract, not evidence of a test run.

## Static deployment

Build from the sample directory with `npm ci && npm run build`, then deploy that directory using `vercel --scope YOUR_TEAM`. The checked-in configuration serves the already-built `dist` directory; it does not run a remote build. `.vercelignore` allows only `dist` and `vercel.json`. No runtime environment variables or server signer are needed. Verify the deployed header version, a read-only retrieval, and that `/.env`, `/package.json` and `/src/main.ts` return 404 before sharing the URL.

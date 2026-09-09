# Verification — arkiv-chunking 0.1.0

## Hosted sample

[Arkiv Files](https://arkiv-chunking-sample.vercel.app) is deployed on Vercel from the clean sample checkout, consuming npm `arkiv-chunking@0.1.0`. The hosted application was rendered in both themes at 390/768/1440 px and successfully retrieved the real 120,001-byte file and its two chunk entities from Tiramisu. The production HTML, JS, CSS and official logo match the locally verified build. Sensitive/source paths (`/.env`, `/.env.local`, `/keys.json`, `/package.json`, `/src/main.ts`, `/config.json`, `/vercel.json`, `/node_modules/arkiv-chunking/package.json`) return 404.

Claude separately passed 63 UI assertions plus 30 breakpoint assertions on the local production build: tooltip interaction/focus/contrast, icon theme toggle, stable panel geometry, and static deployment allowlist. Framing is denied by response headers. This sample deployment is independent of the Hub production environment.

## Panel polish and fresh npm consumer (2026-09-09 UTC)

[Independent Muse, Grok and Claude audit](package-audit.md): no blocking findings; evidence and limits are recorded per reviewer.

The sample now uses a sun/moon control, a keyboard-accessible explanation beside **File manifest**, and equal-width, equal-height desktop panels whose frames stay fixed when disclosures open. Mobile panels grow naturally. The package API and published `arkiv-chunking@0.1.0` artifact are unchanged.

- `npm test`: 34 passed; package typecheck and sample production build passed.
- Browser regression: 15 workflow checks, 17 controlled SDK transactions, both themes at 390/699/701/768/959/961/1440 px. Added icon visibility, tooltip keyboard/Escape/focus, viewport bounds, and equal panel geometry assertions, including expanded details.
- Real Tiramisu anonymous read: the displayed query returned two entities (100,000 and 20,001 bytes), and published `downloadFile` returned the same 120,001 bytes and independently checked SHA-256. Both chunk explorer destinations displayed the expected entity key.
- A new empty consumer installed exact npm versions, executed the example extracted from its installed README, compiled all public TypeScript contracts, and exercised empty/binary inputs, digest mismatch, missing manifest and wrong network. `npm audit --omit=dev` reported zero advisories. Published JavaScript and declarations matched the local build byte for byte.
- Native Chrome 200% browser zoom was not verified. The tooltip was inspected with viewport captures because full-page screenshot capture crashed Chrome at one intermediate width; DOM geometry and viewport capture passed there. No new real wallet writes were sent for this UI revision.

Machine-readable versions, registry integrity, query result and limitations: [polish-verification.json](polish-verification.json). The npm tarball's documentation remains its release-time snapshot; this repository records subsequent sample verification.

Date: 2026-09-08. This bundled report is the snapshot taken before publishing the reviewed artifact. Post-publication registry and sample checks are tracked in the [current source report](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/docs/verification.md).

## Current dark/light theme and chunk inspection — 2026-09-08

The latest sample starts dark, preserves an explicit light preference, explains the transaction count in an accessible disclosure, and removes the static Ready/Store/Verify labels. The result shows the individual chunk entities, full keys linking to each explorer page, actual 96-byte payload previews, complete payload downloads and expandable attributes. The file manifest has its own link and copy-key action. The query disclosure contains only the SDK query that fetches the displayed chunk entities and attributes; runnable client setup belongs to the sample README.

The official white wordmark was downloaded from the actual Arkiv Brand Assets Drive folder and used unchanged on the dark header. [Provenance and exact hashes](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/sample/public/brand/provenance.json) record both official SVG variants. The earlier text approximation is no longer used.

**Real reads:** the user-provided manifest resolved to two chunk entities, of 100,000 and 20,001 bytes. The displayed query was copied verbatim into an existing clean npm consumer with the documented imports. It returned those same entity keys, attributes and payloads; independent SHA-256 over the ordered bytes matched the original 120,001-byte file. Both individual explorer pages were rendered and checked for their actual keys. [Chunk evidence](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/docs/chunk-inspection-evidence.json) records the result. This update sent no new live transactions.

**Checks:** all 34 package/date tests, typecheck and production build passed. The expanded browser suite passed 15 checks using the published npm package and real SDK with 17 controlled transactions. It executes the displayed query, compares each downloaded payload with the original slice, verifies reassembly, checks theme persistence and keyboard disclosures, and confirms an inspection-only outage preserves the verified file and retries with zero writes. Both themes were rendered at 390/699/701/768/959/961/1440px for baseline, loading, success, long filename, expanded details and errors. A clipped small chunk collection found in review was corrected; up to four cards now remain fully visible rather than requiring a nested scroll. Native browser zoom remains unverified.

Inspection is a separate read after the package verifies a download. It pins its own block snapshot and manifest owner/creator and verifies the inspected payloads again through published `reconstructFile`. It does not replace the package's download logic. No dependencies, package release, public deployment or Hub card were added.

**Final Claude audit:** approved all six requests with no blocking findings. Claude independently executed the displayed query against Tiramisu, checked the two keys and payload sizes, retrieved the file through npm, verified both SVG hashes and header contrast, and passed 32 isolated-browser assertions. It confirmed theme persistence, keyboard disclosure, uncapped small chunk collections and inspection-error recovery with zero writes. Its two optional findings were addressed: unused stepper CSS was removed and the result explicitly states `1 manifest + 2 chunks = 3 entities.` The separate Codex coverage check marked all six requests complete. No reviewer signed transactions.

## Workspace redesign — earlier on 2026-09-08

The sample was redesigned after the original delivery below. The earlier dark UI, separate RPC form and manual retrieval descriptions are historical evidence, not the current interface. The npm package remains the published **0.1.0**; only its consumer sample and supporting checks changed.

The requested [Claude Design project](https://claude.ai/design/p/31e23730-6446-4adf-9b09-c9b8a2db0ad1) used Arkiv Design System. Its rendered prototype was inspected and adapted into a compact workspace. Upload and Open existing are exclusive modes; a built-in 120,001-byte file is selected; Tiramisu access is internal; Entity Expiration uses a local date/time; storage automatically retrieves and verifies the original bytes. Query details are disclosed on demand, with a working explorer link. The acknowledgement checkbox was removed.

**Real execution:** four additional Rabby / Arkiv Wallet transactions confirmed on Tiramisu, followed automatically by byte-exact retrieval. The saved attachment was independently downloaded without a wallet and matched the original. The exact displayed query ran in a clean consumer installed from npm and printed `arkiv-demo.txt 120001`. The explorer was rendered and checked for the actual manifest and creation block. See [redesign transaction and download evidence](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/docs/redesign-testnet-evidence.json). Together with the original delivery, **20 real transactions** succeeded; the redesigned flow accounts for four of these. Keys may expire.

**Automated execution:** 34 tests passed (27 package tests plus seven date-adapter cases), typecheck and the sample production build passed. The browser suite uses the real npm package and SDK against controlled RPC, with 17 simulated transactions. It covers the built-in/custom/empty files, actual attachment bytes, corruption, no wallet, wrong wallet network, declined signature, account change, invalid/past dates, stale timing, and read failure after finalization. Retrying the last case performs zero additional writes. Keyboard tab navigation is also checked.

**Rendered checks:** 390/699/701/768/959/961/1440px, including both sides of the 700/960px breakpoints, with prepared/loading/success/error and long filenames. No horizontal overflow; desktop primary controls fit at 1440×900. The warm light workspace and dark header are intentional. Computed fonts use Space Grotesk and IBM Plex Mono. A separate CSS 200% check exposed squeezed result metadata; a narrow-panel container rule corrected it. Native browser zoom remains unverified.

**Independent Claude audit:** approved the redesign with no blocking findings. Claude independently ran all 34 tests, typecheck and browser checks, inspected responsive layout, queried live block timing, executed the query example, and rendered the real explorer entity. Its optional case-normalization and stale-clock wording suggestions were corrected, and UTF-8 BOMs were removed. Claude's audit did not sign transactions; the real Rabby evidence above is separate.

**Copy review:** Claude and Grok Build inspected Upload, Open existing and a real retrieved file. Repeated verification explanations and idle slogans were removed, wallet-free retrieval is explained once, and funding links appear only for uploads. A functional page title works in both modes; success copy is shorter. Manifest-key help remains visible for first-time visitors. Query details use a keyboard/touch-accessible disclosure. Claude's focused follow-up approved the copy changes, keyboard tabs and evidence addendum with no blockers; its JSON encoding and packaged-link observations were corrected. Grok's Cursor lane hit its usage limit; the existing Grok Build lane completed the actual review. Neither reviewer submitted transactions.

No public deployment or Hub card has been created. The current sample is served locally for review; the source report is newer than the immutable report bundled in npm 0.1.0.

The final Claude delta review closed with **STATUS: OK**: evidence JSON parses, the absolute evidence link resolves packaging concerns, shorter copy preserves the identity distinction, and narrow result metadata no longer overlaps. It also verified no overflow at 320px CSS width. A fresh GitHub clone of code commit `4573518` followed `sample/README.md`: `npm ci`, production build and `npm ls` passed, resolving npm `arkiv-chunking@0.1.0`, SDK 0.8.0 and viem 2.56.3. Its JavaScript/CSS assets match the inspected localhost preview (`index-0dgpEjrT.js`, `index-DVtonyW0.css`).

The clean checkout started with the documented explicit alternate-port option and passed all 12 browser checks against its own dev server, including the 17 controlled transactions and saved attachments. The independent Codex coverage follow-up marked all nine redesign/copy requests complete.

| Component | Tested version |
|---|---|
| Node / npm | 22.22.3 / 10.9.8 on Windows |
| TypeScript | 5.9.3 |
| Arkiv SDK | 0.8.0, exact peer dependency |
| viem | 2.56.3 |
| Sample | Vite 8.2.2, vanilla TypeScript, English |
| Browser | Chrome 152.0.7977.77, Playwright 1.62.1 |
| Package | 0.1.0 |
| Network | Tiramisu testnet, chain ID 7738577 |

## Real Tiramisu roundtrips

The installed packed package and real SDK uploaded and retrieved synthetic public files through the public Tiramisu RPC. An EIP-1193 adapter used Rabby with the explicitly authorized Arkiv Wallet account. No private key was extracted. All **12 transactions confirmed successfully**, every recovered file matched byte-for-byte, independent Node SHA-256 matched, and an intentionally wrong expected digest was rejected for each file.

| File | Bytes | Chunk size | Chunks | Confirmed transactions |
|---|---:|---:|---:|---:|
| Synthetic text | 270,000 | 100,000 | 3 | 5 |
| Empty file | 0 | 100,000 | 1 | 3 |
| Maximum chunk boundary | 120,001 | 120,000 | 2 | 4 |

The 120,000-byte chunk produced **121,348 calldata bytes** and was accepted by the real node, using 4,825,360 gas. This is an observed case, not a universal network maximum or a future fee quote. See [machine-readable transaction evidence](testnet-evidence.json) for manifest keys, hashes, blocks, byte counts and gas used. These keys are historical evidence: entities expire and are not promised to remain queryable.

Real read failure checks also passed: the all-zero manifest key returned `NOT_FOUND`; a client configured with a different chain ID against Tiramisu returned `NETWORK_MISMATCH`.

## Package and browser checks

- Build, typecheck and **27 tests** passed. Coverage includes binary/UTF-8/empty bytes, limits, input copy isolation, complete-state gating, partial upload failures, 205 shuffled chunks over cursor pages, missing/duplicate/corrupt chunks, malformed metadata, wrong networks, trusted digest pinning, foreign-owner injection, provider failures and progress callback errors.
- Expiration tests cover minimum block budgets, queried expiration, stopping subsequent writes when blocks run out, no read after confirmed finalization, one transient read retry without duplicate writes, and persistent read failure distinguished from expiry.
- Those automated tests use controlled RPC transports with the actual installed SDK's query encoding, attributes, pagination, wallet ABI encoding and receipt-event decoding. They supplement the real network checks above.
- Browser integration used the actual package and SDK with controlled RPC and an injected test wallet: a **286,000-byte file**, three chunks, five simulated confirmations, then the downloaded attachment compared byte-for-byte. Empty file, corrupted bytes, rejected transaction and account change after the first confirmation passed. Failures clear prior success and preserve the relevant manifest key without claiming completion.
- Rendered English dark UI inspected at **390/599/601/768/1440 px**, including both sides of the 600px breakpoint. Empty, loading, malformed key, missing wallet, wrong RPC network, success, corruption and interrupted upload were checked. No global horizontal overflow; long filenames and keys wrap.
- Computed typography and actual font rendering checked through CDP: Space Grotesk headings, IBM Plex Mono body/controls. Font requests returned 200. CSS zoom 200% reflow passed. **Native Chrome zoom was not verified.** The sample has no light theme.
- A fresh agent with no chat or implementation context followed only README/AGENTS in a clean consumer. Output: `3` then `Hello, Arkiv!`. All public types imported; strict TypeScript with `skipLibCheck: false` compiled real SDK client integration. Empty bytes and wrong digest passed. Its documentation finding was fixed: packaged relative links now resolve, with explicit source links for the sample.
- Package contents are allowlisted: JavaScript, types, README, AGENTS, CLAUDE, LICENSE and verification evidence. Tests, sample, scripts and environment files do not ship.
- A clean source clone passed `npm ci`, all 27 tests, typecheck and the sample production build against the packed candidate. Registry-only verification follows publication and is recorded in the current source report linked above.

## Independent Claude audit

Claude Code audited library logic, SDK integration, consumer documentation, package contents and rendered sample. Findings led to block-based expiration, queried expiration results, minimum lifetime budgets, bounded liveness read retries, version consistency checks and clearer recovery states. A post-finalization read was removed so a provider failure cannot misreport a confirmed upload.

Claude independently reran **27/27 tests**, typecheck and browser smoke; inspected screenshots; reproduced transient and persistent read failures; and verified GitHub/local parity for code commit [4988081](https://github.com/SantiagoDevRel/arkiv-chunking/commit/4988081fa9b49bb64b35ea4ae52bcab288ed4476). A subsequent English UI audit approved the translation and preserved safeguards. Its two terminology/punctuation suggestions were incorporated. No outstanding code findings remained at this snapshot.

## Reproduce and boundaries

Follow [README](../README.md) for exact package checks and the [sample README](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/sample/README.md) for its build/run commands. Browser smoke is separate from `npm test`: start the sample, install Playwright Chromium, then run `npm run test:browser` from the root. It performs no live writes.

The optional `scripts/live-smoke.mjs` uses a locally configured Node signing key. It was syntax-checked; **that signer mode was not executed**. The real cases above used the same public API and fixtures through an authorized Rabby EIP-1193 signer.

Other SDK versions, runtimes and networks are unverified. No public sample deployment was created. The Hub `/tools` card is explicitly deferred. No skills, MCP integration or unrelated features were added.

## Published release and sample

`arkiv-chunking@0.1.0` was published to the public npm registry on 2026-09-08. Registry metadata was fetched after publication and matched the reviewed tarball exactly:

```text
sha512-TG0k5wPzRkXcddOD6e/H/DKUGVz2qECXxwe2ya91ktqQynL9WFUlGPyMG0E3AJtxiba4EEcgUl7CVw5nbWNymw==
```

The sample installed that exact registry version and generated a registry-backed lockfile. Its production build served `index-ago41XL-.js`. The real browser flow uploaded the README fixture (`example.txt`, 120,001 bytes), confirmed four Rabby transactions on Tiramisu, retrieved two chunks, and displayed `Verified: the bytes exactly match the file you uploaded.` The reconstructed Blob matched the original. A separate clean browser without a wallet retrieved the same real manifest and downloaded `example.txt`; the saved attachment also matched byte-for-byte. The shared Chrome download-artifact handoff failed in the automation harness, so the file-save assertion was completed in that isolated browser without sending another transaction.

The real successful screen was inspected at 390/768/1440 pixels with no horizontal overflow. [Published-package sample evidence](registry-sample-evidence.json) records the manifest, hashes, registry integrity and receipt blocks. Across prepublication API cases and this registry sample, **16 real Tiramisu transactions succeeded**. No public demo has been deployed; localhost review precedes deployment.

A second cold agent, given only README/AGENTS and a minimal integration objective, installed **the published npm release** into a new consumer. It confirmed registry integrity, the exact README example, all packaged guide links, all public exports and strict TypeScript 5.9.3 integration with the real SDK (no `skipLibCheck`). Empty/binary local roundtrips, digest rejection, anonymous Tiramisu reads, `NOT_FOUND` and `NETWORK_MISMATCH` passed. It found no blocking documentation gaps. It performed no writes; persistence evidence is recorded separately above.

A fresh GitHub clone at `1075e4a` followed the sample README: `npm ci` and `npm run build` succeeded with `arkiv-chunking@0.1.0`, SDK 0.8.0 and viem 2.56.3 resolved from npm. Its JavaScript bundle matched the inspected local production preview (`index-ago41XL-.js`).

## Final Claude release audit

The final audit on 2026-09-08 returned **STATUS: OK, no blocking findings**. Claude independently downloaded the published tarball and verified its SHA-1/SHA-512 against npm; confirmed all nine packaged files and the explicit bundled-report/source-report difference; and anonymously retrieved the real sample manifest from Tiramisu: `example.txt`, 120,001 bytes, two chunks and the recorded digest/expiration.

It inspected localhost in isolated Chrome at 390/768/1440 pixels, checked computed typography, loaded fonts, exact Arkiv Ink/Sand/Orange colors, no horizontal overflow, and the served bundle identity. Its verdict: the current sample satisfies the requested minimal, understandable Arkiv-branded design. Security/logic review found no regression in per-signature wallet guards, URL checks, neutral attachment handling or integrity validation. This final pass did not repeat writes or the earlier closed test suite audit.

Optional observations left outside this delivery: unify the unnumbered network section with the numbered upload/retrieval steps, add an official favicon, and consider self-hosting the already documented Google Fonts before a public deployment. No redesign or new functionality was introduced. Public deployment remains pending the user's localhost review and the existing brand-alignment process.

The fresh registry source checkout also started on localhost with an explicit alternate port and passed the complete browser smoke against that server: upload/retrieval/download, corruption, empty file, rejected wallet and changed account. An independent Codex coverage check marked all delivered requirements complete; the Hub card remains intentionally deferred.

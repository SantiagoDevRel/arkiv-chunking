# Verification — arkiv-chunking 0.1.0

Date: 2026-09-08. This bundled report is the snapshot taken before publishing the reviewed artifact. Post-publication registry and sample checks are tracked in the [current source report](https://github.com/SantiagoDevRel/arkiv-chunking/blob/feat/file-chunking/docs/verification.md).

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

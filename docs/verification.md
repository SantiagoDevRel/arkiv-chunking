# Verification — arkiv-chunking 0.1.0

Date: 2026-09-08. This is a release candidate, not a publication claim. The package is implemented and tested locally; npm publication and live writes are separate gates.

| Component | Version / status |
|---|---|
| Node | 22.22.3 on Windows |
| TypeScript | 5.9.3 |
| Arkiv SDK | 0.8.0, exact peer dependency |
| viem | 2.56.3 |
| npm | 10.9.8 |
| Sample | Vite 8.2.2, vanilla TypeScript |
| Browser | Chrome 152.0.7977.77, Playwright 1.62.1, isolated context |
| Package | 0.1.0, local tarball only so far |
| Network target | Tiramisu, chain ID 7738577 |

## Completed

- TypeScript package build.
- 27 tests: local binary/UTF-8/empty roundtrips, input limits, copy isolation, complete-state gating, multi-transaction failures, 205 shuffled chunks across SDK cursor pages, missing/duplicate/corrupt chunks, malformed metadata/types/counts, wrong networks, expected-hash pinning, foreign-owner injection, provider failures, synchronous/asynchronous progress errors, package version consistency, minimum block budgets and stopping writes when the manifest expires or has too few remaining blocks. Returned expiry is asserted against queried data rather than the simulated write response estimate. Regression checks cover no read after confirmed finalization, one transient read retry without duplicate writes, and persistent read failure distinguished from expiry.
- The RPC transport is simulated. Query encoding, response decoding, typed attributes and pagination use the real installed SDK. A separate test uses actual SDK wallet encoding, ABI decoding and receipt-event processing against a controlled transport. A 120,000-byte chunk produces **121,348 calldata bytes**, below the 122,880-byte conservative budget. This is an encoder measurement, not proof of node acceptance or a gas-price estimate.
- The complete browser flow uses the real package and SDK against the controlled RPC: **286,000-byte file**, three chunks, five simulated confirmed transactions, then reconstructed/downloaded attachment compared byte-for-byte. Empty file also passed. Corruption removed the prior download link; a rejected wallet transaction never displayed success; an account change after manifest confirmation stopped the next signature.
- Rendered dark UI at **390/599/601/768/1440 px**, including both sides of the 600px breakpoint. Empty, loading, malformed key, missing wallet, wrong RPC network, successful reconstruction, corruption and interrupted upload checked. No global horizontal overflow; long filenames and keys wrap. Screenshots opened and inspected.
- Computed typography and actual font rendering checked via CDP: Space Grotesk for headings, IBM Plex Mono for body/controls. Font requests returned 200. CSS zoom 200% reflow passed; **the native Chrome zoom control was not verified**. There is no light theme in this sample.
- A fresh agent, without this chat or library implementation, followed only README/AGENTS and installed the packed artifact into a new consumer. Exact example output: `3` then `Hello, Arkiv!`. All public types imported; strict TypeScript with `skipLibCheck: false` compiled an actual SDK client passed to `downloadFile`. Empty bytes and wrong digest also checked. It found package-relative links to omitted files; fixed by including this evidence document and using explicit source links for the sample.
- Real anonymous RPC read from that consumer: Tiramisu returned chain ID **7738577**. This is connectivity evidence only; no stored file was retrieved from the actual network.
- `npm pack --dry-run` confirms README, AGENTS.md, CLAUDE.md, LICENSE, types, JavaScript and this document are included. Package allowlist excludes sample, tests, scripts and any environment files.
- Source pushed to `SantiagoDevRel/arkiv-chunking`, branch `feat/file-chunking`; the documented clone command worked in a new directory. `npm ci`, package tests and typecheck passed there. The sample's ordinary registry installation was also attempted and returned E404 for this unpublished candidate.

## Reproduce

Library checks: `npm ci`, `npm test`, `npm run typecheck`. Sample: follow `sample/README.md`, then run `npm run build` there. The release sample depends on the npm artifact; before publication its normal install is explicitly blocked. Local evaluation used a separately packed `.tgz`, with `--no-save --package-lock=false`; no local dependency is advertised as the release.

Browser test: start the sample dev server, install the Playwright Chromium binary, then run `npm run test:browser` from the root. This is separate from `npm test` and must be run explicitly when verifying the sample. It never contacts a real chain for writes. Details and environment overrides are in README.

Live write script: `node --env-file=/absolute/path/to/your-secret.env scripts/live-smoke.mjs`. This is prepared and syntax-checked, **not executed**. It requires an authorized testnet signing wallet and test GLM.

## Still required before final delivery

- npm authentication: `npm whoami` returns `ENEEDAUTH`; the existing stored publisher credential was also checked and returned HTTP 401. No version is claimed published. Registry installation, registry sample lockfile and clean published-package sample startup remain unverified.
- Actual testnet roundtrip: awaiting authorization to use the identified test wallet, or another supplied wallet. No testnet funds were spent by this task.
- Complete Claude audit is in progress; its final result and corrections will be recorded here.
- No public demo deployment or Hub `/tools` change has been made. The user deferred the Hub card. A public branded demo would also need the applicable brand alignment; that does not prevent running the sample locally.

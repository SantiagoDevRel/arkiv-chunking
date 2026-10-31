# Rabdi release verification

Current procedure: arkiv-chunking 1.1.2, SDK 1.0.0, viem 2.56.3, format v2, Rabdi DB-Chain testnet 7794095. The measured receipts below are historical 1.0.0 observations.

Install `npm install --save-exact arkiv-chunking@1.1.2 @arkiv-network/sdk@1.0.0 viem@2.56.3`. Run the reproducible checks below against the same source tree.

## Review corrections: October 31

The maximum-lifetime probe sent exactly one deliberately invalid create from the dedicated CHUNKING wallet, at head + 7,884,000 + 120 blocks. Transaction `0xdd798d87612736340a0421c82390d39619ab605c214afcd027bb20d7bc1f2b0e` reverted (gas used 33,380 / limit 1,000,000). SDK 1.0.0 reported: "the expiry resolves to block 7895089, more than the chain's maximum lifetime of 7884000 blocks after the current block 10972". Its formatter maps this sentence to ExpiryBeyondMaxLifetime. Admission now reserves 30 blocks and uses a coordinated absolute deadline; no longer lifetime or permanent option is claimed.

The public upload policy captures the SDK's unsigned request with signing disabled, estimates at latest, passes explicit gas=max(1,000,000, 2*estimate), gasPrice and latest nonce, and checks the receipt. Tests inspect actual sent parameters, overrides, estimate failures, coordinated deadlines, one confirmed gas-exhaustion retry, semantic reverts and uncertain/successful writes that must never retry. The sample and scripts use this policy rather than fixed binary budgets.

## Reproducible checks

- node scripts/verify.mjs: locked install, unit and SDK ABI tests, typecheck, syntax/import lint, npm pack, clean ESM tarball consumer, isolated archive sample build.
- node scripts/seed-rabdi.mjs: explicit dedicated-wallet write and byte-exact multi-chunk retrieval with independent SHA-256. A second run must report zero writes.
- node scripts/live-smoke.mjs: additional synthetic round trips for a multi-chunk text file, an empty file and the maximum-chunk boundary; receipt checks, missing-manifest and wrong-digest rejection.
- npm run test:browser: controlled SDK/RPC fixture and injected wallet, not real browser-wallet signing.
- Hydrated preview: real server endpoint and seeded Rabdi bytes, direct download comparison, three widths, themes, loading/error states and no credential URLs in client traffic.

Dated live results and the seed descriptor remain in [rabdi-evidence.json](rabdi-evidence.json) as historical observations. Record new execution status only in the external lane report.

## Boundaries

SDK 1.0 reads the latest block per query. Keyset pagination and a final manifest comparison replace snapshot cursors. Immutable chunks, complete-state gating, exact indexes, lengths and hash validation remain mandatory.

The sample's read proxy uses a server-only access key. Its per-instance cap is best effort; a durable distributed limiter is outside this library. Provider quotas still apply. Wallet writes use a user-configured RPC, and browser-wallet behavior must be assessed separately from Node signing.

In the source repository, older dated evidence files document immutable historical releases and deployments. They do not describe the current network or storage API.

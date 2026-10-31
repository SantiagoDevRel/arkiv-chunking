# Rabdi candidate verification

Candidate: arkiv-chunking 1.0.0, SDK 1.0.0, viem 2.56.3, format v2, Rabdi DB-Chain testnet 7794095.

This branch is an unpublished candidate. Registry publication, merge, release and production promotion require the separate approval stage. A packed candidate and its preview are not a published registry release.

## Reproducible checks

- node scripts/verify.mjs: locked install, unit and SDK ABI tests, typecheck, syntax/import lint, npm pack, clean ESM tarball consumer, candidate sample build.
- node scripts/seed-rabdi.mjs: explicit dedicated-wallet write and byte-exact multi-chunk retrieval with independent SHA-256. A second run must report zero writes.
- node scripts/live-smoke.mjs: additional synthetic round trips for a multi-chunk text file, an empty file and the maximum-chunk boundary; receipt checks, missing-manifest and wrong-digest rejection.
- npm run test:browser: controlled SDK/RPC fixture and injected wallet, not real browser-wallet signing.
- Hydrated preview: real server endpoint and seeded Rabdi bytes, direct download comparison, three widths, themes, loading/error states and no credential URLs in client traffic.

Current dated live results, seed descriptor and publication flags are in [rabdi-evidence.json](rabdi-evidence.json). Pending or unverified checks must remain labeled as such there.

## Boundaries

SDK 1.0 reads the latest block per query. Keyset pagination and a final manifest comparison replace snapshot cursors. Immutable chunks, complete-state gating, exact indexes, lengths and hash validation remain mandatory.

The sample's read proxy uses a server-only access key. Its per-instance cap is best effort; a durable distributed limiter is outside this candidate. Provider quotas still apply. Wallet writes use a user-configured RPC, and browser-wallet behavior must be assessed separately from Node signing.

In the source repository, older dated evidence files document immutable historical releases and deployments. They do not describe this candidate's current network or storage API.

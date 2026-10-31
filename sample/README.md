# Arkiv Files sample

Browser-wallet file storage and byte-verified retrieval on Rabdi, chain 7794095, using arkiv-chunking 1.1.2 and SDK 1.0.0.

The sample pins exact registry arkiv-chunking 1.1.2. The library API is documented at version 1.1.2 in the root README. Reads use the sample server endpoint; the dependency is never replaced by a parent-source alias.

## Run

Use Node 22.12+, npm and viem 2.56.3. The sample pins a published registry release; run npm ci and npm run dev in sample. Run node scripts/verify.mjs from the repository root for archive consumer checks. The development command listens on 127.0.0.1:3076.

Reads go through POST /api/rpc. Set server-side ARKIV_ACCESS_KEY to a Rabdi read access key in the existing Vercel project. Never use a VITE_ or NEXT_PUBLIC_ variable. The static Vite dev server does not execute Vercel functions; browser tests intercept the read transport, while real preview checks exercise the deployed endpoint.

To deploy, run npm ci and npm run build in sample, then deploy from sample. Vercel uploads the existing dist/ and api/ and skips installation and building (vercel.json). A clean checkout has no dist/, so rebuild before every deployment.

The endpoint allows only chain/timing reads, the latest header-only block read for the gas guard, and the package's bounded manifest/chunk queries. It rejects writes, arbitrary queries, batches and cross-origin browser requests. Errors are sanitized, responses use no-store, and a per-instance rate cap supplements the provider quota. This cap is not a durable distributed rate limiter.

## Use

1. Open public Rabdi sample to retrieve the seeded file without a wallet, or open a manifest key. A URL can use ?manifest=0x... for a reloadable read.
2. For an upload, enter your own HTTPS Rabdi RPC URL from [Access Keys](https://hub.arkiv.network/access-keys). The password input is never persisted or included in screenshots. Configure the same RPC in your wallet. Fund it through the [faucet](https://hub.arkiv.network/faucet).
3. Choose public bytes and an approximate Entity Expiration. Click Store & verify and approve each transaction. No write occurs on load, selection or connection.
4. Download appears only after complete verification. Retry verification performs reads only. An uncertain upload retains the manifest key and links to its observed confirmed transactions; inspect these and your wallet for uncertain receipts before writing again.
5. Inspect actual chunk keys, byte previews, attributes and the query. Content is neutral downloadable bytes, never executed HTML. Inspection failures preserve the verified download.

Every signature is guarded against account/network changes. A missing Rabdi network triggers an explicit wallet add/switch request from a user action. The app never receives a private key.

Writes use uploadFile's public policy: unsigned estimation at latest, gas=max(1,000,000, 2*estimate), explicit gasPrice and latest nonce, block gas-limit admission and authoritative receipt checks. Estimation failure stops before signing. Only a confirmed gas-exhausted revert can receive one retry with increased gas. Physical browser-wallet signing on this sample remains a separate verification boundary.

The date input uses the package's maximum 7,883,970 blocks: Rabdi's 7,884,000-block maximum less a 30-block inclusion margin. All file entities share one absolute deadline. Longer-lived files need coordinated Lifetime Extension, which this sample does not provide.

## Seed and checks

Run node scripts/seed-rabdi.mjs at the repository root using its documented dedicated test environment. It creates only deterministic public bytes, verifies at least three chunks, and writes public/sample.json. A second run must report writes: 0. After a network reset, run it again and redeploy the sample descriptor.

Package tests and the archive consumer/sample build run via node scripts/verify.mjs on the DGX. Browser checks must distinguish controlled RPC fixtures from real Rabdi data, verify downloads directly and by hash, exercise missing/corrupt/failed-read states, and inspect 390/768/1440 widths and both themes. Record physical browser-wallet boundaries separately from SDK writes.

Retain the official Arkiv logo provenance, existing design tokens, default dark theme, accessible controls and complete error/loading states. [AGENTS.md](AGENTS.md) contains integration invariants; [package API](../README.md) owns storage and verification logic.

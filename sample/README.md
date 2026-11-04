# Arkiv Files sample

Browser-wallet file storage and byte-verified retrieval on Rabdi, chain 7794095, using arkiv-chunking 1.1.4 and SDK `^1.0.0`, verified with 1.0.1.

The sample pins exact registry arkiv-chunking 1.1.4. The installed API is documented in the [versioned 1.1.4 README](https://github.com/SantiagoDevRel/arkiv-chunking/blob/v1.1.4/README.md). Reads use the sample server endpoint; the dependency is never replaced by a parent-source alias.

## Run

Use Node 22.12+, npm and viem 2.56.3. The sample pins a published registry release; run npm ci and npm run dev in sample. Run node scripts/verify.mjs from the repository root for archive consumer checks. The development command listens on 127.0.0.1:3076.

Reads go through POST /api/rpc. Set server-side ARKIV_ACCESS_KEY to a Rabdi read access key in the existing Vercel project. Never use a VITE_ or NEXT_PUBLIC_ variable. The static Vite dev server does not execute Vercel functions; browser tests intercept the read transport, while real preview checks exercise the deployed endpoint.

To deploy, run npm ci and npm run build in sample, then deploy from sample. Vercel uploads the existing dist/ and api/ and skips installation and building (vercel.json). A clean checkout has no dist/, so rebuild before every deployment.

The endpoint allows only chain/timing reads, the latest header-only block read for the gas guard, and the package's bounded manifest/chunk queries. It rejects writes, arbitrary queries, batches and cross-origin browser requests. Errors are sanitized, responses use no-store, and a per-instance rate cap supplements the provider quota. This cap is not a durable distributed rate limiter.

## Use

1. Open public Rabdi sample to retrieve the seeded file without a wallet, or open a manifest key. A URL can use ?manifest=0x... for a reloadable read.
2. For an upload, connect your wallet. If it does not have Rabdi yet, the sample asks it to add Rabdi with the keyless public RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`; to add it by hand, use that same URL. Never put an access key or a keyed RPC URL in a wallet: access keys stay server-side. Fund the wallet through the [faucet](https://hub.arkiv.network/faucet).
3. Choose public bytes and an approximate Entity Expiration. Click Store & verify and approve each transaction. No write occurs on load, selection or connection.
4. Download appears only after complete verification. Retry verification performs reads only. An uncertain upload retains the manifest key and links to its observed confirmed transactions; inspect these and your wallet for uncertain receipts before writing again.
5. Inspect actual chunk keys, byte previews, attributes and the query. Content is neutral downloadable bytes, never executed HTML. Inspection failures preserve the verified download.

Every signature is guarded against account/network changes. A missing Rabdi network triggers an explicit wallet add/switch request from a user action; the add request offers only the keyless public RPC (`sample/src/wallet-network.ts`). The app never receives a private key and never asks for an RPC URL.

Writes use uploadFile's public policy: unsigned estimation at latest, gas=max(1,000,000, 2*estimate), explicit gasPrice and latest nonce, block gas-limit admission and authoritative receipt checks. Estimation failure stops before signing. Only a confirmed gas-exhausted revert can receive one retry with increased gas. Physical browser-wallet signing on this sample remains a separate verification boundary.

Standalone SDK 1.0.1+ entities can use `ExpirationTime.max()` without subtraction. A file uses one shared absolute deadline across its parts. This package's file admission limit is 7,883,970 blocks, kept for compatibility with files already written. It is not the SDK or chain maximum of 7,884,000 blocks and is not a requirement of Rabdi. The date input retains this package limit. Sharing a deadline does not require subtracting 30 blocks. Longer-lived files need coordinated Lifetime Extension, which this sample does not provide.

## Seed and checks

Run `node scripts/seed-rabdi.mjs --journal <new-private-receipt-file>` at the repository root using its documented dedicated test environment. It creates a deterministic 1,536-byte public file in three 512-byte chunks, verifies the bytes, and writes sample/public/sample.json. A second run must report writes: 0. After a network reset, use this create-only seed again and redeploy the descriptor.

To keep an existing verified file available through 2026-12-31, run `node scripts/refresh-sample-rabdi.mjs --journal <new-private-receipt-file>` at the repository root with the same TEST_CHUNKING wallet. It verifies the bytes and ownership, then uses one batch of `ExpirationTime.max()` extensions only when the shared deadline is insufficient. All parts retain one shared expiry from that landing block; no duplicate file entities are created, and a rerun reports writes: 0. It uses explicit latest-state estimation, gas/price/nonce and successful receipt verification, and stops before signing when twice the estimate exceeds half the head block gas limit. Preserve the journal and reconcile uncertain submissions before another invocation; the script never retries a send. To stage a replacement privately, pass `--descriptor <private-descriptor-file>` to both scripts and publish the descriptor only after maximum-lifetime renewal and byte verification.

Package tests and the archive consumer/sample build run via node scripts/verify.mjs on the DGX. Browser checks must distinguish controlled RPC fixtures from real Rabdi data, verify downloads directly and by hash, exercise missing/corrupt/failed-read states, and inspect 390/768/1440 widths and both themes. Record physical browser-wallet boundaries separately from SDK writes.

Retain the official Arkiv logo provenance, existing design tokens, default dark theme, accessible controls and complete error/loading states. [AGENTS.md](AGENTS.md) contains integration invariants; [package API](../README.md) owns storage and verification logic.

The read proxy rejects a foreign or malformed Origin and cross-site Fetch Metadata before accessing the provider. Origin must equal its exact canonical `scheme://host[:port]` serialization, with no credentials, path, query or fragment. The expected origin uses the request Host and HTTPS; HTTP is allowed only for localhost and 127.0.0.1 development hosts, including non-default ports. Forwarded host/protocol headers cannot select trust. POST requires `Content-Type: application/json` (charset parameters are supported); JSON clients without Origin remain supported. Public transport errors are fixed messages with stable JSON-RPC codes and never include provider details. These browser boundary checks do not authenticate arbitrary HTTP clients. Run `node --test test/proxy-origin.test.mjs test/proxy-errors.test.mjs` from the repository root after installing dependencies.

# Consumer guide: arkiv-chunking browser sample

This sample demonstrates one integration: upload a file to Arkiv, retrieve it, verify integrity, and offer an attachment download. Read [README.md](./README.md) for the exact setup, testnet prerequisites, limits and error recovery. Read the [package API and guide](../README.md) before changing the integration. This file adds agent-specific decisions rather than repeating those instructions.

## Ask the developer

- Do they want retrieval only or wallet-backed upload? Retrieval requires no wallet.
- Which Tiramisu RPC are they authorized to use, and does it require a browser-appropriate access key?
- For upload, which test wallet should connect and does it have testnet funds? Let the developer connect it; never ask for or copy its private key.
- Is the example file intentionally public, and what expiration does the use case need?
- Does the application need a digest obtained independently of the manifest for authenticity? Do not infer trusted authorship from internal hash agreement.

Do not invent credentials, silently select a mainnet or add unrelated capabilities. If publication is blocked, report it; do not claim that a tarball is a registry release.

## Integration invariants

- `src/main.ts` imports the published package name. Keep the exact package version in `package.json`; no parent-source aliases, vendored chunking code or hidden monorepo linkage.
- Keep writes behind deliberate file selection, public-data acknowledgment and wallet approvals. Never automate wallet setup or sign with a bundled key.
- Check wallet and RPC network IDs. Never bypass the package's manifest, chunk, digest or testnet validation.
- Keep RPC values in the form's memory only. Provider exceptions may contain secrets: render safe errors, never raw exceptions or request payloads.
- Treat all filenames, returned metadata and manifest keys as untrusted strings: assign text through `textContent`, not HTML. Downloads are attachments; never iframe or render uploaded content.
- Expose a download only after complete verification. On new attempts, clear the previous download and revoke the old object URL.
- Failed writes do not imply rollback. Show the incomplete manifest when known; do not auto-retry an ambiguous transaction.
- All deliverable content and user-facing copy must be in English. Use the existing typography contract and canonical Arkiv tokens documented in the README.

## Verify an integration

Run the README from a clean checkout. Confirm the displayed package version and `npm ls arkiv-chunking @arkiv-network/sdk viem`. Exercise a non-sensitive file spanning at least two chunks and a zero-byte file; independently compare saved bytes with originals. Also retrieve by manifest key after page reload without a wallet.

Check no wallet, wallet rejection, wrong wallet network, wrong RPC network, malformed key, RPC failure, missing/expired parts, interrupted upload and hash mismatch. Use an isolated browser profile or controlled mocks for wallet failures; never alter the developer's real wallet to simulate them. Label mocks as mocks and record separate on-chain evidence.

Run the build and the browser checklist in the README. Report exact runtime/dependency/network versions, transaction or manifest evidence safe to share, and every untested or blocked path. Do not claim tests listed here were performed without running them.

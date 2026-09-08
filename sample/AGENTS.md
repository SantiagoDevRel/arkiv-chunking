# Consumer guide: Arkiv Files sample

Integrates published `arkiv-chunking` with a browser wallet, automatic retrieval, verified downloads and an inspectable query. Read [README.md](README.md) for the single source of truth on setup, workflow, design and recovery; read the [package guide](../AGENTS.md) for API invariants. [CLAUDE.md](CLAUDE.md) points here.

## Ask the developer

- Are they opening an existing manifest or storing public test data? Only storage needs an authorized signing wallet and test GLM.
- Which test account should connect, and what approximate expiration date should the file use? Configure secrets in the wallet, never in chat or browser source.
- Is the built-in synthetic file sufficient, or which approved public file should replace it?
- Does retrieval require a trusted digest from outside the manifest? Internal integrity is not proof of author identity.

The default Tiramisu public connection needs no RPC input or access key. Do not ask for credentials that this integration does not need. Faucet and setup links belong to README.

## Invariants

- Import the exact published npm dependency. Never copy its chunking/storage/validation code or use a parent-source alias.
- Storage follows an explicit Store & verify action and wallet approvals. No consent checkbox is required by this sample. No write occurs on page load, file selection or connection alone.
- Network switching is a wallet request triggered by a user action, targeting Tiramisu only. Check account and network before every signature and stop if they change during upload.
- Dates are approximate. Use `expiration.ts` with fresh SDK network timing, preserve admission limits and reject invalid/stale inputs. Never pretend a selected date is a guaranteed deadline.
- Separate confirmed storage from failed readback. Retry verification must call only the read path, never re-upload. Retain an uncertain upload's manifest for inspection.
- Clear old results on new attempts and expose downloads only after full verification. Metadata is untrusted text; neutral attachments never render uploaded content.
- Keep the fixed RPC configuration internal. Never expose raw provider errors, credentials, or signing keys in the UI or logs.
- Explorer URLs use the verified Tiramisu indexer origin and validated keys/hashes. Blocks use `/block?block=NUMBER`; entities use `/entity/KEY`.
- Query examples must work with the documented package/SDK versions. Do not replace the complete file verifier with a bare manifest query.
- Chunk inspection is a read-only view of actual entities. Pin its query snapshot and ownership, verify its returned payloads with the published package, and keep inspection failures separate from a verified download. Never show synthetic payloads as retrieved data.
- Start dark unless the visitor saved a light preference. Use the official SVG logo and its recorded provenance; do not replace it with styled text or recolor it.
- All UI, documentation and guides are English. Reuse the documented Claude Design composition and Arkiv tokens; prototype simulations and injected runtime files do not belong in the app.
- Keep each explanation in one place. Reserve the status area for actual feedback; show query details on demand. Essential actions and errors must remain visible, and disclosures must work with keyboard and touch.

## Verify

Follow README from a clean checkout and confirm `npm ls` plus the displayed package version. Exercise the built-in file, a custom multi-chunk file, an empty file, date limits, stale timing, no wallet, wrong network, wallet rejection/account change, missing/corrupt data and confirmed storage followed by failed readback. Retry must not increase the write count. Compare the actual saved download with the original bytes.

Open a real manifest after reload without a wallet. Run the displayed query and inspect the explorer's content, not only its HTTP status. Inspect the complete screen and all states at the documented widths, with long text and zoom. Label simulated and real checks separately. Audit final changes with Claude and report evidence and unverified boundaries. Localhost review precedes any public deployment.

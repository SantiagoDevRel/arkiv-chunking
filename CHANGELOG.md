# Changelog

## 1.1.0 — candidate

- Added: root exports writeWithPolicy, WriteConfirmationPendingError.
- Preserve the existing transaction policy and all previous exports; no storage or transaction behavior change.

## 1.0.0 — candidate

- Breaking: requires SDK 1.0.0 (peer ^1.0.0), Rabdi configuration and an explicit access key.
- Breaking: format v2 stores binary data and JSON metadata in non-indexed bytes columns. Earlier storage formats are not read by this version.
- Export ManifestSchema and ChunkSchema. Manifest digest/completion, chunk reference and sequence columns are indexed.
- Replace cursor snapshots with bounded keyset pagination, immutable-chunk checks and manifest revalidation.
- Preserve upload failure manifest keys and confirmed hashes; no automatic ambiguous-write retries.
- Migrate the sample to server-only read access and a user-configured wallet RPC; add an idempotent synthetic Rabdi seed.
- Keep observed confirmed transaction links visible for partial-upload recovery.
- Bound new Rabdi lifetimes to 7,883,970 blocks (network maximum 7,884,000 less 30 inclusion blocks); use a single absolute deadline for manifest and chunks. Longer storage requires coordinated Lifetime Extension outside this API.
- Make unsigned latest-state gas estimation, explicit per-write gas/gasPrice/latest nonce and receipt checks part of uploadFile. Add a txParams policy override; allow one retry only after a confirmed gas-exhausted revert.
- Document head-only state RPC errors and gas-limit exhaustion recovery.

Historical releases remain immutable in npm and Git history. This candidate is not published until release approval.

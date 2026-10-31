# Changelog

## 1.0.0 — candidate

- Breaking: requires SDK 1.0.0 (peer ^1.0.0), Rabdi configuration and an explicit access key.
- Breaking: format v2 stores binary data and JSON metadata in non-indexed bytes columns. Earlier storage formats are not read by this version.
- Export ManifestSchema and ChunkSchema. Manifest digest/completion, chunk reference and sequence columns are indexed.
- Replace cursor snapshots with bounded keyset pagination, immutable-chunk checks and manifest revalidation.
- Preserve upload failure manifest keys and confirmed hashes; no automatic ambiguous-write retries.
- Migrate the sample to server-only read access and a user-configured wallet RPC; add an idempotent synthetic Rabdi seed.
- Keep observed confirmed transaction links visible for partial-upload recovery.

Historical releases remain immutable in npm and Git history. This candidate is not published until release approval.

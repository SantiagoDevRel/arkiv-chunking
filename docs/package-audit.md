# Independent package audit ? 2026-09-09 UTC

Artifact: `arkiv-chunking@0.1.0`, SDK 0.8.0, viem 2.56.3. The UI revision does not change the npm artifact.

| Reviewer | Executed evidence | Verdict |
| --- | --- | --- |
| Muse | Compared available tarball, installed consumer and compiled JS/types; 34 repository tests and 35 independent local probes | No blocking findings |
| Grok Build (Grok 4.6) | Checked registry metadata/integrity; 43 adversarial probes against the installed release, 34 repository tests, anonymous Tiramisu missing-manifest/network checks | No blocking findings |
| Claude Code | Fresh registry tarball and consumer comparison, byte-identical rebuild, 27 library tests redirected to the registry package, 13 independent probes and npm audit | No blocking findings |

All reviewers were instructed to work independently, make no source edits and send no transactions. Claude's first process reached its 15-minute time limit; the same session resumed and delivered its final verdict. Its 27 library tests plus 7 sample date tests reconcile with the root's 34-test count.

The root separately installed exact dependencies into a new empty consumer, compiled the public TypeScript API, ran the installed README example, and recovered two real Tiramisu chunks totaling 120,001 bytes. The displayed query, published `downloadFile`, and an independent SHA-256 agreed. Registry integrity and runtime evidence are in [polish-verification.json](polish-verification.json).

## Scope and remaining limitations

- This is scoped verification, not a claim of absolute security. Reviewers did not send new real wallet transactions. Earlier release reports contain the real signed write evidence; this revision repeated anonymous reads and controlled wallet failure tests.
- Muse's local probes ran under Node 20.20.2 in WSL and could not fetch a fresh registry artifact because its npm cache was read-only. Its artifact comparison used the existing delivery/consumer files. Root, Grok and Claude used Node 22.22.3; fresh registry verification was completed independently by root and Claude.
- `expectedSha256` pins bytes, not publisher identity or filename/MIME metadata. An owner can change the manifest. Filenames and MIME values remain untrusted input. The sample uses text rendering and neutral download blobs.
- Validation rejects path separators, ASCII control characters, `.` and `..`. It does not reject every misleading filename, Unicode directional character, leading dash or platform-reserved basename. Consumers that write files or invoke commands must choose safe output paths/names and never interpolate metadata into shell commands.
- The immutable npm README differs from current source documentation in its browser-test description. Its bundled verification report explicitly identifies itself as the release-time snapshot.
- No rollback, resumable upload, encryption or access control is provided. Buffers are limited to 32 MiB. Other SDK versions and networks remain unverified.

Session references: `muse-ba7901`, `grok-build-2b435f`, `claude-bcdb2c`. These identify local audit records; consumers need only the public API, README and consumer AGENTS guides.

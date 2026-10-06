# AUD-008 security probes

These scripts review MnemoCode commit `2d80c86c050c7e3b7de395b9f96548867c9cd44c` without changing application source. They use published BIP39 phrases, the committed `vectors/candidates-v1.json`, and synthetic buffers only. Run from the repository root after its documented `pnpm build`, using Node.js 26.10.0 through `~/.local/bin` and Python 3.

Every runtime command should be wrapped by `record-command.py`, with a new label each time, to preserve its log and command ledger in the locally ignored `AUD-008-evidence` folder. For example:

```sh
python3 docs/audits/AUD-008-harnesses/record-command.py --label security-age-rerun --timeout 30 -- node docs/audits/AUD-008-harnesses/security-age.mjs
```

- `security-age.mjs`: X25519 round trips, changed/truncated ciphertext, wrong identity, unsupported stanza policy, fresh randomness and unavailable-RNG rejection. It performs no scrypt computation. Expected baseline exit: 0, with counts only.
- `security-files-limits.mjs`: exclusive publication, 0600 files, replacement of a symlink rather than its target, staging cleanup, a bounded `/dev/zero` read and rejection of an oversized PNG before decompression. Linux only. Expected baseline exit: 0.
- `security-cancellation.py`: real CLI date recovery on a pseudo-terminal with the canonical protection flags. It sends SIGINT after the first progress count, waits at most 0.75 seconds, and kills its own process group before three seconds total. Expected fixed behavior: exit 0, CLI return 130, private screen cleared. The reviewed baseline exits 1 because date recovery continues after SIGINT; a forced kill cleans up the probe. It retains only counts/timing, not the terminal transcript.
- `security-permissions.mjs`: actual CLI permission snapshots written to regular files. Canonical flags deny network and worker access. Deliberate caller grants remain effective, which is recorded as a defense-in-depth observation; expected baseline script exit: 1 with three broader-permission observations. No network operation occurs.
- `security-cleanup.mjs`: bounded instrumentation captures references to mutable candidate buffers to inspect overwrites on success and forced failure. Capturing a reference deliberately keeps it alive, so this does not establish production garbage-collection lifetime or secret compromise. Expected baseline exit: 1 for the recorded cleanup gaps; the script itself wipes its captured public buffers and removes its temporary public files.
- `security-stdio.mjs`: isolates stdout/stderr capture behavior with a synthetic marker, including a case that never hardens the process. It was diagnostic work on the tool sandbox's pipe failure, which the coordinator independently confirmed outside the sandbox. Sandbox results cannot be classified as an application defect. Expected host exit: 0; sandbox exit can be 1.

Passphrase/scrypt interoperability is shared from the coordinator's scoped test evidence. The security reviewer did not repeat full suites, canonical builds, or high-memory computations.

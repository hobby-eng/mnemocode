# AUD-020 harnesses

These scripts support the Codex Security review of the menu and re-encoding changes on top of commit `8de80e24c7e98b14a443cb9a0e3dc43aa73a7917`, with dirty-tree source fingerprint `72537600bec47c9f390e3cca811c50396b55ca8f654b1b8c1d51395a6c0f01dd`. They are review tools, not release verification.

Run from the repository root with its pinned Node.js and pnpm, Python 3, installed dependencies and a fresh `pnpm build`. Use only the included public BIP39 fixtures. Never substitute a real seed phrase or wallet reference.

## Reproduction

```bash
node docs/audits/AUD-020-harnesses/warning.mjs
```

This compares the library's fingerprint warning with the real CLI output. The baseline result is a JSON record with `libraryReturnsFilterWarning: true`, `cliClaimsConfirmed: true` and `cliShowsFilterWarning: false`. Exit 0 means that the reported omission was reproduced; after a fix, this baseline probe must fail because its original observation no longer holds. It does not search for a fingerprint collision or demonstrate theft.

The retained execution-only probe used an absolute runtime path. This published copy obtains the repository from the current directory; its portable replay is recorded separately.

## Bounded checks

```bash
python3 docs/audits/AUD-020-harnesses/run.py replay-source pnpm check
python3 docs/audits/AUD-020-harnesses/run.py replay-reencode pnpm exec vitest run test/re-encode.test.ts --maxWorkers=1 --no-file-parallelism
python3 docs/audits/AUD-020-harnesses/run.py replay-pty python3 docs/audits/AUD-020-harnesses/reencode-pty.py
```

Use a fresh label each time. The recorder retains command/source hashes, UTC timestamps, exit status and memory observations in the ignored `docs/audits/AUD-020-evidence/`. It uses the frozen AUD-014 guard through AUD-017: 768 MiB Node heap, a 120-second deadline, at least 4 GiB available at start, and termination below 3 GiB. A failed check exits non-zero. The two PTY recipes exercise the new command, confirmation and private-screen clearing; they do not generate PDFs or cards. A real POSIX terminal is required; Windows uses the existing script's pywinpty prerequisite and was not executed in this audit.

The Codex execution sandbox caused the retained source-gate and CLI-output failures. Identical bounded runs outside it passed; no assertion or protection was relaxed.

## Record generation and validation

`report.py` consumes the retained audit payload, original command evidence and the sealed Codex Security scan. It exports the workspace's Markdown/JSON record and copies evidence into the ignored audit folder. It refuses to replace an existing report and does not modify the sealed scan. The payload and raw evidence are local only.

```bash
python3 docs/audits/AUD-020-harnesses/report.py /path/to/aud-020-payload.json
python3 docs/audits/AUD-020-harnesses/validate.py
```

Validation requires the existing Python `jsonschema` package and the workspace's canonical schema. It checks the schema, paired finding IDs, original source manifest, command/log bindings, procedure hashes and privacy. Later source changes are reported separately and do not rewrite the historical snapshot. Exit 0 with a JSON `valid: true` record is success; any failed assertion exits non-zero. These checks establish record consistency and stated coverage, not cryptographic certification or release acceptance.

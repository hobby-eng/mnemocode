# AUD-001 harness scripts

These are the audit-only scripts of [AUD-001](../AUD-001-2026-09-27.md), the full audit of
mnemocode at commit `983dd55225e4b5e18de63cbdb423d216fed24105` with a dirty working tree. That
commit belongs to the history before the rewrite of 2026-09-28 (see
[Commit identifiers in these reports](README.md#commit-identifiers-in-these-reports)). The scripts
produced the command logs and probe results the report cites. Those logs are kept locally by the
maintainer and are not published; the report states the commands, counts and outcomes.

The scripts are kept byte for byte as they ran, so they still contain the paths of the audit
machine, such as `/tmp/mnemocode-aud-001`. Adjust the paths before running them, use a disposable
workspace, and use only the public test inputs they already contain. Never point them at real
wallet data.

| Script                   | What it does                                                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run.py`                 | Runs one command in the workspace with a 300-second limit and writes `<name>.log` and `<name>.command.json` (command, UTC times, exit code, SHA-256) |
| `run-long.py`            | The same with a 1200-second limit, for the render matrix                                                                                           |
| `run-actual.py`          | The same, run in the project checkout during the test-only remediation phase                                                                       |
| `run-tests-update.py`    | The same, run in the copy with the updated tests                                                                                                   |
| `audit-static.mjs`       | Static review: parses the TypeScript sources, checks formatting with Prettier and hashes the files                                                 |
| `audit-probes.mjs`       | Boundary probes of the core encoding, records, SSKR policies, transports and card templates                                                        |
| `audit-extra.mjs`        | Bitcoin address matching (upper and mixed case), the empty catalogue case and package contents                                                     |
| `audit-output-alias.mjs` | Reproduces AUD-001-SEC002: overwriting the input through a parent-directory alias of `--output`                                                    |
| `audit-render-matrix.mjs` | Renders every card template at every page size and orientation, 16 × 4 × 2 PDFs                                                                   |
| `audit-final-checks.mjs` | Decodes the QR codes of exported PNG and JPEG files and checks file and directory permissions                                                      |

## How to run them

1. Make a disposable workspace, for example `/tmp/mnemocode-aud-001/workspace`, with a copy of
   the reviewed source, and run `npm ci` and `npm run build` there. The `.mjs` scripts import
   `./dist/...`, so copy them into the workspace root.
2. Create `/tmp/mnemocode-aud-001/evidence` for the logs.
3. Run each probe through a runner, from any directory, as the audit did:

   ```sh
   python3 run.py boundary-probes node audit-probes.mjs
   python3 run.py extra-probes node audit-extra.mjs
   python3 run.py output-alias node audit-output-alias.mjs
   python3 run-long.py render-matrix node audit-render-matrix.mjs
   python3 run.py image-export-verification node audit-final-checks.mjs
   python3 run.py static-review node audit-static.mjs
   ```

4. Compare each `<name>.log` with the row of the same name in the report's Checks table. The
   runners print the command record and the end of the log; `exitCode` 124 means the time limit
   was reached. `audit-static.mjs` imports Prettier from the audit machine's npm cache; point
   that import at an installed Prettier first.

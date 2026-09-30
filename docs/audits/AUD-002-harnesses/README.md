# AUD-002 harness scripts

These are the audit-only scripts of [AUD-002](../AUD-002-2026-09-27.md), the full audit of
mnemocode at commit `7b059c73411663b7e45088b32adef99baecc96b0`, which belongs to the history
before the rewrite of 2026-09-28 (see
[Commit identifiers in these reports](README.md#commit-identifiers-in-these-reports)). They
produced command logs and probe results the report cites. Those logs are kept locally by the
maintainer and are not published; the report states the commands, counts and outcomes.

The scripts are kept byte for byte as they ran. They were run from the repository root while they
lay in `docs/audits/AUD-002-evidence/harnesses/`, so their imports climb four folders
(`../../../../dist/...`) and some of them read or write files in `docs/audits/AUD-002-evidence/`.
Use a disposable checkout and only the public test inputs they contain; never point them at real
wallet data.

| Script                 | What it does                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib.sh`               | Defines `run <name> <command>`: runs a command and writes `<name>.log` and `<name>.command.json` (command, UTC times, exit code, SHA-256) into the evidence folder |
| `render-matrix.mjs`    | Renders every installed card template at every page size and orientation with QR codes enabled                                               |
| `sskr-cards-probe.mjs` | End-to-end SSKR check: exports real SSKR cards, rasterizes them, decodes the QR codes and recovers the phrase from quorums                    |
| `fragment-qr-check.mjs` | Decodes the QR code of every single SSKR fragment and compares it with its own printed reference (50 of 50 in the report)                    |

## How to run them

1. In a disposable checkout of the reviewed commit, run `npm ci` and `npm run build`.
2. Recreate the original location and the evidence folder they expect:

   ```sh
   mkdir -p docs/audits/AUD-002-evidence/harnesses
   cp docs/audits/AUD-002-harnesses/* docs/audits/AUD-002-evidence/harnesses/
   ```

   `lib.sh` sets its evidence folder `E` to the audit machine's path; change it to the checkout's
   `docs/audits/AUD-002-evidence` first.

3. From the repository root, as the audit did:

   ```sh
   . docs/audits/AUD-002-evidence/harnesses/lib.sh
   run render-matrix node docs/audits/AUD-002-evidence/harnesses/render-matrix.mjs
   run sskr-cards-probe node docs/audits/AUD-002-evidence/harnesses/sskr-cards-probe.mjs
   run fragment-qr-check node docs/audits/AUD-002-evidence/harnesses/fragment-qr-check.mjs
   ```

   `fragment-qr-check.mjs` reads `sskr-cards-probe.json`, so run it after `sskr-cards-probe.mjs`.

4. Compare each `<name>.log` and JSON result with the row of the same name in the report's Checks
   table; every run should exit with code 0.

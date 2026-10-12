# AUD-016 harnesses

These scripts review the uncommitted AUD-015 fixes and the owner-authorized fast self-test additions in MnemoCode. HEAD was `2fc56164591bae26696cc15395bec18b064141c1`; the reviewed source fingerprint was `c3da06153358ded064fdaff0d65bebaa6170274a2fe39eda30a19af4a5edd8ef`. The paired AUD-016 report records the final source manifest separately. Run in the existing repository checkout with its installed toolchain and dependencies. Every input is a public fixture. No script generates PDF files or cards.

## Bounded recorder

`run.py` reuses the frozen AUD-014 command recorder through AUD-015's retaining helper. It copies original evidence bytes into the ignored `AUD-016-evidence/` folder. Labels are exclusive: choose a fresh label on every run. The recorder requires 4 GiB of available host memory before starting, stops its own process group below 3 GiB, limits the Node heap to 768 MiB, and times out at 120 seconds. Run commands sequentially.

```bash
python3 docs/audits/AUD-016-harnesses/run.py snapshot review
python3 docs/audits/AUD-016-harnesses/run.py check build pnpm build
python3 docs/audits/AUD-016-harnesses/run.py check edges node docs/audits/AUD-016-harnesses/residual-probes.mjs
```

`residual-probes.mjs` imports the existing `dist/` build, so build it from the intended snapshot first. It tests cancellation while a listed-code fingerprint is awaited, valid getter-based wallet answers, and cleanup of partial typed arrays when transport decoding throws. A separate changing-getter split case is a robustness observation. The reviewed snapshot produces six failed checks and exits 1. It does not print a person's secret, invoke a renderer, or replace ordinary tests. After relevant fixes, the same checks should exit 0.

## Fast known answers and timing

```bash
python3 docs/audits/AUD-016-harnesses/run.py check oracle python3 docs/audits/AUD-016-harnesses/representation-oracle.py
python3 docs/audits/AUD-016-harnesses/run.py check timing node --import tsx docs/audits/AUD-016-harnesses/startup-profile.mjs
```

`representation-oracle.py` computes the zero-entropy BIP39 indexes with Python SHA-256, then independently packs their decimal representation into RGB and Private Use Area codes. It first reproduces the retained 12-word vector and compares the 24-word answers against the startup literals. It imports no MnemoCode encoder and replays no full vector set. Success exits 0 and prints public answers.

`startup-profile.mjs` measures three quick core checks from the existing build and current sources, plus the first SSKR check including engine initialization. It excludes imports and never calls the full self-test. Capture the build identity before running: a later run compares whichever build is currently in `dist/`. The original local timing record used the c3da0615 baseline build; its old `baseline-c3da0615` label refers only to that recorded run. Times are observations, never acceptance limits or a speedup claim.

The 58 new ordinary tests are `test/startup-edges.test.ts`, `test/sskr-boundaries.test.ts`, and `test/sskr-startup-gate.test.ts`. They cover exact forward/reverse answers, failure gates, SSKR policy/entropy boundaries, cleanup and retries. Run them with one worker:

```bash
pnpm exec vitest run test/startup-edges.test.ts test/sskr-boundaries.test.ts test/sskr-startup-gate.test.ts --maxWorkers=1 --no-file-parallelism
```

## Report records

`write-report.py` publishes only AUD-016 and its index row from retained evidence. `validate-report.py` needs Python's installed `jsonschema` package and checks the canonical JSON envelope, procedure and harness hashes, source bindings, log hashes, historical report bindings, finding IDs, Markdown consistency and privacy. The old AUD-014/AUD-015 reports are immutable inputs. The validator does not claim release readiness or rerun any test. Run both after recording checks:

```bash
python3 docs/audits/AUD-016-harnesses/write-report.py
python3 docs/audits/AUD-016-harnesses/validate-report.py
```

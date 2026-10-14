# AUD-025 contract harness

This harness checks the cancellation and coded-error remediation review based on commit `44f7c735d152b0d38a36f66f890487fc56638682` with uncommitted changes. The report records the reviewed source fingerprint; this commit alone does not identify the working tree.

Use the repository's pinned Node.js and dependencies, build the current checkout, then run:

```sh
pnpm build
node docs/audits/AUD-025-harnesses/contract-checks.mjs
```

It calls real compiled library and CLI entry points using only the public BIP39 zero-entropy phrase. It checks native error kinds, stable immutable codes, cause preservation, and that rejected selectors do not repeat the synthetic phrase. Expected output is `Coded error and concealed-selector contracts passed.` with exit code 0. It writes no exports and generates no PDFs.

The regression tests `test/error-catalog.test.ts`, `test/error-privacy.test.ts`, `test/code-rules.test.ts`, and the final-assessment cases in `test/sskr-share-modules.test.ts` provide the additional contracts. The Linux terminal probe is `python3 scripts/verify-terminal-input.py` after the build. The report distinguishes executed checks, retained earlier results, interruptions and checks not run; rerunning a harness is not release acceptance.

To repeat a small check with the same host reserve and sampled descendant RSS guard, use a fresh label:

```sh
MNEMOCODE_NODE_HEAP_MIB=256 MNEMOCODE_CHECK_RSS_MIB=1024 python3 -B docs/audits/AUD-025-harnesses/bounded-check.py repeat-core node node_modules/vitest/vitest.mjs run test/core.test.ts --pool=threads --maxWorkers=1 --no-file-parallelism --reporter=dot
```

The helper writes local ignored evidence only, stops below a 3 GiB host reserve or above its selected RSS budget, and has a 120-second deadline. It samples memory; it cannot prevent every brief peak or control unrelated applications. It reuses the retained source-fingerprint implementation from AUD-021/AUD-017/AUD-014. The originally executed scratch runner is retained locally with its exact hash; the published helper changes only its output location, root selection and introductory description.

All report times are UTC (+00:00). Local original evidence is excluded from publication.

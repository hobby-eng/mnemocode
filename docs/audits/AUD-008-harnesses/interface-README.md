# AUD-008 interface probes

These scripts belong to MnemoCode AUD-008 and reviewed commit `2d80c86c050c7e3b7de395b9f96548867c9cd44c`. They use the installed Node.js 26.10.0 toolchain, current freshly built `dist/`, the public BIP39 zero-entropy mnemonic, and the public example date `23-09-2026`. They do not edit production files or turn off the application's Node permission protections.

Run from the existing repository root after the coordinator builds `dist/`. All outputs go to the ignored, local-only `docs/audits/AUD-008-evidence/` directory. Output names must be new: preserve earlier runs, and use a separate evidence label for a rerun. The artifact probe needs local Poppler `pdftotext` and `pdftocairo`; it never downloads a renderer. The narrow-terminal probe uses Linux `pty` and an independent minimal VT replay of the actual output, with raw bytes retained.

```sh
python3 docs/audits/AUD-008-harnesses/record-command.py --label interface-contracts --timeout 90 -- /home/user/.local/bin/node docs/audits/AUD-008-harnesses/interface-contracts.mjs
python3 docs/audits/AUD-008-harnesses/record-command.py --label interface-narrow-terminal --timeout 90 -- python3 docs/audits/AUD-008-harnesses/interface-narrow-terminal.py
python3 docs/audits/AUD-008-harnesses/record-command.py --label interface-artifact --timeout 90 -- /home/user/.local/bin/node docs/audits/AUD-008-harnesses/interface-artifact.mjs
python3 docs/audits/AUD-008-harnesses/record-command.py --label interface-record-review --timeout 90 -- python3 docs/audits/AUD-008-harnesses/interface-record-review.py
python3 docs/audits/AUD-008-harnesses/record-command.py --label interface-validate-review --timeout 90 -- python3 docs/audits/AUD-008-harnesses/interface-validate-review.py
```

`interface-contracts.mjs` checks actual CLI record and PNG QR outputs in all five representations, exact restoration through both inputs, and plain pipe output. It also reproduces the displayed equivalent command changing a shell-sensitive synthetic filename, using only a harmless Bash argument-printing function. Its expected exit code at the baseline is **1**, because the confirmed presentation contract fails. It retains the wrong-date result as an optional runtime-message improvement.

`interface-narrow-terminal.py` captures the real protected menu at 120 and 40 columns, presses Down twice, and retains raw output and replayed screen text. The baseline shows one visible selected item at 120 columns and three stale selected markers at 40 columns. Its expected exit code at the baseline is **1**. Neither this probe nor its screen replay claims an incorrect underlying command dispatch.

`interface-artifact.mjs` renders one actual `business-glass-4in1` A6 portrait PDF and PNG through the normal CLI. It checks eight printed references, page dimensions, empty PDF metadata, exact QR payload in the actual PNG, and the real JPEG adapter's output container. Its expected exit code is **0**. The JPEG QR is not independently decoded. The coordinator should inspect `interface-card-images/page.png`; it is generated evidence, not a committed asset.

`interface-record-review.py` verifies the baseline identity and unchanged production/test/vector bytes, binds source, commands and artifacts by SHA-256, and saves the English scoped handoff as `interface-review.json`. Its expected exit code is **0**. The audit coordinator owns final report schema/link validation, the combined evidence manifest, the shared harness README and the audit index.

`interface-validate-review.py` uses the locally installed Python `jsonschema` module to validate the scoped handoff against the shared audit schema, reject duplicate JSON keys, and check source and retained evidence hashes. It saves `interface-review-validation.json` and exits **0** when these checks pass. It does not validate the coordinator's final Markdown/JSON pair.

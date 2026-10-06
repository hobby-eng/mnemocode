# AUD-008 SSKR remediation recheck

`recheck-sskr-contracts.mjs` checks only AUD-008-FUN001 and AUD-008-API006 against the current dirty remediation snapshot above reviewed commit `2d80c86c050c7e3b7de395b9f96548867c9cd44c`. It uses the public `vectors/sskr-v1.json` file and fixed synthetic entropy/seed bytes. It does not modify production sources, tests, dependencies, workflows, or retained baseline evidence.

After the coordinator builds the current TypeScript sources, run from the repository root with Node 26.10.0:

```bash
python3 docs/audits/AUD-008-harnesses/record-command.py \
  --label recheck-sskr-contracts --timeout 120 -- \
  /home/user/.local/share/nodejs/node-v26.10.0-linux-x64/bin/node \
  docs/audits/AUD-008-harnesses/recheck-sskr-contracts.mjs
```

The harness prints one JSON result per bounded matrix or check and a final count. It checks altered members in every order, bad and valid surviving pairs, complete surplus groups at group thresholds 1 and 2, exact incomplete-group indexes, the CLI warning, and the backup check's disclosure. Compatibility checks construct tagged UR directly to retain its tag, covering both accepted tags, untagged standard transports, every supported entropy width, short and wide CBOR headers, first/middle/last token repair, and marked/intact joint repair in both input orders. Two small cancellation checks cover an already-aborted signal and the existing progress checkpoint.

Exit zero means every stated assertion passed. Exit one preserves each failed acceptance assertion while running the remaining matrix. In particular, the backup-check assertion intentionally requires that unchecked members cannot receive an undisclosed `restores` result. This is the original finding's disclosure alternative applied to incomplete groups, not a requirement that fewer-than-threshold shares be cryptographically authenticated.

The first run incorrectly expected intact recovery of the non-minimal wide CBOR header for a 21-byte payload. The unchanged dCBOR decoder rejects this header before repair; the repaired harness tests its standalone transport repair while explicitly retaining intact/joint refusal as a decoder limitation. The initial script bytes remain locally at `AUD-008-evidence/recheck-sskr-initial-harness.mjs`, and the original failing sandbox/host runs remain unchanged. Canonical long headers for larger payloads must still recover and repair normally.

Logs and command records are local evidence under `docs/audits/AUD-008-evidence/recheck-sskr-*`. The reviewer did not build or execute tests independently; the coordinator owns execution and binding the generated artifacts to the final source manifest.

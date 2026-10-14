# AUD-021 harnesses

Pre-release baseline audit of MnemoCode 0.1.0 on HEAD `8de80e24c7e98b14a443cb9a0e3dc43aa73a7917` plus the recorded dirty working tree. The initial source fingerprint and any later drift are recorded in the report and ignored local evidence. The original baseline audit did not authorize production changes; the owner subsequently authorized the separately recorded remediation.

Use the repository's pinned Node.js and pnpm, installed dependencies and Python 3. All fixtures are public BIP39/SSKR vectors or synthetic data. Never substitute real wallet material. Run from the repository root:

```bash
python3 docs/audits/AUD-021-harnesses/run.py snapshot initial
python3 docs/audits/AUD-021-harnesses/run.py check source pnpm check
python3 docs/audits/AUD-021-harnesses/run.py check format pnpm format:check
python3 docs/audits/AUD-021-harnesses/run.py check build pnpm build
python3 docs/audits/AUD-021-harnesses/run.py check tests pnpm exec vitest run --maxWorkers=1 --no-file-parallelism --testNamePattern '^(?!.*(?:reads the sample cards of every design, one page each|draws one design, or every design in one PDF, from the public test phrase)).*$'
```

Every label must be fresh. Exit 0 means the command passed; nonzero preserves its failure. The frozen AUD-014 guard is reused through AUD-017; it records exact commands, UTC times, exit status, source/log hashes and memory. Node heap is 768 MiB, commands have a 900-second deadline, startup requires 4 GiB MemAvailable, and commands stop below 3 GiB. Checks are run one at a time. Renderer-heavy tests are selected only after their output size is inspected. Full card-gallery generation is excluded by the owner.

Raw command evidence stays in ignored `docs/audits/AUD-021-evidence/`. The source snapshot excludes audit records so that writing the report does not change its code identity. A source change invalidates any affected earlier result and is reported explicitly. The audit is not release publication or independent cryptographic certification.

## Small defect reproductions

After the build, run these one at a time. They assert that the reviewed defect is present, so exit 0 means its reproduction passed on this baseline; an unexpected result exits nonzero. They are not remediation acceptance tests. They use public vectors in `vectors/mnemocode-v1.json`, `vectors/sskr-v1.json` and `vectors/candidates-v1.json`, plus synthetic byte arrays. No exhausted search, scrypt work, large image or full gallery is needed.

```bash
node docs/audits/AUD-021-harnesses/core-probes.mjs
node docs/audits/AUD-021-harnesses/security-probes.mjs
node docs/audits/AUD-021-harnesses/document-probes.mjs
pnpm exec vitest run --config docs/audits/AUD-021-harnesses/probe.config.ts --maxWorkers=1 --no-file-parallelism
```

- `core-probes.mjs` checks declared-word-count mark loss, marked shares with decoys, non-byte candidate entropy, mutable re-encoding confirmation and the bounded late-progress observation. Each result is a Boolean JSON field.
- `security-probes.mjs` calls the real QR decoder with two tiny valid-CRC synthetic PNGs and passively observes dimensions/inflation. The maximum expansion is 65,536 bytes. It also checks a malformed published age identity in the error. Temporary probe files are removed.
- `document-probes.mjs` checks legacy wrong-date guidance, repeated help-limit literals and the UTC tag recipe without rendering or making a tag.
- `export-probe.ts` uses the actual encode dispatcher with passive save adapters and deterministic randomness. The ordinary Vitest configuration does not include it. It compares three planned collections without rendering. The first harness attempt tried to mutate a frozen renderer and failed before assertions; the corrected adapter replaces a host service. Both logs remain in local evidence.

For independent correctness checks, the existing `docs/audits/AUD-005-harnesses/seedshift-oracle.py` checks 6,000 public comparisons and published vectors. `scripts/verify-sskr-known-answers.py` first reproduces published SSKR recovery and then independently checks the local length fixtures; it does not establish independent share generation.

## Bounded real output and release artifacts

```bash
node docs/audits/AUD-021-harnesses/representative-output.mjs
node scripts/build-executable.mjs output/aud021-executable
node scripts/verify-executable.mjs output/aud021-executable
```

`representative-output.mjs` uses existing public card fixtures and real production renderers. It generates exactly five single-page PDFs and PNGs in ignored `output/aud021-representative/`, verifies page count and absent metadata, and reads the QR payload with Poppler and jsQR. A fragment must have no QR; other payloads must match exactly. It writes `manifest.json` with sizes/SHA-256. Exit 0 means all assertions passed. It never loops over the template catalogue or generates a full gallery. The executable commands use the documented builder and verifier in an isolated output directory, leaving the owner's existing `release/` file intact. Neither command signs or publishes.

## Owner-authorized remediation

The production acceptance tests are `test/aud-021-*.test.ts`; unlike the original probes, they require the defects to be absent. Run them in one worker. Original failures and overlapping reruns are retained, never added together as a new full-suite count.

`representative-output.mjs output/aud021-remediation-representative` selects a fresh ignored destination, preserving baseline outputs and their hashes. `remediation-heirs.mjs` renders only two worst-length A6 front/back public instruction sheets, verifies truthful mode-specific advice, page count and absent metadata, then makes back-page images for visual inspection. No complete gallery is generated.

`parity-inventory.mjs` enumerates the fresh build's canonical command options, fact constants, capabilities and public exports without running their operations. Its [60-workflow notes](parity-notes.md) separate library functions from host equivalents and unsupported combinations. This is an input to the separate joint Deriver parity audit, not proof that browser UI/worker wiring or regressions pass. The sibling repository remains owned by its own session.

Use `--source-fingerprint SHA256` to bind the coordinator's supplied wider snapshot and `--evidence-name NAME` for a fresh ignored output name. The default name is `remediation-parity-inventory`; existing evidence is never overwritten. The source and build manifests are independently computed, while the supplied wider fingerprint is explicitly identified as supplied.

`remediation-record.py REMEDIATION-SNAPSHOT-LABEL` appends the source-bound remediation to the paired record and validates the canonical schema, paired finding statuses and anonymous UTC text. It preserves the baseline snapshot, reproduction claims and all original checks. It requires a fresh snapshot and checks every hash before writing. The original `finish.py` is not rerun on modified source. Raw evidence remains unchanged.

The optional ignored `remediation-joint-parity.json` binds the separate Deriver matrix, final source manifests, command logs and HTML artifacts. Only a completed source integration with all 60 obligations mapped and no confirmed source omission changes BLD001 to `fixed`. Every bound evidence hash is checked before writing. Unexecuted actual-browser acceptance remains a limitation; this does not mark a release or finding `verified`.

`remediation-package.py NPM-COMMAND-LABEL` checks a retained successful `npm pack --dry-run --json --ignore-scripts` record and its log hash. Every published audit record and public harness file must be included; raw evidence, caches and generated outputs must be absent. It does not create an archive or publish anything.

`remediation-executable.mjs` verifies a fresh `output/aud021-remediation-executable/` build from an empty temporary folder: version/help, exact public word indexes, published masking, recognised re-encoding, SSKR split/combine and an actual local PNG QR. It requires the documented native builder first and a fresh `dist/` build for its public fixtures/QR producer. It creates no PDF and runs neither the full self-test nor a gallery. Exit 0 means every assertion passed; the ignored `verification.json` binds the executable SHA-256 and UTC completion. It leaves the owner's existing `release/` executable untouched.

Published report time zone: UTC (+00:00). Machine-owner home paths in report text are `/home/user/...`; executable tools still use actual runtime paths. Privacy-only corrections do not claim that historical checks were rerun.

## Report generation and validation

`finish.py` consumes ignored local command records, `findings-source.json`, procedure hashes, `initial-snapshot.json` and `final-snapshot.json`; its output is the paired AUD-021 Markdown/JSON report. It requires Python `jsonschema`, validates the canonical schema, duplicate keys, paired finding IDs/severities, unchanged non-audit source, and published English/home-path privacy. Command log hashes are checked before publishing their summaries. It writes local `report-validation.json` and `SHA256SUMS`. The coordinator also checks committed links, index consistency, UTC metadata and ignored/staged evidence separately. Missing inputs or a failed check produce a nonzero exit.

```bash
python3 docs/audits/AUD-021-harnesses/run.py snapshot final
python3 docs/audits/AUD-021-harnesses/finish.py
```

Original timeout attempts remain visible even if a scoped rerun passes. Test timeouts and assertions are not changed. `AUD021_TIMEOUT_SECONDS` can select a 1–900 second outer command deadline; it is unrelated to cryptographic parameters or per-test limits.

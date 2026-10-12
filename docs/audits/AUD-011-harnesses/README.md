# AUD-011 architecture audit harnesses

These scripts support the targeted source audit of MnemoCode at `7dd510b648015a4d553b5be24ab2564f6edbb6b2` on 2026-10-08. They do not certify recovery correctness or release readiness, and do not change production source. Run them in the existing repository checkout, from its root. Node.js 26.10.0, the installed lockfile dependencies (esbuild and Vitest), Python 3 and the already installed `jsonschema` package are required. No private wallet input is required.

- `record-command.py` runs one command, retains its exact arguments, timestamps, combined output, exit status and output SHA-256 in the ignored `AUD-011-evidence/` folder, and propagates failure.
- `inventory.py` records tracked and untracked non-ignored files outside the audit folder and their SHA-256 values. It inventories source and tooling, relative imports and identical ten-line windows. Windows overlap and can contain legitimate fixtures; their count is not the number of duplicated rules. Its lexical import graph includes type-only edges and is only a search aid.
- `runtime-graph.mjs` transforms TypeScript with esbuild without executing project modules, resolves relative imports to existing files and computes strongly connected components. It consumes the baseline source manifest. It strips type-only imports before checking cycles; it does not resolve arbitrary computed imports or inspect upstream dependencies.
- `validate-report.py` rejects duplicate JSON keys, validates the schema and report IDs, checks all 32 procedure ledger entries, source stability, command and procedure hashes, source anchors, count arithmetic, links and unstaged local evidence. It writes the validation summary and evidence checksum file. It requires the original local evidence; a fresh checkout of reports alone cannot reproduce historical snapshot validation.
- `behavior-probes.ts` uses the actual public readers to reproduce padded-number acceptance differences and the cloud-containment miss for a synthetic `..notes` descendant. No file is created and no phrase is derived or searched. It exits nonzero when a baseline assertion fails; after remediation it should be replaced by positive regression expectations for the intended behavior.

Record a baseline and inspect runtime dependencies:

```sh
python3 docs/audits/AUD-011-harnesses/record-command.py inventory python3 docs/audits/AUD-011-harnesses/inventory.py baseline
python3 docs/audits/AUD-011-harnesses/record-command.py runtime-graph node docs/audits/AUD-011-harnesses/runtime-graph.mjs
```

The targeted existing boundary tests are:

```sh
python3 docs/audits/AUD-011-harnesses/record-command.py module-boundaries pnpm exec vitest run test/portable-modules.test.ts test/one-coin-builds.test.ts
```

At the audited snapshot these pass 85 tests. They verify portable composition, not semantic uniqueness of every rule.

Run the two bounded baseline behavior probes:

```sh
python3 docs/audits/AUD-011-harnesses/record-command.py behavior-probes node --import tsx docs/audits/AUD-011-harnesses/behavior-probes.ts
```

After writing the report, capture the unchanged review end and validate:

```sh
python3 docs/audits/AUD-011-harnesses/record-command.py review-end python3 docs/audits/AUD-011-harnesses/inventory.py review-end
python3 docs/audits/AUD-011-harnesses/validate-report.py
```

Successful checks exit zero and print JSON summaries. Invalid links, hashes, anchors, counts or source changes make validation fail. Inventory merely reports clone candidates and cycles; their presence is not a harness failure and requires manual review. The initial graph probe's sandbox `spawnSync git EPERM` failure and the retry's mistaken `.ts` resolution of generated JavaScript remain in the evidence as harness failures; the final version reads the snapshot manifest and resolves generated JavaScript correctly. The first report validation also retained an unsupported absolute link-with-line target; the report was corrected to portable relative source links and validated again.

Full vector replays, PDF/raster/QR matrices, Docker rebuilds, browser suites, executable builds and CI dispatch are deliberately excluded. Run long release checks only when release verification is requested.

# AUD-028 audit harnesses

This audit reviews the uncommitted MnemoCode tree above
`f2d4cffa5d7df369910243734f287ce6521ed033`. The report identifies the exact
reviewed source bytes. It is a read-only baseline, not remediation or release approval.
All timestamps are UTC.

## Bounded command runner

`run.py` reuses the retained `AUD-026-harnesses/audit.py` Linux `/proc` memory
guard. There is one implementation of its process-tree accounting, termination and
source fingerprinting. Python's standard library and the project's pinned toolchain
are sufficient; no packages or repository copies are created.

From the repository root, for example:

```sh
AUD026_RSS_MIB=1536 AUD026_HEAP_MIB=256 \
  python3 -B docs/audits/AUD-028-harnesses/run.py core-check pnpm check
```

Choose a fresh label for every command. The runner retains the exact command,
UTC start/end, exit code, output hash, before/after source identities and sampled
memory data under the local, ignored `AUD-028-evidence/` folder. It exits nonzero
when the command fails or reaches a memory/time boundary. Limits are an aggregate
process-tree RSS budget at most 2 GiB, a 3 GiB host-memory reserve, and a 256 MiB
Node heap by default. The prefix remains `AUD026_` because the unchanged guard owns
those environment names.

Run commands sequentially after agreeing on the shared runtime slot. Do not use
this example as permission to generate all cards, run excluded PDF/image tests,
replay full-cost vectors, rebuild canonical WASM or dispatch CI. The report records
which checks were executed, reused, excluded or blocked, without adding overlapping
test totals. Public BIP39/SSKR fixtures and synthetic data only.

## Bounded discrepancy probes

Build the current source with `pnpm build` first. These probes import only the
compiled modules they need and use public fixtures already in the repository.
Run each through `run.py` with a fresh label; a finding reproduction exits 1
when the described discrepancy is present, and assertion/setup failures also
exit nonzero. Read the JSON observations to distinguish these outcomes.

```sh
python3 -B docs/audits/AUD-028-harnesses/run.py text-probe node docs/audits/AUD-028-harnesses/text-boundaries.mjs
python3 -B docs/audits/AUD-028-harnesses/run.py share-probe node docs/audits/AUD-028-harnesses/share-boundaries.mjs
python3 -B docs/audits/AUD-028-harnesses/run.py wasm-probe node docs/audits/AUD-028-harnesses/wasm-output.mjs
python3 -B docs/audits/AUD-028-harnesses/run.py cli-probe node docs/audits/AUD-028-harnesses/cli-boundaries.mjs
python3 -B docs/audits/AUD-028-harnesses/run.py frame-probe python3 -B docs/audits/AUD-028-harnesses/terminal-frames.py release/mnemocode-0.1.0-linux-x64
```

- `text-boundaries.mjs`: one-line card text and invalid word-lookup selectors;
  LF is a coded-refusal control. No renderer is called.
- `share-boundaries.mjs`: a genuine public restored set with a gated truthful
  wallet callback, mutable host revision, immutable/nonmatching controls, and
  the direct-date admissibility rule. No owner wallet material is used.
- `wasm-output.mjs`: pinned unmodified WASM/glue, one public 32-byte recovery,
  JS-output wiping, and the actual freed output pointer recovered from its
  retained return frame. It logs all matching positions; its failure predicate
  tests the last half, not an all-byte postcondition. It neither replaces the
  allocator nor claims whole-heap erasure or external exposure.
- `cli-boundaries.mjs`: literal POSIX path controls and a quoted-apostrophe
  round trip, a caught/awaited invalid table Promise, and help/default values.
  The async values are observations; path/default discrepancies determine its
  exit status. No shell is evaluated or started.
- `terminal-frames.py`: Linux text-only native PTY, 80x24 finite VT-frame
  reconstruction, share/candidate overflow and the PTY-driver descriptor.
  It reuses `scripts/terminal_session.py`, closes its own probe descriptors,
  and removes its synthetic input file. The frame oracle is not a screenshot
  or a universal emulator/multiplexer scrollback test. It requires the named
  native executable, which this audit does not rebuild or publish.

## Public operation inventory

`public-surface.mjs` is the frozen syntax-only inventory used for this report.
It parses source through TypeScript 5.9.3; it imports no product module. The
retained parser must be available at the workspace's
`tmp/cancel-check/node_modules/typescript`. It reads the local audit snapshot
manifest (`AUD-028-evidence/snapshot.json`, `files` rows of `path` and `sha256`),
checks identities, resolves named/star export filters, and records declarations,
public members, imports and test calls. A matching snapshot can be captured
from Git's tracked and nonignored paths, excluding this audit's own files.
The source fingerprint additionally excludes all `docs/audits/` paths.

```sh
AUD026_RSS_MIB=256 AUD026_HEAP_MIB=128 \
  python3 -B docs/audits/AUD-028-harnesses/run.py public-surface \
  node --jitless --max-old-space-size=64 --max-semi-space-size=1 \
  docs/audits/AUD-028-harnesses/public-surface.mjs
```

Expected audited result: 456 parsed modules, no parse diagnostics or hash
mismatches, 718 package export bindings and 642 unique definitions. Outputs
`public-surface.json` and `test-call-inventory.txt` stay in local ignored
evidence. Exit 0 means syntax/export/hash checks passed; it is not semantic
coverage, runtime acceptance, or a proof that every defect was found.

## Report validation

`validate-report.py` requires the environment's already installed Python
`jsonschema` module and the read-only canonical schema at the sibling workspace
path documented in the report. It validates this Markdown/JSON pair, duplicate
JSON keys, all 32 task IDs, finding/severity agreement, disjoint test totals,
unchanged baseline source and native artifact, command/log hashes, relative
report links, privacy/UTC and ignored/unstaged evidence. No product is imported.

```sh
python3 -B docs/audits/AUD-028-harnesses/validate-report.py report-validation-local
```

Use a fresh label each time. Exit 0 means these report/binding checks passed;
exit 1 retains diagnostics. It writes local `report-validation.json`, an
immutable labeled log/command record and regenerated `SHA256SUMS` (excluding
the checksum file itself). It does not turn a failing product audit into a pass.
The initial validator's timestamp regex confused a DD-MM-YYYY public fixture
with an offset; that report-harness mistake and its correction are retained.

`identifier-precondition.mjs` challenges the random negative fixture without a
random-collision loop. It generates two sets with distinct public seeds, changes
only the second set's 16-bit identifier while preserving its CBOR and CRC, then
requires all three own quorums to restore the public phrase. Distinct-ID rejection
is the control. Equal-ID metadata preflight returning no problem exits 1: that is
a permitted protocol case contradicting the test's assumed precondition, not a
production reconstruction failure.

```sh
python3 -B docs/audits/AUD-028-harnesses/run.py identifier-probe node docs/audits/AUD-028-harnesses/identifier-precondition.mjs
```

The initial audit probe passed text instead of bytes to `shareInfo`; its failed
attempt and original script are retained locally. The published corrected probe
uses the declared byte-array contract. No product input guard was changed.

## Remediation closure

The baseline scripts above are frozen reproductions of the audited source. The later authorized remediation is recorded separately in the report and JSON addendum. Ordinary regressions now include `test/aud-028-boundaries.test.ts`, `test/private-result.test.ts` and `test/sskr-output-wipe.test.ts`; the PTY driver includes finite-frame paging and descriptor closure.

`validate-remediation.py` validates the canonical JSON schema, preserved original findings/baseline fields, all17 dispositions, exact current source and ten engine pins, command/log hashes, final-gate binding and ignored unstaged evidence. It requires the baseline validator's existing Python jsonschema environment and local baseline report/source evidence. It does not run product tests.

```sh
python3 -B docs/audits/AUD-028-harnesses/validate-remediation.py
```

Exit0 means the recorded closure bindings passed; any failed assertion exits nonzero. A second full audit, complete browser/platform acceptance or a release is not implied. The old validator is intentionally tied to the old snapshot and is not used to validate repaired source.

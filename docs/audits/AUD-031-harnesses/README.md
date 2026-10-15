# AUD-031 audit harnesses

These scripts support the full audit after the AUD-030 remediation. The frozen dirty baseline
contains 599 non-audit files and 1,015 total input files; its source fingerprint is
`54edf4a5bc588673d6034f460c76d7867ddd6be63b905094cea90dfba8b7275e`.
The signed base is `0d7898fed2efc4af59b2bff91b0da77d1f99315f`.
Inventory or report assembly alone is not a completed semantic review.

## Inventory

Run once from the repository root after all implementation and test writers stop:

```sh
node docs/audits/AUD-031-harnesses/inventory.mjs
```

The command writes ignored local evidence to `docs/audits/AUD-031-evidence/`. It records every
tracked or trackable file except this audit's own records, hashes, Git identity and a tracked
diff. New untracked implementation files are hash-bound by the inventory; the diff alone cannot
reconstruct them. It never makes another checkout or installation copy.

The already installed workspace scratch TypeScript 5.9.3 parser inventories exported
declarations, public class constructors/members, interface members and static/dynamic imports.
Computed imports are retained as unresolved edges with their expression and line, requiring
manual review; their expressions are never executed. Nameless interface call, construct and
index signatures are included. Type aliases remain declaration entries: callable/intersection
expansion and inherited members need a manual supplement. The script
installs nothing and fails if that parser is absent or reports invalid syntax. The project
continues to use its pinned TypeScript 7 compiler for acceptance. The inventory distinguishes
declarations from callable operations and requires supplements for Rust, generated interfaces
and runtime-only members. Inventory entries start unreviewed.

AUD-030's local snapshot is required to identify unchanged bytes. A byte match is only a reuse
candidate: reviewers must also assess dependency, caller and procedure identities and state the
retained review depth. It never turns matching hashes into an automatic passing review.

The tracked binary diff uses the same own-audit exclusion as the file list. Companions and the
diff are written before the snapshot is admitted. The final snapshot is written privately and
then linked into place atomically without replacing an existing snapshot. A refusal before
that step can leave incomplete companions or a pending file; preserve failed command logs.
Only a complete snapshot prevents another capture. Run one inventory writer with source
writers stopped; incomplete companions may be replaced on a corrected retry.

Exit 0 prints inventory counts and a source fingerprint. An existing snapshot, missing input
or parser failure exits nonzero. The retained snapshot is never overwritten. All product
probes use only the repository's existing public vectors or synthetic data.

## Inventory regression probes

```sh
node --experimental-vm-modules docs/audits/AUD-031-harnesses/inventory-probes.mjs
```

The probes execute the unmodified inventory module with synthetic filesystem and Git edges
in a Node.js VM, using the real existing TypeScript parser and error catalog. They create no
real capture or project copy. Eight cases cover failed companion/diff/partial-marker writes,
corrected retries, retained bytes, anonymous interface signatures, literal/computed imports and
the binary diff's own-audit pathspec. A read-only real Git listing additionally checks that the
same pathspec excludes this audit and retains admitted source paths; it does not stage or
simulate a real staged own-audit diff. Exit 0 means all eight probes passed;
any failure exits 1. The VM flag applies only to these audit probes, not to the program.

## Runtime manifest probes

Build the reviewed source first, then run from the repository root:

```sh
node docs/audits/AUD-031-harnesses/runtime-probes.mjs
```

This calls the real built `SskrRuntime` with a synthetic bundled-file reader. Only the returned
manifest bytes change; the checkout, generated JavaScript and WASM are never edited or copied.
Six cases require the existing safe integrity code/message, no untrusted cause, one shared
in-flight load and a healthy retry restoring the public counting-entropy SSKR vector. At the
baseline, null and malformed JSON fail the stable-code assertion before their healthy retry is
reached; four other refusal/retry controls pass. Exit 1 preserves any failed assertion. A corrected loader must pass all six,
with exit 0. These are loader-contract checks, not a canonical rebuild or erasure proof.

## Restore ownership probe

```sh
node docs/audits/AUD-031-harnesses/restore-owner-probes.mjs
```

The real `ShareRestore` reads the public marked counting-entropy vector with the real Node
share platform. A transparent observer retains its public `read` result; it forwards the
original call unchanged and restores the original property descriptor afterwards. A synthetic
host limit accessor then throws. The probe requires that failure to propagate and the actual
owned plan to refuse a later search as disposed. No borrowed dates are disposed prematurely,
and no plan, library result or private helper is replaced. The healthy restore is a separate
positive control. Baseline output is one failed cleanup assertion and one passing control,
exit 1; a corrected restore must pass both. Every observed plan and the input are disposed in
the probe's own cleanup, including after a failed assertion. Public fixture data only.

## Terminal and card owner probes

```sh
node docs/audits/AUD-031-harnesses/terminal-owner-probes.mjs
node docs/audits/AUD-031-harnesses/card-owner-probes.mjs
```

The terminal probe substitutes only the stderr writer, runs the real `TypedAnswer` and BIP39
hint implementation, and restores the writer and column descriptor. A healthy wipe erases the
public letter; a writer throwing during hint cleanup must still erase it. Baseline: one pass,
one failure, exit 1. No raw terminal or operating-system failure frequency is inferred.

The card probe uses actual public SSKR and BIP39 fixtures and the Node card renderer, planning
only. It writes no PDF, image or private export. Three cases require ending-lifetime APIs on a
QR share set, independently converted card set and Encode's retained card cache. They check live
values first, independent caller views and the borrowed backup. Baseline: three missing-lifetime
failures, exit 1. The first retained attempt had an incorrect `#` prefix in one printed-code
expectation; that fixture fault is separate from the corrected three intended failures. The
corrected literal is `8B0C06`. A corrected implementation must pass all three. All created owners
are disposed where their baseline API provides disposal; fixtures contain no real wallet data.

## Report assembly

```sh
node docs/audits/AUD-031-harnesses/report.mjs
node docs/audits/AUD-031-harnesses/report.mjs --publish
```

`report.mjs` assembles ignored `report-preview.md` and `.json` from the retained snapshot,
four primary reviews, interface context admission, coverage, skill usage, findings, guarantees,
artifact/procedure identities and independent evidence in the ignored evidence directory.
It requires the retained baseline inventory and the current harness files; it does not rebuild
the product. Preview exits 0 after structural assembly and prints counts; its independent
review may still be pending. Missing mandatory inputs, duplicate findings, incomplete exact
path/declaration/member/rule/check inventories or source drift fail. Publication with `--publish`
additionally requires completed primary/context dispositions and both final independent
skeptic/completeness acceptances with exact nonempty `reviewedInputs` hashes for all required
dossiers and harnesses. A post-review input change is refused. Successful publication writes
the new UTC-named Markdown/JSON pair and exits 0; existing reports are refused without overwrite.
The required local review files contain the human/AI assessment and cannot be reconstructed by
running a generator. A successful schema or assembly check alone is not semantic acceptance.
The 1,015-file fingerprint excludes this audit's own harnesses and dossiers intentionally;
their final accepted hashes are separate. Raw inventory markers do not supersede the separately
published reviewed contract/member dispositions or their retained-depth qualifications.

## Artwork scratch and font refusal probes

```sh
node docs/audits/AUD-031-harnesses/artwork-owner-probes.mjs
node docs/audits/AUD-031-harnesses/font-refusal-probes.mjs
```

Use the existing build from the exact reviewed source. The artwork probe uses actual bundled
public artwork and Node PNG encoding with a transparent encoder observer. Healthy output must
retain its PNG signature; an independent refusal must propagate the exact synthetic encoder
fault. Both then require derived RGBA scratch to be zeroed. Baseline: two cleanup failures,
exit 1. This checks an owned work buffer, not cached public artwork or arbitrary memory erasure.
The font probe calls actual `fit` with a synthetic external ASCII-only font. Supported public
text must preserve its size; unsupported synthetic text must retain the stable error code and
field label without reflecting its code point. Baseline: one pass and one reflection failure,
exit 1. Corrected implementations must pass both probes, exit 0. Neither probe writes images,
PDFs or private exports. Scratch captured by the probe is wiped in its own cleanup.

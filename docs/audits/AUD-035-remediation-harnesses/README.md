# AUD-035 remediation checks

Run from the repository root with its pinned tools and public fixtures only.
These helpers preserve the original audit evidence and do not create a checkout,
commit, release or host intake. The current status is in
[the remediation register](../../REMEDIATION.md).

`run.mjs LABEL COMMAND [ARGUMENTS]` invokes the unchanged
[AUD-026 recorder](../AUD-026-harnesses/audit.py). It refuses a reused label and
writes the actual command, UTC times, source identities, sampled process-tree
RSS, host available memory and output under the ignored local directory
`docs/audits/AUD-035-evidence/remediation-2026-10-19/`, creating its missing parents
on a first run. Set
`AUD026_RSS_MIB`, `AUD026_HEAP_MIB` and `AUD026_TIMEOUT_SECONDS` for the
particular check. The host reserve is 3 GiB. Sampling is not a kernel RSS cap;
Docker daemon workers are outside the client process tree. Run heavy commands
one at a time after coordinating with other active sessions.

Examples after the source corrections:

```sh
AUD026_RSS_MIB=768 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=180 node docs/audits/AUD-035-remediation-harnesses/run.mjs types corepack pnpm exec tsc -p tsconfig.tests.json
AUD026_RSS_MIB=768 AUD026_HEAP_MIB=256 AUD026_TIMEOUT_SECONDS=180 node docs/audits/AUD-035-remediation-harnesses/run.mjs regressions corepack pnpm exec vitest run test/aud-035-parser-scratch.test.ts test/aud-035-byte-scratch.test.ts test/aud-035-share-input.test.ts test/aud-035-cancellation-contract.test.ts test/aud-035-native-self-test.test.ts
```

`build-native.mjs` invokes the canonical `scripts/build-sskr-wasm.mjs`
unchanged, adding Docker's requested build-container limits of 1,536 MiB and
one CPU. It changes neither Dockerfile nor compilation flags. The first call
writes the generated JS/WASM/declarations and integrity manifest; `--check`
compares another canonical build with them. Both require the owner's native
rebuild authorization and an exclusive heavy-check window. For example:

```sh
AUD026_RSS_MIB=512 AUD026_HEAP_MIB=128 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-035-remediation-harnesses/run.mjs canonical-write node docs/audits/AUD-035-remediation-harnesses/build-native.mjs
AUD026_RSS_MIB=512 AUD026_HEAP_MIB=128 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-035-remediation-harnesses/run.mjs canonical-compare node docs/audits/AUD-035-remediation-harnesses/build-native.mjs --check
```

The receipt records client/host sampling, not independent proof of daemon
cgroup enforcement. A cached build is not a clean-machine or fully offline
build proof: dependency/toolchain preparation may use the network, while the
Dockerfile's final compilation stage is offline. Comparison explicitly bypasses
the `built` stage cache, retaining toolchain/dependency layers. Declared limits and retained
cache use must be reported with the result. Native Rust tests use the repository's
pinned Rust and documented Cargo/Rustup homes, with `--locked --offline --jobs 1`.
The before/after regressions and independent reviews identify each accepted
patch separately. Actual pre-free zero-byte observations are not proof of
physical erasure, optimized assembly behavior or elimination of runtime copies.

`suite.mjs` preserves the original AUD-035 default-file discovery and serial
fresh-worker procedure, writing to the new evidence subdirectory only. It
freezes the actual Vitest default file list and test hashes, executes each file
once with one worker and no file parallelism, and retains each result. A resource
stop remains incomplete; the helper does not automatically retry or exclude a
test. After all fixes, the explicitly requested final release-level verification
uses this helper with a suitable per-file budget:

```sh
AUD026_RSS_MIB=1024 AUD026_HEAP_MIB=384 AUD026_TIMEOUT_SECONDS=600 node docs/audits/AUD-035-remediation-harnesses/suite.mjs
```

## Minimum-quorum follow-up

The host's actual native damaged-quorum counterexample exposed a post-patch
diagnostic regression after the first full run. Its local library regressions
are in `test/aud-035-share-input.test.ts`; the unchanged-before/after real CLI
checker is `test/aud-035-minimum-quorum-cli.test.ts`. Run the latter before
rebuilding the previous `dist/` to see the refusal-message mismatch, then run it
after rebuilding to verify the correction. No assertion or timeout is relaxed.

`minimum-quorum-cli.mjs EXECUTABLE` runs the same damaged public two-of-three
fixture against an actual built executable. It expects an invalid-share
diagnosis with no phrase/share output, rather than an insufficient diagnostic
subset escaping as the original failure. It uses built library modules only
for the public fixture and checksum; the executable does the real recovery.
The following old/new artifact comparison uses one unchanged checker:

```sh
AUD026_RSS_MIB=512 AUD026_HEAP_MIB=128 AUD026_TIMEOUT_SECONDS=180 node docs/audits/AUD-035-remediation-harnesses/run.mjs minimum-artifact-red node docs/audits/AUD-035-remediation-harnesses/minimum-quorum-cli.mjs release/aud035-remediated/mnemocode-0.1.0-linux-x64
AUD026_RSS_MIB=512 AUD026_HEAP_MIB=128 AUD026_TIMEOUT_SECONDS=180 node docs/audits/AUD-035-remediation-harnesses/run.mjs minimum-artifact-green node docs/audits/AUD-035-remediation-harnesses/minimum-quorum-cli.mjs release/aud035-quorum-fixed/mnemocode-0.1.0-linux-x64
```

The first command must fail its diagnosis assertion on the retained old
artifact; the second must pass on the corrected one. Preserve both binaries'
hashes and each actual receipt. These checks supplement the earlier full-run
evidence; their totals must not be added to it or presented as a repeated full
suite on the changed bytes.

## Addendum 2026-10-20: reviewed commit and local inputs

This documentation-only addendum answers AUD-037-DOC002; the scripts are
unchanged. The corrections that these helpers checked were made in the
uncommitted working tree above commit
`261aaedaedeb17ac1e32cd31371c850f740d2ba5`, which stayed HEAD during the whole
remediation. The first complete run after the corrections had the 647-input
source fingerprint
`314ca1bb9ba69896dac5e9167596554f1f08cbed84a5fd5c8cb9976f1ac61ff`. After the
minimum-quorum follow-up, the status reconciliation of 2026-10-19 matched all
648 non-audit inputs to the accepted fingerprint
`e14058722c713600607845159ba456feb8ddb39f93e1be70fcaa4c99c219c4b0`. The
corrections entered the history in `4978a620d43a8571b89ccfc01f3b5a58b3a8c421`,
together with the AUD-036 corrections. The
[register](../../REMEDIATION.md#standard-statuses-2026-10-20) gives the status
and commits of each correction.

Some inputs are not published:

- The receipts and results live in the machine-local folder
  `docs/audits/AUD-035-evidence/remediation-2026-10-19/`. `run.mjs` creates it
  on a first run; `suite.mjs` needs it to exist before it starts.
- The old and new artifact comparison needs two retained local executables:
  `release/aud035-remediated/mnemocode-0.1.0-linux-x64` (SHA-256
  `6520c57450f91ad992dd7560386b07931e0ef7a49008b80ccf21ae8299c7444d`) and
  `release/aud035-quorum-fixed/mnemocode-0.1.0-linux-x64` (SHA-256
  `abc8351632094f9c1312e70b1d2026b126efafcc5bf0abbdb4b5994fd28e85e1`). They are
  not published, so a reader cannot repeat the failing half of that comparison.
- `build-native.mjs` needs Docker and, as above, the owner's authorization for
  a native rebuild.

The helpers need no third-party Python package: the reused AUD-026 recorder
uses the standard library only. A reader can still run `run.mjs` with the
example commands above, `suite.mjs` after creating its folder, and
`minimum-quorum-cli.mjs` against an executable built with
`node scripts/build-executable.mjs FOLDER`. Their results describe the source
they run on.

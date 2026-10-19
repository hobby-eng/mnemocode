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

# AUD-008 build and release review probes

These probes belong to MnemoCode AUD-008 and the reviewed commit
`2d80c86c050c7e3b7de395b9f96548867c9cd44c`. They read the existing checkout and
installed dependencies. They do not build executables or WASM, install packages,
contact a network, or change production files. All inputs are project metadata,
public source, public notices and existing local artifacts.

Run from the MnemoCode repository root with Node.js 26.10.0 and Python 3.11 or
newer. `devops-inventory.py` also needs PyYAML; it used the already installed
PyYAML 6.0.3 on this host. Do not install it elsewhere merely to rerun this probe.
The inventory needs the existing `dist/`, `node_modules/` and Linux executable
and notice files in `release/`, as well as the shared audit procedure and Docker
recipe in the workspace's existing multi-chain-wallet-tools checkout.

```sh
python3 docs/audits/AUD-008-harnesses/record-command.py --label devops-inventory-rerun --timeout 90 -- python3 docs/audits/AUD-008-harnesses/devops-inventory.py
python3 docs/audits/AUD-008-harnesses/record-command.py --label devops-build-failure-rerun --timeout 90 -- node --experimental-vm-modules docs/audits/AUD-008-harnesses/devops-build-failure.mjs
```

`devops-inventory.py` checks direct dependency/installed/lockfile versions,
archive-integrity coverage, Cargo checksum and notice coverage, SSKR manifest
coverage and hashes, matching Docker toolchain stages, pinned actions and
release-job gates, package exports and local README links, and the existing
executable's checksums and notice package versions. It prints a JSON inventory,
including inspected-source and procedure hashes, and exits 0 when its assertions
pass. Exclusion of README-linked documents from the private package's `files`
allowlist is reported as data, not asserted as a release failure. This is a
literal allowlist inspection, not an npm pack result.

`devops-build-failure.mjs` evaluates the exact current executable-build script in
`vm.SourceTextModule`. All filesystem mutations, the bundler, SEA build and notice
writer are mocked in memory. It injects bundler, SEA and notice-generation
failures and prints the remaining artifact/work-directory state and source hash.
It exits 1 while any failure leaves the temporary directory or changes the prior
executable. The baseline therefore expects exit 1; a future fixed script should
preserve the previous artifact set, remove temporary work and exit 0 once the
baseline assertions are updated to the corrected invariant. The probe proves
first-party ordering and failure handling under these mocks; it does not prove
real platform/toolchain failure behavior.

The retained evidence preserves two initial harness mistakes. The first VM run
omitted the `URL` global and stopped before the injected failure. The first
inventory compared `./dist/…` export strings without normalizing `./`; it
incorrectly listed six unselected exports. Both mistakes were corrected and
rerun under new evidence labels; they are not production failures.

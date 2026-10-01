# AUD-005 decisions

The main session asked for the audit and its remediation to be finished without questions. This
record lists every choice where more than one option was reasonable, what was chosen and why,
and what is left for the maintainer. It belongs to [AUD-005](AUD-005-2026-10-01.md).

## Audit

1. **Outcome words in the coverage ledger.** AUD-004 used `partial` and `finding`, which the
   guide does not define. AUD-005 uses only the guide's outcomes (`passed`, `failed`,
   `not-applicable`) and names the finding or the gap in the evidence column.
2. **Severity of the release findings.** BLD001 (a tag publishes without the test suite) and
   BLD002 (no license notices in the executable release) could be read as medium. Both are
   rated low: no release exists yet, neither changes a phrase, record or share, and the guide
   reserves medium for defects in supported behavior.
3. **No Docker rebuild.** The main session uses Docker, so the canonical SSKR WASM rebuild was
   not repeated. Evidence is the equality of all seven hashes with the files AUD-004 rebuilt.
4. **Generated card PDFs.** `scripts/check-card-output.mjs` wrote 29 PDFs to the unignored
   `goldens/`. They were public fixtures produced by the audit, so they were moved into the
   local evidence folder instead of being left in the checkout.
5. **What is not a finding.** `matchBitcoinEvidence` without a location throws a TypeError: it
   rejects the call, which is the contract, so it is noted in the ledger only. The plain-form
   label line that `encode` prints before its result on stdout is the documented plain form.
6. **Observation API004 as `accepted`.** The standard forbids a reviewer to infer acceptance.
   The status rests on the owner's own help text for both behaviors ("An existing file is
   replaced." and "An existing file is never replaced."), which the report quotes.

## Remediation

7. **API001: how strict the record header becomes.** Options: keep reading `MNC01` as version
   1, warn, or refuse. Chosen: refuse a version with leading zeros as a malformed header.
   MnemoCode has only ever written `MNC1:`, so no record it made is affected, and a damaged
   header should be reported, not repaired.
8. **API002: one shared index check.** Instead of copying the range check into the third
   decoder, the existing two copies became one function used by all three, with the same
   message. `assertWordCount` stays at each call site because TypeScript narrows the word
   count there.
9. **SEC001: mode 0700 at creation.** A `chmod` after the cards were written would leave a
   short window; creating the folder with mode 0700 has none and matches `mkdtemp`.
10. **UI001: a clear error instead of a new hidden prompt.** Windows and macOS could get hidden
    input from Node.js itself (raw terminal mode without echo). That would be a new way of
    reading secrets, with its own terminal edge cases, on systems where it cannot be tested
    here. Chosen: refuse early with a message that names Linux and the file and
    standard-input alternatives, and state the limit in SECURITY.md and the README. A native
    prompt for the other systems is left to the maintainer.
11. **UI002: wrap rather than shorten.** The safety line keeps its wording and wraps at the
    80-column help width, as `mhfe` does.
12. **BLD001: a callable CI instead of copied steps.** The release could also have repeated the
    test steps in the executable workflow. Chosen: make `ci.yml` callable and require it on a
    tag, so there is one definition of the checks. On a tag, the standalone CI also runs; the
    duplicate run was accepted for simplicity. The tag check is a step of each build job, so
    that the release job, which has no checkout, needs no change.
13. **BLD002: a notice file per executable, not a command.** Options: embed the notices and add
    a `licenses` command, write one shared file in the release job, or write one file next to
    each executable. Chosen: one file per executable, built from the esbuild list of bundled
    files, so it names exactly what that file contains; each build job writes it, its hash
    joins `SHA256SUMS`, and the existing release step publishes it without other changes.
    `@pdf-lib/fontkit` 1.1.1 publishes no license file; the notice names its declared MIT
    license, author and source rather than inventing a copyright line. The build fails when
    the Node.js `LICENSE` is not next to the running Node.js; official downloads and the
    GitHub runners have it, which only the first CI run on Windows and macOS will confirm.
14. **BLD003: select by name.** The verifier picks this system's executable by the same name
    rule as the build (a shared `scripts/executable-files.mjs`) instead of requiring a folder
    with exactly one file.
15. **BLD004: ignore the folder, keep the default.** The scripts keep writing to `goldens/`
    by default, which the architecture document mentions; the folder is now ignored.
16. **BLD005: what the integrity test demands.** The test requires every file under
    `vendor/sskr/generated/` and `vendor/sskr/rust/` (a Cargo `target/` folder excepted) to be
    pinned. This is stricter than before on purpose: a refresh that adds or changes a file
    without updating `integrity.json` now fails the suite.
17. **DOC001: also a CHANGELOG entry.** Besides the stale Vitest version, the user-visible
    remediation changes (record header, hidden-input message, private share folders, license
    notices, release gate) were added to the unreleased 0.1.0 notes.
18. **The `release/` folder.** A remediation build (`pnpm build:executable`) wrote into
    `release/` and replaced the downloaded Linux executable. Because the build is
    reproducible, the audit rebuilt the snapshot source of `8fbcb13` into a scratch folder,
    got the identical file (`52af2f2b…`) and put it back; `sha256sum --check SHA256SUMS`
    passes for all three files. Its modification time was set back to 07:25, the minute the
    original listing showed; the seconds are not known. Every later build went to the local
    evidence folder.
19. **The timed-out self-test case (observation BLD007).** The final suite had one failure, a
    15-second limit exceeded under a host load average of about 13; the case passes alone.
    Raising the limit to the suite's 60 seconds would follow `vitest.config.ts`, but changing a
    limit to turn a failed run green is what the workspace rules forbid an audit to do. The
    test is unchanged and the failure is reported verbatim.

## Left for the maintainer

- **BLD001 and BLD002 on GitHub.** Both are `fixed`, not `verified`: the changed workflows,
  the Windows and macOS builds and the notice files there run only on GitHub. The first tag
  will show whether the release waits for CI and publishes the notice files.
- **BLD007.** Decide whether the 15-second limits in `test/cli.test.ts` and
  `test/date-recovery-patterns.test.ts` should follow the 60-second suite setting.
- **Hidden input on Windows and macOS.** Decide whether a native prompt is wanted (decision 10).
- **API003.** The JSON output's `algorithm` field could name the mode in a later format
  version; it is unchanged because encoded outputs must not change.
- **BLD006.** Credential persistence in `ci.yml`, the different major versions of the upload
  and download artifact actions, PDF creation dates and unused embedded assets (the CJK font
  subset and the map source) are left as they are.
- **Vendored copies elsewhere.** `src/core/seedshift.ts`, `src/record.ts` and
  `src/export/sskr-cards.ts` changed; projects that vendor MnemoCode's core and card renderers
  need to resync them.
- **The SSKR bridge refresh.** It must keep `vendor/sskr/integrity.json` complete and current;
  `test/sskr-integrity.test.ts` now enforces that.

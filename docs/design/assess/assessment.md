# Assessment of mnemocode-rust

Snapshot: `mnemocode-rust` as on disk on 2026-10-27, unborn Git (no commit). Paths are relative to
the workspace root. The code was written against MnemoCode `d4776f7` (`mnemocode-rust/README.md:16-18`),
which is 140 commits and 809 changed files before the modelled `7d0d4ee`
(`git -C mnemocode rev-list --count d4776f7..7d0d4ee`, `git diff --stat`). Size, every line
of each `.rs` file except `tests.rs` and `tests/`: core 2,602 (522 of them word tables), native
2,010, probes 687.

## Decision

Start over. Carry over the few files listed under "Carry over"; take mhfe's `protect.rs` and
`memory.rs` as the base of the protections and secret memory, with the parts of mnemocode-rust's
Landlock and seccomp code named below.

Why:

1. Coverage. The code touches 8 of 244 capabilities and finishes none: complete dates and the
   shift schedule (CAP-PHRASE-FORMATS-DATES, -SHIFT-SCHEDULE), BIP39 sizes, entropy/checksum and
   exact word lookup (parts of -PHRASE-VALIDATION, -WORD-TABLE-LOOKUP), secret owners
   (-SECRET-OWNERS), and Linux core dumps, seccomp and Landlock (CAP-CLI-LINUX-NO-CORE-DUMPS,
   -SECCOMP, -LANDLOCK). No normalization, form, mode, record, recovery, wallet, SSKR, card, CLI or
   browser binding exists. A restart loses little.
2. Secret memory. Every secret, a 2-byte value too, gets its own mmap with two guard pages, a
   locked page, MADV_DONTDUMP and MADV_WIPEONFORK
   (`crates/mnemocode-native/src/memory/linux/sys.rs:48-130`), and each allocation reads and
   parses all of `/proc/self/smaps` (`memory/linux.rs:29`, `memory/linux/maps.rs:32-42`). A refused
   mlock is an error (`memory/linux/sys.rs:126-128`) that `allocate` turns into
   `MemoryError::Unavailable`, which fails the operation (`memory.rs:85-96`); at one locked page per
   live secret, RLIMIT_MEMLOCK 8 MiB (`ulimit -l` 8192 here) allows about 2,048 live secrets. Every
   constructor and copy of a secret owner takes an allocator parameter (`&impl SecretAllocator`,
   `crates/mnemocode-core/src/memory.rs:73-94,112,135`), and no browser adapter exists to pass.
   The model asks for "a zeroizing buffer with Drop and redacted Debug and Display"
   (CAP-PHRASE-FORMATS-SECRET-OWNERS).
3. Fail-closed process policy contradicts an owner decision. "Missing sandbox parts (seccomp,
   Landlock, Seatbelt, job object...) are never a refusal (owner, 2026-10-13): only reported"
   (CAP-CLI-SECRET-GATE); only core dumps that cannot be switched off refuse a secret.
   mnemocode-rust refuses a secret command on a kernel below Landlock ABI 5
   (`output_policy/linux/sys.rs:11,86`), with an inherited socket, anonymous-inode or device
   descriptor (`isolation/linux/descriptors.rs:25-31`), with an unrequested writable descriptor
   (`output_policy/linux.rs:63-92`), with a second thread or a tracer
   (`isolation/linux.rs:61-89`). The Landlock documentation recommends best effort
   (https://docs.kernel.org/userspace-api/landlock.html).
4. Linux only. Every other system gets `Unsupported` (`protection.rs:35`, `memory.rs:43,75`,
   `isolation.rs:53`, `output_policy.rs:55`), so no secret command runs on macOS or Windows, where
   the current program has CAP-CLI-MACOS-NO-CORE-DUMPS, -DENY-DEBUGGER, -SEATBELT and
   CAP-CLI-WINDOWS-WER-NO-HEAP, -MITIGATIONS, -JOB-NO-CHILDREN.
5. Nothing of requirements 3 to 5: one core crate without features, no WASM crate or binding
   (RUST-15), no port besides memory, no recorded decision, no gate beyond fmt, clippy and tests.
6. Guards no cause can trigger (CORE-54): access revocation after fork (`core memory.rs:73-76`,
   `native memory/linux.rs:42-47`; the program never forks), length checks of its own adapter
   (`MemoryError::WrongLength`), a munmap fault latch (`memory/linux/sys.rs:88,184`), a
   process-bound protection token (`protection.rs:18,42`), repeated re-verification chains, a
   metadata and xattr syscall filter (`output_policy/linux/sys.rs:173-222`; its execve and execveat
   entries, 199-200, are the current program's rule, which the port takes from
   CAP-CLI-LINUX-SECCOMP), refusal of every syscall above 471 (`syscall_filter.rs:21,61`),
   `Zeroizing` around single `u16` bits (`bip39_codec.rs:35,81`), and startup self-tests of its
   own wiping (`memory/self_test.rs:12`, `secret_text/self_test.rs:10`).
7. The documents are a work log of the `d4776f7` port (DOC-03), see "Documents".

## Checks

Run once under `flock tmp/heavy-checks.lock`, `CARGO_BUILD_JOBS=4`, Rust 1.99.0 from its
`rust-toolchain.toml`, target `tmp/rust-arch/design/assess/target` (deleted). Logs:
`tmp/rust-arch/design/assess/checks/`.

| Command                                                | Result                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `cargo fmt --check`                                    | exit 0                                                                                                                                          |
| `cargo clippy --locked --all-targets -- -D warnings`   | exit 0                                                                                                                                          |
| `cargo test --locked`                                  | exit 0: 99 passed (core 71, native 17, probes network 4, outputs 7), 2 ignored helpers that their parent tests run in a child; 3 s, 211 MB peak |
| `mnemocode-native-probes network` (built by the tests) | "Network restrictions verified; namespace: not permitted."                                                                                      |

`tests/outputs.rs:12` writes fixtures into `mnemocode-rust/output/probe-fixtures`; they were
removed on success and the listing is unchanged apart from the folder's time.

## Protections and secret memory: mnemocode-rust against mhfe

| Concern                   | mnemocode-rust                                                                                                                  | mhfe                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core dumps                | RLIMIT_CORE 0, PR_SET_DUMPABLE 0, read back, refuses on failure (`protection/linux.rs`)                                         | same calls, `cfg(unix)` for setrlimit, reported as a self-check row (`src/bin/mhfe/protect.rs:34-49,202-216`)                                                                        |
| Ctrl+\ and Ctrl+Z         | none                                                                                                                            | handlers turn them into Ctrl+C, read back (`protect.rs:57-89`)                                                                                                                       |
| Sockets, io_uring         | seccomp with TSYNC, arch check, 13 calls, everything above 471 (`isolation/linux/seccomp.rs:11-25`, `syscall_filter.rs:23-111`) | prctl filter for the calling thread and later threads, arch and x32 check, 5 calls (`protect.rs:668-707`)                                                                            |
| New programs              | execve/execveat refused only in the output filter (`output_policy/linux/sys.rs:199-200`)                                        | not refused                                                                                                                                                                          |
| Network namespace         | `unshare(CLONE_NEWNET)` alone, which needs CAP_SYS_ADMIN (unshare(2)); observed "not permitted"                                 | `CLONE_NEWUSER \| CLONE_NEWNET`, allowed without that capability (unshare(2) NOTES) (`protect.rs:611`)                                                                               |
| File writes               | Landlock granting only the requested files and export folders (`output_policy/linux/sys.rs:92-143`); refuses below ABI 5        | Landlock granting no write at all, or none applied when a command writes (`protect.rs:593,749-814`); ABI-graded                                                                      |
| Inherited descriptors     | refused (sockets, devices, anon inodes, unrequested writers)                                                                    | trusted offline host, documented (`protect.rs:8-13`)                                                                                                                                 |
| Readback report           | errors only; no self-test rows                                                                                                  | `CoreDumpCheck`, `IsolationCheck`, `LockProbe` rows; isolation probed as holds, broken or unknown; probes behind a test seam (`protect.rs:317-548`)                                  |
| Swap                      | none (RUST-13 asks for the warning)                                                                                             | dm-crypt, LVM and zram detection, testable with a fake root (`protect.rs:829-931`)                                                                                                   |
| Secret buffers            | dedicated mmap per secret, guard pages, mlock, DONTDUMP, WIPEONFORK, smaps readback, fail-closed                                | `LockedText`, `LockedBytes`: zeroizing String and Vec at final capacity, locked before filling, page locks counted across shared pages, best effort (`src/memory.rs:18-160,231-330`) |
| Dump exclusion of buffers | per secret                                                                                                                      | only the Argon2 work area (`src/engine/ffi.rs:282-298`); process-wide no-dump covers the rest                                                                                        |
| Browser                   | no adapter                                                                                                                      | wasm32 stub (`memory.rs:352-358`)                                                                                                                                                    |
| Other systems             | refuse                                                                                                                          | best effort, report "not available"                                                                                                                                                  |

mhfe is better at: best effort with readback reported, a namespace that works unprivileged, the
swap warning, the signal handlers, a small API (Deref to `str` and `[u8]`), and a wasm32 build.
mnemocode-rust is better at: Landlock that still allows the outputs a secret command saves
(MnemoCode saves cards, shares and records during secret commands), seccomp TSYNC that covers
threads already running, and exec denial, which the current program has (CAP-CLI-LINUX-SECCOMP).

mhfe misses: per-output Landlock, TSYNC, exec denial, socketpair left open for a child's stdio
(the current program keeps it for pdftocairo, CAP-CLI-LINUX-SECCOMP), and a library form:
`protect.rs` lives in mhfe's binary, so MnemoCode takes a copy with a note (CORE-10).
mnemocode-rust misses: swap warning, signal handlers, self-test rows, best effort, a working
namespace, any non-Linux or browser path. Both miss: the macOS and Windows protections of the
current program, and any process memory cap (neither sets RLIMIT_AS or RLIMIT_DATA).

## Documents against MnemoCode 7d0d4ee

| Document                             | State                             | Evidence                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                          | stale, DOC-03                     | baseline `d4776f7` (:16-18); Rust 1.99.0 (:21) while mhfe and the SSKR crate pin 1.99.1; describes reviews and acceptances (:7-12)                                                                                                                                                                                                                                          |
| `AGENTS.md`                          | stale                             | one Cargo worker and `../workingspace/cargo-target` (:11-12), 3 GiB reserve (:15); points at PORTING.md                                                                                                                                                                                                                                                                     |
| `docs/PORTING.md`                    | stale, DOC-03                     | baseline (:3-6); "328 canonical option uses" (:8): now 341, `--dates-file` added to 7 commands, `--qr-dir` to 4, `--last-word-file` and `--old-dates-file` to re-encode (`mnemocode/dist/cli/command-options.js` `COMMAND_OPTIONS`); "twelve supported coins" (:18) still true (CAP-WALLET-COIN-REGISTRY); :33-218 is a dated check log; superseded by the capability model |
| `docs/SECURITY.md`                   | true of the code, wrong as a plan | fail-closed (:43,78-79) against the owner decision above; "optional separate network namespace" (:57) is never created for a normal user; no swap warning                                                                                                                                                                                                                   |
| `docs/WALLET-TOOLS-MIGRATION.md`     | stale                             | "200-file TypeScript capsule" (:4): 217 files at `7d0d4ee` (`multi-chain-wallet-tools/packages/recovery-mnemocode/source.json`); asks bindings to keep opaque UTF-16 keys (:34-35,43-47), which in TypeScript is a storage detail (`mnemocode/src/core/secret-value.ts:207`) no Rust capability needs                                                                       |
| `docs/BIP39-WORDLISTS.md`            | true                              | `@scure/bip39` still 2.4.0 (`mnemocode/package.json:400`); BIP39 lists do not change                                                                                                                                                                                                                                                                                        |
| `docs/reference-cli.json`            | stale                             | 328 option uses against 341, the options above missing; pins `d4776f7` files                                                                                                                                                                                                                                                                                                |
| `docs/reference-vectors.json`        | true, redundant                   | the three vector files have the same SHA-256 as `mnemocode/vectors/` at `7d0d4ee`                                                                                                                                                                                                                                                                                           |
| `docs/reference-wordlists.json`      | true, status stale                | hashes and versions hold; "review pending" contradicts PORTING.md:177                                                                                                                                                                                                                                                                                                       |
| `docs/reference-bip39-codec.json`    | true                              | `@scure/bip39` 2.4.0 unchanged; its oracle exists only in ignored `output/checks/`                                                                                                                                                                                                                                                                                          |
| `docs/reference-calendar.json`       | true                              | for a fixture not carried over                                                                                                                                                                                                                                                                                                                                              |
| `docs/reference-date-schedules.json` | binding stale, data valid         | `src/core/dates.ts` hash changed (377db64e… to 8323ea9e…) and the oracle refuses changed source (`output/checks/date-schedule-reference.mjs:16`); `parseDate`, `sortDates` and `deriveShifts` behave the same: the diff changes date patterns and refactors only                                                                                                            |
| `docs/reference-whitespace.json`     | true                              | ECMAScript WhiteSpace and LineTerminator; recorded on Node 26.10.0; the same facts sit in `text_rules.rs:2-3` and its tests                                                                                                                                                                                                                                                 |

In the code, the refusal codes exist in TypeScript at `7d0d4ee` (`dates.ts:9-22`, `words.ts:40`,
`bip39-sizes.ts:16-17`) except `core.bip39-sizes.entropy-length`
(`bip39_shape/error.rs:22`), which TypeScript lacks. The port copies two model defects: the
`String.prototype.trim` rule beside `trimWhiteSpace` (TextRules reproduces the first) and the
code pair `assert-calendar-date-refused`, `-2` (`calendar/error.rs`).

## Carry over

As they are:

- `clippy.toml`, `.prettierrc.json`, `.prettierignore`, `.gitignore`.
- `crates/mnemocode-core/src/text_rules.rs` and `text_rules/tests.rs`: the ECMAScript separator
  rule, tested over every scalar value; drop its `error` and `self_test` modules, `TextRules::trim` with its tests (one trim rule,
  `str::trim`, decided 2026-10-27) and the test at `tests.rs:54-57`.
- `crates/mnemocode-core/src/bip39_shape.rs`, `bip39_shape/error.rs`, `bip39_shape/tests.rs`:
  lengths and last-word sizes for Seedshift, the search plans and the messages; validity is the
  bip39 crate's; drop `self_test` and `EntropyLength`.
- `vectors/bip39-codec-v1.bin`, `vectors/date-schedules-v1.bin`: known answers from the old
  program still valid at `7d0d4ee` (the first now checks the bip39 crate against @scure/bip39's
  answers); their provenance from the `reference-*.json` files is rewritten as one record bound
  to `7d0d4ee`.
- `vectors/mnemocode-v1.json`, `vectors/sskr-v1.json`, `vectors/candidates-v1.json`: identical
  to `mnemocode/vectors/`.

Not carried: `word_table/english.rs`, `chinese_traditional.rs`, `docs/BIP39-WORDLISTS.md` and
`vectors/word-tables-v1.bin`. The design takes `bip39 = "=3.0.0"` with its lists, as mhfe does
(owner, 2026-10-27); the crate's lists equal them entry for entry
(`design/crates/work/bip39-crate/lists.json`), and the self-test's list hashes repeat the vector.

Adapted, not as they are: `output_policy/linux/sys.rs:92-143` (a Landlock rule per output),
`syscall_filter.rs:82-104` (TSYNC install). Everything else is deleted after the coordinator archives the folder, including
the ignored `output/` (about 150 logs, reviews and oracles).

## Owner decisions

Decided on 2026-10-27 (`design/architect/PLAN.md`, "Owner decisions"):

1. The 2026-10-13 rule holds for the Rust port: missing measures are reported, never refused,
   except core dumps that cannot be switched off and, now, a tracer attached on Linux; besides, a
   secret result is refused on a terminal without a private screen. Inherited sockets and
   descriptors: the platform report rejects a check (`L-INHERITED-FDS`, a trusted parent).
2. Memory limits: a process cap (RLIMIT_DATA, a Windows job limit) at the measured peak of the
   heaviest operation plus a quarter, with the free-memory check, beside the page locks.
3. Trimming: one rule everywhere, Unicode White_Space at the ends (TS `trimWhiteSpace`, Rust
   `str::trim`), fixed in the TS first.
4. Refusal codes: the TypeScript codes, except the namespaced `missing-checksum` and the two
   calendar codes renamed for year and month, fixed in the TS first.
5. The bip39 crate 3.0.0, never own BIP39 code.
6. Rust 1.99.1, the newest stable; the guide now says so.
7. No network namespace (out of RUST-10), no exec denials, no limit on child processes; the Windows
   GNU target with a KnownDLL import gate; the answer limit from the longest canonical answer;
   the bc-crypto adapter (d).

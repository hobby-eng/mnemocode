# MnemoCode in Rust: plan

Increments in the order of the capability graph, foundations first. Each capability is listed in
the increment where it is complete: its module is built and every capability it depends on is
complete (`make-plan.py` computes this from `model/graph.json` and the module map, skipping the
edges the design redraws). A command exists from the increment of its library part and grows an
option at a time; it is complete when its last option's capability is.

## The existing mnemocode-rust

Start over, as the assessment decides (`design/assess/assessment.md`): 8 of 244 capabilities
touched and none finished; a secret memory with a locked mmap and a full `/proc/self/smaps` parse
per secret, the operation refused past the lock budget, and an allocator parameter on every
constructor with no browser adapter to pass; a fail-closed sandbox against the owner's rule of
2026-10-13; Linux only.

1. The coordinator archives `mnemocode-rust` (its Git repository is unborn: nothing else keeps it).
2. The folder is emptied except the carry-over files of the assessment: `clippy.toml`,
   the formatter's settings (now `dprint.json`, which leaves `vectors/` alone),
   `.gitignore`; `text_rules.rs` and its tests (without `error`, `self_test`,
   `TextRules::trim` with its tests, and the test at `tests.rs:54-57`); `bip39_shape.rs` (sizes for plans and messages; validity is the bip39 crate's, and one test pins
   every size to it) with its tests and its error without the
   `SelfTest` variant (and `self_test`) and without `EntropyLength`, whose
   `core.bip39-sizes.entropy-length` TS 0.1.0 lacks (`bip39_shape/error.rs:19-26`): no library
   entry takes entropy from a host, and entropy inside an MNCL file has MNCL's own refusal
   (`core.candidate-list` `candidate-list-wrong-entropy-length`, TS `candidate-list.ts:46`); its
   message builds the list of word counts with `text`'s list wording instead of its own `expected`
   (`bip39_shape/error.rs:51-71`; TS `bip39-sizes.ts:41`, `places.ts:7-12`; CORE-10);
   `vectors/bip39-codec-v1.bin` (it now tests the bip39 crate against @scure/bip39 2.4.0's 985
   answers), `date-schedules-v1.bin`, `mnemocode-v1.json`, `sskr-v1.json`, `candidates-v1.json`.
   `vectors/PROVENANCE.json` records each one's SHA-256 and source, which the `code-rules` gate
   checks: the three JSON files are TS `7d0d4ee`'s own, byte for byte; the two binary ones come from
   TS `d4776f7` and are replaced in increment 3 by recordings of the TS repository's
   `pnpm record:rust-parity`. Not carried: the word tables, `docs/BIP39-WORDLISTS.md` and
   `word-tables-v1.bin`; the lists are the bip39 crate's (owner, 2026-10-27), equal entry for entry
   and pinned by the Word lists row's two TS SHA-256 constants
   (`design/crates/work/bip39-crate/lists.json`); the lists' notice moves to
   `THIRD_PARTY_NOTICES.md`.
3. Adapted, not copied: the per-output Landlock rules (`output_policy/linux/sys.rs:92-143`) and
   the TSYNC install (`syscall_filter.rs:82-104`). Everything else, documents included, is gone;
   these design documents take the place of `docs/PORTING.md` and `docs/SECURITY.md`.

The new workspace lives in `mnemocode-rust` until the TS program is retired (last section).

## Parity with TS 0.1.0 (RUST-14)

The TS repository records its known answers itself, in its own language (TOOL-01; owner,
2026-10-27: no Node in this repository): `pnpm record:rust-parity <vectors-folder>` there builds the
program at a clean commit, runs every recorder of its `scripts/rust-parity/` against the build and
writes the data (DOC-04) into this repository's `vectors/ts-0.1.0/`, with `PROVENANCE.json` (the
commit, Node.js, the SHA-256 of every recorder and every file), which `cargo xtask code-rules`
checks here. Each increment adds the recorders of its modules; the commit is the TS one that
holds the fixes of the 17 decided defects landed so far (`7d0d4ee` before the first), for every
file at once:

- library results for public inputs, with a fixed random source passed through the TS host
  parameters (share seeds, card choices, sample phrases);
- `refusals-v1.json`: every TS code, which `cargo xtask code-rules` checks each code of the port
  against, beside the port's own;
- CLI transcripts: argv, standard output and error and exit code (a PDF's bytes differ by design, so
  files are tested by what they hold, not by a hash); the terminal is tested by the pty gate, not by
  recorded sessions;
- card outputs with fixed details and choices (the TS's local `goldens/` folder is untracked and
  not used).

Rust tests replay these files. Byte equality holds everywhere except at the parity levels the
owner set on 2026-10-27:

- PNG files other than page images (QR images, recoloured artwork): equal decoded pixels; the file
  bytes may differ (another deflate).
- QR codes: equal payload bytes, version, error-correction level and decoded content; the mask
  may differ (qrcodegen's penalty against npm qrcode's, tested per payload kind). rqrr reports no
  segment modes, so the TS refusal of Kanji and ECI segments goes; a payload is admitted by its
  content, as before.
- PDF files: the same pages, text, positions and images; the bytes may differ (another writer).
- Page images, PNG or JPEG: the same size, each page's QR decoding to the same payload, and pixels within a
  tolerance of the TS pages, fixed from measurement in increment 9 (tiny-skia against cairo).
- Glyphs and widths: no ligatures (crates report, decision 6).
- NFKD and NFC: Unicode 18 against the TS's 17; they differ only for characters new in 18.

The 25 defects whose fix changes a TS result are decided in `mapping.json` ("how" beginning
with "Decided"): 17 are fixed, one in the documents only, and 8 kept, one with a new warning. A fix is made in the TS first, once reproduced, with
its test and a note to the wallet-tools session where a code, option or message changes; the
capabilities it touches are recorded again from that TS commit, named in the provenance file,
so the fixes add no exception to parity.

Differences from TS 0.1.0 that the owner decided for the Rust program alone (RUST-14 lets the
owner decide them): re-encode asks its new backup's outputs before the old phrase; a save retry
outside the ruled folders is refused; a secret result is refused on a terminal without a private
screen; a tracer on Linux refuses secrets; a card text whose width lies within the ligatures'
saving (ff, ffi and ffl are 31 units narrower than their letters in DejaVuSans-UI) may now be
refused as too long; an answer, file or standard input longer than its question's limit, which
TS reads up to 1 MiB, is refused with that limit, a BIP39 passphrase over 4 KiB included, and the
help names each limit; a missing parent folder of an output file is made before the secret, where
TS refuses it (ARCHITECTURE.md §5); the Protection line and the self-test name no "no other programs"
measure, since no program start is denied; the code `export.platform.checked-choice-refused` is not
ported: only a fake `Random` can give a choice past its bound, `SystemRandom` and `BrowserRandom` keep
`below`'s contract, and CORE-54 leaves no check of it; the output paths are numbered and checked, and
each missing parent folder made, before a command's own options are read, since the rules on writes
need those folders before any secret and the options are read among the secrets, so of a wrong path
and a wrong option the path is named first, and a folder made for a refused command stays; a line of a
secret result that TS writes to standard error goes to standard output where standard error is a
terminal with no private screen; the master key evidence needs Bitcoin in a build (as wallet-tools
builds it: a build without Bitcoin recognises a wallet by its fingerprint or a coin's address); the help
says that images need no other program, that a missing folder is made, and each text input's limit;
U+FFFF is refused as a character the card font lacks, where TS draws it blank, and U+034F measures 0
wide, where TS draws a space of 651 units; two refusals of a partial restore name `ShareSet::combine`,
this library's function, where TS names its own; where `--ask-secrets` cannot run, on a terminal that
cannot clear its screen or with no terminal, that is said before the command's own options, since the
gate that keeps a secret result off such a terminal runs first; an image of noise at 8 megapixels reads
in about 90 seconds where TS takes 34, inside rqrr, whose finder search no bound of ours reaches, and
Ctrl+C acts when the reading ends. Their expected transcripts are the TS recordings with each
difference written in by hand, naming this decision.

## Definition of done of a capability

1. Its library code, in the module `mapping.json` names, with unit tests for its published vectors,
   round trips, refusals, limits and edge cases (CORE-32).
2. Its TS 0.1.0 known answers and refusals reproduced by tests, byte for byte or at the owner's
   parity level (RUST-14).
3. Its CLI options and commands: transcripts equal to the TS ones, interactive steps through the
   pty gate; each question it adds accepts its longest canonical answer and refuses one byte past
   its limit.
4. Its self-check rows in the `checks` order, startup or full tier, built with its feature
   (CORE-27, CORE-30, CORE-31).
5. Its binding module in `mnemocode-wasm`, its `cargo xtask wasm verify` checks in wasmi, the memory
   scan after it, the stack depth of each secret entry measured against the scrub size
   (ARCHITECTURE.md §6), and its note to the wallet-tools session (workspace `AGENTS.md`, "Every
   feature in the browser too").
6. Every gate green (GATES.md), the CORE-45 walk, one independent review (CORE-53).
7. Its status in `mapping.json` still true; a change of it is an owner decision recorded there.

## Increments

| #  | Builds                                                                                                                                                                                                                                                                                                                        | Complete | Increment's own checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0  | the workspace: manifests with `[workspace.lints]` and the release profile, `rust-toolchain.toml`, `clippy.toml`, `module-map.json`, `dprint.json` with its pinned plugins, the `xtask` crate with every gate (TOOL-01) and both CI workflows, the vendored SSKR crates as members with UPSTREAM.json, the TS 0.1.0 recordings | –        | every gate green on empty crates; the recordings' provenance; the KnownDLL list read on the CI's Windows runners, an empty Windows executable checked against it, and the `--dependent-load-flag` probe (W-DLL-SEARCH)                                                                                                                                                                                                                                                                                                                                                                                                           |
| 1  | `secret`, `refusal`, `checksum`, `text`, `random`, `self_check`, `search`; the binding's `host` module                                                                                                                                                                                                                        | 5        | white space over every scalar value (carry-over test); CRC-32 check value; whole numbers, list and place wording and hex units against TS; redaction of every owner; lock probe row; memory scan after a freed and after a reallocated public secret in the WASM; plan sizes and consent thresholds against TS from timed pace samples                                                                                                                                                                                                                                                                                           |
| 2  | the CLI: `os`, `terminal`, `args`, `input`, `output`, `gate`, `main`                                                                                                                                                                                                                                                          | 33       | protection probes and read-backs per system; the start order test (mhfe G10); signals in the pty, exit status 128 + the signal, SIGTERM during a save leaving no staging folder, SIGTSTP stop and redraw included; secret flags refused before parsing; option and file refusals; per-question answer limits, the passphrase and path questions' 4 KiB, the buffer reserved and locked; the tracer refusal; a secret result refused on a terminal without a private screen; Landlock on each output's parent, a missing one made first, and on the private screen; `--version`; sandbox labels as TS without "no other programs" |
| 3  | `bip39`, `dates`, `bip32`, `pack`, the first `checks` rows; `table`; binding `phrase`                                                                                                                                                                                                                                         | 12       | BIP39 and BIP32 published vectors; `bip39-codec-v1.bin` against the bip39 crate; the crate's two lists against the TS SHA-256 constants; `date-schedules-v1.bin`; `table` transcripts; rows Word lists, BIP39 seed, Dates, Date ordering                                                                                                                                                                                                                                                                                                                                                                                         |
| 4  | `forms`, `modes`, `backup`; `encode` without cards and shares                                                                                                                                                                                                                                                                 | 24       | `mnemocode-v1.json`; representation matrix; MNC1 and JSON byte-equal; codes transcripts; rows Core integrity, Public vectors, Representation matrix, Re-encoding, Word hints                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5  | `wallet` with the 12 coins; binding `wallet`                                                                                                                                                                                                                                                                                  | 30       | each coin's known answers; evidence refusals; wallet-option transcripts; rows Wallet evidence, Coin addresses; the `dash-community` profile builds and holds no other coin's text                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6  | `qr`, `candidates`; bindings `qr`, `candidates`; the Scanner's profile                                                                                                                                                                                                                                                        | 13       | PNG admission fixtures; QR write and read back; C2SP CCTV age vectors; `candidates-v1.json`; the encryption gate; `--qr-file` and `--qr` transcripts; rows PNG admission, QR adapter, Candidate lists; the memory cap measured and tested under the largest encrypted candidate list                                                                                                                                                                                                                                                                                                                                             |
| 7  | `sskr` with the engine bridge and the 6 share forms, `shims/bc-crypto` ((d), owner, 2026-10-27); binding `sskr`                                                                                                                                                                                                               | 31       | `sskr-v1.json`, BCR vectors of SSKR, Bytewords and UR; share-form known answers; restore of every split; the engine leaves no copy (memory scan); rows SSKR integrity, Share split and restore, Share repair                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 8  | `recovery` with the backup reading, the three searches and the share restore flows; `decode`, `recover-date`, `recover-word` from their options; binding `recovery`                                                                                                                                                           | 21       | candidate order and counts of every search as TS; a stopped search returns a partial outcome; transcripts of searches with fixed pace; rows Backup reading, Marked codes search, Word search, Backup check, Share unmasking                                                                                                                                                                                                                                                                                                                                                                                                      |
| 9  | `mnemocode-cards` with the 13 templates; card options, `preview`, images; binding `cards` in the Deriver's profile                                                                                                                                                                                                            | 52       | card outputs at the owner's parity level; page count and size rows; heir-sheet text byte-equal; template order; colour maths known answers; every command now complete; rows Heir sheet, Share cards, Card sets, Card export assets; the memory cap checked under the largest card export                                                                                                                                                                                                                                                                                                                                        |
| 10 | the start menu                                                                                                                                                                                                                                                                                                                | 13       | every menu entry in the pty against TS sessions; shell quoting cases (POSIX, cmd and PowerShell); each command a fresh, protected process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 11 | release tooling                                                                                                                                                                                                                                                                                                               | 6        | the reproducible rebuild (GATES `reproducible`); notices; executable verification on the three systems; the signing script's dry run; the release workflow; artifacts per page profile                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Dropped, with their reasons in `mapping.json`: CAP-CARDS-PDF-READER, CAP-CLI-NPM-PACKAGE,
CAP-CLI-PERMISSION-MODEL, CAP-SSKR-ENGINE-LOAD-VERIFIED.

### Capabilities per increment

1: CLI-SAFE-DISPLAY-TEXT, PHRASE-FORMATS-REFUSAL-CODES, PHRASE-FORMATS-SECRET-OWNERS,
RECOVERY-SEARCH-PLAN, RECOVERY-SEARCH-TURNS.

2: CLI-CLOUD-FOLDER-WARNING, CLI-COLOR-RULE, CLI-FAILURE-AND-EXIT, CLI-INTERRUPTION,
CLI-LINUX-LANDLOCK, CLI-LINUX-NO-CORE-DUMPS, CLI-LINUX-SECCOMP, CLI-LONG-SEARCH-CONTROL,
CLI-MACOS-DENY-DEBUGGER, CLI-MACOS-NO-CORE-DUMPS, CLI-MACOS-SEATBELT, CLI-NOTICES-AND-LINKS,
CLI-NUMBERED-NAMES, CLI-OPTION-PARSING, CLI-PRIVATE-FILE-PUBLICATION, CLI-PRIVATE-SCREEN,
CLI-QUESTIONS, CLI-RAW-LINE-EDITOR, CLI-RESULT-PAGING, CLI-SANDBOX-REPORT,
CLI-SECRET-ANSWER-FILE-PATH, CLI-SECRET-ARGV-REFUSAL, CLI-SECRET-FILE-INPUT, CLI-SECRET-GATE,
CLI-STEP-SCREENS, CLI-SWAP-WARNING, CLI-TEMPORARY-FOLDERS, CLI-TERMINAL-LAYOUT,
CLI-TYPED-AHEAD-DROP, CLI-VERSION, CLI-WINDOWS-JOB-NO-CHILDREN, CLI-WINDOWS-MITIGATIONS,
CLI-WINDOWS-WER-NO-HEAP.

3: PHRASE-FORMATS-DATE-PATTERNS, PHRASE-FORMATS-DATES, PHRASE-FORMATS-NUMBERED-DICTIONARIES,
PHRASE-FORMATS-PHRASE-VALIDATION, PHRASE-FORMATS-RECOVERY-GUIDE, PHRASE-FORMATS-RECOVERY-PACK,
PHRASE-FORMATS-SHIFT-SCHEDULE, PHRASE-FORMATS-WORD-TABLE-LOOKUP, RECOVERY-DATES-ANSWER,
WALLET-BIP39-PASSPHRASE-INPUT, WALLET-BIP39-SEED, WALLET-MASTER-FINGERPRINT.

4: CLI-RESULT-PRESENTATION, CLI-SECRET-PROMPT, CLI-WORD-HINTS-TYPING,
PHRASE-FORMATS-COLOR-PLACEMENTS, PHRASE-FORMATS-ENCODED-BACKUP, PHRASE-FORMATS-ENCODED-FINGERPRINT,
PHRASE-FORMATS-FORM-COLOR-UNICODE, PHRASE-FORMATS-FORM-COLORS, PHRASE-FORMATS-FORM-DETECTION,
PHRASE-FORMATS-FORM-ENGLISH, PHRASE-FORMATS-FORM-INDEXES, PHRASE-FORMATS-FORM-SELECTION,
PHRASE-FORMATS-FORM-UNICODE, PHRASE-FORMATS-JSON-OUTPUT,
PHRASE-FORMATS-LAST-WORD-REPLACEMENT-READING, PHRASE-FORMATS-LEGACY-VALID-LAST-WORD,
PHRASE-FORMATS-MASKING-RULES, PHRASE-FORMATS-MODE-DIRECT, PHRASE-FORMATS-MODE-LEGACY,
PHRASE-FORMATS-MODE-SEEDSHIFT, PHRASE-FORMATS-RECORD, PHRASE-FORMATS-SELF-TEST-KNOWN-ANSWERS,
PHRASE-FORMATS-SHORTER-PHRASES, PHRASE-FORMATS-WORD-HINTS.

5: PHRASE-FORMATS-REENCODING-CONFIRMATION, WALLET-ADDRESS-LOCATION, WALLET-ADDRESS-SCAN,
WALLET-BITCOIN-NETWORKS, WALLET-BITCOIN-PROFILES, WALLET-COIN-BITCOIN, WALLET-COIN-BITCOIN-CASH,
WALLET-COIN-COSMOS, WALLET-COIN-DASH, WALLET-COIN-DOGECOIN, WALLET-COIN-ETHEREUM,
WALLET-COIN-ETHEREUM-CLASSIC, WALLET-COIN-INJECTIVE, WALLET-COIN-LITECOIN, WALLET-COIN-REGISTRY,
WALLET-COIN-SELF-TESTS, WALLET-COIN-TRON, WALLET-COIN-XRP, WALLET-COIN-ZCASH,
WALLET-EVIDENCE-ACCOUNT-XPUB, WALLET-EVIDENCE-BITCOIN-ADDRESS, WALLET-EVIDENCE-CHECK,
WALLET-EVIDENCE-COIN-ADDRESS, WALLET-EVIDENCE-MASTER-XPUB, WALLET-EVIDENCE-OPTIONS,
WALLET-EVIDENCE-PUBLIC-KEY, WALLET-EVIDENCE-WIF, WALLET-FINGERPRINT-EVIDENCE,
WALLET-HOST-CHECK-CONTRACT, WALLET-NODE-EVIDENCE-API.

6: CARDS-QR-PNG-EXPORT, CLI-PNG-ADMISSION, CLI-QR-IMAGE-INPUT, PHRASE-FORMATS-ENCODE-QR,
PHRASE-FORMATS-SECRET-SOURCES, RECOVERY-CANDIDATE-DECRYPT, RECOVERY-CANDIDATE-ENCRYPT-KEY,
RECOVERY-CANDIDATE-ENCRYPT-PASSPHRASE, RECOVERY-CANDIDATE-ENCRYPTION-GATE,
RECOVERY-CANDIDATE-FILE-ADMISSION, RECOVERY-CANDIDATE-LIST-FORMAT, RECOVERY-CANDIDATE-LIST-WRITER,
RECOVERY-CANDIDATE-PROTECTION-CHOICE.

7: CARDS-SHARE-KEEPING-NOTE, SSKR-COMBINE-LIBRARY, SSKR-ENGINE-COMBINE, SSKR-ENGINE-MEMORY-WIPE,
SSKR-ENGINE-SPLIT, SSKR-EXPORT-SET, SSKR-FORM-BYTEWORDS, SSKR-FORM-CHOICE, SSKR-FORM-COLOR-UNICODE,
SSKR-FORM-COLORS, SSKR-FORM-UNICODE, SSKR-FORM-UR, SSKR-FORM-WORD-NUMBERS, SSKR-HOST-PLATFORM,
SSKR-JOINT-ASSESS, SSKR-JOINT-SEARCH, SSKR-MARK-SYNTAX, SSKR-MIXED-LAYOUT, SSKR-REPAIR-ONE-SHARE,
SSKR-REPAIR-REPORT, SSKR-RESTORE-COMPLETE, SSKR-RESTORED-SET-FACTS, SSKR-SET-CHECK,
SSKR-SET-CHOICE, SSKR-SHARE-ANY-FORM, SSKR-SHARE-BYTES-METADATA, SSKR-SHARE-QR-MATCH,
SSKR-SHARE-TROUBLE, SSKR-SPLIT-BACKUP, SSKR-SPLIT-PHRASE, SSKR-TYPED-SHARES.

8: PHRASE-FORMATS-BACKUP-READING, PHRASE-FORMATS-DECODE-FROM-OPTIONS, RECOVERY-BACKUP-CHECK,
RECOVERY-BACKUP-CHECK-CODES, RECOVERY-BACKUP-CHECK-SHARES, RECOVERY-DATE-CANDIDATES,
RECOVERY-DATE-SEARCH, RECOVERY-LEGACY-LAST-WORDS, RECOVERY-MARKED-CODES,
RECOVERY-MARKED-CODES-BY-ENCODED-FINGERPRINT, RECOVERY-MARKED-CODES-BY-WALLET,
RECOVERY-MARKED-CODES-LIST, RECOVERY-MARKED-CODES-SEARCH, RECOVERY-WORD-SEARCH-MISSING,
RECOVERY-WORD-SEARCH-PLACES, RECOVERY-WORD-SEARCH-RUN, SSKR-EXPORT-REPAIR-FLOW,
SSKR-RESTORE-STEPS, SSKR-SEARCH-CONSENT, SSKR-UNMASK-SHARES, SSKR-WALLET-CHECK-SETS.

9: CARDS-BACKUP-CONTENT, CARDS-BUNDLED-ASSETS, CARDS-BUSINESS-RENDER, CARDS-CARD-SESSION,
CARDS-CLI-CARD-OPTIONS, CARDS-CODE-PALETTE, CARDS-COLLECTION-QR, CARDS-COLLECTION-SHEET-DRAW,
CARDS-CONTENT-CHECK, CARDS-DECOYS-AND-PLAN, CARDS-HEIR-SHEET-PDF, CARDS-HEIR-SHEET-TEXT,
CARDS-INDIVIDUAL-CARDS, CARDS-INVENTED-DETAILS, CARDS-MATERIAL-RENDER, CARDS-PAGE-IMAGES,
CARDS-PAGE-SETTINGS, CARDS-PALETTE-EXPORT, CARDS-PDF-DOCUMENTS, CARDS-PRINTABILITY-PREFLIGHT,
CARDS-QR-VECTOR, CARDS-RENDER-PLATFORM, CARDS-RENDER-SHEETS-PDF, CARDS-SAMPLE-PREVIEW,
CARDS-SHARE-CARD-SET, CARDS-SHARE-CARDS-EXPORT, CARDS-SHARE-CARDS-TO-SEPARATE,
CARDS-TEMPLATE-CATALOG, CARDS-TERMINAL-COLOR-CARDS, CARDS-TEXT-RULES, CLI-COMMAND-DISPATCH,
CLI-CORE-SELF-TEST-GATE, CLI-HELP, CLI-OUTPUT-PREFLIGHT, CLI-PORTABLE-PARTS, CLI-SAVE-RETRY,
CLI-SELF-TEST-COMMAND, PHRASE-FORMATS-DECODE-QUESTIONS, PHRASE-FORMATS-ENCODE,
PHRASE-FORMATS-ENCODE-RECORD-FILE, PHRASE-FORMATS-RE-ENCODE, PHRASE-FORMATS-RE-ENCODE-QUESTIONS,
PHRASE-FORMATS-SHOW-MASKED-WORDS, PHRASE-FORMATS-SHOW-ORIGINAL-WORDS, RECOVERY-CANDIDATE-LIST-SAVE,
SSKR-COMBINE-COMMAND, SSKR-EXPORT-COMMAND, SSKR-RESTORE-HANDOFF, SSKR-SAVE-SHARE-FILE,
SSKR-SAVE-SHARE-QR, SSKR-SHARE-SOURCES, SSKR-SPLIT-COMMAND.

10: CARDS-MENU-CARD-QUESTIONS, CLI-MENU-COMMAND-PROCESS, CLI-MENU-DECODE, CLI-MENU-ENCODE,
CLI-MENU-FILE-QUESTIONS, CLI-MENU-PREVIEW, CLI-MENU-RECOVER, CLI-MENU-REENCODE, CLI-MENU-RESTORE,
CLI-MENU-SPLIT, CLI-MENU-TABLE, CLI-SHELL-QUOTED-COMMAND, CLI-START-MENU.

11: CLI-EXECUTABLE-VERIFICATION, CLI-LICENSE-NOTICES, CLI-RELEASE-PIPELINE, CLI-RELEASE-SIGNING,
CLI-SINGLE-EXECUTABLE, SSKR-ENGINE-REPRODUCIBLE-BUILD.

## Owner decisions

Decided on 2026-10-27:

- CAP-CARDS-PDF-READER, CAP-CLI-PERMISSION-MODEL, CAP-SSKR-ENGINE-LOAD-VERIFIED and
  CAP-CLI-NPM-PACKAGE are dropped (requirement 1; no library package for Node.js hosts).
- Rust 1.99.1, the newest stable (released 2026-10-15); the guide and `AGENTS.md` now say so.
- The runtime crates of the crates report (CORE-25), with BIP39 from the bip39 crate 3.0.0 as in
  mhfe, never own BIP39 code, and harfrust dropped with the ligatures: 38 direct dependencies.
- RUST-13 no longer asks MADV_DONTDUMP; the allocator only wipes (ADR 0003).
- Increment 2: a tracer attached on Linux refuses secrets (L-TRACER); the memory cap is the
  measured peak of the heaviest operation plus a quarter, with the free-memory check (platform
  report, decision 5); Landlock applies on the private screen and on each output's parent, made
  before the secret when missing (ARCHITECTURE.md §5); a secret result never reaches a terminal without a private screen, while
  files and pipes get it as TS (N-PRIVATE-SCREEN). The 2026-10-13 rule holds otherwise: every
  other missing measure is reported, never refused.
- Increments 6 and 9: the parity levels above; no ligatures.
- Increment 11: macOS executables built on a pinned macOS runner, as mhfe (Apple's SDK), checked
  but not rebuilt byte for byte.
- The 25 defects as `mapping.json` records them: 17 fixed, in the TS first; 8 kept.
- SSKR's bc-crypto: the 32-line adapter (d), no cryptography of its own, every vendored file
  unchanged; the online search found nothing ready (crates report, decision 3).
- No network namespace (its clause left RUST-10): on the release targets it closes no path the
  socket filter leaves open. No `execve` denial on Linux or macOS and no limit on child processes
  in the Windows job: filters, Landlock domains, the Seatbelt profile and the job pass to a started
  program, which gains nothing the process lacks; no secret goes to another program
  (N-NO-SECRET-CHILD).
- Windows: `x86_64-pc-windows-gnu`, as mhfe, with the KnownDLL import gate (W-DLL-SEARCH): the
  stored list names the KnownDLLs the executable relies on, each confirmed in the \KnownDlls
  directory of the CI's Windows runners; an import outside it, such as std's
  `bcryptprimitives.dll` if a runner lacks it there, brings the target back to the owner.
  rust-lld's `--dependent-load-flag` cannot help: the pinned MinGW-w64 libraries define no
  `_load_config_used` (increment 0's probe).
- Answer limits: each question, and the file or standard input that answers it, has its own
  limit, its longest canonical answer rounded up to a power of two, reserved and locked before the
  answer is read; a question without a longest answer of its own, a passphrase or a path, has
  4 KiB, Linux's PATH_MAX. Every answer then locks within the 64 KiB RLIMIT_MEMLOCK of Linux
  before 5.16 except the one-answer share set (256 Bytewords shares and their separators,
  58,879 bytes, so 64 KiB), which stays unlocked there and is named by the lock warning
  (ADR 0003). The help names each text input's limit. TS has one 1 MiB limit for answers, files
  and standard input (`src/cli/bounded-read.ts:15`, `src/cli/terminal-input.ts:62`), with a
  per-question `limit` option (`terminal-input.ts:560`).

Nothing is open.

## Retiring the TS program

The TS program stays the reference until every capability not dropped is done and the release
gates pass on the three systems. Then the Rust workspace replaces the TS repository: the owner
decided the names on 2026-10-27, `hobby-eng/mnemocode` renamed `mnemocode_typescript` and the Rust
workspace published as `mnemocode`. GitHub redirects a renamed repository's old address only until
another repository takes the name, so every link to the TS releases (v0.1.0, wallet-tools' capsule
provenance) is moved to the new name first. Heir sheets printed by v0.1.0 send heirs to
`https://github.com/hobby-eng/mnemocode`, its Releases and its guide for heirs
(`src/cli/heir-sheet.ts:92-94`), and the program prints README anchors (`src/cli/terminal.ts:412-416`),
so the rename waits for the switch, and the repository under that name keeps from then on a release
that reads every v0.1.0 backup, the guide for heirs and those anchors. The owner also decides when wallet-tools switches from
the TS capsule (`multi-chain-wallet-tools/packages/recovery-mnemocode`) to the WASM file of each page.

## Progress

- Increment 0, 2026-10-27: `mnemocode-rust` archived (`tmp/mnemocode-rust-archive-2026-10-27/` of
  the owner's workspace, SHA-256 `c24e5317…4b7d`) and emptied but for the five vector files and the
  configuration the assessment carries over; the carry-over code (`text_rules.rs`, `bip39_shape.rs`)
  is taken from the archive by increments 1 and 3, and the two binary vectors (`bip39-codec-v1.bin`,
  `date-schedules-v1.bin`, recorded from TS `d4776f7` by scripts the archive lacks) are replaced in
  increment 3 by recordings of the TS repository's `pnpm record:rust-parity`. Built: the workspace
  of ARCHITECTURE.md §2 with empty crates, the vendored engine byte-equal to `UPSTREAM.json`, the
  `bc-crypto` stand-in, `module-map.json`, the gates of `cargo xtask check` (Node gate scripts at
  first, rewritten as the `xtask` crate on 2026-10-27 at the owner's word; the `pty` gate comes with
  the terminal in increment 2; `features`, `artifacts`, `reproducible` and `executable` with the
  release tooling of increment 11), `ci.yml` and `audit.yml`, the TS recorder, and these documents.
  The Windows probe: no `_load_config_used` in the pinned MinGW-w64, so no `--dependent-load-flag`;
  an empty `x86_64-pc-windows-gnu` executable imports KERNEL32, msvcrt, ntdll and one API set. The
  KnownDLL list is confirmed by CI's first run on the Windows runners. The independent review of
  increment 0 (21 findings, two High) was answered in the same commit: the layers part reads braced
  groups and resolves `super::` and `self::`; lint attributes are read whole, `cfg_attr` and lint
  groups included, and no crate root may expect the disallowed std items; the release profile is
  compared key by key; test files count as tests; clippy covers the Windows and macOS targets and
  fails on a `clippy.toml` path that does not resolve; the vectors and recordings are checked
  against their `PROVENANCE.json`; `code-rules --self-test` holds the cases the review found.
- Increment 1, 2026-10-27: the foundation `secret` (owners reserved at their final size, locked
  with mhfe's counted page locks, wiped on drop, redacted; the zeroing allocator registered by the
  executable and the binding; the stack scrub; the lock probe), `refusal`, `checksum`, `text`
  (white space, safe display, whole numbers, words and places, codes, hexadecimal, pieces, strict
  UTF-8, byte limits), `random` (the host's cryptographically secure source, CORE-46),
  `self_check` and `search` (ADR 0005's `Search` with the plan's words), and the binding's `host`
  (a refusal as a JavaScript `Error` with its `code`, the browser's randomness, the stack scrub).
  `vectors/ts-0.1.0/foundation-v1.json` holds TS's answers, white space and safe display over every
  scalar value included; `tests/ts_foundation.rs` replays them. Two edges join the module map:
  `secret` uses `refusal` (its capacity refusal) and `search` uses `text` (whole ranges, as TS's
  search turns use its typed numbers). The memory scan runs on the test profile `test/probe`,
  whose entries show that a freed and a reallocated block and the stack of `after_secret`'s work
  hold no marker afterwards, and that a refusal reaches JavaScript as TS's kind of error with a
  read-only code; each module's own entries are scanned from its increment on. Moved: the lock row
  and the executable's getrandom adapter to increment 2 (the command line's), the cell widths to
  increment 2, NFKD and NFC to increment 3 (their first user, `bip39`), the time estimate of each
  search from its timed pace sample to increment 8 (with the searches, whose samples differ),
  and `refusals-v1.json` to the review of increment 11, checked by `code-rules`. The independent review of increment 1 (two reviewers, 21 findings, one
  High: `after_secret` left an inlined closure's stack unscrubbed) was answered in the same commit.
- Increments 2 to 4, 2026-10-27: the command line (`os` with the protections of each system,
  `terminal` with the line editor, the private screen, word hints under a typed word and the
  result layouts, `args`, `input`, `output`, `gate`, `commands`) with `table` and `encode`; the
  library's `bip39` over the bip39 crate, `dates` with the answer of typed dates (`dates::answer`),
  `bip32` (extended keys and CKDpriv, mhfe's), `pack`, `forms` with colours, detection and word
  hints, `modes` (Seedshift, the Original Seedshift, its valid last word, direct), `backup` (the
  encoded backup, its MNC1 record, JSON, the encoded fingerprint, shorter phrases, the last-word
  replacement) and `checks`, the self-test rows Core integrity, Public vectors (compiled in and held
  equal to `vectors/mnemocode-v1.json` by a test), Representation matrix, Date ordering, Word
  lists, BIP39 seed (the 24 published vectors in the full tier) and Word hints. Moved: decode and
  re-encode to increment 8, where the backup reading they start from arrives (`recovery::reading`
  uses `sskr` and the marked codes); the Re-encoding row to increment 5 (its confirmation is a
  wallet check); the binding's `phrase` module to the binding commit after increment 6. Forms and modes are closed enums, not traits
  (ADR 0002 amended): every host takes all of them, and the compiler finds each place a new one
  touches. The command line expects dead code until its last command arrives (increment 9): the
  parts of the terminal, the files and the protections that the later commands use came with it.
- Increment 5, 2026-10-27: the library's `wallet`: the twelve coins as static entries behind their
  `coin-*` features (ADR 0002), each reading its addresses into a type and a commitment (Base58Check
  over bs58, Bech32 and Bech32m over bech32, SegWit, Taproot, Keccak accounts with EIP-55, CashAddr,
  Dash Platform payments) and naming the BIP32 paths of its keys; the address scan; the evidence
  of a wallet (master fingerprint, master and account keys in their ten SLIP-132 forms, a Bitcoin
  address, a compressed key or a WIF at its place under the selected profiles, and an address of
  another coin), compared with the keys of the master key, each one's private half wiped; `bip32`
  gains the place of a key and the serialization of extended public keys; `backup::re_encoding`
  holds an old backup's phrase until the person or the wallet confirmed it; the dates and shifts of
  a mask live in `dates::{Dates, Shifts}`, locked owners with a redacted Debug. Rows: each coin
  family's (built with any of its coins, a case of another left out), Wallet evidence, Re-encoding.
  Every feature set builds and passes its tests (all coins, none, Dash alone, Litecoin alone).
  Moved: the wallet options of the command line to increment 8, with `decode` and the searches
  that take them; the binding's `wallet` module to the binding commit after increment 6.
- Increment 6, 2026-10-27: the library's `candidates`: the MNCL list (`format`, every published
  list byte for byte, the damaged ones refused), its `writer` (one owner reserved at the list's
  exact size), the `protection` a person chooses (the Scanner's key, a passphrase of at least 12
  characters, or none), age v1 (`age`, own format code over chacha20poly1305, hkdf, hmac,
  x25519-dalek, scrypt and base64ct: the file key wrapped by its one recipient, the header's MAC,
  the payload in 64 KiB chunks; the refusals in age-encryption 0.3.1's words, as TS gives them),
  the `admission` of a file before any key, and the `gate` that runs the known answers of age
  before the first operation and again on request; `qr`: the matrix at level M through qrcodegen,
  the PNG of 720 pixels with the quiet zone of four modules, both read back with rqrr before they
  are given out, and a PNG read after its `admission` and an inflation bounded to its scanline
  bytes; `encode --qr`. Checked with C2SP CCTV's age test kit (`vectors/cctv-age/`, 123 files:
  every one-recipient binary file that age opens opens here, every other is refused) and TS's age
  files. Rows: Candidate lists (scrypt's known answer in the full tier), PNG admission, QR adapter
  (full tier). The heaviest operation of a command, the largest list the writer makes encrypted
  through scrypt and opened again, peaks at 293 MiB resident and runs under the memory cap (a test
  of `os::linux`); the cap stays until increment 9 measures the card export. The debug builds
  optimize the dependencies, so that scrypt's 2^18 takes seconds in the tests. Moved: `--qr-file`
  to increment 8 with `decode`, the command that reads it; the bindings `qr` and `candidates` and
  the Scanner's profile to the binding commit that follows. The binding modules are designed for
  MnemoCode's own needs, and wallet-tools adapts to MnemoCode's releases (the owner, through the
  wallet-tools session, 2026-10-27), so no module waits for it. Open: the transcripts of
  the command line (increment 4's `encode`, this one's `--qr`) need the TS recorder to record them,
  once the decided TS fixes, which change some outputs, are in.
- The binding of increments 3 to 6, 2026-10-27: `browser-phrase` (an encoded backup with its
  codes, record and fingerprints, the form typed text most likely is, a phrase's master
  fingerprint), `browser-wallet` (each kind of evidence and its place, compared with a phrase and
  its passphrase; the coins of the build), `browser-qr` (a payload's PNG and matrix, read back
  first; a PNG's text) and `browser-candidates` (the Scanner's session key, a list opened with it
  or a passphrase, a list protected as chosen, a list read candidate by candidate), each with its
  `selfCheck` over its part's rows (`checks::part_rows`). A secret entry's text crosses as a
  `JsValue` that Rust reads inside the call and its bytes as a free function's first argument, so
  nothing the glue checks or throws on follows a copied secret, a freed receiver included; numbers
  cross as `f64`, a place past a list's end refused (ARCHITECTURE.md §6); every secret entry runs
  through `after_secret`; the session key has `wipe()`. The Wallet evidence row is in every build,
  its master-key cases without Bitcoin. Typed dates are read as the command line reads a line of
  them (`DatesAnswer`). The page profiles hold them: the multi-chain Deriver all four with every
  coin, the Scanner `candidates` alone, the Dash Deriver phrase, wallet and QR with `coin-dash`.
  getrandom builds on every target, so that the binding's native tests draw randomness too; the
  gate runs them with every module. The independent review (one reviewer, six findings, two
  Medium: secret entries outside the scrub, and glue that could throw after copying a secret) was
  answered in the same commit, and its re-check's three Low notes too: the memory scan reads a
  page's string as a secret entry does (`probeText`), and ADR 0004 names the binding's codes.
- Increment 7, 2026-10-27: the library's `sskr`, behind its feature: the engine (the vendored
  SSKR linked in, its generator ChaCha20 seeded from the `Random` port, every share and secret in
  a locked owner, the stack scrubbed after each call); a share's bytes and metadata; the six forms,
  a closed enum `ShareFormat` (ADR 0002 amended: wallet-tools removes shares whole, never one
  form), read in TS's order, a text refused by the reader of the form it is written in; the check
  and facts of a set; the split of a phrase or a backup masked first, every new split restored
  with each share checked; the restore of complete shares with every surplus member and group
  checked against a digest-checked reference; the repair of one share marked with ? over GF(2),
  colors and codes read in part included; the joint repair of the shares of a set, its assessment
  and its search over bc-shamir's digest stepped by the host (the first `Search`, ADR 0005), with
  the report of what is open and what was filled in; the shares as typed (places,
  wrapped lines, a phrase typed for a share, copies, the share that does not fit); the export of a
  set; the keeping note; and the QR check of a share. The library drops the engine-output and
  unfilled-randomness checks (CORE-54) and keeps the restore of every split. Rows: SSKR
  integrity, Share repair (startup and full), Share split and restore (full), their vectors
  compiled in and held equal to `vectors/sskr-v1.json`. The TS repository's recorders
  `shares.mjs` and `share-repair.mjs` record `vectors/ts-0.1.0/shares-v1.json` and
  `share-repair-v1.json` from its commit `524d003`: about 1,000 marked texts repaired alone, 88
  lists repaired together with their assessments, reports and sets, sets restored and refused,
  shares as typed, exports, splits, notes and hints, public shares and a fixed sequence of changes
  to them, which `tests/ts_shares.rs` replays byte for byte; its two longest replays are ignored
  with their reasons and run at release (RUST-08). They found one defect of the TS report, fixed
  there first (`mapping.json`). Not recorded, for the minutes they take: "Too many ways fit
  these shares" and "The member numbers of these shares cannot be told". The binding's
  `browser-sskr` (a backup split and written in one form with its keeping note, shares restored
  together with their repair lines, a share's form and writing, the QR check) joins the
  multi-chain Deriver's profile; its getrandom 0.3.4 line gives bc-rand's tree the browser
  backend, without js-sys. The memory scan splits and restores a secret through the engine and
  finds no copy (`probeShares`). The earlier increments' secret entries had never been scanned nor
  their stack measured, so the gate now does both for all of them: the test profile takes every
  module and coin, each row of the self-check runs there on a painted stack, and `probeEntries`
  tells each secret it meets in one instance and in another calls every secret entry as a page
  calls it, the stack searched after each return and the memory after the last, for any part of
  every secret, seed, key and share, and the stack painted anew under each entry must show its
  scrub ran. No entry left a copy; a seed and a share left on purpose were found, and an entry
  without its scrub leaves the paint. The QR reader leaves data some
  77 KiB down, past the 16 KiB kept from TS, so the scrub is
  128 KiB, and the gate refuses a row that reaches it. wasmi takes its portable dispatch, whose
  stack does not grow as it runs. The review found the assessment of marked shares unstoppable,
  unlike TS's, so it is stepped as a search is. Open under RUST-13, for the owner to decide: the
  algebra's vectors are redacted and wiped on free but not locked, and `Branch.particular`,
  `visible` and `hidden`, `ReadingSpace.particular` and `basis` and `ReadingUnits.values` stay
  for a whole search, one set of them for each branch and share. Open the same way: a card's
  `CardCodes` and each `Page` being drawn are wiped on free but not locked, since the same codes stand
  unlocked in the finished PDF and page images, so that locking one copy closes no path. Moved: the share commands,
  `--qr-dir` of shares and the sources of typed shares (CAP-SSKR-SAVE-SHARE-QR,
  CAP-SSKR-SHARE-SOURCES) to increment 9 with the commands that use them; the wallet check of
  restored sets (CAP-SSKR-WALLET-CHECK-SETS) to increment 8, where the share restore steps unmask
  a Seedshift phrase before its check, and the binding's stepped assessment and repair search with
  the recovery binding there.
- Increment 8, 2026-10-31: the library's `recovery`: how a backup as given is read, the places of a
  phrase and codes marked with ?, the date, word and marked-code searches, each a unit behind its
  feature and stepped by the host (ADR 0005), the check of a written backup, and the restore of
  shares in the steps every host takes, with their repair and their unmasking. Without `search-date`
  a dates answer refuses patterns. Rows: Dates, Backup reading, Marked codes search, Word search,
  Backup check, Share unmasking. `decode`, `recover-date` and `recover-word` run from their options,
  with `--qr-file` and the wallet options, over one driver of a search that reads Ctrl+C as a key
  between steps. The TS recorders `recovery.mjs` and `transcripts.mjs`, of its commit `fc77a16`,
  record `recovery-v1.json` and the first command transcripts, of those commands and `encode`, as a
  script runs them, which `tests/ts_recovery.rs`, `ts_recovery_shares.rs` and the command line's
  `ts_transcripts.rs` replay byte for byte; the first also records marked shares restored together
  and the phrase alone with its refusals. `browser-recovery`, in the multi-chain Deriver's profile:
  a backup read and decoded, a written backup checked, and every search as one class that the page
  steps, started from a `Recovery`, the receiver that holds the wallet, as no class crosses beside
  a secret; the assessment of marked shares is stepped there. Moved to increment 9, with the
  capabilities that list them there: `--ask-secrets` of these commands and the questions they need,
  `--candidates-file`, `re-encode`; so a text that fits several forms is refused here, and a
  long search needs `--max-candidates`.
- Increments 8 and 9, the rest, and 10, 2026-11-01: `--ask-secrets` of every command, `sskr-split`,
  `sskr-combine`, `sskr-export`, `re-encode`, `--candidates-file`, the self-test command, the help
  pages; `mnemocode-cards` with the 13 designs, each behind its feature, drawn as one scene for
  PDF (pdf-writer) and images (tiny-skia) with no program started (ADR 0009), the heir sheet, card
  options, `preview` and the rows Heir sheet, Share cards, Card sets, QR beside sheets and Card export
  assets; the start menu, its record of answers and each command in a process of its own; binding
  `cards`, in the Deriver's profile. The TS recorders `cards.mjs` and `transcripts.mjs`, of its
  commit `cda5e91`, record every text and image that each design draws with a fixed sequence in
  place of randomness (`cards-v1.json`), and what the commands write (162 commands); the replays
  hold them to a millionth of a point and byte for byte. Page images against TS's: the 13 designs at
  300 dpi differ by 0.7 to 1.6 of 255 on average, at most 0.05 % of the pixels by more than 64, the
  edges of letters and shapes: tiny-skia's antialiasing against cairo's, which is the tolerance that
  this part of the plan left open. A PDF of a set of shares takes more than the lock budget, so a
  drawn page is `SecretBytes::large`, wiped on free and never locked (ARCHITECTURE.md §6).
- Increment 11, 2026-11-01: `release build`, `release pages`, `verify-executable`, `reproducible`,
  `features` and `sign` of `xtask`, `.github/workflows/release.yml`, the canonical container and
  docs/RELEASING.md. The word of a part that a page leaves out is refused in its file (`wasm`).

# Source layout

This is the Rust implementation of MnemoCode. The command line and WebAssembly binding call the same library modules. Start with the [library guide](LIBRARY.md) to embed one; the [design record](design/README.md) explains the architecture and decisions behind the port.

## Crates and responsibilities

| Crate                    | Responsibility                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `crates/mnemocode`       | BIP39, representations, Seedshift, records, wallet checks, SSKR, recovery, candidate lists and QR codes |
| `crates/mnemocode-cards` | Card settings, designs, drawing scenes, PDFs, PNG/JPEG images and heir sheets                           |
| `crates/mnemocode-cli`   | Options, menu, terminal questions, files, operating-system protections and output                       |
| `crates/mnemocode-wasm`  | Feature-selected browser classes and conversion between JavaScript values and library types             |
| `xtask`                  | Repository gates, WebAssembly profiles, packaging, reproducible builds and release signing              |

The cards crate depends on the library; the library never depends on cards or either front end. `module-map.json` declares permitted dependencies, unsafe-code locations and OS access. `cargo xtask code-rules` checks the map against the source. The [design's module map](design/architect/ARCHITECTURE.md#3-module-map) explains the dependency direction.

## Modules for other hosts

Paths below are relative to `crates/mnemocode/src/`, except where another crate is named. Each module documents its public types and refusals in rustdoc.

| Module                                                          | What it owns                                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bip39`                                                         | Checked phrases, entropy, seeds, word lookup and numbered dictionaries                   |
| `dates`, `modes`                                                | Dates, date patterns, shifts and transformation rules                                    |
| `forms`, `backup`                                               | Representations, encoded backups and MNC1 records                                        |
| `wallet`, `bip32`                                               | Coin rules, wallet evidence, derivation and fingerprints                                 |
| `sskr`                                                          | Share formats, splitting, strict restoration, repair and joint solving                   |
| `recovery`                                                      | Reading a backup, word/code/date searches, backup checks and share restoration workflows |
| `candidates`                                                    | MNCL records, bounded file admission, age encryption and candidate writers               |
| `qr`                                                            | PNG admission, QR creation, decoding and content verification                            |
| `pack`                                                          | The dictionaries and standalone manual-recovery guide                                    |
| `secret`, `refusal`, `random`, `search`, `self_check`, `checks` | Secret owners, refusal contracts, randomness, stepped searches and known-answer checks   |
| `mnemocode-cards`                                               | Drawing plans and output writers, shared by native and browser hosts                     |

`Cargo.toml` features select coins, searches, SSKR and card templates. `wasm-profiles.json` selects the parts and units included for each browser page. There is no Node.js runtime or TypeScript source import in these artifacts. [Feature and binding contracts](LIBRARY.md#browser-modules-and-features) explain what a host must select.

## Command line and terminal

`mnemocode-cli` translates options and answers into library calls. Secret commands run in a fresh protected process. The menu holds no secrets and starts each selected command as that same executable. It shows the equivalent command line without secret values.

Terminal input, private screens, paging, answer records and Escape/Ctrl+C handling live under `terminal`. `gate` applies startup checks and the private-screen requirement before a secret command runs. The `os` modules contain platform calls; the library does not perform terminal or filesystem operations.

Normal back navigation and cancellation are outcomes, separate from refused input and I/O failures. Searches expose progress and partial results; their host decides when to take another step or stop. [Search and error contracts](LIBRARY.md#cancellation-and-refusals) cover embedding them.

## Drawing and files

Cards are planned as a scene shared by the PDF and raster writers. PDF output uses `pdf-writer`; page images use `tiny-skia`, with PNG or JPEG encoding in process. Artwork and fonts are compiled into the cards crate. The [drawing decision](design/architect/adr/0009-cards-as-one-scene.md) records the visual parity criteria; matching content does not imply byte-identical PDFs or raster edges across implementations.

File permissions, name reservations, staging and publication belong to the CLI's output and OS modules. Folder publication is not atomic. Read [export precautions](../SECURITY.md#exported-files) before relying on a completed directory after an interruption.

## Secret ownership and protections

Secret types wipe owned buffers on drop. The CLI and WebAssembly artifacts register a zeroing allocator; native library hosts must opt into it. Page locks are best effort and unavailable in browsers. A private screen cannot protect against a compromised terminal or OS. [Security policy](../SECURITY.md) is the user-facing description; [secret-memory decisions](design/architect/adr/0003-secret-memory.md) and [platform protections](design/platform/protections.md) explain implementation choices.

## Single executable and browser files

The executable embeds artwork, fonts, public known answers and the native SSKR engine. `cargo xtask release build <target>` packages it and its license notices. `cargo xtask verify-executable <file>` exercises it from an empty directory.

`cargo xtask wasm build <edition>/<page>` builds a browser profile and its generated glue. Release packaging gathers the page builds into `mnemocode-<version>-wasm.tar`. The wallet-tools application controls loading, its CSP, UI, workers and storage policy; producing a binding does not establish acceptance of that application.

## Maintenance checks

Use the pinned Rust and dprint versions. `cargo xtask check` runs the repository's source, format, dependency, test and WebAssembly gates. Targeted changes use the nearest relevant tests; release verification additionally checks feature combinations, packaged executables, canonical reproducible builds and native-platform execution. [Releasing](RELEASING.md) gives the maintainer procedure.

`vectors/` holds public format and crypto answers. `vectors/ts-0.1.0/` holds answers recorded from the TypeScript version, with their provenance. Do not edit vectors by hand or treat format parity as proof of every UI or platform behaviour. [Audit records](audits/README.md) state the source identities, checks and limits of each review.

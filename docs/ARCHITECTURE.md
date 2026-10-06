# Source layout

MnemoCode is an offline command-line program and a TypeScript library. The CLI coordinates input, transformations and output. Renderers do no mnemonic or share arithmetic. The library entry points are `src/index.ts` and `src/sskr/index.ts`.

`src/version.ts` holds the version. The toolchain check requires it to match `package.json`.

## Transformation layer

`src/core.ts` re-exports the modules in `src/core/`:

| Module                    | Responsibility                                                      |
| ------------------------- | ------------------------------------------------------------------- |
| `core/types.ts`           | Public result types and supported word counts                       |
| `core/words.ts`           | Word lists, index maps and mnemonic validation                      |
| `core/bits.ts`            | Bit/byte conversion and modular arithmetic                          |
| `core/dates.ts`           | Calendar validation, ordering, shift schedule and recovery patterns |
| `core/colors.ts`          | BIP39Colors decimal packing and Private Use Unicode transport       |
| `core/representations.ts` | Representation parsing, detection and formatting                    |
| `core/seedshift.ts`       | Direct, checksum-valid and legacy transformations and inverses      |

Core modules do not import CLI input, PDF renderers, image tools or the share runtime. The final entropy chunk uses [its own modulus](../README.md#how-checksum-valid-seedshift-works); comments beside both directions of the transformation explain it. Legacy last-word recovery searches widely so that old records stay readable.

`record.ts` parses the versioned MNC1 record. `bitcoin-evidence.ts` checks recovery evidence and derivation paths.

## Shamir shares (SSKR)

| Module                 | Responsibility                                                                   |
| ---------------------- | -------------------------------------------------------------------------------- |
| `sskr/runtime.ts`      | Verifies and loads the local WASM; supplies operating-system randomness          |
| `sskr/shares.ts`       | Validates mnemonics and shares; splits and combines                              |
| `sskr/transport.ts`    | Bytewords, CBOR and ordered RGB records, with named constants for the byte rules |
| `sskr/checksum.ts`     | Shared CRC32 and reversible layout mixing                                        |
| `sskr/repair.ts`       | Reads a share with marked elements, and solves one share from its own checks     |
| `sskr/joint-repair.ts` | Solves marked shares of one set together; the digest search over what is open    |
| `sskr/gf2.ts`          | Elimination over GF(2), with bit vectors in bigints                              |
| `sskr/gf256.ts`        | GF(256) arithmetic and Lagrange coefficients, as bc-shamir uses them             |
| `sskr/self-test.ts`    | Checks the published grouped vector                                              |
| `cli/sskr-command.ts`  | Share input and export options                                                   |
| `cli/share-repair.ts`  | The repair assessment, the question before a long search, and the wallet check   |
| `export/sskr-cards.ts` | Prints existing shares with the card renderers                                   |

`sskr-wasm` contains the Rust source of the share library, its Cargo lockfile, the generated JavaScript and WASM, and their notices. `pnpm build:sskr` builds the WASM from that source offline in the pinned container `Dockerfile.sskr`; `pnpm verify:sskr` builds it again and compares the result byte for byte. `sskr-wasm/integrity.json` pins the hashes of these files, so the formatter must not rewrite them. [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) names the library versions and licenses.

## CLI

`mnemocode.ts` starts the menu (`cli/menu.ts`) when there is no command and a terminal, and otherwise `cli/command-line.ts`, which dispatches commands and rejects unsupported flags. The menu only builds a command line from its questions and runs it through the same dispatcher. `cli/input.ts` owns interactive and file input. `arguments.ts` and the option modules validate values.

| Module                   | Responsibility                                                                  |
| ------------------------ | ------------------------------------------------------------------------------- |
| `cli/terminal-input.ts`  | Raw terminal keys and typed answers, the same on Linux, macOS and Windows       |
| `cli/terminal-choice.ts` | Lists chosen with the arrow keys, typed answers and the pause for Enter         |
| `cli/private-screen.ts`  | The alternate screen for typed secrets and their results, cleared after Enter   |
| `cli/protection.ts`      | No core dumps, the permission model, and what a command gives up before it runs |
| `cli/swap-check.ts`      | Whether swap is encrypted (Linux)                                               |
| `cli/cloud-folders.ts`   | Whether an output path lies in a cloud-synchronised folder                      |
| `cli/menu.ts`            | The entries, their questions and the command line each answer builds            |
| `cli/backup-check.ts`    | The optional check of a backup typed again after Encode                         |
| `cli/heir-sheet.ts`      | The words of the optional sheet for heirs (`--heir-sheet`)                      |

`scripts/verify-terminal-input.py` drives the menu and the prompts for secrets in a real pseudo-terminal: a Unix one on Linux and macOS, a Windows pseudo-console through pywinpty.

`output-paths.ts` checks destinations before any secret is requested. This check is not a lock: the writers still enforce exclusive creation or private atomic replacement.

`encode-command.ts` coordinates one transformation, `encode-report.ts` formats its terminal result and `encode-export.ts` saves it. Recovery, previews and the table each have their own command module. Terminal colour styling is in `terminal.ts`.

## Cards and files

`export/templates.ts` is the template registry. Each card family has a renderer, a layout module and an artwork module. Layout dimensions are millimetres. Text helpers convert the top-of-line-box convention to PDF coordinates. Typography profiles and named geometry constants stay near the drawing code.

`card-session.ts` remembers these choices for a host that exports several times in one session. `card-identities.ts` selects the employer, role and name. `card-copy.ts` separately selects the studio and the sheet text. Both are resolved once at the export boundary and passed to every page and output format.

`world-map.ts` holds the projection of the world map behind a collection sheet; `world-map-data.ts` is generated from public-domain Natural Earth data by `scripts/build-world-map.mjs`.

`card-qr.ts` draws vector modules and enforces the quiet zone and the module size. The payload is validated before drawing. An individual card never receives the payload of the whole collection or of a whole share.

The renderers contain no Node.js code. They get bundled files, random choices, PNG coding and QR matrices from the interface in `export/platform.ts`; `export/platform-node.ts` supplies them for Node.js. `src/cards.ts` is the entry point for another host, such as a browser page, which calls `configureRenderPlatform` and then uses `renderCards` or `renderIndividualCards` from `export/render.ts`.

`heir-sheet.ts` lays out both sides of the sheet for heirs, in A5 or A6. `pdf.ts`, `individual-cards.ts` and `sskr-cards.ts` organize documents and destinations. `image-export.ts` converts those same PDFs to images with local Poppler. `private-file.ts` replaces file exports through a private staging directory on the same filesystem. Artwork derived from a user's references is cached only for the current document; shared caches contain fixed bundled artwork.

## Modules for other hosts

The transformations (`core.ts` and `core/`), the record format (`record.ts`), the share forms (`sskr/transport.ts`) and the repair of damaged shares (`sskr/repair.ts` and `sskr/joint-repair.ts`) contain no Node.js code and import no package but `@scure/bip39`, so that another host, such as the Wallet Deriver of the multi-chain wallet tools, compiles them unchanged. Share repair gets HMAC-SHA256 and the SSKR library from the interface in `sskr/share-platform.ts`; `sskr/share-platform-node.ts` supplies them for Node.js, and another host calls `configureSharePlatform` first. `test/portable-modules.test.ts` follows the imports of these modules and fails on anything else.

## Single executable

`bundled-files.ts` reads every file that ships with the program, such as card artwork, the SSKR engine and the public vectors, by its path from the package root: next to the code when MnemoCode runs from a checkout or an installed package, and from the embedded assets inside the single executable.

`scripts/build-executable.mjs` bundles the CLI with esbuild into one CommonJS file and builds a Node.js single executable from it, with the bundled files as assets. It also writes the license notices of everything the executable contains (`scripts/executable-notices.mjs`) and the SHA-256 lines of both files. `scripts/verify-executable.mjs` runs the executable of this system from an empty folder. `.github/workflows/executable.yml` builds and checks it on Linux, Windows and macOS, and on a version tag publishes the files after the complete CI has passed.

## Maintenance checks

Format the project's TypeScript and JavaScript with the checked-in Prettier configuration, then run `corepack pnpm check` and `corepack pnpm build`. Generated files and the SSKR bridge are excluded from formatting.

For layout refactoring, `scripts/business-goldens.mjs` creates fixed public fixtures and `scripts/compare-business-goldens.py` compares their pages at 144 dpi. The comparison covers those fixtures, not every combination of design and input. Keep refactoring separate from intended design changes.

Formatting and compiler checks do not replace the full test run. Run the full suite and `mnemocode self-test` before a release.

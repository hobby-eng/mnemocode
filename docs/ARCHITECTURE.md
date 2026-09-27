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
| `sskr/self-test.ts`    | Checks the published grouped vector                                              |
| `cli/sskr-command.ts`  | Share input and export options                                                   |
| `export/sskr-cards.ts` | Prints existing shares with the card renderers                                   |

`vendor/sskr` contains the Rust source of the share library, its Cargo lockfile, the generated JavaScript and WASM, and their notices. `vendor/sskr/integrity.json` pins the hashes of these files, so the formatter must not rewrite them. [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md) names the library versions and licenses.

## CLI

`mnemocode.ts` dispatches commands and rejects unsupported flags. `cli/input.ts` owns interactive and file input. `arguments.ts` and the option modules validate values.

`output-paths.ts` checks destinations before any secret is requested. This check is not a lock: the writers still enforce exclusive creation or private atomic replacement.

`encode-command.ts` coordinates one transformation, `encode-report.ts` formats its terminal result and `encode-export.ts` saves it. Recovery, previews and the table each have their own command module. Terminal colour styling is in `terminal.ts`.

## Cards and files

`export/templates.ts` is the template registry. Each card family has a renderer, a layout module and an artwork module. Layout dimensions are millimetres. Text helpers convert the top-of-line-box convention to PDF coordinates. Typography profiles and named geometry constants stay near the drawing code.

`card-session.ts` remembers these choices for a host that exports several times in one session. `card-identities.ts` selects the employer, role and name. `card-copy.ts` separately selects the studio and the sheet text. Both are resolved once at the export boundary and passed to every page and output format.

`world-map.ts` holds the projection of the world map behind a collection sheet; `world-map-data.ts` is generated from public-domain Natural Earth data by `scripts/build-world-map.mjs`.

`card-qr.ts` draws vector modules and enforces the quiet zone and the module size. The payload is validated before drawing. An individual card never receives the payload of the whole collection or of a whole share.

The renderers contain no Node.js code. They get bundled files, random choices, PNG coding and QR matrices from the interface in `export/platform.ts`; `export/platform-node.ts` supplies them for Node.js. `src/cards.ts` is the entry point for another host, such as a browser page, which calls `configureRenderPlatform` and then uses `renderCards` or `renderIndividualCards` from `export/render.ts`.

`pdf.ts`, `individual-cards.ts` and `sskr-cards.ts` organize documents and destinations. `image-export.ts` converts those same PDFs to images with local Poppler. `private-file.ts` replaces file exports through a private staging directory on the same filesystem. Artwork derived from a user's references is cached only for the current document; shared caches contain fixed bundled artwork.

## Maintenance checks

Format the project's TypeScript and JavaScript with the checked-in Prettier configuration, then run `corepack pnpm check` and `corepack pnpm build`. Vendored and generated files are excluded from formatting.

For layout refactoring, `scripts/business-goldens.mjs` creates fixed public fixtures and `scripts/compare-business-goldens.py` compares their pages at 144 dpi. The comparison covers those fixtures, not every combination of design and input. Keep refactoring separate from intended design changes.

Formatting and compiler checks do not replace the full test run. Run the full suite and `mnemocode self-test` before a release.

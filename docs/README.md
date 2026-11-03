# MnemoCode documentation

Start with the [README](../README.md) to choose a task. Its sections follow the program's menu. The guides below provide details for users, library hosts and maintainers.

## Using the program

| Guide                                            | What it covers                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| [Command-line reference](CLI.md)                 | Download verification, paired command examples, input/output rules and options |
| [A guide for heirs](HEIRS.md)                    | Restoring an inherited backup and recognizing common recovery problems         |
| [Shamir shares](SSKR.md)                         | Creating, storing, restoring and repairing shares; share transport details     |
| [Card designs](card-designs.md)                  | What appears on cards and collection sheets                                    |
| [Card identity defaults](card-identities.md)     | Invented names, contact details and studio text                                |
| [Recovery without MnemoCode](MANUAL_RECOVERY.md) | Printed dictionaries, manual date reversal and a standalone Python helper      |
| [Security policy](../SECURITY.md)                | Threats, protections, export precautions and private vulnerability reporting   |

## Library and formats

| Guide                                               | What it covers                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Using the Rust library](LIBRARY.md)                | Rust examples, WebAssembly modules, ownership and host contracts             |
| [Source layout](ARCHITECTURE.md)                    | Module responsibilities, entry points, dependency boundaries and build tools |
| [Candidate lists](CANDIDATES.md)                    | MNCL bytes, candidate ordering, encryption parameters and limits             |
| [Seedshift construction](SEEDSHIFT_CONSTRUCTION.md) | The checksum-valid transformation and its reversibility proof                |

## Maintenance and history

| Guide                                            | What it covers                                                  |
| ------------------------------------------------ | --------------------------------------------------------------- |
| [Roadmap](ROADMAP.md)                            | Browser integration, search improvements and mobile plans       |
| [Releasing](RELEASING.md)                        | Maintainer checks, signed tags, draft signing and publication   |
| [Design and decisions](design/README.md)         | Architecture, platform protections, crate choices and decisions |
| [Audit index](audits/README.md)                  | Reports and their original scope, source identities and limits  |
| [Changelog](../CHANGELOG.md)                     | Version-by-version changes                                      |
| [0.2.0 release notes](releases/v0.2.0.md)        | What 0.2.0 changes, in short                                    |
| [Third-party notices](../THIRD_PARTY_NOTICES.md) | Dependencies, artwork and attribution                           |

The [TypeScript documentation and audit history](https://github.com/hobby-eng/mnemocode_typescript/tree/main/docs) remain with that version. This repository keeps the Rust design, changelog, release notes and audit records. Each historical record describes its own snapshot, not a later build.

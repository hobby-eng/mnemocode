# Changelog

## 0.2.0 (unreleased)

MnemoCode is rewritten in Rust: one executable that needs nothing else installed, for Linux, macOS and Windows, and a WebAssembly file for each page of the wallet tools. It reads every backup, record and share of 0.1.0 and writes the same ones, and its commands, questions and messages are those of 0.1.0, but for what follows.

- Secrets live in types that wipe them, every freed block of memory is wiped, and the memory of a secret is kept out of swap where the system allows it.
- Re-encode asks for the new backup before the old one, and a failed save may take another name only in the folders of its outputs.
- A command whose result is secret is refused on a terminal without a private screen.
- A tracer attached to the process refuses secrets on Linux.
- Cards draw PNG and JPEG images in the program: Poppler's `pdftocairo` is no longer needed.
- An answer, a file or standard input longer than its question's limit is refused with that limit, a BIP39 passphrase over 4 KiB included.
- A missing parent folder of an output file is made before the secret is read.

## 0.1.0

The TypeScript version: [its changelog](https://github.com/hobby-eng/mnemocode/blob/v0.1.0/CHANGELOG.md).

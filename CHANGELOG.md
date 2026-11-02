# Changelog

## 0.2.0 (unreleased)

MnemoCode is rewritten in Rust: one executable that needs nothing else installed but glibc 2.35 or later on Linux, for Linux, macOS and Windows, and a WebAssembly file for each page of the wallet tools. It reads every backup, record and share of 0.1.0 and writes the same ones, and its commands, questions and messages are those of 0.1.0, but for what follows.

- The README follows the menu order, with paired command examples and a documentation index. Each menu task and recovery choice shows its own explanation and a link to that section.
- Secrets live in types that wipe them, every freed block of memory is wiped, and the memory of a secret is kept out of swap where the system allows it.
- Re-encode asks for the new backup before the old one, and on Linux with Landlock a failed save may take another name only in the folders of its outputs.
- A command whose result is secret is refused on a terminal without a private screen.
- A tracer attached to the process refuses secrets on Linux.
- Cards draw PNG and JPEG images in the program: Poppler's `pdftocairo` is no longer needed.
- An answer, a file or standard input longer than its question's limit is refused with that limit, a BIP39 passphrase over 4 KiB included.
- A missing parent folder of an output file is made before the secret is read.
- A QR code image may have up to 2 megapixels, where 0.1.0 took 8: a screen of 1920 × 1080 fits, and a page image is cropped to its code.
- A result that standard output does not take, as on a full disk, ends the command with exit code 1 and says so; a closed pipe ends it as done.
- As in TS 0.1.1, after its audit AUD-039: shares under a threshold of 1, which keep no SSKR digest, are refused as a set where they disagree, since their agreement does not tell which one is wrong; a file name typed again after an unreadable file, and the name of the next share's QR image, are read only from regular files, so a named pipe is refused at once; and a word of a host's instructions for heirs wider than the page is refused.

## 0.1.0

The TypeScript version, now in its own repository, [mnemocode_typescript](https://github.com/hobby-eng/mnemocode_typescript): [its changelog](https://github.com/hobby-eng/mnemocode_typescript/blob/v0.1.0/CHANGELOG.md).

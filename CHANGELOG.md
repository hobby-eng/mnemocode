# Changelog

## 0.2.0 (unreleased)

MnemoCode is now written in Rust. Each system gets one executable with nothing else to install, and each page of the wallet tools gets a WebAssembly file. It reads every backup, record and share that 0.1.0 made and writes the same ones. Commands, questions and messages stay as in 0.1.0, apart from the changes below.

### Cross-stitch patterns

- `stitch`, and Embroidery among the forms of the menu's Encode, hide a phrase in a cross-stitch pattern made from a picture. The phrase is masked with dates, as Seedshift does, and kept in the legend: in each row's symbol and in the last digits of its stitch count. The pattern is a PDF in DMC threads, with a cover, the legend and the chart. [SeedStitch](docs/SEEDSTITCH.md) describes the format.
- Decode reads a legend back with the dates, typed or from a file, and corrects one mistyped row, naming it.
- The self-test reads the format's example legend at every start; the full self-test also makes a pattern and reads its legend back.
- The WebAssembly files of the Deriver pages hold it too, as the `browser-embroidery` module.

### Wallet checks

- An address names its coin: the question "Which coin is the address for?" is gone, and `--coin-address` needs no `--coin`. An address is read as every coin whose form it has, and the paths of each are searched: `1…` as Bitcoin and Bitcoin Cash, `3…` as Bitcoin and Litecoin, `0x…` as Ethereum and Ethereum Classic. `--coin` only narrows it to one coin. An address of no coin is refused with the reason of a coin whose form it has, such as a wrong EIP-55 checksum.
- `--bitcoin-profile` is gone. A Bitcoin address's form names its path; a ypub or upub names BIP49 and a zpub or vpub BIP84; any other extended key form, a compressed public key or a WIF is looked for at BIP44, BIP49, BIP84 and BIP86.
- In the WebAssembly files, `WalletPlace`, `WalletEvidence.wif` and `WalletEvidence.accountKey` take no profiles; `WalletEvidence.coinAddress` with an empty coin reads the address as every coin, and `coins` names them.

### Install and run

- One executable each for Linux on x86-64 and ARM64, Windows on x86-64, and macOS on ARM64 and x86-64, and an archive of the WebAssembly files for the pages.
- The Linux executables need glibc 2.35 or later, which Ubuntu 22.04, Debian 12 and newer have. They do not run on musl systems such as Alpine.
- Cards draw their PNG and JPEG images themselves, so Poppler's `pdftocairo` is no longer needed. The program starts no other program, and the Protection line and the self-test no longer mention "no other programs".
- The npm package and the Node.js library are gone: the pages take the WebAssembly files instead. The Node.js permission model and the start-up check of the SSKR engine's files are gone too, since the engine is part of the program.

### Menu and help

- The README follows the order of the menu, with paired command examples and an index of the documentation. Each menu task and recovery choice shows its own explanation and a link to its section.
- Re-encode asks for the new backup before the old one, so that its outputs are checked before any secret is typed.
- The help of `--ask-secrets` says that standard error must be the terminal too, as its refusal does.

### Limits and refusals

- Each answer, file and standard input has its own limit, which `--help` names, and a longer one is refused with that limit. A BIP39 passphrase may have 4 KiB. 0.1.0 read up to 1 MiB for each.
- A QR code image may have up to 2 megapixels, where 0.1.0 took 8. A 1920 × 1080 screenshot fits, and the QR images that MnemoCode saves are 720 px; crop a larger photo or page image to the code. An image of noise can still take seconds, and Ctrl+C acts only when the reading ends.
- Card text is drawn without ligatures, so a text that fit only thanks to a ligature may now be refused as too long. U+FFFF is refused, since the card font lacks it.
- A word of a host's instructions for heirs wider than the page, such as a long subtitle without a space, is refused. 0.1.0 drew it off the page. As in TS 0.1.1.
- Shares with a threshold of 1 keep no SSKR digest, so a set of them that disagrees is refused. 0.1.0 named one of them as the share that does not fit, which their agreement does not prove. As in TS 0.1.1.
- A file name typed again after an unreadable file, and the name of the next share's QR image, are read only from regular files. A named pipe without a writer is refused at once, where 0.1.0 waited for one and held Ctrl+C. As in TS 0.1.1.

### Output

- A missing parent folder of an output file is made before any secret is read. Output paths are checked before the command's own options: of a wrong path and a wrong option, the path is named first, and a folder made for a refused command stays.
- On Linux with Landlock, a failed save may take another name only in the folders of its outputs.
- If standard output does not take the result, as on a full disk, the command says so and ends with exit code 1. A closed pipe, as with `| head`, ends it as done.
- A line of a secret result that 0.1.0 wrote to standard error goes to standard output when standard error is a terminal and no private screen is open.

### Secrets

- A command with a secret result is refused on a terminal without a private screen. Files and pipes get the result as before.
- On Linux, a tracer attached to the process refuses secrets.
- Secrets live in types that wipe them, every freed block of memory is wiped, and the memory of a secret is kept out of swap where the system allows it. SECURITY.md lists what is wiped but not locked: drawn pages, the codes on cards, a command's dates and a step's working copies.
- No secret stays in the memory of a page's WebAssembly file once a call returns; the gates check this on every commit.
- Random numbers come only from the operating system, or in a browser from `crypto.getRandomValues`.

### Same results, other bytes

- PDF files hold the same pages, text, positions and images. Their bytes differ, since another library writes them.
- PNG files other than page images have the same pixels. QR codes have the same payload, version and error-correction level; their mask may differ.
- Page images have the same size. Read cropped to the code, the QR code of each page holds the same payload, with pixels within a small tolerance of 0.1.0's.

### Builds and signatures

- The Linux and Windows executables and the WebAssembly files are built twice in a pinned container, and a byte that differs stops the release. The macOS executables are built on macOS runners, as Apple's SDK requires, and are checked but not rebuilt byte for byte.
- GitHub signs the build provenance of every release file, and the maintainer signs each release's `SHA256SUMS` with an OpenPGP key. [Releasing](docs/RELEASING.md) describes the steps.
- MnemoCode is licensed under the MIT license or the Apache License, Version 2.0, at your option. `THIRD_PARTY_NOTICES.md` carries the notices of every crate, font, map and image in a release.

## 0.1.0

The TypeScript version, now in its own repository, [mnemocode_typescript](https://github.com/hobby-eng/mnemocode_typescript): [its changelog](https://github.com/hobby-eng/mnemocode_typescript/blob/v0.1.0/CHANGELOG.md).

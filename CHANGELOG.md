# Changelog

## 0.2.0 (unreleased)

MnemoCode is now written in Rust. Each system gets one executable with nothing else to install, and each page of the wallet tools gets a WebAssembly file. It reads every backup, record and share that 0.1.0 made and writes the same ones. Commands, questions and messages stay as in 0.1.0, apart from the changes below.

### Cross-stitch patterns

- `stitch`, and Embroidery among the forms of the menu's Encode, hide a phrase in a cross-stitch pattern made from a picture in PNG, JPEG or WebP. The phrase is masked with dates, as MnemoCode Seedshift does, unless No Seedshift is chosen (`--mode direct`), as in Encode, and kept in the legend: in each row's symbol and in the last digits of its stitch count. The pattern is a PDF in DMC threads that looks like one bought from a designer: a cover with the picture stitched, the floss key on one page, and the chart in colour with its symbols on the sheet the pattern was fitted into. The menu asks for the fabric, Aida 11, 14, 16 or 18 or linen 28 stitched over one thread, and offers sizes from A6 to A2, each with the stitches of the picture in it and their centimetres, or a width in centimetres or stitches; `--fabric`, as `14` or `linen-28`, gives the fabric that the finished size and the skeins are given for. [SeedStitch](docs/SEEDSTITCH.md) describes the format. Like every new backup, a pattern can also save its legend line as text and as a QR code image, show the copies on the screen and add the sheet for heirs. With the Original Seedshift a pattern keeps every word but the last, which is replaced as `--legacy-valid-last-word` replaces it: the owner remembers the real last word, and Decode offers the possible ones.
- Decode reads a legend back, typed or from a file, asks for the dates where its check says the phrase is masked, and corrects one mistyped row, naming it where only that row explains the change. A legend of the usual form typed with the DMC numbers that its key prints reads too.
- A pattern too small or too plain for the legend's usual form uses the order of its rows as well (format 2): fewer threads hold the phrase, so a 24-word phrase fits 60 stitches across. Its legend line names each row's DMC number, as `15:407:38`. MnemoCode uses it only where the usual form cannot hold the phrase.
- Decode reads a pattern's PDF: the PDF keeps its legend line compressed in the floss key page's private data, which no viewer shows and which holds nothing the page does not print. The menu offers In a cross-stitch pattern among the places of the encoded phrase. A PDF another program saved again may lose it; then the legend is typed from the key.
- The self-test reads the format's example legend at every start; the full self-test also makes a pattern and reads its legend back.
- The WebAssembly files of the Deriver pages hold it too, as the `browser-embroidery` module: a pattern with or without Seedshift, the sizes the menu offers for a picture, its PDF for any of the fabrics, and its legend read back, typed or from the PDF.

### Hidden QR records

- PDF and PNG exports can carry a hidden QR record (`--qr-hidden`): ordinary scanners show the printed contact or a chosen text (`--qr-text`), and MnemoCode reads back the exact backup codes or share. `qr-hide` wraps an existing record, `qr-open` extracts it unchanged, and the browser binding does both. [Hidden QR records](docs/HIDDEN_QR.md) describes the format and its limits.

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
- Re-encode asks for the new backup before the old one: the new backup's dates first, then its outputs, which are checked and write-restricted before the old phrase is typed.
- The menu numbers the self-test 0, the command list s and Quit q, and asks where to save Encode's result as a checklist, the QR code image beside cards too; the sheets then carry the same kind of QR code as the image, ordinary or with hidden data.
- Every new backup asks the same questions in the same order, whatever form it takes: Seedshift, its dates, the form's own questions, Shamir shares, the copies on the screen, the sheet for heirs, and last, just before the seed phrase, where to save it. An answer a form cannot take stays greyed with the reason.
- The menu no longer asks for each file's name: after where to save, it asks once for a folder, the one MnemoCode started in unless another is typed, and each file takes its usual name, numbered where one is there already.
- A new backup asks whether to use Seedshift and which on one screen: MnemoCode Seedshift, Original Seedshift or No Seedshift. Where only MnemoCode Seedshift fits, as for shares, the original stays greyed; for a form that is always masked, No Seedshift does.
- The help of `--ask-secrets` says that standard error must be the terminal too, as its refusal does.
- A message about a saved file or folder names it by its full path, from the root, so that it can be found wherever the program was started. 0.1.0 named it as it was typed.

### Limits and refusals

- Each answer, file and standard input has its own limit, which `--help` names, and a longer one is refused with that limit. A BIP39 passphrase may have 4 KiB. 0.1.0 read up to 1 MiB for each.
- A QR code image may have up to 2 megapixels, where 0.1.0 took 8. A 1920 × 1080 screenshot fits, and the QR images that MnemoCode saves are 720 px; crop a larger photo or page image to the code. An image of noise can still take seconds, and Ctrl+C acts only when the reading ends.
- Card text is drawn without ligatures, so a text that fit only thanks to a ligature may now be refused as too long. U+FFFF is refused, since the card font lacks it.
- A word of a host's instructions for heirs wider than the page, such as a long subtitle without a space, is refused. 0.1.0 drew it off the page. As in TS 0.1.1.
- Shares with a threshold of 1 keep no SSKR digest, so a set of them that disagrees is refused. 0.1.0 named one of them as the share that does not fit, which their agreement does not prove. As in TS 0.1.1.
- A file name typed again after an unreadable file, and the name of the next share's QR image, are read only from regular files. A named pipe without a writer is refused at once, where 0.1.0 waited for one and held Ctrl+C. As in TS 0.1.1.

### Output

- A missing parent folder of an output file is made before the seed phrase is read; in the menu's Encode, Embroidery and share split, the Seedshift dates are asked before it. Output paths are checked before the command's own options: of a wrong path and a wrong option, the path is named first, and a folder made for a refused command stays.
- On Linux with Landlock, a failed save may take another name only in the folders of its outputs.
- A taken file name is numbered with an underscore, as `shares_1.txt`; a taken folder keeps `-1`.
- If standard output does not take the result, as on a full disk, the command says so and ends with exit code 1. A closed pipe, as with `| head`, ends it as done.
- A line of a secret result that 0.1.0 wrote to standard error goes to standard output when standard error is a terminal and no private screen is open.

### Secrets

- A command with a secret result is refused on a terminal without a private screen. Files and pipes get the result as before.
- On Linux, a tracer attached to the process refuses secrets.
- Secrets live in types that wipe them, every freed block of memory is wiped, and the memory of a secret is kept out of swap where the system allows it. SECURITY.md describes the best-effort lock requests for retained secrets and the exceptions for rendered pages, search working state and temporary or third-party working copies.
- Secret WebAssembly calls scrub temporary working state, and freed allocations are wiped. Objects deliberately retained by the host keep their contents until the host frees or wipes them; the gates check the recorded entry and ownership paths.
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

# Using the Rust library

The `mnemocode` crate provides the same transformations, recovery, shares and wallet checks as the command line. `mnemocode-cards` draws cards and heir sheets; `mnemocode-embroidery` makes cross-stitch patterns whose legend holds a masked phrase; `mnemocode-wasm` exposes selected features to browser hosts. These crates are built from this repository and are not published to crates.io.

Use a path dependency on the checked-out crate, or pin a reviewed Git revision. Keep `Cargo.lock` and the selected features with your application. API details are in the source's rustdoc:

```sh
cargo doc --locked --no-deps -p mnemocode -p mnemocode-cards -p mnemocode-embroidery
```

The [source layout](ARCHITECTURE.md#modules-for-other-hosts) maps features to modules. The [architecture design](design/architect/ARCHITECTURE.md) records the dependencies and host boundaries.

## Encode and decode

This example uses a published test phrase and direct Unicode codes. Real phrases must come from a protected input source; do not put them in source files or logs.

```rust
use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let phrase = Phrase::parse(
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
    )?;
    let encoded = Backup::encode(&phrase, &[], Form::Unicode, Mode::Direct)?;
    let record = encoded.backup.record()?;
    assert!(record.as_str().starts_with("MNC1:direct:unicode:"));

    let recovered = encoded.backup.decode(&[])?;
    assert_eq!(recovered.recovered.as_slice().len(), phrase.len());
    for (place, &index) in recovered.recovered.as_slice().iter().enumerate() {
        assert_eq!(Some(usize::from(index)), phrase.index(place));
    }
    Ok(())
}
```

For Seedshift, pass checked `dates::Date` values and `Mode::Seedshift`. English words and word numbers require a masking mode when creating a backup. `Backup::read` reads headerless codes when the form and mode are known; `recovery::reading` handles mixed records, codes and shares. `Backup::record` still writes the `MNC1:<mode>:<format>:` record of earlier versions for hosts that keep one; the command line saves the codes alone.

`Mode::SeedshiftLegacy` encodes the Original Seedshift with a last word that passes the checksum; `Encoding::original_last_word` is the word its shift gave, which the person keeps. Codes read in that mode are taken by their last word: codes whose last word fails the checksum, as the original program writes them, decode exactly; codes that keep it give one or two `Backup::candidates`, and `Backup::decode_with_last_word` gives the one phrase with the word kept. Do not select a candidate merely because it has a valid checksum.

## Host services

The library takes randomness through `random::Random`; native adapters use the operating system and browser adapters use `crypto.getRandomValues`. Production hosts must supply cryptographically secure randomness and propagate failures. Fixed generators are for public tests only.

Searches implement `search::Search`. The host times public pace samples, presents the estimate and consent, then calls `step(work)` in bounded turns. The recovery binding accepts finite whole `work` values from 0 through `u32::MAX`; malformed values are refused with `wasm.recovery.work`, without advancing the search. The library reads no clock and starts no worker. Native hosts can drive it from their execution loop; browsers can yield to the page or a worker between steps.

Files, terminal questions, download verification, output publication and process sandboxing stay with the host. Card scenes, PDF writing and image rasterization are implemented in Rust; no external image converter or host rendering engine is required.

## Browser modules and features

Each page gets the modules and units selected in `wasm-profiles.json`. For example:

```sh
cargo xtask wasm build multi-chain/key-derivation
cargo xtask wasm build multi-chain/discovery-scanner
```

Use the generated glue and its matching `.wasm` from the same build; do not mix versions. `cargo xtask release pages` packages all page profiles for release. `cargo xtask wasm verify` checks the profiles, imports, glue and startup behaviour. Available binding modules are:

| Feature              | Binding source    | Purpose                                              |
| -------------------- | ----------------- | ---------------------------------------------------- |
| `browser-phrase`     | `phrase`, `words` | Encoding, fingerprints, word lookup and dictionaries |
| `browser-wallet`     | `wallet`          | Wallet evidence and local comparisons                |
| `browser-sskr`       | `sskr`            | Share formats, splitting and restoration             |
| `browser-recovery`   | `recovery`        | Backup reading, searches, repair and re-encoding     |
| `browser-candidates` | `candidates`      | Candidate-list admission, encryption and import      |
| `browser-qr`         | `qr`              | QR images and decoding                               |
| `browser-cards`      | `cards`           | Printable cards and heir sheets                      |
| `browser-embroidery` | `embroidery`      | Cross-stitch patterns and reading their legends back |
| `browser-files`      | `files`           | Backups found in the files a page is given           |

These sources are under `crates/mnemocode-wasm/src/`. Coin, search and template features select units independently. A build without a unit refuses its use; consult the selected profile rather than assuming the complete CLI's feature set. The `browser-probe` feature is for tests, not production page profiles.

The host supplies the page UI, execution policy, CSP, isolated frames and workers where needed. Release bindings do not install those protections. See [library and browser security](../SECURITY.md#library-and-browser-hosts).

## Secret ownership

Rust secret owners, including `Phrase`, `SecretBytes` and `SecretText`, wipe their owned buffers when dropped. Borrowed slices remain valid only for the owner's lifetime. Avoid copying secrets into ordinary `String` or `Vec` values; if a copy is necessary, give it an explicit cleanup lifetime. `Debug` output of secret owners is redacted.

Small secret buffers reserve their final capacity and request page locks before filling. `SecretVec<T>` applies the same owner to typed values implementing `Zeroize`: it never grows, wipes rejected appended values, redacts its debug output and wipes before releasing its counted page hold. It locks only the outer allocation; an element's own allocations need their own protected owners. `SecretVec::new` adopts an existing allocation without copying and locks it only from adoption onward, so earlier copies are not covered; `with_capacity` requests locks before elements are filled. `SecretText::take` similarly adopts a prepared UTF-8 string without copying; explicit zeroization empties it while retaining the allocation and its page hold. Retained `CardCodes` colors, labels and QR payload use protected text owners, with fixed typed arrays for the code lists. Construct them with `CardCodes::new`; the unreleased Rust field types now expose these owners, while exported bytes and browser methods remain unchanged. CLI date lists use `SecretVec<Date>`; wiping a `Date` replaces it with the valid constant date 0001-01-01. Locks are best effort, counted per page and subject to system limits. `SecretBytes::large` deliberately skips locking for buffers such as rendered pages. Ordinary temporary values and third-party working copies are not covered by a promise of complete erasure.

The CLI and WebAssembly binding register `secret::ZeroingAllocator`. A native application must register it itself if it wants general freed allocations wiped too:

```rust
#[global_allocator]
static ALLOCATOR: mnemocode::secret::ZeroingAllocator = mnemocode::secret::ZeroingAllocator;
```

Choose the allocator as part of the final application; a dependency must not install a competing global allocator. The library's secret owners wipe their own buffers even without this allocator. The host remains responsible for copies it retains, abrupt termination, swap, crash handling and process protections.

Browser hosts must release generated binding objects when finished, including error and cancellation paths, and wipe owned typed arrays. JavaScript strings, DOM fields and browser copies cannot be guaranteed erased. Do not log an input, a returned phrase, a candidate list or a rendering plan that contains codes.

## Cancellation and refusals

`Search::step` returns `Step::Running` or `Step::Done`. `finish` consumes the search and returns its current outcome; an outcome taken before `Done` is partial. A stopped search is not proof that no candidate exists. Keep partial results distinguishable from exhaustive results.

BIP39 phrase construction checks every supplied dictionary index before accepting the checksum. Out-of-range word lookups return `None`, including indexes too large for byte-offset arithmetic. BIP32 child derivation refuses depth beyond its one-byte serialization field with `core.bip32.depth-exceeded`; supported paths and valid extended-key encodings retain their existing meaning.

Each library module has its own error enum implementing `std::error::Error` and `refusal::Refusal`. Use `Refusal::code()` for decisions, not the English message. The binding converts refusals to JavaScript errors with the stable code and corresponding error kind. Text is intended for display and should not be parsed as a protocol.

## Share-engine contracts

The Rust crate links the pinned vendored SSKR engine and crypto shim. A host does not load a separate share engine or repeat the TypeScript engine-file hash checks. Known-answer checks live in the library; artifact identity is established by the final application's release verification.

Strict restoration is in `sskr::restore`; interactive assessment and repair use `recovery::shares`. Original Seedshift codes that keep the checksum give one or two phrases a date: `backup::re_encoding::with_last_word` picks the one that the last word Encode named gives, `ShareRestoreRequest::last_word` does it for shares, and in the browser `ReadBackup.decode(form, mode, dates, lastWord)` and `Recovery.restoreShares(shares, mode, dates, decodeEntry, lastWord)` take the word, undefined for both phrases. Where enough shares give no phrase and no wallet was given, the restore ends in `ShareRestoreOutcome::NoPhrase`: the last word fits none (`core.share-restore.last-word-fits-no-phrase`), or no phrase keeps the checksum (`core.share-restore.no-valid-phrase`); the browser's `SearchResult` gives it as a trouble with that `code`. Preserve the distinction between checked members and incomplete groups whose members cannot yet be checked. A candidate phrase is not a claim that every supplied share was verified. Repairs can leave more than one solution; require selection or wallet evidence before creating a replacement backup. See [share validation](SSKR.md#recovery) and the methods' rustdoc for their exact outcomes.

## Candidate-list encryption

Use `candidates::gate::Gate::ready` before accepting encryption work; `recheck` reruns its known answers. The gate provides identity creation and age encryption/decryption with the library's parameter checks. `candidates::writer` connects a search's candidates to a list. Key, passphrase and plaintext protection choices live under `candidates::protection`.

A list contains seed phrases and may contain BIP39 passphrases. Keep it private even when encrypted. The [MNCL format](CANDIDATES.md) fixes candidate numbering, padding, encryption and size limits. A Scanner session's recipient is an encryption destination, not a wallet reference.

### File admission for hosts

Before reading a candidate file in full, apply the size and format rules in `candidates::admission`. Inspect at most `MAX_HEADER_BYTES` (65,536 bytes) to classify the lock; bound the complete read by `MAX_CANDIDATE_LIST_BYTES` or `MAX_ENCRYPTED_BYTES`, then validate the complete file and selected lock. Encrypted files allow at most one supported age stanza. A suffix or filename is not proof of content.

The format allows 524,288 records. The largest padded plaintext is 155,189,248 bytes and the encrypted ceiling is 155,292,688 bytes. Those are file limits, not memory budgets: decoded objects, crypto working memory and copies need additional space. Release file buffers, keys, identities and decoded lists on every exit path; refuse unsupported or inconsistent content rather than silently falling back to plaintext.

## Cards and output names

`mnemocode-cards` separates settings and preflight, content, drawing plans, and PDF/raster output. A host can request the same designs, share sheets and heir instructions as the CLI. The plans themselves contain recovery codes and must be treated as secret.

The library draws bytes; the host chooses filenames, stages files privately and publishes without overwriting existing output. The CLI's filesystem policy is not automatically applied to an embedding application. Follow [export precautions](../SECURITY.md#exported-files), and check [card options](CLI.md#card-options) for the end-user behaviour to preserve.

## Cross-stitch patterns

`mnemocode-embroidery` implements [SeedStitch](SEEDSTITCH.md). The format is public, so a legend holds a phrase masked with Seedshift dates unless the person chooses otherwise: `phrase::masked_entropy` makes the `LegendEntropy` that `hide::hide` takes, and `phrase::unmasked_entropy` makes one of the phrase itself, for a phrase protected some other way, which anyone who knows the format reads. `phrase::legacy_entropy` makes one masked with the Original Seedshift, written with a last word that passes the checksum, so that it is a phrase's entropy as long as every other mode's. With the `sskr` feature, `phrase::share_entropies` splits the phrase into SSKR shares as `sskr::split::split_backup` does and makes one `LegendEntropy` per share, for a pattern each, in any mode. `phrase::legend_entropy` picks among the first three by the mode, as the command line does. `picture::grid` reads a PNG, JPEG or WebP file within the limits of `picture` (40 MiB, 60 megapixels, 40 to 500 stitches across, at most 800 down), brightens it a little as a pattern designer would and averages it down to one colour per stitch; `pattern` matches the colours to DMC threads and chooses each stitch by a modified Floyd–Steinberg dithering (serpentine, in CIELAB, its error clamped). The picture holds no secret. `chart::chart` writes the PDF, and `legend::line` the line a person types back.

Reading goes the other way: `phrase::record_of_legend` turns a typed legend line into the word numbers of its phrase, which name no mode, as the legend does not say whether or how the phrase is masked, and says whether it corrected a misread row, naming the row where only that row explains the change. A share's legend is refused there with `embroidery.phrase.share`; `phrase::share_of_legend` (feature `sskr`) reads it as the `Share` it holds, with the same report of a corrected row, and none for any other line. `hide::hide` writes format 1 wherever it holds the phrase and format 2, whose rows' order holds part of it, only where format 1 cannot; `Hidden::rows` gives the rows in the legend's order and `Hidden::row_threads` the thread of each. `chart::chart` keeps the legend line in the PDF's private data, and `chart::legend_of_pdf` reads it back (`mnemocode-cards`' `pdf::piece::private_data`). The pattern, the legend and the record are secret material; the `Hidden` result holds its rows and their order in fixed typed secret owners that request page locks and wipe on drop.

With the `sskr` feature, `found` tells what a file holds from its bytes (`found::read_file`): printed cards, which keep their codes as named colour swatches in their XMP design metadata (`mnemocode-cards`' `printed`), a pattern's legend line, or a QR code's record or share; and a `found::Collector` takes the files of a folder, or those a person picked, and lists each backup and each set of shares once, whatever files hold it, with what it holds and why it cannot be read where it is not complete. The command line's search of a folder and the browser's `files` module both use it.

In the browser, the `files` module (`browser-files`) reads the files a page is given: `readBackupFile(bytes)` tells one file's kind ("cards", "qr" or "pattern"), its codes, the kind of codes, the words of a backup, a share's set, member and threshold and the cards' document ID, and refuses a file of nothing MnemoCode reads with `wasm.files.nothing`, which a page may pass over, and one over `backupFileMaxBytes()` with `wasm.files.too-large`. `BackupFiles` takes several files (`add(bytes, name)`) and `finish(root)` gives `FoundBackups`, listed as Decode lists a folder: label, note, trouble, warning, kinds, set, needed, members and their groups, cards, files, the `--format` name of the codes (`form`), the text as a person types it, and a set's shares as `ur:sskr`. `BackupFile.form` names one file's codes the same way: english, indexes, unicode, colors-unicode or colors, a share's own form, or legend. A page bounds a picked folder by `backupFolderMaxFiles()` files and `backupFolderMaxDepth()` folders down, as the command line does; each file has `backupFileMaxBytes()`. `browser-files` takes in `browser-embroidery` and `browser-sskr`. `StitchShares(phrase, dates, picture, stitchesAcross, mode, threshold, shares)` makes one pattern per share, all of the same picture, each with `legend(at)`, `pdf(at, fabric)`, `rows(at)` and `seenDifference(at)`. With the Original Seedshift, `originalLastWord()` of `EncodedBackup`, `SplitShares`, `StitchPattern` and `StitchShares` gives the last word the shift gave, which the person keeps; it is undefined in every other mode. `HeirPage.patternSheet(words, mode, dates)` and `patternSharesSheet(threshold, count, mode, dates)` make the sheets for heirs of a pattern and of the patterns of shares.

In the browser, `readStitchPdf(bytes)` refuses a document over `stitchPdfMaxBytes()` (64 MiB, the command line's limit) with `wasm.embroidery.pdf-too-large` before it scans it. The bytes are copied into WebAssembly memory before that check, as for every byte argument of the binding, so the page compares the file's size with `stitchPdfMaxBytes()` before it reads the file. The browser module makes whole-backup patterns, and with `StitchShares` the patterns of shares; `readStitchLegend` and `readStitchPdf` refuse a share's legend with `embroidery.phrase.share`, which `readStitchShareLegend` reads as a `StitchShareLegend`, and `readBackupFile` and `BackupFiles` as a share. A legend read back has `corrected`, true where a misread row was corrected, and `correctedRow`, undefined where several rows explain the same phrase. `StitchSizes.fewestCentimetres` and `mostCentimetres` are undefined where no width in millimetres gives the stitches the picture allows, as for a few stitches on fine linen; the page then asks for stitches.

## Hidden QR records

`mnemocode::qr::hidden::matrix(visible, record)` and `png(visible, record)` preserve an exact UTF-8
record in nonstandard filler bytes, using level M. `read_png(bytes)` corrects the codewords and
verifies its format check before returning a `SecretText`. Ordinary `qr::read_png` still returns
the public text. See [the format and CLI](HIDDEN_QR.md) for limits and recovery.

The QR browser module exposes `hiddenQrPng(visible, record)` and `readHiddenQrPng(bytes)`;
`CardExport.setHiddenQr(true)` selects the same format for PDF sheets. `CardPlan.qrPng()` and
`ShareCards.qrPng(at)` give the sheet's QR code as a PNG exactly as printed, hidden or ordinary,
and `CardExport.hiddenQrPng(record)` a PNG of a record alone behind the contact that the export's
cards print, the one its `CardSession` keeps. Dates and passwords are never part of the public
text automatically.

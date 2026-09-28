import { cardTemplates } from '../export/templates.js';
import { MNEMOCODE_VERSION } from '../version.js';
export function printUsage(): void {
  const color = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  const paint = (code: number, text: string): string =>
    color ? `\x1b[${code}m${text}\x1b[0m` : text;
  const title = (text: string): string => paint(1, paint(36, text));
  const section = (text: string): string =>
    `\n${paint(1, paint(33, text))}\n${paint(2, '─'.repeat(72))}`;
  const mode = (text: string): string => paint(1, paint(32, text));
  const flag = (text: string): string => paint(36, text);

  console.log(`${title(`MnemoCode ${MNEMOCODE_VERSION}`)}
Offline reversible representations for English BIP39 mnemonics

${section('USAGE')}

  mnemocode encode --mode MODE \\
    (--ask-secrets | --mnemonic "..." | --mnemonic-file PATH) [OPTIONS]

  mnemocode decode [--mode MODE] \\
    (--ask-secrets | --input "..." | --input-file PATH | --qr-file PATH) [OPTIONS]

  mnemocode recover-date [--mode MODE] \\
    (--ask-secrets | --input "..." | --input-file PATH | --qr-file PATH) [OPTIONS]

  mnemocode recover-word \\
    (--ask-secrets | --mnemonic "... ? ..." | --mnemonic-file PATH) [OPTIONS]

  mnemocode table (--index N | --word WORD | --unicode HEX | --all)
  mnemocode preview (--list | --pdf PATH | --cards-dir PATH) [--template ID | --all]
  mnemocode self-test
  mnemocode --version

  mnemocode encode --sskr --threshold 2 --shares 3 \\
    (--ask-secrets | --mnemonic "..." | --mnemonic-file PATH) [OPTIONS]
  mnemocode sskr-combine --share "ur:sskr/..." --share "ur:sskr/..."
  mnemocode sskr-export --share-file PATH --cards-dir NEW_FOLDER [OPTIONS]

${section('SSKR SHARES')}

  Create and recover Blockchain Commons SSKR shares offline.
  ${flag('--threshold N --shares M')}  Require any N of M shares (2 <= N <= M <= 16).
  ${flag('--mode direct|seedshift')}  Direct is the default; dates imply Seedshift.
    Seedshift dates and the BIP39 passphrase are NOT stored in the shares.
    Recover shifted records with sskr-combine --mode seedshift --dates ...

  ${flag('--format 1|2|3|5|6')}  Encoded mnemonic representation, as in ordinary encode.
  ${flag('--share-format ur|colors')}  Separate share output; default ur.
    Share RGB codes are a separate ordered format, not ordinary format 5.
    Both compact and space-separated RGB codes can be read back.
  ${flag('--output NEW_FILE')}  Save standard UR records, one complete share per line.
    The terminal still shows the shares. The file contains the whole supplied set.

  ${flag('--pdf NEW_FILE')}  All shares in one multi-page PDF.
  ${flag('--cards-dir NEW_FOLDER')}  Export separate PDFs; existing folders are never overwritten.
  ${flag('--card-layout qr')}          One complete-share QR document; selected size and design.
  ${flag('--card-layout collection')}  Default: one color collection document per share.
  ${flag('--card-layout individual')}  One folder per share with numbered fragments; selected size.
    In individual mode ALL cards in a folder are needed to reconstruct ONE share.
  ${flag('--template ID')}  Any installed design; use preview --list.
    Existing card-name, card-company, card-role, card-email, card-phone, card-website and
    card-location options apply. Page size and orientation are independent of the visual design.
    QR is off by default. --card-layout qr enables it explicitly; --card-qr
    adds it to collection layout. Individual QR contains only that fragment’s references.
    Each enabled QR carries only its own share, represented as RGB codes.

  Read shares using repeatable ${flag('--share TEXT')}, ${flag('--share-file PATH')}, or
  ${flag('--share-qr PNG')}; files contain one complete share per non-empty line.
  Standard SSKR UR, Bytewords and MnemoCode SSKR colors are detected automatically.
  ${flag('--ask-secrets')} reads shares through hidden input (semicolon between shares).
  A duplicate member, damaged record, mixed set or incomplete quorum is rejected.
  sskr-export changes presentation only; it never generates new shares.
  --pdf, --cards-dir and --output may be combined; each stores the same share set.
  The combined PDF and output file contain all shares. Each separate PDF holds one.
  sskr-split remains a compatibility alias, with --format ur|colors for shares.
  sskr-export also uses --format ur|colors; it does not re-encode a mnemonic.

  Examples:
    mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 \\
      --cards-dir ./sskr-cards --card-layout qr --template business-it
    mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3 --output ./shares.txt
    mnemocode sskr-export --share-file ./shares.txt --cards-dir ./sskr-a6 \\
      --card-layout collection --page-size a6 --orientation portrait
    mnemocode sskr-combine --share-file ./selected-shares.txt

${section('TRANSFORMATION MODES')}

  ${mode('direct')}
    Validate and represent the mnemonic without changing it. No dates.

  ${mode('seedshift')}  ${paint(2, '(default when --dates is present)')}
    MnemoCode variant that preserves checksum validity. Complete 11-bit blocks are
    shifted modulo 2048; the final r-bit entropy tail is shifted modulo 2^r;
    a fresh BIP39 checksum is derived. Correct dates recover the original
    without a search. Every date combination produces a valid mnemonic.

  ${mode('seedshift-legacy')}
    Reproduces the original Seedshift whole-word transformation. The result may have an
    invalid checksum. MnemoCode immediately displays an optional valid final
    word. Use ${flag('--legacy-valid-last-word')} to apply that replacement.

  ${mode('seedshift-legacy-valid')}  ${paint(2, '(recovery profile)')}
    Used when a legacy final word was replaced. Decoding enumerates possible
    originals and prints a BIP32 fingerprint beside every candidate:

      12 words → 128     15 → 64     18 → 32     21 → 16     24 → 8

  A versioned MNC1 record supplies its mode and format. For raw input, MnemoCode
  detects the representation when exactly one parser matches. If it cannot make
  a unique choice, an interactive terminal asks; scripts must pass ${flag('--format')}.
  Raw legacy input also needs the appropriate legacy ${flag('--mode')}.

${section('INPUT AND RECORDS')}

  ${flag('--mnemonic TEXT')}        source English BIP39 mnemonic
  ${flag('--mnemonic-file PATH')}   read mnemonic from PATH; use - for stdin
  ${flag('--input TEXT')}           encoded representation to decode
  ${flag('--input-file PATH')}      read an encoded representation from PATH
  ${flag('--qr-file PATH')}         decode a local PNG QR image
  ${flag('--dates DATE ...')}       DD-MM-YYYY values separated by spaces
  ${flag('--format VALUE')}         optional explicit representation name or number
  ${flag('--ask-secrets')}          hidden prompts on the controlling terminal
  ${flag('--output PATH')}          also save an MNC1 file; results still appear in the terminal

  Dates are sorted before their year/month/day components repeat as shifts.
  Hidden Seedshift input asks separately for the mnemonic/record and date list.

  Word count     12      15      18      21      24
  Maximum dates   4       5       6       7       8

${section('REPRESENTATIONS')}

  Value              Stored representation
  ─────              ────────────────────────────────────────────────────
  1  english         English BIP39 words
  2  indexes         1-based BIP39 indexes from 1 through 2048
  3  unicode         four-digit code points obtained through corresponding
                     Traditional Chinese BIP39 entries; spaced or concatenated
  5  colors          reversible #RRGGBB values, separated or concatenated.
                     BIP39Colors-compatible for 12/24 words; MnemoCode also
                     supports 15, 18, and 21
  6  colors-unicode  the same lossless colour data as two visible four-digit
                     Private Use Unicode code points per RGB value; all five lengths

  Format 3 uses the Traditional Chinese BIP39 mapping but prints only code
  points. Format 6 is MnemoCode-specific portable hexadecimal text; its legacy
  Private Use symbol form remains readable. Both are representations, not encryption.

${section('TERMINAL AND FILE OUTPUT')}

  ${flag('--cards')}                show exact RGB cards in the terminal
  ${flag('--qr PATH')}              save the selected representation as a QR code in a PNG file
  ${flag('--output PATH')}          save a versioned MNC1 text record

  ${flag('--pdf PATH')}             save a card collection as a PDF
  ${flag('--cards-dir PATH')}       save each sample/reference group as a separate file
  ${flag('--template ID')}          choose its visual design (name or number)
  ${flag('--title TEXT')}           optional card title
  ${flag('--events \"LABEL\" ...')}   one label per date, in entered date order

  mnemocode preview --list
  mnemocode preview --template ID --pdf preview.pdf
  mnemocode preview --all --pdf all-previews.pdf

  Templates:
${cardTemplates.map((template, index) => `    ${index + 1}  ${template.id.padEnd(22)} ${template.name}`).join('\n')}
  ${flag('--page-size a4|a6|wallet|business')}
    A4, A6, credit-card size 85.6 x 54 mm, or business-card size 90 x 50 mm.
    Defaults: A6 business collections; wallet material selections.
  ${flag('--orientation VALUE')}    portrait or landscape
  Glass variants: business-glass-4in1, business-glass-6in1, business-glass-8in1.
  Each groups 4, 6 or 8 consecutive references; the last card may contain fewer.
  Collections use one corner QR outside the sketches on the same study page.
  Individual business, material and glass cards remain QR-free.
  ${flag('--card-name TEXT')}        name in Latin letters (random unless supplied)
  ${flag('--card-role TEXT')}        role (random, compatible with the company)
  ${flag('--card-company TEXT')}     employer name
  ${flag('--card-phone TEXT')}       phone number (designs with contact fields)
  ${flag('--card-email TEXT')}       email (default: contact at generated company domain)
  ${flag('--card-website TEXT')}     website (default: generated company domain)
  ${flag('--card-location TEXT')}    location (default: International)

  Every collection is one design-study page with numbered variants and review copy.
  A4/A6 show larger sketches; wallet/business are compact selection sheets, not cutting templates.
  --card-qr adds one corner QR on the same page, clear of artwork and exact references.
  Compact material studies omit decorative finish names; A6/A4 retain them.
  QR is optional and applies only to the complete collection representation.
  Preview accepts the same personal fields and ${flag('--words 12|15|18|21|24')}.
  Omitted personal fields use demonstration values; they never affect encoding.

  Individual cards: use --cards-dir; optionally also save a collection with --pdf. Choose a new folder.
  Each fragment contains only its own reference(s); no collection QR is generated.
  All cards are needed for recovery. This is not threshold secret sharing.
  Page size and orientation also apply to individual files.
  With --sskr, all fragments in one member folder form ONE share.
  Preview supports --cards-dir with one --template per folder.

  mnemocode preview --all --words 24 --page-size a4 --pdf print-previews.pdf
  mnemocode preview --template business-it --card-name "Alex Morgan" \\
    --card-email "alex@example.com" --page-size a6 --pdf my-preview.pdf

  No template for Unicode cards with dates is currently installed.
  The terminal prompts for missing event labels; scripts must supply them.

${section('WORD RECOVERY')}

  Put exactly one ? in place of a forgotten English BIP39 word. MnemoCode
  checks all 2,048 words locally and displays every checksum-valid replacement:

    mnemocode recover-word --ask-secrets
    mnemocode recover-word --mnemonic "abandon ... ?" --master-fingerprint 73c5da0a
    mnemocode recover-word --legacy-valid-last-word --mnemonic "old legacy phrase ..."

  Every row includes the replacement word, its 1-based BIP39 index, the exact
  checksum bits, and the complete candidate mnemonic. Optional Bitcoin evidence
  marks matching rows without hiding the other checksum-valid candidates.
  ${flag('--legacy-valid-last-word')} accepts a complete exact-legacy shifted phrase,
  ignores its checksum-invalid final word for enumeration, and marks the one
  valid replacement that preserves the old word's entropy-bearing bits.

${section('DATE RECOVERY')}

  Replace each forgotten digit with ?. One to three dates may be incomplete:

    ?3-09-2026       10-0?-1963       ??-??-2026       ????-??-??

  The default search limit is 1,000,000 date combinations. Increase it explicitly
  for a larger intentional search; the hard safety limit is 10,000,000.

  Exact legacy mode can use BIP39 checksum as a weak filter. Checksum-valid
  seedshift and legacy-valid records require an independent identifier because
  every attempted date produces checksum-valid candidates.

  ${flag('--master-fingerprint HEX')}   8-hex BIP32 master fingerprint
  ${flag('--bitcoin-address ADDRESS')}  address at the selected profile/path
  ${flag('--master-xpub XPUB')}          root extended public key
  ${flag('--account-xpub XPUB')}         account extended public key
  ${flag('--compressed-public-key HEX')} 33-byte compressed public key
  ${flag('--wif-file PATH')}             expected WIF read from a local file
  ${flag('--bip39-passphrase-file PATH')} optional passphrase for evidence checks
  ${flag('--max-results N')}             displayed candidate limit (default 100)
  ${flag('--max-candidates N')}          attempted combinations (default 1000000; max 10000000)
  ${flag('--progress-every N')}          progress interval (default 1000)

  Bitcoin defaults: mainnet, profile auto, account 0, branch 0, index 0.
  All evidence checks are local and offline.

${section('SELF-TESTS')}

  A small deterministic core self-test runs before every data-processing and preview command.
  It checks the BIP39 word list, fixed direct/Seedshift vectors, reverse recovery,
  and checksum validity. A failure stops before mnemonic input is processed.

  Run ${flag('mnemocode self-test')} for all word lengths, all representations,
  direct/checksum-valid/legacy modes, dates, public vectors, QR I/O, SSKR and PDF assets.


${section('CARD IDENTITY AND COPY')}

  One design-studio name and independent print slogan, subtitle and footer are
  selected per export for collection sheets. They are shared across its pages.
  Employer, role and a Latin-script full name are chosen separately once per export.
  Sector-specific roles match their employer; sales, management and analysis roles
  can appear across sectors. Explicit personal fields always take precedence.
  ${flag('--studio-name TEXT')}           Override the design studio on the sheet.
  ${flag('--card-company TEXT')}          Employer printed inside business cards.
  ${flag('--card-slogan TEXT')}           Override the slogan.
  ${flag('--card-subtitle TEXT')}         Override the subtitle.
  ${flag('--card-footer TEXT')}           Override the footer.
  ${flag('--card-reference-label TEXT')}  Reference label (default: Ref.).
  For these four optional copy fields, use - to hide the text.
  ${flag('--card-qr')}                    Include QR; fragments encode only their own references.
  Ordinary cards omit QR by default. SSKR --card-layout qr explicitly enables it.
  Individual fragments never gain a QR containing the full collection or share.

${section('PNG AND JPEG EXPORT')}

  ${flag('--images-dir NEW_FOLDER')}  Save collection pages as images; PNG by default.
  ${flag('--image-format png|jpg')}    PNG or JPEG (jpeg is also accepted).
  ${flag('--cards-dir NEW_FOLDER --image-format png')}  Individual card images.

  Image export uses the same approved PDF layout at 300 dpi, including all pages.
  Local Poppler pdftoppm must be installed; no new npm package is required.
  A missing renderer is reported before requesting secrets. No online conversion.
  PNG is lossless; JPEG uses quality 90. For exact text/QR preservation prefer PNG.
  Existing folders are refused. Without image options, exports remain PDF.
  Collection --pdf and --images-dir may be combined. Individual cards contain no
  collection QR. SSKR QR cards still contain only their own complete share.

  mnemocode preview --all --images-dir ./preview-images --image-format jpg
  mnemocode encode --ask-secrets --format 5 --template business-it \\
    --cards-dir ./card-images --image-format png

${section('EXAMPLES')}

  Public example used below:

    TEST_MNEMONIC='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

  1. Direct RGB representation:

    mnemocode encode --mode direct \\
      --mnemonic "$TEST_MNEMONIC" --format 5 --cards

  2. Checksum-valid Seedshift:

    mnemocode encode --mode seedshift \\
      --mnemonic "$TEST_MNEMONIC" --dates 23-09-2026 --format 1

    Result: wool abuse actual wool abuse actual wool abuse actual wool abuse congress

  3. Recover the original (expected fingerprint: 73c5da0a):

    mnemocode decode --mode seedshift \\
      --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \\
      --dates 23-09-2026

  4. Show the exact legacy result and optional valid-word suggestion:

    mnemocode encode --mode seedshift-legacy \\
      --mnemonic "$TEST_MNEMONIC" --dates 23-09-2026 --format 1

  5. Find a forgotten day using the printed fingerprint:

    mnemocode recover-date --mode seedshift \\
      --input "wool abuse actual wool abuse actual wool abuse actual wool abuse congress" \\
      --dates "??-09-2026" --master-fingerprint 73c5da0a

  6. Keep a real mnemonic and its dates out of shell history:

    mnemocode encode --mode seedshift --ask-secrets --format 3

${section('SECURITY NOTES')}

  • Fingerprints printed by encode/decode assume an empty BIP39 passphrase.
    They are public 32-bit filters, not authentication proofs.
  • Date shifting and alternate representations are obfuscation, not
    authenticated encryption. Handle every record as sensitive recovery data.
  • For real secrets, use an offline trusted system and ${flag('--ask-secrets')}.
  • Set NO_COLOR=1 to disable terminal colour formatting.
`);
}

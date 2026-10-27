//! The rows of QR codes: PNG admission (MnemoCode TS 0.1.0's `core/png-admission-self-test.ts`),
//! the exact scanline bytes of small images without and with Adam7 and the files a lenient reader
//! would let in; and the QR adapter (TS's command-line "QR adapter" row), a backup's QR image
//! written and read back, in the full self-test. The budgets follow the W3C PNG specification and were computed
//! independently in Python; the images are synthetic, uncompressed data, which admission does not
//! inflate. Public data only.

use super::{Row, ok};
use crate::backup::Backup;
use crate::bip39::phrase::Phrase;
use crate::dates::parse_date;
use crate::forms::Form;
use crate::modes::Mode;
use crate::qr::admission::admit;
use crate::qr::admission::synthetic::{chunk, header, image};
use crate::qr::{png, read_png};
use crate::self_check::vectors::{MASKED_DATE, PUBLIC_MNEMONIC};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};

/// Image sizes and their budgets: width, height, depth, color, interlace and filtered bytes.
const BUDGETS: [(u32, u32, u8, u8, u8, usize, &str); 4] = [
    (1, 1, 8, 6, 0, 5, "PNG budget 1x1"),
    (3, 5, 8, 0, 1, 25, "PNG budget 3x5 Adam7"),
    (9, 2, 1, 0, 0, 6, "PNG budget 9x2"),
    (9, 9, 8, 0, 1, 100, "PNG budget 9x9 Adam7"),
];
const INVALID: &str = "core.png-admission.invalid-png-input";

/// The PNG admission row.
pub(super) const PNG_ADMISSION: Row = Row::new(
    "PNG admission",
    "scanline budgets with and without Adam7, a second IHDR, data after IEND, 16-bit samples",
    png_admission,
);

/// The QR adapter row.
pub(super) const QR_ADAPTER: Row = Row::new("QR adapter", "PNG write and read back", qr_adapter);

fn png_admission(_tier: Tier) -> Result<(), CheckFailure> {
    let data = chunk(b"IDAT", &[0]);
    for (width, height, depth, color, interlace, filtered, name) in BUDGETS {
        let file = image(&[&header(width, height, depth, color, interlace), &data]);
        expect_same(&ok(admit(&file))?.filtered_bytes(), &filtered, name)?;
    }
    let first = header(1, 1, 8, 0, 0);
    expect_refused(
        admit(&image(&[&first, &header(4097, 1, 8, 0, 0), &data])),
        INVALID,
        "PNG second IHDR",
    )?;
    // A whole ancillary chunk after IEND: only the rule that IEND comes last refuses it.
    let after_end = [image(&[&first, &data]), chunk(b"tEXt", &[65])].concat();
    expect_refused(admit(&after_end), INVALID, "PNG data after IEND")?;
    expect_refused(
        admit(&image(&[&header(1, 1, 8, 3, 0), &data])),
        INVALID,
        "PNG palette image without a palette",
    )?;
    expect_refused(
        admit(&image(&[&header(1, 1, 16, 0, 0), &data])),
        "core.png-admission.wide-samples",
        "PNG 16-bit samples",
    )
}

/// A QR image drawn and read back takes longer than a start may: the full self-test runs it.
fn qr_adapter(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let phrase = ok(Phrase::parse(PUBLIC_MNEMONIC))?;
    let date = ok(parse_date(MASKED_DATE))?;
    let encoding = ok(Backup::encode(
        &phrase,
        &[date],
        Form::Unicode,
        Mode::Seedshift,
        false,
    ))?;
    let payload = ok(encoding.backup.text())?;
    let written = ok(png(&payload))?;
    expect_same(
        ok(read_png(&written))?.as_str(),
        payload.as_str(),
        "QR write and read back",
    )
}

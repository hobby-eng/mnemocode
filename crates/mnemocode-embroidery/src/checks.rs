//! The self-test row of SeedStitch: at every start, the legend of docs/SEEDSTITCH.md read as its
//! published phrase; in the full self-test also one misread row corrected and two misread rows
//! refused, each of which tries every change of one row (CORE-29), and a drawn picture made into a
//! pattern whose legend reads back as the phrase hidden in it, and its PDF written. Public data
//! only; the legend is drawn from a counting source, not at random.

use mnemocode::checks::Row;
use mnemocode::random::{Random, RandomError};
use mnemocode::self_check::{Check, CheckFailure, Tier, expect_same, ok};

use crate::chart::{chart, legend_of_pdf};
use crate::fabric::DEFAULT_FABRIC;
use crate::hide::hide;
use crate::legend::{self, EXAMPLE, EXAMPLE_ORDERED, Holds, Reading};
use crate::phrase::LegendEntropy;
use crate::picture;
use crate::sample::gradient_png;

/// The row in the report.
pub const ROW: Row = Row::new(
    "SeedStitch legend",
    "the specification's legends of both formats; one row corrected, two refused; a picture's legend read back from its PDF",
    seedstitch,
);

/// The entropy that [`EXAMPLE`] holds: Trezor's published 24-word BIP39 test vector "void come
/// effort ... unfold".
const EXAMPLE_ENTROPY: [u8; 32] = [
    0xf5, 0x85, 0xc1, 0x1a, 0xec, 0x52, 0x0d, 0xb5, 0x7d, 0xd3, 0x53, 0xc6, 0x95, 0x54, 0xb2, 0x1a,
    0x89, 0xb2, 0x0f, 0xb0, 0x65, 0x09, 0x66, 0xfa, 0x0a, 0x9d, 0x6f, 0x74, 0xfd, 0x98, 0x9d, 0x8f,
];

/// The entropy that [`EXAMPLE_ORDERED`] holds, masked: the words 2001 2 2 … 2001 2 322, as the
/// manual recovery guide's own helper reads the line.
const EXAMPLE_ORDERED_ENTROPY: [u8; 32] = [
    0xfa, 0x00, 0x04, 0x00, 0xfd, 0x00, 0x02, 0x00, 0x7e, 0x80, 0x01, 0x00, 0x3f, 0x40, 0x00, 0x80,
    0x1f, 0xa0, 0x00, 0x40, 0x0f, 0xd0, 0x00, 0x20, 0x07, 0xe8, 0x00, 0x10, 0x03, 0xf4, 0x00, 0x09,
];

/// The check of 16 zero bytes in each format and kind: format 1 and 2, a whole backup and a share,
/// computed with Python's hashlib.
const DOMAIN_CHECKS: [(Holds, bool, [u8; 4]); 4] = [
    (Holds::Entropy, false, [0x22, 0xbe, 0xc2, 0x2d]),
    (Holds::Entropy, true, [0xb9, 0xc6, 0xe3, 0xb7]),
    (Holds::Share, false, [0x48, 0x37, 0x6b, 0x33]),
    (Holds::Share, true, [0xb7, 0xbc, 0x17, 0x1a]),
];

/// The startup case of the row, before any secret is asked.
///
/// # Errors
///
/// The [`CheckFailure`] of the first case that differs.
pub fn startup() -> Result<(), CheckFailure> {
    ROW.run(Tier::Startup)
}

fn seedstitch(tier: Tier) -> Result<(), CheckFailure> {
    let rows = ok(legend::parse(EXAMPLE))?;
    expect_same(
        &read_entropy(&rows),
        &Some((EXAMPLE_ENTROPY.to_vec(), Holds::Entropy)),
        "The specification's legend",
    )?;
    if tier != Tier::Full {
        return Ok(());
    }
    for (holds, ordered, expected) in DOMAIN_CHECKS {
        expect_same(
            &legend::check(&[0; 16], holds, ordered),
            &expected,
            "The check of each format and holds",
        )?;
    }
    expect_same(
        &read_entropy(&ok(legend::parse(EXAMPLE_ORDERED))?),
        &Some((EXAMPLE_ORDERED_ENTROPY.to_vec(), Holds::Entropy)),
        "The specification's legend that names its threads",
    )?;
    let mut one = rows.clone();
    one[0] = ok(legend::Row::new(1, one[0].symbol(), 1752))?;
    let corrected = matches!(legend::read(&one), Reading::Corrected { row: Some(1), .. });
    expect_same(
        &corrected,
        &true,
        "A legend with two digits of one row swapped",
    )?;
    let mut two = rows;
    two.swap(2, 3);
    let refused = matches!(legend::read(&two), Reading::NotRead);
    expect_same(&refused, &true, "A legend with two rows swapped")?;
    let grid = ok(picture::grid(&gradient_png(), 120))?;
    let entropy = LegendEntropy::known(&EXAMPLE_ENTROPY);
    let hidden = ok(hide(&grid, &entropy, &mut Counting(0)))?;
    let read = Some((EXAMPLE_ENTROPY.to_vec(), Holds::Entropy));
    expect_same(&read_entropy(hidden.rows()), &read, "A picture's legend")?;
    let pdf = ok(chart(&hidden, DEFAULT_FABRIC))?;
    let kept = legend_of_pdf(&pdf).and_then(|line| legend::parse(line.as_str()).ok());
    expect_same(
        &kept.and_then(|rows| read_entropy(&rows)),
        &read,
        "The legend kept in the pattern's PDF",
    )
}

/// The entropy `rows` read as, without a correction, and how it is masked.
fn read_entropy(rows: &[legend::Row]) -> Option<(Vec<u8>, Holds)> {
    match legend::read(rows) {
        Reading::Read { entropy, holds } => Some((entropy.to_vec(), holds)),
        _ => None,
    }
}

/// A source that counts: each byte the next number, so that a check draws nothing at random.
struct Counting(u8);

// A deliberate copy of the counting sources of mnemocode's own tests, which no other crate
// reaches: the library offers no source that is not random, so that no host takes one for keys.
impl Random for Counting {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        for byte in bytes {
            self.0 = self.0.wrapping_add(1);
            *byte = self.0;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use mnemocode::bip39::phrase::Phrase;
    use mnemocode::modes::Mode;

    /// Trezor's published 24-word test vector.
    const VOID: &str = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                        open amazing screen patrol group space point ten exist slush involve unfold";

    /// The legend line that hides `entropy` in the sample picture.
    fn line_of(entropy: &crate::phrase::LegendEntropy) -> mnemocode::secret::SecretText {
        let grid = crate::picture::grid(&crate::sample::gradient_png(), 120).unwrap();
        let hidden = crate::hide::hide(&grid, entropy, &mut Counting(0)).unwrap();
        crate::legend::line(hidden.rows()).unwrap()
    }

    // The Original Seedshift in a legend reads back as the codes Encode writes, whose last word
    // keeps the checksum.
    #[test]
    fn a_legend_of_the_original_seedshift_reads_back_as_its_codes() {
        let void = Phrase::parse(VOID).unwrap();
        let dates = [mnemocode::dates::parse_date("23-09-2026").unwrap()];
        let entropy = crate::phrase::legend_entropy(&void, Mode::SeedshiftLegacy, &dates).unwrap();
        let line = line_of(&entropy);
        let read = crate::phrase::record_of_legend(line.as_str())
            .unwrap()
            .unwrap();
        let masked = mnemocode::backup::Backup::encode(
            &void,
            &dates,
            mnemocode::forms::Form::Indexes,
            Mode::SeedshiftLegacy,
        )
        .unwrap();
        assert_eq!(
            read.record().as_str(),
            masked.backup.text().unwrap().as_str()
        );
    }

    // A share in each legend: one alone is refused by Decode's reading as a share, not a backup,
    // and any two of three give the phrase back.
    #[cfg(feature = "sskr")]
    #[test]
    fn any_two_of_three_share_legends_give_the_phrase_back() {
        use mnemocode::sskr::restore::ShareSet;
        let void = Phrase::parse(VOID).unwrap();
        let entropies =
            crate::phrase::share_entropies(&void, (Mode::Direct, &[]), (2, 3), &mut Counting(7))
                .unwrap();
        let lines: Vec<_> = entropies.iter().map(line_of).collect();
        assert!(matches!(
            crate::phrase::record_of_legend(lines[0].as_str()),
            Err(crate::phrase::SeedStitchError::Share)
        ));
        let shares: Vec<_> = lines
            .iter()
            .map(|line| {
                let read = crate::phrase::share_of_legend(line.as_str())
                    .unwrap()
                    .unwrap();
                assert!(!read.corrected);
                read.share.ur()
            })
            .collect();
        for pair in [[0, 1], [0, 2], [1, 2]] {
            let texts = pair.map(|at| shares[at].as_str());
            let phrase = ShareSet::combine_phrase(&texts).unwrap();
            assert_eq!(phrase.text().as_str(), VOID);
        }
        assert!(ShareSet::combine_phrase(&[shares[1].as_str()]).is_err());
        // A whole backup's legend holds no share.
        let whole = crate::phrase::legend_entropy(&void, Mode::Direct, &[]).unwrap();
        assert!(
            crate::phrase::share_of_legend(line_of(&whole).as_str())
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn the_row_passes_at_startup_and_in_full() {
        // In full: a picture of smooth shades, hidden, read back and written as a PDF.
        startup().unwrap();
        ROW.run(Tier::Full).unwrap();
    }
}

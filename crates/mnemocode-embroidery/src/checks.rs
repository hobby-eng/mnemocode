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
use crate::legend::{self, EXAMPLE, EXAMPLE_ORDERED, Masking, Reading};
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

/// The check of 16 zero bytes in each format and masking: format 1 and 2, masked and not, computed
/// with Python's hashlib.
const DOMAIN_CHECKS: [(Masking, bool, [u8; 4]); 4] = [
    (Masking::Seedshift, false, [0x22, 0xbe, 0xc2, 0x2d]),
    (Masking::Unmasked, false, [0x4b, 0x0a, 0x75, 0xea]),
    (Masking::Seedshift, true, [0xb9, 0xc6, 0xe3, 0xb7]),
    (Masking::Unmasked, true, [0xaa, 0xb9, 0x27, 0xfb]),
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
        &Some((EXAMPLE_ENTROPY.to_vec(), Masking::Seedshift)),
        "The specification's legend",
    )?;
    if tier != Tier::Full {
        return Ok(());
    }
    for (masking, ordered, expected) in DOMAIN_CHECKS {
        expect_same(
            &legend::check(&[0; 16], masking, ordered),
            &expected,
            "The check of each format and masking",
        )?;
    }
    expect_same(
        &read_entropy(&ok(legend::parse(EXAMPLE_ORDERED))?),
        &Some((EXAMPLE_ORDERED_ENTROPY.to_vec(), Masking::Seedshift)),
        "The specification's legend that names its threads",
    )?;
    let mut one = rows.clone();
    one[0] = ok(legend::Row::new(1, one[0].symbol(), 1752))?;
    let corrected = matches!(legend::read(&one), Reading::Corrected { row: 1, .. });
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
    let read = Some((EXAMPLE_ENTROPY.to_vec(), Masking::Seedshift));
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
fn read_entropy(rows: &[legend::Row]) -> Option<(Vec<u8>, Masking)> {
    match legend::read(rows) {
        Reading::Read { entropy, masking } => Some((entropy.to_vec(), masking)),
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

    #[test]
    fn the_row_passes_at_startup_and_in_full() {
        // In full: a picture of smooth shades, hidden, read back and written as a PDF.
        startup().unwrap();
        ROW.run(Tier::Full).unwrap();
    }
}

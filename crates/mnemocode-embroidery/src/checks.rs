//! The self-test row of SeedStitch: at every start, the legend of docs/SEEDSTITCH.md read as its
//! published phrase; in the full self-test also one misread row corrected and two misread rows
//! refused, each of which tries every change of one row (CORE-29), and a drawn picture made into a
//! pattern whose legend reads back as the phrase hidden in it, and its PDF written. Public data
//! only; the legend is drawn from a counting source, not at random.

use mnemocode::checks::Row;
use mnemocode::random::{Random, RandomError};
use mnemocode::self_check::{Check, CheckFailure, Tier, expect_same, ok};

use crate::chart::chart;
use crate::hide::hide;
use crate::legend::{self, EXAMPLE, Reading};
use crate::phrase::MaskedEntropy;
use crate::picture;
use crate::sample::gradient_png;

/// The row in the report.
pub const ROW: Row = Row::new(
    "SeedStitch legend",
    "the specification's legend; one row corrected, two refused; a picture's legend read back",
    seedstitch,
);

/// The entropy that [`EXAMPLE`] holds: Trezor's published 24-word BIP39 test vector "void come
/// effort ... unfold".
const EXAMPLE_ENTROPY: [u8; 32] = [
    0xf5, 0x85, 0xc1, 0x1a, 0xec, 0x52, 0x0d, 0xb5, 0x7d, 0xd3, 0x53, 0xc6, 0x95, 0x54, 0xb2, 0x1a,
    0x89, 0xb2, 0x0f, 0xb0, 0x65, 0x09, 0x66, 0xfa, 0x0a, 0x9d, 0x6f, 0x74, 0xfd, 0x98, 0x9d, 0x8f,
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
        &Some(EXAMPLE_ENTROPY.to_vec()),
        "The specification's legend",
    )?;
    if tier != Tier::Full {
        return Ok(());
    }
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
    let entropy = MaskedEntropy::known(&EXAMPLE_ENTROPY);
    let hidden = ok(hide(&grid, &entropy, &mut Counting(0)))?;
    expect_same(
        &read_entropy(hidden.rows()),
        &Some(EXAMPLE_ENTROPY.to_vec()),
        "A picture's legend",
    )?;
    let pdf = ok(chart(&hidden))?;
    expect_same(&pdf.starts_with(b"%PDF-"), &true, "The pattern's PDF")
}

/// The entropy `rows` read as, without a correction.
fn read_entropy(rows: &[legend::Row]) -> Option<Vec<u8>> {
    match legend::read(rows) {
        Reading::Read(entropy) => Some(entropy.to_vec()),
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

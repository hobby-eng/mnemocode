//! The repair of one share with unreadable elements (MnemoCode TS 0.1.0's `src/sskr/repair.ts`,
//! CAP-SSKR-REPAIR-ONE-SHARE): up to six elements, each marked with ? at its place. Every form keeps
//! a CRC-32, and the mixed forms a version and a length, all affine over GF(2) in the bits of the
//! share, so the missing bits are the solutions of linear equations, found by elimination instead of
//! by trying values. Each solution is read again as an ordinary share; more than one are variants,
//! never chosen silently; unmarked errors are never repaired. An element read in part adds the bits
//! read as equations of their own, or, for a Unicode code, the words whose code fits as candidates.

pub(crate) mod reading;
pub mod report;
pub(crate) mod units;

use std::fmt;

use self::reading::MarkedReading;
use super::forms::{ShareTextError, read_share};
use super::gf2::{Bits, combination};
use super::marks::{
    AmbiguousMarks, exceeds_marks, is_marked, mark_limit, mark_problem, no_share_fits,
};
use super::restore::SetShare;
use crate::refusal::Refusal;
use crate::text::space::trim;
use crate::text::words::capitalized;

/// More marked elements than this leave too few checksum bits to find them.
pub const MAX_MARKED_ELEMENTS: usize = 6;
/// Readings one share alone is tried in, one per choice of words for its partly read codes.
pub const MAX_CODE_CHOICES: usize = 256;
/// Up to 2^4 solutions of one share are listed as variants.
pub const LISTED_FREE_BITS: usize = 4;
/// The largest budget of a single share's listing: 2^8 solutions, which a restore with other
/// shares may try.
pub(crate) const MAX_LISTED_FREE_BITS: usize = 8;

/// The refusals of a share's repair, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RepairError {
    /// Unmarked text that is no share.
    Read(ShareTextError),
    /// Too many marks, or too long a text.
    EachAtPlace,
    /// A ? where a code takes only a lone one, or a code read in part too short: why.
    Refused(String),
    /// Color Unicode marks that fit too many ways.
    Ambiguous,
    /// Marks that leave too many solutions.
    TooManyMarks,
    /// No share fits the marks: why.
    NoShareFits(String),
    /// Several shares fit: how many, and the places of the marked elements.
    Variants(usize, Vec<usize>),
}

impl fmt::Display for RepairError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Read(error) => error.fmt(f),
            Self::EachAtPlace => write!(
                f,
                "{}, each at its place.",
                capitalized(&mark_limit(MAX_MARKED_ELEMENTS))
            ),
            Self::Refused(problem) | Self::NoShareFits(problem) => f.write_str(problem),
            Self::Ambiguous => AmbiguousMarks.fmt(f),
            Self::TooManyMarks => f.write_str(
                "Too many elements are marked for this form: the checksum cannot tell them. Mark fewer, or use another share.",
            ),
            Self::Variants(count, places) => write!(
                f,
                "{count} shares fit the marked elements {}. Use another copy of this share, or another share.",
                places
                    .iter()
                    .map(ToString::to_string)
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        }
    }
}

impl std::error::Error for RepairError {}

impl Refusal for RepairError {
    fn code(&self) -> &'static str {
        match self {
            Self::Read(error) => error.code(),
            Self::EachAtPlace => "sskr.repair.each-at-place",
            Self::Refused(_) => "sskr.repair.repair-candidates-refused",
            Self::Ambiguous => super::marks::AmbiguousMarks.code(),
            Self::TooManyMarks => "sskr.repair.too-many-marks-for-form",
            Self::NoShareFits(_) => "sskr.repair.no-share-fits-marks",
            Self::Variants(..) => "share-variants",
        }
    }
}

impl From<AmbiguousMarks> for RepairError {
    fn from(_: AmbiguousMarks) -> Self {
        Self::Ambiguous
    }
}

/// The candidate units to try value by value, each a place and its count of values, in the order
/// given, as many as keep the product of their counts within `limit`.
pub fn places_within(units: &[(usize, usize)], limit: usize) -> Vec<(usize, usize)> {
    let mut chosen = Vec::new();
    let mut product = 1;
    for &(place, count) in units {
        if count > limit / product {
            continue;
        }
        product *= count;
        chosen.push((place, count));
    }
    chosen
}

/// The unit values of every solution of `reading` on its own, and whether there are more than
/// 2^free_bits of them, which are then not listed.
fn solutions(reading: &MarkedReading, free_bits: usize) -> (Vec<Vec<u32>>, bool) {
    let Some(space) = reading.space() else {
        return (Vec::new(), false);
    };
    let basis = space.basis();
    if basis.len() > free_bits {
        return (Vec::new(), true);
    }
    let found = (0..1_u64 << basis.len())
        .map(|choice| {
            let change = combination(basis, &Bits::of(choice, basis.len()));
            space.values_at(&space.particular().xor(&change))
        })
        .collect();
    (found, false)
}

/// `reading` as one share alone is solved: as it is, or, when the checksum leaves more than
/// 2^free_bits solutions and it has candidate units, once for each choice of their values.
fn tried_readings(reading: &MarkedReading, free_bits: usize) -> Vec<MarkedReading> {
    let counts = reading.candidate_counts();
    if counts.is_empty() {
        return vec![reading.clone()];
    }
    match reading.space() {
        Some(space) if space.basis().len() > free_bits => {}
        _ => return vec![reading.clone()],
    }
    // The units with the fewest values first: each gains the most bits for its choices.
    let mut fewest_first = counts;
    fewest_first.sort_by_key(|&(_, count)| count);
    let places: Vec<usize> = places_within(&fewest_first, MAX_CODE_CHOICES)
        .iter()
        .map(|&(place, _)| place)
        .collect();
    reading.choices_at(&places)
}

/// What one reading of a marked share gave.
#[derive(Debug)]
pub struct ReadingOutcome {
    /// Whether the reading takes decoy cards after a prefix of the text.
    pub with_decoys: bool,
    /// Whether its solutions were too many to list.
    pub too_many: bool,
    /// The shares it solved.
    pub shares: Vec<SetShare>,
}

/// The shares the readings of the marked share `text` gave, each once. A capped reading of the
/// whole text refuses whatever the others solved; one that takes decoy cards leaves a solved
/// reading standing (AUD-022-FUN001), and without a share refuses the same way.
pub fn shares_of_readings(
    outcomes: Vec<ReadingOutcome>,
    text: &str,
) -> Result<Vec<SetShare>, RepairError> {
    let mut found: Vec<SetShare> = Vec::new();
    let mut too_many = false;
    let mut capped_decoys = false;
    for outcome in outcomes {
        if outcome.with_decoys {
            capped_decoys |= outcome.too_many;
        } else {
            too_many |= outcome.too_many;
        }
        for share in outcome.shares {
            match found
                .iter_mut()
                .find(|known| known.share.payload() == share.share.payload())
            {
                Some(known) => *known = share,
                None => found.push(share),
            }
        }
    }
    if too_many || found.is_empty() {
        return Err(if too_many || capped_decoys {
            RepairError::TooManyMarks
        } else {
            RepairError::NoShareFits(no_share_fits(text))
        });
    }
    Ok(found)
}

/// Every share `value` can be, in any form, with up to [`MAX_MARKED_ELEMENTS`] elements marked
/// with ?; at most 2^free_bits of them, `free_bits` at most [`MAX_LISTED_FREE_BITS`]. Each passes
/// the ordinary reader. Text without a ? is read as a share; marked text is refused with too many
/// marks or too long, with a ? where a code takes only a lone one or a code read in part too short,
/// with Color Unicode marks that fit too many ways, with marks that leave too many solutions, and
/// where no share fits.
pub(crate) fn repair_candidates(
    value: &str,
    free_bits: usize,
) -> Result<Vec<SetShare>, RepairError> {
    if !is_marked(value) {
        return Ok(vec![SetShare::from(
            read_share(value).map_err(RepairError::Read)?,
        )]);
    }
    let text = trim(value);
    if exceeds_marks(text, MAX_MARKED_ELEMENTS) {
        return Err(RepairError::EachAtPlace);
    }
    if let Some(problem) = mark_problem(text) {
        return Err(RepairError::Refused(capitalized(&problem)));
    }
    let budget = free_bits.min(MAX_LISTED_FREE_BITS);
    let mut outcomes = Vec::new();
    for reading in MarkedReading::of(text)? {
        for model in tried_readings(&reading, budget) {
            let (found, too_many) = solutions(&model, budget);
            outcomes.push(ReadingOutcome {
                with_decoys: model.with_decoys(),
                too_many,
                shares: found
                    .iter()
                    .filter_map(|values| model.solved_share(values))
                    .collect(),
            });
        }
    }
    shares_of_readings(outcomes, text)
}

/// The one share `value` can be, its marked elements filled in at the default budget; refused as
/// the list of its candidates refuses, and with the count and places of the marks where several
/// fit.
pub fn read_repairable_share(value: &str) -> Result<SetShare, RepairError> {
    let mut candidates = repair_candidates(value, LISTED_FREE_BITS)?;
    if candidates.len() > 1 {
        let places = candidates[0]
            .filled
            .iter()
            .map(|element| element.position)
            .collect();
        return Err(RepairError::Variants(candidates.len(), places));
    }
    Ok(candidates.remove(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sskr::forms::ShareFormat;
    use crate::sskr::testing::{join_units, mark_digits, mark_units, payload, share, share_units};

    #[test]
    fn one_element_of_any_form_is_filled_in() {
        for index in 0..5 {
            let ur = share(Some(index));
            for format in ShareFormat::ALL {
                let length = share_units(&ur, format).len();
                for place in [0, length / 2, length - 1] {
                    let read = read_repairable_share(&mark_units(&ur, format, &[place])).unwrap();
                    assert_eq!(read.share.payload(), payload(&ur), "{format:?} {place}");
                    assert_eq!(read.format, format);
                    assert!(read.repaired());
                }
            }
        }
        let official = share(None);
        for place in 0..share_units(&official, ShareFormat::Colors).len() {
            let read = read_repairable_share(&mark_units(&official, ShareFormat::Colors, &[place]))
                .unwrap();
            assert_eq!(read.share.payload(), payload(&official));
        }
    }

    #[test]
    fn up_to_three_elements_are_filled_in_and_named() {
        let ur = share(Some(0));
        for format in [
            ShareFormat::Ur,
            ShareFormat::Words,
            ShareFormat::Indexes,
            ShareFormat::Unicode,
        ] {
            let units = share_units(&ur, format);
            let length = units.len();
            for places in [vec![1, length / 2], vec![1, 9, length - 2]] {
                let read = read_repairable_share(&mark_units(&ur, format, &places)).unwrap();
                assert_eq!(read.share.payload(), payload(&ur), "{format:?}");
                let filled: Vec<(usize, String)> = read
                    .filled
                    .iter()
                    .map(|element| (element.position, element.value.as_str().to_owned()))
                    .collect();
                let expected: Vec<(usize, String)> = places
                    .iter()
                    .map(|&place| (place + 1, units[place].clone()))
                    .collect();
                assert_eq!(filled, expected, "{format:?}");
            }
        }
    }

    #[test]
    fn digits_read_settle_colors_and_codes() {
        let ur = share(Some(0));
        let typed = mark_digits(
            &ur,
            ShareFormat::Colors,
            &[(4, &[4, 5]), (5, &[0, 3]), (6, &[1, 2])],
        );
        assert_eq!(
            read_repairable_share(&typed).unwrap().share.payload(),
            payload(&ur)
        );
        assert!(matches!(
            read_repairable_share(&mark_units(&ur, ShareFormat::Colors, &[4, 5, 6])),
            Err(RepairError::TooManyMarks | RepairError::Variants(..))
        ));
        let codes = mark_digits(
            &ur,
            ShareFormat::Unicode,
            &[(4, &[3]), (7, &[2]), (9, &[1]), (12, &[3]), (15, &[2])],
        );
        assert_eq!(
            read_repairable_share(&codes).unwrap().share.payload(),
            payload(&ur)
        );
        assert_eq!(
            read_repairable_share(&mark_units(&ur, ShareFormat::Unicode, &[4, 7, 9, 12, 15]))
                .unwrap_err()
                .code(),
            "sskr.repair.too-many-marks-for-form"
        );
    }

    #[test]
    fn marks_are_refused_by_their_condition() {
        let ur = share(Some(0));
        let mut colors = share_units(&ur, ShareFormat::Colors);
        let digit = if colors[5].as_bytes()[1] == b'0' {
            '1'
        } else {
            '0'
        };
        colors[5] = format!("#{digit}{}?", &colors[5][2..6]);
        let wrong = read_repairable_share(&join_units(&colors, ShareFormat::Colors)).unwrap_err();
        assert!(wrong.to_string().starts_with("No valid share"), "{wrong}");
        let mut short = share_units(&ur, ShareFormat::Colors);
        short[9] = format!("{}?", &short[9][..5]);
        assert_eq!(
            read_repairable_share(&join_units(&short, ShareFormat::Colors))
                .unwrap_err()
                .to_string(),
            "Color 10 has 5 of 6 symbols: write a ? for each digit that cannot be read, or a lone ? for the whole color."
        );
        let indexes = share_units(&ur, ShareFormat::Indexes);
        assert_eq!(
            read_repairable_share(&mark_units(
                &ur,
                ShareFormat::Indexes,
                &[0, 1, 2, 3, 4, 5, 6]
            ))
            .unwrap_err(),
            RepairError::EachAtPlace
        );
        assert_eq!(
            RepairError::EachAtPlace.to_string(),
            "Mark at most 6 unreadable elements with ?, each at its place."
        );
        let mut half = indexes;
        half[1] = "1?".to_owned();
        let refused = read_repairable_share(&join_units(&half, ShareFormat::Indexes)).unwrap_err();
        assert_eq!(refused.code(), "sskr.repair.repair-candidates-refused");
        assert!(refused.to_string().starts_with("Word number 2 has a ?"));
    }
}

//! The shares of a set written again (MnemoCode TS 0.1.0's `ShareExport` of `src/sskr/share-set.ts`,
//! CAP-SSKR-EXPORT-SET): each by its place among those typed, in its own form or in one form given.
//! A share with an element nothing settles is left out: written down, it would be a guess passed off
//! as the share. Copies of one share are shown as typed and saved once.

use std::fmt;

use super::forms::ShareFormat;
use super::restore::{MarkedElement, SetShare};
use super::share::Share;
use crate::refusal::Refusal;

/// Places fewer than the shares, or a place of 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlacesRefused;

impl fmt::Display for PlacesRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Each share needs its place among those typed, a whole number from 1.")
    }
}

impl std::error::Error for PlacesRefused {}

impl Refusal for PlacesRefused {
    fn code(&self) -> &'static str {
        "sskr.share-set.each-share-place-among-typed-whole-number-from"
    }
}

/// A share as it is shown or written again: the share, its form, and its place from 1.
#[derive(Debug)]
pub struct WrittenShare {
    /// The share.
    pub share: Share,
    /// The form it is written in.
    pub format: ShareFormat,
    /// Its place among those typed, or in a split's order.
    pub number: usize,
}

/// The shares of a set to write again.
#[derive(Debug)]
pub struct ShareExport {
    shown: Vec<WrittenShare>,
    left_out: Vec<usize>,
    total: usize,
}

impl ShareExport {
    /// The shares `shares`, repaired or not, with the elements a repair left `unsettled`, named by
    /// `places`; each in `format`, or in the form it was written in. Refuses fewer places than
    /// shares, and a place of 0.
    pub fn of(
        shares: &[SetShare],
        unsettled: &[MarkedElement],
        places: &[usize],
        format: Option<ShareFormat>,
    ) -> Result<Self, PlacesRefused> {
        if places.len() < shares.len() || places.contains(&0) {
            return Err(PlacesRefused);
        }
        let mut left_out: Vec<usize> = Vec::new();
        for element in unsettled {
            let place = places
                .get(element.share.wrapping_sub(1))
                .copied()
                .unwrap_or(element.share);
            if !left_out.contains(&place) {
                left_out.push(place);
            }
        }
        let shown = shares
            .iter()
            .zip(places)
            .filter(|(_, place)| !left_out.contains(place))
            .map(|(share, &number)| WrittenShare {
                share: share.share.copy(),
                format: format.unwrap_or(share.format),
                number,
            })
            .collect();
        Ok(Self {
            shown,
            left_out,
            total: places.iter().copied().max().unwrap_or(0),
        })
    }

    /// The places of the shares left out, with an element nothing settles.
    pub fn left_out(&self) -> &[usize] {
        &self.left_out
    }

    /// Why each share left out is left out, one line each.
    pub fn left_out_messages(&self) -> Vec<String> {
        self.left_out
            .iter()
            .map(|place| {
                format!(
                    "Share {place} cannot be settled and is left out: read more of it, or use another copy."
                )
            })
            .collect()
    }

    /// The shares to show, in the order typed, copies included.
    pub fn shown(&self) -> &[WrittenShare] {
        &self.shown
    }

    /// The shares to save: each once, the first of its copies.
    pub fn saved(&self) -> Vec<&WrittenShare> {
        let mut saved: Vec<&WrittenShare> = Vec::new();
        for share in &self.shown {
            if !saved
                .iter()
                .any(|kept| kept.share.payload() == share.share.payload())
            {
                saved.push(share);
            }
        }
        saved
    }

    /// The forms of the shares saved, each once, in their order.
    pub fn forms(&self) -> Vec<ShareFormat> {
        let mut forms = Vec::new();
        for share in self.saved() {
            if !forms.contains(&share.format) {
                forms.push(share.format);
            }
        }
        forms
    }

    /// The highest place of the shares typed: the shares are shown as "N of" it.
    pub const fn total(&self) -> usize {
        self.total
    }

    /// The note for copies saved once; none when no share was typed twice.
    pub fn copies_note(&self) -> Option<&'static str> {
        (self.saved().len() < self.shown.len()).then_some("Copies of one share are saved once.")
    }

    /// The same shares, every one in `format`, as cards show them.
    pub fn in_form(&self, format: ShareFormat) -> Self {
        Self {
            shown: self
                .shown
                .iter()
                .map(|written| WrittenShare {
                    share: written.share.copy(),
                    format,
                    number: written.number,
                })
                .collect(),
            left_out: self.left_out.clone(),
            total: self.total,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sskr::forms::read_share;
    use crate::sskr::testing::vector;

    #[test]
    fn unsettled_shares_are_left_out_and_copies_saved_once() {
        let (urs, _) = vector(0);
        let shares: Vec<SetShare> = [&urs[0], &urs[1], &urs[0]]
            .iter()
            .map(|ur| SetShare::from(read_share(ur).unwrap()))
            .collect();
        let export = ShareExport::of(&shares, &[], &[2, 4, 5], None).unwrap();
        assert_eq!(export.shown().len(), 3);
        assert_eq!(export.saved().len(), 2);
        assert_eq!(
            export.copies_note(),
            Some("Copies of one share are saved once.")
        );
        assert_eq!(export.total(), 5);
        let unsettled = [MarkedElement {
            share: 2,
            position: 3,
        }];
        let partial =
            ShareExport::of(&shares, &unsettled, &[2, 4, 5], Some(ShareFormat::Colors)).unwrap();
        assert_eq!(partial.left_out(), &[4]);
        assert_eq!(partial.forms(), vec![ShareFormat::Colors]);
        assert_eq!(
            partial.left_out_messages(),
            vec![
                "Share 4 cannot be settled and is left out: read more of it, or use another copy."
            ]
        );
        assert_eq!(
            ShareExport::of(&shares, &[], &[1, 2], None).unwrap_err(),
            PlacesRefused
        );
    }
}

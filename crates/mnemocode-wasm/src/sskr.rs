//! The shares part for a page (`browser-sskr`): a backup split into Shamir shares in one form, with
//! the note they are kept with; shares typed in any form, some with elements marked with ?,
//! restored together and every share checked; a share's form, the share written in another form,
//! and a share QR code checked against the cards beside it; and the part's self-check. The phrase,
//! the dates and the shares cross as `JsValue`s that Rust reads (ARCHITECTURE.md §6); the shares a
//! page gets back are JS strings it drops soon after. A repair that needs a long search is the
//! recovery part's, which steps it.

use mnemocode::checks::Part;
use mnemocode::modes::Mode;
use mnemocode::sskr::forms::{ShareFormat, check_share_qr, read_share};
use mnemocode::sskr::keeping::{Packaging, share_keeping_note};
use mnemocode::sskr::repair::report::{RepairReport, ReportLine};
use mnemocode::sskr::restore::ShareSet;
use mnemocode::sskr::share::Share;
use mnemocode::sskr::split::split_backup;
use wasm_bindgen::prelude::*;

use crate::host::{
    BrowserRandom, after_secret, name, optional_text, phrase_and_dates, place, refused, self_check,
    text,
};

/// The shares of one split, each written in one form, in member order.
#[wasm_bindgen]
pub struct SplitShares {
    shares: Vec<Share>,
    format: ShareFormat,
    masked: bool,
}

impl SplitShares {
    /// [`SplitShares::split`] of the text read.
    fn split_text(
        phrase: &str,
        dates: &str,
        mode: &str,
        threshold: f64,
        count: f64,
        format: &str,
    ) -> Result<Self, JsValue> {
        let mode = Mode::named(mode).map_err(|refusal| refused(&refusal))?;
        let format = ShareFormat::named(format).map_err(|refusal| refused(&refusal))?;
        let (phrase, dates) = phrase_and_dates(phrase, dates)?;
        let split = split_backup(
            &phrase,
            mode,
            &dates,
            place(threshold),
            place(count),
            &mut BrowserRandom,
        )
        .map_err(|refusal| refused(&refusal))?;
        Ok(Self {
            shares: split.shares,
            format,
            masked: mode.masked(),
        })
    }

    /// The note the shares are kept with, saved as `packaging`.
    fn keeping_note_of(&self, packaging: Packaging) -> Result<String, JsValue> {
        share_keeping_note(&self.shares, packaging, self.masked)
            .map_err(|refusal| refused(&refusal))
    }
}

#[wasm_bindgen]
impl SplitShares {
    /// `phrase` masked in `mode` with `dates` (a typed line of them; undefined: none) and split
    /// into `count` shares, `threshold` of them needed, written in `format` (a share form's name);
    /// every new split is restored, each share checked, before it is given out.
    pub fn split(
        phrase: JsValue,
        dates: JsValue,
        mode: JsValue,
        threshold: f64,
        count: f64,
        format: JsValue,
    ) -> Result<SplitShares, JsValue> {
        after_secret(|| {
            Self::split_text(
                &text(&phrase)?,
                &optional_text(&dates)?,
                &name(&mode),
                threshold,
                count,
                &name(&format),
            )
        })
    }

    /// The shares, each written in the form chosen, in member order.
    pub fn shares(&self) -> Vec<String> {
        after_secret(|| {
            self.shares
                .iter()
                .map(|share| self.format.write(share).as_str().to_owned())
                .collect()
        })
    }

    /// The note the shares are kept with, saved as `packaging` ("file", "folder", "files",
    /// "folders" or "pages").
    #[wasm_bindgen(js_name = keepingNote)]
    pub fn keeping_note(&self, packaging: JsValue) -> Result<String, JsValue> {
        let packaging = Packaging::named(&name(&packaging)).map_err(|refusal| refused(&refusal))?;
        self.keeping_note_of(packaging)
    }
}

/// The phrase that shares restore, with what checked it and what a repair filled in.
#[wasm_bindgen]
pub struct RestoredShares(ShareSet);

/// The texts of `shares`, each a page's string.
fn texts(shares: &[JsValue]) -> Result<Vec<String>, JsValue> {
    shares.iter().map(text).collect()
}

#[wasm_bindgen]
impl RestoredShares {
    /// Restores the one phrase `shares` hold, each in any form, with elements marked with ? where
    /// unreadable; every share is checked against it. A repair that needs a long search, or that
    /// more than one phrase passes, is refused here; the assessment of marked shares runs at once,
    /// until the recovery binding steps it as a host steps a search.
    pub fn restore(shares: Vec<JsValue>) -> Result<RestoredShares, JsValue> {
        after_secret(|| {
            ShareSet::combine(&texts(&shares)?, None)
                .map(RestoredShares)
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The phrase the shares hold: for a Seedshift backup, the masked phrase.
    pub fn phrase(&self) -> String {
        after_secret(|| self.0.phrase().text().as_str().to_owned())
    }

    /// The shares, as read or repaired, each written in its own form, in the order given.
    pub fn shares(&self) -> Vec<String> {
        after_secret(|| {
            self.0
                .shares()
                .iter()
                .map(|share| share.format.write(&share.share).as_str().to_owned())
                .collect()
        })
    }

    /// Whether every share took part, every element is settled, and a digest checked the phrase.
    #[wasm_bindgen(getter)]
    pub fn checked(&self) -> bool {
        self.0.checked()
    }

    /// The warning for shares that took no part, or for a phrase no digest checked.
    #[wasm_bindgen(js_name = uncheckedNote)]
    pub fn unchecked_note(&self) -> Option<String> {
        self.0.unchecked_note(None)
    }

    /// What a repair filled in, share by share, then the notes on guesses and on correcting the
    /// written copy.
    #[wasm_bindgen(js_name = repairLines)]
    pub fn repair_lines(&self) -> Vec<String> {
        after_secret(|| {
            RepairReport::repair_lines(&self.0, None)
                .into_iter()
                .filter_map(|line| match line {
                    ReportLine::Warning(text)
                    | ReportLine::Notice(text)
                    | ReportLine::Hint(text) => Some(text),
                    ReportLine::Status { .. } | ReportLine::More(_) => None,
                })
                .collect()
        })
    }

    /// Groups of the set that restore the phrase.
    #[wasm_bindgen(getter, js_name = groupThreshold)]
    pub fn group_threshold(&self) -> usize {
        self.0.group_threshold()
    }

    /// Words of the phrase.
    #[wasm_bindgen(getter, js_name = wordCount)]
    pub fn word_count(&self) -> usize {
        self.0.word_count()
    }
}

/// The form `share` is written in, by its name.
#[wasm_bindgen(js_name = shareForm)]
pub fn share_form(share: JsValue) -> Result<String, JsValue> {
    after_secret(|| {
        read_share(&text(&share)?)
            .map(|read| read.format.name().to_owned())
            .map_err(|refusal| refused(&refusal))
    })
}

/// `share`, in any form, written in `format`.
#[wasm_bindgen(js_name = writeShare)]
pub fn write_share(share: JsValue, format: JsValue) -> Result<String, JsValue> {
    after_secret(|| {
        let format = ShareFormat::named(&name(&format)).map_err(|refusal| refused(&refusal))?;
        read_share(&text(&share)?)
            .map(|read| format.write(&read.share).as_str().to_owned())
            .map_err(|refusal| refused(&refusal))
    })
}

/// Refuses a share QR code whose `payload` holds another share than the cards print: the share of
/// `colors` or, where the cards print them, of `labels` (undefined: the colors alone).
#[wasm_bindgen(js_name = checkShareQr)]
pub fn check_qr(colors: JsValue, payload: JsValue, labels: JsValue) -> Result<(), JsValue> {
    after_secret(|| {
        let labels = if labels.is_undefined() {
            None
        } else {
            Some(text(&labels)?)
        };
        check_share_qr(&text(&colors)?, &text(&payload)?, labels.as_deref())
            .map_err(|refusal| refused(&refusal))
    })
}

/// The shares part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckSskr)]
pub fn self_check_sskr(full: bool) -> Result<(), JsValue> {
    self_check(Part::Sskr, full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mnemocode::self_check::vectors::{MASKED_DATE, PUBLIC_MNEMONIC};

    #[test]
    fn a_split_is_written_restored_and_kept() {
        let split = SplitShares::split_text(
            PUBLIC_MNEMONIC,
            MASKED_DATE,
            "seedshift",
            2.0,
            3.0,
            "colors",
        )
        .unwrap();
        let shares = split.shares();
        assert_eq!(shares.len(), 3);
        assert!(shares[0].starts_with('#'));
        let restored = ShareSet::combine(&shares[1..], None).unwrap();
        assert_ne!(restored.phrase().text().as_str(), PUBLIC_MNEMONIC);
        assert!(
            split
                .keeping_note_of(Packaging::Files)
                .unwrap()
                .starts_with("Any 2 of the 3 shares are enough to restore the masked phrase")
        );
        assert!(self_check_sskr(false).is_ok());
    }
}

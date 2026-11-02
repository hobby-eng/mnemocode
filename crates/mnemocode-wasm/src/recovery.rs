//! The recovery part for a page (`browser-recovery`): how a backup as given is read and decoded, a
//! written backup checked, and in `search` the date, word and marked-code searches and the restore
//! and repair of shares, each stepped by the page (ADR 0005), with in `found` what they find. A
//! search's secrets cross as `JsValue`s that Rust reads, so the wallet cannot cross beside them as
//! a class (ARCHITECTURE.md §6): every search starts from a [`Recovery`], the receiver that holds
//! the wallet to compare with, if any. A count crosses as a number, NaN for the default.

mod found;
mod re_encoding;
mod search;

use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::bip32::fingerprint_hex;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::checks::Part;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::dates::{Date, Dates};
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::recovery::backup_check::{
    BackupResult, BackupVerdict, EncodedBackupCheck, EncodedOriginal, ShareBackupCheck,
    ShareOriginal, WrittenBackup,
};
use mnemocode::recovery::reading::{BackupReading, ReadingRules, ShareKind};
use mnemocode::refusal::Refusal;
use wasm_bindgen::prelude::*;

pub use self::found::SearchResult;
pub use self::re_encoding::ReEncoding;
pub use self::search::{
    MarkedCodes, MarkedWay, Recovery, RecoverySearch, SearchProgress, SearchQuestion,
};
use crate::host::{after_secret, name, optional_text, place, refused, self_check, text, whole};

/// The refusal of a library call.
pub(crate) fn fail(refusal: impl Refusal) -> JsValue {
    refused(&refusal)
}

/// A count a page passes: none for NaN.
pub(crate) fn count(value: f64) -> Option<u64> {
    (!value.is_nan()).then(|| whole(value))
}

/// The form `value` names, none where it is undefined; an unknown name is refused.
fn form_of(value: &JsValue) -> Result<Option<Form>, JsValue> {
    if value.is_undefined() {
        return Ok(None);
    }
    Form::named(&name(value)).map(Some).map_err(fail)
}

/// The mode `value` names, none where it is undefined; an unknown name is refused.
fn mode_of(value: &JsValue) -> Result<Option<Mode>, JsValue> {
    if value.is_undefined() {
        return Ok(None);
    }
    Mode::named(&name(value)).map(Some).map_err(fail)
}

/// The form or the mode that a call needs: named, as the library refuses an unknown name.
pub(crate) fn needed_form(value: &JsValue) -> Result<Form, JsValue> {
    Form::named(&name(value)).map_err(fail)
}

pub(crate) fn needed_mode(value: &JsValue) -> Result<Mode, JsValue> {
    Mode::named(&name(value)).map_err(fail)
}

/// The dates typed in `value` for a phrase of `words` words; none where it is undefined.
pub(crate) fn dates_of(
    value: &JsValue,
    words: Option<usize>,
    patterns: bool,
) -> Result<Option<Rc<DatesAnswer>>, JsValue> {
    if value.is_undefined() {
        return Ok(None);
    }
    DatesAnswer::parse(&text(value)?, words, patterns)
        .map(|answer| Some(Rc::new(answer)))
        .map_err(fail)
}

/// The names of `forms`.
fn names_of(forms: &[Form]) -> Vec<String> {
    forms.iter().map(|form| form.name().to_owned()).collect()
}

/// A backup as given, before its dates.
#[wasm_bindgen]
pub struct ReadBackup(BackupReading);

#[wasm_bindgen]
impl ReadBackup {
    /// Reads `backup`, codes or a record; `share_reader` names where the page reads Shamir shares,
    /// and `words` (NaN: all) says how many words the phrase has, of codes that end with decoys.
    pub fn read(
        backup: JsValue,
        seedshift_only: bool,
        share_reader: JsValue,
        words: f64,
    ) -> Result<ReadBackup, JsValue> {
        after_secret(|| {
            let rules = ReadingRules {
                seedshift_only,
                share_reader: &name(&share_reader),
                words: (!words.is_nan()).then(|| place(words)),
            };
            BackupReading::of(&text(&backup)?, rules)
                .map(ReadBackup)
                .map_err(fail)
        })
    }

    /// The mode the record or `given` names.
    pub fn mode(&self, given: JsValue) -> Result<Option<String>, JsValue> {
        Ok(self
            .0
            .mode(mode_of(&given)?)
            .map(|mode| mode.id().to_owned()))
    }

    /// What the record says against `given`.
    #[wasm_bindgen(js_name = modeConflict)]
    pub fn mode_conflict(&self, given: JsValue) -> Result<Option<String>, JsValue> {
        Ok(self.0.mode_conflict(mode_of(&given)?))
    }

    /// What the record says against `given`.
    #[wasm_bindgen(js_name = formConflict)]
    pub fn form_conflict(&self, given: JsValue) -> Result<Option<String>, JsValue> {
        Ok(self.0.form_conflict(form_of(&given)?))
    }

    /// The forms that fit the codes, by name.
    pub fn forms(&self, given: JsValue) -> Result<Vec<String>, JsValue> {
        after_secret(|| Ok(names_of(&self.0.forms(form_of(&given)?).map_err(fail)?)))
    }

    /// The forms that fit codes marked with ?.
    #[wasm_bindgen(js_name = markedForms)]
    pub fn marked_forms(&self, given: JsValue) -> Result<Vec<String>, JsValue> {
        after_secret(|| {
            Ok(names_of(
                &self.0.marked_forms(form_of(&given)?).map_err(fail)?,
            ))
        })
    }

    /// Whether some codes are marked with ?.
    #[wasm_bindgen(getter)]
    pub fn marked(&self) -> bool {
        after_secret(|| self.0.marked())
    }

    /// Whether the backup holds a record header.
    #[wasm_bindgen(getter, js_name = hasRecord)]
    pub fn has_record(&self) -> bool {
        self.0.has_record()
    }

    /// The codes in `form`, read as `mode` holds them, with their master fingerprint where they
    /// are a valid phrase, and decoded under `dates`.
    pub fn decode(
        &self,
        form: JsValue,
        mode: JsValue,
        dates: JsValue,
    ) -> Result<DecodedBackup, JsValue> {
        after_secret(|| {
            let (form, mode) = (needed_form(&form)?, needed_mode(&mode)?);
            let backup = self
                .0
                .codes(form)
                .and_then(|codes| codes.with_mode(mode))
                .map_err(fail)?;
            DecodedBackup::of(&backup, &optional_text(&dates)?)
        })
    }

    /// The codes marked with ? in `form`, as `mode` holds them: about how many candidates they
    /// leave.
    #[wasm_bindgen(js_name = markedCandidates)]
    pub fn marked_candidates(&self, form: JsValue, mode: JsValue) -> Result<f64, JsValue> {
        after_secret(|| {
            let codes = self
                .0
                .missing_codes(needed_form(&form)?)
                .map_err(fail)?
                .with_mode(needed_mode(&mode)?);
            Ok(codes.expected() as f64)
        })
    }
}

/// What the text `text` given for the codes is: "share", "either", or undefined for neither.
#[wasm_bindgen(js_name = shareKind)]
pub fn share_kind(backup: JsValue) -> Result<Option<String>, JsValue> {
    after_secret(|| {
        let kind = BackupReading::share_kind(&text(&backup)?).map_err(fail)?;
        Ok(kind.map(|kind| {
            match kind {
                ShareKind::Share => "share",
                ShareKind::Either => "either",
            }
            .to_owned()
        }))
    })
}

/// Whether `text`, given for the words of a phrase, is codes.
#[wasm_bindgen(js_name = isCodes)]
pub fn is_codes(backup: JsValue) -> Result<bool, JsValue> {
    after_secret(|| Ok(BackupReading::is_codes(&text(&backup)?)))
}

/// The phrases that decoded codes give.
#[wasm_bindgen]
pub struct DecodedBackup {
    phrases: Vec<(String, bool)>,
    encoded: Option<String>,
}

impl DecodedBackup {
    /// What `backup` gives under the dates typed in `typed`.
    fn of(backup: &Backup, typed: &str) -> Result<DecodedBackup, JsValue> {
        let dates = crate::host::dates_of(typed, backup.words())?;
        let phrases = decoded_phrases(backup, &dates)?;
        let encoded = backup.fingerprint().map_err(fail)?.map(fingerprint_hex);
        Ok(DecodedBackup { phrases, encoded })
    }
}

/// Every phrase that `backup` gives under `dates`, in words, and whether it keeps the checksum.
pub(crate) fn decoded_phrases(
    backup: &Backup,
    dates: &[Date],
) -> Result<Vec<(String, bool)>, JsValue> {
    let mut phrases = Vec::new();
    for result in backup.candidates(dates).map_err(fail)? {
        let words = Form::English
            .codes(result.recovered.as_slice())
            .map_err(fail)?;
        phrases.push((words, result.checksum_valid));
    }
    Ok(phrases)
}

#[wasm_bindgen]
impl DecodedBackup {
    /// How many phrases: more than one only for a record with a replaced last word.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.phrases.len()
    }

    /// The phrase at `at`.
    pub fn phrase(&self, at: f64) -> Option<String> {
        after_secret(|| self.phrases.get(place(at)).map(|(words, _)| words.clone()))
    }

    /// Whether the phrase at `at` keeps the BIP39 checksum.
    #[wasm_bindgen(js_name = checksumValid)]
    pub fn checksum_valid(&self, at: f64) -> bool {
        self.phrases.get(place(at)).is_some_and(|(_, valid)| *valid)
    }

    /// The master fingerprint of the codes read as a phrase, where they are one.
    #[wasm_bindgen(getter, js_name = encodedFingerprint)]
    pub fn encoded_fingerprint(&self) -> Option<String> {
        self.encoded.clone()
    }
}

/// What a written backup was found to be.
#[wasm_bindgen]
pub struct BackupFinding(BackupResult);

#[wasm_bindgen]
impl BackupFinding {
    /// "restores", "differs", "unreadable" or "unchecked".
    #[wasm_bindgen(getter)]
    pub fn verdict(&self) -> String {
        match self.0.verdict {
            BackupVerdict::Restores => "restores",
            BackupVerdict::Differs => "differs",
            BackupVerdict::Unreadable => "unreadable",
            BackupVerdict::Unchecked => "unchecked",
        }
        .to_owned()
    }

    /// The verdict's line.
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.0.message.clone()
    }

    /// The places of the finding, from 1.
    #[wasm_bindgen(getter)]
    pub fn places(&self) -> Vec<usize> {
        self.0
            .finding
            .as_ref()
            .map_or_else(Vec::new, |finding| finding.places.clone())
    }

    /// What was left out on the way, one line each.
    #[wasm_bindgen(getter)]
    pub fn notes(&self) -> Vec<String> {
        self.0.notes.clone()
    }
}

/// The dates of `value`, read for a phrase of `words` words.
pub(crate) fn checked_dates(value: &JsValue, words: usize) -> Result<Dates, JsValue> {
    let typed = optional_text(value)?;
    Ok(Dates::new(&crate::host::dates_of(&typed, words)?))
}

/// The phrase of `value`.
fn phrase_of(value: &JsValue) -> Result<Phrase, JsValue> {
    Phrase::parse(&text(value)?).map_err(fail)
}

/// What `check` finds of the backup written down as `backup` and `dates`.
fn written_finding<E: Refusal>(
    backup: &JsValue,
    dates: &JsValue,
    check: impl FnOnce(WrittenBackup<'_>) -> Result<BackupResult, E>,
) -> Result<BackupFinding, JsValue> {
    let written = optional_text(dates)?;
    check(WrittenBackup {
        backup: &text(backup)?,
        dates: Some(&written),
    })
    .map(BackupFinding)
    .map_err(fail)
}

/// The check of the backup written down as `backup` and `written_dates` against the result of
/// `phrase` in `form` and `mode` under `dates`.
#[wasm_bindgen(js_name = checkBackup)]
pub fn check_backup(
    phrase: JsValue,
    form: JsValue,
    mode: JsValue,
    dates: JsValue,
    backup: JsValue,
    written_dates: JsValue,
) -> Result<BackupFinding, JsValue> {
    after_secret(|| {
        let phrase = phrase_of(&phrase)?;
        let (form, mode) = (needed_form(&form)?, needed_mode(&mode)?);
        let dates = checked_dates(&dates, phrase.len())?;
        let all: Vec<_> = dates.iter().collect();
        let codes = mode.encode(&phrase, &all).map_err(fail)?.shifted;
        let check = EncodedBackupCheck::new(EncodedOriginal {
            phrase,
            form,
            mode,
            codes,
            dates,
        })
        .map_err(fail)?;
        written_finding(&backup, &written_dates, |written| check.check(written))
    })
}

/// The check of the shares written down as `backup` against the split of `phrase` in `mode`, with
/// `threshold` shares needed; `decode_entry` names where the page reads an encoded phrase.
#[wasm_bindgen(js_name = checkShareBackup)]
pub fn check_share_backup(
    phrase: JsValue,
    mode: JsValue,
    threshold: f64,
    dates: JsValue,
    decode_entry: JsValue,
    backup: JsValue,
    written_dates: JsValue,
) -> Result<BackupFinding, JsValue> {
    after_secret(|| {
        let phrase = phrase_of(&phrase)?;
        let dates = if dates.is_undefined() {
            None
        } else {
            Some(checked_dates(&dates, phrase.len())?)
        };
        let check = ShareBackupCheck::new(
            ShareOriginal {
                phrase,
                mode: needed_mode(&mode)?,
                // What is no whole number is refused as a threshold of none.
                threshold: Some(place(threshold))
                    .filter(|threshold| *threshold != usize::MAX)
                    .unwrap_or(0),
                dates,
            },
            &name(&decode_entry),
        )
        .map_err(fail)?;
        written_finding(&backup, &written_dates, |written| check.check(written))
    })
}

/// The recovery part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckRecovery)]
pub fn self_check_recovery(full: bool) -> Result<(), JsValue> {
    self_check(Part::Recovery, full)
}

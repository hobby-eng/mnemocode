//! What a search found, for a page: one flat class, with a row for each phrase or candidate, which
//! gives each secret out as one string on request.

use mnemocode::bip39::phrase::Phrase;
use mnemocode::candidates::format::{CandidateList, candidate_list_holds};
use mnemocode::candidates::writer::entropies_of;
use mnemocode::recovery::date_search::DateSearchOutcome;
use mnemocode::recovery::marked_search::{
    MissingCodesFound, MissingCodesResult, found_among_others, texts,
};
use mnemocode::recovery::shares::flow::{ShareRestoreOutcome, match_warnings};
use mnemocode::recovery::shares::repair::{RepairedShare, ShareRepairOutcome, ShareVariant};
use mnemocode::recovery::word_search::WordSearchOutcome;
use mnemocode::secret::SecretBytes;
use mnemocode::sskr::repair::report::{ReportLine, ShareRepairs};
use wasm_bindgen::prelude::*;

use super::{decoded_phrases, fail};
use crate::host::{after_secret, optional_text, place};

/// One thing a search found; what a kind of search does not tell stays empty.
#[derive(Default)]
struct FoundRow {
    phrase: String,
    codes: String,
    dates: String,
    fingerprint: String,
    matched_at: Option<String>,
    number: u64,
    share: String,
    record: String,
    format: &'static str,
    set: usize,
    repairs: Vec<String>,
}

/// The candidates a list holds: their entropies, one after another, and the length of each.
struct KeptList {
    entropies: SecretBytes,
    length: usize,
}

/// What a search found, one row for each phrase or candidate.
#[wasm_bindgen]
#[derive(Default)]
pub struct SearchResult {
    kind: &'static str,
    message: Option<String>,
    lines: Vec<String>,
    notes: Vec<String>,
    warning: Option<String>,
    rows: Vec<FoundRow>,
    count: u64,
    matched: u64,
    stopped: bool,
    others: Option<u64>,
    list: Option<KeptList>,
    list_full: bool,
}

/// The lines of a report that a page shows as text.
fn line_texts(lines: Vec<ReportLine>) -> Vec<String> {
    lines
        .into_iter()
        .filter_map(|line| match line {
            ReportLine::Status { label, value, .. } => Some(format!("{label} {value}")),
            ReportLine::Warning(text) | ReportLine::Notice(text) | ReportLine::Hint(text) => {
                Some(text)
            }
            ReportLine::More(_) => None,
        })
        .collect()
}

/// The list of `phrases`, none without a phrase, and whether it holds fewer than the `found`.
fn list_of(phrases: &[Phrase], found: u64) -> Result<(Option<KeptList>, bool), JsValue> {
    if phrases.is_empty() {
        return Ok((None, false));
    }
    let full = phrases.len() as u64 != found || !candidate_list_holds(found);
    if full {
        return Ok((None, true));
    }
    let (entropies, length) = entropies_of(phrases).map_err(fail)?;
    Ok((Some(KeptList { entropies, length }), false))
}

/// The rows of `shares` of the set at `set`, each with what a repair filled in of it.
fn share_rows(
    shares: &[RepairedShare],
    repairs: &[ShareRepairs],
    set: usize,
    fingerprint: &str,
) -> Vec<FoundRow> {
    shares
        .iter()
        .map(|share| FoundRow {
            share: share.text.as_str().to_owned(),
            record: share.record.as_str().to_owned(),
            format: share.format.name(),
            fingerprint: fingerprint.to_owned(),
            number: share.number as u64,
            set,
            repairs: repairs
                .iter()
                .filter(|repaired| repaired.share == share.number)
                .map(ShareRepairs::line)
                .collect(),
            ..FoundRow::default()
        })
        .collect()
}

/// The rows of every set of `variants`, one after another.
fn variant_rows(variants: &[ShareVariant]) -> Vec<FoundRow> {
    variants
        .iter()
        .enumerate()
        .flat_map(|(set, variant)| {
            let fingerprint = variant.fingerprint.as_deref().unwrap_or_default();
            share_rows(&variant.shares, &variant.repairs, set, fingerprint)
        })
        .collect()
}

/// A row for each phrase the codes `found` give; one without a phrase where the way needed no dates.
fn found_rows(found: &MissingCodesFound) -> Result<Vec<FoundRow>, JsValue> {
    let codes = found.backup.text().map_err(fail)?;
    let Some(dates) = &found.dates else {
        return Ok(vec![FoundRow {
            codes,
            ..FoundRow::default()
        }]);
    };
    let complete: Vec<_> = dates.iter().collect();
    let shown = found.found_dates.as_ref().map_or_else(
        || {
            complete
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(" ")
        },
        |dates| dates.as_str().to_owned(),
    );
    Ok(decoded_phrases(&found.backup, &complete)?
        .into_iter()
        .map(|(phrase, _)| FoundRow {
            phrase,
            codes: codes.clone(),
            dates: shown.clone(),
            ..FoundRow::default()
        })
        .collect())
}

impl SearchResult {
    pub(super) fn of_dates(outcome: DateSearchOutcome) -> Result<Self, JsValue> {
        let (list, list_full) = list_of(&outcome.kept, outcome.match_count)?;
        let rows = outcome
            .shown
            .iter()
            .map(|found| FoundRow {
                phrase: found.phrase.text().as_str().to_owned(),
                dates: found.dates.as_str().to_owned(),
                matched_at: found.evidence.clone(),
                ..FoundRow::default()
            })
            .collect();
        Ok(Self {
            kind: "dates",
            warning: outcome.warning.map(str::to_owned),
            rows,
            count: outcome.checksum_valid,
            matched: outcome.match_count,
            stopped: outcome.stopped,
            list: list.filter(|_| !outcome.stopped),
            list_full,
            ..Self::default()
        })
    }

    pub(super) fn of_words(outcome: WordSearchOutcome) -> Result<Self, JsValue> {
        let mut rows = Vec::new();
        for shown in &outcome.shown {
            rows.push(FoundRow {
                phrase: shown
                    .candidate
                    .phrase()
                    .map_err(fail)?
                    .text()
                    .as_str()
                    .to_owned(),
                matched_at: shown.answer.as_ref().and_then(|answer| answer.path.clone()),
                number: shown.candidate.number(),
                ..FoundRow::default()
            });
        }
        let length = outcome.entropies.len() / (outcome.count as usize).max(1);
        Ok(Self {
            kind: "words",
            warning: outcome.warning.map(str::to_owned),
            rows,
            count: outcome.count,
            matched: outcome.matched,
            stopped: outcome.stopped,
            list: (length > 0).then_some(KeptList {
                entropies: outcome.entropies,
                length,
            }),
            list_full: outcome.list_full || !candidate_list_holds(outcome.count),
            ..Self::default()
        })
    }

    pub(super) fn of_marked(outcome: MissingCodesResult) -> Result<Self, JsValue> {
        Ok(match outcome {
            MissingCodesResult::Found(found) => Self {
                kind: "found",
                warning: found.warning.map(str::to_owned),
                notes: vec![
                    found
                        .others
                        .map_or_else(|| texts::CORRECT.to_owned(), found_among_others),
                ],
                rows: found_rows(&found)?,
                others: found.others,
                ..Self::default()
            },
            MissingCodesResult::List(rows) => Self {
                kind: "list",
                notes: vec![texts::LIST.to_owned()],
                rows: rows
                    .iter()
                    .map(|row| FoundRow {
                        phrase: row.phrase.text().as_str().to_owned(),
                        codes: row.codes.as_str().to_owned(),
                        fingerprint: row.fingerprint.clone(),
                        ..FoundRow::default()
                    })
                    .collect(),
                ..Self::default()
            },
            MissingCodesResult::None(message) => Self {
                kind: "none",
                message: Some(message.to_owned()),
                ..Self::default()
            },
            MissingCodesResult::Several { count, message } => Self {
                kind: "several",
                message: Some(message),
                count,
                ..Self::default()
            },
            MissingCodesResult::Stopped => Self {
                kind: "stopped",
                stopped: true,
                ..Self::default()
            },
        })
    }

    pub(super) fn of_restore(outcome: ShareRestoreOutcome) -> Result<Self, JsValue> {
        Ok(match outcome {
            ShareRestoreOutcome::Trouble { message, lines } => Self {
                kind: "trouble",
                message: Some(message),
                lines: line_texts(lines),
                ..Self::default()
            },
            ShareRestoreOutcome::Question { question, lines } => Self {
                kind: "question",
                message: Some(question),
                lines: line_texts(lines),
                ..Self::default()
            },
            ShareRestoreOutcome::Few { message, lines } => Self {
                kind: "few",
                message: Some(message),
                lines: line_texts(lines),
                ..Self::default()
            },
            ShareRestoreOutcome::Stopped { lines } => Self {
                kind: "stopped",
                lines: line_texts(lines),
                stopped: true,
                ..Self::default()
            },
            ShareRestoreOutcome::Phrases {
                found,
                lines,
                notes,
                ..
            } => {
                let warnings = match_warnings(&found.phrases);
                let (list, list_full) = list_of(&found.listed, found.matches)?;
                Self {
                    kind: "phrases",
                    lines: line_texts(lines),
                    notes,
                    warning: (!warnings.is_empty()).then(|| warnings.join(" ")),
                    rows: found
                        .phrases
                        .iter()
                        .map(|phrase| FoundRow {
                            phrase: phrase.unmasked.phrase.text().as_str().to_owned(),
                            dates: phrase
                                .unmasked
                                .dates
                                .as_ref()
                                .map_or_else(String::new, |dates| dates.as_str().to_owned()),
                            matched_at: phrase.unmasked.matched_at.clone(),
                            repairs: phrase.repairs.iter().map(ShareRepairs::line).collect(),
                            ..FoundRow::default()
                        })
                        .collect(),
                    list,
                    list_full,
                    ..Self::default()
                }
            }
        })
    }

    pub(super) fn of_repair(outcome: ShareRepairOutcome) -> Self {
        match outcome {
            ShareRepairOutcome::Trouble { message, lines } => Self {
                kind: "trouble",
                message: Some(message),
                lines: line_texts(lines),
                ..Self::default()
            },
            ShareRepairOutcome::Question { question, lines } => Self {
                kind: "question",
                message: Some(question),
                lines: line_texts(lines),
                ..Self::default()
            },
            ShareRepairOutcome::Stopped { lines } => Self {
                kind: "stopped",
                lines: line_texts(lines),
                stopped: true,
                ..Self::default()
            },
            ShareRepairOutcome::Shares {
                shares,
                repairs,
                lines,
                notes,
                warning,
                ..
            } => Self {
                kind: "shares",
                lines: line_texts(lines),
                notes,
                warning,
                rows: share_rows(&shares, &repairs, 0, ""),
                ..Self::default()
            },
            ShareRepairOutcome::Variants {
                message,
                variants,
                lines,
                warning,
            } => Self {
                kind: "variants",
                message: Some(message),
                lines: line_texts(lines),
                warning,
                rows: variant_rows(&variants),
                ..Self::default()
            },
        }
    }

    /// The row at `at`, its `field` given out.
    fn row(&self, at: f64, field: impl FnOnce(&FoundRow) -> &String) -> Option<String> {
        after_secret(|| self.rows.get(place(at)).map(|row| field(row).clone()))
    }
}

#[wasm_bindgen]
impl SearchResult {
    /// What kind of result: "dates", "words", "found", "list", "none", "several", "trouble",
    /// "question", "few", "phrases", "shares", "variants" or "stopped".
    #[wasm_bindgen(getter)]
    pub fn kind(&self) -> String {
        self.kind.to_owned()
    }

    /// What the result says: its trouble, its question or why nothing fits.
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> Option<String> {
        self.message.clone()
    }

    /// The lines of a report, said before the phrases.
    #[wasm_bindgen(getter)]
    pub fn lines(&self) -> Vec<String> {
        self.lines.clone()
    }

    /// The notes said with the phrases.
    #[wasm_bindgen(getter)]
    pub fn notes(&self) -> Vec<String> {
        self.notes.clone()
    }

    /// What the wallet check said of its matches.
    #[wasm_bindgen(getter)]
    pub fn warning(&self) -> Option<String> {
        self.warning.clone()
    }

    /// How many rows it holds.
    #[wasm_bindgen(getter)]
    pub fn rows(&self) -> usize {
        self.rows.len()
    }

    /// How many candidates a search counted.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> f64 {
        self.count as f64
    }

    /// How many the wallet matched.
    #[wasm_bindgen(getter)]
    pub fn matched(&self) -> f64 {
        self.matched as f64
    }

    /// Whether the page stopped the search, so that the result is partial.
    #[wasm_bindgen(getter)]
    pub fn stopped(&self) -> bool {
        self.stopped
    }

    /// How many other sets of codes and dates give the phrase found, which no wallet tells apart.
    #[wasm_bindgen(getter)]
    pub fn others(&self) -> Option<f64> {
        self.others.map(|others| others as f64)
    }

    /// Whether the search found more candidates than a list keeps, so that no list holds them all.
    #[wasm_bindgen(getter, js_name = listFull)]
    pub fn list_full(&self) -> bool {
        self.list_full
    }

    /// The candidates kept as a list's bytes for `protectList`, each with the BIP39 `passphrase`, if
    /// any; none where it kept none. Refused for a passphrase longer than a list takes.
    #[wasm_bindgen(js_name = candidateList)]
    pub fn candidate_list(&self, passphrase: JsValue) -> Result<Option<Vec<u8>>, JsValue> {
        after_secret(|| {
            let Some(list) = &self.list else {
                return Ok(None);
            };
            let entropies = SecretBytes::copy_of("a list's entropies", &list.entropies);
            let typed = optional_text(&passphrase)?;
            let stored = (!typed.is_empty()).then_some(typed.as_str());
            CandidateList::new(entropies, list.length, stored, &[])
                .map(|list| Some(list.encode().to_vec()))
                .map_err(fail)
        })
    }

    /// The phrase of the row at `at`.
    pub fn phrase(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.phrase)
    }

    /// The codes of the row at `at`.
    pub fn codes(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.codes)
    }

    /// The dates of the row at `at`.
    pub fn dates(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.dates)
    }

    /// The fingerprint of the row at `at`.
    pub fn fingerprint(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.fingerprint)
    }

    /// The share of the row at `at`, written again in its form.
    pub fn share(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.share)
    }

    /// The share of the row at `at` as an SSKR UR record.
    pub fn record(&self, at: f64) -> Option<String> {
        self.row(at, |row| &row.record)
    }

    /// The form that the share of the row at `at` is written in.
    pub fn format(&self, at: f64) -> Option<String> {
        self.rows.get(place(at)).map(|row| row.format.to_owned())
    }

    /// Which set of "variants" the share of the row at `at` belongs to, from 0.
    pub fn set(&self, at: f64) -> Option<usize> {
        self.rows.get(place(at)).map(|row| row.set)
    }

    /// What a repair filled in of the row at `at`, a line for each share.
    pub fn repairs(&self, at: f64) -> Option<Vec<String>> {
        after_secret(|| self.rows.get(place(at)).map(|row| row.repairs.clone()))
    }

    /// Where the wallet matched the row at `at`.
    #[wasm_bindgen(js_name = matchedAt)]
    pub fn matched_at(&self, at: f64) -> Option<String> {
        self.rows.get(place(at))?.matched_at.clone()
    }

    /// The number of the candidate of the row at `at`, from 1, or the place of its share.
    pub fn number(&self, at: f64) -> Option<f64> {
        self.rows.get(place(at)).map(|row| row.number as f64)
    }
}

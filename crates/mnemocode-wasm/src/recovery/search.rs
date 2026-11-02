//! The searches for a page: the wallet they compare with, each search as one class that the page
//! steps, and what it says before it starts.

use std::fmt;
use std::rc::Rc;

use mnemocode::backup::Backup;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::modes::Mode;
use mnemocode::modes::seedshift::Indexes;
use mnemocode::recovery::date_search::{DateSearch, MatchLimits};
use mnemocode::recovery::marked::MissingCodes;
use mnemocode::recovery::marked_search::{MissingCodesSearch, Way, WayChoice, WaySearch, texts};
use mnemocode::recovery::places::WordSearch;
use mnemocode::recovery::shares::flow::{RestoreFlow, ShareRestoreRequest};
use mnemocode::recovery::shares::repair::{ShareRepairOutcome, repair_before_restore, repaired};
use mnemocode::recovery::shares::{SearchLimits, ShareFlowError};
use mnemocode::recovery::wallet_check::WalletCheck;
use mnemocode::recovery::word_search::{WordCandidateSearch, WordLimits};
use mnemocode::refusal::Refusal;
use mnemocode::search::plan::SearchPlan;
use mnemocode::search::{Progress, Search, SearchSize, Step, kept_count};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::joint::tries_per_second;
use mnemocode::sskr::typed::ShareInput;
use wasm_bindgen::prelude::*;

use super::found::SearchResult;
use super::{checked_dates, count, dates_of, fail, needed_form, needed_mode};
use crate::host::{after_secret, name, place, refused, text, whole};

/// A search by the wallet on a [`Recovery`] without one.
#[derive(Debug)]
struct NoWallet;

impl fmt::Display for NoWallet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("This search compares each candidate with a wallet: give one first.")
    }
}

impl std::error::Error for NoWallet {}

impl Refusal for NoWallet {
    fn code(&self) -> &'static str {
        "wasm.recovery.no-wallet"
    }
}

/// The wallet that the searches compare with, if any; [`Recovery::without_wallet`], or
/// `WalletEvidence.recovery` with its BIP39 passphrase.
#[wasm_bindgen]
pub struct Recovery {
    wallet: Option<Rc<WalletCheck>>,
    keep: Option<u64>,
    limits: SearchLimits,
    confirmed: bool,
}

impl Recovery {
    /// The wallet compared with, refused where there is none.
    pub(super) fn wallet_check(&self) -> Result<&WalletCheck, JsValue> {
        self.wallet.as_deref().ok_or_else(|| fail(NoWallet))
    }

    /// The searches compared with `check`.
    #[cfg(feature = "browser-wallet")]
    pub(crate) fn of(check: WalletCheck) -> Self {
        Self {
            wallet: Some(Rc::new(check)),
            ..Self::without_wallet()
        }
    }

    /// The marked codes of `codes` in `form` and `mode`.
    fn marked(
        codes: &JsValue,
        form: &JsValue,
        mode: &JsValue,
    ) -> Result<MissingCodesSearch, JsValue> {
        MissingCodes::read(&text(codes)?, needed_form(form)?, needed_mode(mode)?)
            .map(MissingCodesSearch::new)
            .map_err(fail)
    }

    /// The restore of `input`, shares as typed, in `mode` with `dates`, keeping `keep` date matches
    /// for a list.
    fn restore(
        &self,
        input: ShareInput,
        mode: Mode,
        dates: &JsValue,
        keep: Option<u64>,
    ) -> Result<RestoreFlow, JsValue> {
        RestoreFlow::new(ShareRestoreRequest {
            input,
            mode,
            dates: dates_of(dates, None, true)?,
            wallet: self.wallet.clone(),
            keep,
            limits: self.limits,
            confirmed: self.confirmed,
        })
        .map_err(fail)
    }
}

/// `shares` as typed, each in any form, read by `entry`.
fn input_of(shares: &[String], entry: &str) -> Result<ShareInput, JsValue> {
    let mut input = ShareInput::new(entry);
    input.add(shares).map_err(fail).map(|()| input)
}

/// `shares` as texts, read inside Rust.
fn texts_of(shares: &[JsValue]) -> Result<Vec<String>, JsValue> {
    shares.iter().map(text).collect()
}

/// A limit that a page passes: none for NaN; refused, naming `what`, unless a whole number from 1.
fn limit_of(value: f64, what: &'static str) -> Result<Option<u64>, JsValue> {
    count(value)
        .map(|limit| kept_count(Some(limit), limit, what, 1).map_err(fail))
        .transpose()
}

#[wasm_bindgen]
impl Recovery {
    /// The searches compared with no wallet.
    #[wasm_bindgen(js_name = withoutWallet)]
    pub fn without_wallet() -> Recovery {
        Recovery {
            wallet: None,
            keep: None,
            limits: SearchLimits::default(),
            confirmed: false,
        }
    }

    /// What a restore of shares goes by: `keep` date matches for a list, the share combinations and
    /// the date combinations it tries without a question (NaN: the defaults), and whether the
    /// person said yes to the long search that its question announced.
    #[wasm_bindgen(js_name = setRestoreLimits)]
    pub fn set_restore_limits(
        &mut self,
        keep: f64,
        most_tries: f64,
        most_dates: f64,
        confirmed: bool,
    ) -> Result<(), JsValue> {
        self.limits = SearchLimits {
            shares: limit_of(most_tries, "A limit of share combinations")?,
            dates: limit_of(most_dates, "A limit of date combinations")?,
        };
        self.keep = count(keep);
        self.confirmed = confirmed;
        Ok(())
    }

    /// The search of the forgotten digits of `dates` of the backup `codes`, read in `form` and
    /// `mode`; `max_shown` and `keep` (NaN: the defaults) say what it keeps.
    #[wasm_bindgen(js_name = dateSearch)]
    pub fn date_search(
        &self,
        codes: JsValue,
        form: JsValue,
        mode: JsValue,
        dates: JsValue,
        max_shown: f64,
        keep: f64,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            let mode = needed_mode(&mode)?;
            let backup = Backup::read(&text(&codes)?, needed_form(&form)?, mode).map_err(fail)?;
            let answer = DatesAnswer::parse(&text(&dates)?, Some(backup.words()), true);
            DateSearch::new(
                Indexes::new(backup.indexes().to_vec()),
                Rc::new(answer.map_err(fail)?),
                mode,
                self.wallet.clone(),
                MatchLimits {
                    max_shown: count(max_shown),
                    keep: count(keep),
                },
            )
            .map(|search| RecoverySearch(Running::Date(Box::new(search))))
            .map_err(fail)
        })
    }

    /// The search of the words `phrase` marks; with `missing`, of a word missing at any place.
    #[wasm_bindgen(js_name = wordSearch)]
    pub fn word_search(
        &self,
        phrase: JsValue,
        missing: bool,
        max_shown: f64,
        keep: f64,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            let typed = text(&phrase)?;
            let read = if missing {
                WordSearch::missing_word(&typed)
            } else {
                WordSearch::unknown_words(&typed)
            };
            let limits = WordLimits {
                max_shown: count(max_shown),
                keep: count(keep),
                stop_when_full: false,
            };
            WordCandidateSearch::new(read.map_err(fail)?, self.wallet.clone(), limits)
                .map(|search| RecoverySearch(Running::Word(Box::new(search))))
                .map_err(fail)
        })
    }

    /// The search of the marked `codes` by their encoded `fingerprint`.
    #[wasm_bindgen(js_name = markedByFingerprint)]
    pub fn marked_by_fingerprint(
        &self,
        codes: JsValue,
        form: JsValue,
        mode: JsValue,
        fingerprint: JsValue,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            Self::marked(&codes, &form, &mode)?
                .by_encoded_fingerprint(&name(&fingerprint))
                .map(RecoverySearch::way)
                .map_err(fail)
        })
    }

    /// The search of the marked `codes`: by the wallet with `dates`, which may hold ?, or with `list`
    /// every candidate under complete `dates`, with its fingerprint.
    #[wasm_bindgen(js_name = markedSearch)]
    pub fn marked_search(
        &self,
        codes: JsValue,
        form: JsValue,
        mode: JsValue,
        dates: JsValue,
        list: bool,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            let search = Self::marked(&codes, &form, &mode)?;
            let words = search.codes().word_count();
            let way = if list {
                search.listed(&checked_dates(&dates, words)?)
            } else {
                let wallet = self.wallet.clone().ok_or_else(|| refused(&NoWallet))?;
                search.by_wallet(wallet, dates_of(&dates, Some(words), true)?)
            };
            way.map(RecoverySearch::way).map_err(fail)
        })
    }

    /// The restore of `shares` as typed, each in any form, in `mode` with `dates`, which may hold
    /// ?, by the limits set. `decode_entry` names where the page reads an encoded phrase. The page
    /// calls `begin`, then steps it.
    #[wasm_bindgen(js_name = restoreShares)]
    pub fn restore_shares(
        &self,
        shares: Vec<JsValue>,
        mode: JsValue,
        dates: JsValue,
        decode_entry: JsValue,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            let input = input_of(&texts_of(&shares)?, &name(&decode_entry))?;
            let flow = self.restore(input, needed_mode(&mode)?, &dates, self.keep)?;
            Ok(RecoverySearch(Running::Restore(Box::new(flow), None)))
        })
    }

    /// As [`Recovery::restore_shares`], writing damaged shares again as sskr-export does, the phrase
    /// never given: each share in `format`, or in its own where it is undefined; "shares" holds
    /// them, or "variants" every set that fits where nothing tells which is the person's.
    #[wasm_bindgen(js_name = repairShares)]
    pub fn repair_shares(
        &self,
        shares: Vec<JsValue>,
        mode: JsValue,
        dates: JsValue,
        decode_entry: JsValue,
        format: JsValue,
    ) -> Result<RecoverySearch, JsValue> {
        after_secret(|| {
            let form = if format.is_undefined() {
                None
            } else {
                Some(ShareFormat::named(&name(&format)).map_err(fail)?)
            };
            let texts = texts_of(&shares)?;
            let entry = name(&decode_entry);
            let input = input_of(&texts, &entry)?;
            let mode = needed_mode(&mode)?;
            let wallet_given = self.wallet.is_some();
            if let Some(outcome) =
                repair_before_restore(&input, mode, wallet_given, form).map_err(fail)?
            {
                return Ok(RecoverySearch(Running::Ready(Box::new(Ready(outcome)))));
            }
            let flow = self.restore(input, mode, &dates, None)?;
            let rewrite = Rewrite {
                input: input_of(&texts, &entry)?,
                form,
                wallet_given,
            };
            Ok(RecoverySearch(Running::Restore(
                Box::new(flow),
                Some(Box::new(rewrite)),
            )))
        })
    }
}

/// Codes marked with ?, with what a page says of them before it searches.
#[wasm_bindgen]
pub struct MarkedCodes(MissingCodesSearch);

/// A way to tell the right codes.
#[wasm_bindgen]
pub struct MarkedWay(WayChoice);

#[wasm_bindgen]
impl MarkedWay {
    /// Which it is: "encoded", for `markedByFingerprint`, or "wallet" or "list", for
    /// `markedSearch`.
    #[wasm_bindgen(getter)]
    pub fn way(&self) -> String {
        match self.0.way {
            Way::Encoded => "encoded",
            Way::Wallet => "wallet",
            Way::List => "list",
        }
        .to_owned()
    }

    /// Its name in a list of choices.
    #[wasm_bindgen(getter)]
    pub fn label(&self) -> String {
        self.0.label.to_owned()
    }

    /// What it needs or does, shown beside its label.
    #[wasm_bindgen(getter)]
    pub fn note(&self) -> String {
        self.0.note.to_owned()
    }
}

#[wasm_bindgen]
impl MarkedCodes {
    /// Reads the marked `codes` in `form` and `mode`.
    pub fn read(codes: JsValue, form: JsValue, mode: JsValue) -> Result<MarkedCodes, JsValue> {
        after_secret(|| Recovery::marked(&codes, &form, &mode).map(MarkedCodes))
    }

    /// What cannot be read, and how many candidates that leaves.
    #[wasm_bindgen(getter)]
    pub fn unreadable(&self) -> Result<String, JsValue> {
        after_secret(|| self.0.unreadable().map_err(fail))
    }

    /// What to say where the candidates are too many to list; none where a list holds them.
    #[wasm_bindgen(getter)]
    pub fn many(&self) -> Result<Option<String>, JsValue> {
        let many = after_secret(|| self.0.many().map_err(fail))?;
        Ok(many.then(|| texts::MANY.to_owned()))
    }

    /// How the question of the ways is put.
    #[wasm_bindgen(getter)]
    pub fn question(&self) -> String {
        texts::QUESTION.to_owned()
    }

    /// How many ways are offered.
    #[wasm_bindgen(getter)]
    pub fn ways(&self) -> Result<usize, JsValue> {
        after_secret(|| self.0.ways().map(|ways| ways.len()).map_err(fail))
    }

    /// The way at `at` of those offered, in order; the search itself refuses a way that does not
    /// fit.
    pub fn way(&self, at: f64) -> Result<Option<MarkedWay>, JsValue> {
        let ways = after_secret(|| self.0.ways().map_err(fail))?;
        Ok(ways.get(place(at)).copied().map(MarkedWay))
    }

    /// Whether the dates of these codes are needed: they were masked.
    #[wasm_bindgen(getter, js_name = needsDates)]
    pub fn needs_dates(&self) -> bool {
        self.0.needs_dates()
    }
}

/// What a restore writes again: its shares as typed, the form, and whether a wallet chooses a set.
struct Rewrite {
    input: ShareInput,
    form: Option<ShareFormat>,
    wallet_given: bool,
}

/// The search under way.
enum Running {
    Date(Box<DateSearch>),
    Word(Box<WordCandidateSearch>),
    Marked(Box<WaySearch>),
    Restore(Box<RestoreFlow>, Option<Box<Rewrite>>),
    /// A repair that needs no search: its outcome is known.
    Ready(Box<Ready>),
}

/// What a repair gives before any restore.
struct Ready(ShareRepairOutcome);

impl Search for Ready {
    type Outcome = ShareRepairOutcome;
    type Error = ShareFlowError;

    fn size(&self) -> SearchSize {
        SearchSize {
            candidates: 0,
            pace_parts: 0,
        }
    }

    fn pace_sample(&self, _part: u8) -> Result<(), ShareFlowError> {
        Ok(())
    }

    fn step(&mut self, _work: u32) -> Result<Step, ShareFlowError> {
        Ok(Step::Done(Progress::default()))
    }

    fn finish(self) -> ShareRepairOutcome {
        self.0
    }
}

/// What is done with whichever search runs.
macro_rules! with_search {
    ($running:expr, $search:ident => $work:expr) => {
        match $running {
            Running::Date($search) => $work,
            Running::Word($search) => $work,
            Running::Marked($search) => $work,
            Running::Restore($search, _) => $work,
            Running::Ready($search) => $work,
        }
    };
}

/// A search that the page steps: it times each part of the public pace sample, asks what
/// `question` says where it must, and calls `step` until it gives false.
#[wasm_bindgen]
pub struct RecoverySearch(Running);

impl RecoverySearch {
    fn way(search: WaySearch) -> Self {
        Self(Running::Marked(Box::new(search)))
    }
}

/// The size of a search and what is said of it before it starts.
#[wasm_bindgen]
pub struct SearchQuestion(SearchPlan);

#[wasm_bindgen]
impl SearchQuestion {
    /// Whether it is asked for first.
    #[wasm_bindgen(getter)]
    pub fn ask(&self) -> bool {
        self.0.ask()
    }

    /// Whether its time is said.
    #[wasm_bindgen(getter)]
    pub fn tell(&self) -> bool {
        self.0.tell()
    }

    /// What to ask.
    #[wasm_bindgen(getter)]
    pub fn question(&self) -> String {
        self.0.question()
    }

    /// What it tries, for a notice.
    #[wasm_bindgen(getter)]
    pub fn notice(&self) -> String {
        self.0.notice()
    }
}

/// How far a search has come.
#[wasm_bindgen]
pub struct SearchProgress(Progress, bool);

#[wasm_bindgen]
impl SearchProgress {
    /// Whether it has more to try.
    #[wasm_bindgen(getter)]
    pub fn running(&self) -> bool {
        self.1
    }

    /// Tries made so far.
    #[wasm_bindgen(getter)]
    pub fn checked(&self) -> f64 {
        self.0.checked as f64
    }

    /// Tries in all, where the search knows them.
    #[wasm_bindgen(getter)]
    pub fn total(&self) -> Option<f64> {
        self.0.total.map(|total| total as f64)
    }

    /// What passed its own check so far.
    #[wasm_bindgen(getter)]
    pub fn found(&self) -> f64 {
        self.0.found as f64
    }

    /// What the wallet matched so far.
    #[wasm_bindgen(getter)]
    pub fn matched(&self) -> f64 {
        self.0.matched as f64
    }
}

#[wasm_bindgen]
impl RecoverySearch {
    /// How many parts its public pace sample has.
    #[wasm_bindgen(getter, js_name = paceParts)]
    pub fn pace_parts(&self) -> u8 {
        with_search!(&self.0, search => search.size().pace_parts)
    }

    /// Runs part `part` of the sample, for the page to time.
    #[wasm_bindgen(js_name = paceSample)]
    pub fn pace_sample(&self, part: f64) -> Result<(), JsValue> {
        let part = u8::try_from(whole(part)).unwrap_or(u8::MAX);
        after_secret(|| with_search!(&self.0, search => search.pace_sample(part).map_err(fail)))
    }

    /// What is said before a date or marked-code search, from the `seconds` each part took and the
    /// person's `limit` (NaN: twelve hours); none for another search.
    pub fn plan(&self, seconds: Vec<f64>, limit: f64) -> Result<Option<SearchQuestion>, JsValue> {
        let limit = limit_of(limit, "The longest search")?;
        after_secret(|| {
            let plan = match &self.0 {
                Running::Date(search) => {
                    let pace = search.pace(&seconds);
                    search.plan(pace, limit).map_err(fail)?
                }
                Running::Marked(search) => search.plan(&seconds, limit).map_err(fail)?,
                Running::Word(_) | Running::Restore(..) | Running::Ready(_) => return Ok(None),
            };
            Ok(Some(SearchQuestion(plan)))
        })
    }

    /// Reads the shares of a restore and settles its search, from the `seconds` each part of the
    /// sample took; nothing for another search.
    pub fn begin(&mut self, seconds: Vec<f64>) -> Result<(), JsValue> {
        if let Running::Restore(flow, _) = &mut self.0 {
            let (first, dates) = seconds.split_first().unwrap_or((&0.0, &[]));
            after_secret(|| flow.begin(tries_per_second(*first), dates).map_err(fail))?;
        }
        Ok(())
    }

    /// Tries at most `work` candidates.
    pub fn step(&mut self, work: f64) -> Result<SearchProgress, JsValue> {
        let work = u32::try_from(whole(work)).unwrap_or(u32::MAX);
        after_secret(|| {
            let step = with_search!(&mut self.0, search => search.step(work).map_err(fail))?;
            Ok(SearchProgress(
                step.progress(),
                matches!(step, Step::Running(_)),
            ))
        })
    }

    /// What it found.
    pub fn finish(self) -> Result<SearchResult, JsValue> {
        after_secret(|| match self.0 {
            Running::Date(search) => SearchResult::of_dates(search.finish()),
            Running::Word(search) => SearchResult::of_words(search.finish()),
            Running::Marked(search) => SearchResult::of_marked(search.finish()),
            Running::Ready(ready) => Ok(SearchResult::of_repair(ready.finish())),
            Running::Restore(search, None) => SearchResult::of_restore(search.finish()),
            Running::Restore(search, Some(rewrite)) => {
                let Rewrite {
                    input,
                    form,
                    wallet_given,
                } = *rewrite;
                repaired(search.finish(), &input, form, wallet_given)
                    .map(SearchResult::of_repair)
                    .map_err(fail)
            }
        })
    }
}

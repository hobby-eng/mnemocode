//! The restore of a seed phrase from Shamir shares and the repair of damaged shares, in the steps
//! that every host takes, so that none writes them again (MnemoCode TS 0.1.0's
//! `sskr/share-restore.ts`, CAP-SSKR-RESTORE-STEPS, CAP-SSKR-SEARCH-CONSENT,
//! CAP-SSKR-EXPORT-REPAIR-FLOW): read the shares; search marked shares, after the host's question
//! when the search is long; unmask the phrases with the dates of a Seedshift phrase, searched where
//! a date holds ?, and say why none is the wallet's; write damaged shares again. A flow runs them in
//! one go for a host that asks its questions before it starts, such as a page: a long search stops
//! with the question, and runs once the person said yes. It asks nothing and shows nothing.

pub mod flow;
pub mod repair;
pub mod unmasking;

use std::fmt;

use crate::backup::BackupError;
use crate::bip32::Bip32Error;
use crate::bip39::phrase::PhraseError;
use crate::modes::ModeError;
use crate::recovery::date_search::DateSearchError;
use crate::refusal::{Refusal, RefusalKind};
use crate::search::CountRefused;
use crate::sskr::export::PlacesRefused;
use crate::sskr::joint::{JointError, JointPlan};
use crate::sskr::repair::report::{DateWork, PaceRefused, RepairReport, ReportLine};
use crate::sskr::restore::{RestoreError, ShareSet};
use crate::sskr::typed::{CompleteOutcome, ShareInput, ShareTrouble};
use crate::wallet::evidence::EvidenceError;

/// Why a wallet check of shares needs a whole set: no phrase is restored from fewer.
pub const WALLET_CHECK_NEEDS_THRESHOLD: &str =
    "The wallet can be checked only with as many shares as the threshold.";
/// Why a repair of shares of a Seedshift phrase needs the wallet: the dates serve only its check.
pub const SEEDSHIFT_REPAIR_NEEDS_WALLET: &str =
    "Seedshift mode here serves only the wallet check: give the wallet too.";
/// Why no share is written again: every one has an element that nothing settles.
pub const NO_SHARE_SETTLED: &str = "No share could be settled.";
/// Complete shares restore one set, so their date search unmasks one phrase.
const COMPLETE_READ_PHRASES: u64 = 1;

/// "2 sets of shares fit; the wallet tells yours.", after a restore without a wallet.
pub fn several_sets_note(sets: usize) -> String {
    format!("{sets} sets of shares fit; the wallet tells yours.")
}

/// Why `sets` sets of repaired shares are shown, none written: without a wallet, their fingerprints
/// tell; with one that `wallet_given` says each matched, an address of it tells.
pub fn variants_message(sets: usize, wallet_given: bool) -> String {
    if wallet_given {
        format!(
            "{sets} sets of shares fit, and the wallet given matches each of them. An address of the wallet tells the right one; give it instead to have that set written."
        )
    } else {
        format!(
            "{sets} sets of shares fit. The original fingerprint of each, the wallet's own, tells the right one; give it, or an address, to have that set written."
        )
    }
}

/// The refusals of the flows of shares.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ShareFlowError {
    /// A Seedshift phrase unmasked without its dates.
    NoDates,
    /// A count that the host passes.
    Count(CountRefused),
    /// What the mode refuses.
    Mode(ModeError),
    /// What the date search refuses.
    Dates(DateSearchError),
    /// What the wallet's evidence refuses.
    Wallet(EvidenceError),
    /// What the restore of complete shares refuses.
    Restore(RestoreError),
    /// What the joint repair refuses.
    Joint(JointError),
    /// What a backup refuses.
    Backup(BackupError),
    /// What a phrase refuses.
    Phrase(PhraseError),
    /// A phrase's keys that cannot be derived.
    Keys(Bip32Error),
    /// Fewer places than shares.
    Places(PlacesRefused),
    /// A pace that a report cannot tell a time with.
    Pace(PaceRefused),
}

impl fmt::Display for ShareFlowError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NoDates => {
                f.write_str("A Seedshift phrase is unmasked with its dates, a DatesAnswer.")
            }
            Self::Count(error) => error.fmt(f),
            Self::Mode(error) => error.fmt(f),
            Self::Dates(error) => error.fmt(f),
            Self::Wallet(error) => error.fmt(f),
            Self::Restore(error) => error.fmt(f),
            Self::Joint(error) => error.fmt(f),
            Self::Backup(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
            Self::Keys(error) => error.fmt(f),
            Self::Places(error) => error.fmt(f),
            Self::Pace(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ShareFlowError {}

impl Refusal for ShareFlowError {
    fn code(&self) -> &'static str {
        match self {
            Self::NoDates => "sskr.share-unmasking.seedshift-phrase-unmasked-dates-dates-answer",
            Self::Count(error) => error.code(),
            Self::Mode(error) => error.code(),
            Self::Dates(error) => error.code(),
            Self::Wallet(error) => error.code(),
            Self::Restore(error) => error.code(),
            Self::Joint(error) => error.code(),
            Self::Backup(error) => error.code(),
            Self::Phrase(error) => error.code(),
            Self::Keys(error) => error.code(),
            Self::Places(error) => error.code(),
            Self::Pace(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::NoDates => RefusalKind::Type,
            Self::Count(error) => error.kind(),
            Self::Mode(error) => error.kind(),
            Self::Dates(error) => error.kind(),
            Self::Wallet(error) => error.kind(),
            Self::Restore(error) => error.kind(),
            Self::Joint(error) => error.kind(),
            Self::Backup(error) => error.kind(),
            Self::Phrase(error) => error.kind(),
            Self::Keys(error) => error.kind(),
            Self::Places(error) => error.kind(),
            Self::Pace(error) => error.kind(),
        }
    }
}

macro_rules! from_error {
    ($($source:ty => $variant:ident),+ $(,)?) => {
        $(impl From<$source> for ShareFlowError {
            fn from(error: $source) -> Self {
                Self::$variant(error)
            }
        })+
    };
}

from_error! {
    ModeError => Mode,
    DateSearchError => Dates,
    EvidenceError => Wallet,
    RestoreError => Restore,
    JointError => Joint,
    BackupError => Backup,
    PhraseError => Phrase,
    Bip32Error => Keys,
    PlacesRefused => Places,
    PaceRefused => Pace,
}

/// Shares with ? marks, assessed together: the plan of their search and its report.
#[derive(Debug)]
pub struct MarkedShares {
    /// The plan of their search.
    pub plan: JointPlan,
    /// The report of the assessment, with this machine's pace and the places of the shares.
    pub report: RepairReport,
    /// The place of each share among those typed, from 1, by its index in the plan.
    pub places: Vec<usize>,
    /// The lines of the report, said before any search.
    pub lines: Vec<ReportLine>,
}

impl MarkedShares {
    /// The words of the phrase they hold, where the assessment knows its length; refused for a
    /// length that no phrase has.
    pub fn word_count(&self) -> Result<Option<usize>, ShareFlowError> {
        Ok(self
            .plan
            .assessment
            .secret_bytes
            .map(ShareSet::word_count_of)
            .transpose()?)
    }
}

/// Complete shares, restored.
#[derive(Debug)]
pub struct CompleteShares {
    /// The set.
    pub set: ShareSet,
    /// The secret's length in bytes.
    pub secret_bytes: usize,
    /// The places of the set's shares, copies left out.
    pub places: Vec<usize>,
    /// The notes of copies left out.
    pub lines: Vec<ReportLine>,
    /// The warning that a share took no part in the check of the set, or that no digest checked
    /// its phrase.
    pub unchecked: Option<String>,
}

/// What the shares as typed give, or their first problem. Nothing is searched yet.
#[derive(Debug)]
pub enum SharesRead {
    /// Their first problem, with the notes of copies left out or the report of marked shares.
    Trouble {
        /// The problem.
        trouble: ShareTrouble,
        /// What is said with it.
        lines: Vec<ReportLine>,
    },
    /// Complete shares, restored.
    Complete(CompleteShares),
    /// Marked shares, assessed.
    Marked(MarkedShares),
}

/// A note as a line of the report.
fn notice_line(text: String) -> ReportLine {
    ReportLine::Notice(text)
}

/// What complete shares give: checked as a set and restored, copies left out with a note, or the
/// first that cannot be read. Shares with ? are assessed by a [`crate::sskr::joint::JointAssessor`],
/// which a host steps.
pub fn read_shares(input: &mut ShareInput) -> Result<SharesRead, ShareFlowError> {
    if let Some(trouble) = input.first_unreadable() {
        return Ok(SharesRead::Trouble {
            trouble,
            lines: Vec::new(),
        });
    }
    let (outcome, copies) = input.restore_complete()?;
    let lines: Vec<ReportLine> = copies
        .into_iter()
        .map(|copy| notice_line(copy.message))
        .collect();
    Ok(match outcome {
        CompleteOutcome::Trouble(trouble) => SharesRead::Trouble { trouble, lines },
        CompleteOutcome::Complete {
            set,
            secret_bytes,
            places,
        } => {
            let unchecked = set.unchecked_note(Some(&places));
            SharesRead::Complete(CompleteShares {
                set,
                secret_bytes,
                places,
                lines,
                unchecked,
            })
        }
    })
}

/// What marked shares give once `plan` assessed them at `places`.
pub fn assessed(
    plan: JointPlan,
    places: Vec<usize>,
    tries_per_second: f64,
) -> Result<SharesRead, ShareFlowError> {
    let report = RepairReport::new(plan.assessment.clone(), tries_per_second, Some(&places))?;
    let lines = report.lines();
    if let Some(trouble) = ShareInput::assessment_trouble(&plan.assessment, &places) {
        return Ok(SharesRead::Trouble { trouble, lines });
    }
    Ok(SharesRead::Marked(MarkedShares {
        plan,
        report,
        places,
        lines,
    }))
}

/// How far a search goes without the person's yes; without limits, as long as twelve hours.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct SearchLimits {
    /// Share combinations, digest checks, that a search of marked shares tries without a question.
    pub shares: Option<u64>,
    /// Date combinations that a date search tries without a question.
    pub dates: Option<u64>,
}

/// A search decision: its question when it waits for the person's yes, or its notice.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SearchDecision {
    /// What to ask before the search, such as "Search 3,650 date combinations, about 9 hours?".
    pub question: Option<String>,
    /// What the search tries and about how long it takes, when it starts without a question.
    pub notice: Option<String>,
}

/// Whether the date search of `work` for each of `phrases` phrases starts at once or after the
/// person's yes, with `limits.dates` combinations allowed without a question.
pub fn date_search_decision(work: DateWork, phrases: u64, limits: SearchLimits) -> SearchDecision {
    if RepairReport::date_search_needs_question(work, phrases, limits.dates) {
        SearchDecision {
            question: Some(RepairReport::date_search_question(work, phrases)),
            notice: None,
        }
    } else {
        SearchDecision {
            question: None,
            notice: Some(RepairReport::date_search_notice(work, phrases)),
        }
    }
}

/// Whether the search that marked shares need, with the date search of `work` for each phrase they
/// give, starts at once or after the person's yes: the one rule of every host.
pub fn marked_search_decision(
    marked: &MarkedShares,
    work: Option<DateWork>,
    limits: SearchLimits,
) -> SearchDecision {
    if marked
        .report
        .needs_question(limits.shares, work, limits.dates)
    {
        return SearchDecision {
            question: Some(marked.report.search_question(work)),
            notice: None,
        };
    }
    SearchDecision {
        question: None,
        notice: work.map(|work| marked.report.search_notice(work.into())),
    }
}

/// The same for complete shares, which restore one set.
pub fn complete_search_decision(work: Option<DateWork>, limits: SearchLimits) -> SearchDecision {
    work.map_or_else(SearchDecision::default, |work| {
        date_search_decision(work, COMPLETE_READ_PHRASES, limits)
    })
}

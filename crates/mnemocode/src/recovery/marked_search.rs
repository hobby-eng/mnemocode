//! The search of codes that cannot be read, marked with ? (MnemoCode TS 0.1.0's
//! `core/missing-codes-search.ts`, CAP-RECOVERY-MARKED-CODES-SEARCH and its three ways): how the
//! right codes are told (the encoded fingerprint that Encode showed for them, the wallet, with the
//! dates where the phrase was masked, or every candidate listed where they are few), the size and
//! time of each way before it starts, and what it found. A host asks the person and shows the
//! results; this module decides every rule, so that the command line and a page search alike. A
//! resumable search the host steps (ADR 0005). Its messages never repeat a code or a phrase.

mod way;

use std::fmt;
use std::rc::Rc;

use super::date_search::DateSearchError;
use super::marked::MissingCodes;
use super::wallet_check::WalletCheck;
use crate::backup::{Backup, BackupError};
use crate::bip32::Bip32Error;
use crate::bip39::phrase::{Phrase, PhraseError};
use crate::dates::Dates;
use crate::dates::answer::DatesAnswer;
use crate::modes::ModeError;
use crate::refusal::{Refusal, RefusalKind};
use crate::search::plan::{CORRECT_WRITTEN_COPY, counted};
use crate::secret::SecretText;
use crate::text::words::{lower_first, places_named};
use crate::wallet::evidence::{EvidenceError, parse_master_fingerprint};
pub use way::WaySearch;
use way::{Test, WalletAndDates};

/// Candidates few enough to be listed for the person to compare.
const MAX_LISTED: u64 = 16;

/// How the right codes are told, in the order a host offers them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Way {
    /// The encoded fingerprint that Encode showed.
    Encoded,
    /// The wallet, after the dates.
    Wallet,
    /// Every candidate, for the person to compare.
    List,
}

impl Way {
    /// Every way, in the order a host offers them.
    pub const ALL: [Self; 3] = [Self::Encoded, Self::Wallet, Self::List];

    /// The way's name in a list of choices.
    pub const fn label(self) -> &'static str {
        match self {
            Self::Encoded => "Encoded fingerprint",
            Self::Wallet => "The wallet",
            Self::List => "List every candidate",
        }
    }

    /// What the way needs or does, for codes that were `masked` or not.
    pub const fn note(self, masked: bool) -> &'static str {
        match self {
            Self::Encoded => "the one Encode showed; no dates needed",
            Self::Wallet if masked => "its fingerprint or an address, after the dates",
            Self::Wallet => "its fingerprint or an address",
            Self::List => "compare them yourself",
        }
    }

    /// Whether the way is offered, where it fits, for codes that were `masked` or not: without
    /// Seedshift the encoded fingerprint is the wallet's own, which the wallet way takes.
    const fn offered(self, masked: bool) -> bool {
        match self {
            Self::Encoded => masked,
            Self::Wallet | Self::List => true,
        }
    }
}

/// The texts that every host shows as they are.
pub mod texts {
    use super::CORRECT_WRITTEN_COPY;

    /// How the right codes are told, as a question.
    pub const QUESTION: &str = "How can MnemoCode tell the right codes?";
    /// That many are left.
    pub const MANY: &str = "A fingerprint or an address tells the right codes among them.";
    /// That no codes fit a fingerprint.
    pub const NONE_BY_FINGERPRINT: &str = "No codes fit this fingerprint: check it, and the codes.";
    /// That no codes fit a wallet.
    pub const NONE_BY_WALLET: &str =
        "No codes give this wallet: check the dates, the wallet and the codes.";
    /// That the written copy is to be corrected.
    pub const CORRECT: &str = CORRECT_WRITTEN_COPY;
    /// What the lines of a list say.
    pub const LIST: &str = "Each line: the codes, the seed phrase they give, and its fingerprint with an empty BIP39 passphrase. Compare the fingerprint with your wallet.";
}

/// What a host says of a find whose phrase `others` other sets of codes and dates give too: the
/// codes and dates found need not be those written.
pub fn found_among_others(others: u64) -> String {
    format!(
        "{} of codes and dates give this phrase; those found are one of them, so keep the dates you used.",
        counted(others + 1, "set")
    )
}

/// The code of [`MarkedSearchError::ListOverflow`], by which a host that lists asks for another way.
pub const LIST_OVERFLOW: &str = "core.missing-codes-search.list-overflow";

/// The refusals of a search of marked codes, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkedSearchError {
    /// Dates with forgotten digits for codes that were not masked.
    NotMasked,
    /// More rows fit than a list holds, which the estimate allowed: its rows' name.
    ListOverflow(&'static str),
    /// A list of more candidates than it holds.
    TooManyToList(String),
    /// Codes that keep no checksum, whose encoded fingerprint tells nothing.
    NoChecksum,
    /// What the date search refuses.
    Dates(DateSearchError),
    /// What the backup refuses.
    Backup(BackupError),
    /// What the mode refuses.
    Mode(ModeError),
    /// What the wallet's evidence refuses.
    Wallet(EvidenceError),
    /// A phrase's keys that cannot be derived.
    Keys(Bip32Error),
    /// A phrase the codes gave that is no phrase.
    Phrase(PhraseError),
    /// Dates found that do not decode the codes to the phrase the wallet matched.
    OtherWallet,
}

impl fmt::Display for MarkedSearchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotMasked => f.write_str("Codes that were not masked have no dates to search."),
            Self::ListOverflow(rows) => write!(
                f,
                "More than {MAX_LISTED} {rows} fit these codes and dates. Narrow the codes or use a wallet check instead of listing them."
            ),
            Self::TooManyToList(message) => f.write_str(message),
            Self::NoChecksum => f.write_str(
                "These codes keep no checksum, so their encoded fingerprint cannot tell them.",
            ),
            Self::Dates(error) => error.fmt(f),
            Self::Backup(error) => error.fmt(f),
            Self::Mode(error) => error.fmt(f),
            Self::Wallet(error) => error.fmt(f),
            Self::Keys(error) => error.fmt(f),
            Self::Phrase(error) => error.fmt(f),
            Self::OtherWallet => {
                f.write_str("The dates found do not decode the codes to the wallet that matched.")
            }
        }
    }
}

impl std::error::Error for MarkedSearchError {}

impl Refusal for MarkedSearchError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotMasked => "core.missing-codes-search.codes-were-not-masked-no-dates-search",
            Self::ListOverflow(_) => LIST_OVERFLOW,
            Self::TooManyToList(_) => "core.missing-codes-search.operation-refused",
            Self::NoChecksum => "core.missing-codes-search.codes-keep-no-checksum",
            Self::Dates(error) => error.code(),
            Self::Backup(error) => error.code(),
            Self::Mode(error) => error.code(),
            Self::Wallet(error) => error.code(),
            Self::Keys(error) => error.code(),
            Self::Phrase(error) => error.code(),
            Self::OtherWallet => {
                "core.missing-codes-search.dates-found-do-not-decode-codes-wallet-matched"
            }
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::Dates(error) => error.kind(),
            Self::Backup(error) => error.kind(),
            Self::Mode(error) => error.kind(),
            Self::Wallet(error) => error.kind(),
            Self::Keys(error) => error.kind(),
            Self::Phrase(error) => error.kind(),
            _ => RefusalKind::Error,
        }
    }
}

macro_rules! from_error {
    ($($source:ty => $variant:ident),+ $(,)?) => {
        $(impl From<$source> for MarkedSearchError {
            fn from(error: $source) -> Self {
                Self::$variant(error)
            }
        })+
    };
}

from_error! {
    DateSearchError => Dates,
    BackupError => Backup,
    ModeError => Mode,
    EvidenceError => Wallet,
    Bip32Error => Keys,
    PhraseError => Phrase,
}

/// About how many rows a list of the candidates of `codes` has: one phrase for each set of codes,
/// or as many as one set gives where its mode gives several.
fn listed_rows(codes: &MissingCodes) -> Result<f64, ModeError> {
    let expected = codes.expected() as f64;
    if !codes.mode().gives_several() {
        return Ok(expected);
    }
    Ok(expected * codes.mode().checks_per_decoding(codes.word_count())?)
}

/// What a row of a list of `codes` is: a candidate, a set of codes with its phrase, or a phrase
/// where one set gives several.
const fn listed_row(codes: &MissingCodes) -> &'static str {
    if codes.mode().gives_several() {
        "phrase"
    } else {
        "candidate"
    }
}

/// The rows of a list of `codes` in words, such as "24 phrases".
fn listed_text(codes: &MissingCodes) -> Result<String, ModeError> {
    Ok(counted(listed_rows(codes)? as u64, listed_row(codes)))
}

/// Whether a list holds the rows that `codes` are estimated to give.
fn list_holds(codes: &MissingCodes) -> Result<bool, ModeError> {
    Ok(listed_rows(codes)? <= MAX_LISTED as f64)
}

/// Why a list cannot tell `codes`.
fn too_many_to_list(codes: &MissingCodes) -> Result<String, ModeError> {
    Ok(format!(
        "A list holds at most {MAX_LISTED} {}s; these codes give about {}.",
        listed_row(codes),
        listed_text(codes)?
    ))
}

/// Why `way` cannot tell `codes`; none where it can.
fn refusal_of(way: Way, codes: &MissingCodes) -> Result<Option<MarkedSearchError>, ModeError> {
    Ok(match way {
        Way::Encoded if !codes.checksummed() => Some(MarkedSearchError::NoChecksum),
        Way::List if !list_holds(codes)? => {
            Some(MarkedSearchError::TooManyToList(too_many_to_list(codes)?))
        }
        _ => None,
    })
}

/// Refuses to prepare `way` for `codes` where it cannot tell them.
fn check_fits(way: Way, codes: &MissingCodes) -> Result<(), MarkedSearchError> {
    refusal_of(way, codes)?.map_or(Ok(()), Err)
}

/// A way offered for codes, with the words a host shows for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WayChoice {
    /// The way.
    pub way: Way,
    /// The way's name in a list of choices.
    pub label: &'static str,
    /// What the way needs or does, shown beside its label.
    pub note: &'static str,
}

/// One candidate of a listed search: the codes, the phrase they give, and its fingerprint.
#[derive(Debug)]
pub struct MissingCodesRow {
    /// The codes written in their form, as encode writes them.
    pub codes: SecretText,
    /// The seed phrase that they give with the dates; its checksum is valid.
    pub phrase: Phrase,
    /// The master fingerprint of the phrase with an empty BIP39 passphrase.
    pub fingerprint: String,
}

/// The one set of codes that fits, with the dates it was decoded with, found or known.
#[derive(Debug)]
pub struct MissingCodesFound {
    /// The codes found, complete.
    pub backup: Backup,
    /// The complete dates that the codes decode with, known or found; none where the way needed no
    /// dates, and empty where the codes were not masked.
    pub dates: Option<Dates>,
    /// The dates as found by a search of their forgotten digits, as DD-MM-YYYY joined by spaces.
    pub found_dates: Option<SecretText>,
    /// How many other sets of codes and dates give the same phrase, which no wallet tells apart.
    pub others: Option<u64>,
    /// What the wallet check said of the match, such as that a fingerprint is only a filter.
    pub warning: Option<&'static str>,
}

/// What one way found.
#[derive(Debug)]
pub enum MissingCodesResult {
    /// One set of codes found.
    Found(Box<MissingCodesFound>),
    /// Every candidate, for the person to compare, a row for each phrase.
    List(Vec<MissingCodesRow>),
    /// No codes fit: what to check, as the way says it.
    None(&'static str),
    /// Several sets fit, which a fingerprint leaves only by chance: the wallet tells them apart.
    Several {
        /// How many sets of codes, or of codes and dates, fit: 2 or more.
        count: u64,
        /// That they fit and that the wallet tells which is the person's.
        message: String,
    },
    /// The host stopped the search: nothing found is told.
    Stopped,
}

/// That `count` sets of `what` fit, which the wallet tells apart.
fn several_sets(count: u64, what: &str) -> MissingCodesResult {
    MissingCodesResult::Several {
        count,
        message: format!(
            "{} of {what} fit; the wallet tells which is yours.",
            counted(count, "set")
        ),
    }
}

/// The search of codes marked with ?, for one set of codes.
#[derive(Clone, Debug)]
pub struct MissingCodesSearch {
    codes: MissingCodes,
}

impl MissingCodesSearch {
    /// The search of `codes`.
    pub const fn new(codes: MissingCodes) -> Self {
        Self { codes }
    }

    /// The codes.
    pub const fn codes(&self) -> &MissingCodes {
        &self.codes
    }

    /// The places of `codes` that cannot be read: "Code 6", "Codes 6 and 9"; "Words 10 and 11" for
    /// colours, whose marks leave words open, and "Words 1 and 2 or words 11 and 12" where their
    /// tags leave two placements open, of which one is right.
    pub fn places_text(codes: &MissingCodes) -> String {
        let name = codes.form().place_name();
        codes
            .placements()
            .iter()
            .enumerate()
            .map(|(placement, places)| {
                let named = places_named(name, places);
                if placement == 0 {
                    named
                } else {
                    lower_first(&named)
                }
            })
            .collect::<Vec<String>>()
            .join(" or ")
    }

    /// What cannot be read, and how many candidates that leaves.
    pub fn unreadable(&self) -> Result<String, ModeError> {
        let codes = &self.codes;
        // Where one set of codes gives several phrases, those too.
        let phrases = if codes.mode().gives_several() {
            let gives = if codes.expected() == 1 {
                "gives"
            } else {
                "give"
            };
            format!(", which {gives} about {}", listed_text(codes)?)
        } else {
            String::new()
        };
        Ok(format!(
            "{} cannot be read: {}, about {}{phrases}.",
            Self::places_text(codes),
            counted(codes.combinations(), "combination"),
            counted(codes.expected(), "candidate")
        ))
    }

    /// Whether so many candidates are left that only a fingerprint or an address tells them.
    pub fn many(&self) -> Result<bool, ModeError> {
        Ok(!list_holds(&self.codes)?)
    }

    /// The ways offered for the codes, in order, each where it is offered and it fits.
    pub fn ways(&self) -> Result<Vec<WayChoice>, ModeError> {
        let masked = self.codes.mode().masked();
        let mut ways = Vec::new();
        for way in Way::ALL {
            if way.offered(masked) && refusal_of(way, &self.codes)?.is_none() {
                ways.push(WayChoice {
                    way,
                    label: way.label(),
                    note: way.note(masked),
                });
            }
        }
        Ok(ways)
    }

    /// Why `way` cannot tell these codes when the person names it ahead, as an option does; none
    /// when it can. An estimate is no bound: a listed run also checks its actual size.
    pub fn why_not(&self, way: Way) -> Result<Option<String>, ModeError> {
        Ok(refusal_of(way, &self.codes)?.map(|refusal| refusal.to_string()))
    }

    /// Whether the dates of these codes are needed: they were masked.
    pub const fn needs_dates(&self) -> bool {
        self.codes.mode().masked()
    }

    /// The codes whose own fingerprint is `fingerprint`, the encoded one that Encode showed.
    pub fn by_encoded_fingerprint(
        &self,
        fingerprint: &str,
    ) -> Result<WaySearch, MarkedSearchError> {
        check_fits(Way::Encoded, &self.codes)?;
        let fingerprint = parse_master_fingerprint(fingerprint)?;
        Ok(WaySearch::new(
            self.codes.clone(),
            Test::Encoded { fingerprint },
            None,
        ))
    }

    /// The codes whose phrase, with `dates`, matches the wallet. Dates with forgotten digits are
    /// searched for each candidate of the codes, so that codes and dates are found together;
    /// without dates the codes were not masked.
    pub fn by_wallet(
        &self,
        wallet: Rc<WalletCheck>,
        dates: Option<Rc<DatesAnswer>>,
    ) -> Result<WaySearch, MarkedSearchError> {
        check_fits(Way::Wallet, &self.codes)?;
        match dates {
            Some(dates) if dates.has_forgotten_digits() => {
                if !self.codes.mode().masked() {
                    return Err(MarkedSearchError::NotMasked);
                }
                Ok(WaySearch::new(
                    self.codes.clone(),
                    Test::WalletAndDates(Box::new(WalletAndDates {
                        wallet,
                        dates,
                        current: None,
                        first: None,
                        phrases: Vec::new(),
                        sets: 0,
                    })),
                    Some(1),
                ))
            }
            dates => Ok(WaySearch::new(
                self.codes.clone(),
                Test::Wallet {
                    wallet,
                    dates: dates.map_or_else(|| Dates::new(&[]), |answer| answer.known().clone()),
                },
                None,
            )),
        }
    }

    /// Every candidate with its phrase, complete `dates` and fingerprint, at most 16 rows. Refuses
    /// at once codes whose estimated rows exceed it; a run refuses too if the actual count does.
    pub fn listed(&self, dates: &Dates) -> Result<WaySearch, MarkedSearchError> {
        check_fits(Way::List, &self.codes)?;
        Ok(WaySearch::new(
            self.codes.clone(),
            Test::List {
                dates: dates.clone(),
            },
            Some(MAX_LISTED),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dates::{Date, parse_date};
    use crate::forms::Form;
    use crate::modes::Mode;
    use crate::search::{Search, Step};
    use crate::wallet::evidence::Evidence;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn run(mut search: WaySearch) -> MissingCodesResult {
        while let Step::Running(_) = search.step(32).unwrap() {}
        search.finish()
    }

    /// The public phrase's codes in `mode`, the words at `places`, from 0, marked with ?.
    fn marked(mode: Mode, dates: &[Date], places: &[usize]) -> MissingCodes {
        let phrase = Phrase::parse(TWELVE).unwrap();
        let shifted = mode.encode(&phrase, dates).unwrap().shifted;
        let mut words = Form::English
            .codes(shifted.as_slice())
            .unwrap()
            .split(' ')
            .map(str::to_owned)
            .collect::<Vec<String>>();
        for &place in places {
            words[place] = "?".to_owned();
        }
        MissingCodes::read(&words.join(" "), Form::English, mode).unwrap()
    }

    #[test]
    fn the_ways_follow_the_codes() {
        let date = parse_date("23-09-2026").unwrap();
        let masked_codes = MissingCodesSearch::new(marked(Mode::Seedshift, &[date], &[11]));
        let ways: Vec<Way> = masked_codes
            .ways()
            .unwrap()
            .iter()
            .map(|choice| choice.way)
            .collect();
        assert_eq!(ways, [Way::Encoded, Way::Wallet]);
        assert!(masked_codes.many().unwrap());
        let plain = MissingCodesSearch::new(marked(Mode::Direct, &[], &[11]));
        let ways: Vec<Way> = plain
            .ways()
            .unwrap()
            .iter()
            .map(|choice| choice.way)
            .collect();
        assert_eq!(ways, [Way::Wallet]);
        assert_eq!(
            plain.unreadable().unwrap(),
            "Code 12 cannot be read: 2,048 combinations, about 128 candidates."
        );
    }

    #[test]
    fn the_wallet_tells_the_codes() {
        let codes = MissingCodesSearch::new(marked(Mode::Direct, &[], &[11]));
        let wallet = WalletCheck::new(Evidence::master_fingerprint("73c5da0a").unwrap(), "");
        let result = run(codes.by_wallet(Rc::new(wallet), None).unwrap());
        let MissingCodesResult::Found(found) = result else {
            panic!("no codes found");
        };
        assert_eq!(found.backup.text().unwrap().as_str(), TWELVE);
        assert!(found.warning.is_some());
    }

    #[test]
    fn codes_and_dates_are_found_together() {
        let date = parse_date("23-09-2026").unwrap();
        let codes = MissingCodesSearch::new(marked(Mode::Seedshift, &[date], &[11]));
        let wallet = WalletCheck::new(Evidence::master_fingerprint("73c5da0a").unwrap(), "");
        let dates = DatesAnswer::parse("2?-09-2026", Some(12), true).unwrap();
        let search = codes
            .by_wallet(Rc::new(wallet), Some(Rc::new(dates)))
            .unwrap();
        let result = run(search);
        let MissingCodesResult::Found(found) = result else {
            panic!("no codes found");
        };
        assert_eq!(found.found_dates.unwrap().as_str(), "23-09-2026");
        assert!(found.dates.is_some());
    }

    #[test]
    fn a_stopped_way_tells_nothing() {
        let codes = MissingCodesSearch::new(marked(Mode::Direct, &[], &[11]));
        let wallet = WalletCheck::new(Evidence::master_fingerprint("00000000").unwrap(), "");
        let mut search = codes.by_wallet(Rc::new(wallet), None).unwrap();
        assert!(matches!(search.step(4).unwrap(), Step::Running(_)));
        assert!(matches!(search.finish(), MissingCodesResult::Stopped));
    }

    #[test]
    fn no_list_holds_more_than_it_can() {
        let codes = MissingCodesSearch::new(marked(Mode::Direct, &[], &[11]));
        assert!(matches!(
            codes.listed(&Dates::new(&[])),
            Err(MarkedSearchError::TooManyToList(_))
        ));
        let few = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abo*";
        let few = MissingCodes::read(few, Form::English, Mode::Direct).unwrap();
        let codes = MissingCodesSearch::new(few);
        let MissingCodesResult::List(rows) = run(codes.listed(&Dates::new(&[])).unwrap()) else {
            panic!("no list");
        };
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].fingerprint, "73c5da0a");
    }
}

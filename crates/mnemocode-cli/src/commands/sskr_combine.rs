//! `mnemocode sskr-combine` (MnemoCode TS 0.1.0's `cli/sskr-restore-command.ts`): Shamir shares
//! typed or read back, repaired where marked, and the seed phrase restored with the dates and
//! checked with the wallet. With --ask-secrets each answer is checked as soon as it is given; what
//! the shares are, and the phrases they give, the library decides.

use std::fmt;
use std::rc::Rc;

use mnemocode::candidates::format::LIST_KEEP;
use mnemocode::dates::answer::DatesAnswer;
use mnemocode::modes::{DateWords, Mode};
use mnemocode::recovery::date_search::{MAX_SHOWN_MATCHES, MatchLimits};
use mnemocode::recovery::shares::flow::{PhrasesFound, RestoredPhrases, phrases_of};
use mnemocode::recovery::shares::unmasking::ShareUnmasking;
use mnemocode::recovery::shares::{
    SearchLimits, SharesRead, date_search_decision, several_sets_note,
};
use mnemocode::refusal::Refusal;
use mnemocode::search::{Search, Step as SearchStep};
use mnemocode::sskr::repair::report::{DateWork, NO_PHRASE_FITS};
use mnemocode::sskr::restore::ShareSet;
use mnemocode::sskr::typed::{ShareTrouble, TroubleKind};

use super::asking::{WHAT_NOW, or_back_or_cancel};
use super::backup_questions::{
    SHARE_SEEDSHIFT_QUESTION, share_seedshift_choices, show_encoded_fingerprint,
};
use super::candidates_file::CandidatesFile;
use super::date_search::{
    CHANGE_DATES_LABEL, DATES_AGAIN, PROGRESS_EVERY, ask_dates, max_candidates_of,
    wallet_explanation, with_date_progress,
};
use super::given::{DATES_OPTION, dates, transform_mode};
use super::restored_output::show_restored_phrases;
use super::searching::ask_to_search;
use super::share_repair::{
    FirstShare, TypedShares, ask_share_fix, assess_shares, mend_shares, search_limit,
    search_share_repair,
};
use super::wallet_options::{GivenWallet, given_wallet};
use super::wallet_question::{WalletAnswer, ask_wallet_evidence, change_wallet_answer};
use crate::args::{
    Given, Parsed, REPEATABLE_OPTIONS, assert_asked_not_given, assert_single_values, is_on, value,
};
use crate::gate::Stop;
use crate::terminal::{
    Choice, Chosen, Explanation, ListQuestion, NoticeKind, choose, lasting_warning, notice,
    seconds_of, step_begin,
};

/// The question when the shares that no phrase fits are to be changed.
const CHANGE_SHARES: &str = "Which shares to change?";

/// The options `sskr-combine` takes.
pub(crate) const OPTIONS: [&str; 28] = [
    "share",
    "share-file",
    "share-qr",
    "ask-secrets",
    "mode",
    "date",
    "dates-file",
    "bitcoin-address",
    "coin-address",
    "master-xpub",
    "account-xpub",
    "compressed-public-key",
    "master-fingerprint",
    "wif-file",
    "coin",
    "network",
    "account",
    "branch",
    "index",
    "scan-gap",
    "bip39-passphrase-file",
    "max-tries",
    "max-candidates",
    "candidates-file",
    "candidates-key",
    "candidates-key-file",
    "candidates-passphrase-file",
    "plaintext-candidates",
];

/// The refusals of a restore where nothing can be asked: each in the words of the library.
#[derive(Debug)]
enum RestoreRefused {
    /// The dates cannot be used.
    Dates(String),
    /// The phrases were refused.
    After(String),
    /// A search of marked shares found nothing, or was not started.
    Phrases(String),
    /// No phrase is the wallet's.
    Mismatch(String),
    /// Too few shares.
    Few,
}

impl fmt::Display for RestoreRefused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Dates(text) | Self::After(text) | Self::Phrases(text) | Self::Mismatch(text) => {
                f.write_str(text)
            }
            Self::Few => f.write_str("Too few shares to restore the phrase."),
        }
    }
}

impl std::error::Error for RestoreRefused {}

impl Refusal for RestoreRefused {
    fn code(&self) -> &'static str {
        match self {
            Self::Dates(_) => "cli.sskr-restore-command.ask-share-dates-refused",
            Self::After(_) => "cli.sskr-restore-command.after-refused-refused",
            Self::Phrases(_) => "cli.sskr-restore-command.restore-phrases-refused",
            Self::Mismatch(_) => "cli.sskr-restore-command.after-mismatch-refused",
            Self::Few => "cli.sskr-restore-command.too-few-shares-restore-phrase",
        }
    }
}

/// The answers of a restore of shares: read and checked before the first question, then answered
/// on the private screen. What the answers give, and the steps of the restore, the library decides.
#[derive(Debug)]
pub(crate) struct Recovery {
    /// Whether the shares are asked on the private screen, so that a problem is asked about.
    pub(crate) interactive: bool,
    /// Changed on the private screen when the person says that Seedshift was, or was not, used.
    pub(crate) mode: Mode,
    /// How far a search goes without a question.
    pub(crate) limits: SearchLimits,
    /// The wallet, given or asked on the private screen, and the owner of the BIP39 passphrase.
    pub(crate) wallet: GivenWallet,
    /// Whether a candidate list is saved, for which every date match is kept.
    pub(crate) listing: bool,
    pub(crate) shares: TypedShares,
    /// The dates of a Seedshift phrase: given with the options, or asked once the shares are read.
    pub(crate) dates: Option<Rc<DatesAnswer>>,
}

/// What a restore settles before the shares.
#[derive(Debug)]
pub(crate) struct RecoverySettings {
    pub(crate) interactive: bool,
    pub(crate) mode: Mode,
    pub(crate) limits: SearchLimits,
    pub(crate) wallet: GivenWallet,
    pub(crate) dates: Option<Rc<DatesAnswer>>,
}

impl RecoverySettings {
    /// The restore of `shares`.
    pub(crate) fn with_shares(self, shares: TypedShares, listing: bool) -> Recovery {
        Recovery {
            interactive: self.interactive,
            mode: self.mode,
            limits: self.limits,
            wallet: self.wallet,
            listing,
            shares,
            dates: self.dates,
        }
    }
}

/// Direct mode or checksum-valid Seedshift, the two modes in which shares are made.
fn share_mode(parsed: &Parsed) -> Result<Mode, Stop> {
    let mode = transform_mode(parsed, None)?;
    mode.check_split()?;
    Ok(mode)
}

/// Reads and checks the options that a restore uses, before any question: the mode, the dates, the
/// wallet and where it is looked for, the BIP39 passphrase and --max-tries.
pub(crate) fn recovery_settings(parsed: &Parsed) -> Result<RecoverySettings, Stop> {
    let mode = share_mode(parsed)?;
    let interactive = is_on(parsed, "ask-secrets");
    // Dates are secret: with --ask-secrets they are asked on the private screen, as every command
    // that takes them does, and never also taken from the command line.
    assert_asked_not_given(parsed, &[DATES_OPTION, "dates-file"])?;
    let given = dates(parsed)?;
    mode.check_date_count(given.len(), interactive, DateWords::Recovery)?;
    let wallet = given_wallet(parsed)?;
    let limits = SearchLimits {
        shares: search_limit(parsed)?,
        dates: max_candidates_of(parsed)?,
    };
    let dates = (!given.is_empty()).then(|| Rc::new(DatesAnswer::of(&given)));
    Ok(RecoverySettings {
        interactive,
        mode,
        limits,
        wallet,
        dates,
    })
}

/// The phrases of a restore, with the places of their shares among those typed, by their index in a
/// set.
#[derive(Debug)]
pub(crate) struct PhrasesAt {
    pub(crate) found: PhrasesFound,
    pub(crate) places: Vec<usize>,
}

/// What [`restore_phrases`] gives.
#[derive(Debug)]
pub(crate) enum Restoring {
    Phrases(PhrasesAt),
    /// Too few shares, which the caller deals with.
    Few,
}

/// What a use of restored phrases leads to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RestoredNext {
    Done,
    /// The shares are kept and their dates asked again.
    Dates,
    /// The input is changed.
    Back,
}

/// What a restore started from another command's question gave.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Restored {
    Done,
    Back,
}

/// How a restore deals with too few shares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AfterFew {
    /// More shares were added.
    Again,
    /// The shares go back to the caller.
    Few,
}

/// How [`restore_phrases`] deals with what differs between restoring and exporting shares.
pub(crate) struct RestoreRules {
    /// After too few shares.
    pub(crate) few: fn(&mut Recovery, ShareTrouble) -> Result<AfterFew, Stop>,
    /// Whether several phrases, without a wallet, ask for one to tell the right set.
    pub(crate) one: bool,
}

/// Asks for the dates of a Seedshift phrase of `words` words, ? standing for a forgotten digit,
/// until they can be used. Without a private screen the dates must have been given.
fn ask_share_dates(r: &Recovery, words: Option<usize>) -> Result<DatesAnswer, Stop> {
    // Off the private screen the settings refused a masked mode without dates, so the dates given
    // can only be too many for the phrase.
    if !r.interactive {
        let too_many = r.dates.as_ref().and_then(|dates| dates.too_many_for(words));
        return Err(RestoreRefused::Dates(too_many.unwrap_or_default()).into());
    }
    ask_dates(words, true, None, |_| Ok(()))
}

/// How the sets of this restore become seed phrases: with its mode, its dates and the wallet,
/// keeping every date match for a candidate list.
fn unmasking_of(r: &Recovery) -> Result<ShareUnmasking, Stop> {
    Ok(ShareUnmasking::new(
        r.mode,
        r.dates.clone(),
        r.wallet.check.clone(),
        MatchLimits {
            max_shown: Some(MAX_SHOWN_MATCHES),
            keep: r.listing.then_some(LIST_KEEP as u64),
        },
    )?)
}

/// The date search that each phrase of the shares needs, for its time: none without dates with ?.
fn date_work(r: &Recovery) -> Result<Option<DateWork>, Stop> {
    let unmasking = unmasking_of(r)?;
    let seconds = (0..unmasking.pace_parts())
        .map(|part| seconds_of(|| unmasking.pace_sample(part)))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(unmasking.date_work(&seconds)?)
}

/// The phrases of `sets` whose wallet matches the one given, if any: the set's own phrase, or the
/// phrase that the dates unmask, searched where a date holds ? while Ctrl+C is read as a key, on a
/// step screen of its own with `told` first, if any; or why the dates do not fit, or why none is
/// the wallet's.
fn unmasked(
    r: &Recovery,
    sets: &[Rc<ShareSet>],
    places: &[usize],
    told: Option<&str>,
) -> Result<RestoredPhrases, Stop> {
    let unmasking = unmasking_of(r)?;
    let combinations = unmasking.searched_combinations();
    let searches = unmasking.searches();
    let mut search = unmasking.unmask(sets.to_vec());
    if searches {
        // The search is a step of its own: its screen no longer shows the question before it.
        step_begin();
        if let Some(told) = told {
            notice(told, NoticeKind::Info);
        }
        with_date_progress(&mut search, PROGRESS_EVERY)?;
    } else {
        while let SearchStep::Running(_) = search.step(u32::MAX)? {}
    }
    Ok(phrases_of(
        search.finish(),
        sets.len(),
        combinations,
        places,
    ))
}

/// What is asked next while restoring.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Step {
    Shares,
    Dates,
    Wallet,
    Search,
}

/// Shows the fingerprint of the masked phrase that complete shares restore, before any date is
/// typed: the split showed it as the encoded fingerprint, so a share typed wrong shows here as
/// another fingerprint, before the dates, as decode shows it for typed codes.
fn show_set_fingerprint(set: &ShareSet) {
    let fingerprint = set.fingerprint().map(mnemocode::bip32::fingerprint_hex);
    show_encoded_fingerprint(fingerprint.as_deref());
}

/// The step after the shares of a phrase of `words` words: its dates where none were given or more
/// than the phrase takes, which the person is told; otherwise the wallet.
fn step_after_shares(r: &Recovery, words: Option<usize>) -> Step {
    // Dates typed or given before the word count was known may be more than the phrase takes.
    let too_many = r.dates.as_ref().and_then(|dates| dates.too_many_for(words));
    if r.interactive
        && let Some(text) = &too_many
    {
        notice(text, NoticeKind::Warning);
    }
    if r.mode.masked() && (r.dates.is_none() || too_many.is_some()) {
        Step::Dates
    } else {
        Step::Wallet
    }
}

/// The wallet, asked when the date search needs it and none was given: the step after it, the
/// search, or the dates at Escape.
fn wallet_for_search(r: &mut Recovery) -> Result<Step, Stop> {
    if !unmasking_of(r)?.needs_wallet() || r.wallet.check.is_some() {
        return Ok(Step::Search);
    }
    let explanation = wallet_explanation(Some(r.mode), None);
    match ask_wallet_evidence(false, Some(&explanation), &r.wallet.place)? {
        WalletAnswer::Back => Ok(Step::Dates),
        WalletAnswer::Wallet(evidence) => {
            r.wallet.set_evidence(Some(evidence));
            Ok(Step::Search)
        }
        WalletAnswer::None => Ok(Step::Search),
    }
}

/// Several sets fit, and nothing tells the right one: the wallet does, without a new search.
/// Whether a wallet was given.
fn wallet_for_several(r: &mut Recovery, sets: usize) -> Result<bool, Stop> {
    let explanation = Explanation {
        lines: vec![several_sets_note(sets)],
        more: Vec::new(),
    };
    match ask_wallet_evidence(true, Some(&explanation), &r.wallet.place)? {
        WalletAnswer::Wallet(evidence) => {
            r.wallet.set_evidence(Some(evidence));
            Ok(true)
        }
        WalletAnswer::None | WalletAnswer::Back => Ok(false),
    }
}

/// The step that takes the sets that fit the shares: their phrases with the dates and the wallet,
/// or the step that comes next. Where several sets fit, nothing tells the right one and `one` asks
/// for one, the wallet is asked on the private screen: a wallet given searches the sets again with
/// it, and "It cannot" keeps every set.
fn phrases_of_sets(
    r: &mut Recovery,
    sets: &[Rc<ShareSet>],
    places: &[usize],
    told: Option<&str>,
    one: bool,
) -> Result<Result<PhrasesAt, Step>, Stop> {
    let found = match unmasked(r, sets, places, told)? {
        // The person stopped the date search with Ctrl+C.
        RestoredPhrases::Stopped => return Err(Stop::Cancelled),
        RestoredPhrases::Mismatch(message) => return after_mismatch(r, &message).map(Err),
        RestoredPhrases::Dates(message) => {
            if !r.interactive {
                return Err(RestoreRefused::After(message).into());
            }
            notice(&message, NoticeKind::Warning);
            return Ok(Err(Step::Dates));
        }
        RestoredPhrases::Phrases(found) => found,
    };
    let places = places.to_vec();
    let restored = PhrasesAt { found, places };
    let several = restored.found.sets.len();
    if !(one && several > 1 && r.wallet.check.is_none() && r.interactive) {
        return Ok(Ok(restored));
    }
    if wallet_for_several(r, several)? {
        return Ok(Err(Step::Search));
    }
    Ok(Ok(restored))
}

/// What a restore holds of the shares once they were read.
#[derive(Debug, Default)]
struct SharesInHand {
    /// Marked shares that the search takes, or none for complete shares.
    marked: Option<mnemocode::recovery::shares::MarkedShares>,
    /// The sets that fit.
    sets: Option<Vec<Rc<ShareSet>>>,
    places: Vec<usize>,
    words: Option<usize>,
    /// Whether the encoded fingerprint of the set restored was shown.
    encoded_shown: bool,
}

impl SharesInHand {
    /// Shows it once for complete shares of a Seedshift phrase, before its dates, on the private
    /// screen only, as decode does: from the command line the dates are given, and nothing is
    /// asked. Marked shares restore their phrases only in the search, after the dates.
    fn show_encoded(&mut self, r: &Recovery) {
        if !r.interactive || !r.mode.masked() || self.encoded_shown || self.marked.is_some() {
            return;
        }
        if let Some(set) = self.sets.as_ref().and_then(|sets| sets.first()) {
            show_set_fingerprint(set);
            self.encoded_shown = true;
        }
    }

    /// Takes what the shares gave; a trouble is what is left to mend.
    fn read(&mut self, r: &mut Recovery, read: SharesRead) -> Result<Option<ShareTrouble>, Stop> {
        self.places = r.shares.places();
        self.encoded_shown = false;
        match read {
            SharesRead::Trouble { trouble, .. } => return Ok(Some(trouble)),
            SharesRead::Complete(complete) => {
                self.marked = None;
                self.words = Some(complete.set.word_count());
                self.sets = Some(vec![Rc::new(complete.set)]);
                if let Some(unchecked) = &complete.unchecked {
                    lasting_warning(unchecked);
                }
                self.show_encoded(r);
            }
            SharesRead::Marked(marked) => {
                self.words = marked.word_count()?;
                self.marked = Some(marked);
                self.sets = None;
            }
        }
        Ok(None)
    }
}

/// One turn of the search step, which finds the sets or says what comes next.
fn searched_sets(
    r: &mut Recovery,
    hand: &mut SharesInHand,
) -> Result<Result<Option<String>, Step>, Stop> {
    if hand.sets.is_some() {
        let Some(work) = date_work(r)? else {
            return Ok(Ok(None));
        };
        let phrases = hand.sets.as_ref().map_or(0, Vec::len) as u64;
        let decision = date_search_decision(work, phrases, r.limits);
        let Some(question) = decision.question else {
            return Ok(Ok(decision.notice));
        };
        return Ok(if ask_to_search(&question, DATES_AGAIN)? {
            Ok(None)
        } else {
            Err(Step::Dates)
        });
    }
    let work = date_work(r)?;
    let Some(marked) = hand.marked.take() else {
        return Ok(Err(Step::Shares));
    };
    let found = search_share_repair(marked, r.limits, work)?;
    match found {
        Some(sets) if !sets.is_empty() => {
            hand.sets = Some(sets.into_iter().map(Rc::new).collect());
            Ok(Ok(None))
        }
        found => {
            let searched = found.is_some();
            // Shares given with the options cannot be typed again here.
            let problem = if searched {
                NO_PHRASE_FITS
            } else {
                "The search was not started."
            };
            if !r.interactive {
                return Err(RestoreRefused::Phrases(problem.to_owned()).into());
            }
            if searched {
                notice(problem, NoticeKind::Warning);
            }
            // Escape here is Stop: a search that found nothing has no question to go back to, and
            // the search question, whose own Escape leads here, would be asked without end once
            // the input has ended.
            ask_share_fix(&mut r.shares, Some(CHANGE_SHARES), false)?;
            Ok(Err(Step::Shares))
        }
    }
}

/// Restores the phrases that the shares hold, asked in this order on the private screen, each
/// answer checked at once: the shares, the dates of a Seedshift phrase, with ? for forgotten
/// digits, the wallet when a date search needs it, then the search of marked shares and of the
/// dates, and the wallet check. A result that cannot be used offers what to change; the other
/// answers, and the phrases already found, are kept. Without a private screen the first problem
/// ends the command.
pub(crate) fn restore_phrases(r: &mut Recovery, rules: &RestoreRules) -> Result<Restoring, Stop> {
    let mut hand = SharesInHand::default();
    let mut step = Step::Shares;
    loop {
        step = match step {
            Step::Shares => {
                let read = assess_shares(&mut r.shares)?;
                match hand.read(r, read)? {
                    None => step_after_shares(r, hand.words),
                    Some(trouble) if trouble.kind == TroubleKind::Few => {
                        if (rules.few)(r, trouble)? == AfterFew::Few {
                            return Ok(Restoring::Few);
                        }
                        Step::Shares
                    }
                    Some(trouble) => {
                        mend_shares(&mut r.shares, trouble, r.interactive)?;
                        Step::Shares
                    }
                }
            }
            Step::Dates => {
                // Also after "It was masked with Seedshift", which comes here.
                hand.show_encoded(r);
                r.dates = Some(Rc::new(ask_share_dates(r, hand.words)?));
                Step::Wallet
            }
            Step::Wallet => wallet_for_search(r)?,
            Step::Search => match searched_sets(r, &mut hand)? {
                Err(next) => next,
                Ok(told) => {
                    let sets = hand.sets.clone().unwrap_or_default();
                    let places = hand.places.clone();
                    match phrases_of_sets(r, &sets, &places, told.as_deref(), rules.one)? {
                        Ok(restored) => return Ok(Restoring::Phrases(restored)),
                        Err(next) => next,
                    }
                }
            },
        };
    }
}

/// Takes the other of the two modes in which shares are made, after the person said that the phrase
/// was, or was not, masked with Seedshift before splitting: the menu asks that before the shares,
/// and a wrong answer there shows only as a wallet that nothing matches. The phrases found are kept;
/// a masked one needs its dates.
fn other_mode(r: &mut Recovery) -> Step {
    if r.mode.masked() {
        r.mode = Mode::Direct;
        r.dates = None;
        return Step::Search;
    }
    r.mode = Mode::Seedshift;
    Step::Dates
}

/// What can be changed after a wallet that nothing matched.
#[derive(Clone, Copy)]
enum AfterMismatch {
    Dates,
    Wallet,
    Shares,
    Mode,
}

/// After phrases of which none matches the wallet given: says so, and asks what to change, the
/// dates, the wallet, the shares or whether Seedshift was used; Stop cancels. Escape at the wallet
/// or share question that follows comes back here. Without a private screen the mismatch ends the
/// command.
fn after_mismatch(r: &mut Recovery, message: &str) -> Result<Step, Stop> {
    if !r.interactive {
        return Err(RestoreRefused::Mismatch(message.to_owned()).into());
    }
    notice(message, NoticeKind::Warning);
    loop {
        let masked = r.mode.masked();
        let mut choices = Vec::new();
        if masked {
            choices.push(Choice::new(CHANGE_DATES_LABEL, AfterMismatch::Dates));
        }
        choices.push(change_wallet_answer(AfterMismatch::Wallet));
        choices.push(Choice::noted(
            "Change a share",
            "or add more",
            AfterMismatch::Shares,
        ));
        choices.push(if masked {
            Choice::noted(
                "It was not masked with Seedshift",
                "no dates",
                AfterMismatch::Mode,
            )
        } else {
            Choice::noted(
                "It was masked with Seedshift",
                "type its dates",
                AfterMismatch::Mode,
            )
        });
        let next = or_back_or_cancel(WHAT_NOW, &choices, false)?;
        match next {
            None => {}
            Some(AfterMismatch::Dates) => return Ok(Step::Dates),
            Some(AfterMismatch::Mode) => return Ok(other_mode(r)),
            Some(AfterMismatch::Shares) => {
                if ask_share_fix(&mut r.shares, Some(CHANGE_SHARES), true)? {
                    return Ok(Step::Shares);
                }
            }
            Some(AfterMismatch::Wallet) => {
                if let WalletAnswer::Wallet(evidence) =
                    ask_wallet_evidence(false, None, &r.wallet.place)?
                {
                    r.wallet.set_evidence(Some(evidence));
                    return Ok(Step::Search);
                }
            }
        }
    }
}

/// Uses the original phrases after restoration and Seedshift removal, without printing them on
/// standard output. Every phrase still needs confirmation by the caller: a valid checksum does not
/// identify the wallet.
pub(crate) type RestoredUse<'a> =
    &'a mut dyn FnMut(&PhrasesAt, Mode, &GivenWallet) -> Result<RestoredNext, Stop>;

/// The restore from Shamir shares on the private screen, after shares were typed where Decode or
/// Re-encode asked for the codes: every share is kept, and any more needed are asked for. Shares are
/// made with Seedshift or without; Decode's mode tells which where it is one of the two, or it is
/// asked. `handed` are the options that a restore takes too.
pub(crate) fn restore_from_share(
    handed: &Parsed,
    share: FirstShare,
    purpose: Option<RestoredUse<'_>>,
) -> Result<Restored, Stop> {
    let named = value(handed, "mode").and_then(|name| Mode::named(name).ok());
    let mode = match named.filter(|mode| mode.check_split().is_ok()) {
        Some(mode) => mode,
        None => {
            let asked = ListQuestion {
                question: SHARE_SEEDSHIFT_QUESTION,
                label: "Seedshift",
                quit: "goes back",
                explanation: None,
            };
            match choose(&asked, None, &share_seedshift_choices())? {
                Chosen::One(mode) => mode,
                Chosen::Back => return Ok(Restored::Back),
                Chosen::Cancelled => return Err(Stop::Cancelled),
            }
        }
    };
    let mut options = handed.clone();
    options.insert("ask-secrets".to_owned(), Given::On);
    options.remove("mode");
    if mode.masked() {
        options.insert("mode".to_owned(), Given::One(mode.id().to_owned()));
    }
    use_restored_shares(&options, Some(&share), purpose)
}

/// Runs the command.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    use_restored_shares(parsed, None, None).map(|_| ())
}

/// After too few shares: more are asked for, or the problem ends the command.
fn few_for_restore(r: &mut Recovery, trouble: ShareTrouble) -> Result<AfterFew, Stop> {
    mend_shares(&mut r.shares, trouble, r.interactive)?;
    Ok(AfterFew::Again)
}

/// Owns the same share and date recovery for Decode, Restore and Re-encode.
fn use_restored_shares(
    parsed: &Parsed,
    first: Option<&FirstShare>,
    mut purpose: Option<RestoredUse<'_>>,
) -> Result<Restored, Stop> {
    // Again for the menu, which runs the command without the command line's checks.
    assert_single_values(parsed, &REPEATABLE_OPTIONS)?;
    let settings = recovery_settings(parsed)?;
    let mut target = CandidatesFile::of(parsed)?;
    if target.is_some() {
        CandidatesFile::check_listable(settings.wallet.passphrase())?;
    }
    let shares = match first {
        Some(first) => TypedShares::starting_with(first)?,
        None => TypedShares::read(parsed)?,
    };
    let mut r = settings.with_shares(shares, target.is_some());
    if let Some(target) = &mut target {
        target.prepare(r.wallet.passphrase())?;
    }
    let rules = RestoreRules {
        few: few_for_restore,
        one: purpose.is_some(),
    };
    loop {
        let restored = match restore_phrases(&mut r, &rules)? {
            Restoring::Phrases(restored) => restored,
            Restoring::Few => return Err(RestoreRefused::Few.into()),
        };
        if let Some(purpose) = &mut purpose {
            match purpose(&restored, r.mode, &r.wallet)? {
                RestoredNext::Done => return Ok(Restored::Done),
                RestoredNext::Back => return Ok(Restored::Back),
                RestoredNext::Dates => {
                    r.dates = None;
                    continue;
                }
            }
        }
        show_restored_phrases(&restored, &r)?;
        if let Some(target) = &mut target {
            target.save_phrases(&restored.found.listed, r.wallet.passphrase())?;
        }
        return Ok(Restored::Done);
    }
}

//! Saves the candidates of a recovery as a candidate list (MnemoCode TS 0.1.0's
//! `cli/candidates-file.ts`, docs/CANDIDATES.md): record N is candidate N on the screen. The
//! Discovery Scanner of the multi-chain wallet tools imports it and checks every candidate online.
//! The list holds real seed phrases, and when the recovery is right, the wallet's own, so it is
//! encrypted: to the Scanner's one-time key, or under a passphrase. Without either only on explicit
//! request. The list, its limit, its protection and the passphrase rule are the library's; this
//! module reads the options and files, asks on the private screen, writes the file and says what
//! happened. It also asks where a list goes and how it is encrypted.

use std::fmt;
use std::path::Path;

use mnemocode::bip39::phrase::Phrase;
use mnemocode::candidates::age::{EncryptionError, Recipient};
use mnemocode::candidates::format::{ListError, check_list_passphrase};
use mnemocode::candidates::gate::Gate;
use mnemocode::candidates::protection::{
    MIN_LIST_PASSPHRASE_LENGTH, Protection, parse_list_passphrase,
};
use mnemocode::candidates::writer::{ListOutcome, NO_CANDIDATE_TO_SAVE, WriteError, Writer};
use mnemocode::refusal::Refusal;
use mnemocode::search::plan::counted;
use mnemocode::secret::{SecretBytes, SecretText};

use super::asking::secret_until;
use super::given::PATH_LIMIT;
use super::output_questions::{ask_output_file, forget_claimed};
use super::saving::{ResultName, save_output};
use crate::args::{Parsed, is_on, option_label, value};
use crate::gate::Stop;
use crate::input::{read_input_path, secret_ask};
use crate::os::{self, SystemRandom};
use crate::output::{check_new_file, discard_renamed};
use crate::terminal::{
    Choice, Chosen, LineQuestion, ListQuestion, NoticeKind, ask_line, choose, lasting_warning,
    notice, on_private_screen, printable, saved,
};

/// How any search is narrowed when its candidates are more than a list holds.
const NARROW_ANY_SEARCH: &str = "narrow the search, or give the wallet's fingerprint";
/// What the passphrase of a list is, for the questions.
const LIST_PASSPHRASE_ROLE: &str =
    "candidate list encryption passphrase (not the BIP39 passphrase)";

/// How a candidate list is protected; each needs --candidates-file.
const CANDIDATE_PROTECTION_OPTIONS: [&str; 4] = [
    "candidates-key",
    "candidates-key-file",
    "candidates-passphrase-file",
    "plaintext-candidates",
];

/// The refusals of a candidate list's options.
#[derive(Debug)]
enum CandidatesError {
    OneProtection,
    NoProtection,
    NoFile,
    NoPassphrase,
}

impl fmt::Display for CandidatesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::OneProtection => {
                "Choose one protection for the candidates: the Scanner's key, a passphrase, or none."
            }
            Self::NoProtection => {
                "Protect the candidates with --candidates-key (the Scanner's age1 key), --candidates-key-file or --candidates-passphrase-file; --plaintext-candidates writes them without encryption."
            }
            Self::NoFile => "Give --candidates-file to save candidates.",
            Self::NoPassphrase => {
                "Give the passphrase for the candidates with --candidates-passphrase-file."
            }
        })
    }
}

impl std::error::Error for CandidatesError {}

impl Refusal for CandidatesError {
    fn code(&self) -> &'static str {
        match self {
            Self::OneProtection => {
                "cli.candidates-file.choose-one-protection-candidates-scanner-s-key-passphrase"
            }
            Self::NoProtection => {
                "cli.candidates-file.protect-candidates-candidates-key-scanner-s-age1-key"
            }
            Self::NoFile => "cli.candidates-file.give-candidates-file-save-candidates",
            Self::NoPassphrase => {
                "cli.candidates-file.give-passphrase-candidates-candidates-passphrase-file"
            }
        }
    }
}

/// The protection chosen with the options; none when, on the private screen, a passphrase is asked
/// later.
fn protection_of(parsed: &Parsed, gate: &mut Gate) -> Result<Option<Protection>, Stop> {
    let key = value(parsed, "candidates-key");
    let key_file = value(parsed, "candidates-key-file");
    let passphrase_file = value(parsed, "candidates-passphrase-file");
    let plaintext = is_on(parsed, "plaintext-candidates");
    let given = [key, key_file, passphrase_file].iter().flatten().count();
    if given + usize::from(plaintext) > 1 {
        return Err(CandidatesError::OneProtection.into());
    }
    if let Some(key) = key {
        gate.ready()?;
        return Ok(Some(Protection::key(key)?));
    }
    if let Some(path) = key_file {
        gate.ready()?;
        let text = read_input_path(Path::new(path), "The Scanner's key file", PATH_LIMIT, false)?;
        return Ok(Some(Protection::key(&text)?));
    }
    if let Some(path) = passphrase_file {
        gate.ready()?;
        let text = read_input_path(Path::new(path), "The passphrase file", PATH_LIMIT, false)?;
        return Ok(Some(Protection::passphrase(&text)?));
    }
    if plaintext {
        return Ok(Some(Protection::None));
    }
    if is_on(parsed, "ask-secrets") {
        return Ok(None);
    }
    Err(CandidatesError::NoProtection.into())
}

/// The answer, with `value`, that stops after a search that found more candidates than a list
/// holds: the list is not saved.
pub(crate) fn stop_without_list_answer<T>(value: T) -> Choice<T> {
    Choice::noted("Stop", "no list is saved", value)
}

/// How a list is to be encrypted.
#[derive(Clone, Copy)]
enum ListProtection {
    Key,
    Passphrase,
}

/// Asks where a candidate list goes, a file checked at once, and how it is encrypted: to the
/// Scanner's key, checked at once, or with a passphrase, which the command asks on its private
/// screen. The answers as the options of the command; none when the person goes back with Escape.
pub(crate) fn ask_candidate_list() -> Result<Option<Vec<String>>, Stop> {
    forget_claimed();
    let Some(path) = ask_output_file("File name", "candidates.age")? else {
        return Ok(None);
    };
    let asked = ListQuestion {
        question: "How should the list be encrypted?",
        label: "Protect",
        quit: "goes back",
        explanation: None,
    };
    let choices = [
        Choice::noted(
            "The Scanner's key",
            "paste the age1 key the Scanner shows",
            ListProtection::Key,
        ),
        Choice::noted(
            "A passphrase",
            "asked next; for a list made in advance",
            ListProtection::Passphrase,
        ),
    ];
    let protection = match choose(&asked, None, &choices)? {
        Chosen::One(protection) => protection,
        Chosen::Back => return Ok(None),
        Chosen::Cancelled => return Err(Stop::Cancelled),
    };
    let mut options = vec!["--candidates-file".to_owned(), path];
    if matches!(protection, ListProtection::Key) {
        let how = LineQuestion {
            what: Some("the age1 key that the Scanner shows"),
            limit: PATH_LIMIT,
            ..LineQuestion::default()
        };
        let parse = |text: &str| Recipient::parse(text).map(|_| text.to_owned());
        match ask_line(option_label("candidates-key"), "Key", how, parse)? {
            Chosen::One(key) => options.extend(["--candidates-key".to_owned(), key]),
            Chosen::Back => return Ok(None),
            Chosen::Cancelled => return Err(Stop::Cancelled),
        }
    }
    Ok(Some(options))
}

/// The passphrase for a list, asked twice on the private screen until both agree.
fn ask_list_passphrase(gate: &mut Gate) -> Result<Protection, Stop> {
    if !on_private_screen() {
        return Err(CandidatesError::NoPassphrase.into());
    }
    gate.ready()?;
    let limit = PATH_LIMIT;
    let first_what = format!("a passphrase of at least {MIN_LIST_PASSPHRASE_LENGTH} characters");
    let first_ask = secret_ask(
        &format!("Enter the {LIST_PASSPHRASE_ROLE}:"),
        &first_what,
        limit,
    );
    let again_ask = secret_ask(
        &format!("Repeat the {LIST_PASSPHRASE_ROLE}:"),
        "the same passphrase again",
        limit,
    );
    loop {
        let first: SecretText = secret_until(&first_ask, parse_list_passphrase)?;
        let again: SecretText = secret_until(&again_ask, |answer: &str| {
            Ok::<_, EncryptionError>(SecretText::copy_of("a list's passphrase", answer))
        })?;
        if mnemocode::secret::equal_bytes(first.as_str().as_bytes(), again.as_str().as_bytes()) {
            return Ok(Protection::Passphrase(first));
        }
        // Either of the two may be the mistyped one, so both are asked again.
        notice(
            "The two passphrases differ: type both again.",
            NoticeKind::Warning,
        );
    }
}

/// The candidate list to save: where it goes and how it is protected, settled before any secret is
/// asked, and written once a search found its phrases. The protection may be asked later, once, on
/// the private screen, and every save then uses the same writer, which owns the list itself.
#[derive(Debug)]
pub(crate) struct CandidatesFile {
    /// The options of the command, whose other outputs another name is checked against.
    parsed: Parsed,
    path: String,
    protection: Option<Protection>,
    writer: Option<Writer>,
    gate: Gate,
}

impl CandidatesFile {
    /// The candidates file given, and its protection, checked before any secret is asked.
    pub(crate) fn of(parsed: &Parsed) -> Result<Option<Self>, Stop> {
        let Some(path) = value(parsed, "candidates-file") else {
            if CANDIDATE_PROTECTION_OPTIONS
                .iter()
                .any(|key| parsed.contains_key(*key))
            {
                return Err(CandidatesError::NoFile.into());
            }
            return Ok(None);
        };
        check_new_file(path, false)?;
        let mut gate = Gate::new();
        let protection = protection_of(parsed, &mut gate)?;
        Ok(Some(Self {
            parsed: parsed.clone(),
            path: path.to_owned(),
            protection,
            writer: None,
            gate,
        }))
    }

    /// Refuses, before any question, a BIP39 passphrase that a list could not hold: otherwise this
    /// would show only after the secrets were typed.
    pub(crate) fn check_listable(passphrase: &str) -> Result<(), ListError> {
        check_list_passphrase(passphrase)
    }

    /// Settles what the list needs before a search can take long: the passphrase, asked twice on
    /// the private screen when no file gave it, and the BIP39 passphrase that the list would hold.
    /// A short passphrase, or two that differ, is asked again without a limit, so that it does not
    /// lose a finished search; only Ctrl+C leaves.
    pub(crate) fn prepare(&mut self, passphrase: &str) -> Result<(), Stop> {
        if self
            .writer
            .as_ref()
            .is_some_and(|writer| writer.uses_passphrase(passphrase))
        {
            return Ok(());
        }
        Self::check_listable(passphrase)?;
        self.writer = Some(match self.writer.take() {
            Some(writer) => writer.with_passphrase(passphrase)?,
            None => {
                let protection = match self.protection.take() {
                    Some(protection) => protection,
                    None => ask_list_passphrase(&mut self.gate)?,
                };
                Writer::new(protection, passphrase)?
            }
        });
        Ok(())
    }

    /// For a list that is not saved after all, such as one of more candidates than a list holds:
    /// says so, and the numbered name it was given is not reported.
    pub(crate) fn discard(&self) {
        discard_renamed(&self.path);
        lasting_warning("No list was saved; no file was written.");
    }

    /// After a search that found no candidate: nothing is saved, which is said.
    pub(crate) fn save_nothing(&self) {
        discard_renamed(&self.path);
        lasting_warning(NO_CANDIDATE_TO_SAVE);
    }

    /// Saves `phrases`, English BIP39 phrases in their order, with `passphrase` for all.
    pub(crate) fn save_phrases(
        &mut self,
        phrases: &[Phrase],
        passphrase: &str,
    ) -> Result<(), Stop> {
        self.written(passphrase, |writer, gate| {
            writer.write_phrases(phrases, gate, &mut SystemRandom)
        })
    }

    /// Saves the BIP39 `entropies` of the candidates, each `length` bytes.
    pub(crate) fn save_entropies(
        &mut self,
        entropies: SecretBytes,
        length: usize,
        passphrase: &str,
    ) -> Result<(), Stop> {
        self.written(passphrase, |writer, gate| {
            writer.write(entropies, length, gate, &mut SystemRandom)
        })
    }

    /// Saves what `write` makes with the writer that `passphrase` needs, where a list is saved.
    fn written(
        &mut self,
        passphrase: &str,
        write: impl FnOnce(&Writer, &mut Gate) -> Result<ListOutcome, WriteError>,
    ) -> Result<(), Stop> {
        self.prepare(passphrase)?;
        let Some(writer) = &self.writer else {
            return Ok(());
        };
        let outcome = write(writer, &mut self.gate)?;
        self.save(outcome)
    }

    /// Saves what the writer made.
    fn save(&mut self, outcome: ListOutcome) -> Result<(), Stop> {
        let list = match outcome {
            ListOutcome::Empty => {
                self.save_nothing();
                return Ok(());
            }
            // The searches refuse a list before this; here only a fault of MnemoCode would be.
            ListOutcome::Full => {
                return Err(ListError::TooManyForList(NARROW_ANY_SEARCH.to_owned()).into());
            }
            ListOutcome::List(list) => list,
        };
        // A save that fails on the private screen is offered again, under another name, or skipped,
        // and the candidates stay on the screen.
        let saved_at = save_output(
            &mut self.parsed,
            "candidates-file",
            ResultName::one("The candidate list"),
            |path| os::publish_new_file(&super::resolved(path), &list.bytes),
        )?;
        let Some(path) = saved_at else {
            return Ok(());
        };
        saved(&format!(
            "Saved {}, {}: {} (record N is candidate N).",
            counted(list.records as u64, "candidate phrase"),
            list.description,
            printable(&path)
        ));
        lasting_warning(if list.encrypted {
            "Delete the file once the wallet is found."
        } else {
            "This file holds real seed phrases in the open: keep it offline, and delete it once the wallet is found."
        });
        Ok(())
    }
}

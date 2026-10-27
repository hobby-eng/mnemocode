//! The phrase an old backup holds, before it is encoded again (MnemoCode TS 0.1.0's
//! `core/re-encoding.ts`, CAP-PHRASE-FORMATS-REENCODING-CONFIRMATION): decoded with its dates, and
//! with the original last word where the Original Seedshift with a valid last word keeps none of
//! it; given out to be encoded again only once the person recognised it or the wallet matched.

use std::fmt;

use super::{Backup, BackupError};
use crate::bip39::phrase::{Phrase, english_tokens};
use crate::dates::Date;
use crate::forms::Form;
use crate::modes::seedshift::Unmasked;
use crate::refusal::Refusal;
use crate::text::words::capitalized;
use crate::wallet::evidence::{MASTER_KEY_PATH, WalletMatch};

/// The words of the confirmations.
pub mod words {
    /// The person recognised the phrase.
    pub const RECOGNISED: &str = "You recognised the seed phrase: it is confirmed.";
    /// The wallet does not match.
    pub const NOT_MATCHED: &str =
        "The wallet of this seed phrase does not match: it is not confirmed.";
    /// The old backup still opens the wallet.
    pub const OLD_BACKUP_STILL_OPENS: &str =
        "The old backup still restores the same wallet: destroy it if the new one replaces it.";
}

/// The refusals of a re-encoding, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReEncodingError {
    /// A last word given for a backup that gives one phrase.
    LastWordNotTaken,
    /// Codes and dates of no valid phrase.
    ChecksumFails,
    /// No last word for a backup that needs one.
    LastWordNeeded,
    /// A last word no phrase of the backup ends with.
    NoSuchLastWord,
    /// Given out before it was confirmed.
    NotConfirmed,
    /// The backup's refusal.
    Backup(BackupError),
}

impl fmt::Display for ReEncodingError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LastWordNotTaken => f.write_str("This backup gives one seed phrase and takes no last word: the last word is only for a backup of the Original Seedshift with a valid last word."),
            Self::ChecksumFails => f.write_str("These codes and dates give no seed phrase with a valid checksum: a date or a code is wrong."),
            Self::LastWordNeeded => f.write_str("This backup was made with the Original Seedshift with a valid last word, which keeps nothing of the original last word: give the last word of the original seed phrase."),
            Self::NoSuchLastWord => f.write_str("No seed phrase of this backup ends with that word: check the last word and the dates."),
            Self::NotConfirmed => f.write_str("The seed phrase of the old backup is not confirmed: it is encoded again only once the person recognised it or the wallet has the address given."),
            Self::Backup(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for ReEncodingError {}

impl Refusal for ReEncodingError {
    fn code(&self) -> &'static str {
        match self {
            Self::LastWordNotTaken => "core.re-encoding.last-word-not-taken",
            Self::ChecksumFails => "core.re-encoding.checksum-fails",
            Self::LastWordNeeded => "core.re-encoding.last-word-needed",
            Self::NoSuchLastWord => "core.re-encoding.no-such-last-word",
            Self::NotConfirmed => "core.re-encoding.not-confirmed",
            Self::Backup(error) => error.code(),
        }
    }
}

impl From<BackupError> for ReEncodingError {
    fn from(error: BackupError) -> Self {
        Self::Backup(error)
    }
}

/// What the wallet's match says of a match: by an address, a key or a fingerprint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MatchedBy {
    /// An address.
    Address,
    /// A key.
    Key,
    /// A master fingerprint.
    Fingerprint,
}

impl MatchedBy {
    const fn word(self) -> &'static str {
        match self {
            Self::Address => "address",
            Self::Key => "key",
            Self::Fingerprint => "fingerprint",
        }
    }
}

/// How the phrase was confirmed.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Confirmation {
    Person,
    Wallet {
        path: Option<String>,
        warning: Option<&'static str>,
    },
}

/// The phrase of an old backup, to be confirmed before it is encoded again.
#[derive(Debug)]
pub struct ReEncoding {
    result: Unmasked,
    phrase: Phrase,
    confirmation: Option<Confirmation>,
}

/// The English words of `indexes`.
fn words_of(indexes: &[u16]) -> String {
    Form::English.codes(indexes).unwrap_or_default()
}

impl ReEncoding {
    /// The phrase `backup` gives with `dates`; for the Original Seedshift with a valid last word,
    /// the one that ends with `last_word`. Refused: a last word where none is taken, none where one
    /// is needed, one no phrase ends with, and codes and dates of no valid phrase.
    pub fn of(
        backup: &Backup,
        dates: &[Date],
        last_word: Option<&str>,
    ) -> Result<Self, ReEncodingError> {
        if backup.gives_several() {
            let last_word = last_word.ok_or(ReEncodingError::LastWordNeeded)?;
            let typed = english_tokens(last_word);
            let found = match typed.as_slice() {
                [word] => backup.candidates(dates)?.into_iter().find(|candidate| {
                    english_tokens(&words_of(candidate.recovered.as_slice())).last() == Some(word)
                }),
                _ => None,
            };
            return Self::confirming(found.ok_or(ReEncodingError::NoSuchLastWord)?);
        }
        if last_word.is_some() {
            return Err(ReEncodingError::LastWordNotTaken);
        }
        let result = backup.decode(dates)?;
        if !result.checksum_valid {
            return Err(ReEncodingError::ChecksumFails);
        }
        Self::confirming(result)
    }

    /// `result`, a phrase with a valid checksum, not confirmed yet.
    fn confirming(result: Unmasked) -> Result<Self, ReEncodingError> {
        let all: Vec<usize> = result
            .recovered
            .as_slice()
            .iter()
            .map(|&index| usize::from(index))
            .collect();
        let phrase = Phrase::of_indexes(&all).map_err(|_| ReEncodingError::ChecksumFails)?;
        Ok(Self {
            result,
            phrase,
            confirmation: None,
        })
    }

    /// The phrase, to show and to check.
    pub const fn phrase(&self) -> &Phrase {
        &self.phrase
    }

    /// What decoding gave: the indexes, the dates and the shifts.
    pub const fn result(&self) -> &Unmasked {
        &self.result
    }

    /// The person recognised the phrase.
    pub fn confirm_by_person(&mut self) {
        self.confirmation = Some(Confirmation::Person);
    }

    /// The wallet's `matched` answer for the phrase: a match confirms it.
    pub fn confirm_by_wallet(&mut self, matched: &WalletMatch) {
        if matched.matched {
            self.confirmation = Some(Confirmation::Wallet {
                path: matched.path.clone(),
                warning: matched.warning,
            });
        }
    }

    /// The line that says how the phrase was confirmed, by what the wallet's match was of.
    pub fn confirmation_line(&self, by: MatchedBy) -> Result<String, ReEncodingError> {
        Ok(
            match self
                .confirmation
                .as_ref()
                .ok_or(ReEncodingError::NotConfirmed)?
            {
                Confirmation::Person => words::RECOGNISED.to_owned(),
                Confirmation::Wallet {
                    warning: Some(_), ..
                } => {
                    format!(
                        "The {} matches: the seed phrase is accepted, not proven.",
                        by.word()
                    )
                }
                Confirmation::Wallet { path: None, .. } => {
                    "The wallet matches: the seed phrase is confirmed.".to_owned()
                }
                Confirmation::Wallet {
                    path: Some(path), ..
                } if path == MASTER_KEY_PATH => {
                    "The wallet matches: the seed phrase is confirmed.".to_owned()
                }
                Confirmation::Wallet {
                    path: Some(path), ..
                } => format!(
                    "{} found at {path}: the wallet matches, the seed phrase is confirmed.",
                    capitalized(by.word())
                ),
            },
        )
    }

    /// The phrase, once it is confirmed.
    pub fn confirmed_phrase(&self) -> Result<&Phrase, ReEncodingError> {
        self.confirmation
            .as_ref()
            .ok_or(ReEncodingError::NotConfirmed)?;
        Ok(&self.phrase)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modes::Mode;
    use crate::self_check::vectors::{MASKED_DATE, MASKED_ENGLISH, PUBLIC_MNEMONIC};

    #[test]
    fn the_old_phrase_is_given_out_once_confirmed() {
        let backup = Backup::read(MASKED_ENGLISH, Form::English, Mode::Seedshift).unwrap();
        let dates = [crate::dates::parse_date(MASKED_DATE).unwrap()];
        let mut re_encoding = ReEncoding::of(&backup, &dates, None).unwrap();
        assert_eq!(
            re_encoding.confirmed_phrase().unwrap_err(),
            ReEncodingError::NotConfirmed
        );
        assert_eq!(re_encoding.phrase().text().as_str(), PUBLIC_MNEMONIC);
        re_encoding.confirm_by_wallet(&WalletMatch {
            matched: true,
            path: Some("m/84'/0'/0'/0/1".to_owned()),
            ..WalletMatch::default()
        });
        assert_eq!(
            re_encoding.confirmation_line(MatchedBy::Address).unwrap(),
            "Address found at m/84'/0'/0'/0/1: the wallet matches, the seed phrase is confirmed."
        );
        assert!(re_encoding.confirmed_phrase().is_ok());
        assert_eq!(
            ReEncoding::of(&backup, &dates, Some("about")).unwrap_err(),
            ReEncodingError::LastWordNotTaken
        );
    }
}

//! Which candidate files are let in (MnemoCode TS 0.1.0's `core/candidate-file-admission.ts` and
//! `candidate-file-refusal.ts`, CAP-RECOVERY-CANDIDATE-FILE-ADMISSION): a plaintext list or an age
//! file within its size, and an age header with exactly one recipient of the two locks MnemoCode
//! writes, a Scanner key (X25519) or a passphrase (scrypt with its one work factor), in the shape
//! those recipients take; read before any key is asked.

use std::fmt;

use base64ct::{Base64Unpadded, Encoding};

use super::format::MAX_CANDIDATE_LIST_BYTES;
use crate::refusal::Refusal;

/// The longest header read.
pub const MAX_HEADER_BYTES: usize = 64 * 1024;
/// The plaintext of one age payload chunk.
pub const AGE_CHUNK_BYTES: usize = 64 * 1024;
/// The tag of each chunk and of a wrapped key.
pub const AGE_TAG_BYTES: usize = 16;
/// The payload's nonce.
pub const AGE_NONCE_BYTES: usize = 16;
/// The scrypt work factor the passphrase lock writes and takes: 2^18.
pub const SCRYPT_LOG_N: u8 = 18;
/// The first line of every age file.
pub const AGE_FIRST_LINE: &str = "age-encryption.org/v1";
/// The start of the MAC line.
pub const MAC_LINE_START: &str = "--- ";
/// The start of a stanza.
pub const STANZA_LINE_START: &str = "-> ";
/// The bytes of an X25519 share, a scrypt salt, a wrapped file key and the header MAC.
const X25519_KEY_BYTES: usize = 32;
const SCRYPT_SALT_BYTES: usize = 16;
const WRAPPED_KEY_BYTES: usize = 16 + AGE_TAG_BYTES;
const HEADER_MAC_BYTES: usize = 32;
/// The largest age file of a list.
pub const MAX_ENCRYPTED_BYTES: usize = MAX_HEADER_BYTES
    + AGE_NONCE_BYTES
    + MAX_CANDIDATE_LIST_BYTES
    + AGE_TAG_BYTES * MAX_CANDIDATE_LIST_BYTES.div_ceil(AGE_CHUNK_BYTES);

/// How a candidate file is locked.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lock {
    /// To a Scanner key: an X25519 recipient.
    Key,
    /// With a passphrase: a scrypt recipient.
    Passphrase,
}

impl Lock {
    /// The type of its age stanza.
    pub const fn stanza(self) -> &'static str {
        match self {
            Self::Key => "X25519",
            Self::Passphrase => "scrypt",
        }
    }
}

/// The refusals of candidate files, word for word as TS 0.1.0 writes them; a detail is the age
/// layer's own description, which is MnemoCode's here.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FileRefusal {
    /// A plaintext list larger than any.
    PlaintextTooLarge,
    /// An age file larger than any list's.
    EncryptedTooLarge,
    /// No age file.
    NotAge,
    /// A header without its MAC line.
    HeaderWithoutEnd,
    /// A recipient of neither lock.
    RecipientUnsupported,
    /// More than one recipient: the lock's stanza.
    SeveralRecipients(&'static str),
    /// A recipient of the other lock than the key given: the given lock's stanza.
    RecipientOfAnotherKey(&'static str),
    /// Another scrypt work factor.
    ScryptWorkFactor,
    /// A header of another shape.
    HeaderMalformed,
    /// A damaged payload: the detail.
    ContentsDamaged(&'static str),
    /// An identity that is no age X25519 identity.
    IdentityInvalid,
    /// A Scanner key that does not open the file: the detail.
    ScannerKeyDoesNotOpen(&'static str),
    /// A passphrase that does not open the file: the detail.
    PassphraseDoesNotOpen(&'static str),
}

/// TS's words for a file of exactly one recipient of `types`.
fn exactly_one_recipient(f: &mut fmt::Formatter<'_>, types: &str) -> fmt::Result {
    write!(
        f,
        "The candidate file must have exactly one {types} recipient."
    )
}

impl fmt::Display for FileRefusal {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PlaintextTooLarge => write!(
                f,
                "The plaintext candidate list exceeds the supported limit of {MAX_CANDIDATE_LIST_BYTES} bytes."
            ),
            Self::EncryptedTooLarge => write!(
                f,
                "The encrypted candidate file exceeds the supported limit of {MAX_ENCRYPTED_BYTES} bytes."
            ),
            Self::NotAge => f.write_str("This is not a binary age file."),
            Self::HeaderWithoutEnd => f.write_str("The age header has no end."),
            Self::RecipientUnsupported => exactly_one_recipient(f, "X25519 or scrypt"),
            Self::SeveralRecipients(stanza) | Self::RecipientOfAnotherKey(stanza) => {
                exactly_one_recipient(f, stanza)
            }
            Self::ScryptWorkFactor => {
                write!(
                    f,
                    "The candidate file must use the scrypt work factor {SCRYPT_LOG_N}."
                )
            }
            Self::HeaderMalformed => f.write_str("The age header is malformed."),
            Self::ContentsDamaged(detail) => write!(f, "The candidate file is damaged ({detail})."),
            Self::IdentityInvalid => f.write_str("This Scanner key is not a valid age identity."),
            Self::ScannerKeyDoesNotOpen(detail) => write!(
                f,
                "This Scanner key does not open the candidate file, or its header is damaged ({detail})."
            ),
            Self::PassphraseDoesNotOpen(detail) => write!(
                f,
                "This passphrase does not open the candidate file, or its header is damaged ({detail})."
            ),
        }
    }
}

impl std::error::Error for FileRefusal {}

impl Refusal for FileRefusal {
    fn code(&self) -> &'static str {
        match self {
            Self::PlaintextTooLarge => "core.candidate-file-refusal.plaintext-list-too-large",
            Self::EncryptedTooLarge => "core.candidate-file-refusal.encrypted-file-too-large",
            Self::NotAge => "core.candidate-file-refusal.not-age-file",
            Self::HeaderWithoutEnd => "core.candidate-file-refusal.header-without-end",
            Self::RecipientUnsupported => "core.candidate-file-refusal.recipient-unsupported",
            Self::SeveralRecipients(_) => "core.candidate-file-refusal.several-recipients",
            Self::RecipientOfAnotherKey(_) => {
                "core.candidate-file-refusal.recipient-of-another-key"
            }
            Self::ScryptWorkFactor => "core.candidate-file-refusal.scrypt-work-factor-unsupported",
            Self::HeaderMalformed => "core.candidate-file-refusal.header-malformed",
            Self::ContentsDamaged(_) => "core.candidate-file-refusal.contents-damaged",
            Self::IdentityInvalid => "core.candidate-file-refusal.identity-invalid",
            Self::ScannerKeyDoesNotOpen(_) => {
                "core.candidate-file-refusal.scanner-key-does-not-open"
            }
            Self::PassphraseDoesNotOpen(_) => {
                "core.candidate-file-refusal.passphrase-does-not-open"
            }
        }
    }
}

/// The base64 without padding of age, canonical; none otherwise.
fn unpadded(text: &str) -> Option<Vec<u8>> {
    Base64Unpadded::decode_vec(text).ok()
}

/// How the age `file` is locked, read from its header: exactly one recipient of one of the two
/// locks, in the shape MnemoCode's recipients take (a stanza line, one body line of the wrapped
/// file key, the MAC line). Refused: a file larger than any list's, no age file, a header without
/// end, another or several recipients, another work factor, and another shape.
pub fn lock(file: &[u8]) -> Result<Lock, FileRefusal> {
    check_encrypted_size(file.len())?;
    let prefix = &file[..file.len().min(MAX_HEADER_BYTES)];
    // Latin-1, as TS reads it: every byte one character.
    let text: String = prefix.iter().map(|&byte| char::from(byte)).collect();
    let lines: Vec<&str> = text.split('\n').collect();
    if lines.first() != Some(&AGE_FIRST_LINE) {
        return Err(FileRefusal::NotAge);
    }
    // A partial MAC line at the prefix's end is no end: age would read on past it.
    let end = lines
        .iter()
        .position(|line| line.starts_with(MAC_LINE_START));
    let Some(end) = end.filter(|&end| end != lines.len() - 1) else {
        return Err(FileRefusal::HeaderWithoutEnd);
    };
    let stanzas: Vec<Vec<&str>> = lines[1..end]
        .iter()
        .filter_map(|line| line.strip_prefix(STANZA_LINE_START))
        .map(|line| line.split(' ').collect())
        .collect();
    let kind = stanzas.first().and_then(|stanza| stanza.first()).copied();
    let lock = [Lock::Key, Lock::Passphrase]
        .into_iter()
        .find(|lock| Some(lock.stanza()) == kind)
        .ok_or(FileRefusal::RecipientUnsupported)?;
    if stanzas.len() != 1 {
        return Err(FileRefusal::SeveralRecipients(lock.stanza()));
    }
    let stanza = &stanzas[0];
    if lock == Lock::Passphrase && stanza.get(2) != Some(&SCRYPT_LOG_N.to_string().as_str()) {
        return Err(FileRefusal::ScryptWorkFactor);
    }
    let (fields, share) = match lock {
        Lock::Key => (2, X25519_KEY_BYTES),
        Lock::Passphrase => (3, SCRYPT_SALT_BYTES),
    };
    let shaped = end == 3
        && lines[1].starts_with(STANZA_LINE_START)
        && stanza.len() == fields
        && unpadded(stanza[1]).is_some_and(|bytes| bytes.len() == share)
        && unpadded(lines[2]).is_some_and(|bytes| bytes.len() == WRAPPED_KEY_BYTES)
        && unpadded(&lines[end][MAC_LINE_START.len()..])
            .is_some_and(|bytes| bytes.len() == HEADER_MAC_BYTES);
    if !shaped {
        return Err(FileRefusal::HeaderMalformed);
    }
    Ok(lock)
}

/// Refuses an age `file` of another lock than `given`.
pub fn check_lock(file: &[u8], given: Lock) -> Result<(), FileRefusal> {
    if lock(file)? == given {
        Ok(())
    } else {
        Err(FileRefusal::RecipientOfAnotherKey(given.stanza()))
    }
}

/// Refuses an age file larger than any list's.
pub const fn check_encrypted_size(size: usize) -> Result<(), FileRefusal> {
    if size > MAX_ENCRYPTED_BYTES {
        return Err(FileRefusal::EncryptedTooLarge);
    }
    Ok(())
}

/// Refuses a plaintext list larger than any.
pub const fn check_plaintext_size(size: usize) -> Result<(), FileRefusal> {
    if size > MAX_CANDIDATE_LIST_BYTES {
        return Err(FileRefusal::PlaintextTooLarge);
    }
    Ok(())
}

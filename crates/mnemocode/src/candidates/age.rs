//! age v1 for candidate lists (MnemoCode TS 0.1.0's `core/candidate-cipher.ts`,
//! CAP-RECOVERY-CANDIDATE-ENCRYPT-KEY, -ENCRYPT-PASSPHRASE, -DECRYPT): a list encrypted to the
//! Discovery Scanner's X25519 key or with a passphrase (scrypt, work factor 2^18), and opened again
//! with the session key or the passphrase. The format is age's own (age-encryption.org/v1), written
//! over the RustCrypto and dalek primitives the crates report took: the file key wrapped by its one
//! recipient, the header's HMAC, the payload in authenticated 64 KiB chunks. Every random byte comes
//! from the host's [`Random`] port; the file key, the keys and the plaintext stay in locked buffers.

use std::fmt;

use base64ct::{Base64Unpadded, Encoding};
use bech32::primitives::decode::CheckedHrpstring;
use bech32::{Bech32, Hrp};
use chacha20poly1305::aead::{AeadInOut, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce, Tag};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use x25519_dalek::{PublicKey, StaticSecret};
use zeroize::Zeroize;

use super::admission::{
    AGE_CHUNK_BYTES, AGE_FIRST_LINE, AGE_NONCE_BYTES, AGE_TAG_BYTES, FileRefusal, Lock,
    MAC_LINE_START, SCRYPT_LOG_N, STANZA_LINE_START, check_lock, check_plaintext_size,
};
use super::format::MAX_CANDIDATE_LIST_BYTES;
use crate::random::{Random, RandomError};
use crate::refusal::{Refusal, RefusalKind};
use crate::secret::{SecretBytes, SecretText};
use crate::text::space::{trim, without_byte_order_mark};

/// The bytes of a file key.
const FILE_KEY_BYTES: usize = 16;
/// The prefix of a scrypt salt.
const SCRYPT_LABEL: &[u8] = b"age-encryption.org/v1/scrypt";
/// The info of the X25519 wrap key.
const X25519_LABEL: &[u8] = b"age-encryption.org/v1/X25519";
/// The human-readable parts of a recipient and of an identity.
const RECIPIENT_HRP: &str = "age";
const IDENTITY_HRP: &str = "AGE-SECRET-KEY-";
/// The start of an X25519 identity, in capitals as age reads it.
const IDENTITY_START: &str = "AGE-SECRET-KEY-1";
/// The characters of a recipient after its `age1`.
const RECIPIENT_DATA_CHARACTERS: usize = 58;

/// The refusals of the encryption, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EncryptionError {
    /// A recipient that is no age X25519 key.
    Recipient,
    /// An empty passphrase.
    PassphraseEmpty,
    /// A passphrase shorter than a list takes: the fewest characters.
    PassphraseTooShort(usize),
    /// The gate's known answers failed.
    SelfTestFailed,
    /// A protection that is none of the three a person chooses from.
    ProtectionChoice,
    /// The host's randomness failed.
    Random(RandomError),
    /// The file's refusal.
    File(FileRefusal),
}

impl fmt::Display for EncryptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Recipient => f.write_str(
                "The key must be one age key of 62 characters that starts with age1, as the Scanner shows it.",
            ),
            Self::PassphraseEmpty => f.write_str("The passphrase for the candidates is empty."),
            Self::PassphraseTooShort(fewest) => write!(
                f,
                "The passphrase for the candidates is too short: use at least {fewest} characters, since it is all that protects these seed phrases."
            ),
            Self::SelfTestFailed => {
                f.write_str("Candidate encryption is unavailable because its self-test failed.")
            }
            Self::ProtectionChoice => {
                f.write_str("The protection of a candidate list must be key, passphrase or none.")
            }
            Self::Random(error) => error.fmt(f),
            Self::File(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for EncryptionError {}

impl Refusal for EncryptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::Recipient => {
                "core.candidate-encryption.key-one-age-key-62-characters-starts-age1"
            }
            Self::PassphraseEmpty => "core.candidate-encryption.passphrase-candidates-empty",
            Self::PassphraseTooShort(_) => {
                "core.candidate-encryption.use-at-least-characters-passphrase-all-protects-seed"
            }
            Self::SelfTestFailed => "core.candidate-encryption.self-test-failed",
            Self::ProtectionChoice => "core.candidate-encryption.not-protection-choice",
            Self::Random(error) => error.code(),
            Self::File(error) => error.code(),
        }
    }

    fn kind(&self) -> RefusalKind {
        match self {
            Self::ProtectionChoice => RefusalKind::Type,
            Self::Random(error) => error.kind(),
            Self::File(error) => error.kind(),
            _ => RefusalKind::Error,
        }
    }
}

impl From<RandomError> for EncryptionError {
    fn from(error: RandomError) -> Self {
        Self::Random(error)
    }
}

impl From<FileRefusal> for EncryptionError {
    fn from(error: FileRefusal) -> Self {
        Self::File(error)
    }
}

/// Whether the bits after the last whole byte of the Bech32 data of `checked` are zero and fewer
/// than a group, as @scure/base's `fromWords` requires: else two texts would name one key.
fn zero_padding(checked: &CheckedHrpstring<'_>) -> bool {
    let groups: Vec<u8> = checked.fe32_iter().map(|group| group.to_u8()).collect();
    let bits = groups.len() * 5 % 8;
    bits < 5
        && groups
            .last()
            .is_none_or(|&last| last & ((1 << bits) - 1) == 0)
}

/// An X25519 public key: the Scanner's recipient.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Recipient([u8; 32]);

impl Recipient {
    /// The recipient `text`, one `age1…` key of 62 characters, in any case, as typed, pasted or
    /// read from a file: trimmed, and without a file's byte order mark.
    pub fn parse(text: &str) -> Result<Self, EncryptionError> {
        let lower = trim(without_byte_order_mark(text)).to_ascii_lowercase();
        let shaped = lower.strip_prefix("age1").is_some_and(|data| {
            data.len() == RECIPIENT_DATA_CHARACTERS
                && data.bytes().all(|byte| matches!(byte, b'0' | b'2'..=b'9' | b'a' | b'c'..=b'h' | b'j'..=b'n' | b'p'..=b'z'))
        });
        if !shaped {
            return Err(EncryptionError::Recipient);
        }
        let checked =
            CheckedHrpstring::new::<Bech32>(&lower).map_err(|_| EncryptionError::Recipient)?;
        if checked.hrp().as_str() != RECIPIENT_HRP {
            return Err(EncryptionError::Recipient);
        }
        if !zero_padding(&checked) {
            return Err(EncryptionError::Recipient);
        }
        let key: [u8; 32] = checked
            .byte_iter()
            .collect::<Vec<u8>>()
            .try_into()
            .map_err(|_| EncryptionError::Recipient)?;
        Ok(Self(key))
    }

    /// Its text, `age1…`.
    pub fn text(&self) -> String {
        Hrp::parse(RECIPIENT_HRP)
            .ok()
            .and_then(|hrp| bech32::encode::<Bech32>(hrp, &self.0).ok())
            .unwrap_or_default()
    }
}

/// The Discovery Scanner's session key: an X25519 secret in a locked buffer.
pub struct Identity(SecretBytes);

impl Identity {
    /// A new identity from the host's randomness.
    pub fn generate(random: &mut dyn Random) -> Result<Self, RandomError> {
        let mut secret = SecretBytes::zeroed("an age identity", 32);
        random.fill(&mut secret)?;
        Ok(Self(secret))
    }

    /// The identity `text`, `AGE-SECRET-KEY-1…` in capitals and untrimmed, as age reads it (a
    /// published test key); refused for any other text, a post-quantum one among them, without
    /// repeating it.
    pub fn parse(text: &str) -> Result<Self, FileRefusal> {
        if !text.starts_with(IDENTITY_START) {
            return Err(FileRefusal::IdentityInvalid);
        }
        let checked =
            CheckedHrpstring::new::<Bech32>(text).map_err(|_| FileRefusal::IdentityInvalid)?;
        if !checked.hrp().as_str().eq_ignore_ascii_case(IDENTITY_HRP) || !zero_padding(&checked) {
            return Err(FileRefusal::IdentityInvalid);
        }
        let mut bytes: Vec<u8> = checked.byte_iter().collect();
        let held = (bytes.len() == 32).then(|| SecretBytes::copy_of("an age identity", &bytes));
        bytes.zeroize();
        held.map(Self).ok_or(FileRefusal::IdentityInvalid)
    }

    /// Its text, `AGE-SECRET-KEY-1…` in capitals, in a locked buffer.
    pub fn text(&self) -> SecretText {
        let encoded = Hrp::parse(IDENTITY_HRP)
            .ok()
            .and_then(|hrp| bech32::encode_upper::<Bech32>(hrp, &self.0).ok())
            .unwrap_or_default();
        SecretText::copy_of("an age identity", &encoded)
    }

    /// The secret as x25519-dalek takes it, wiped when dropped.
    fn secret(&self) -> StaticSecret {
        static_secret(&self.0)
    }

    /// Its recipient.
    pub fn recipient(&self) -> Recipient {
        Recipient(PublicKey::from(&self.secret()).to_bytes())
    }
}

impl fmt::Debug for Identity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "an age identity")
    }
}

/// Who a list is encrypted to. No Debug: it may hold a passphrase.
#[derive(Clone, Copy)]
pub enum To<'a> {
    /// The Scanner's key.
    Recipient(&'a Recipient),
    /// A passphrase.
    Passphrase(&'a str),
}

/// What opens a file. No Debug: it may hold a passphrase.
#[derive(Clone, Copy)]
pub enum Opener<'a> {
    /// The session key.
    Identity(&'a Identity),
    /// A passphrase.
    Passphrase(&'a str),
}

/// HKDF-SHA-256 of `ikm` with `salt` and `info`, 32 bytes, in a locked buffer.
fn hkdf(ikm: &[u8], salt: &[u8], info: &[u8]) -> SecretBytes {
    let mut key = SecretBytes::zeroed("an age key", 32);
    // 32 bytes are well below HKDF-SHA-256's limit.
    let _done = Hkdf::<Sha256>::new(Some(salt), ikm).expand(info, &mut key);
    key
}

/// ChaCha20-Poly1305 under `key`.
fn cipher(key: &[u8]) -> ChaCha20Poly1305 {
    let mut bytes = [0; 32];
    bytes.copy_from_slice(key);
    let cipher = ChaCha20Poly1305::new(&Key::from(bytes));
    bytes.zeroize();
    cipher
}

/// `body` sealed in place under `key` with the zero nonce, its tag after it. ChaCha20-Poly1305
/// refuses only a message past 256 GiB, which a file key is not.
fn wrap(key: &[u8], file_key: &[u8]) -> Vec<u8> {
    let mut body = file_key.to_vec();
    let tag = cipher(key)
        .encrypt_inout_detached(&Nonce::default(), &[], body.as_mut_slice().into())
        .unwrap_or_default();
    body.extend_from_slice(&tag);
    body
}

/// The file key `body` holds under `key`; none where it does not authenticate.
fn unwrap(key: &[u8], body: &[u8]) -> Option<SecretBytes> {
    let (sealed, tag) = body.split_at_checked(body.len().checked_sub(AGE_TAG_BYTES)?)?;
    let mut file_key = SecretBytes::copy_of("an age file key", sealed);
    let tag = Tag::try_from(tag).ok()?;
    cipher(key)
        .decrypt_inout_detached(&Nonce::default(), &[], file_key.as_mut().into(), &tag)
        .ok()?;
    (file_key.len() == FILE_KEY_BYTES).then_some(file_key)
}

/// scrypt of `passphrase` with `salt`, its work factor 2^18, in a locked buffer. The parameters
/// are constants scrypt takes, and an output of 32 bytes is within its limit, so nothing is refused.
fn scrypt_key(passphrase: &str, salt: &[u8]) -> SecretBytes {
    let mut labelled = SCRYPT_LABEL.to_vec();
    labelled.extend_from_slice(salt);
    let mut key = SecretBytes::zeroed("an age key", 32);
    if let Ok(params) = scrypt::Params::new(SCRYPT_LOG_N, 8, 1) {
        let _done = scrypt::scrypt(passphrase.as_bytes(), &labelled, &params, &mut key);
    }
    key
}

/// The payload's nonce for chunk `counter`, `last` or not: the counter in 11 big-endian bytes, then
/// the last chunk's flag.
fn chunk_nonce(counter: usize, last: bool) -> Nonce {
    let mut nonce = [0; 12];
    nonce[3..11].copy_from_slice(&(counter as u64).to_be_bytes());
    nonce[11] = u8::from(last);
    Nonce::from(nonce)
}

/// The bytes of the X25519 secret that an encryption to the Scanner's key draws; a passphrase's
/// draws its salt from the first 16 of them.
const LOCK_SECRET_BYTES: usize = 32;
/// The bytes of a scrypt salt.
const SALT_BYTES: usize = 16;

/// `plain`, a candidate list, encrypted `to` the Scanner's key or with a passphrase: the file key,
/// the X25519 secret or the scrypt salt, and the payload's nonce drawn from `random`.
pub fn encrypt(
    plain: &[u8],
    to: To<'_>,
    random: &mut dyn Random,
) -> Result<SecretBytes, EncryptionError> {
    check_plaintext_size(plain.len())?;
    if matches!(to, To::Passphrase("")) {
        return Err(EncryptionError::PassphraseEmpty);
    }
    let mut drawn = SecretBytes::zeroed(
        "an age file's random bytes",
        FILE_KEY_BYTES + LOCK_SECRET_BYTES + AGE_NONCE_BYTES,
    );
    random.fill(&mut drawn)?;
    let (file_key, rest) = drawn.split_at(FILE_KEY_BYTES);
    let (lock_secret, nonce) = rest.split_at(LOCK_SECRET_BYTES);
    seal(plain, to, file_key, lock_secret, nonce)
}

/// The age file of `plain` under `file_key`, `to` the Scanner's key with the X25519 secret
/// `lock_secret` or with a passphrase and the first 16 bytes of `lock_secret` as its salt, and with
/// `nonce`: [`encrypt`] with the bytes it drew, and the gate's known answers with public ones.
pub(super) fn seal(
    plain: &[u8],
    to: To<'_>,
    file_key: &[u8],
    lock_secret: &[u8],
    nonce: &[u8],
) -> Result<SecretBytes, EncryptionError> {
    let mut header = format!("{AGE_FIRST_LINE}\n");
    match to {
        To::Recipient(recipient) => {
            let secret = static_secret(lock_secret);
            let share = PublicKey::from(&secret).to_bytes();
            let shared = secret.diffie_hellman(&PublicKey::from(recipient.0));
            // A key of small order gives the zero secret, which age refuses (its X25519 recipient).
            if !shared.was_contributory() {
                return Err(EncryptionError::Recipient);
            }
            let mut salt = share.to_vec();
            salt.extend_from_slice(&recipient.0);
            let key = hkdf(shared.as_bytes(), &salt, X25519_LABEL);
            let body = wrap(&key, file_key);
            header.push_str(&format!(
                "{STANZA_LINE_START}X25519 {}\n{}\n",
                Base64Unpadded::encode_string(&share),
                Base64Unpadded::encode_string(&body)
            ));
        }
        To::Passphrase(passphrase) => {
            let salt = &lock_secret[..SALT_BYTES];
            let body = wrap(&scrypt_key(passphrase, salt), file_key);
            header.push_str(&format!(
                "{STANZA_LINE_START}scrypt {} {SCRYPT_LOG_N}\n{}\n",
                Base64Unpadded::encode_string(salt),
                Base64Unpadded::encode_string(&body)
            ));
        }
    }
    header.push_str("---");
    let mac = header_mac(file_key, header.as_bytes());
    let header = format!("{header} {}\n", Base64Unpadded::encode_string(&mac));
    let count = plain.len().div_ceil(AGE_CHUNK_BYTES).max(1);
    // The file at its exact size: the header, the nonce, and each chunk with its tag.
    let mut file = SecretBytes::zeroed(
        "an encrypted candidate list",
        header.len() + AGE_NONCE_BYTES + plain.len() + count * AGE_TAG_BYTES,
    );
    let (head, rest) = file.split_at_mut(header.len());
    head.copy_from_slice(header.as_bytes());
    let (nonce_field, mut chunks) = rest.split_at_mut(AGE_NONCE_BYTES);
    nonce_field.copy_from_slice(nonce);
    let payload = cipher(&hkdf(file_key, nonce, b"payload"));
    for counter in 0..count {
        let start = counter * AGE_CHUNK_BYTES;
        let part = &plain[start..plain.len().min(start + AGE_CHUNK_BYTES)];
        let (sealed, rest) = chunks.split_at_mut(part.len() + AGE_TAG_BYTES);
        let (body, tag_field) = sealed.split_at_mut(part.len());
        body.copy_from_slice(part);
        let nonce = chunk_nonce(counter, counter + 1 == count);
        // ChaCha20-Poly1305 refuses only a message past 256 GiB, which a chunk is not.
        let tag = payload
            .encrypt_inout_detached(&nonce, &[], body.into())
            .unwrap_or_default();
        tag_field.copy_from_slice(&tag);
        chunks = rest;
    }
    Ok(file)
}

/// The X25519 secret of `bytes`, as x25519-dalek takes it, wiped when dropped.
fn static_secret(bytes: &[u8]) -> StaticSecret {
    let mut array = [0; 32];
    array.copy_from_slice(&bytes[..32]);
    let secret = StaticSecret::from(array);
    array.zeroize();
    secret
}

/// HMAC-SHA-256 of `header`, through its `---`, under the file key's header key. HMAC pads a key
/// shorter than its block with zeros (RFC 2104), so the key of 32 bytes is given padded to 64.
fn header_mac(file_key: &[u8], header: &[u8]) -> [u8; 32] {
    let mut key = SecretBytes::zeroed("an age header key", 64);
    key[..32].copy_from_slice(&hkdf(file_key, &[], b"header"));
    let mut block = [0; 64];
    block.copy_from_slice(&key);
    let mut mac = <Hmac<Sha256> as hmac::digest::KeyInit>::new(&block.into());
    block.zeroize();
    mac.update(header);
    mac.finalize().into_bytes().into()
}

/// The parts of a file the admission let in: its stanza's second field (the X25519 share or the
/// scrypt salt) and its body, the header through its `---`, the MAC, and the payload.
struct Parts<'a> {
    share: Vec<u8>,
    body: Vec<u8>,
    header: &'a [u8],
    mac: Vec<u8>,
    payload: &'a [u8],
}

impl<'a> Parts<'a> {
    /// The parts of `file`, which the admission checked: four lines, the stanza, its body and the
    /// MAC, each field canonical base64.
    fn of(file: &'a [u8]) -> Result<Self, FileRefusal> {
        let lines: Vec<&[u8]> = file.splitn(5, |&byte| byte == b'\n').collect();
        let [first, stanza, body, mac_line, payload] = lines.as_slice() else {
            return Err(FileRefusal::HeaderMalformed);
        };
        let decode = |bytes: &[u8]| {
            std::str::from_utf8(bytes)
                .ok()
                .and_then(|text| Base64Unpadded::decode_vec(text).ok())
                .ok_or(FileRefusal::HeaderMalformed)
        };
        let share = stanza
            .split(|&byte| byte == b' ')
            .nth(2)
            .ok_or(FileRefusal::HeaderMalformed)?;
        let mac = mac_line
            .strip_prefix(MAC_LINE_START.as_bytes())
            .ok_or(FileRefusal::HeaderMalformed)?;
        // The header ends with the `---` before the MAC's space.
        let header_length = first.len() + stanza.len() + body.len() + 3 + MAC_LINE_START.len() - 1;
        Ok(Self {
            share: decode(share)?,
            body: decode(body)?,
            header: &file[..header_length],
            mac: decode(mac)?,
            payload,
        })
    }

    /// The list under `file_key`: the header's MAC checked, then the payload opened; refused as
    /// `does_not_open` words a key that does not open the file, and as a damaged payload.
    fn open(
        &self,
        file_key: &[u8],
        does_not_open: impl Fn(&'static str) -> FileRefusal,
    ) -> Result<SecretBytes, FileRefusal> {
        if !crate::secret::equal_bytes(&header_mac(file_key, self.header), &self.mac) {
            return Err(does_not_open("invalid header HMAC"));
        }
        let (nonce, chunks) = self
            .payload
            .split_at_checked(AGE_NONCE_BYTES)
            .ok_or_else(|| does_not_open("stream ended before reading 16 bytes"))?;
        open_payload(nonce, chunks, file_key)
    }
}

/// The list in the age `file`, opened with the session key or the passphrase; refused: a file of
/// the other lock or another shape (admission), a key that does not open it, and a damaged payload,
/// each with age-encryption 0.3.1's own words for what failed, as TS gives them.
pub fn decrypt(file: &[u8], opener: Opener<'_>) -> Result<SecretBytes, FileRefusal> {
    let lock = match opener {
        Opener::Identity(_) => Lock::Key,
        Opener::Passphrase(_) => Lock::Passphrase,
    };
    check_lock(file, lock)?;
    let does_not_open = |detail| match lock {
        Lock::Key => FileRefusal::ScannerKeyDoesNotOpen(detail),
        Lock::Passphrase => FileRefusal::PassphraseDoesNotOpen(detail),
    };
    let parts = Parts::of(file)?;
    let file_key = match opener {
        Opener::Identity(identity) => {
            let share: [u8; 32] = parts
                .share
                .as_slice()
                .try_into()
                .map_err(|_| FileRefusal::HeaderMalformed)?;
            let shared = identity.secret().diffie_hellman(&PublicKey::from(share));
            // A share of small order gives the zero secret, which age refuses; these are the words
            // of its fallback X25519 (WebCrypto's own differ from host to host).
            if !shared.was_contributory() {
                return Err(does_not_open("invalid private or public key received"));
            }
            let mut salt = share.to_vec();
            salt.extend_from_slice(&identity.recipient().0);
            unwrap(&hkdf(shared.as_bytes(), &salt, X25519_LABEL), &parts.body)
        }
        Opener::Passphrase(passphrase) => {
            unwrap(&scrypt_key(passphrase, &parts.share), &parts.body)
        }
    }
    .ok_or_else(|| does_not_open("no identity matched any of the file's recipients"))?;
    parts.open(&file_key, does_not_open)
}

/// The list in the age `file`, whose header the admission let in, opened with its `file_key`
/// itself: the gate's known answer of the header MAC and the payload, without a stanza unwrapped.
pub(super) fn open_with_file_key(file: &[u8], file_key: &[u8]) -> Result<SecretBytes, FileRefusal> {
    Parts::of(file)?.open(file_key, FileRefusal::ScannerKeyDoesNotOpen)
}

/// The plaintext of the payload's `chunks` under `nonce`: chunks of 64 KiB and their tags, the last
/// one marked. Read as age-encryption 0.3.1 reads them, one chunk after another: each refused where
/// it does not authenticate, the last where it is empty after another, and the list as soon as it
/// grows past its limit.
fn open_payload(nonce: &[u8], chunks: &[u8], file_key: &[u8]) -> Result<SecretBytes, FileRefusal> {
    let payload = cipher(&hkdf(file_key, nonce, b"payload"));
    // A payload of no chunk at all is one empty last chunk, as age reads it.
    let sealed: Vec<&[u8]> = if chunks.is_empty() {
        vec![chunks]
    } else {
        chunks.chunks(AGE_CHUNK_BYTES + AGE_TAG_BYTES).collect()
    };
    let bound = sealed
        .iter()
        .map(|chunk| chunk.len().saturating_sub(AGE_TAG_BYTES))
        .sum::<usize>();
    let mut plain = SecretBytes::zeroed("a candidate list", bound.min(MAX_CANDIDATE_LIST_BYTES));
    let mut opened = SecretBytes::zeroed("an age chunk", AGE_CHUNK_BYTES);
    let mut written = 0;
    for (counter, chunk) in sealed.iter().enumerate() {
        let length = chunk
            .len()
            .checked_sub(AGE_TAG_BYTES)
            .ok_or(FileRefusal::ContentsDamaged(
                "\"ciphertext\" expected length >= tagLength=16",
            ))?;
        let (body, tag) = chunk.split_at(length);
        let target = &mut opened[..length];
        target.copy_from_slice(body);
        let tag = Tag::try_from(tag).map_err(|_| FileRefusal::ContentsDamaged("invalid tag"))?;
        let nonce = chunk_nonce(counter, counter + 1 == sealed.len());
        payload
            .decrypt_inout_detached(&nonce, &[], target.into(), &tag)
            .map_err(|_| FileRefusal::ContentsDamaged("invalid tag"))?;
        if counter > 0 && length == 0 {
            return Err(FileRefusal::ContentsDamaged("final chunk is empty"));
        }
        check_plaintext_size(written + length)?;
        plain[written..written + length].copy_from_slice(target);
        written += length;
    }
    Ok(plain)
}

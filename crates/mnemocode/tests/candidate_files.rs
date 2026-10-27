//! Candidate files against vectors/candidates-v1.json, "age" (TS 0.1.0's own): the published files
//! opened with the public test key and passphrase, the files a reader refuses refused for their
//! reason, a file changed by a byte or opened with another key refused, and lists encrypted here
//! opened again. Public test keys and passphrase only.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use bech32::{Bech32, Hrp};
use mnemocode::candidates::admission::{FileRefusal, Lock, check_lock, lock};
use mnemocode::candidates::age::{
    EncryptionError, Identity, Opener, Recipient, To, decrypt, encrypt,
};
use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode::text::hex::{bytes_of_hex, hex_of_bytes};
use serde_json::Value;

const FILE: &str = include_str!("../../../vectors/candidates-v1.json");

fn age() -> Value {
    serde_json::from_str::<Value>(FILE).unwrap()["age"].clone()
}

fn text<'a>(vectors: &'a Value, key: &str) -> &'a str {
    vectors[key].as_str().unwrap()
}

/// The bytes of the named file of `group` ("open" or "refuse").
fn file(vectors: &Value, group: &str, name: &str) -> Vec<u8> {
    let found = vectors[group]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == name)
        .unwrap();
    bytes_of_hex(found["file"].as_str().unwrap()).unwrap()
}

/// A source that counts up from its seed, for the tests: never a source of real keys.
struct CountingRandom(u8);

impl Random for CountingRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        for byte in bytes {
            self.0 = self.0.wrapping_add(1);
            *byte = self.0;
        }
        Ok(())
    }
}

/// Where the payload of `file` starts: after the line of its MAC.
fn payload_start(file: &[u8]) -> usize {
    let mac_line = file
        .windows(5)
        .position(|window| window == b"\n--- ")
        .unwrap()
        + 1;
    mac_line
        + file[mac_line..]
            .iter()
            .position(|&byte| byte == b'\n')
            .unwrap()
        + 1
}

/// A source that has failed.
struct FailedRandom;

impl Random for FailedRandom {
    fn fill(&mut self, _bytes: &mut [u8]) -> Result<(), RandomError> {
        Err(RandomError::Unavailable)
    }
}

#[test]
fn the_test_key_reads_and_writes_as_age_does() {
    let vectors = age();
    let identity = Identity::parse(text(&vectors, "identity")).unwrap();
    assert_eq!(identity.text().as_str(), text(&vectors, "identity"));
    assert_eq!(identity.recipient().text(), text(&vectors, "recipient"));
    assert_eq!(format!("{identity:?}"), "[an age identity: redacted]");
    let recipient = Recipient::parse(&format!(" {} ", text(&vectors, "recipient").to_uppercase()));
    assert_eq!(recipient, Ok(identity.recipient()));
    // A key file an editor began with a byte order mark.
    let from_file = Recipient::parse(&format!("\u{feff}{}\n", text(&vectors, "recipient")));
    assert_eq!(from_file, Ok(identity.recipient()));
}

#[test]
fn other_keys_are_refused() {
    let vectors = age();
    let identity = text(&vectors, "identity");
    for refused in [
        text(&vectors, "hybridIdentity"),
        &identity.to_lowercase(),
        &format!(" {identity}"),
        &identity.replace("J89", "J88"),
        // The test key with a padding bit set and a checksum that fits it.
        "AGE-SECRET-KEY-1J3DXH7J0XJ7HDQ5KT55PD474ZU2S9E0X7N37UZERQSWG4H3Q8NA3U2686H",
        "",
    ] {
        let refusal = Identity::parse(refused).unwrap_err();
        assert_eq!(refusal, FileRefusal::IdentityInvalid);
        assert_eq!(
            refusal.code(),
            "core.candidate-file-refusal.identity-invalid"
        );
        assert_eq!(
            refusal.to_string(),
            "This Scanner key is not a valid age identity."
        );
    }
    let recipient = text(&vectors, "recipient");
    for refused in [
        &recipient.replace("808", "809"),
        &recipient[..61],
        &format!("{recipient}q"),
        &recipient.replace("age1", "age2"),
        // The same key with a padding bit set and a checksum that fits it: two texts of one key.
        "age1fdc6vcx5w70ah6qtmyctutym56y4fhw82dhvjxyjqyqxea2g34h3398jj4",
        "age1",
    ] {
        let refusal = Recipient::parse(refused).unwrap_err();
        assert_eq!(refusal, EncryptionError::Recipient);
        assert_eq!(
            refusal.code(),
            "core.candidate-encryption.key-one-age-key-62-characters-starts-age1"
        );
    }
}

#[test]
fn the_published_file_opens_with_the_session_key() {
    let vectors = age();
    let identity = Identity::parse(text(&vectors, "identity")).unwrap();
    let file = file(&vectors, "open", "to the session key");
    assert_eq!(lock(&file), Ok(Lock::Key));
    let plain = decrypt(&file, Opener::Identity(&identity)).unwrap();
    assert_eq!(hex_of_bytes(&plain), text(&vectors, "plaintext"));
}

#[test]
fn the_published_file_opens_with_the_passphrase() {
    let vectors = age();
    let file = file(&vectors, "open", "with the passphrase");
    assert_eq!(lock(&file), Ok(Lock::Passphrase));
    let plain = decrypt(&file, Opener::Passphrase(text(&vectors, "passphrase"))).unwrap();
    assert_eq!(hex_of_bytes(&plain), text(&vectors, "plaintext"));
}

#[test]
fn the_files_a_reader_refuses_are_refused_for_their_reason() {
    let vectors = age();
    let cases = [
        (
            "the session key and a second key",
            FileRefusal::SeveralRecipients("X25519"),
            "core.candidate-file-refusal.several-recipients",
            "The candidate file must have exactly one X25519 recipient.",
        ),
        (
            "a post-quantum recipient",
            FileRefusal::RecipientUnsupported,
            "core.candidate-file-refusal.recipient-unsupported",
            "The candidate file must have exactly one X25519 or scrypt recipient.",
        ),
        (
            "the scrypt work factor 16",
            FileRefusal::ScryptWorkFactor,
            "core.candidate-file-refusal.scrypt-work-factor-unsupported",
            "The candidate file must use the scrypt work factor 18.",
        ),
    ];
    for (name, refusal, code, message) in cases {
        let refused = lock(&file(&vectors, "refuse", name)).unwrap_err();
        assert_eq!(refused, refusal, "{name}");
        assert_eq!(refused.code(), code, "{name}");
        assert_eq!(refused.to_string(), message, "{name}");
    }
}

#[test]
fn a_file_of_the_other_lock_is_refused_before_any_key() {
    let vectors = age();
    let identity = Identity::parse(text(&vectors, "identity")).unwrap();
    let with_passphrase = file(&vectors, "open", "with the passphrase");
    let to_key = file(&vectors, "open", "to the session key");
    let refusal = decrypt(&with_passphrase, Opener::Identity(&identity)).unwrap_err();
    assert_eq!(refusal, FileRefusal::RecipientOfAnotherKey("X25519"));
    assert_eq!(
        check_lock(&to_key, Lock::Passphrase),
        Err(FileRefusal::RecipientOfAnotherKey("scrypt"))
    );
    assert_eq!(
        lock(b"age-encryption.org/v1\n-> X25519 abc\n"),
        Err(FileRefusal::HeaderWithoutEnd)
    );
    assert_eq!(lock(b"not age"), Err(FileRefusal::NotAge));
}

#[test]
fn a_changed_file_and_another_key_are_refused() {
    let vectors = age();
    let identity = Identity::parse(text(&vectors, "identity")).unwrap();
    let file = file(&vectors, "open", "to the session key");
    let mut changed = file.clone();
    *changed.last_mut().unwrap() ^= 1;
    let refusal = decrypt(&changed, Opener::Identity(&identity)).unwrap_err();
    assert_eq!(refusal, FileRefusal::ContentsDamaged("invalid tag"));
    assert_eq!(
        refusal.to_string(),
        "The candidate file is damaged (invalid tag)."
    );
    let other = Identity::generate(&mut CountingRandom(0)).unwrap();
    let refusal = decrypt(&file, Opener::Identity(&other)).unwrap_err();
    assert_eq!(
        refusal.to_string(),
        "This Scanner key does not open the candidate file, or its header is damaged (no identity matched any of the file's recipients)."
    );
    assert_eq!(
        refusal.code(),
        "core.candidate-file-refusal.scanner-key-does-not-open"
    );
    // A changed MAC: the header no longer authenticates.
    let mac = file
        .windows(5)
        .position(|window| window == b"\n--- ")
        .unwrap()
        + 5;
    let mut changed = file.clone();
    changed[mac] = if changed[mac] == b'A' { b'B' } else { b'A' };
    assert_eq!(
        decrypt(&changed, Opener::Identity(&identity)).err(),
        Some(FileRefusal::ScannerKeyDoesNotOpen("invalid header HMAC"))
    );
    // The payload cut after its nonce, and inside it.
    let payload = payload_start(&file);
    assert_eq!(
        decrypt(&file[..payload + 16], Opener::Identity(&identity)).err(),
        Some(FileRefusal::ContentsDamaged(
            "\"ciphertext\" expected length >= tagLength=16"
        ))
    );
    assert_eq!(
        decrypt(&file[..payload + 8], Opener::Identity(&identity)).err(),
        Some(FileRefusal::ScannerKeyDoesNotOpen(
            "stream ended before reading 16 bytes"
        ))
    );
}

#[test]
fn a_list_encrypted_here_opens_again() {
    let vectors = age();
    let identity = Identity::generate(&mut CountingRandom(7)).unwrap();
    let plain = bytes_of_hex(text(&vectors, "plaintext")).unwrap();
    let file = encrypt(
        &plain,
        To::Recipient(&identity.recipient()),
        &mut CountingRandom(40),
    )
    .unwrap();
    assert_eq!(lock(&file), Ok(Lock::Key));
    let opened = decrypt(&file, Opener::Identity(&identity)).unwrap();
    assert_eq!(*opened, *plain);
    // A list of more than one chunk, its last one full.
    let long = vec![0x5a; 64 * 1024 * 2];
    let file = encrypt(
        &long,
        To::Recipient(&identity.recipient()),
        &mut CountingRandom(90),
    )
    .unwrap();
    assert_eq!(*decrypt(&file, Opener::Identity(&identity)).unwrap(), *long);
    // The last of its two chunks taken away: the first is not the last.
    let cut = &file[..file.len() - (64 * 1024 + 16)];
    assert_eq!(
        decrypt(cut, Opener::Identity(&identity)).err(),
        Some(FileRefusal::ContentsDamaged("invalid tag"))
    );
}

#[test]
fn a_list_encrypted_with_a_passphrase_opens_again() {
    let vectors = age();
    let plain = bytes_of_hex(text(&vectors, "plaintext")).unwrap();
    let passphrase = text(&vectors, "passphrase");
    let file = encrypt(&plain, To::Passphrase(passphrase), &mut CountingRandom(3)).unwrap();
    assert_eq!(lock(&file), Ok(Lock::Passphrase));
    assert_eq!(
        *decrypt(&file, Opener::Passphrase(passphrase)).unwrap(),
        *plain
    );
    assert_eq!(
        decrypt(&file, Opener::Passphrase("another passphrase")).err(),
        Some(FileRefusal::PassphraseDoesNotOpen(
            "no identity matched any of the file's recipients"
        ))
    );
}

#[test]
fn an_empty_passphrase_a_long_list_and_a_failed_source_are_refused() {
    let vectors = age();
    let plain = bytes_of_hex(text(&vectors, "plaintext")).unwrap();
    let refusal = encrypt(&plain, To::Passphrase(""), &mut CountingRandom(0)).unwrap_err();
    assert_eq!(refusal, EncryptionError::PassphraseEmpty);
    assert_eq!(
        refusal.code(),
        "core.candidate-encryption.passphrase-candidates-empty"
    );
    let recipient = Recipient::parse(text(&vectors, "recipient")).unwrap();
    let long = vec![0; mnemocode::candidates::format::MAX_CANDIDATE_LIST_BYTES + 1];
    assert_eq!(
        encrypt(&long, To::Recipient(&recipient), &mut CountingRandom(0)).err(),
        Some(EncryptionError::File(FileRefusal::PlaintextTooLarge))
    );
    assert_eq!(
        encrypt(&plain, To::Recipient(&recipient), &mut FailedRandom).err(),
        Some(EncryptionError::Random(RandomError::Unavailable))
    );
}

#[test]
fn a_key_of_small_order_is_refused() {
    // The point 0 of Curve25519: its shared secret is zero whatever the other key.
    let zero = bech32::encode::<Bech32>(Hrp::parse("age").unwrap(), &[0; 32]).unwrap();
    let small = Recipient::parse(&zero).unwrap();
    assert_eq!(
        encrypt(&[1, 2, 3], To::Recipient(&small), &mut CountingRandom(0)).err(),
        Some(EncryptionError::Recipient)
    );
    // A file whose share is that point.
    let vectors = age();
    let identity = Identity::parse(text(&vectors, "identity")).unwrap();
    let file = file(&vectors, "open", "to the session key");
    let share_start = b"age-encryption.org/v1\n-> X25519 ".len();
    let mut changed = file[..share_start].to_vec();
    changed.extend_from_slice(&[b'A'; 43]);
    changed.extend_from_slice(&file[share_start + 43..]);
    assert_eq!(
        decrypt(&changed, Opener::Identity(&identity)).err(),
        Some(FileRefusal::ScannerKeyDoesNotOpen(
            "invalid private or public key received"
        ))
    );
}

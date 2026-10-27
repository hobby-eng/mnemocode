//! The age test kit of C2SP CCTV (vectors/cctv-age/, PROVENANCE.json): each file opened with its
//! identity or passphrase. A file age opens either opens here to its payload or is refused by the
//! admission, which lets in only the one-recipient binary files MnemoCode writes; a file age
//! refuses is refused here too.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]

use mnemocode::candidates::admission::lock;
use mnemocode::candidates::age::{Identity, Opener, decrypt};
use mnemocode::text::hex::hex_of_bytes;
use sha2::{Digest, Sha256};

/// The files that open here: every one of one X25519 recipient in binary form that age opens. The
/// admission refuses the others age opens: armored files, scrypt at work factors other than
/// MnemoCode's 2^18, and headers of more than one stanza.
const OPENED: [&str; 9] = [
    "stream_257_chunks",
    "stream_257_chunks_full",
    "stream_258_chunks",
    "stream_empty_payload",
    "stream_last_chunk_full",
    "stream_last_chunk_full_second",
    "stream_three_chunks",
    "stream_two_chunks",
    "x25519",
];

/// The files of the test kit, each with its name, read in at build time.
macro_rules! test_kit {
    ($($name:literal,)*) => {
        [$(($name, include_bytes!(concat!("../../../vectors/cctv-age/", $name)).as_slice()),)*]
    };
}

const TEST_KIT: [(&str, &[u8]); 123] = test_kit![
    "armor",
    "armor_crlf",
    "armor_empty",
    "armor_empty_last_line",
    "armor_empty_line_begin",
    "armor_empty_line_end",
    "armor_eol_between_padding",
    "armor_full_last_line",
    "armor_garbage_encoded",
    "armor_garbage_leading",
    "armor_garbage_trailing",
    "armor_header_crlf",
    "armor_headers",
    "armor_invalid_character_header",
    "armor_invalid_character_payload",
    "armor_long_line",
    "armor_lowercase",
    "armor_no_end_line",
    "armor_no_eol",
    "armor_no_match",
    "armor_no_padding",
    "armor_not_canonical",
    "armor_pgp_checksum",
    "armor_short_line",
    "armor_whitespace_begin",
    "armor_whitespace_end",
    "armor_whitespace_eol",
    "armor_whitespace_last_line",
    "armor_whitespace_line_start",
    "armor_whitespace_outside",
    "armor_wrong_type",
    "empty",
    "header_crlf",
    "hmac_bad",
    "hmac_extra_space",
    "hmac_garbage",
    "hmac_missing",
    "hmac_no_space",
    "hmac_not_canonical",
    "hmac_trailing_space",
    "hmac_truncated",
    "scrypt",
    "scrypt_and_x25519",
    "scrypt_bad_tag",
    "scrypt_double",
    "scrypt_extra_argument",
    "scrypt_long_file_key",
    "scrypt_no_match",
    "scrypt_not_canonical_body",
    "scrypt_not_canonical_salt",
    "scrypt_salt_long",
    "scrypt_salt_missing",
    "scrypt_salt_short",
    "scrypt_uppercase",
    "scrypt_work_factor_23",
    "scrypt_work_factor_hex",
    "scrypt_work_factor_leading_garbage",
    "scrypt_work_factor_leading_plus",
    "scrypt_work_factor_leading_zero_decimal",
    "scrypt_work_factor_leading_zero_octal",
    "scrypt_work_factor_missing",
    "scrypt_work_factor_negative",
    "scrypt_work_factor_overflow",
    "scrypt_work_factor_trailing_garbage",
    "scrypt_work_factor_wrong",
    "scrypt_work_factor_zero",
    "stanza_bad_start",
    "stanza_base64_padding",
    "stanza_empty_argument",
    "stanza_empty_body",
    "stanza_empty_last_line",
    "stanza_invalid_character",
    "stanza_long_line",
    "stanza_missing_body",
    "stanza_missing_final_line",
    "stanza_multiple_short_lines",
    "stanza_no_arguments",
    "stanza_not_canonical",
    "stanza_spurious_cr",
    "stanza_valid_characters",
    "stream_257_chunks",
    "stream_257_chunks_full",
    "stream_258_chunks",
    "stream_bad_tag",
    "stream_bad_tag_second_chunk",
    "stream_bad_tag_second_chunk_full",
    "stream_empty_payload",
    "stream_last_chunk_empty",
    "stream_last_chunk_full",
    "stream_last_chunk_full_second",
    "stream_missing_tag",
    "stream_no_chunks",
    "stream_no_final",
    "stream_no_final_full",
    "stream_no_final_two_chunks",
    "stream_no_final_two_chunks_full",
    "stream_no_nonce",
    "stream_short_chunk",
    "stream_short_nonce",
    "stream_short_second_chunk",
    "stream_three_chunks",
    "stream_trailing_garbage_long",
    "stream_trailing_garbage_short",
    "stream_two_chunks",
    "stream_two_final_chunks",
    "stream_two_final_chunks_full",
    "stream_two_final_chunks_second",
    "stream_two_final_chunks_short",
    "version_unsupported",
    "x25519",
    "x25519_bad_tag",
    "x25519_extra_argument",
    "x25519_grease",
    "x25519_identity",
    "x25519_long_file_key",
    "x25519_long_share",
    "x25519_low_order",
    "x25519_lowercase",
    "x25519_multiple_recipients",
    "x25519_no_match",
    "x25519_not_canonical_body",
    "x25519_not_canonical_share",
    "x25519_short_share",
];

/// One test file: its header fields and its age file.
struct TestFile {
    fields: Vec<(String, String)>,
    file: Vec<u8>,
}

impl TestFile {
    fn read(bytes: &[u8]) -> Self {
        let end = bytes.windows(2).position(|pair| pair == b"\n\n").unwrap();
        let fields: Vec<(String, String)> = std::str::from_utf8(&bytes[..end])
            .unwrap()
            .lines()
            .map(|line| {
                let (key, value) = line.split_once(": ").unwrap();
                (key.to_owned(), value.to_owned())
            })
            .collect();
        let body = &bytes[end + 2..];
        let compressed = fields
            .iter()
            .any(|(key, value)| key == "compressed" && value == "zlib");
        let file = if compressed {
            miniz_oxide::inflate::decompress_to_vec_zlib(body).unwrap()
        } else {
            body.to_vec()
        };
        Self { fields, file }
    }

    fn field(&self, key: &str) -> Option<&str> {
        self.fields
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }
}

#[test]
fn every_test_file_opens_as_age_opens_it_or_is_refused() {
    let names: Vec<&str> = TEST_KIT.iter().map(|(name, _)| *name).collect();
    assert!(names.is_sorted_by(|left, right| left < right));
    let mut opened = Vec::new();
    for (name, bytes) in TEST_KIT {
        let test = TestFile::read(bytes);
        let expect = test.field("expect").unwrap();
        let identity = test
            .field("identity")
            .map(|text| Identity::parse(text).unwrap());
        let opener = match (&identity, test.field("passphrase")) {
            (Some(identity), _) => Opener::Identity(identity),
            (None, Some(passphrase)) => Opener::Passphrase(passphrase),
            // A file age refuses before it reads a key gives none.
            (None, None) => {
                assert_ne!(expect, "success", "{name}");
                assert!(lock(&test.file).is_err(), "{name}");
                continue;
            }
        };
        match decrypt(&test.file, opener) {
            Ok(plain) => {
                assert_eq!(expect, "success", "{name}: opened");
                let payload = hex_of_bytes(&Sha256::digest(&*plain));
                assert_eq!(Some(payload.as_str()), test.field("payload"), "{name}");
                opened.push(name);
            }
            Err(refusal) => {
                // A file that age opens is refused here only by the admission.
                if expect == "success" {
                    assert!(lock(&test.file).is_err(), "{name}: {refusal}");
                }
            }
        }
    }
    assert_eq!(opened, OPENED);
}

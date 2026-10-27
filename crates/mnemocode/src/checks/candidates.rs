//! The candidate lists row (MnemoCode TS 0.1.0's `core/candidate-list-self-test.ts`,
//! `candidate-list-writer-self-test.ts` and `candidate-encryption-self-test.ts`): the published
//! list of three phrases written and read, with a passphrase for all and with passphrases of their
//! own, Padmé's lengths and the lists a reader refuses; the writer; and in the full self-test the
//! gate's known answers of age and scrypt's, which is slow.

use super::{Row, ok};
use crate::candidates::admission::check_plaintext_size;
use crate::candidates::format::{
    CandidateList, ListPassphrases, MAX_CANDIDATE_LIST_BYTES, padme_length,
};
use crate::candidates::gate::{Gate, known_answers, passphrase_answer};
use crate::candidates::protection::Protection;
use crate::candidates::writer::{ListOutcome, Writer};
use crate::random::NoRandomness;
use crate::secret::SecretBytes;
use crate::self_check::vectors::{THREE_PHRASES_ENTROPY, THREE_PHRASES_LIST};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};
use crate::text::hex::{bytes_of_hex, hex_of_bytes};

/// vectors/candidates-v1.json, "a passphrase for all": the three phrases with the list passphrase
/// TREZOR, which every record takes.
const LIST_PASSPHRASE_LIST: &str = "4d4e434c0101100000000300065452455a4f52000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff969c8d9700";
const LIST_PASSPHRASE: &str = "TREZOR";
/// vectors/candidates-v1.json, "passphrases of their own, the second falling back to the one for
/// all", and the passphrase each candidate is checked with by the rule of docs/CANDIDATES.md.
const OWN_PASSPHRASES_LIST: &str = "4d4e434c0103100000000300065452455a4f5200000000000000000000000000000000000a70c3a4737377c3b672647f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f0000ffffffffffffffffffffffffffffffff0011efbd90efbd81efbd93efbd9320f09f9491801cb406";
const OWN_PASSPHRASES: [&str; 3] = ["pässwörd", "TREZOR", "ｐａｓｓ 🔑"];
/// Lists that a reader refuses (vectors/candidates-v1.json, "invalidLists"), and why.
const REFUSED_LISTS: [(&str, &str, &str); 2] = [
    (
        "A list with a damaged record",
        "4d4e434c01001000000003010000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7fffffffffffffffffffffffffffffffff98854aa000",
        "core.candidate-list.candidate-list-damaged-crc-32-does-not-match",
    ),
    (
        "A list with version 2",
        "4d4e434c02001000000003000000000000000000000000000000007f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7ffffffffffffffffffffffffffffffffffe819f9000",
        "core.candidate-list.candidate-list-version-not-supported",
    ),
];
/// Lengths before and after Padmé (vectors/candidates-v1.json, "padme").
const PADME_LENGTHS: [(usize, usize); 3] = [(100, 104), (4_097, 4_352), (8_388_623, 8_650_752)];

/// The row.
pub(super) const ROW: Row = Row::new(
    "Candidate lists",
    "MNCL bytes, Padmé, writer, refusals; age files and scrypt",
    run,
);

/// The bytes of the hexadecimal `text`, a constant of this module.
fn bytes(text: &str) -> Result<Vec<u8>, CheckFailure> {
    ok(bytes_of_hex(text))
}

/// The entropies of the three phrases, one after another.
fn three_entropies() -> Result<SecretBytes, CheckFailure> {
    let joined = bytes(&THREE_PHRASES_ENTROPY.concat())?;
    Ok(SecretBytes::copy_of("test entropies", &joined))
}

/// The list of the three phrases, read back from its bytes.
fn list_answers() -> Result<(), CheckFailure> {
    expect_same(
        &MAX_CANDIDATE_LIST_BYTES,
        &155_189_248,
        "Maximum candidate list bytes",
    )?;
    expect_refused(
        check_plaintext_size(MAX_CANDIDATE_LIST_BYTES + 1),
        "core.candidate-file-refusal.plaintext-list-too-large",
        "An oversized candidate list",
    )?;
    let written = ok(CandidateList::new(three_entropies()?, 16, None, &[]))?;
    expect_same(
        hex_of_bytes(&written.encode()).as_str(),
        THREE_PHRASES_LIST,
        "Candidate list",
    )?;
    let read = ok(CandidateList::decode(&bytes(THREE_PHRASES_LIST)?))?;
    expect_same(
        &read.passphrases(),
        &ListPassphrases::None,
        "Candidate list passphrase",
    )?;
    let mut entropies = Vec::new();
    for place in 0..read.count() {
        let (phrase, _) = ok(read.candidate(place))?;
        let (entropy, length) = ok(phrase.mnemonic())?.to_entropy_array();
        entropies.push(hex_of_bytes(&entropy[..length]));
    }
    expect_same(
        &entropies.join(" "),
        &THREE_PHRASES_ENTROPY.join(" "),
        "Candidate list records",
    )?;
    for (length, padded) in PADME_LENGTHS {
        expect_same(&padme_length(length), &padded, "Padmé length")?;
    }
    for (name, list, code) in REFUSED_LISTS {
        expect_refused(CandidateList::decode(&bytes(list)?), code, name)?;
    }
    expect_refused(
        CandidateList::decode(&bytes(&format!("{THREE_PHRASES_LIST}00"))?),
        "core.candidate-list.candidate-list-wrong-padding",
        "A list with a byte too many",
    )?;
    let with_passphrase = ok(CandidateList::new(
        three_entropies()?,
        16,
        Some(LIST_PASSPHRASE),
        &[],
    ))?;
    expect_same(
        hex_of_bytes(&with_passphrase.encode()).as_str(),
        LIST_PASSPHRASE_LIST,
        "Candidate list with a passphrase for all",
    )?;
    let read = ok(CandidateList::decode(&bytes(LIST_PASSPHRASE_LIST)?))?;
    expect_same(
        ok(read.candidate(0))?.1,
        LIST_PASSPHRASE,
        "Candidate list passphrase for all",
    )?;
    let read = ok(CandidateList::decode(&bytes(OWN_PASSPHRASES_LIST)?))?;
    let mut own = Vec::new();
    for place in 0..read.count() {
        own.push(ok(read.candidate(place))?.1.to_owned());
    }
    expect_same(
        &own.join("|"),
        &OWN_PASSPHRASES.join("|"),
        "Candidate list passphrase of each record",
    )
}

/// The writer: the three phrases' list in the open, no list of no candidate, and a passphrase
/// longer than a list stores refused.
fn writer_answers() -> Result<(), CheckFailure> {
    let writer = ok(Writer::new(Protection::None, ""))?;
    let mut gate = Gate::new();
    let written = ok(writer.write(three_entropies()?, 16, &mut gate, &mut NoRandomness))?;
    let ListOutcome::List(list) = written else {
        return Err(CheckFailure::Mismatch("Candidate list written"));
    };
    expect_same(
        hex_of_bytes(&list.bytes).as_str(),
        THREE_PHRASES_LIST,
        "Candidate list written: bytes",
    )?;
    expect_same(&list.records, &3, "Candidate list written: records")?;
    expect_same(
        &list.encrypted,
        &false,
        "Candidate list written in the open",
    )?;
    let empty = ok(writer.write(
        SecretBytes::zeroed("no entropy", 0),
        16,
        &mut gate,
        &mut NoRandomness,
    ))?;
    expect_same(
        &matches!(empty, ListOutcome::Empty),
        &true,
        "Candidate list of no candidate",
    )?;
    expect_refused(
        Writer::new(Protection::None, &"x".repeat(257)),
        "core.candidate-list.longer-than-bytes",
        "A BIP39 passphrase longer than a list stores",
    )
}

fn run(tier: Tier) -> Result<(), CheckFailure> {
    list_answers()?;
    writer_answers()?;
    if tier == Tier::Full {
        known_answers()?;
        passphrase_answer()?;
    }
    Ok(())
}

//! Entries for the `wasm` gate's memory scan of the binding itself, built only into the test
//! profile `test/probe` (wasm-profiles.json), never into a page's file: each takes a public marker
//! the way a secret entry takes a secret, and the gate searches the instance's memory for it after
//! the call (B-WIPE). They show that the zeroing allocator wipes a freed and a reallocated block and
//! that `after_secret` scrubs the stack of the work it runs, that a page's string a secret entry
//! reads (`host::text`) leaves nothing once dropped, and that the share engine's split and restore
//! leave no copy of the secret; `probeRefusal` shows a refusal's kind and code as a page receives
//! them. `probeRow` runs one row of the library's self-check, its known answers of every part's
//! secret work on public data, for the gate to read how deep the row's stack goes against
//! `probeScrubBytes` (ARCHITECTURE.md §6). `probeEntries` calls every secret entry of the binding
//! on public secrets of two lengths. In one instance it tells the gate each secret, seed, key and
//! share it meets; in another, which holds the same randomness, it calls them with the secrets a
//! page gives, and the gate searches the stack after each entry and the memory after the last. It
//! calls the Rust functions behind the generated wrappers, which pass on references alone.

use mnemocode::bip32::{ExtendedKey, HARDENED_OFFSET};
use mnemocode::bip39::phrase::Phrase;
use mnemocode::bip39::seed::seed;
use mnemocode::candidates::format::CandidateList;
use mnemocode::checks::rows;
use mnemocode::dates::{Date, parse_date};
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::random::{Random, RandomError};
use mnemocode::secret::STACK_SCRUB_BYTES;
use mnemocode::self_check::{Check, Tier};
use mnemocode::sskr::engine::{Group, combine, split};
use mnemocode::sskr::forms::{ShareFormat, read_share};
use mnemocode::text::hex::{bytes_of_hex, hex_of_bytes};
use mnemocode::text::pieces::PiecesError;
use wasm_bindgen::prelude::*;

use crate::candidates::{
    OpenedCandidateList, SessionIdentity, decrypt_with_passphrase, protect_list,
};
use crate::host::{after_secret, refused, text};
use crate::phrase::{EncodedBackup, likely_form, master_fingerprint};
use crate::qr::{QrMatrix, qr_png, read_qr_png};
use crate::sskr::{RestoredShares, SplitShares, check_qr, share_form, write_share};
use crate::wallet::WalletEvidence;

/// The first address of the wallet's native SegWit branch, which the wallet part derives.
const FIRST_ADDRESS: [u32; 5] = [HARDENED_OFFSET + 84, HARDENED_OFFSET, HARDENED_OFFSET, 0, 0];
/// The public master fingerprint the wallet is compared with: no phrase here has it.
const FINGERPRINT: &str = "73c5da0a";
/// The word of a share marked with ?.
const MARKED_PLACE: usize = 8;
/// How shares are split: the threshold and the count.
const LAYOUTS: [(u8, u8); 2] = [(2, 3), (3, 5)];

/// Copies `marker` into a heap block of its own and frees it.
#[wasm_bindgen(js_name = probeFreed)]
pub fn probe_freed(marker: &[u8]) {
    let copy = marker.to_vec();
    std::hint::black_box(&copy);
}

/// Grows a vector byte by byte to hold `marker` several times over, so that it is reallocated as
/// it grows, then shrinks it and frees it.
#[wasm_bindgen(js_name = probeGrown)]
pub fn probe_grown(marker: &[u8]) {
    let mut grown = Vec::new();
    for _ in 0..8 {
        for byte in marker {
            grown.push(*byte);
        }
    }
    grown.truncate(marker.len());
    grown.shrink_to_fit();
    std::hint::black_box(&grown);
}

/// Copies `marker` into an array on the stack of work run through `after_secret`.
#[wasm_bindgen(js_name = probeStack)]
pub fn probe_stack(marker: &[u8]) {
    after_secret(|| {
        let mut area = [0_u8; 256];
        let length = marker.len().min(area.len());
        area[..length].copy_from_slice(&marker[..length]);
        std::hint::black_box(&mut area);
    });
}

/// Reads `value`, a page's string holding the marker, as a secret entry reads its text, inside
/// `after_secret`, and drops it.
#[wasm_bindgen(js_name = probeText)]
pub fn probe_text(value: JsValue) {
    after_secret(|| {
        if let Ok(read) = text(&value) {
            std::hint::black_box(&read);
        }
    });
}

/// A public pattern in place of randomness: the probe file imports no browser randomness.
struct Pattern;

impl Random for Pattern {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = index as u8;
        }
        Ok(())
    }
}

/// Splits the first 32 bytes of `marker`, as a secret of the longest phrase, into shares, two of
/// three needed, and restores it from two, then drops every share and the secret.
#[wasm_bindgen(js_name = probeShares)]
pub fn probe_shares(marker: &[u8]) {
    after_secret(|| {
        let secret = &marker[..marker.len().min(32)];
        let group = [Group {
            threshold: 2,
            count: 3,
        }];
        if let Ok(shares) = split(secret, 1, &group, &mut Pattern) {
            let restored = combine(&[&shares[0], &shares[1]]);
            std::hint::black_box(&restored);
        }
    });
}

/// The bytes of the stack that `after_secret` scrubs.
#[wasm_bindgen(js_name = probeScrubBytes)]
pub fn probe_scrub_bytes() -> usize {
    STACK_SCRUB_BYTES
}

/// Scrubs the stack, as a secret entry does at its end.
#[wasm_bindgen(js_name = probeScrub)]
pub fn probe_scrub() {
    after_secret(|| ());
}

/// The rows of the library's self-check in this file.
#[wasm_bindgen(js_name = probeRowCount)]
pub fn probe_row_count() -> usize {
    rows().count()
}

/// Whether the row at `place` passes with every case, run outside `after_secret`: the scrub would
/// hide how deep the row went, and what it leaves on the stack.
#[wasm_bindgen(js_name = probeRow)]
pub fn probe_row(place: usize) -> bool {
    rows()
        .nth(place)
        .is_some_and(|row| row.run(Tier::Full).is_ok())
}

#[wasm_bindgen]
extern "C" {
    /// Lets the gate look at the stack that the entry of `step` left.
    #[wasm_bindgen(js_namespace = globalThis, js_name = probeEntryReturned)]
    fn entry_returned(step: &str);
}

/// One walk through the entries. Where it is `telling`, it says each secret it meets: one line, `b`
/// and its bytes in hexadecimal, `t` and its text, `l` and a list's bytes. Otherwise it touches no
/// secret of its own, as a page touches none, and the gate looks at the stack after each entry.
/// Either way `!` and the step tell of an entry that did not answer as it should.
struct Met {
    telling: bool,
    told: String,
}

impl Met {
    fn bytes(&mut self, bytes: &[u8]) {
        self.line('b', &hex_of_bytes(bytes));
    }

    fn text(&mut self, text: &str) {
        self.line('t', text);
    }

    /// The entry of `step` did not answer as it should: told in every walk.
    fn failed(&mut self, step: &str) {
        self.told.push_str("! ");
        self.told.push_str(step);
        self.told.push('\n');
    }

    fn line(&mut self, kind: char, text: &str) {
        if self.telling {
            self.told.push(kind);
            self.told.push(' ');
            self.told.push_str(text);
            self.told.push('\n');
        }
    }

    /// The entry of `step` returned.
    fn returned(&self, step: &str) {
        if !self.telling {
            entry_returned(step);
        }
    }

    /// What the entry of `step` returned.
    fn gave<T>(&self, step: &str, value: T) -> T {
        self.returned(step);
        value
    }

    /// What `result`, of the entry of `step`, holds; a refusal is told as a line.
    fn ok<T>(&mut self, step: &str, result: Result<T, JsValue>) -> Option<T> {
        self.returned(step);
        match result {
            Ok(value) => Some(value),
            Err(_) => {
                self.failed(step);
                None
            }
        }
    }

    /// `result`, of the entry of `step`, which must refuse an argument beside a secret.
    fn refused<T>(&mut self, step: &str, result: Result<T, JsValue>) {
        self.returned(step);
        if result.is_ok() {
            self.failed(step);
        }
    }

    /// A line for each of `texts`, and what each share holds as bytes.
    fn shares(&mut self, texts: &[String]) {
        for share in texts {
            self.text(share);
            if self.telling
                && let Ok(read) = read_share(share)
            {
                self.bytes(read.share.payload());
            }
        }
    }
}

/// `text` as a page passes it.
fn js(text: &str) -> JsValue {
    JsValue::from_str(text)
}

/// What the entries are given, each as a page's string, so that the file holds none of it.
#[derive(Clone, Copy)]
struct Given<'a> {
    phrase: &'a str,
    passphrase: &'a str,
    dates: &'a str,
    wif: &'a str,
}

/// `values` as little-endian bytes.
fn little_endian(values: impl Iterator<Item = u16>) -> Vec<u8> {
    values.flat_map(u16::to_le_bytes).collect()
}

/// Says each secret that the entries derive from what they are `given`.
fn tell_phrase(given: Given<'_>, met: &mut Met) {
    let Ok(phrase) = Phrase::parse(given.phrase) else {
        met.failed("phrase");
        return;
    };
    met.text(given.phrase);
    met.text(given.dates);
    met.text(given.passphrase);
    met.text(given.wif);
    if let Ok(entropy) = phrase.entropy() {
        met.bytes(&entropy);
    }
    let indexes = (0..phrase.len()).map(|place| phrase.index(place).unwrap_or(0) as u16);
    met.bytes(&little_endian(indexes));
    for passphrase in [given.passphrase, ""] {
        if let Ok(made) = seed(&phrase, passphrase) {
            met.bytes(&made);
        }
        if let Ok(root) = ExtendedKey::of_phrase(&phrase, passphrase) {
            met.bytes(root.private_key());
            if let Ok(child) = root.derive(&FIRST_ADDRESS) {
                met.bytes(child.private_key());
            }
        }
    }
    let dates: Vec<Date> = given
        .dates
        .split(' ')
        .filter_map(|date| parse_date(date).ok())
        .collect();
    if let Ok(masked) = Mode::Seedshift.encode(&phrase, &dates) {
        met.bytes(&little_endian(masked.shifted.as_slice().iter().copied()));
        let shifts: Vec<u8> = masked.shifts.iter().flat_map(u16::to_be_bytes).collect();
        met.bytes(&shifts);
        if let Ok(codes) = Form::English.codes(masked.shifted.as_slice()) {
            met.text(&codes);
        }
    }
}

/// The candidate list of what the entries are `given`, told.
fn tell_list(given: Given<'_>, met: &mut Met) -> Vec<u8> {
    let list = Phrase::parse(given.phrase)
        .ok()
        .and_then(|phrase| phrase.entropy().ok())
        .and_then(|entropy| {
            let length = entropy.len();
            CandidateList::new(entropy, length, Some(given.passphrase), &[]).ok()
        });
    let Some(list) = list else {
        met.failed("candidate list");
        return Vec::new();
    };
    let bytes = list.encode().to_vec();
    met.line('l', &hex_of_bytes(&bytes));
    bytes
}

/// The phrase part's entries.
fn phrase_entries(given: Given<'_>, met: &mut Met) {
    for (form, mode, dates) in [
        ("english", "seedshift", js(given.dates)),
        ("unicode", "direct", JsValue::UNDEFINED),
        ("colors", "seedshift-legacy", js(given.dates)),
    ] {
        let encoded = EncodedBackup::encode(js(given.phrase), dates, js(form), js(mode), false);
        let Some(backup) = met.ok("encode", encoded) else {
            continue;
        };
        if let Some(codes) = met.ok("codes", backup.codes()) {
            met.text(&codes);
        }
        // Its header names the mode and the form, which the file holds too.
        if let Some(record) = met.ok("record", backup.record())
            && let Some((_, codes)) = record.rsplit_once(':')
        {
            met.text(codes);
        }
        met.ok("encoded fingerprint", backup.encoded_fingerprint());
        drop(backup);
        met.returned("drop of a backup");
    }
    met.ok("likely form", likely_form(js(given.phrase)));
    let fingerprint = master_fingerprint(js(given.phrase), js(given.passphrase));
    met.ok("master fingerprint", fingerprint);
    let refused = EncodedBackup::encode(
        js(given.phrase),
        js(given.dates),
        js("no form"),
        js("seedshift"),
        false,
    );
    met.refused("encode in no form", refused);
}

/// The wallet part's entries.
fn wallet_entries(given: Given<'_>, met: &mut Met) {
    let evidence = WalletEvidence::master_fingerprint(FINGERPRINT);
    if let Some(evidence) = met.ok("fingerprint evidence", evidence) {
        let check = evidence.check(js(given.phrase), js(given.passphrase));
        met.ok("wallet check", check);
    }
    let evidence = WalletEvidence::wif(
        js(given.wif),
        js("mainnet"),
        js("native-segwit"),
        0.0,
        0.0,
        0.0,
        f64::NAN,
    );
    if let Some(evidence) = met.ok("wif evidence", evidence) {
        met.ok(
            "wif check",
            evidence.check(js(given.phrase), JsValue::UNDEFINED),
        );
    }
    let refused = WalletEvidence::wif(
        js(given.wif),
        js("no network"),
        js("native-segwit"),
        0.0,
        0.0,
        0.0,
        f64::NAN,
    );
    met.refused("wif on no network", refused);
}

/// The QR part's entries on `phrase`.
fn qr_entries(phrase: &str, met: &mut Met) {
    met.ok("qr matrix", QrMatrix::of(js(phrase)));
    if let Some(image) = met.ok("qr png", qr_png(js(phrase))) {
        met.ok("read qr png", read_qr_png(&image));
    }
    met.refused("read no png", read_qr_png(phrase.as_bytes()));
}

/// A list opened, candidate by candidate.
fn opened_entries(opened: &[u8], met: &mut Met) {
    if let Some(read) = met.ok("read", OpenedCandidateList::read(opened)) {
        met.ok("candidate phrase", read.phrase(0.0));
        met.ok("candidate passphrase", read.passphrase(0.0));
        drop(read);
        met.returned("drop of a list");
    }
}

/// The candidates part's entries on `list`, under a session key.
fn candidate_entries(list: &[u8], met: &mut Met) {
    let Some(mut identity) = met.ok("session key", SessionIdentity::create()) else {
        return;
    };
    if let Some(recipient) = met.ok("recipient", identity.recipient()) {
        let protected = protect_list(list, js("key"), js(&recipient));
        if let Some(file) = met.ok("protect list", protected)
            && let Some(opened) = met.ok("decrypt", identity.decrypt(&file))
        {
            opened_entries(&opened, met);
        }
    }
    identity.wipe();
    met.returned("wipe of a session key");
}

/// The candidates part's entries on `list`, under `passphrase`: scrypt's, which take minutes here.
fn passphrase_entries(list: &[u8], passphrase: &str, met: &mut Met) {
    let protected = protect_list(list, js("passphrase"), js(passphrase));
    if let Some(file) = met.ok("protect under a passphrase", protected) {
        let opened = decrypt_with_passphrase(&file, js(passphrase));
        met.ok("decrypt with a passphrase", opened);
    }
}

/// The shares `shares` restored from as many as `threshold`.
fn restored_entries(shares: &[String], threshold: usize, met: &mut Met) {
    let typed: Vec<JsValue> = shares[..threshold].iter().map(|share| js(share)).collect();
    let Some(restored) = met.ok("restore", RestoredShares::restore(typed)) else {
        return;
    };
    let held = met.gave("restored phrase", restored.phrase());
    met.text(&held);
    let again = met.gave("restored shares", restored.shares());
    met.shares(&again);
    met.gave("repair lines", restored.repair_lines());
    met.gave("unchecked note", restored.unchecked_note());
    drop(restored);
    met.returned("drop of a restore");
    met.ok("share form", share_form(js(&shares[0])));
    if let Some(written) = met.ok("write share", write_share(js(&shares[0]), js("words"))) {
        met.text(&written);
    }
    met.refused(
        "write in no form",
        write_share(js(&shares[0]), js("no form")),
    );
    let typed = vec![js(&shares[0]), js("zzz")];
    met.refused("restore of no share", RestoredShares::restore(typed));
}

/// The shares part's entries: every form, split and restored, and a marked share.
fn share_entries(given: Given<'_>, met: &mut Met) {
    for format in ShareFormat::ALL {
        for (threshold, count) in LAYOUTS {
            let split = SplitShares::split(
                js(given.phrase),
                js(given.dates),
                js("seedshift"),
                f64::from(threshold),
                f64::from(count),
                js(format.name()),
            );
            let Some(split) = met.ok("split", split) else {
                continue;
            };
            let shares = met.gave("shares of a split", split.shares());
            met.shares(&shares);
            met.ok("keeping note", split.keeping_note(js("files")));
            drop(split);
            met.returned("drop of a split");
            restored_entries(&shares, usize::from(threshold), met);
            if format == ShareFormat::Colors {
                let payload = write_share(js(&shares[0]), js("ur"));
                if let Some(payload) = met.ok("write share", payload) {
                    let checked = check_qr(js(&shares[0]), js(&payload), JsValue::UNDEFINED);
                    met.ok("check share qr", checked);
                }
            }
        }
    }
    let split = SplitShares::split(
        js(given.phrase),
        js(given.dates),
        js("no mode"),
        2.0,
        3.0,
        js("words"),
    );
    met.refused("split in no mode", split);
    marked_entries(given.phrase, met);
}

/// A share with an element marked, repaired with the others.
fn marked_entries(phrase: &str, met: &mut Met) {
    let split = SplitShares::split(
        js(phrase),
        JsValue::UNDEFINED,
        js("direct"),
        2.0,
        3.0,
        js("words"),
    );
    let Some(split) = met.ok("split", split) else {
        return;
    };
    let shares = met.gave("shares of a split", split.shares());
    met.shares(&shares);
    drop(split);
    met.returned("drop of a split");
    let mut words: Vec<&str> = shares[0].split(' ').collect();
    words[MARKED_PLACE] = "?";
    let marked = words.join(" ");
    met.text(&marked);
    let typed = vec![js(&marked), js(&shares[1])];
    if let Some(restored) = met.ok("restore marked", RestoredShares::restore(typed)) {
        let again = met.gave("restored shares", restored.shares());
        met.shares(&again);
        met.gave("repair lines", restored.repair_lines());
    }
}

/// One walk through the secret entries. `input` holds a line each: the two phrases, the BIP39
/// passphrase, the dates, the key's WIF and, where the walk tells nothing, the two lists in
/// hexadecimal.
fn entries(telling: bool, input: &str) -> String {
    let mut met = Met {
        telling,
        told: String::new(),
    };
    let lines: Vec<&str> = input.lines().collect();
    let [short, long, passphrase, dates, wif, lists @ ..] = lines.as_slice() else {
        met.failed("the input");
        return met.told;
    };
    let lists: Vec<Vec<u8>> = lists
        .iter()
        .filter_map(|list| bytes_of_hex(list).ok())
        .collect();
    let mut first_list = None;
    for (place, phrase) in [short, long].into_iter().enumerate() {
        let given = Given {
            phrase,
            passphrase,
            dates,
            wif,
        };
        if telling {
            tell_phrase(given, &mut met);
        }
        let list = if telling {
            tell_list(given, &mut met)
        } else {
            lists.get(place).cloned().unwrap_or_default()
        };
        phrase_entries(given, &mut met);
        wallet_entries(given, &mut met);
        qr_entries(phrase, &mut met);
        candidate_entries(&list, &mut met);
        share_entries(given, &mut met);
        first_list = first_list.or(Some(list));
    }
    if !telling {
        passphrase_entries(&first_list.unwrap_or_default(), passphrase, &mut met);
    }
    met.told
}

/// Calls every secret entry of the binding on what `input` holds: as a page calls them, with no
/// scrub but their own, or `telling` each secret it meets, for another instance to be searched.
#[wasm_bindgen(js_name = probeEntries)]
pub fn probe_entries(telling: bool, input: JsValue) -> String {
    entries(telling, &text(&input).unwrap_or_default())
}

/// Throws the refusal of a piece width of 0, a `RangeError` in TS.
#[wasm_bindgen(js_name = probeRefusal)]
pub fn probe_refusal() -> Result<(), JsValue> {
    Err(refused(&PiecesError::Width))
}

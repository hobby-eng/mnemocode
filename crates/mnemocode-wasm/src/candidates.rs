//! The candidates part for a page (`browser-candidates`): the Discovery Scanner's session key, an
//! X25519 identity that never leaves the WebAssembly and opens the lists encrypted to its
//! recipient; a list opened with a passphrase; a list protected as the person chose; a list read
//! candidate by candidate; and the part's self-check. Every age operation runs behind the
//! library's gate of known answers, one per instance. A list and its phrases cross as bytes and
//! text, which the page wipes and drops soon after; a list's bytes come first, before anything that
//! could throw, and a passphrase or recipient crosses as a `JsValue` that Rust reads
//! (ARCHITECTURE.md §6).

use std::cell::RefCell;

use mnemocode::candidates::age::{Identity, Opener};
use mnemocode::candidates::format::{CandidateList, ListPassphrases};
use mnemocode::candidates::gate::Gate;
use mnemocode::candidates::protection::Protection;
use mnemocode::checks::Part;
use wasm_bindgen::prelude::*;

use crate::host::{
    BrowserRandom, after_secret, name, optional_text, place, refused, self_check, text,
};

thread_local! {
    /// The gate of this instance: its known answers pass once, before its first operation.
    static GATE: RefCell<Gate> = const { RefCell::new(Gate::new()) };
}

/// The Discovery Scanner's one-time key for a session; only its recipient leaves the WebAssembly,
/// and `wipe()` or `free()` wipes the key.
#[wasm_bindgen]
pub struct SessionIdentity(Option<Identity>);

/// The refusal of a session key used after `wipe()`, as TS refuses a wiped secret value.
#[derive(Debug)]
struct Wiped;

impl std::fmt::Display for Wiped {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("This secret value has been wiped.")
    }
}

impl std::error::Error for Wiped {}

impl mnemocode::refusal::Refusal for Wiped {
    fn code(&self) -> &'static str {
        "core.secret-value.wiped"
    }
}

#[wasm_bindgen]
impl SessionIdentity {
    /// A new key from the browser's randomness, once the gate is open.
    pub fn create() -> Result<SessionIdentity, JsValue> {
        after_secret(|| {
            GATE.with_borrow_mut(|gate| gate.create_identity(&mut BrowserRandom))
                .map(|identity| SessionIdentity(Some(identity)))
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The key; refused once wiped.
    fn key(&self) -> Result<&Identity, JsValue> {
        self.0.as_ref().ok_or_else(|| refused(&Wiped))
    }

    /// Its recipient, age1…, which the writer of a list encrypts to; refused once wiped.
    #[wasm_bindgen(getter)]
    pub fn recipient(&self) -> Result<String, JsValue> {
        after_secret(|| Ok(self.key()?.recipient().text()))
    }

    /// The candidate list in the age `file`, opened with this key; refused for a file of another
    /// lock or shape, one this key does not open, a damaged one, and once the key is wiped.
    pub fn decrypt(&self, file: &[u8]) -> Result<Vec<u8>, JsValue> {
        after_secret(|| {
            let key = self.key()?;
            GATE.with_borrow_mut(|gate| gate.decrypt(file, Opener::Identity(key)))
                .map(|list| list.to_vec())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// Wipes the key now, as `free()` does, and leaves an object that refuses every use.
    pub fn wipe(&mut self) {
        after_secret(|| self.0 = None);
    }
}

/// The candidate list in the age `file`, opened with `passphrase`.
#[wasm_bindgen(js_name = decryptWithPassphrase)]
pub fn decrypt_with_passphrase(file: &[u8], passphrase: JsValue) -> Result<Vec<u8>, JsValue> {
    after_secret(|| {
        let passphrase = text(&passphrase)?;
        GATE.with_borrow_mut(|gate| gate.decrypt(file, Opener::Passphrase(&passphrase)))
            .map(|list| list.to_vec())
            .map_err(|refusal| refused(&refusal))
    })
}

/// The file of `list` protected as `kind` says: "key" encrypts it to the Scanner's recipient in
/// `secret`, "passphrase" under the passphrase in `secret` (at least 12 characters), and "none",
/// only on the person's explicit request, leaves it in the open (`secret` undefined).
#[wasm_bindgen(js_name = protectList)]
pub fn protect_list(list: &[u8], kind: JsValue, secret: JsValue) -> Result<Vec<u8>, JsValue> {
    after_secret(|| protect_text(list, &name(&kind), &optional_text(&secret)?))
}

/// [`protect_list`] of the text read.
fn protect_text(list: &[u8], kind: &str, secret: &str) -> Result<Vec<u8>, JsValue> {
    let protection = Protection::chosen(kind, secret).map_err(|refusal| refused(&refusal))?;
    GATE.with_borrow_mut(|gate| protection.protect(list, gate, &mut BrowserRandom))
        .map(|file| file.to_vec())
        .map_err(|refusal| refused(&refusal))
}

/// A candidate list read from its MNCL bytes, one candidate on request.
#[wasm_bindgen]
pub struct OpenedCandidateList(CandidateList);

#[wasm_bindgen]
impl OpenedCandidateList {
    /// The list in `bytes`; refused as the library refuses a damaged or foreign list.
    pub fn read(bytes: &[u8]) -> Result<OpenedCandidateList, JsValue> {
        after_secret(|| {
            CandidateList::decode(bytes)
                .map(OpenedCandidateList)
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// How many candidates it holds.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.0.count()
    }

    /// Which passphrases it holds: "none", "list" (one for all) or "records" (their own).
    #[wasm_bindgen(getter)]
    pub fn passphrases(&self) -> String {
        match self.0.passphrases() {
            ListPassphrases::None => "none",
            ListPassphrases::List => "list",
            ListPassphrases::Records => "records",
        }
        .to_owned()
    }

    /// The phrase of the candidate at `at`, a whole number from 0; refused past the last.
    pub fn phrase(&self, at: f64) -> Result<String, JsValue> {
        after_secret(|| {
            self.0
                .candidate(place(at))
                .map(|(phrase, _)| phrase.text().as_str().to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The BIP39 passphrase that the candidate at `at` is checked with; refused past the last.
    pub fn passphrase(&self, at: f64) -> Result<String, JsValue> {
        after_secret(|| {
            self.0
                .candidate(place(at))
                .map(|(_, passphrase)| passphrase.to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }
}

/// The candidates part's known answers: the startup cases, or with `full` every case, scrypt's
/// among them.
#[wasm_bindgen(js_name = selfCheckCandidates)]
pub fn self_check_candidates(full: bool) -> Result<(), JsValue> {
    self_check(Part::Candidates, full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mnemocode::self_check::vectors::THREE_PHRASES_LIST;
    use mnemocode::text::hex::bytes_of_hex;

    #[test]
    fn a_list_encrypted_to_a_session_key_opens_with_it() {
        let identity = SessionIdentity::create().unwrap();
        let list = bytes_of_hex(THREE_PHRASES_LIST).unwrap();
        let file = protect_text(&list, "key", &identity.recipient().unwrap()).unwrap();
        let opened = identity.decrypt(&file).unwrap();
        assert_eq!(opened, list);
        let read = OpenedCandidateList::read(&opened).unwrap();
        assert_eq!((read.count(), read.passphrases().as_str()), (3, "none"));
        assert_eq!(
            read.phrase(0.0).unwrap(),
            "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
        );
        assert_eq!(protect_text(&list, "none", "").unwrap(), list);
        let mut wiped = identity;
        wiped.wipe();
        assert!(wiped.0.is_none());
        assert_eq!(
            read.0.candidate(place(f64::from(1 << 28))).unwrap_err(),
            mnemocode::candidates::format::ListError::NoCandidate
        );
    }
}

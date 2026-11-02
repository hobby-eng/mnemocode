//! The phrase part for a page (`browser-phrase`): a seed phrase encoded as a backup in one form and
//! mode, the form that typed text most likely is, the master fingerprint of a phrase, and the
//! part's self-check. The phrase, the dates and the passphrase cross as text, as the page holds
//! them, in `JsValue`s that Rust reads (ARCHITECTURE.md §6); the copies are wiped once an entry
//! returns, and the stack after it.

use mnemocode::backup::{Backup, Encoding};
use mnemocode::bip32::{ExtendedKey, fingerprint_hex};
use mnemocode::bip39::phrase::Phrase;
use mnemocode::checks::Part;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, name, optional_text, phrase_and_dates, refused, self_check, text};

/// A seed phrase encoded as a backup: its codes and its record, which hold the phrase masked or in
/// another form, and both fingerprints. The page frees it once the codes are shown or saved.
#[wasm_bindgen]
pub struct EncodedBackup {
    encoding: Encoding,
    original: String,
}

impl EncodedBackup {
    /// [`EncodedBackup::encode`] of the text read: the form and the mode refused first.
    fn encode_text(
        form: &str,
        mode: &str,
        valid_last_word: bool,
        phrase: &str,
        dates: &str,
    ) -> Result<Self, JsValue> {
        let form = Form::named(form).map_err(|refusal| refused(&refusal))?;
        let mode = Mode::named(mode).map_err(|refusal| refused(&refusal))?;
        Backup::check_encodable(mode, valid_last_word, Some(form))
            .map_err(|refusal| refused(&refusal))?;
        let (phrase, dates) = phrase_and_dates(phrase, dates)?;
        let encoding = Backup::encode(&phrase, &dates, form, mode, valid_last_word)
            .map_err(|refusal| refused(&refusal))?;
        let original = ExtendedKey::of_phrase(&phrase, "")
            .and_then(|key| key.fingerprint())
            .map_err(|refusal| refused(&refusal))?;
        Ok(Self {
            encoding,
            original: fingerprint_hex(original),
        })
    }
}

#[wasm_bindgen]
impl EncodedBackup {
    /// `phrase` encoded in `form` (its name, as `--format` takes it) with `mode` and `dates`, the
    /// dates typed as a line of them (undefined: none); with `validLastWord`, the Original
    /// Seedshift's checksum-valid last word. Refused as the library refuses the phrase, the dates,
    /// the form and the mode, and for a phrase or dates that are not text.
    pub fn encode(
        phrase: JsValue,
        dates: JsValue,
        form: JsValue,
        mode: JsValue,
        valid_last_word: bool,
    ) -> Result<EncodedBackup, JsValue> {
        after_secret(|| {
            Self::encode_text(
                &name(&form),
                &name(&mode),
                valid_last_word,
                &text(&phrase)?,
                &optional_text(&dates)?,
            )
        })
    }

    /// The codes, as the form writes them.
    pub fn codes(&self) -> Result<String, JsValue> {
        after_secret(|| {
            self.encoding
                .backup
                .text()
                .map(|codes| codes.as_str().to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The MNC1 record, which names the mode and the form.
    pub fn record(&self) -> Result<String, JsValue> {
        after_secret(|| {
            self.encoding
                .backup
                .record()
                .map(|record| record.as_str().to_owned())
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// The master fingerprint of the original phrase, with an empty BIP39 passphrase.
    #[wasm_bindgen(getter, js_name = originalFingerprint)]
    pub fn original_fingerprint(&self) -> String {
        self.original.clone()
    }

    /// The master fingerprint of the codes read as a phrase, where they are a valid BIP39 phrase;
    /// undefined for the Original Seedshift's, which are one only by chance.
    #[wasm_bindgen(js_name = encodedFingerprint)]
    pub fn encoded_fingerprint(&self) -> Result<Option<String>, JsValue> {
        after_secret(|| {
            let fingerprint = self
                .encoding
                .backup
                .fingerprint()
                .map_err(|refusal| refused(&refusal))?;
            Ok(fingerprint.map(fingerprint_hex))
        })
    }

    /// Whether the Original Seedshift's valid last word differs from the mode's own.
    #[wasm_bindgen(getter, js_name = lastWordChanged)]
    pub fn last_word_changed(&self) -> bool {
        self.encoding.last_word_changed
    }
}

/// The form that typed `codes` most likely is, by its name; refused for codes that are not text.
#[wasm_bindgen(js_name = likelyForm)]
pub fn likely_form(codes: JsValue) -> Result<String, JsValue> {
    after_secret(|| Ok(Form::likely(&text(&codes)?).name().to_owned()))
}

/// The master fingerprint of the text read.
fn fingerprint_of(phrase: &str, passphrase: &str) -> Result<String, JsValue> {
    let phrase = Phrase::parse(phrase).map_err(|refusal| refused(&refusal))?;
    ExtendedKey::of_phrase(&phrase, passphrase)
        .and_then(|key| key.fingerprint())
        .map(fingerprint_hex)
        .map_err(|refusal| refused(&refusal))
}

/// The master fingerprint of `phrase` with the BIP39 `passphrase` (undefined: empty), eight
/// hexadecimal digits.
#[wasm_bindgen(js_name = masterFingerprint)]
pub fn master_fingerprint(phrase: JsValue, passphrase: JsValue) -> Result<String, JsValue> {
    after_secret(|| fingerprint_of(&text(&phrase)?, &optional_text(&passphrase)?))
}

/// The phrase part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckPhrase)]
pub fn self_check_phrase(full: bool) -> Result<(), JsValue> {
    self_check(Part::Phrase, full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mnemocode::self_check::vectors::{PUBLIC_FINGERPRINT, PUBLIC_MNEMONIC, PUBLIC_UNICODE};

    #[test]
    fn a_phrase_is_encoded_and_fingerprinted_as_the_library_does() {
        let backup =
            EncodedBackup::encode_text("unicode", "direct", false, PUBLIC_MNEMONIC, "").unwrap();
        assert_eq!(backup.codes().unwrap(), PUBLIC_UNICODE);
        assert_eq!(backup.original_fingerprint(), PUBLIC_FINGERPRINT);
        assert_eq!(
            backup.encoded_fingerprint().unwrap().as_deref(),
            Some(PUBLIC_FINGERPRINT)
        );
        assert!(backup.record().unwrap().starts_with("MNC1:direct:unicode:"));
        assert_eq!(
            fingerprint_of(PUBLIC_MNEMONIC, "").unwrap(),
            PUBLIC_FINGERPRINT
        );
        // Dates as the command line reads a typed line: apart at commas too.
        let masked = EncodedBackup::encode_text(
            "unicode",
            "seedshift",
            false,
            PUBLIC_MNEMONIC,
            "01-02-2020, 03-04-2021",
        )
        .unwrap();
        assert_ne!(masked.codes().unwrap(), PUBLIC_UNICODE);
        assert!(self_check_phrase(false).is_ok());
    }
}

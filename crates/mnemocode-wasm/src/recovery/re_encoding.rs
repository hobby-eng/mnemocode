//! Re-encoding for a page: the phrase of an old backup, kept until the person recognises it or the
//! wallet has it, as the library rules it, so that no page writes that rule. Its checksum confirms
//! nothing. The codes, the dates and the last word cross as `JsValue`s that Rust reads, and the
//! phrase once it is confirmed, which `EncodedBackup` then encodes again (ARCHITECTURE.md §6).

use mnemocode::backup::Backup;
use mnemocode::backup::re_encoding::{MatchedBy, ReEncoding as Confirmation};
use wasm_bindgen::prelude::*;

use super::{Recovery, fail, needed_form, needed_mode};
use crate::host::{after_secret, dates_of, name, optional_text, text};

/// The phrase of an old backup, to be confirmed before it is encoded again.
#[wasm_bindgen]
pub struct ReEncoding(Confirmation);

#[wasm_bindgen]
impl ReEncoding {
    /// The phrase that `codes`, written in `form` and masked in `mode`, give with `dates`; where
    /// Original Seedshift codes give two, the one that `last_word`, the word Encode named, gives.
    #[wasm_bindgen(constructor)]
    pub fn new(
        codes: JsValue,
        form: JsValue,
        mode: JsValue,
        dates: JsValue,
        last_word: JsValue,
    ) -> Result<ReEncoding, JsValue> {
        after_secret(|| {
            let backup = Backup::read(&text(&codes)?, needed_form(&form)?, needed_mode(&mode)?)
                .map_err(fail)?;
            let dates = dates_of(&text(&dates)?, backup.words())?;
            let last_word = optional_text(&last_word)?;
            let last_word = (!last_word.is_empty()).then_some(last_word.as_str());
            Confirmation::of(&backup, &dates, last_word)
                .map(ReEncoding)
                .map_err(fail)
        })
    }

    /// The phrase, for the person to recognise.
    pub fn phrase(&self) -> Result<String, JsValue> {
        after_secret(|| Ok(self.0.phrase().text().as_str().to_owned()))
    }

    /// The person recognises the phrase.
    #[wasm_bindgen(js_name = confirmByPerson)]
    pub fn confirm_by_person(&mut self) {
        self.0.confirm_by_person();
    }

    /// Compares the phrase with the wallet of `recovery`; whether it matched, which confirms it.
    #[wasm_bindgen(js_name = confirmByWallet)]
    pub fn confirm_by_wallet(&mut self, recovery: &Recovery) -> Result<bool, JsValue> {
        after_secret(|| {
            let matched = recovery
                .wallet_check()?
                .check(self.0.phrase())
                .map_err(fail)?;
            self.0.confirm_by_wallet(&matched);
            Ok(matched.matched)
        })
    }

    /// What is said of the confirmation, by the way it came: "address", "key" or "fingerprint";
    /// any other value, or none, is refused.
    #[wasm_bindgen(js_name = confirmationLine)]
    pub fn confirmation_line(&self, by: JsValue) -> Result<String, JsValue> {
        // An unconfirmed phrase is refused as such first, as TS 0.1.0 does.
        self.0.confirmed_phrase().map_err(fail)?;
        let by = MatchedBy::named(&name(&by)).map_err(fail)?;
        self.0.confirmation_line(by).map_err(fail)
    }

    /// The phrase, once it is confirmed; refused before.
    #[wasm_bindgen(js_name = confirmedPhrase)]
    pub fn confirmed_phrase(&self) -> Result<String, JsValue> {
        after_secret(|| {
            let phrase = self.0.confirmed_phrase().map_err(fail)?;
            Ok(phrase.text().as_str().to_owned())
        })
    }
}

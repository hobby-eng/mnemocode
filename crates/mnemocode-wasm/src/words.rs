//! The word tables for a page (`browser-phrase`): a word looked up, the numbered lists, the recovery
//! set, and the words hinted below a phrase being typed. A word typed may be a word of a phrase, so
//! it crosses as a `JsValue` that Rust reads (ARCHITECTURE.md §6). Nothing else here is secret.

use mnemocode::bip39::table::{self, Format, Lookup, Row};
use mnemocode::forms::hints::{BIP39, LineWordHints, WordHint, WordHints, codes_list};
use mnemocode::pack;
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, name, place, refused, text};

/// A row of the word table.
#[wasm_bindgen]
pub struct WordRow(Row);

#[wasm_bindgen]
impl WordRow {
    /// The word number, from 1.
    #[wasm_bindgen(getter)]
    pub fn index(&self) -> usize {
        self.0.index
    }

    /// The English word.
    #[wasm_bindgen(getter)]
    pub fn english(&self) -> String {
        self.0.english.to_owned()
    }

    /// The Unicode code.
    #[wasm_bindgen(getter, js_name = unicodeHex)]
    pub fn unicode_hex(&self) -> String {
        self.0.unicode_hex.clone()
    }
}

/// The row of `value`, read as `kind` says: word, index or unicode.
#[wasm_bindgen(js_name = wordLookup)]
pub fn word_lookup(kind: JsValue, value: JsValue) -> Result<WordRow, JsValue> {
    after_secret(|| {
        let by = Lookup::named(&name(&kind)).map_err(|refusal| refused(&refusal))?;
        table::lookup(by, &text(&value)?)
            .map(WordRow)
            .map_err(|refusal| refused(&refusal))
    })
}

/// The numbered list in `format`, as `table --format` names it.
#[wasm_bindgen(js_name = wordTable)]
pub fn word_table(format: &str) -> Result<String, JsValue> {
    let format = Format::named(format).map_err(|refusal| refused(&refusal))?;
    Ok(table::text(Some(format)))
}

/// The files of the recovery set: the word lists and the guide for reading a backup by hand.
#[wasm_bindgen]
pub struct RecoverySet(Vec<(String, Vec<u8>)>);

#[wasm_bindgen]
impl RecoverySet {
    /// The set.
    #[wasm_bindgen(constructor)]
    pub fn new() -> RecoverySet {
        Self(pack::files())
    }

    /// How many files it holds.
    #[wasm_bindgen(getter)]
    pub fn count(&self) -> usize {
        self.0.len()
    }

    /// The name of the file at `at`; none past the last.
    pub fn name(&self, at: f64) -> Option<String> {
        self.0.get(place(at)).map(|(file, _)| file.clone())
    }

    /// The bytes of the file at `at`; none past the last.
    pub fn bytes(&self, at: f64) -> Option<Vec<u8>> {
        self.0.get(place(at)).map(|(_, bytes)| bytes.clone())
    }
}

impl Default for RecoverySet {
    fn default() -> Self {
        Self::new()
    }
}

/// What shows below a line being typed, and what Tab adds to it.
#[wasm_bindgen]
pub struct TypedHint {
    words: Vec<String>,
    said: Option<String>,
    letters: String,
    word_ends: bool,
}

#[wasm_bindgen]
impl TypedHint {
    /// The words that begin with the letters typed, in list order.
    #[wasm_bindgen(getter)]
    pub fn words(&self) -> Vec<String> {
        self.words.clone()
    }

    /// How many words begin with them, or that none does, as a person reads it.
    #[wasm_bindgen(getter)]
    pub fn said(&self) -> Option<String> {
        self.said.clone()
    }

    /// The letters that Tab adds.
    #[wasm_bindgen(getter)]
    pub fn letters(&self) -> String {
        self.letters.clone()
    }

    /// Whether one word is left, so that the word ends and a space follows.
    #[wasm_bindgen(getter, js_name = wordEnds)]
    pub fn word_ends(&self) -> bool {
        self.word_ends
    }
}

/// What `hints` say of `line`.
fn hinted(hints: &dyn WordHints, line: &str) -> TypedHint {
    let completion = hints.completion(line);
    let (words, said) = match hints.hint(line) {
        WordHint::Nothing => (Vec::new(), None),
        WordHint::Count(_, said) | WordHint::NoWord(said) => (Vec::new(), Some(said)),
        WordHint::Words(words) => (words.into_iter().map(str::to_owned).collect(), None),
    };
    TypedHint {
        words,
        said,
        letters: completion.letters,
        word_ends: completion.word_ends,
    }
}

/// The hint below `line`, the text before the cursor, of a seed phrase; with `codes`, of codes in
/// any form, which have words only where the line so far is English words.
#[wasm_bindgen(js_name = wordHint)]
pub fn word_hint(line: JsValue, codes: bool) -> Result<TypedHint, JsValue> {
    after_secret(|| {
        let line = text(&line)?;
        Ok(if codes {
            hinted(&LineWordHints::new(codes_list, |part| part), &line)
        } else {
            hinted(&*BIP39, &line)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_word_is_looked_up_by_the_table() {
        assert_eq!(table::row(1).unwrap().english, "abandon");
        assert_eq!(hinted(&*BIP39, "zo").words, ["zone", "zoo"]);
        assert_eq!(RecoverySet::new().count(), pack::files().len());
    }
}

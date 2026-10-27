//! Which forms codes fit (MnemoCode TS 0.1.0's `detectInputFormats` of `core/representations.ts`,
//! CAP-PHRASE-FORMATS-FORM-DETECTION): every form whose reader takes the text whole as the codes
//! of a phrase, in the order of [`Form::ALL`]; the host asks which was recorded where several fit.

use super::Form;
use crate::bip39::sizes::is_word_count;

/// The forms whose reader reads `text` as the codes of a phrase of a BIP39 length.
pub fn detect(text: &str) -> Vec<Form> {
    Form::ALL
        .into_iter()
        .filter(|form| {
            form.read(text)
                .is_ok_and(|indexes| is_word_count(indexes.len()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::self_check::vectors::{MASKED_ENGLISH, MASKED_NUMBERS, PUBLIC_UNICODE};

    #[test]
    fn each_vector_fits_its_own_form() {
        assert_eq!(detect(MASKED_ENGLISH), [Form::English]);
        assert_eq!(detect(MASKED_NUMBERS), [Form::Indexes]);
        assert!(detect(PUBLIC_UNICODE).contains(&Form::Unicode));
        assert!(detect("not codes at all").is_empty());
    }
}

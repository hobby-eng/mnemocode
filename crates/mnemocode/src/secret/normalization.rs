//! NFKD directly in secret owners, without an unwiped combining-mark heap.
//!
//! The same routine as mhfe_core/src/nfkd.rs in the separate MHFE project;
//! a change to this normalization algorithm goes to both copies (CORE-10).

use unicode_normalization::char::{canonical_combining_class, decompose_compatible};

use super::{SecretBytes, SecretText};

/// Counted NFKD, written only after a caller has checked its own length limit.
pub(crate) struct Nfkd<'a> {
    text: &'a str,
    bytes: usize,
}

impl<'a> Nfkd<'a> {
    pub(crate) fn of(text: &'a str) -> Self {
        let mut bytes = 0;
        for character in text.chars() {
            decompose_compatible(character, |part| {
                bytes = usize::saturating_add(bytes, part.len_utf8());
            });
        }
        Self { text, bytes }
    }

    #[cfg(test)]
    pub(crate) fn bytes(&self) -> usize {
        self.bytes
    }

    pub(crate) fn text(self, label: &'static str) -> SecretText {
        let mut written = SecretBytes::zeroed(label, self.bytes);
        let out = &mut *written;
        let mut spare = None;
        let mut end = 0;
        let mut run = 0;
        let mut last = 0;
        let mut unordered = false;
        for character in self.text.chars() {
            decompose_compatible(character, |part| {
                let class = canonical_combining_class(part);
                if class == 0 && unordered {
                    order(&mut out[run..end], &mut spare, self.bytes);
                    unordered = false;
                } else if class != 0 && class < last {
                    unordered = true;
                }
                last = class;
                let width = part.len_utf8();
                part.encode_utf8(&mut out[end..end + width]);
                end += width;
                if class == 0 {
                    run = end;
                }
            });
        }
        if unordered {
            order(&mut out[run..end], &mut spare, self.bytes);
        }
        // Whole scalar encodings and a stable sort of whole encodings preserve UTF-8.
        SecretText { bytes: written }
    }
}

#[expect(
    clippy::expect_used,
    reason = "the run contains whole scalar encodings produced by the NFKD writer"
)]
fn order(run: &mut [u8], spare: &mut Option<SecretBytes>, bytes: usize) {
    let copy = &mut spare.get_or_insert_with(|| SecretBytes::zeroed("normalization marks", bytes))
        [..run.len()];
    copy.copy_from_slice(run);
    let copy = std::str::from_utf8(copy).expect("the run holds complete UTF-8 scalars");
    let mut at = [0; 256];
    for character in copy.chars() {
        at[usize::from(canonical_combining_class(character))] += character.len_utf8();
    }
    let mut start = 0;
    for slot in &mut at {
        let bytes = *slot;
        *slot = start;
        start += bytes;
    }
    for character in copy.chars() {
        let slot = &mut at[usize::from(canonical_combining_class(character))];
        character.encode_utf8(&mut run[*slot..]);
        *slot += character.len_utf8();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compatibility_decomposition_keeps_spaces_and_case() {
        let value = Nfkd::of("  A\u{00a0}\u{00e9}\u{2460}");
        assert_eq!(value.bytes(), "  A e\u{301}1".len());
        assert_eq!(&*value.text("a public test"), "  A e\u{301}1");
    }

    #[test]
    fn combining_marks_are_stably_ordered_across_decompositions() {
        // Unicode NFKD examples also exercised by MHFE's official-vector replay.
        for (input, expected) in [
            ("a\u{f72}\u{f73}", "a\u{f71}\u{f72}\u{f72}"),
            ("\u{344}\u{316}", "\u{316}\u{308}\u{301}"),
            (
                "\u{301}\u{316}e\u{301}\u{300}",
                "\u{316}\u{301}e\u{301}\u{300}",
            ),
        ] {
            assert_eq!(&*Nfkd::of(input).text("a public test"), expected);
        }
    }

    #[test]
    fn long_runs_and_expansion_keep_every_scalar() {
        use unicode_normalization::UnicodeNormalization;
        for text in ["\u{fdfa}".repeat(32), "\u{301}\u{316}".repeat(80)] {
            let expected: String = text.nfkd().collect();
            assert_eq!(&*Nfkd::of(&text).text("a public test"), expected);
        }
    }
}

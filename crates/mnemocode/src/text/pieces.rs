//! Text or a list cut into pieces of one width (TS `src/core/pieces.ts`): the digits of words and
//! colors, the code points of Color Unicode, bits and hexadecimal bytes. Each caller keeps its own
//! named width; a length that is no whole number of pieces is refused, never shortened.

use std::fmt;

use crate::refusal::{Refusal, RefusalKind};

/// Pieces that cannot be cut.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PiecesError {
    /// A width below 1.
    Width,
    /// A length that is no whole number of pieces of the width.
    Length {
        /// The length of the text or list.
        length: usize,
        /// The width of a piece.
        width: usize,
    },
}

impl fmt::Display for PiecesError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Width => f.write_str("A piece needs a whole width of at least 1."),
            Self::Length { length, width } => write!(
                f,
                "A length of {length} is no whole number of pieces of {width}."
            ),
        }
    }
}

impl std::error::Error for PiecesError {}

impl Refusal for PiecesError {
    fn code(&self) -> &'static str {
        match self {
            Self::Width => "core.pieces.piece-whole-width-at-least-1",
            Self::Length { .. } => "core.pieces.length-no-whole-number-pieces",
        }
    }

    fn kind(&self) -> RefusalKind {
        RefusalKind::Range
    }
}

fn check(length: usize, width: usize) -> Result<(), PiecesError> {
    if width == 0 {
        return Err(PiecesError::Width);
    }
    if !length.is_multiple_of(width) {
        return Err(PiecesError::Length { length, width });
    }
    Ok(())
}

/// `text` cut into pieces of `width` characters, in order. TS counts UTF-16 code units; the texts
/// cut so (digits, hexadecimal, Basic Multilingual Plane code points) have one per character.
pub fn text_pieces(text: &str, width: usize) -> Result<Vec<&str>, PiecesError> {
    let starts: Vec<usize> = text.char_indices().map(|(at, _)| at).collect();
    check(starts.len(), width)?;
    Ok(starts
        .chunks(width)
        .map(|chunk| {
            let from = chunk[0];
            let to = starts.get(starts.partition_point(|at| *at <= chunk[chunk.len() - 1]));
            &text[from..to.copied().unwrap_or(text.len())]
        })
        .collect())
}

/// `items` cut into pieces of `width` items, in order.
pub fn list_pieces<T>(items: &[T], width: usize) -> Result<Vec<&[T]>, PiecesError> {
    check(items.len(), width)?;
    Ok(items.chunks(width).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_and_lists_are_cut_into_whole_pieces() {
        assert_eq!(text_pieces("0102ff", 2).unwrap(), ["01", "02", "ff"]);
        assert_eq!(
            text_pieces("\u{7684}\u{5728}", 1).unwrap(),
            ["\u{7684}", "\u{5728}"]
        );
        assert_eq!(text_pieces("", 3).unwrap(), Vec::<&str>::new());
        assert_eq!(
            list_pieces(&[1, 2, 3, 4], 2).unwrap(),
            [&[1, 2][..], &[3, 4][..]]
        );
    }

    #[test]
    fn a_bad_width_or_length_is_refused() {
        let length = text_pieces("010", 2).unwrap_err();
        assert_eq!(
            length.to_string(),
            "A length of 3 is no whole number of pieces of 2."
        );
        assert_eq!(length.code(), "core.pieces.length-no-whole-number-pieces");
        let width = list_pieces(&[1], 0).unwrap_err();
        assert_eq!(
            width.to_string(),
            "A piece needs a whole width of at least 1."
        );
        assert_eq!(width.code(), "core.pieces.piece-whole-width-at-least-1");
    }
}

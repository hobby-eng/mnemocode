//! The segments of a QR code's text (ISO/IEC 18004, 7.4): which mode writes each run of its
//! characters, at the lowest count of bits. qrcodegen writes a text in one mode; node-qrcode, which
//! draws TS 0.1.0's codes, mixes modes, and the version of a code follows from its bits.
//!
//! The cheapest segments depend on the bits of their counts, which change with the version, so
//! each span of versions that shares those bits is tried in turn, the smallest first. node-qrcode
//! estimates a version instead; the two gave the same version on 133,000 payloads of every form.

use std::ops::Range;

use qrcodegen::{QrCode, QrCodeEcc, QrSegment, Version};

/// The characters that the alphanumeric mode holds besides digits and capitals.
const ALPHANUMERIC_SIGNS: &[u8] = b" $%*+-./:";
/// The bits that a mode's name takes at the start of a segment.
const MODE_BITS: usize = 4;
/// Each span of versions that writes a segment's count in the same bits, and those bits in the
/// order of [`Mode`] (ISO/IEC 18004, table 3).
const COUNT_BITS: [(u8, u8, [usize; 3]); 3] = [
    (1, 9, [10, 9, 8]),
    (10, 26, [12, 11, 16]),
    (27, 40, [14, 13, 16]),
];
/// The most characters of a text that version 40 holds at level M, all digits.
const MOST_CHARACTERS: usize = 5596;

/// A mode of a segment, the smallest alphabet first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Mode {
    Numeric,
    Alphanumeric,
    Byte,
}

impl Mode {
    const ALL: [Self; 3] = [Self::Numeric, Self::Alphanumeric, Self::Byte];

    /// The smallest alphabet that holds `byte`; each byte of a character past ASCII is one that a
    /// byte segment holds.
    fn of(byte: u8) -> Self {
        if byte.is_ascii_digit() {
            Self::Numeric
        } else if byte.is_ascii_uppercase() || ALPHANUMERIC_SIGNS.contains(&byte) {
            Self::Alphanumeric
        } else {
            Self::Byte
        }
    }

    /// The bits of the data of `count` characters: digits go in threes, letters in twos.
    const fn data_bits(self, count: usize) -> usize {
        match self {
            Self::Numeric => 10 * (count / 3) + [0, 4, 7][count % 3],
            Self::Alphanumeric => 11 * (count / 2) + 6 * (count % 2),
            Self::Byte => 8 * count,
        }
    }

    /// How many of `count` characters wait for the rest of their group.
    const fn waiting(self, count: usize) -> usize {
        match self {
            Self::Numeric => count % 3,
            Self::Alphanumeric => count % 2,
            Self::Byte => 0,
        }
    }

    fn segment(self, text: &str) -> QrSegment {
        match self {
            Self::Numeric => QrSegment::make_numeric(text),
            Self::Alphanumeric => QrSegment::make_alphanumeric(text),
            Self::Byte => QrSegment::make_bytes(text.as_bytes()),
        }
    }
}

/// A way to write a text up to the end of a run: the mode of its last segment and what waits there,
/// which decide the cost of what follows, its bits, and its place among the ways of the run before.
#[derive(Clone, Copy)]
struct Way {
    mode: Option<Mode>,
    waiting: usize,
    bits: usize,
    before: usize,
}

impl Way {
    /// How a text starts.
    const START: Self = Self {
        mode: None,
        waiting: 0,
        bits: 0,
        before: 0,
    };

    /// This way, at `place` among those of its run, with `count` more characters in `mode`.
    fn then(self, mode: Mode, count: usize, count_bits: &[usize; 3], place: usize) -> Self {
        let (waiting, opening) = if self.mode == Some(mode) {
            (self.waiting, 0)
        } else {
            (0, MODE_BITS + count_bits[mode as usize])
        };
        Self {
            mode: Some(mode),
            waiting: mode.waiting(waiting + count),
            bits: self.bits + opening + mode.data_bits(waiting + count) - mode.data_bits(waiting),
            before: place,
        }
    }
}

/// `pieces` in their order, those of one mode that follow each other as one.
fn joined(pieces: impl Iterator<Item = (Mode, Range<usize>)>) -> Vec<(Mode, Range<usize>)> {
    let mut joined: Vec<(Mode, Range<usize>)> = Vec::new();
    for (mode, piece) in pieces {
        match joined.last_mut() {
            Some((last, range)) if *last == mode => range.end = piece.end,
            _ => joined.push((mode, piece)),
        }
    }
    joined
}

/// The ways to end each of `runs`, the cheapest of each kind: only what a way ends with decides
/// the cost of the text after it.
fn ways_of(runs: &[(Mode, Range<usize>)], count_bits: &[usize; 3]) -> Vec<Vec<Way>> {
    let mut ways: Vec<Vec<Way>> = Vec::with_capacity(runs.len());
    for (narrowest, run) in runs {
        let before = ways.last().map_or(&[Way::START][..], Vec::as_slice);
        let mut ends: Vec<Way> = Vec::new();
        for mode in Mode::ALL.into_iter().filter(|mode| mode >= narrowest) {
            for (place, way) in before.iter().enumerate() {
                let next = way.then(mode, run.len(), count_bits, place);
                let same =
                    |other: &&mut Way| (other.mode, other.waiting) == (next.mode, next.waiting);
                match ends.iter_mut().find(same) {
                    Some(other) if other.bits <= next.bits => {}
                    Some(other) => *other = next,
                    None => ends.push(next),
                }
            }
        }
        ways.push(ends);
    }
    ways
}

/// The segments of `text` that take the fewest bits where a segment's count takes `count_bits`.
fn cheapest(text: &str, count_bits: &[usize; 3]) -> Vec<(Mode, Range<usize>)> {
    let bytes = text.bytes().enumerate();
    let runs = joined(bytes.map(|(at, byte)| (Mode::of(byte), at..at + 1)));
    let ways = ways_of(&runs, count_bits);
    // From the cheapest end back to the start: the mode of each run.
    let last = ways.last().map_or(&[][..], Vec::as_slice);
    let mut place = (0..last.len()).min_by_key(|&at| last[at].bits);
    let mut modes = Vec::with_capacity(runs.len());
    for ends in ways.iter().rev() {
        if let Some(way) = place.map(|at| ends[at]) {
            modes.push(way.mode);
            place = Some(way.before);
        }
    }
    let written = runs.iter().zip(modes.into_iter().rev());
    joined(written.filter_map(|((_, run), mode)| Some((mode?, run.clone()))))
}

/// The code of `text` at level M exactly, as node-qrcode writes it (qrcodegen's encoders would raise
/// the level where the version leaves room), in the smallest version that holds its cheapest
/// segments; none where version 40 does not hold it.
pub(super) fn code_of(text: &str) -> Option<QrCode> {
    if text.len() > MOST_CHARACTERS {
        return None;
    }
    COUNT_BITS.iter().find_map(|(first, last, count_bits)| {
        let segments: Vec<QrSegment> = cheapest(text, count_bits)
            .into_iter()
            .map(|(mode, range)| mode.segment(&text[range]))
            .collect();
        QrCode::encode_segments_advanced(
            &segments,
            QrCodeEcc::Medium,
            Version::new(*first),
            Version::new(*last),
            None,
            false,
        )
        .ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The modes and the lengths of the segments of `text` in the smallest versions.
    fn segments_of(text: &str) -> Vec<(Mode, usize)> {
        cheapest(text, &COUNT_BITS[0].2)
            .into_iter()
            .map(|(mode, range)| (mode, range.len()))
            .collect()
    }

    #[test]
    fn a_text_is_cut_where_node_qrcode_cuts_it() {
        use Mode::{Alphanumeric, Byte, Numeric};
        let colors = "#000064 #1EAB91 #3D0964 #5BB491 #7A1264 #98BD91 #B71B64 #D5C694";
        assert_eq!(
            segments_of(colors),
            [(Byte, 1), (Numeric, 6), (Byte, 50), (Alphanumeric, 6)]
        );
        let record = "MNC1:seedshift:unicode:8F44901950118F44901950118F44901950118F4490194F5C";
        assert_eq!(
            segments_of(record),
            [(Byte, 25), (Numeric, 11), (Alphanumeric, 35)]
        );
        assert_eq!(segments_of("ABC123abc"), [(Alphanumeric, 6), (Byte, 3)]);
        // Two bytes of the first character, then a digit and a capital that no switch of mode pays.
        assert_eq!(segments_of("\u{e9}1A"), [(Byte, 4)]);
        assert_eq!(segments_of(""), []);
    }

    #[test]
    fn a_code_has_the_version_of_node_qrcode_in_each_span_of_count_bits() {
        for (text, version) in [
            ("1".repeat(40), 2),
            ("1".repeat(1000), 16),
            ("1".repeat(3000), 29),
            ("A".repeat(1000), 21),
            ("a".repeat(400), 15),
            ("a".repeat(1200), 29),
            ("abandon ability able".to_owned(), 2),
        ] {
            let code = code_of(&text).unwrap();
            assert_eq!(code.version().value(), version, "{}", text.len());
        }
    }

    #[test]
    fn a_text_past_the_last_version_gives_no_code() {
        // Version 40 at level M holds 2331 bytes, or 5596 digits.
        assert!(code_of(&"a".repeat(2331)).is_some());
        assert!(code_of(&"a".repeat(2332)).is_none());
        assert!(code_of(&"1".repeat(MOST_CHARACTERS)).is_some());
        assert!(code_of(&"1".repeat(MOST_CHARACTERS + 1)).is_none());
    }
}

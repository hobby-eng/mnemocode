//! Codes of an encoded seed phrase of which some cannot be read, each marked at its place
//! (MnemoCode TS 0.1.0's `core/missing-codes.ts`, CAP-RECOVERY-MARKED-CODES). A ? stands for a code
//! that cannot be read. In English words a few letters with * or words joined by | narrow it, as
//! recover-word reads them; in word numbers and Unicode codes a ? may stand for one digit, such as
//! 1?34 or 4E?0; in colors a ? stands for a whole color. Each place then holds the codes that fit
//! what was read. Codes that keep a BIP39 checksum of their own, those of MnemoCode Seedshift and
//! those without Seedshift, are candidates only where the checksum holds; the Original Seedshift's
//! keep none, and every combination is one. Always built: backup reading needs it, and only the
//! search is a feature.

use std::fmt;
use std::rc::Rc;

use super::places::{
    Combinations, PlaceError, check_searchable, checksum_fits, combinations_of, every_word,
    expected_of, unknown_places_of, word_place_of,
};
use crate::bip39::phrase::{english_tokens, run_together_numbers, word_index_of_number};
use crate::bip39::sizes::{
    DICTIONARY_SIZE, WORD_NUMBER_DIGITS, WORD_NUMBER_RANGE, is_word_count, word_counts_text,
};
use crate::bip39::table::unicode_codes_fitting;
use crate::forms::Form;
use crate::forms::colors::{
    COLOR_UNICODE_PAIRS, COLOR_UNICODE_POINTS_PER_COLOR, ColorsError, RGB_HEX_DIGITS, color_counts,
    color_of_unicode_pair, marked_color_symbols, word_position_placements,
};
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;
use crate::refusal::Refusal;
use crate::text::codes::{
    UNICODE_CODE_DIGITS, code_tokens, fits_pattern, hex_units, with_joined_marks_hint,
};

/// Codes found that a search keeps by default: more than any person compares by eye.
pub const MAX_FOUND_CODES: u64 = 100;
/// What makes a search of marked codes smaller, in the words of its refusal.
const NARROW_MARKED_CODES: &str = "read a few letters or digits of the codes, or mark fewer";

/// The refusals of marked codes, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkedError {
    /// What the places of words refuse.
    Place(PlaceError),
    /// A word number, by its place, that no word has.
    NoWordNumber(usize),
    /// Word numbers run together.
    RunTogether,
    /// A Unicode code, by its place, of no word.
    NoUnicodeCode(usize),
    /// Color Unicode codes that are no pairs.
    UnicodeColors(String),
    /// A place that the colors leave without a word.
    NoWordAtPlace(usize),
    /// Text that is no Unicode codes.
    Places(String),
    /// A color marked other than whole.
    MarkWholeColor,
    /// A count of codes that no phrase has.
    Count(usize),
    /// A count of colors that no phrase has.
    ColorCount(usize),
    /// Codes of which none is marked.
    NoCodeMarked,
    /// What the colors refuse.
    Colors(ColorsError),
}

impl fmt::Display for MarkedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Place(error) => error.fmt(f),
            Self::NoWordNumber(place) => write!(
                f,
                "Word number {place} is no number from {}.",
                WORD_NUMBER_RANGE.through()
            ),
            Self::RunTogether => crate::bip39::phrase::PhraseError::RunTogether.fmt(f),
            Self::NoUnicodeCode(place) => {
                write!(f, "Code {place} is no Unicode code of the word list.")
            }
            Self::UnicodeColors(message) | Self::Places(message) => f.write_str(message),
            Self::NoWordAtPlace(place) => {
                write!(f, "The colors give no word at place {place}.")
            }
            Self::MarkWholeColor => f.write_str(
                "Mark a color that cannot be read with one ? in place of the whole color.",
            ),
            Self::Count(count) => write!(
                f,
                "These are {count} codes; a seed phrase has {}.",
                word_counts_text()
            ),
            Self::ColorCount(count) => write!(
                f,
                "These are {count} colors; a seed phrase has {}.",
                color_counts_text()
            ),
            Self::NoCodeMarked => {
                f.write_str("No code is marked: mark each code that cannot be read with ?.")
            }
            Self::Colors(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for MarkedError {}

impl Refusal for MarkedError {
    fn code(&self) -> &'static str {
        match self {
            Self::Place(error) => error.code(),
            Self::NoWordNumber(_) => "core.missing-codes.word-number-no-number-from",
            Self::RunTogether => "core.missing-codes.word-numbers-run-together",
            Self::NoUnicodeCode(_) => "core.missing-codes.code-no-unicode-code-word-list",
            Self::UnicodeColors(_) => "core.missing-codes.unicode-colors-refused",
            Self::NoWordAtPlace(_) => "core.missing-codes.colors-give-no-word-at-place",
            Self::Places(_) => "core.missing-codes.places-refused",
            Self::MarkWholeColor => {
                "core.missing-codes.mark-color-cannot-read-one-place-whole-color"
            }
            Self::Count(_) => "core.missing-codes.codes-seed-phrase",
            Self::ColorCount(_) => "core.missing-codes.colors-seed-phrase",
            Self::NoCodeMarked => "core.missing-codes.no-code-marked-mark-each-code-cannot-read",
            Self::Colors(error) => error.code(),
        }
    }
}

/// "8 to 16": the colors of a phrase.
fn color_counts_text() -> String {
    let counts = color_counts();
    format!(
        "{} to {}",
        counts.first().copied().unwrap_or(0),
        counts.last().copied().unwrap_or(0)
    )
}

impl From<PlaceError> for MarkedError {
    fn from(error: PlaceError) -> Self {
        Self::Place(error)
    }
}

impl From<ColorsError> for MarkedError {
    fn from(error: ColorsError) -> Self {
        Self::Colors(error)
    }
}

/// The places of a phrase in each placement that its codes allow.
type Placements = Vec<Vec<Indexes>>;

/// The words whose number, from 1, fits `pattern`, as typed or as four digits of a color.
fn words_of_number(pattern: &str, padded: bool) -> Indexes {
    Indexes::new(
        (0..DICTIONARY_SIZE as u16)
            .filter(|&index| {
                let number = usize::from(index) + 1;
                let written = if padded {
                    format!("{number:0WORD_NUMBER_DIGITS$}")
                } else {
                    number.to_string()
                };
                fits_pattern(pattern, &written)
            })
            .collect(),
    )
}

/// Whether `written` is a word number with ? for unread digits: at most the digits of 2048.
fn marked_word_number(written: &str) -> bool {
    (1..=WORD_NUMBER_DIGITS).contains(&written.len())
        && written
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'?')
}

/// The words that one word number allows: a number, a lone ?, or a number with ? for a digit.
fn number_place(written: &str, place: usize) -> Result<Indexes, MarkedError> {
    if written == "?" {
        return Ok(every_word());
    }
    // A known number is read as complete codes read it, leading zeros included.
    if !written.contains('?') {
        return word_index_of_number(written)
            .map(|index| Indexes::new(vec![index as u16]))
            .map_err(|_| MarkedError::NoWordNumber(place));
    }
    if marked_word_number(written) {
        let words = words_of_number(written, false);
        if !words.as_slice().is_empty() {
            return Ok(words);
        }
    }
    if run_together_numbers(written) {
        return Err(MarkedError::RunTogether);
    }
    Err(MarkedError::NoWordNumber(place))
}

/// The words that one Unicode code allows: a code, a lone ?, or a code with ? for a digit.
fn code_place(written: &str, place: usize) -> Result<Indexes, MarkedError> {
    if written == "?" {
        return Ok(every_word());
    }
    let upper_hex =
        |byte: u8| byte.is_ascii_digit() || (b'A'..=b'F').contains(&byte) || byte == b'?';
    if written.len() == UNICODE_CODE_DIGITS && written.bytes().all(upper_hex) {
        let words = unicode_codes_fitting(written);
        if !words.is_empty() {
            return Ok(Indexes::new(words));
        }
    }
    Err(MarkedError::NoUnicodeCode(place))
}

/// The colors of Color Unicode codes, each none where one of its two codes cannot be read.
fn unicode_colors(text: &str) -> Result<Vec<Option<String>>, MarkedError> {
    // The codes may also be the Private Use symbols themselves.
    let points = marked_color_symbols(text)
        .or_else(|| hex_units(text, UNICODE_CODE_DIGITS, false))
        .filter(|points| points.len() % COLOR_UNICODE_POINTS_PER_COLOR == 0)
        .ok_or_else(|| {
            MarkedError::UnicodeColors(with_joined_marks_hint(COLOR_UNICODE_PAIRS, text))
        })?;
    // A count of colors that no phrase has is refused before any color is read.
    let count = points.len() / COLOR_UNICODE_POINTS_PER_COLOR;
    if !color_counts().contains(&count) {
        return Err(MarkedError::ColorCount(count));
    }
    points
        .chunks(COLOR_UNICODE_POINTS_PER_COLOR)
        .map(|pair| {
            // A code with ? among its digits leaves its color unknown.
            if pair.iter().any(|code| code.contains('?')) {
                return Ok(None);
            }
            let point = |code: &String| u32::from_str_radix(code, 16).unwrap_or(u32::MAX);
            Ok(Some(color_of_unicode_pair(
                point(&pair[0]),
                point(&pair[1]),
            )?))
        })
        .collect()
}

/// `units`, one a word, when there are as many as a seed phrase has words; refused before any of
/// them is read, so that a long text costs no reading of its places.
fn counted<T>(units: Vec<T>) -> Result<Vec<T>, MarkedError> {
    if is_word_count(units.len()) {
        Ok(units)
    } else {
        Err(MarkedError::Count(units.len()))
    }
}

/// The places of colors in each placement that their tags allow, each word a pattern of its four
/// position digits. A placement that leaves no word at a place is not the record's; where none is
/// left, the first one says where.
fn color_places(colors: &[Option<String>]) -> Result<Placements, MarkedError> {
    let placements: Placements = word_position_placements(colors)?
        .iter()
        .map(|patterns| {
            patterns
                .iter()
                .map(|pattern| words_of_number(pattern, true))
                .collect()
        })
        .collect();
    let empty = |words: &Indexes| words.as_slice().is_empty();
    let first_empty = placements
        .first()
        .and_then(|places| places.iter().position(empty));
    let possible: Placements = placements
        .into_iter()
        .filter(|places| !places.iter().any(empty))
        .collect();
    match (possible.is_empty(), first_empty) {
        (true, Some(place)) => Err(MarkedError::NoWordAtPlace(place + 1)),
        _ => Ok(possible),
    }
}

/// Marked English words: each a word, a prefix with *, words joined by |, or a ?.
fn english_places(text: &str) -> Result<Placements, MarkedError> {
    let places = counted(english_tokens(text))?
        .iter()
        .enumerate()
        .map(|(place, word)| word_place_of(word, place + 1))
        .collect::<Result<Vec<Indexes>, PlaceError>>()?;
    Ok(vec![places])
}

/// Marked word numbers: each a number, a number with ? for a digit, or a ?.
fn number_places(text: &str) -> Result<Placements, MarkedError> {
    let tokens = code_tokens(text);
    // Numbers written without spaces are one token: that, not their count, is what is wrong.
    if !is_word_count(tokens.len()) && tokens.iter().any(|token| run_together_numbers(token)) {
        return Err(MarkedError::RunTogether);
    }
    let places = counted(tokens)?
        .iter()
        .enumerate()
        .map(|(place, token)| number_place(token, place + 1))
        .collect::<Result<Vec<Indexes>, MarkedError>>()?;
    Ok(vec![places])
}

/// Marked Unicode codes: each four hexadecimal digits, with ? for a digit, or a ?.
fn unicode_places(text: &str) -> Result<Placements, MarkedError> {
    let codes = hex_units(text, UNICODE_CODE_DIGITS, false).ok_or_else(|| {
        MarkedError::Places(with_joined_marks_hint(
            "Unicode codes have four hexadecimal digits each, or ? where unread.",
            text,
        ))
    })?;
    let places = counted(codes)?
        .iter()
        .enumerate()
        .map(|(place, code)| code_place(code, place + 1))
        .collect::<Result<Vec<Indexes>, MarkedError>>()?;
    Ok(vec![places])
}

/// Marked colors: each six hexadecimal digits, or one ? for the whole color.
fn rgb_color_places(text: &str) -> Result<Placements, MarkedError> {
    let colors = hex_units(text, RGB_HEX_DIGITS, false)
        .filter(|colors| {
            colors
                .iter()
                .all(|color| color == "?" || !color.contains('?'))
        })
        .ok_or(MarkedError::MarkWholeColor)?;
    let colors: Vec<Option<String>> = colors
        .into_iter()
        .map(|color| (color != "?").then(|| format!("#{color}")))
        .collect();
    color_places(&colors)
}

/// The places of `text` read in `form`, in each placement that the codes allow: one, but for colors
/// whose tags leave it open.
fn placements_of(text: &str, form: Form) -> Result<Placements, MarkedError> {
    match form {
        Form::English => english_places(text),
        Form::Indexes => number_places(text),
        Form::Unicode => unicode_places(text),
        Form::ColorsUnicode => color_places(&unicode_colors(text)?),
        Form::Colors => rgb_color_places(text),
    }
}

/// Codes with marks, read in one form and taken with one mode: the places are read and checked
/// once, and then tell their size and give their candidates.
#[derive(Clone, Debug)]
pub struct MissingCodes {
    placements: Rc<Placements>,
    form: Form,
    mode: Mode,
    combinations: u64,
}

impl MissingCodes {
    /// The codes of `placements`, refused where none is marked or a search takes too many.
    fn new(placements: Rc<Placements>, form: Form, mode: Mode) -> Result<Self, MarkedError> {
        let word_count = placements.first().map_or(0, Vec::len);
        if !is_word_count(word_count) {
            return Err(MarkedError::Count(word_count));
        }
        if placements
            .iter()
            .any(|places| places.iter().all(|place| place.as_slice().len() == 1))
        {
            return Err(MarkedError::NoCodeMarked);
        }
        // Counted and bounded as the word search counts and bounds its places, every placement
        // together.
        let combinations = placements.iter().fold(0_u64, |total, places| {
            total.saturating_add(combinations_of(places))
        });
        check_searchable(combinations, NARROW_MARKED_CODES)?;
        Ok(Self {
            placements,
            form,
            mode,
            combinations,
        })
    }

    /// Whether `text` marks codes it lacks: a ?, or in English words a prefix with * or words
    /// joined by |. A host reads such codes here rather than as complete ones.
    pub fn marked(text: &str) -> bool {
        text.contains(['?', '*', '|'])
    }

    /// Every form that the marked codes may be in, for a host that asks for one when several fit.
    pub fn forms(text: &str) -> Vec<Form> {
        // Codes of every form may be marked; detection tries them in their order.
        Form::ALL
            .into_iter()
            .filter(|&form| {
                placements_of(text, form).is_ok_and(|placements| {
                    placements
                        .first()
                        .is_some_and(|places| is_word_count(places.len()))
                })
            })
            .collect()
    }

    /// Reads the marked codes of `text` in `form`, taken with `mode`.
    pub fn read(text: &str, form: Form, mode: Mode) -> Result<Self, MarkedError> {
        Self::new(Rc::new(placements_of(text, form)?), form, mode)
    }

    /// The same codes taken with another mode.
    pub fn with_mode(&self, mode: Mode) -> Self {
        Self {
            mode,
            ..self.clone()
        }
    }

    /// The form of these codes.
    pub const fn form(&self) -> Form {
        self.form
    }

    /// The mode a candidate is decoded with.
    pub const fn mode(&self) -> Mode {
        self.mode
    }

    /// The codes of the phrase.
    pub fn word_count(&self) -> usize {
        self.placements.first().map_or(0, Vec::len)
    }

    /// The places, from 1, whose code is not known, for each placement that the codes allow: one,
    /// but for colors whose tags leave it open.
    pub fn placements(&self) -> Vec<Vec<usize>> {
        self.placements
            .iter()
            .map(|places| {
                unknown_places_of(places)
                    .into_iter()
                    .map(|index| index + 1)
                    .collect()
            })
            .collect()
    }

    /// The combinations of codes that the marks leave.
    pub const fn combinations(&self) -> u64 {
        self.combinations
    }

    /// Whether the codes keep a BIP39 checksum of their own, which the search holds them to. Codes
    /// without Seedshift are the phrase itself, whose checksum BIP39 keeps.
    pub const fn checksummed(&self) -> bool {
        self.mode.keeps_checksum() || !self.mode.masked()
    }

    /// About how many candidates the search checks: the combinations that pass the checksum, one
    /// in 2^bits, where the codes keep one; every combination where they keep none.
    pub fn expected(&self) -> u64 {
        if !self.checksummed() {
            return self.combinations;
        }
        self.placements
            .iter()
            .map(|places| expected_of(places).count)
            .sum()
    }

    /// The candidates in steady order.
    pub fn candidates(&self) -> MarkedCandidates {
        MarkedCandidates {
            placements: Rc::clone(&self.placements),
            checksummed: self.checksummed(),
            placement: 0,
            walk: None,
        }
    }
}

/// The candidates of marked codes in steady order: where they are, kept, so that a search that the
/// host steps stops and goes on anywhere.
#[derive(Debug)]
pub struct MarkedCandidates {
    placements: Rc<Placements>,
    checksummed: bool,
    placement: usize,
    walk: Option<Combinations>,
}

impl MarkedCandidates {
    /// Whether an earlier placement gives `codes` too: they are given once.
    fn earlier_gives(&self, codes: &[u16]) -> bool {
        self.placements[..self.placement].iter().any(|other| {
            other
                .iter()
                .zip(codes)
                .all(|(place, code)| place.as_slice().binary_search(code).is_ok())
        })
    }

    /// The next candidate, a copy of its own; none after the last.
    pub fn next_codes(&mut self) -> Option<Indexes> {
        while let Some(places) = self.placements.get(self.placement) {
            let walk = self
                .walk
                .get_or_insert_with(|| Combinations::new(places.clone()));
            let found = loop {
                match walk.next_words() {
                    None => break None,
                    Some(codes) if self.checksummed && !checksum_fits(codes) => {}
                    Some(codes) => break Some(Indexes::new(codes.to_vec())),
                }
            };
            match found {
                None => {
                    self.walk = None;
                    self.placement += 1;
                }
                Some(codes) if self.earlier_gives(codes.as_slice()) => {}
                Some(codes) => return Some(codes),
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bip39::table::english;

    const TWELVE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn words(codes: &Indexes) -> String {
        codes
            .as_slice()
            .iter()
            .map(|&index| english()[usize::from(index)])
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn marked_words_give_their_checksum_valid_candidates() {
        let marked = TWELVE.replace("about", "?");
        let codes = MissingCodes::read(&marked, Form::English, Mode::Direct).unwrap();
        assert_eq!(codes.combinations(), 2048);
        assert_eq!(codes.expected(), 128);
        assert_eq!(codes.placements(), [[12]]);
        let mut candidates = codes.candidates();
        let first = candidates.next_codes().unwrap();
        assert_eq!(words(&first), TWELVE);
        let mut count = 1;
        while candidates.next_codes().is_some() {
            count += 1;
        }
        assert_eq!(count, 128);
    }

    #[test]
    fn original_seedshift_codes_keep_no_checksum() {
        let marked = TWELVE.replace("about", "?");
        let codes = MissingCodes::read(&marked, Form::English, Mode::SeedshiftLegacy).unwrap();
        assert!(!codes.checksummed());
        assert_eq!(codes.expected(), 2048);
    }

    #[test]
    fn a_digit_of_a_number_or_a_code_may_be_marked() {
        assert_eq!(number_place("1?34", 1).unwrap().as_slice().len(), 10);
        assert_eq!(number_place("?", 1).unwrap().as_slice().len(), 2048);
        assert_eq!(number_place("3000", 2), Err(MarkedError::NoWordNumber(2)));
        assert_eq!(number_place("9?99", 2), Err(MarkedError::NoWordNumber(2)));
        assert_eq!(number_place("1?345", 2), Err(MarkedError::RunTogether));
        assert_eq!(code_place("ZZZZ", 3), Err(MarkedError::NoUnicodeCode(3)));
    }

    #[test]
    fn codes_of_no_phrase_are_refused_before_their_places() {
        assert_eq!(
            MissingCodes::read("abandon ?", Form::English, Mode::Direct).unwrap_err(),
            MarkedError::Count(2)
        );
        assert_eq!(
            MissingCodes::read(TWELVE, Form::English, Mode::Direct).unwrap_err(),
            MarkedError::NoCodeMarked
        );
        let all = ["?"; 12].join(" ");
        assert_eq!(
            MissingCodes::read(&all, Form::English, Mode::Direct).unwrap_err(),
            MarkedError::Place(PlaceError::TooManyCombinations(NARROW_MARKED_CODES))
        );
    }

    #[test]
    fn a_host_learns_what_marks_codes() {
        assert!(MissingCodes::marked("abandon ?"));
        assert!(MissingCodes::marked("aba* about"));
        assert!(!MissingCodes::marked(TWELVE));
    }
}

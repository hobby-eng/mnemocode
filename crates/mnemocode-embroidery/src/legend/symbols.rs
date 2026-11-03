//! The symbols of a legend, numbered from 1 as a person types them back: 40 shapes, then letters
//! and digits. A pair that a person copying a chart could take for each other (O and 0, S and 5,
//! B and 8, a filled and a small square, a dot and a disc) keeps neither or one of its members.

/// A shape that a chart draws in a cell.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    /// ■
    FilledSquare,
    /// □
    Square,
    /// ▣
    SquareDot,
    /// ⊞
    SquarePlus,
    /// ⊠
    SquareCross,
    /// ◧
    SquareLeftHalf,
    /// ◩
    SquareDiagonalHalf,
    /// ▤
    SquareLines,
    /// ▦
    SquareGrid,
    /// ●
    FilledCircle,
    /// ○
    Circle,
    /// ⊙
    CircleDot,
    /// ⊕
    CirclePlus,
    /// ⊗
    CircleCross,
    /// ◐
    CircleLeftHalf,
    /// ▲
    FilledTriangleUp,
    /// △
    TriangleUp,
    /// ▼
    FilledTriangleDown,
    /// ◆
    FilledDiamond,
    /// ◇
    Diamond,
    /// ◈
    DiamondDot,
    /// ◢
    CornerLowerRight,
    /// ◤
    CornerUpperLeft,
    /// +
    Plus,
    /// ×
    Cross,
    /// ★
    FilledStar,
    /// ✱
    Asterisk,
    /// ♥
    FilledHeart,
    /// ♡
    Heart,
    /// ♠
    Spade,
    /// ♣
    Club,
    /// ↑
    ArrowUp,
    /// →
    ArrowRight,
    /// ↔
    ArrowBoth,
    /// |
    Bar,
    /// —
    Dash,
    /// /
    Slash,
    /// \
    Backslash,
    /// ⬢
    FilledHexagon,
    /// ⬡
    Hexagon,
}

/// What a symbol is: a shape, or a character of the chart's font.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Glyph {
    /// A shape drawn as lines and fills.
    Shape(Shape),
    /// A letter or digit.
    Character(char),
}

/// One symbol: what a chart draws, and the character a terminal shows for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Symbol {
    glyph: Glyph,
    shown: char,
}

impl Symbol {
    /// What a chart draws.
    #[must_use]
    pub const fn glyph(&self) -> Glyph {
        self.glyph
    }

    /// The character that stands for it on a terminal or in a list.
    #[must_use]
    pub const fn shown(&self) -> char {
        self.shown
    }
}

const fn shape(shape: Shape, shown: char) -> Symbol {
    Symbol {
        glyph: Glyph::Shape(shape),
        shown,
    }
}

const fn character(shown: char) -> Symbol {
    Symbol {
        glyph: Glyph::Character(shown),
        shown,
    }
}

/// Every symbol; symbol number `n` is `SYMBOLS[n - 1]`. Its order is part of the format: never
/// change it.
pub const SYMBOLS: [Symbol; 70] = [
    shape(Shape::FilledSquare, '■'),
    shape(Shape::Square, '□'),
    shape(Shape::SquareDot, '▣'),
    shape(Shape::SquarePlus, '⊞'),
    shape(Shape::SquareCross, '⊠'),
    shape(Shape::SquareLeftHalf, '◧'),
    shape(Shape::SquareDiagonalHalf, '◩'),
    shape(Shape::SquareLines, '▤'),
    shape(Shape::SquareGrid, '▦'),
    shape(Shape::FilledCircle, '●'),
    shape(Shape::Circle, '○'),
    shape(Shape::CircleDot, '⊙'),
    shape(Shape::CirclePlus, '⊕'),
    shape(Shape::CircleCross, '⊗'),
    shape(Shape::CircleLeftHalf, '◐'),
    shape(Shape::FilledTriangleUp, '▲'),
    shape(Shape::TriangleUp, '△'),
    shape(Shape::FilledTriangleDown, '▼'),
    shape(Shape::FilledDiamond, '◆'),
    shape(Shape::Diamond, '◇'),
    shape(Shape::DiamondDot, '◈'),
    shape(Shape::CornerLowerRight, '◢'),
    shape(Shape::CornerUpperLeft, '◤'),
    shape(Shape::Plus, '+'),
    shape(Shape::Cross, '×'),
    shape(Shape::FilledStar, '★'),
    shape(Shape::Asterisk, '✱'),
    shape(Shape::FilledHeart, '♥'),
    shape(Shape::Heart, '♡'),
    shape(Shape::Spade, '♠'),
    shape(Shape::Club, '♣'),
    shape(Shape::ArrowUp, '↑'),
    shape(Shape::ArrowRight, '→'),
    shape(Shape::ArrowBoth, '↔'),
    shape(Shape::Bar, '|'),
    shape(Shape::Dash, '—'),
    shape(Shape::Slash, '/'),
    shape(Shape::Backslash, '\\'),
    shape(Shape::FilledHexagon, '⬢'),
    shape(Shape::Hexagon, '⬡'),
    character('A'),
    character('B'),
    character('C'),
    character('D'),
    character('E'),
    character('F'),
    character('G'),
    character('H'),
    character('J'),
    character('K'),
    character('L'),
    character('M'),
    character('N'),
    character('P'),
    character('R'),
    character('S'),
    character('T'),
    character('U'),
    character('V'),
    character('W'),
    character('Y'),
    character('Z'),
    character('3'),
    character('4'),
    character('7'),
    character('9'),
    character('a'),
    character('e'),
    character('h'),
    character('r'),
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_symbol_shows_as_its_own_character() {
        let mut shown: Vec<char> = SYMBOLS.iter().map(Symbol::shown).collect();
        shown.sort_unstable();
        shown.dedup();
        assert_eq!(shown.len(), SYMBOLS.len());
    }

    #[test]
    fn no_symbol_is_one_that_a_person_could_take_for_another() {
        // Each left out for the symbol in brackets: O (0, ○), 0, I and l (1, |), 1, 5 (S), 8 (B),
        // 2 (Z), 6 (G), X (×), t (+), m (M), the dot (●), the small square (■), the check (V).
        for left_out in [
            'O', '0', 'I', 'l', '1', '5', '8', '2', '6', 'X', 't', 'm', '•', '▪', '✓',
        ] {
            assert!(SYMBOLS.iter().all(|s| s.shown() != left_out), "{left_out}");
        }
    }
}

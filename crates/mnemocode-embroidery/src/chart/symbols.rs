//! The legend's symbols drawn in a cell of a chart: shapes as lines and fills, letters and digits
//! in the cards' font, centred and in the ink that stands out on the cell.

use mnemocode_cards::scene::{MM, Page, Path, Rgb, Segment, UiFont, ellipse_path};

use crate::legend::{Glyph, Shape, Symbol};

/// A quarter circle as a cubic Bézier curve draws it: (4 / 3) * tan(pi / 8).
const KAPPA: f64 = 0.552_284_75;

/// A cell of a chart in points: its bottom left corner and its side.
#[derive(Clone, Copy)]
pub(crate) struct Cell {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) side: f64,
}

impl Cell {
    /// The point `(u, v)` of the cell, each from 0 to 1, v upwards.
    fn at(self, u: f64, v: f64) -> (f64, f64) {
        (self.x + u * self.side, self.y + v * self.side)
    }

    /// A closed path through the points `(u, v)` of the cell.
    fn polygon(self, points: &[(f64, f64)]) -> Path {
        let mut path: Path = points
            .iter()
            .enumerate()
            .map(|(i, &(u, v))| {
                let (x, y) = self.at(u, v);
                if i == 0 {
                    Segment::Move(x, y)
                } else {
                    Segment::Line(x, y)
                }
            })
            .collect();
        path.push(Segment::Close);
        path
    }

    /// A straight line between two points of the cell.
    fn line(self, from: (f64, f64), to: (f64, f64)) -> Path {
        let (a, b) = (self.at(from.0, from.1), self.at(to.0, to.1));
        vec![Segment::Move(a.0, a.1), Segment::Line(b.0, b.1)]
    }

    /// A circle round `(u, v)` with radius `r`, as parts of the cell.
    fn circle(self, u: f64, v: f64, r: f64) -> Path {
        let (x, y) = self.at(u, v);
        ellipse_path(x, y, r * self.side, r * self.side)
    }

    /// The left half of a circle round `(u, v)`.
    fn left_half(self, u: f64, v: f64, r: f64) -> Path {
        let (x, y) = self.at(u, v);
        let (r, k) = (r * self.side, r * self.side * KAPPA);
        vec![
            Segment::Move(x, y + r),
            Segment::Curve(x - k, y + r, x - r, y + k, x - r, y),
            Segment::Curve(x - r, y - k, x - k, y - r, x, y - r),
            Segment::Close,
        ]
    }

    /// A path of cubic curves given as parts of the cell: a start, then (c1, c2, end) triples.
    fn curves(self, start: (f64, f64), parts: &[[(f64, f64); 3]]) -> Path {
        let (x, y) = self.at(start.0, start.1);
        let mut path = vec![Segment::Move(x, y)];
        for [c1, c2, end] in parts {
            let ((a, b), (c, d), (e, f)) = (
                self.at(c1.0, c1.1),
                self.at(c2.0, c2.1),
                self.at(end.0, end.1),
            );
            path.push(Segment::Curve(a, b, c, d, e, f));
        }
        path.push(Segment::Close);
        path
    }
}

/// Draws `symbol` in `cell` in `ink`.
pub(crate) fn draw(page: &mut Page, font: &UiFont, symbol: Symbol, cell: Cell, ink: Rgb) {
    match symbol.glyph() {
        Glyph::Character(c) => character(page, font, c, cell, ink),
        Glyph::Shape(shape) => draw_shape(page, shape, cell, ink),
    }
}

/// A letter or digit of the font, centred in the cell.
fn character(page: &mut Page, font: &UiFont, c: char, cell: Cell, ink: Rgb) {
    let size = cell.side * 0.78;
    let text = c.to_string();
    let width = font.width(&text, size);
    let left = (cell.x + (cell.side - width) / 2.0) / MM;
    // The visual centre of a capital lies about 0.365 em above its base line.
    let centre_from_top = (page.height - (cell.y + cell.side / 2.0)) / MM;
    let top = centre_from_top - 0.635 * size / MM;
    page.text(font, &text, (left, top), size, ink);
}

/// The paths of a shape: what is filled and what is stroked.
fn draw_shape(page: &mut Page, shape: Shape, cell: Cell, ink: Rgb) {
    let width = cell.side * 0.08;
    let (fills, strokes) = shape_paths(shape, cell);
    for path in fills {
        page.fill(path, ink, 1.0);
    }
    for path in strokes {
        page.stroke(path, ink, width, 1.0);
    }
}

/// The square inside a cell's margin.
const SQUARE: [(f64, f64); 4] = [(0.18, 0.18), (0.82, 0.18), (0.82, 0.82), (0.18, 0.82)];
/// The corners of a diamond.
const DIAMOND: [(f64, f64); 4] = [(0.5, 0.88), (0.86, 0.5), (0.5, 0.12), (0.14, 0.5)];
/// A heart from its point at the bottom: (c1, c2, end) triples of cubic curves.
const HEART: [[(f64, f64); 3]; 6] = [
    [(0.38, 0.32), (0.12, 0.45), (0.12, 0.64)],
    [(0.12, 0.8), (0.24, 0.86), (0.33, 0.86)],
    [(0.42, 0.86), (0.48, 0.8), (0.5, 0.72)],
    [(0.52, 0.8), (0.58, 0.86), (0.67, 0.86)],
    [(0.76, 0.86), (0.88, 0.8), (0.88, 0.64)],
    [(0.88, 0.45), (0.62, 0.32), (0.5, 0.16)],
];
/// The stem under a spade and a club.
const STEM: [(f64, f64); 3] = [(0.5, 0.4), (0.36, 0.12), (0.64, 0.12)];

/// The two strokes of a plus in the cell `c`.
fn plus(c: Cell) -> Vec<Path> {
    vec![
        c.line((0.5, 0.22), (0.5, 0.78)),
        c.line((0.22, 0.5), (0.78, 0.5)),
    ]
}

/// The two strokes of a cross in the cell `c`.
fn cross(c: Cell) -> Vec<Path> {
    vec![
        c.line((0.24, 0.24), (0.76, 0.76)),
        c.line((0.24, 0.76), (0.76, 0.24)),
    ]
}

/// A hexagon standing on a corner in the cell `c`.
fn hexagon(c: Cell) -> Path {
    let corners: Vec<(f64, f64)> = (0..6)
        .map(|k| {
            let angle = std::f64::consts::FRAC_PI_2 + f64::from(k) * std::f64::consts::FRAC_PI_3;
            (0.5 + 0.36 * libm::cos(angle), 0.5 + 0.36 * libm::sin(angle))
        })
        .collect();
    c.polygon(&corners)
}

/// A five-pointed star in the cell `c`.
fn star(c: Cell) -> Path {
    let points: Vec<(f64, f64)> = (0..10)
        .map(|k| {
            let angle = std::f64::consts::FRAC_PI_2 + f64::from(k) * std::f64::consts::PI / 5.0;
            let r = if k % 2 == 0 { 0.4 } else { 0.16 };
            (0.5 + r * libm::cos(angle), 0.47 + r * libm::sin(angle))
        })
        .collect();
    c.polygon(&points)
}

/// What a shape fills and what it strokes, in the cell `c`.
fn shape_paths(shape: Shape, c: Cell) -> (Vec<Path>, Vec<Path>) {
    let square = c.polygon(&SQUARE);
    let circle = c.circle(0.5, 0.5, 0.33);
    match shape {
        Shape::FilledSquare => (vec![square], vec![]),
        Shape::Square => (vec![], vec![square]),
        Shape::SquareDot => (
            vec![c.polygon(&[(0.4, 0.4), (0.6, 0.4), (0.6, 0.6), (0.4, 0.6)])],
            vec![square],
        ),
        Shape::SquarePlus => (vec![], [vec![square], plus(c)].concat()),
        Shape::SquareCross => (vec![], [vec![square], cross(c)].concat()),
        Shape::SquareLeftHalf => (
            vec![c.polygon(&[(0.18, 0.18), (0.5, 0.18), (0.5, 0.82), (0.18, 0.82)])],
            vec![square],
        ),
        Shape::SquareDiagonalHalf => (
            vec![c.polygon(&[(0.18, 0.18), (0.82, 0.82), (0.18, 0.82)])],
            vec![square],
        ),
        Shape::SquareLines => (
            vec![],
            vec![
                square,
                c.line((0.18, 0.39), (0.82, 0.39)),
                c.line((0.18, 0.61), (0.82, 0.61)),
            ],
        ),
        Shape::SquareGrid => (
            vec![],
            vec![
                square,
                c.line((0.18, 0.39), (0.82, 0.39)),
                c.line((0.18, 0.61), (0.82, 0.61)),
                c.line((0.39, 0.18), (0.39, 0.82)),
                c.line((0.61, 0.18), (0.61, 0.82)),
            ],
        ),
        Shape::FilledCircle => (vec![circle], vec![]),
        Shape::Circle => (vec![], vec![circle]),
        Shape::CircleDot => (vec![c.circle(0.5, 0.5, 0.1)], vec![circle]),
        Shape::CirclePlus => (vec![], [vec![circle], plus(c)].concat()),
        Shape::CircleCross => (
            vec![],
            vec![
                circle,
                c.line((0.27, 0.27), (0.73, 0.73)),
                c.line((0.27, 0.73), (0.73, 0.27)),
            ],
        ),
        Shape::CircleLeftHalf => (vec![c.left_half(0.5, 0.5, 0.33)], vec![circle]),
        Shape::FilledTriangleUp => (
            vec![c.polygon(&[(0.5, 0.86), (0.86, 0.18), (0.14, 0.18)])],
            vec![],
        ),
        Shape::TriangleUp => (
            vec![],
            vec![c.polygon(&[(0.5, 0.86), (0.86, 0.18), (0.14, 0.18)])],
        ),
        Shape::FilledTriangleDown => (
            vec![c.polygon(&[(0.14, 0.82), (0.86, 0.82), (0.5, 0.14)])],
            vec![],
        ),
        Shape::FilledDiamond => (vec![c.polygon(&DIAMOND)], vec![]),
        Shape::Diamond => (vec![], vec![c.polygon(&DIAMOND)]),
        Shape::DiamondDot => (vec![c.circle(0.5, 0.5, 0.09)], vec![c.polygon(&DIAMOND)]),
        Shape::CornerLowerRight => (
            vec![c.polygon(&[(0.82, 0.18), (0.82, 0.82), (0.18, 0.18)])],
            vec![],
        ),
        Shape::CornerUpperLeft => (
            vec![c.polygon(&[(0.18, 0.82), (0.82, 0.82), (0.18, 0.18)])],
            vec![],
        ),
        Shape::Plus => (vec![], plus(c)),
        Shape::Cross => (vec![], cross(c)),
        Shape::FilledStar => (vec![star(c)], vec![]),
        Shape::Asterisk => (
            vec![],
            vec![
                c.line((0.5, 0.16), (0.5, 0.84)),
                c.line((0.2, 0.33), (0.8, 0.67)),
                c.line((0.2, 0.67), (0.8, 0.33)),
            ],
        ),
        Shape::FilledHeart => (vec![c.curves((0.5, 0.16), &HEART)], vec![]),
        Shape::Heart => (vec![], vec![c.curves((0.5, 0.16), &HEART)]),
        Shape::Spade => {
            let flipped: Vec<[(f64, f64); 3]> = HEART
                .iter()
                .map(|part| part.map(|(u, v)| (u, 1.04 - v)))
                .collect();
            (
                vec![c.curves((0.5, 0.88), &flipped), c.polygon(&STEM)],
                vec![],
            )
        }
        Shape::Club => (
            vec![
                c.circle(0.5, 0.66, 0.16),
                c.circle(0.31, 0.43, 0.16),
                c.circle(0.69, 0.43, 0.16),
                c.polygon(&STEM),
            ],
            vec![],
        ),
        Shape::ArrowUp => (
            vec![c.polygon(&[(0.5, 0.88), (0.32, 0.6), (0.68, 0.6)])],
            vec![c.line((0.5, 0.14), (0.5, 0.64))],
        ),
        Shape::ArrowRight => (
            vec![c.polygon(&[(0.88, 0.5), (0.6, 0.68), (0.6, 0.32)])],
            vec![c.line((0.14, 0.5), (0.64, 0.5))],
        ),
        Shape::ArrowBoth => (
            vec![
                c.polygon(&[(0.9, 0.5), (0.68, 0.66), (0.68, 0.34)]),
                c.polygon(&[(0.1, 0.5), (0.32, 0.66), (0.32, 0.34)]),
            ],
            vec![c.line((0.3, 0.5), (0.7, 0.5))],
        ),
        Shape::Bar => (
            vec![c.polygon(&[(0.44, 0.14), (0.56, 0.14), (0.56, 0.86), (0.44, 0.86)])],
            vec![],
        ),
        Shape::Dash => (
            vec![c.polygon(&[(0.14, 0.44), (0.86, 0.44), (0.86, 0.56), (0.14, 0.56)])],
            vec![],
        ),
        Shape::Slash => (vec![], vec![c.line((0.2, 0.16), (0.8, 0.84))]),
        Shape::Backslash => (vec![], vec![c.line((0.2, 0.84), (0.8, 0.16))]),
        Shape::FilledHexagon => (vec![hexagon(c)], vec![]),
        Shape::Hexagon => (vec![], vec![hexagon(c)]),
    }
}

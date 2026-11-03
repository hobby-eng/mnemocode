//! Hiding a phrase's entropy in a pattern's legend: the fewest threads whose legend can hold it,
//! then, among many legends that read as the same phrase, the one whose stitch counts are reached
//! with the least visible change. A count is set by moving stitches between two threads that touch:
//! close ones, or a thread and its parent in a tree of the threads rooted at the biggest one, which
//! joins every thread to the nearest in colour that it touches, so that no thread is left without a
//! partner; the rows are set in the order that leaves the biggest last, and each move takes the
//! stitch whose picture colour the new thread fits best. Stitches where the picture changes sharply
//! never move. A row that cannot move (near a digit limit, or with too few movable stitches) keeps
//! its count: only legends whose digits already fit it are taken, and a pattern with too many such
//! rows gives way to one of more threads.

use std::fmt;

use mnemocode::random::{Random, RandomError};
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretBytes;

use crate::color::Lab;
use crate::legend::{self, ENTROPY_LENGTHS, ONE_DIGIT_FROM, Row, TWO_DIGITS_FROM};
use crate::pattern::Pattern;
use crate::phrase::MaskedEntropy;
use crate::picture::Grid;

/// The fewest threads tried.
const FEWEST_THREADS: usize = 12;
/// The most threads tried.
pub const MOST_THREADS: usize = 60;
/// The bits of free choice kept above what the rows that cannot move take, so that legends can be
/// compared.
const SPARE_BITS: f64 = 14.0;
/// Two threads this far apart in CIELAB or nearer may trade stitches.
const CLOSE: f64 = 14.0;
/// Where the picture changes more than this between neighbouring stitches, nothing moves.
const SHARP: f64 = 25.0;
/// Rows this far or nearer from a digit limit, besides half its modulus, do not move.
const LIMIT_MARGIN: u32 = 10;
/// The fewest movable stitches a moving row needs.
const FEWEST_MOVABLE: u32 = 60;
/// Legends whose fixed rows fit, compared for the least change.
const COMPARED: usize = 48;
/// The most legends drawn while looking for those (CORE-50).
const MOST_DRAWN: usize = 1 << 20;
/// The most bits of digits that rows which cannot move may take: a legend fits them about once in
/// two to this power, which leaves [`COMPARED`] fits within [`MOST_DRAWN`] draws.
const MOST_FIXED_BITS: f64 = 12.0;
/// Two threads touching at fewer places than this count as not touching.
const FEWEST_TOUCHES: u32 = 8;
/// What the tree adds to the distance of two threads that do not touch, so that it takes them last.
const APART: f64 = 1000.0;

/// Why a phrase cannot be hidden in a picture.
#[derive(Debug)]
pub enum HideError {
    /// The entropy is no phrase's: not 16, 20, 24, 28 or 32 bytes.
    NotAnEntropy,
    /// Even [`MOST_THREADS`] threads give a legend too small for the phrase: the picture has too
    /// few colours.
    TooFewColours,
    /// No legend could be set within the limits of change.
    NoLegend,
    /// The randomness for the legend could not be read.
    Random(RandomError),
}

impl fmt::Display for HideError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAnEntropy => f.write_str("Only a phrase of 12, 15, 18, 21 or 24 words can be hidden in a pattern."),
            Self::TooFewColours => f.write_str(
                "The picture has too few colours to hold the phrase in its legend: choose a photograph or a painting with smooth shades, or a smaller phrase.",
            ),
            Self::NoLegend => f.write_str(
                "No legend of this picture holds the phrase without visible changes: choose another picture, or more stitches across.",
            ),
            Self::Random(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for HideError {}

impl Refusal for HideError {
    fn code(&self) -> &'static str {
        match self {
            Self::NotAnEntropy => "embroidery.hide.not-an-entropy",
            Self::TooFewColours => "embroidery.hide.too-few-colours",
            Self::NoLegend => "embroidery.hide.no-legend",
            Self::Random(error) => error.code(),
        }
    }
}

/// A pattern that holds a phrase: the pattern, its legend's rows in order, and what the hiding
/// changed. Its rows hold the phrase, so they are wiped when it is dropped.
#[derive(Debug)]
pub struct Hidden {
    pattern: Pattern,
    rows: Vec<Row>,
    moved: usize,
}

impl Drop for Hidden {
    fn drop(&mut self) {
        legend::wipe_rows(&mut self.rows);
    }
}

impl Hidden {
    /// The pattern, its counts set.
    #[must_use]
    pub const fn pattern(&self) -> &Pattern {
        &self.pattern
    }

    /// The legend's rows, in the pattern's thread order.
    #[must_use]
    pub fn rows(&self) -> &[Row] {
        &self.rows
    }

    /// How many stitches moved to another thread.
    #[must_use]
    pub const fn moved(&self) -> usize {
        self.moved
    }
}

/// `entropy`, a masked phrase's, hidden in a pattern of `grid`, with `random` choosing among the
/// legends that hold it.
///
/// # Errors
///
/// [`HideError`]: `embroidery.hide.not-an-entropy`, `embroidery.hide.too-few-colours`,
/// `embroidery.hide.no-legend`, or the randomness's `core.random.unavailable`.
pub fn hide(
    grid: &Grid,
    entropy: &MaskedEntropy,
    random: &mut dyn Random,
) -> Result<Hidden, HideError> {
    let entropy = entropy.bytes();
    if !ENTROPY_LENGTHS.contains(&entropy.len()) {
        return Err(HideError::NotAnEntropy);
    }
    let needed = legend::payload_bits(entropy.len()) as f64;
    let mut tried_one = false;
    for colours in FEWEST_THREADS..=MOST_THREADS {
        let pattern = Pattern::of_picture(grid, colours);
        let counts = pattern.counts();
        let Some(moduli) = legend::moduli(&counts) else {
            continue;
        };
        let plan = Plan::new(&pattern, grid);
        let fixed_bits: f64 = plan
            .fixed
            .iter()
            .map(|&t| libm::log2(f64::from(moduli[t])))
            .sum();
        if fixed_bits > MOST_FIXED_BITS
            || legend::room_bits(&moduli) < needed + SPARE_BITS + fixed_bits
        {
            continue;
        }
        match place(pattern, &plan, &moduli, entropy, random) {
            Err(HideError::NoLegend) => tried_one = true,
            done => return done,
        }
    }
    Err(if tried_one {
        HideError::NoLegend
    } else {
        HideError::TooFewColours
    })
}

/// Draws legends, keeps the cheapest one that the stitches can reach, and checks it reads back.
fn place(
    pattern: Pattern,
    plan: &Plan,
    moduli: &[u32],
    entropy: &SecretBytes,
    random: &mut dyn Random,
) -> Result<Hidden, HideError> {
    let free = legend::free_values(entropy.len(), moduli);
    let counts = pattern.counts();
    let mut best: Option<(f64, Pattern, Vec<usize>, usize)> = None;
    let mut compared = 0;
    for _ in 0..MOST_DRAWN {
        if compared == COMPARED || free == 0 {
            break;
        }
        let choice = below(random, free).map_err(HideError::Random)?;
        let assignment = legend::assign(entropy, moduli, choice);
        if plan
            .fixed
            .iter()
            .any(|&t| counts[t] % moduli[t] != assignment.digits[t])
        {
            continue;
        }
        compared += 1;
        let mut candidate = pattern.clone();
        let Some((cost, moved)) = plan.set_digits(&mut candidate, moduli, &assignment.digits)
        else {
            continue;
        };
        if legend::moduli(&candidate.counts()).as_deref() != Some(moduli) {
            continue;
        }
        if best.as_ref().is_none_or(|b| cost < b.0) {
            let mut assignment = assignment;
            best = Some((
                cost,
                candidate,
                std::mem::take(&mut assignment.symbols),
                moved,
            ));
        }
    }
    let (_, pattern, mut symbols, moved) = best.ok_or(HideError::NoLegend)?;
    let rows = pattern
        .counts()
        .iter()
        .zip(&symbols)
        .enumerate()
        .map(|(i, (&n, &s))| Row::new(i + 1, s + 1, n))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| HideError::NoLegend);
    zeroize::Zeroize::zeroize(&mut symbols);
    let rows = rows?;
    match legend::read(&rows) {
        legend::Reading::Read(read) if mnemocode::secret::equal_bytes(&read, entropy) => {
            Ok(Hidden {
                pattern,
                rows,
                moved,
            })
        }
        _ => Err(HideError::NoLegend),
    }
}

/// A uniform choice below `upper`, at least 1, from `random`: 64 bits drawn again while they fall in
/// the incomplete last range.
fn below(random: &mut dyn Random, upper: u64) -> Result<u64, RandomError> {
    let limit = u64::MAX - u64::MAX % upper;
    loop {
        let mut bytes = [0_u8; 8];
        random.fill(&mut bytes)?;
        let value = u64::from_le_bytes(bytes);
        zeroize::Zeroize::zeroize(&mut bytes);
        if value < limit {
            return Ok(value % upper);
        }
    }
}

/// What may move in a pattern and along which threads.
struct Plan {
    /// The picture's colour under each stitch.
    source: Vec<Lab>,
    /// Stitches that never move: where the picture changes sharply.
    protect: Vec<bool>,
    /// Rows that carry digits but never move.
    fixed: Vec<usize>,
    /// The moving rows, children before their parents, the biggest last.
    order: Vec<usize>,
    /// Which rows may trade stitches with which.
    trade: Vec<Vec<bool>>,
}

impl Plan {
    fn new(pattern: &Pattern, grid: &Grid) -> Self {
        let (width, height) = (pattern.width(), pattern.height());
        let counts = pattern.counts();
        let k = counts.len();
        let source = grid.colors().to_vec();
        let protect = sharp_places(&source, width, height);
        let cells = pattern.cells();
        let mut movable = vec![0_u32; k];
        for (cell, &guarded) in cells.iter().zip(&protect) {
            if !guarded {
                movable[usize::from(*cell)] += 1;
            }
        }
        let biggest = (0..k).max_by_key(|&t| counts[t]).unwrap_or(0);
        let mut pool: Vec<usize> = (0..k)
            .filter(|&t| {
                t == biggest || (away_from_limits(counts[t]) && movable[t] >= FEWEST_MOVABLE)
            })
            .collect();
        pool.sort_unstable();
        let fixed = (0..k)
            .filter(|&t| t != biggest && counts[t] >= ONE_DIGIT_FROM && !pool.contains(&t))
            .collect();
        let colors = pattern.colors();
        let touch = touching(cells, width, height, k);
        let parent = tree(&pool, biggest, colors, &touch);
        let mut order = Vec::with_capacity(pool.len());
        post_order(biggest, &parent, &pool, &mut order);
        let mut trade = vec![vec![false; k]; k];
        for &a in &pool {
            for &b in &pool {
                trade[a][b] = a != b && colors[a].distance(colors[b]) <= CLOSE;
            }
        }
        for (&child, &up) in pool.iter().zip(pool.iter().map(|t| &parent[*t])) {
            if let Some(up) = up {
                trade[child][up] = true;
                trade[up][child] = true;
            }
        }
        Self {
            source,
            protect,
            fixed,
            order,
            trade,
        }
    }

    /// Moves stitches so that each moving row's count ends in its digit. The change's cost and the
    /// stitches moved; none where a row cannot be set.
    fn set_digits(
        &self,
        pattern: &mut Pattern,
        moduli: &[u32],
        digits: &[u32],
    ) -> Option<(f64, usize)> {
        let (width, height) = (pattern.width(), pattern.height());
        let colors = pattern.colors().to_vec();
        let mut counts = pattern.counts();
        let mut open: Vec<bool> = vec![false; counts.len()];
        for &t in &self.order {
            open[t] = true;
        }
        let (mut cost, mut moved) = (0.0, 0);
        let last = self.order.len().saturating_sub(1);
        for &t in &self.order[..last] {
            open[t] = false;
            let m = moduli[t];
            if m <= 1 {
                continue;
            }
            let mut delta =
                (i64::from(digits[t]) - i64::from(counts[t] % m)).rem_euclid(i64::from(m));
            if delta > i64::from(m / 2) {
                delta -= i64::from(m);
            }
            let partners: Vec<usize> = (0..counts.len())
                .filter(|&u| open[u] && self.trade[t][u])
                .collect();
            if delta != 0 && partners.is_empty() {
                return None;
            }
            let cells = pattern.cells_mut();
            let step = Step {
                t,
                partners: &partners,
                colors: &colors,
                width,
                height,
            };
            let (c, n) = self.move_stitches(cells, &step, delta)?;
            cost += c;
            moved += n;
            counts = crate::pattern::count(cells, counts.len());
        }
        Some((cost, moved))
    }

    /// Moves `|delta|` stitches into row `step.t` (delta above zero) or out of it, the cheapest
    /// first; the cost and the count moved, none where too few can move.
    fn move_stitches(
        &self,
        cells: &mut [u16],
        step: &Step<'_>,
        delta: i64,
    ) -> Option<(f64, usize)> {
        let need = delta.unsigned_abs() as usize;
        if need == 0 {
            return Some((0.0, 0));
        }
        let t = step.t;
        let mut candidates: Vec<(f64, usize, usize)> = Vec::new();
        for (at, &cell) in cells.iter().enumerate() {
            if self.protect[at] {
                continue;
            }
            let here = usize::from(cell);
            let source = self.source[at];
            let near = neighbours(at, step.width, step.height);
            if delta > 0 {
                if step.partners.contains(&here)
                    && near.iter().flatten().any(|&n| usize::from(cells[n]) == t)
                {
                    let c = source.distance(step.colors[t]) - source.distance(step.colors[here]);
                    candidates.push((c, at, t));
                }
            } else if here == t {
                let best = near
                    .iter()
                    .flatten()
                    .map(|&n| usize::from(cells[n]))
                    .filter(|u| step.partners.contains(u))
                    .min_by(|&a, &b| {
                        source
                            .distance(step.colors[a])
                            .total_cmp(&source.distance(step.colors[b]))
                    });
                if let Some(to) = best {
                    candidates.push((
                        source.distance(step.colors[to]) - source.distance(step.colors[t]),
                        at,
                        to,
                    ));
                }
            }
        }
        if candidates.len() < need {
            return None;
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut cost = 0.0;
        for &(c, at, to) in &candidates[..need] {
            cells[at] = u16::try_from(to).ok()?;
            cost += c;
        }
        Some((cost, need))
    }
}

/// One row's move: the row, the rows it may trade with, the threads' colours and the size.
struct Step<'a> {
    t: usize,
    partners: &'a [usize],
    colors: &'a [Lab],
    width: usize,
    height: usize,
}

/// Whether a row of `stitches` lies far enough from every digit limit that moves cannot cross it.
fn away_from_limits(stitches: u32) -> bool {
    let near = |limit: u32, modulus: u32| {
        let reach = modulus / 2 + LIMIT_MARGIN;
        stitches + reach >= limit && stitches < limit + reach
    };
    !near(ONE_DIGIT_FROM, 10) && !near(TWO_DIGITS_FROM, 100) && stitches >= ONE_DIGIT_FROM
}

/// The stitches whose colour differs from a neighbour's in the picture by more than [`SHARP`].
fn sharp_places(source: &[Lab], width: usize, height: usize) -> Vec<bool> {
    (0..source.len())
        .map(|at| {
            neighbours(at, width, height)
                .iter()
                .flatten()
                .any(|&n| source[at].distance(source[n]) > SHARP)
        })
        .collect()
}

/// The stitches left, right, above and below stitch `at`.
fn neighbours(at: usize, width: usize, height: usize) -> [Option<usize>; 4] {
    let (x, y) = (at % width, at / width);
    [
        (x > 0).then(|| at - 1),
        (x + 1 < width).then(|| at + 1),
        (y > 0).then(|| at - width),
        (y + 1 < height).then(|| at + width),
    ]
}

/// How many times each two threads touch side by side.
fn touching(cells: &[u16], width: usize, height: usize, k: usize) -> Vec<Vec<u32>> {
    let mut touch = vec![vec![0_u32; k]; k];
    for at in 0..cells.len() {
        let a = usize::from(cells[at]);
        for n in [
            neighbours(at, width, height)[1],
            neighbours(at, width, height)[3],
        ]
        .into_iter()
        .flatten()
        {
            let b = usize::from(cells[n]);
            if a != b {
                touch[a][b] += 1;
                touch[b][a] += 1;
            }
        }
    }
    touch
}

/// A tree over `pool` rooted at `root`: each thread joined to the nearest in colour among those
/// already in it, threads that touch in the picture before those that do not (Prim's).
fn tree(pool: &[usize], root: usize, colors: &[Lab], touch: &[Vec<u32>]) -> Vec<Option<usize>> {
    let mut parent = vec![None; colors.len()];
    let mut inside = vec![root];
    while inside.len() < pool.len() {
        let mut best: Option<(f64, usize, usize)> = None;
        for &a in &inside {
            for &b in pool {
                if inside.contains(&b) {
                    continue;
                }
                let far = if touch[a][b] >= FEWEST_TOUCHES {
                    0.0
                } else {
                    APART
                };
                let weight = colors[a].distance(colors[b]) + far;
                if best.is_none_or(|x| weight < x.0) {
                    best = Some((weight, a, b));
                }
            }
        }
        let Some((_, a, b)) = best else { break };
        parent[b] = Some(a);
        inside.push(b);
    }
    parent
}

/// The threads of the tree below `node`, children first, then `node`.
fn post_order(node: usize, parent: &[Option<usize>], pool: &[usize], out: &mut Vec<usize>) {
    for &child in pool {
        if parent[child] == Some(node) {
            post_order(child, parent, pool, out);
        }
    }
    out.push(node);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::picture;
    use crate::sample::{gradient_png, png_file, two_colours_png};

    /// Always the first choice: enough where nothing is compared.
    struct First;

    impl Random for First {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            bytes.fill(0);
            Ok(())
        }
    }

    /// The bytes of the gate's emulated `crypto.getRandomValues` (xtask's `wasm/probe.rs`), the same
    /// on every call, counted.
    struct Repeating(usize);

    impl Random for Repeating {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            self.0 += 1;
            let mut byte = 0x31_u8;
            for each in bytes {
                *each = byte;
                byte = byte.wrapping_add(5);
            }
            Ok(())
        }
    }

    #[test]
    fn the_pattern_of_the_memory_scan_takes_few_draws_of_a_source_that_repeats() {
        // The memory scan of the WebAssembly binding hides its 12-word phrase, masked with its
        // dates (xtask's `wasm/probe/entries.rs`), in this picture with a source that repeats: it
        // must not draw the same legend until MOST_DRAWN runs out.
        let grid = picture::grid(&gradient_png(), 120).unwrap();
        let phrase = mnemocode::bip39::phrase::Phrase::parse(
            "pass brush price flock will food title jelly scrub change verify old",
        )
        .unwrap();
        let dates =
            ["23-09-2026", "01-02-2001"].map(|date| mnemocode::dates::parse_date(date).unwrap());
        let entropy = crate::phrase::masked_entropy(&phrase, &dates).unwrap();
        let mut source = Repeating(0);
        hide(&grid, &entropy, &mut source).unwrap();
        assert!(source.0 < 1000, "{} draws", source.0);
    }

    #[test]
    fn a_flat_picture_of_two_colours_is_refused_as_too_few_colours() {
        let grid = picture::grid(&two_colours_png(), 100).unwrap();
        let entropy = MaskedEntropy::known(&[0x7f; 16]);
        let refused = hide(&grid, &entropy, &mut First).unwrap_err();
        assert_eq!(refused.code(), "embroidery.hide.too-few-colours");
    }

    #[test]
    fn an_entropy_of_no_phrase_length_is_refused() {
        let file = png_file(200, 100, |x, y| [x as u8, y as u8, 99]);
        let grid = picture::grid(&file, 100).unwrap();
        let entropy = MaskedEntropy::known(&[1; 17]);
        assert_eq!(
            hide(&grid, &entropy, &mut First).unwrap_err().code(),
            "embroidery.hide.not-an-entropy"
        );
    }

    #[test]
    fn a_draw_below_a_bound_is_uniform_over_it_and_never_reaches_it() {
        struct Counting(u64);
        impl Random for Counting {
            fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
                self.0 += 1;
                bytes.copy_from_slice(&self.0.to_le_bytes()[..bytes.len()]);
                Ok(())
            }
        }
        let mut source = Counting(0);
        let drawn: Vec<u64> = (0..1000)
            .map(|_| below(&mut source, 1 << 40).unwrap())
            .collect();
        assert!(drawn.iter().all(|&d| d < 1 << 40));
        assert_eq!(below(&mut First, 1).unwrap(), 0);
    }
}

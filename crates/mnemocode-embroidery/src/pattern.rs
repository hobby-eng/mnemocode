//! A picture in DMC threads: the colours it needs found by median cut and k-means in CIELAB, each
//! matched to the nearest unused thread, then every stitch chosen by serpentine Floyd-Steinberg
//! dithering, as patterns made from photographs are, so that crosses of neighbouring threads blend
//! into the shades between them seen from a little distance. A thread left with fewer than
//! [`MIN_STITCHES`] is dropped and the picture dithered again.

use std::fmt;

use mnemocode::secret::redacted;
use zeroize::Zeroize;

use crate::color::{self, Lab};
use crate::dmc::{THREADS, Thread};
use crate::picture::Grid;

/// The fewest stitches a thread keeps; a thread with fewer is scattered noise and is dropped.
pub const MIN_STITCHES: u32 = 12;
/// The most error a dithering step passes on, per CIELAB channel, so that dark areas do not bloom.
const ERROR_LIMIT: f64 = 12.0;
/// The rounds of k-means after the median cut.
const ROUNDS: usize = 12;
/// The most colours the k-means looks at: an even sample of a larger picture.
const SAMPLE: usize = 120_000;
/// The most times threads are dropped and the picture dithered again.
const PRUNE_ROUNDS: usize = 8;

/// A pattern: its threads in legend order and the thread of every stitch. After a backup is
/// hidden in it, its stitch counts carry part of that backup, so it wipes its stitches when
/// dropped and its `Debug` tells nothing (RUST-13).
#[derive(Clone)]
pub struct Pattern {
    width: usize,
    height: usize,
    /// Indexes into [`THREADS`], sorted as a legend lists them.
    threads: Vec<usize>,
    /// The CIELAB colour of each thread.
    colors: Vec<Lab>,
    /// For each stitch, row by row, its place in `threads`.
    cells: Vec<u16>,
}

impl fmt::Debug for Pattern {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Pattern")
    }
}

impl Drop for Pattern {
    fn drop(&mut self) {
        self.cells.zeroize();
    }
}

impl Pattern {
    /// The pattern of `grid` in about `colours` threads: fewer where the picture needs fewer,
    /// where two colours fall to one thread or where a thread keeps too few stitches.
    #[must_use]
    pub fn of_picture(grid: &Grid, colours: usize) -> Self {
        let centers = kmeans(grid.colors(), colours.max(1));
        let mut threads = nearest_unused_threads(&centers);
        // The stitches are always dithered with the threads that are kept: a round that drops a
        // thread dithers again, and the last round keeps what it has.
        let mut rounds = 0;
        let mut cells = loop {
            let colors: Vec<Lab> = threads.iter().map(|&t| thread_lab(t)).collect();
            let cells = dither(grid, &colors);
            let counts = count(&cells, threads.len());
            let kept: Vec<usize> = threads
                .iter()
                .zip(&counts)
                .filter(|&(_, &n)| n >= MIN_STITCHES)
                .map(|(&t, _)| t)
                .collect();
            rounds += 1;
            if kept.len() == threads.len() || kept.is_empty() || rounds == PRUNE_ROUNDS {
                break cells;
            }
            threads = kept;
        };
        let mut order: Vec<usize> = (0..threads.len()).collect();
        order.sort_by_key(|&i| THREADS[threads[i]].order());
        let mut place = vec![0_u16; threads.len()];
        for (new, &old) in order.iter().enumerate() {
            place[old] = u16::try_from(new).unwrap_or(u16::MAX);
        }
        for cell in &mut cells {
            *cell = place[usize::from(*cell)];
        }
        let threads: Vec<usize> = order.iter().map(|&i| threads[i]).collect();
        let colors = threads.iter().map(|&t| thread_lab(t)).collect();
        Self {
            width: grid.width(),
            height: grid.height(),
            threads,
            colors,
            cells,
        }
    }

    /// Stitches across.
    #[must_use]
    pub const fn width(&self) -> usize {
        self.width
    }

    /// Stitches down.
    #[must_use]
    pub const fn height(&self) -> usize {
        self.height
    }

    /// The threads, in the order of the legend.
    pub fn threads(&self) -> impl Iterator<Item = &'static Thread> + '_ {
        self.threads.iter().map(|&t| &THREADS[t])
    }

    /// How many threads it has.
    #[must_use]
    pub fn thread_count(&self) -> usize {
        self.threads.len()
    }

    /// The place among [`Pattern::threads`] of the thread of each stitch, row by row.
    #[must_use]
    pub fn cells(&self) -> &[u16] {
        &self.cells
    }

    /// The stitches of each thread, in the order of [`Pattern::threads`].
    #[must_use]
    pub fn counts(&self) -> Vec<u32> {
        count(&self.cells, self.threads.len())
    }

    /// The CIELAB colour of each thread, in the order of [`Pattern::threads`].
    pub(crate) fn colors(&self) -> &[Lab] {
        &self.colors
    }

    /// The stitches, for moving some of them to another thread.
    pub(crate) fn cells_mut(&mut self) -> &mut [u16] {
        &mut self.cells
    }

    /// How far it looks from `grid` seen from a little distance: both blurred by about one stitch,
    /// then the mean CIE76 distance. Below 2 the two look alike; above 5 they differ plainly.
    #[must_use]
    pub fn seen_difference(&self, grid: &Grid) -> f64 {
        let stitched: Vec<Lab> = self
            .cells
            .iter()
            .map(|&c| self.colors[usize::from(c)])
            .collect();
        let (a, b) = (
            blur(grid.colors(), self.width, self.height),
            blur(&stitched, self.width, self.height),
        );
        let total: f64 = a.iter().zip(&b).map(|(x, y)| x.distance(*y)).sum();
        total / a.len().max(1) as f64
    }
}

/// The CIELAB colour of thread `index` of [`THREADS`].
fn thread_lab(index: usize) -> Lab {
    color::lab_of_rgb(THREADS[index].rgb())
}

/// The stitches of each of `threads` threads in `cells`.
pub(crate) fn count(cells: &[u16], threads: usize) -> Vec<u32> {
    let mut counts = vec![0_u32; threads];
    for &cell in cells {
        if let Some(n) = counts.get_mut(usize::from(cell)) {
            *n += 1;
        }
    }
    counts
}

/// The place in `colors` nearest to `target`.
pub(crate) fn nearest(colors: &[Lab], target: Lab) -> usize {
    let mut best = (f64::INFINITY, 0);
    for (i, c) in colors.iter().enumerate() {
        let d = c.distance_squared(target);
        if d < best.0 {
            best = (d, i);
        }
    }
    best.1
}

/// About `k` colours that stand for `colors`: a median cut, then rounds of k-means.
fn kmeans(colors: &[Lab], k: usize) -> Vec<Lab> {
    let step = colors.len().div_ceil(SAMPLE).max(1);
    let sample: Vec<Lab> = colors.iter().step_by(step).copied().collect();
    let mut centers = median_cut(&sample, k);
    for _ in 0..ROUNDS {
        let mut sums = vec![(Lab::default(), 0_usize); centers.len()];
        for &c in &sample {
            let (sum, n) = &mut sums[nearest(&centers, c)];
            *sum = sum.plus(c, 1.0);
            *n += 1;
        }
        for (center, (sum, n)) in centers.iter_mut().zip(sums) {
            if n > 0 {
                *center = mean(sum, n);
            }
        }
    }
    centers
}

/// `sum` divided by `n`.
fn mean(sum: Lab, n: usize) -> Lab {
    let n = n.max(1) as f64;
    Lab {
        l: sum.l / n,
        a: sum.a / n,
        b: sum.b / n,
    }
}

/// `k` colours by median cut: the box of colours with the widest channel is split at its median,
/// until there are `k` boxes or none can be split; each box gives its mean.
fn median_cut(colors: &[Lab], k: usize) -> Vec<Lab> {
    let channel = |c: &Lab, axis: usize| [c.l, c.a, c.b][axis];
    let mut boxes: Vec<Vec<Lab>> = vec![colors.to_vec()];
    while boxes.len() < k {
        let widest = boxes
            .iter()
            .enumerate()
            .filter(|(_, b)| b.len() > 1)
            .map(|(i, b)| {
                let range = |axis| {
                    let (lo, hi) = b
                        .iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), c| {
                            (lo.min(channel(c, axis)), hi.max(channel(c, axis)))
                        });
                    hi - lo
                };
                let (axis, width) = (0..3).map(|axis| (axis, range(axis))).fold(
                    (0, f64::NEG_INFINITY),
                    |best, x| if x.1 > best.1 { x } else { best },
                );
                (i, axis, width)
            })
            .fold(None, |best: Option<(usize, usize, f64)>, x| match best {
                Some(b) if b.2 >= x.2 => Some(b),
                _ => Some(x),
            });
        let Some((index, axis, width)) = widest else {
            break;
        };
        if width <= 0.0 {
            break;
        }
        let mut split = boxes.swap_remove(index);
        split.sort_by(|x, y| channel(x, axis).total_cmp(&channel(y, axis)));
        let upper = split.split_off(split.len() / 2);
        boxes.push(split);
        boxes.push(upper);
    }
    boxes
        .iter()
        .map(|b| {
            mean(
                b.iter().fold(Lab::default(), |s, &c| s.plus(c, 1.0)),
                b.len(),
            )
        })
        .collect()
}

/// For each colour, the nearest thread that no colour before it took.
fn nearest_unused_threads(centers: &[Lab]) -> Vec<usize> {
    let all: Vec<Lab> = (0..THREADS.len()).map(thread_lab).collect();
    let mut taken = vec![false; THREADS.len()];
    let mut chosen = Vec::with_capacity(centers.len());
    for &center in centers {
        let mut best = (f64::INFINITY, None);
        for (i, c) in all.iter().enumerate() {
            let d = c.distance_squared(center);
            if !taken[i] && d < best.0 {
                best = (d, Some(i));
            }
        }
        if let (_, Some(i)) = best {
            taken[i] = true;
            chosen.push(i);
        }
    }
    chosen
}

/// The thread of every stitch of `grid` among `colors`, by serpentine Floyd-Steinberg dithering
/// with the error passed on limited to [`ERROR_LIMIT`].
fn dither(grid: &Grid, colors: &[Lab]) -> Vec<u16> {
    let (width, height) = (grid.width(), grid.height());
    let mut work = grid.colors().to_vec();
    let mut cells = vec![0_u16; width * height];
    for y in 0..height {
        let forward = y % 2 == 0;
        for step in 0..width {
            let x = if forward { step } else { width - 1 - step };
            let at = y * width + x;
            let chosen = nearest(colors, work[at]);
            cells[at] = u16::try_from(chosen).unwrap_or(u16::MAX);
            let error = work[at].clamped_difference(colors[chosen], ERROR_LIMIT);
            let ahead = if forward { x + 1 } else { x.wrapping_sub(1) };
            let behind = if forward { x.wrapping_sub(1) } else { x + 1 };
            for (nx, ny, weight) in [
                (ahead, y, 7.0),
                (behind, y + 1, 3.0),
                (x, y + 1, 5.0),
                (ahead, y + 1, 1.0),
            ] {
                if nx < width && ny < height {
                    let next = &mut work[ny * width + nx];
                    *next = next.plus(error, weight / 16.0);
                }
            }
        }
    }
    cells
}

/// `colors` blurred by a 5 by 5 binomial kernel, which spreads about one stitch, edges repeated.
fn blur(colors: &[Lab], width: usize, height: usize) -> Vec<Lab> {
    const KERNEL: [f64; 5] = [1.0, 4.0, 6.0, 4.0, 1.0];
    let pass = |source: &[Lab], horizontal: bool| -> Vec<Lab> {
        let mut out = Vec::with_capacity(source.len());
        for y in 0..height {
            for x in 0..width {
                let mut sum = Lab::default();
                for (k, weight) in KERNEL.iter().enumerate() {
                    let offset = k as isize - 2;
                    let (sx, sy) = if horizontal {
                        (
                            (x as isize + offset).clamp(0, width as isize - 1) as usize,
                            y,
                        )
                    } else {
                        (
                            x,
                            (y as isize + offset).clamp(0, height as isize - 1) as usize,
                        )
                    };
                    sum = sum.plus(source[sy * width + sx], weight / 16.0);
                }
                out.push(sum);
            }
        }
        out
    };
    pass(&pass(colors, true), false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::picture;
    use crate::sample::png_file;

    #[test]
    fn a_picture_of_two_colours_becomes_two_threads() {
        let file = png_file(120, 60, |x, _| if x < 60 { [0; 3] } else { [255; 3] });
        let grid = picture::grid(&file, 60).unwrap();
        let pattern = Pattern::of_picture(&grid, 6);
        let numbers: Vec<&str> = pattern.threads().map(Thread::number).collect();
        assert_eq!(numbers, ["310", "B5200"]);
        assert_eq!(pattern.counts(), [900, 900]);
        assert!(pattern.seen_difference(&grid) < 3.0);
    }

    #[test]
    fn a_gradient_keeps_its_threads_in_legend_order_and_every_stitch_is_one_of_them() {
        let file = png_file(200, 100, |x, y| [(x + y) as u8, 90, 255 - (x as u8) / 2]);
        let grid = picture::grid(&file, 100).unwrap();
        let pattern = Pattern::of_picture(&grid, 16);
        let orders: Vec<_> = pattern.threads().map(Thread::order).collect();
        assert!(orders.windows(2).all(|w| w[0] < w[1]));
        assert!(
            pattern
                .cells()
                .iter()
                .all(|&c| usize::from(c) < pattern.thread_count())
        );
        assert!(pattern.counts().iter().all(|&n| n >= MIN_STITCHES));
        assert_eq!(pattern.counts().iter().sum::<u32>(), 100 * 50);
    }
}

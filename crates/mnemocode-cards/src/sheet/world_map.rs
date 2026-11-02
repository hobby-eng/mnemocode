//! The world map printed behind a collection sheet (MnemoCode TS 0.1.0's `export/world-map.ts`,
//! CAP-CARDS-WORLD-MAP): the Robinson projection, the familiar rounded world map, with land shapes
//! generated once from public-domain Natural Earth data (`assets/maps/NOTICE`).

use crate::scene::{Path, Segment};

/// Width of the map box in map units.
pub(super) const WORLD_MAP_WIDTH: f64 = 2000.0;
/// The Robinson map is 0.5072 times as high as it is wide.
pub(super) const WORLD_MAP_HEIGHT: f64 = 1014.0;
/// One land polygon on each line, as an SVG path in map units, y downwards.
const WORLD_MAP_LAND: &str = include_str!("../../assets/maps/world-land.txt");
/// Degrees between the points of a curved line.
const SMOOTHNESS: i32 = 3;
const TABLE_STEP_DEGREES: f64 = 5.0;

/// The published Robinson table for every 5 degrees of latitude: the length of the parallel and its
/// distance from the equator, both relative.
const ROBINSON_TABLE: [(f64, f64); 19] = [
    (1.0, 0.0),
    (0.9986, 0.062),
    (0.9954, 0.124),
    (0.99, 0.186),
    (0.9822, 0.248),
    (0.973, 0.31),
    (0.96, 0.372),
    (0.9427, 0.434),
    (0.9216, 0.4958),
    (0.8962, 0.5571),
    (0.8679, 0.6176),
    (0.835, 0.6769),
    (0.7986, 0.7346),
    (0.7597, 0.7903),
    (0.7186, 0.8435),
    (0.6732, 0.8936),
    (0.6213, 0.9394),
    (0.5722, 0.9761),
    (0.5322, 1.0),
];

/// `value` with one decimal, as the map's paths are written.
fn tenths(value: f64) -> f64 {
    libm::round(value * 10.0) / 10.0
}

/// Projects a place on Earth into the map box.
fn robinson(longitude: f64, latitude: f64) -> (f64, f64) {
    let position = latitude.abs().min(90.0) / TABLE_STEP_DEGREES;
    let row = (position as usize).min(ROBINSON_TABLE.len() - 2);
    let share = position - row as f64;
    let (length, distance) = ROBINSON_TABLE[row];
    let (next_length, next_distance) = ROBINSON_TABLE[row + 1];
    let parallel = length + (next_length - length) * share;
    let sign = if latitude == 0.0 {
        0.0
    } else {
        latitude.signum()
    };
    let from_equator = (distance + (next_distance - distance) * share) * sign;
    (
        (WORLD_MAP_WIDTH / 2.0) * (1.0 + (parallel * longitude) / 180.0),
        (WORLD_MAP_HEIGHT / 2.0) * (1.0 - from_equator),
    )
}

/// The path through `points`.
fn line(points: &[(f64, f64)]) -> Path {
    points
        .iter()
        .enumerate()
        .map(|(index, (x, y))| {
            if index == 0 {
                Segment::Move(tenths(*x), tenths(*y))
            } else {
                Segment::Line(tenths(*x), tenths(*y))
            }
        })
        .collect()
}

/// Meridians and parallels every `step` degrees, as one path each.
#[must_use]
pub(super) fn graticule(step: usize) -> Vec<Path> {
    let mut lines = Vec::new();
    for longitude in (-180..=180).step_by(step) {
        let points: Vec<(f64, f64)> = (-90..=90)
            .step_by(SMOOTHNESS as usize)
            .map(|latitude| robinson(f64::from(longitude), f64::from(latitude)))
            .collect();
        lines.push(line(&points));
    }
    for latitude in (-90..=90).step_by(step) {
        let latitude = f64::from(latitude);
        lines.push(line(&[
            robinson(-180.0, latitude),
            robinson(180.0, latitude),
        ]));
    }
    lines
}

/// The land, one path for each polygon.
#[must_use]
pub(super) fn land() -> Vec<Path> {
    WORLD_MAP_LAND.lines().map(land_path).collect()
}

/// The path of `text`: M, L and Z, each number whole or decimal, in the bundled file's own form.
fn land_path(text: &str) -> Path {
    let mut path = Path::new();
    let mut numbers = Vec::with_capacity(2);
    let mut command = 'M';
    let flush = |numbers: &mut Vec<f64>, command: char, path: &mut Path| {
        if let [x, y] = numbers[..] {
            path.push(if command == 'M' {
                Segment::Move(x, y)
            } else {
                Segment::Line(x, y)
            });
        }
        numbers.clear();
    };
    let mut start = None;
    for (at, character) in text.char_indices().chain([(text.len(), ' ')]) {
        let delimiter = matches!(character, ' ' | 'M' | 'L' | 'Z');
        if delimiter {
            if let Some(from) = start.take()
                && let Ok(number) = text[from..at].parse()
            {
                numbers.push(number);
            }
            if numbers.len() == 2 {
                flush(&mut numbers, command, &mut path);
            }
            match character {
                'M' | 'L' => command = character,
                'Z' => path.push(Segment::Close),
                _ => {}
            }
        } else if start.is_none() {
            start = Some(at);
        }
    }
    path
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_land_reads_and_the_projection_keeps_its_box() {
        let land = land();
        assert!(land[1].len() > 5);
        assert_eq!(land[1][0], Segment::Move(720.0, 827.0));
        assert_eq!(land[1].last(), Some(&Segment::Close));
        assert_eq!(robinson(0.0, 0.0), (1000.0, 507.0));
        assert_eq!(robinson(-180.0, 0.0), (0.0, 507.0));
        assert_eq!(graticule(30).len(), 13 + 7);
    }
}

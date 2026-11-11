//! QR Model 2 function-module exclusion, zigzag placement and mask removal (ISO/IEC 18004).
use super::blocks;
use crate::secret::SecretBytes;

fn functions(version: u8) -> Vec<bool> {
    let size = usize::from(version) * 4 + 17;
    let mut reserved = vec![false; size * size];
    for row in 0..size {
        for col in 0..size {
            if row == 6
                || col == 6
                || (row < 9 && col < 9)
                || (row < 9 && col >= size - 8)
                || (row >= size - 8 && col < 9)
            {
                reserved[row * size + col] = true;
            }
        }
    }
    if version >= 2 {
        let count = usize::from(version) / 7 + 2;
        let step = if version == 32 {
            26
        } else {
            (usize::from(version) * 4 + count * 2 + 1) / (count * 2 - 2) * 2
        };
        let mut centers = vec![6; count];
        for (i, center) in centers.iter_mut().enumerate().skip(1) {
            *center = size - 7 - (count - 1 - i) * step;
        }
        for (i, &row) in centers.iter().enumerate() {
            for (j, &col) in centers.iter().enumerate() {
                if (i == 0 && (j == 0 || j == count - 1)) || (i == count - 1 && j == 0) {
                    continue;
                }
                for y in row - 2..=row + 2 {
                    for x in col - 2..=col + 2 {
                        reserved[y * size + x] = true;
                    }
                }
            }
        }
    }
    if version >= 7 {
        for i in 0..18 {
            let a = size - 11 + i % 3;
            let b = i / 3;
            reserved[b * size + a] = true;
            reserved[a * size + b] = true;
        }
    }
    reserved
}
fn masked(mask: u16, row: usize, col: usize) -> bool {
    match mask {
        0 => (row + col).is_multiple_of(2),
        1 => row.is_multiple_of(2),
        2 => col.is_multiple_of(3),
        3 => (row + col).is_multiple_of(3),
        4 => (row / 2 + col / 3).is_multiple_of(2),
        5 => (row * col) % 2 + (row * col) % 3 == 0,
        6 => ((row * col) % 2 + (row * col) % 3).is_multiple_of(2),
        _ => ((row + col) % 2 + (row * col) % 3).is_multiple_of(2),
    }
}

pub(super) fn read(grid: &dyn rqrr::BitGrid, version: u8, mask: u16) -> SecretBytes {
    let size = usize::from(version) * 4 + 17;
    let reserved = functions(version);
    let mut out = SecretBytes::zeroed("QR interleaved words", blocks::layout(version).0);
    let mut bit = 0;
    let mut right = size - 1;
    let mut up = true;
    while right > 0 {
        if right == 6 {
            right -= 1;
        }
        for step in 0..size {
            let row = if up { size - 1 - step } else { step };
            for col in [right, right - 1] {
                if reserved[row * size + col] {
                    continue;
                }
                if bit < out.len() * 8 && grid.bit(row, col) ^ masked(mask, row, col) {
                    out[bit / 8] |= 1 << (7 - bit % 8);
                }
                bit += 1;
            }
        }
        right = right.saturating_sub(2);
        up = !up;
    }
    out
}

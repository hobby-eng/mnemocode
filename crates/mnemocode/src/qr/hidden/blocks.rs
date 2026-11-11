//! ISO/IEC 18004 level M block layout and Reed–Solomon correction over GF(256), primitive 0x11d.
use super::super::QrError;
use crate::secret::SecretBytes;

// ISO/IEC 18004 level M tables, indexed by version minus one.
const PARITY: [usize; 40] = [
    10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const BLOCKS: [usize; 40] = [
    1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
    26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

pub(super) fn layout(version: u8) -> (usize, usize, usize) {
    let v = usize::from(version);
    let mut modules = (16 * v + 128) * v + 64;
    if v >= 2 {
        let align = v / 7 + 2;
        modules -= (25 * align - 10) * align - 55;
        if v >= 7 {
            modules -= 36;
        }
    }
    (modules / 8, BLOCKS[v - 1], PARITY[v - 1])
}

pub(super) fn capacity(version: u8) -> usize {
    let (raw, blocks, parity) = layout(version);
    raw - blocks * parity
}

fn mul(mut a: u8, mut b: u8) -> u8 {
    let mut result = 0;
    for _ in 0..8 {
        if b & 1 != 0 {
            result ^= a;
        }
        a = (a << 1) ^ if a & 128 != 0 { 0x1d } else { 0 };
        b >>= 1;
    }
    result
}
fn power(mut a: u8, mut n: usize) -> u8 {
    let mut result = 1;
    while n != 0 {
        if n & 1 != 0 {
            result = mul(result, a);
        }
        a = mul(a, a);
        n >>= 1;
    }
    result
}
fn div(a: u8, b: u8) -> u8 {
    mul(a, power(b, 254))
}
fn eval(poly: &[u8], x: u8) -> u8 {
    poly.iter().rev().fold(0, |sum, &c| mul(sum, x) ^ c)
}
fn syndromes(bytes: &[u8], parity: usize) -> Vec<u8> {
    (0..parity)
        .map(|i| bytes.iter().fold(0, |s, &b| mul(s, power(2, i)) ^ b))
        .collect()
}

/// Berlekamp–Massey finds error positions; a small Vandermonde system finds their magnitudes.
fn repair(bytes: &mut [u8], parity: usize) -> Result<(), QrError> {
    let s = syndromes(bytes, parity);
    if s.iter().all(|&b| b == 0) {
        return Ok(());
    }
    let mut locator = vec![0; parity + 1];
    locator[0] = 1;
    let mut previous = locator.clone();
    let (mut degree, mut shift, mut last) = (0, 1, 1);
    for n in 0..parity {
        let mut discrepancy = s[n];
        for j in 1..=degree {
            discrepancy ^= mul(locator[j], s[n - j]);
        }
        if discrepancy == 0 {
            shift += 1;
            continue;
        }
        let before = locator.clone();
        let scale = div(discrepancy, last);
        for i in 0..=parity - shift {
            locator[i + shift] ^= mul(scale, previous[i]);
        }
        if 2 * degree <= n {
            degree = n + 1 - degree;
            previous = before;
            last = discrepancy;
            shift = 1;
        } else {
            shift += 1;
        }
    }
    if degree == 0 || degree * 2 > parity {
        return Err(QrError::VerificationFailed);
    }
    let positions: Vec<usize> = (0..bytes.len())
        .filter(|&i| {
            let x = power(2, bytes.len() - 1 - i);
            eval(&locator[..=degree], div(1, x)) == 0
        })
        .collect();
    if positions.len() != degree {
        return Err(QrError::VerificationFailed);
    }
    let mut equations = SecretBytes::zeroed("QR error magnitudes", degree * (degree + 1));
    for row in 0..degree {
        for col in 0..degree {
            equations[row * (degree + 1) + col] =
                power(power(2, bytes.len() - 1 - positions[col]), row);
        }
        equations[row * (degree + 1) + degree] = s[row];
    }
    for col in 0..degree {
        let pivot = (col..degree)
            .find(|&r| equations[r * (degree + 1) + col] != 0)
            .ok_or(QrError::VerificationFailed)?;
        for j in 0..=degree {
            equations.swap(col * (degree + 1) + j, pivot * (degree + 1) + j);
        }
        let factor = equations[col * (degree + 1) + col];
        for j in col..=degree {
            equations[col * (degree + 1) + j] = div(equations[col * (degree + 1) + j], factor);
        }
        for row in 0..degree {
            if row == col {
                continue;
            }
            let factor = equations[row * (degree + 1) + col];
            for j in col..=degree {
                equations[row * (degree + 1) + j] ^= mul(factor, equations[col * (degree + 1) + j]);
            }
        }
    }
    for (i, &at) in positions.iter().enumerate() {
        bytes[at] ^= equations[i * (degree + 1) + degree];
    }
    if syndromes(bytes, parity).iter().any(|&b| b != 0) {
        return Err(QrError::VerificationFailed);
    }
    Ok(())
}

pub(super) fn corrected(raw: &[u8], version: u8) -> Result<SecretBytes, QrError> {
    let (total, count, parity) = layout(version);
    if raw.len() != total {
        return Err(QrError::VerificationFailed);
    }
    let short = total / count;
    let short_count = count - total % count;
    let mut blocks: Vec<SecretBytes> = (0..count)
        .map(|i| SecretBytes::zeroed("QR block", short + usize::from(i >= short_count)))
        .collect();
    let mut at = 0;
    for col in 0..=short - parity {
        for block in &mut blocks {
            if col < block.len() - parity {
                block[col] = raw[at];
                at += 1;
            }
        }
    }
    for col in 0..parity {
        for block in &mut blocks {
            let index = block.len() - parity + col;
            block[index] = raw[at];
            at += 1;
        }
    }
    let mut output = SecretBytes::zeroed("corrected QR data", capacity(version));
    let mut start = 0;
    for block in &mut blocks {
        repair(block, parity)?;
        let length = block.len() - parity;
        output[start..start + length].copy_from_slice(&block[..length]);
        start += length;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qrcodegen::{Mask, QrCode, QrCodeEcc, Version};
    #[test]
    fn every_version_corrects_damaged_codewords_against_the_independent_qrcodegen_encoder() {
        for version in 1..=40 {
            let data: Vec<u8> = (0..capacity(version)).map(|i| (i % 251) as u8).collect();
            let code = QrCode::encode_codewords(
                Version::new(version),
                QrCodeEcc::Medium,
                &data,
                Some(Mask::new(0)),
            );
            let grid = rqrr::SimpleGrid::from_func(code.size() as usize, |x, y| {
                code.get_module(x as i32, y as i32)
            });
            let mut raw = super::super::stream::read(&grid, version, 0);
            assert_eq!(&corrected(&raw, version).unwrap()[..], data);
            let (_, count, parity) = layout(version);
            // Interleaved first columns affect every block equally, up to its exact correction bound.
            for (i, b) in raw.iter_mut().take(count * (parity / 2)).enumerate() {
                *b ^= (i % 255 + 1) as u8;
            }
            assert_eq!(
                &corrected(&raw, version).unwrap_or_else(|e| panic!("version {version}: {e}"))[..],
                data,
                "version {version}"
            );
        }
    }
    #[test]
    fn an_uncorrectable_block_is_refused() {
        let mut raw = vec![0; layout(1).0];
        for (i, b) in raw.iter_mut().take(8).enumerate() {
            *b = (i + 1) as u8;
        }
        assert!(corrected(&raw, 1).is_err());
    }
}

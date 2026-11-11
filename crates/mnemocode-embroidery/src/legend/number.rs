//! The whole number of a few hundred bits that holds a backup while a legend is written or read:
//! 32-bit limbs from the lowest, wiped when dropped.

use std::fmt;

use mnemocode::secret::{SecretBytes, redacted};
use zeroize::Zeroize;

/// A whole number that may hold a backup, so its `Debug` tells nothing (RUST-13).
pub(crate) struct Number {
    limbs: Vec<u32>,
}

impl fmt::Debug for Number {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        redacted(f, "Number")
    }
}

impl Drop for Number {
    fn drop(&mut self) {
        self.limbs.zeroize();
    }
}

impl Number {
    /// The number `value`.
    pub(crate) fn of(value: u32) -> Self {
        Self { limbs: vec![value] }
    }

    /// The number written by `bytes`, the most significant first.
    pub(crate) fn of_be_bytes(bytes: &[u8]) -> Self {
        let mut number = Self::of(0);
        for &byte in bytes {
            number.mul_add(256, u32::from(byte));
        }
        number
    }

    /// Adds `value` times 2 to the power of `shift`.
    pub(crate) fn add_shifted(&mut self, value: &Self, shift: usize) {
        for (i, &limb) in value.limbs.iter().enumerate() {
            self.add_word_shifted(u64::from(limb), shift + 32 * i);
        }
    }

    /// Adds `value` times 2 to the power of `shift`.
    fn add_word_shifted(&mut self, value: u64, shift: usize) {
        let (limb, bit) = (shift / 32, shift % 32);
        let wide = u128::from(value) << bit;
        if self.limbs.len() < limb + 4 {
            self.limbs.resize(limb + 4, 0);
        }
        let mut carry = 0_u64;
        for (i, part) in [
            wide as u32,
            (wide >> 32) as u32,
            (wide >> 64) as u32,
            (wide >> 96) as u32,
        ]
        .into_iter()
        .enumerate()
        {
            let sum = u64::from(self.limbs[limb + i]) + u64::from(part) + carry;
            self.limbs[limb + i] = sum as u32;
            carry = sum >> 32;
        }
        let mut at = limb + 4;
        while carry > 0 {
            if at == self.limbs.len() {
                self.limbs.push(0);
            }
            let sum = u64::from(self.limbs[at]) + carry;
            self.limbs[at] = sum as u32;
            carry = sum >> 32;
            at += 1;
        }
    }

    /// Divides by `divisor`, at least 1, and returns the remainder.
    pub(crate) fn div_small(&mut self, divisor: u32) -> u32 {
        let divisor = u64::from(divisor.max(1));
        let mut remainder = 0_u64;
        for limb in self.limbs.iter_mut().rev() {
            let value = (remainder << 32) | u64::from(*limb);
            *limb = (value / divisor) as u32;
            remainder = value % divisor;
        }
        remainder as u32
    }

    /// Becomes `self * factor + addend`.
    pub(crate) fn mul_add(&mut self, factor: u32, addend: u32) {
        let mut carry = u64::from(addend);
        for limb in &mut self.limbs {
            let value = u64::from(*limb) * u64::from(factor) + carry;
            *limb = value as u32;
            carry = value >> 32;
        }
        if carry > 0 {
            self.limbs.push(carry as u32);
        }
    }

    /// The number below 2 to the power of `bits` (a multiple of 8) left when this one is divided by
    /// it, as `bits / 8` bytes, the most significant first.
    pub(crate) fn low_be_bytes(&self, label: &'static str, bits: usize) -> SecretBytes {
        let length = bits / 8;
        let mut bytes = SecretBytes::zeroed(label, length);
        for (i, byte) in bytes.iter_mut().rev().enumerate() {
            let limb = self.limbs.get(i / 4).copied().unwrap_or(0);
            *byte = (limb >> (8 * (i % 4))) as u8;
        }
        bytes
    }

    /// This number divided by 2 to the power of `shift`, rounded down.
    pub(crate) fn shifted_down(&self, shift: usize) -> Self {
        let (limb, bit) = (shift / 32, shift % 32);
        let mut limbs: Vec<u32> = (limb..self.limbs.len())
            .map(|i| {
                let above = match bit {
                    0 => 0,
                    _ => self.limbs.get(i + 1).copied().unwrap_or(0) << (32 - bit),
                };
                (self.limbs[i] >> bit) | above
            })
            .collect();
        if limbs.is_empty() {
            limbs.push(0);
        }
        Self { limbs }
    }

    /// Whether this number is 0.
    pub(crate) fn is_zero(&self) -> bool {
        self.limbs.iter().all(|&limb| limb == 0)
    }

    /// How many bits it takes: 0 for 0.
    pub(crate) fn bit_length(&self) -> usize {
        self.limbs
            .iter()
            .rposition(|&limb| limb != 0)
            .map_or(0, |i| 32 * (i + 1) - self.limbs[i].leading_zeros() as usize)
    }

    /// What is left of this number when it is divided by `modulus`, which is not 0.
    pub(crate) fn remainder(&self, modulus: &Self) -> Self {
        let mut rest = Self::of(0);
        for at in (0..self.bit_length()).rev() {
            let bit = (self.limbs[at / 32] >> (at % 32)) & 1;
            rest.mul_add(2, bit);
            if !rest.is_below(modulus) {
                rest.subtract(modulus);
            }
        }
        rest
    }

    /// Becomes `self - other`, where `other` is not larger.
    fn subtract(&mut self, other: &Self) {
        let mut borrow = 0_i64;
        for (i, limb) in self.limbs.iter_mut().enumerate() {
            let value =
                i64::from(*limb) - i64::from(other.limbs.get(i).copied().unwrap_or(0)) - borrow;
            borrow = i64::from(value < 0);
            *limb = (value + (borrow << 32)) as u32;
        }
    }

    /// Whether this number is below `other`.
    pub(crate) fn is_below(&self, other: &Self) -> bool {
        let length = self.limbs.len().max(other.limbs.len());
        for i in (0..length).rev() {
            let (mine, theirs) = (
                self.limbs.get(i).copied().unwrap_or(0),
                other.limbs.get(i).copied().unwrap_or(0),
            );
            if mine != theirs {
                return mine < theirs;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_go_in_and_come_back_with_a_shifted_part_above_them() {
        let mut n = Number::of_be_bytes(&[0x12, 0x34, 0x56, 0x78, 0x9a]);
        let above = Number::of_be_bytes(&[0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]);
        n.add_shifted(&above, 40);
        assert_eq!(
            &*n.low_be_bytes("test", 40),
            &[0x12, 0x34, 0x56, 0x78, 0x9a]
        );
        assert_eq!(
            &*n.shifted_down(40).low_be_bytes("test", 72),
            &[0xde, 0xad, 0xbe, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89]
        );
    }

    #[test]
    fn division_and_multiplication_undo_each_other() {
        let mut n = Number::of_be_bytes(&[0xff; 36]);
        let mut remainders = Vec::new();
        for divisor in [70, 100, 69, 10, 68, 1, 67] {
            remainders.push((divisor, n.div_small(divisor)));
        }
        for &(divisor, remainder) in remainders.iter().rev() {
            n.mul_add(divisor, remainder);
        }
        assert_eq!(&*n.low_be_bytes("test", 288), &[0xff; 36]);
        assert!(n.shifted_down(288).is_zero());
    }

    #[test]
    fn a_remainder_is_what_division_leaves() {
        let mut n = Number::of_be_bytes(&[0xff; 40]);
        let modulus = Number::of_be_bytes(&[0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde]);
        let rest = n.remainder(&modulus);
        assert!(rest.is_below(&modulus));
        // 2^320 - 1 = q * m + r: taking r away leaves a multiple of m, whose remainder is 0.
        n.subtract(&rest);
        assert!(n.remainder(&modulus).is_zero());
        assert!(
            Number::of(41)
                .remainder(&Number::of(7))
                .is_below(&Number::of(7))
        );
        assert_eq!(
            &*Number::of(41)
                .remainder(&Number::of(7))
                .low_be_bytes("test", 8),
            &[6]
        );
    }

    #[test]
    fn a_quotient_of_more_than_64_bits_is_kept_whole() {
        let mut n = Number::of(1);
        n.add_shifted(&Number::of(1), 200);
        assert_eq!(n.shifted_down(100).bit_length(), 101);
        assert_eq!(n.shifted_down(200).bit_length(), 1);
        assert!(n.shifted_down(201).is_zero());
        assert!(Number::of(5).is_below(&n.shifted_down(100)));
        assert!(!n.shifted_down(100).is_below(&n.shifted_down(100)));
        assert_eq!(Number::of(0).bit_length(), 0);
    }
}

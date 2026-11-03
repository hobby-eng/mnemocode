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
    pub(crate) fn add_shifted(&mut self, value: u64, shift: usize) {
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

    /// This number divided by 2 to the power of `shift`, rounded down; [`u64::MAX`] where that is
    /// larger.
    pub(crate) fn shifted_down(&self, shift: usize) -> u64 {
        let (limb, bit) = (shift / 32, shift % 32);
        let mut value = 0_u128;
        for (i, &part) in self.limbs.iter().enumerate().skip(limb) {
            let place = 32 * (i - limb);
            if place >= 128 {
                if part != 0 {
                    return u64::MAX;
                }
                continue;
            }
            value |= u128::from(part) << place;
        }
        u64::try_from(value >> bit).unwrap_or(u64::MAX)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bytes_go_in_and_come_back_with_a_shifted_part_above_them() {
        let mut n = Number::of_be_bytes(&[0x12, 0x34, 0x56, 0x78, 0x9a]);
        n.add_shifted(0xdead_beef, 40);
        assert_eq!(
            &*n.low_be_bytes("test", 40),
            &[0x12, 0x34, 0x56, 0x78, 0x9a]
        );
        assert_eq!(n.shifted_down(40), 0xdead_beef);
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
        assert_eq!(n.shifted_down(288), 0);
    }

    #[test]
    fn a_quotient_too_large_for_64_bits_saturates() {
        let mut n = Number::of(1);
        n.add_shifted(1, 200);
        assert_eq!(n.shifted_down(100), u64::MAX);
        assert_eq!(n.shifted_down(200), 1);
    }
}

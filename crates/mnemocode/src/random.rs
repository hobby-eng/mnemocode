//! The library's one port to its host (ADR 0006, CORE-46): cryptographically secure randomness,
//! which the host passes in. Its implementations are the browser's `crypto.getRandomValues` in the
//! WebAssembly file (the binding's host module) and, from increment 2 on, the operating system's
//! generator in the executable (getrandom: getrandom(2) on Linux, getentropy on macOS, ProcessPrng
//! on Windows); no other generator exists in MnemoCode. The SSKR engine's ChaCha20 is seeded with
//! 32 bytes from this port, as TS seeds it.
//!
//! The library never reads a source itself: the `code-rules` gate keeps getrandom and rand out of
//! its dependencies, and clippy refuses bc-rand's and rand's own sources and their generators that
//! are not cryptographically secure (clippy.toml). A test passes the choices TS made through a fixed
//! source of its own, which exists only in tests (CORE-32).

use std::fmt;

use crate::refusal::Refusal;

/// The host's randomness could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RandomError {
    /// The system's or the browser's random source failed.
    Unavailable,
    /// A uniform choice was asked below 0, which has no whole number to choose.
    EmptyRange,
}

impl fmt::Display for RandomError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Unavailable => "The system's random number source is not available.",
            Self::EmptyRange => "A random choice needs at least one number to choose from.",
        })
    }
}

impl std::error::Error for RandomError {}

impl Refusal for RandomError {
    fn code(&self) -> &'static str {
        match self {
            Self::Unavailable => "core.random.unavailable",
            Self::EmptyRange => "core.random.empty-range",
        }
    }
}

/// Cryptographically secure randomness: the operating system's (getrandom) in the executable,
/// the browser's (crypto.getRandomValues) in the WebAssembly file. An implementation must be a
/// cryptographically secure generator; [`Random::below`] only maps its bytes to a number.
pub trait Random {
    /// Fills `bytes` with random bytes.
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError>;

    /// A uniform choice of a whole number below `upper`: without bias, by drawing again a value that
    /// falls in the incomplete last range, as node:crypto's randomInt does, though not from the
    /// same bytes (Node draws 48-bit values). A source that replays TS's choices overrides this.
    fn below(&mut self, upper: u32) -> Result<u32, RandomError> {
        if upper == 0 {
            return Err(RandomError::EmptyRange);
        }
        // The largest multiple of `upper` that a u32 holds, counted from 0: values from it on would
        // favour the small results, so they are drawn again.
        let limit = u32::MAX - (u32::MAX % upper + 1) % upper;
        loop {
            let mut bytes = [0; 4];
            self.fill(&mut bytes)?;
            let value = u32::from_le_bytes(bytes);
            if value <= limit {
                return Ok(value % upper);
            }
        }
    }
}

/// A source that gives no randomness: for what draws none, such as a candidate list written in the
/// open, which the self-test writes; any draw from it is refused.
#[derive(Clone, Copy, Debug)]
pub(crate) struct NoRandomness;

impl Random for NoRandomness {
    fn fill(&mut self, _bytes: &mut [u8]) -> Result<(), RandomError> {
        Err(RandomError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A source that gives the bytes it was made with, in turn, for the tests.
    struct FixedRandom(std::vec::IntoIter<u8>);

    impl Random for FixedRandom {
        fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
            for byte in bytes {
                *byte = self.0.next().ok_or(RandomError::Unavailable)?;
            }
            Ok(())
        }
    }

    #[test]
    fn a_uniform_choice_stays_below_its_bound() {
        let mut random = FixedRandom(vec![7, 0, 0, 0, 9, 0, 0, 0].into_iter());
        assert_eq!(random.below(5), Ok(2));
        assert_eq!(random.below(1), Ok(0));
    }

    #[test]
    fn a_value_in_the_incomplete_last_range_is_drawn_again() {
        // u32::MAX itself lies past the last whole multiple of 3 * 1431655765.
        let mut random = FixedRandom(vec![0xff, 0xff, 0xff, 0xff, 4, 0, 0, 0].into_iter());
        assert_eq!(random.below(3), Ok(1));
    }

    #[test]
    fn a_choice_below_zero_and_a_failed_source_are_refused() {
        let mut random = FixedRandom(Vec::new().into_iter());
        assert_eq!(random.below(0), Err(RandomError::EmptyRange));
        assert_eq!(random.below(2), Err(RandomError::Unavailable));
        assert_eq!(RandomError::Unavailable.code(), "core.random.unavailable");
    }
}

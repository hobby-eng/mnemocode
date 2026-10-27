//! The operating system's cryptographically secure generator, the executable's side of the
//! library's one port (`mnemocode::random`, CORE-46): getrandom(2) on Linux, getentropy on macOS,
//! ProcessPrng on Windows, through the getrandom crate. No other source exists in the executable.

use mnemocode::random::{Random, RandomError};

/// The system's random source.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct SystemRandom;

impl Random for SystemRandom {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        getrandom::fill(bytes).map_err(|_| RandomError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_system_fills_and_chooses() {
        let mut random = SystemRandom;
        let mut bytes = [0_u8; 32];
        assert_eq!(random.fill(&mut bytes), Ok(()));
        // 2^-256 of a chance that 32 random bytes are all zero.
        assert!(bytes.iter().any(|&byte| byte != 0));
        assert!(random.below(7).is_ok_and(|value| value < 7));
    }
}

//! Stands in for bc-crypto 0.14.0 through the workspace's `[patch.crates-io]`, with only what the
//! vendored bc-shamir 0.13.0 uses (`src/shamir.rs:1`, `interpolate.rs:1`, `hazmat.rs:1`,
//! `recovery_secret.rs:52`), so the vendored files stay unchanged and no C code is built.

#![forbid(unsafe_code)]

use zeroize::{DefaultIsZeroes, Zeroize};

/// Message authentication.
pub mod hash {
    use hmac::{Hmac, KeyInit, Mac};
    use sha2::Sha256;

    /// HMAC-SHA-256 of `message` under `key` (bc-crypto 0.14.0 `src/hash.rs:61-69`).
    pub fn hmac_sha256(key: impl AsRef<[u8]>, message: impl AsRef<[u8]>) -> [u8; 32] {
        #[expect(clippy::expect_used, reason = "HMAC accepts keys of any length")]
        let mut mac =
            Hmac::<Sha256>::new_from_slice(key.as_ref()).expect("HMAC accepts keys of any length");
        mac.update(message.as_ref());
        mac.finalize().into_bytes().into()
    }
}

/// Zeroes every element of `s` (bc-crypto 0.14.0 `src/memzero.rs:2`).
pub fn memzero<T: DefaultIsZeroes>(s: &mut [T]) {
    s.zeroize();
}

/// Zeroes the bytes of every vector in `s`; their lengths stay (bc-crypto 0.14.0 `src/memzero.rs:9`).
pub fn memzero_vec_vec_u8(s: &mut [Vec<u8>]) {
    for bytes in s {
        bytes.as_mut_slice().zeroize();
    }
}

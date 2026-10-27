//! BIP32's extended private keys (CAP-WALLET-MASTER-FINGERPRINT; mhfe's `ExtendedKey`):
//! HMAC-SHA512 of the seed under the key "Bitcoin seed" gives the master private key and chain
//! code, and CKDpriv each child; the fingerprint is the first four bytes of HASH160 (RIPEMD-160 of
//! SHA-256) of the compressed public key. The keys live in locked buffers that are wiped when they
//! are dropped; the scalars k256 computes with zeroize themselves. The wallet's paths come with the
//! wallet module.

use std::fmt;

use hmac::{Hmac, KeyInit, Mac};
use k256::elliptic_curve::PrimeField;
use k256::elliptic_curve::sec1::ToSec1Point;
use k256::{FieldBytes, ProjectivePoint, Scalar};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256, Sha512};
use zeroize::{Zeroize, Zeroizing};

use crate::bip39::phrase::{Phrase, PhraseError};
use crate::refusal::Refusal;
use crate::secret::SecretBytes;

/// BIP32: indexes from 2^31 up are hardened.
pub const HARDENED_OFFSET: u32 = 1 << 31;
/// BIP32: the highest index that is not hardened.
pub const LAST_NORMAL_INDEX: u32 = HARDENED_OFFSET - 1;
/// The key of the master key's HMAC.
const MASTER_HMAC_KEY: &[u8] = b"Bitcoin seed";

/// The refusals of BIP32.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Bip32Error {
    /// The seed gives no valid master key, which BIP32 says to skip (a chance of 2^-127).
    InvalidMasterKey,
    /// No valid key at this index of the path, where wallets use the next (a chance of 2^-127).
    InvalidChild(u32),
    /// The phrase could not be read.
    Phrase(PhraseError),
}

impl fmt::Display for Bip32Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidMasterKey => f.write_str("The seed gives no valid BIP32 master key."),
            Self::InvalidChild(index) => write!(
                f,
                "BIP32 has no valid key at index {index} of this path; wallets use the next index."
            ),
            Self::Phrase(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for Bip32Error {}

impl Refusal for Bip32Error {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidMasterKey => "core.bip32.invalid-master-key",
            Self::InvalidChild(_) => "core.bip32.invalid-child-key",
            Self::Phrase(error) => error.code(),
        }
    }
}

/// An extended private key: its private key and its chain code, in locked buffers.
pub struct ExtendedKey {
    private: SecretBytes,
    chain_code: SecretBytes,
    /// Where it stands: its depth, its parent's fingerprint and its index.
    place: Place,
}

/// Where an extended key stands in its tree: depth 0, no parent and index 0 for the master key.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Place {
    /// The depth.
    pub depth: u8,
    /// The first four bytes of HASH160 of the parent's public key.
    pub parent: [u8; 4],
    /// The index below the parent.
    pub index: u32,
}

/// An extended public key: where it stands, its chain code and its compressed key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExtendedPublicKey {
    /// Where it stands.
    pub place: Place,
    /// The chain code.
    pub chain_code: [u8; 32],
    /// The compressed public key.
    pub key: [u8; 33],
}

impl ExtendedKey {
    /// `HMAC-SHA512(key, parts)` split into a private key and a chain code; the private key is
    /// the caller's to check.
    fn of_hmac(key: &[u8], parts: &[&[u8]]) -> Result<Self, Bip32Error> {
        let mut mac = <Hmac<Sha512> as KeyInit>::new_from_slice(key)
            .map_err(|_| Bip32Error::InvalidMasterKey)?;
        for part in parts {
            mac.update(part);
        }
        let mut output = mac.finalize().into_bytes();
        let (left, right) = output.split_at(32);
        let key = Self {
            private: SecretBytes::copy_of("a private key", left),
            chain_code: SecretBytes::copy_of("a chain code", right),
            place: Place::default(),
        };
        output.zeroize();
        Ok(key)
    }

    /// The master key of `seed`.
    pub fn of_seed(seed: &[u8]) -> Result<Self, Bip32Error> {
        let master = Self::of_hmac(MASTER_HMAC_KEY, &[seed])?;
        if master
            .scalar()
            .is_none_or(|scalar| bool::from(scalar.is_zero()))
        {
            return Err(Bip32Error::InvalidMasterKey);
        }
        Ok(master)
    }

    /// The private key as a scalar, wiped when dropped; none where it is not below the order.
    fn scalar(&self) -> Option<Zeroizing<Scalar>> {
        let mut bytes = [0; 32];
        bytes.copy_from_slice(&self.private);
        let mut repr = FieldBytes::from(bytes);
        bytes.zeroize();
        let scalar = Option::<Scalar>::from(Scalar::from_repr(repr)).map(Zeroizing::new);
        repr.zeroize();
        scalar
    }

    /// The child key at `index`, CKDpriv of BIP32: hardened from 2^31 up. An index without a valid
    /// key is refused rather than skipped, so that the key is never another than the path says.
    pub fn child(&self, index: u32) -> Result<Self, Bip32Error> {
        let index_bytes = index.to_be_bytes();
        let child = if index >= HARDENED_OFFSET {
            Self::of_hmac(&self.chain_code, &[&[0], &self.private, &index_bytes])?
        } else {
            Self::of_hmac(&self.chain_code, &[&self.public_key()?, &index_bytes])?
        };
        let invalid = || Bip32Error::InvalidChild(index);
        let tweak = child.scalar().ok_or_else(invalid)?;
        let sum = Zeroizing::new(*tweak + *self.scalar().ok_or_else(invalid)?);
        if bool::from(sum.is_zero()) {
            return Err(invalid());
        }
        let repr = Zeroizing::new(sum.to_repr());
        Ok(Self {
            private: SecretBytes::copy_of("a private key", &repr[..]),
            chain_code: child.chain_code,
            place: Place {
                depth: self.place.depth.saturating_add(1),
                parent: self.fingerprint()?,
                index,
            },
        })
    }

    /// The key at `path` below this one, each index as [`ExtendedKey::child`] takes it.
    pub fn derive(&self, path: &[u32]) -> Result<Self, Bip32Error> {
        let mut key = Self {
            private: SecretBytes::copy_of("a private key", &self.private),
            chain_code: SecretBytes::copy_of("a chain code", &self.chain_code),
            place: self.place,
        };
        for &index in path {
            key = key.child(index)?;
        }
        Ok(key)
    }

    /// The public point of the private key.
    fn public_point(&self) -> Result<ProjectivePoint, Bip32Error> {
        let scalar = self.scalar().ok_or(Bip32Error::InvalidMasterKey)?;
        Ok(ProjectivePoint::GENERATOR * *scalar)
    }

    /// The master key of `phrase` with `passphrase`.
    pub fn of_phrase(phrase: &Phrase, passphrase: &str) -> Result<Self, Bip32Error> {
        let seed = crate::bip39::seed::seed(phrase, passphrase).map_err(Bip32Error::Phrase)?;
        Self::of_seed(&seed)
    }

    /// The private key's 32 bytes.
    pub fn private_key(&self) -> &[u8] {
        &self.private
    }

    /// Where it stands.
    pub const fn place(&self) -> Place {
        self.place
    }

    /// Its public half.
    pub fn public(&self) -> Result<ExtendedPublicKey, Bip32Error> {
        let mut chain_code = [0; 32];
        chain_code.copy_from_slice(&self.chain_code);
        Ok(ExtendedPublicKey {
            place: self.place,
            chain_code,
            key: self.public_key()?,
        })
    }

    /// The chain code's 32 bytes.
    pub fn chain_code(&self) -> &[u8] {
        &self.chain_code
    }

    /// The compressed public key, 33 bytes.
    pub fn public_key(&self) -> Result<[u8; 33], Bip32Error> {
        let point = self.public_point()?.to_affine().to_sec1_point(true);
        point
            .as_bytes()
            .try_into()
            .map_err(|_| Bip32Error::InvalidMasterKey)
    }

    /// The uncompressed public key, 65 bytes: 0x04 and both coordinates.
    pub fn uncompressed_public_key(&self) -> Result<[u8; 65], Bip32Error> {
        let point = self.public_point()?.to_affine().to_sec1_point(false);
        point
            .as_bytes()
            .try_into()
            .map_err(|_| Bip32Error::InvalidMasterKey)
    }

    /// The fingerprint: the first four bytes of HASH160 of the compressed public key.
    pub fn fingerprint(&self) -> Result<[u8; 4], Bip32Error> {
        let hash = Ripemd160::digest(Sha256::digest(self.public_key()?));
        let mut fingerprint = [0; 4];
        fingerprint.copy_from_slice(&hash[..4]);
        Ok(fingerprint)
    }
}

impl fmt::Debug for ExtendedKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        crate::secret::redacted(f, "an extended key")
    }
}

/// The bytes of a serialized extended key (BIP32).
const SERIALIZED_BYTES: usize = 78;

impl ExtendedPublicKey {
    /// The key serialized with `version` (such as 0x0488b21e for xpub), in Base58Check.
    pub fn encode(&self, version: u32) -> String {
        let mut bytes = Vec::with_capacity(SERIALIZED_BYTES + 4);
        bytes.extend_from_slice(&version.to_be_bytes());
        bytes.push(self.place.depth);
        bytes.extend_from_slice(&self.place.parent);
        bytes.extend_from_slice(&self.place.index.to_be_bytes());
        bytes.extend_from_slice(&self.chain_code);
        bytes.extend_from_slice(&self.key);
        let checksum = Sha256::digest(Sha256::digest(&bytes));
        bytes.extend_from_slice(&checksum[..4]);
        bs58::encode(bytes).into_string()
    }

    /// The key `text` serializes under `version`; none where it does not read, holds another
    /// version, no point of the curve, or a master key's place with a parent or an index.
    pub fn decode(text: &str, version: u32) -> Option<Self> {
        let bytes = bs58::decode(text).into_vec().ok()?;
        if bytes.len() != SERIALIZED_BYTES + 4 {
            return None;
        }
        let (data, checksum) = bytes.split_at(SERIALIZED_BYTES);
        if Sha256::digest(Sha256::digest(data))[..4] != *checksum
            || data[..4] != version.to_be_bytes()
        {
            return None;
        }
        let mut parent = [0; 4];
        parent.copy_from_slice(&data[5..9]);
        let index = u32::from_be_bytes(data[9..13].try_into().ok()?);
        let place = Place {
            depth: data[4],
            parent,
            index,
        };
        if place.depth == 0 && (parent != [0; 4] || index != 0) {
            return None;
        }
        let chain_code: [u8; 32] = data[13..45].try_into().ok()?;
        let key: [u8; 33] = data[45..78].try_into().ok()?;
        k256::PublicKey::from_sec1_bytes(&key).ok()?;
        Some(Self {
            place,
            chain_code,
            key,
        })
    }
}

/// A fingerprint as MnemoCode writes it: eight lower-case hexadecimal digits.
pub fn fingerprint_hex(fingerprint: [u8; 4]) -> String {
    fingerprint
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_master_key_follows_bip32s_first_vector() {
        // BIP32 test vector 1: seed 000102…0f, master fingerprint 3442193e.
        let seed: Vec<u8> = (0..16).collect();
        let master = ExtendedKey::of_seed(&seed).unwrap();
        assert_eq!(fingerprint_hex(master.fingerprint().unwrap()), "3442193e");
        assert_eq!(format!("{master:?}"), "[an extended key: redacted]");
        // Its chain m/0'/1/2'/2/1000000000: the published private key of the last.
        let path = [HARDENED_OFFSET, 1, HARDENED_OFFSET + 2, 2, 1_000_000_000];
        let last = master.derive(&path).unwrap();
        let hex: String = last
            .private_key()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(
            hex,
            "471b76e389e528d6de6d816857e012c5455051cad6660850e58372a6c3e6e7c8"
        );
        let xpub = "xpub6H1LXWLaKsWFhvm6RVpEL9P4KfRZSW7abD2ttkWP3SSQvnyA8FSVqNTEcYFgJS2UaFcxupHiYkro49S8yGasTvXEYBVPamhGW6cFJodrTHy";
        let public = last.public().unwrap();
        assert_eq!(public.encode(0x0488_b21e), xpub);
        assert_eq!(ExtendedPublicKey::decode(xpub, 0x0488_b21e), Some(public));
        assert_eq!(ExtendedPublicKey::decode(xpub, 0x0435_87cf), None);
    }

    #[test]
    fn the_public_phrase_has_its_known_fingerprint() {
        let phrase = Phrase::parse("abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about").unwrap();
        let master = ExtendedKey::of_phrase(&phrase, "").unwrap();
        assert_eq!(fingerprint_hex(master.fingerprint().unwrap()), "73c5da0a");
    }
}

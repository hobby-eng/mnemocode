//! The SSKR engine (MnemoCode TS 0.1.0's engine, `sskr-wasm/rust/src/lib.rs`, CAP-SSKR-ENGINE-SPLIT,
//! -COMBINE, -MEMORY-WIPE and -HOST-PLATFORM, redesigned): Blockchain Commons' SSKR, vendored
//! unchanged, splits a secret into Shamir shares and restores it. A split's generator is ChaCha20
//! seeded with 32 bytes of the host's randomness (the Random port, CORE-46), as the TS engine seeds
//! it; every share and secret lies in a locked owner, and the stack the library worked on is
//! scrubbed once it returns. No WebAssembly loader stands between: the library calls it directly.

use std::fmt;

use bc_rand::RandomNumberGenerator;
use rand_chacha::ChaCha20Rng;
use rand_core::{CryptoRng, RngCore, SeedableRng};
use sskr::{GroupSpec, Secret, Spec, sskr_combine, sskr_generate_using};
use zeroize::Zeroize;

use crate::random::{Random, RandomError};
use crate::refusal::Refusal;
use crate::secret::{SecretBytes, scrub_stack};

/// The bytes of a split's seed: as many as ChaCha20 takes.
pub const SEED_BYTES: usize = 32;

/// The refusals of the engine, word for word as TS 0.1.0's engine writes them; the library's own
/// refusals carry its message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EngineError {
    /// The library refused a group: its message.
    Group(String),
    /// The library refused the groups' quorum: its message.
    Specification(String),
    /// A secret of a length SSKR does not take: the library's message.
    Secret(String),
    /// The library could not split: its message.
    Generate(String),
    /// The library could not restore the secret: its message.
    Combine(String),
    /// No share was given.
    NoShares,
    /// The host's randomness failed.
    Random(RandomError),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Group(text)
            | Self::Specification(text)
            | Self::Secret(text)
            | Self::Generate(text)
            | Self::Combine(text) => f.write_str(text),
            Self::NoShares => f.write_str("Enter at least one SSKR share."),
            Self::Random(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for EngineError {}

impl Refusal for EngineError {
    fn code(&self) -> &'static str {
        match self {
            Self::Group(_) => "sskr.engine.group",
            Self::Specification(_) => "sskr.engine.specification",
            Self::Secret(_) => "sskr.engine.secret",
            Self::Generate(_) => "sskr.engine.generate",
            Self::Combine(_) => "sskr.engine.combine",
            Self::NoShares => "sskr.engine.no-shares",
            Self::Random(error) => error.code(),
        }
    }
}

/// A group of shares: how many of its members restore it, of how many.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Group {
    /// The members that restore the group.
    pub threshold: usize,
    /// The members it has.
    pub count: usize,
}

/// The generator of a split, seeded with the host's fresh randomness and reset when dropped.
struct SeededGenerator(ChaCha20Rng);

impl RngCore for SeededGenerator {
    fn next_u32(&mut self) -> u32 {
        self.0.next_u32()
    }

    fn next_u64(&mut self) -> u64 {
        self.0.next_u64()
    }

    fn fill_bytes(&mut self, destination: &mut [u8]) {
        self.0.fill_bytes(destination);
    }
}

impl CryptoRng for SeededGenerator {}
impl RandomNumberGenerator for SeededGenerator {}

impl Drop for SeededGenerator {
    fn drop(&mut self) {
        self.0 = ChaCha20Rng::from_seed([0; SEED_BYTES]);
        std::hint::black_box(&mut self.0);
    }
}

/// The shares of `secret`, group after group, each in a locked buffer: `groups`, of which
/// `group_threshold` restore it, made by a generator seeded from the host's `random`. Refused as
/// the library refuses the groups, their quorum and the secret.
pub fn split(
    secret: &[u8],
    group_threshold: usize,
    groups: &[Group],
    random: &mut dyn Random,
) -> Result<Vec<SecretBytes>, EngineError> {
    let mut seed = SecretBytes::zeroed("a split's seed", SEED_BYTES);
    random.fill(&mut seed).map_err(EngineError::Random)?;
    split_seeded(secret, group_threshold, groups, &seed)
}

/// [`split`] with the generator seeded from `seed`, 32 bytes: the host's randomness, or a public
/// test seed of the known answers.
pub(crate) fn split_seeded(
    secret: &[u8],
    group_threshold: usize,
    groups: &[Group],
    seed: &[u8],
) -> Result<Vec<SecretBytes>, EngineError> {
    let shares = split_unscrubbed(secret, group_threshold, groups, seed);
    scrub_stack();
    shares
}

/// The split itself, never inlined, so that the stack it leaves lies below its caller's scrub.
#[inline(never)]
fn split_unscrubbed(
    secret: &[u8],
    group_threshold: usize,
    groups: &[Group],
    seed: &[u8],
) -> Result<Vec<SecretBytes>, EngineError> {
    let specs = groups
        .iter()
        .map(|group| {
            GroupSpec::new(group.threshold, group.count)
                .map_err(|error| EngineError::Group(error.to_string()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let spec = Spec::new(group_threshold, specs)
        .map_err(|error| EngineError::Specification(error.to_string()))?;
    let mut array = [0; SEED_BYTES];
    // A seed of another length is the program's own error: the generator takes its first bytes.
    let taken = seed.len().min(SEED_BYTES);
    array[..taken].copy_from_slice(&seed[..taken]);
    let mut generator = SeededGenerator(ChaCha20Rng::from_seed(array));
    array.zeroize();
    let owned = Secret::new(secret).map_err(|error| EngineError::Secret(error.to_string()))?;
    let mut groups_shares = sskr_generate_using(&spec, &owned, &mut generator)
        .map_err(|error| EngineError::Generate(error.to_string()))?;
    let shares = groups_shares
        .iter()
        .flatten()
        .map(|share| SecretBytes::copy_of("a share", share))
        .collect();
    groups_shares
        .iter_mut()
        .flatten()
        .for_each(Zeroize::zeroize);
    Ok(shares)
}

/// The secret that `shares` restore, in a locked buffer; refused for no share, and as the library
/// refuses the shares.
pub fn combine(shares: &[&[u8]]) -> Result<SecretBytes, EngineError> {
    let secret = combine_unscrubbed(shares);
    scrub_stack();
    secret
}

#[inline(never)]
fn combine_unscrubbed(shares: &[&[u8]]) -> Result<SecretBytes, EngineError> {
    if shares.is_empty() {
        return Err(EngineError::NoShares);
    }
    let secret = sskr_combine(shares).map_err(|error| EngineError::Combine(error.to_string()))?;
    Ok(SecretBytes::copy_of("an SSKR secret", secret.data()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::NoRandomness;
    use crate::sskr::share::Share;
    use crate::sskr::text::compact_ur;
    use crate::text::hex::{bytes_of_hex, hex_of_bytes};
    use serde_json::Value;

    const VECTORS: &str = include_str!("../../../../vectors/sskr-v1.json");

    fn groups(vector: &Value) -> Vec<Group> {
        vector["groups"]
            .as_array()
            .unwrap()
            .iter()
            .map(|group| Group {
                threshold: group["threshold"].as_u64().unwrap() as usize,
                count: group["count"].as_u64().unwrap() as usize,
            })
            .collect()
    }

    #[test]
    fn every_recorded_split_is_made_again_from_its_test_seed() {
        let vectors: Value = serde_json::from_str(VECTORS).unwrap();
        for vector in vectors["deterministic"].as_array().unwrap() {
            let name = vector["name"].as_str().unwrap();
            let entropy = bytes_of_hex(vector["entropy"].as_str().unwrap()).unwrap();
            let seed = bytes_of_hex(vector["testOnlySeed"].as_str().unwrap()).unwrap();
            let threshold = vector["groupThreshold"].as_u64().unwrap() as usize;
            let shares = split_seeded(&entropy, threshold, &groups(vector), &seed).unwrap();
            let written: Vec<String> = shares
                .iter()
                .map(|share| compact_ur(share).as_str().to_owned())
                .collect();
            let recorded: Vec<&str> = vector["shares"]
                .as_array()
                .unwrap()
                .iter()
                .map(|share| share.as_str().unwrap())
                .collect();
            assert_eq!(written, recorded, "{name}");
            let read: Vec<SecretBytes> = recorded
                .iter()
                .map(|share| {
                    SecretBytes::copy_of("a share", Share::read_ur(share).unwrap().payload())
                })
                .collect();
            let restored = combine(&read.iter().map(|share| &share[..]).collect::<Vec<_>>());
            assert_eq!(
                hex_of_bytes(&restored.unwrap()),
                hex_of_bytes(&entropy),
                "{name}"
            );
        }
    }

    #[test]
    fn the_published_shares_restore_their_secret_in_every_quorum() {
        let vectors: Value = serde_json::from_str(VECTORS).unwrap();
        let official = &vectors["official"];
        let shares: Vec<SecretBytes> = official["shares"]
            .as_array()
            .unwrap()
            .iter()
            .map(|share| {
                let share = Share::read_ur(share.as_str().unwrap()).unwrap();
                SecretBytes::copy_of("a share", share.payload())
            })
            .collect();
        let entropy = official["entropy"].as_str().unwrap();
        let chosen = |quorum: &Value| -> Vec<&[u8]> {
            quorum
                .as_array()
                .unwrap()
                .iter()
                .map(|place| &shares[place.as_u64().unwrap() as usize][..])
                .collect()
        };
        for quorum in official["validQuorums"].as_array().unwrap() {
            assert_eq!(hex_of_bytes(&combine(&chosen(quorum)).unwrap()), entropy);
        }
        for quorum in official["invalidQuorums"].as_array().unwrap() {
            assert!(combine(&chosen(quorum)).is_err(), "{quorum}");
        }
        // The transport of the first share: the CBOR head of 21 bytes, the share, its CRC-32.
        let transport = official["firstShareTransportHex"].as_str().unwrap();
        assert_eq!(format!("55{}", hex_of_bytes(&shares[0])), transport[..44]);
    }

    #[test]
    fn a_failed_source_no_share_and_a_bad_quorum_are_refused() {
        let groups = [Group {
            threshold: 2,
            count: 3,
        }];
        let refusal = split(&[0; 16], 1, &groups, &mut NoRandomness).unwrap_err();
        assert_eq!(refusal, EngineError::Random(RandomError::Unavailable));
        assert_eq!(combine(&[]).unwrap_err().code(), "sskr.engine.no-shares");
        let refusal = split_seeded(
            &[0; 16],
            1,
            &[Group {
                threshold: 3,
                count: 2,
            }],
            &[1; 32],
        );
        assert_eq!(refusal.unwrap_err().code(), "sskr.engine.group");
        let refusal = split_seeded(&[0; 15], 1, &groups, &[1; 32]);
        assert_eq!(refusal.unwrap_err().code(), "sskr.engine.secret");
    }
}

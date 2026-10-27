//! The encodings and key commitments the coins share (MnemoCode TS 0.1.0's `core/coins/`
//! address-types, base58-check, bech32, other-forms, taproot, keccak-account, ethereum's EIP-55
//! and bitcoin-cash's CashAddr): Base58Check over the bs58 crate, Bech32 and Bech32m over the
//! bech32 crate, HASH160, the nested SegWit and Taproot commitments, Keccak accounts, EIP-55 and the
//! CashAddr checksum, which no crate the workspace takes holds.

use bech32::primitives::decode::CheckedHrpstring;
use bech32::{Bech32, Bech32m};
use k256::elliptic_curve::PrimeField;
use k256::elliptic_curve::point::AffineCoordinates;
use k256::elliptic_curve::sec1::ToSec1Point;
use k256::{ProjectivePoint, PublicKey, Scalar};
use ripemd::Ripemd160;
use sha2::{Digest, Sha256};
use sha3::Keccak256;

/// The bytes of a HASH160 and of an account of 20 bytes.
pub const HASH160_BYTES: usize = 20;
/// The groups of five bits of the BIP173 alphabet, in their order.
pub const BECH32_ALPHABET: &str = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
/// The bytes of a Base58Check checksum.
const CHECKSUM_BYTES: usize = 4;
/// The longest Bech32 string and prefix the readers take.
const MAX_PREFIX_LENGTH: usize = 83;
/// The tag of BIP341's tweak.
const TAP_TWEAK_TAG: &[u8] = b"TapTweak";
/// The groups of a CashAddr checksum.
pub const CASHADDR_CHECKSUM_GROUPS: usize = 8;

/// RIPEMD-160 of SHA-256.
pub fn hash160(bytes: &[u8]) -> [u8; HASH160_BYTES] {
    Ripemd160::digest(Sha256::digest(bytes)).into()
}

/// The two Base58 alphabets of the coins.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Alphabet {
    /// Bitcoin's.
    Bitcoin,
    /// XRP's.
    Ripple,
}

/// The data of Base58Check `text` in `alphabet`, its checksum taken off; none where it does not read
/// or its checksum is wrong.
pub fn checked_data(text: &str, alphabet: Alphabet) -> Option<Vec<u8>> {
    let alphabet = match alphabet {
        Alphabet::Bitcoin => bs58::Alphabet::BITCOIN,
        Alphabet::Ripple => bs58::Alphabet::RIPPLE,
    };
    let bytes = bs58::decode(text).with_alphabet(alphabet).into_vec().ok()?;
    let split = bytes.len().checked_sub(CHECKSUM_BYTES)?;
    let (data, checksum) = bytes.split_at(split);
    (Sha256::digest(Sha256::digest(data))[..CHECKSUM_BYTES] == *checksum).then(|| data.to_vec())
}

/// A Bech32 or Bech32m string read: its prefix in lower case and its groups of five bits.
pub struct Bech32Read {
    /// The human-readable prefix.
    pub prefix: String,
    /// The data's groups, the checksum taken off.
    pub groups: Vec<u8>,
}

/// `text` read as Bech32 (or Bech32m with `modified`); none where it does not read, mixes cases or
/// has a prefix longer than 83 characters.
pub fn decode_bech32(text: &str, modified: bool) -> Option<Bech32Read> {
    let checked = if modified {
        CheckedHrpstring::new::<Bech32m>(text).ok()?
    } else {
        CheckedHrpstring::new::<Bech32>(text).ok()?
    };
    let prefix = checked.hrp().to_lowercase();
    if prefix.len() > MAX_PREFIX_LENGTH {
        return None;
    }
    let groups = checked.fe32_iter().map(|group| group.to_u8()).collect();
    Some(Bech32Read { prefix, groups })
}

/// `groups` of five bits as whole bytes, and the padding left over: its bits, the last of the
/// accumulator, and how many there are.
pub fn whole_bytes_of_groups(groups: &[u8]) -> (Vec<u8>, u32, u32) {
    let mut bytes = Vec::with_capacity(groups.len() * 5 / 8);
    let (mut accumulator, mut bits) = (0_u32, 0_u32);
    for &group in groups {
        accumulator = ((accumulator << 5) | u32::from(group)) & 0xfff;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((accumulator >> bits) & 0xff).to_le_bytes()[0]);
        }
    }
    (bytes, accumulator, bits)
}

/// `groups` of five bits as bytes, refused where the padding left over is not zero bits shorter
/// than a group (BIP173's rule, @scure/base's `fromWords`).
pub fn bytes_of_groups(groups: &[u8]) -> Option<Vec<u8>> {
    let (bytes, accumulator, bits) = whole_bytes_of_groups(groups);
    (bits < 5 && accumulator & ((1 << bits) - 1) == 0).then_some(bytes)
}

/// A SegWit address read (BIP173, BIP350): its prefix, its witness version and its program.
pub fn decode_segwit(text: &str) -> Option<(String, u8, Vec<u8>)> {
    let (prefix, version, program) = bech32::segwit::decode(text).ok()?;
    Some((prefix.to_lowercase(), version.to_u8(), program))
}

/// The nested SegWit commitment of a compressed key: HASH160 of its P2WPKH script.
pub fn nested_segwit_hash(public_key: &[u8]) -> Vec<u8> {
    let mut script = vec![0x00, 0x14];
    script.extend_from_slice(&hash160(public_key));
    hash160(&script).to_vec()
}

/// BIP341's Taproot output key of a key without scripts, x-only; none where the tweak gives none.
pub fn taproot_output_key(public_key: &[u8]) -> Option<Vec<u8>> {
    let point = PublicKey::from_sec1_bytes(public_key).ok()?.to_projective();
    let affine = point.to_affine();
    let internal = if bool::from(affine.y_is_odd()) {
        -point
    } else {
        point
    };
    let x_only = internal.to_affine().x();
    let tag = Sha256::digest(TAP_TWEAK_TAG);
    let tweak: [u8; 32] = Sha256::new()
        .chain_update(tag)
        .chain_update(tag)
        .chain_update(x_only)
        .finalize()
        .into();
    let scalar = Option::<Scalar>::from(Scalar::from_repr(tweak.into()))?;
    let output = internal + ProjectivePoint::GENERATOR * scalar;
    if output == ProjectivePoint::IDENTITY {
        return None;
    }
    Some(output.to_affine().x().to_vec())
}

/// The Keccak account of a compressed key: the last 20 bytes of Keccak-256 of its point.
pub fn keccak_account(public_key: &[u8]) -> Option<Vec<u8>> {
    let point = PublicKey::from_sec1_bytes(public_key)
        .ok()?
        .to_sec1_point(false);
    let hash = Keccak256::digest(&point.as_bytes()[1..]);
    Some(hash[hash.len() - HASH160_BYTES..].to_vec())
}

/// `account` as EIP-55 writes it: the hexadecimal digits from 8 of Keccak-256 of the lower-case
/// digits in capitals.
pub fn eip55(account: &[u8]) -> String {
    let lower: String = account.iter().map(|byte| format!("{byte:02x}")).collect();
    let hash = Keccak256::digest(lower.as_bytes());
    lower
        .chars()
        .enumerate()
        .map(|(position, character)| {
            let byte = hash[position / 2];
            let digit = if position % 2 == 0 {
                byte >> 4
            } else {
                byte & 0x0f
            };
            if digit >= 8 {
                character.to_ascii_uppercase()
            } else {
                character
            }
        })
        .collect()
}

/// The CashAddr checksum of `groups`, its prefix's groups and a zero before them: zero for a
/// valid address.
pub fn cashaddr_polymod(groups: &[u8]) -> u64 {
    const GENERATORS: [u64; 5] = [
        0x98_f2bc_8e61,
        0x79_b76d_99e2,
        0xf3_3e5f_b3c4,
        0xae_2eab_e2a8,
        0x1e_4f43_e470,
    ];
    let mut checksum = 1_u64;
    for &group in groups {
        let top = checksum >> 35;
        checksum = ((checksum & 0x07_ffff_ffff) << 5) ^ u64::from(group);
        for (bit, generator) in GENERATORS.iter().enumerate() {
            if (top >> bit) & 1 == 1 {
                checksum ^= generator;
            }
        }
    }
    checksum ^ 1
}

/// Whether `text` is written as an address of some coin, so that a coin that cannot read it says
/// it is another coin's rather than damaged: a hexadecimal account, a prefixed CashAddr, Bech32,
/// Bech32m, or Base58Check in either alphabet.
pub fn written_as_an_address(text: &str) -> bool {
    let hex_account = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .is_some_and(|digits| {
            digits.len() == 2 * HASH160_BYTES && digits.bytes().all(|byte| byte.is_ascii_hexdigit())
        });
    let lower = text.to_ascii_lowercase();
    let cashaddr_groups = (8 * (1 + HASH160_BYTES)).div_ceil(5) + CASHADDR_CHECKSUM_GROUPS;
    let prefixed_cashaddr = lower.split_once(':').is_some_and(|(prefix, payload)| {
        !prefix.is_empty()
            && prefix.bytes().all(|byte| byte.is_ascii_lowercase())
            && payload.len() == cashaddr_groups
            && payload
                .chars()
                .all(|character| BECH32_ALPHABET.contains(character))
    });
    hex_account
        || prefixed_cashaddr
        || decode_bech32(text, false).is_some()
        || decode_bech32(text, true).is_some()
        || checked_data(text, Alphabet::Bitcoin).is_some()
        || checked_data(text, Alphabet::Ripple).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eip55_capitalises_by_the_hash() {
        let account: Vec<u8> = (0..20)
            .map(|at| u8::try_from(at * 7).unwrap_or(0))
            .collect();
        let written = eip55(&account);
        assert_eq!(
            written.to_ascii_lowercase(),
            account
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
    }

    #[test]
    fn groups_need_zero_padding() {
        assert_eq!(bytes_of_groups(&[0b11111, 0b11100]), Some(vec![0xff]));
        assert_eq!(bytes_of_groups(&[0b11111, 0b11101]), None);
    }
}

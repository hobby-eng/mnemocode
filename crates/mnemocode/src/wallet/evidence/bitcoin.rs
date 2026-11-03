//! The evidence of a Bitcoin wallet (the part of MnemoCode TS 0.1.0's `core/wallet-evidence.ts`
//! that a build without Bitcoin leaves out, CORE-31): an account extended public key, a Bitcoin
//! address, a compressed public key or a WIF at its place. Its form names its address profile: an
//! address's type names one, a SLIP-132 key (ypub, zpub and their kin) one, and an xpub, a tpub, a
//! public key or a WIF none, so that all four are looked under.

use std::fmt;

use super::{
    Evidence, EvidenceError, KeyNetwork, Kind as EvidenceKind, WalletMatch, found_match,
    parse_extended_public_key,
};
use crate::bip32::{ExtendedKey, ExtendedPublicKey};
use crate::refusal::Refusal;
use crate::text::space::trim;
use crate::wallet::coins::{
    AddressLocation, AddressType, Coin, CoinAddress, CoinError, KeyPath, bitcoin, encodings,
};
use crate::wallet::scan::{address_count, match_at_path, scan_branch};

/// The bytes of a compressed public key.
pub const COMPRESSED_KEY_BYTES: usize = 33;

impl KeyNetwork {
    /// The network of a testnet or not.
    const fn of(testnet: bool) -> Self {
        if testnet {
            Self::Testnet
        } else {
            Self::Mainnet
        }
    }

    /// The version byte of its WIF.
    const fn wif_version(self) -> u8 {
        match self {
            Self::Mainnet => 0x80,
            Self::Testnet => 0xef,
        }
    }
}

/// The Bitcoin address profiles a check goes through: each a type of address and its purpose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BitcoinProfile {
    /// P2PKH (BIP44).
    Legacy,
    /// P2SH-P2WPKH (BIP49).
    NestedSegwit,
    /// P2WPKH (BIP84).
    NativeSegwit,
    /// P2TR (BIP86).
    Taproot,
}

impl BitcoinProfile {
    /// Every profile, in the order they are looked under.
    pub(crate) const ALL: [Self; 4] = [
        Self::Legacy,
        Self::NestedSegwit,
        Self::NativeSegwit,
        Self::Taproot,
    ];

    /// The type of its addresses.
    pub(crate) const fn kind(self) -> AddressType {
        match self {
            Self::Legacy => AddressType::P2pkh,
            Self::NestedSegwit => AddressType::P2shP2wpkh,
            Self::NativeSegwit => AddressType::P2wpkh,
            Self::Taproot => AddressType::P2tr,
        }
    }

    /// The profile of addresses of `kind`, in a list: none for a type no Bitcoin profile writes.
    fn of_kind(kind: AddressType) -> Vec<Self> {
        Self::ALL
            .into_iter()
            .filter(|profile| profile.kind() == kind)
            .collect()
    }

    /// The profiles the form of the extended key `text` names (SLIP-132): ypub and upub nested
    /// SegWit, zpub and vpub native SegWit. xpub and tpub name none, and SLIP-132's Ypub, Zpub, Upub
    /// and Vpub name multisig accounts, which no profile of a single key is: every profile is looked
    /// under for them.
    fn named_by_key(text: &str) -> Vec<Self> {
        match trim(text).get(..4) {
            Some("ypub" | "upub") => vec![Self::NestedSegwit],
            Some("zpub" | "vpub") => vec![Self::NativeSegwit],
            _ => Self::ALL.to_vec(),
        }
    }
}

/// The refusals of Bitcoin's evidence, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BitcoinError {
    /// An address that is no Bitcoin address of the network.
    AddressNotValid(KeyNetwork),
    /// An address of the other network: the one asked and the one it is.
    AddressOtherNetwork(KeyNetwork, KeyNetwork),
    /// A public key of another length or not hexadecimal.
    PublicKeyLength,
    /// A public key that is not compressed.
    PublicKeyPrefix,
    /// A public key off the curve.
    PublicKeyNotPoint,
    /// A WIF that does not read on the network.
    WifNotValid(KeyNetwork),
    /// A WIF whose key is no private key.
    WifNoKey,
}

impl fmt::Display for BitcoinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AddressNotValid(network) => write!(
                f,
                "The address is not valid for Bitcoin {}.",
                network.name()
            ),
            Self::AddressOtherNetwork(asked, is) => write!(
                f,
                "The address is not valid for Bitcoin {}; it is a {} address.",
                asked.name(),
                is.name()
            ),
            Self::PublicKeyLength => write!(
                f,
                "A compressed public key must be exactly {COMPRESSED_KEY_BYTES} bytes encoded as {} hexadecimal characters.",
                2 * COMPRESSED_KEY_BYTES
            ),
            Self::PublicKeyPrefix => {
                f.write_str("A compressed public key must start with 02 or 03.")
            }
            Self::PublicKeyNotPoint => {
                f.write_str("The compressed public key is not a point of the secp256k1 curve.")
            }
            Self::WifNotValid(network) => {
                write!(f, "The WIF is not valid for Bitcoin {}.", network.name())
            }
            Self::WifNoKey => f.write_str("The WIF holds no valid secp256k1 private key."),
        }
    }
}

impl std::error::Error for BitcoinError {}

impl Refusal for BitcoinError {
    fn code(&self) -> &'static str {
        match self {
            Self::AddressNotValid(_) => "core.wallet-evidence.address-not-valid-bitcoin",
            Self::AddressOtherNetwork(..) => {
                "core.wallet-evidence.address-not-valid-bitcoin-address"
            }
            Self::PublicKeyLength => {
                "core.wallet-evidence.compressed-public-key-exactly-bytes-encoded-as-hexadecimal"
            }
            Self::PublicKeyPrefix => "core.wallet-evidence.compressed-public-key-start-02-03",
            Self::PublicKeyNotPoint => {
                "core.wallet-evidence.compressed-public-key-not-point-secp256k1-curve"
            }
            Self::WifNotValid(_) => "core.wallet-evidence.wif-not-valid-bitcoin",
            Self::WifNoKey => "core.wallet-evidence.wif-holds-no-valid-secp256k1-private-key",
        }
    }
}

/// The compressed public key `text`, 66 hexadecimal digits of a point of the curve.
pub fn parse_compressed_public_key(
    text: &str,
) -> Result<[u8; COMPRESSED_KEY_BYTES], EvidenceError> {
    let digits = trim(text).to_ascii_lowercase();
    if digits.len() != 2 * COMPRESSED_KEY_BYTES
        || !digits.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(BitcoinError::PublicKeyLength.into());
    }
    let mut key = [0; COMPRESSED_KEY_BYTES];
    for (at, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&digits[2 * at..2 * at + 2], 16)
            .map_err(|_| BitcoinError::PublicKeyLength)?;
    }
    if !matches!(key[0], 0x02 | 0x03) {
        return Err(BitcoinError::PublicKeyPrefix.into());
    }
    k256::PublicKey::from_sec1_bytes(&key).map_err(|_| BitcoinError::PublicKeyNotPoint)?;
    Ok(key)
}

/// The compressed public key of the WIF `text` on `network`; the private key is wiped.
pub fn wif_public_key(
    text: &str,
    network: KeyNetwork,
) -> Result<[u8; COMPRESSED_KEY_BYTES], EvidenceError> {
    let invalid = BitcoinError::WifNotValid(network);
    let mut data = encodings::checked_data(trim(text), encodings::Alphabet::Bitcoin)
        .ok_or_else(|| invalid.clone())?;
    let compressed = data.len() == 34 && data[0] == network.wif_version() && data[33] == 0x01;
    let key = if compressed {
        let mut private = crate::secret::SecretBytes::copy_of("a WIF's private key", &data[1..33]);
        let public = k256::SecretKey::from_slice(&private)
            .map(|secret| secret.public_key())
            .map_err(|_| BitcoinError::WifNoKey);
        private.fill(0);
        Some(public)
    } else {
        None
    };
    zeroize::Zeroize::zeroize(&mut data);
    let public = key.ok_or(invalid)??;
    use k256::elliptic_curve::sec1::ToSec1Point;
    public
        .to_sec1_point(true)
        .as_bytes()
        .try_into()
        .map_err(|_| BitcoinError::WifNoKey.into())
}

/// The Bitcoin address `text` on `network`.
pub fn bitcoin_address_on(text: &str, network: KeyNetwork) -> Result<CoinAddress, EvidenceError> {
    let address = bitcoin::COIN.parse(text).map_err(|error| match error {
        CoinError::NotSingleKey(_) => EvidenceError::Coin(error),
        _ => BitcoinError::AddressNotValid(network).into(),
    })?;
    let on = KeyNetwork::of(address.testnet);
    if on != network {
        return Err(BitcoinError::AddressOtherNetwork(network, on).into());
    }
    Ok(address)
}

/// What a Bitcoin key stands for: an address, a public key, or an account's key.
#[derive(Clone, Debug)]
pub(super) enum Expected {
    Address(CoinAddress),
    PublicKey([u8; COMPRESSED_KEY_BYTES]),
    Account(ExtendedPublicKey),
}

/// Evidence of Bitcoin's keys.
#[derive(Clone, Debug)]
pub(super) enum Kind {
    Located {
        expected: Expected,
        network: KeyNetwork,
        profiles: Vec<BitcoinProfile>,
        location: AddressLocation,
        count: u32,
    },
}

impl Kind {
    /// Whether it is matched by the keys of `root`, the master key of the phrase.
    pub(super) fn compare(&self, root: &ExtendedKey) -> Result<WalletMatch, EvidenceError> {
        match self {
            Self::Located {
                expected,
                network,
                profiles,
                location,
                count,
            } => {
                for &profile in profiles {
                    let mut matched = |node: &ExtendedKey, key: &[u8; 33]| {
                        derived_from(expected, profile, *network, node, key)
                    };
                    let found = if let Expected::Account(_) = expected {
                        account_paths(profile, *network, location.account)
                            .iter()
                            .find_map(|path| match_at_path(root, path, &mut matched).transpose())
                            .transpose()?
                    } else {
                        let mut found = None;
                        for branch in branch_paths(profile, *network, *location) {
                            found =
                                scan_branch(root, &branch, (location.index, *count), &mut matched)?;
                            if found.is_some() {
                                break;
                            }
                        }
                        found
                    };
                    if let Some(found) = found {
                        return Ok(found_match(found.derived, &found.path));
                    }
                }
                Ok(WalletMatch::default())
            }
        }
    }
}

/// Where a located kind of evidence is looked for: on `network`, from `location`, and compared with
/// `addresses` keys from its index (the scan's default without), under the profiles its form names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    /// The network.
    pub network: KeyNetwork,
    /// The place of the first key.
    pub location: AddressLocation,
    /// How many addresses from it are compared.
    pub addresses: Option<u64>,
}

impl Evidence {
    /// A Bitcoin address at `place`, under the one profile its type names: the place checked
    /// first, as TS's `LocatedEvidence` checks it, then the address.
    pub fn bitcoin_address(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let network = place.network;
        let read = |text: &str| {
            let address = bitcoin_address_on(text, network)?;
            let profiles = BitcoinProfile::of_kind(address.kind);
            Ok((Expected::Address(address), profiles))
        };
        Self::at_place(text, place, read)
    }

    /// A compressed public key at `place`, under every profile, the place checked first.
    pub fn public_key(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let read = |text: &str| {
            let key = parse_compressed_public_key(text)?;
            Ok((Expected::PublicKey(key), BitcoinProfile::ALL.to_vec()))
        };
        Self::at_place(text, place, read)
    }

    /// The key of a WIF at `place`, under every profile, the place checked first.
    pub fn wif(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let network = place.network;
        let read = |text: &str| {
            let key = wif_public_key(text, network)?;
            Ok((Expected::PublicKey(key), BitcoinProfile::ALL.to_vec()))
        };
        Self::at_place(text, place, read)
    }

    /// An account's extended public key at `account`, under the profile its SLIP-132 form names or
    /// every profile for any other form: its account alone places it, with no branch or index
    /// (TS a7aecf5), the place checked first.
    pub fn account_key(
        text: &str,
        network: KeyNetwork,
        account: u64,
    ) -> Result<Self, EvidenceError> {
        let place = Place {
            network,
            location: AddressLocation::new(account, 0, 0)?,
            addresses: None,
        };
        let read = |text: &str| {
            let key = parse_extended_public_key(text, network)?;
            Ok((Expected::Account(key), BitcoinProfile::named_by_key(text)))
        };
        Self::at_place(text, place, read)
    }

    /// The evidence that `read` makes of `text` at its place, which is checked before the value is
    /// read, as TS's `LocatedEvidence` checks it: the addresses compared from the place's index.
    /// `read` gives the profiles the value's form names.
    fn at_place(
        text: &str,
        place: Place,
        read: impl FnOnce(&str) -> Result<(Expected, Vec<BitcoinProfile>), EvidenceError>,
    ) -> Result<Self, EvidenceError> {
        let Place {
            network,
            location,
            addresses,
        } = place;
        let count = address_count(addresses, u64::from(location.index))?;
        let (expected, profiles) = read(text)?;
        Ok(Self(EvidenceKind::Bitcoin(Kind::Located {
            expected,
            network,
            profiles,
            location,
            count,
        })))
    }
}

/// Bitcoin's account paths of `profile` on `network`.
fn account_paths(profile: BitcoinProfile, network: KeyNetwork, account: u32) -> Vec<KeyPath> {
    bitcoin_paths(|coin| coin.account_paths(profile.kind(), network.testnet(), account))
}

/// Bitcoin's branch paths of `profile` on `network` at `location`.
fn branch_paths(
    profile: BitcoinProfile,
    network: KeyNetwork,
    location: AddressLocation,
) -> Vec<KeyPath> {
    bitcoin_paths(|coin| coin.branch_paths(profile.kind(), network.testnet(), location))
}

/// The paths `of` Bitcoin gives.
fn bitcoin_paths(of: impl FnOnce(&Coin) -> Vec<KeyPath>) -> Vec<KeyPath> {
    of(&bitcoin::COIN)
}

/// What `node`, of public key `key`, derives that `expected` is, under `profile`; none where it
/// does not match.
fn derived_from(
    expected: &Expected,
    profile: BitcoinProfile,
    network: KeyNetwork,
    node: &ExtendedKey,
    key: &[u8; 33],
) -> Option<String> {
    match expected {
        Expected::Address(address) => (profile.kind() == address.kind
            && address.is_address_of(key).ok()?)
        .then(|| address.text.clone()),
        Expected::PublicKey(public) => crate::secret::equal_bytes(public, key)
            .then(|| key.iter().map(|byte| format!("{byte:02x}")).collect()),
        Expected::Account(account) => {
            let derived = node.public().ok()?;
            (derived == *account).then(|| derived.encode(network.public_version()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::tests::root;
    use super::*;

    /// The first place on the main network, compared with `addresses` keys.
    fn first(addresses: Option<u64>) -> Place {
        Place {
            network: KeyNetwork::Mainnet,
            location: AddressLocation::new(0, 0, 0).unwrap(),
            addresses,
        }
    }

    #[test]
    fn an_address_is_found_among_the_first_keys_under_the_profile_of_its_type() {
        let evidence =
            Evidence::bitcoin_address("bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g", first(Some(5)))
                .unwrap();
        let matched = evidence.compare(&root()).unwrap();
        assert_eq!(matched.path.as_deref(), Some("m/84'/0'/0'/0/1"));
        let legacy = Evidence::bitcoin_address("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA", first(None))
            .unwrap()
            .compare(&root())
            .unwrap();
        assert_eq!(legacy.path.as_deref(), Some("m/44'/0'/0'/0/0"));
    }

    #[test]
    fn the_place_is_checked_before_the_value_as_ts_checks_it() {
        let refusal = Evidence::bitcoin_address("garbage", first(Some(0))).unwrap_err();
        assert_eq!(refusal.code(), "core.address-scan.address-count-refused");
    }

    #[test]
    fn an_account_key_is_found_at_its_account_under_the_profile_its_form_names() {
        let zpub = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
        let matched = Evidence::account_key(zpub, KeyNetwork::Mainnet, 0)
            .unwrap()
            .compare(&root())
            .unwrap();
        assert_eq!(matched.path.as_deref(), Some("m/84'/0'/0'"));
        assert_eq!(
            BitcoinProfile::named_by_key(zpub),
            [BitcoinProfile::NativeSegwit]
        );
        assert_eq!(
            BitcoinProfile::named_by_key(
                " ypub6Ww3ibxVfGzLrAH1PNcjyAWenMTbbAosGNB6VvmSEgytSER9azLDWCxoJwW7Ke7icmizBMXrzBx9979FfaHxHcrArf3zbeJJJUZPf663zsP"
            ),
            [BitcoinProfile::NestedSegwit]
        );
        assert_eq!(
            BitcoinProfile::named_by_key("xpub6BgBgses"),
            BitcoinProfile::ALL
        );
        assert_eq!(
            BitcoinProfile::named_by_key("Zpub74Ckw2Kz"),
            BitcoinProfile::ALL
        );
    }
}

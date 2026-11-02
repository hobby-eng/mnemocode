//! The evidence of a Bitcoin wallet (the part of MnemoCode TS 0.1.0's `core/wallet-evidence.ts`
//! that a build without Bitcoin leaves out, CORE-31): a master or account extended public key, a
//! Bitcoin address, a compressed public key or a WIF at its place under the selected address
//! profiles.

use std::fmt;

use super::{
    Evidence, EvidenceError, Kind as EvidenceKind, MASTER_KEY_PATH, WalletMatch, found_match,
};
use crate::bip32::{ExtendedKey, ExtendedPublicKey};
use crate::refusal::Refusal;
use crate::text::space::trim;
use crate::text::words::list_in_words;
use crate::wallet::coins::{
    AddressLocation, AddressType, Coin, CoinAddress, CoinError, KeyPath, bitcoin, encodings,
};
use crate::wallet::scan::{address_count, match_at_path, scan_branch};

/// The bytes of a compressed public key.
pub const COMPRESSED_KEY_BYTES: usize = 33;

/// Bitcoin's networks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BitcoinNetwork {
    /// The main network.
    Mainnet,
    /// The test networks.
    Testnet,
}

impl BitcoinNetwork {
    /// Both, as options and messages name them.
    pub const ALL: [Self; 2] = [Self::Mainnet, Self::Testnet];

    /// Its name.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Mainnet => "mainnet",
            Self::Testnet => "testnet",
        }
    }

    /// The network `name` names.
    pub fn named(name: &str) -> Result<Self, EvidenceError> {
        Self::ALL
            .into_iter()
            .find(|network| network.name() == name)
            .ok_or(EvidenceError::Bitcoin(BitcoinError::Network))
    }

    /// Whether it is a testnet.
    pub const fn testnet(self) -> bool {
        matches!(self, Self::Testnet)
    }

    const fn of(testnet: bool) -> Self {
        if testnet {
            Self::Testnet
        } else {
            Self::Mainnet
        }
    }

    /// The version of its xpub (BIP32).
    const fn public_version(self) -> u32 {
        match self {
            Self::Mainnet => 0x0488_b21e,
            Self::Testnet => 0x0435_87cf,
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
pub enum BitcoinProfile {
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
    /// Every profile, in the order of the options.
    pub const ALL: [Self; 4] = [
        Self::Legacy,
        Self::NestedSegwit,
        Self::NativeSegwit,
        Self::Taproot,
    ];

    /// Its name.
    pub const fn name(self) -> &'static str {
        match self {
            Self::Legacy => "legacy",
            Self::NestedSegwit => "nested-segwit",
            Self::NativeSegwit => "native-segwit",
            Self::Taproot => "taproot",
        }
    }

    /// The type of its addresses.
    pub const fn kind(self) -> AddressType {
        match self {
            Self::Legacy => AddressType::P2pkh,
            Self::NestedSegwit => AddressType::P2shP2wpkh,
            Self::NativeSegwit => AddressType::P2wpkh,
            Self::Taproot => AddressType::P2tr,
        }
    }

    /// The profiles `names` name, each once and at least one.
    pub fn checked(names: &[&str]) -> Result<Vec<Self>, EvidenceError> {
        if names.is_empty() {
            return Err(BitcoinError::NoProfile.into());
        }
        let mut profiles = Vec::new();
        for name in names {
            let profile = Self::ALL
                .into_iter()
                .find(|profile| profile.name() == *name)
                .ok_or(BitcoinError::UnknownProfile)?;
            if profiles.contains(&profile) {
                return Err(BitcoinError::ProfileTwice.into());
            }
            profiles.push(profile);
        }
        Ok(profiles)
    }
}

/// The extended public keys a check reads: their four letters, the network and the version.
const EXTENDED_KEY_VERSIONS: [(&str, BitcoinNetwork, u32); 10] = [
    ("xpub", BitcoinNetwork::Mainnet, 0x0488_b21e),
    ("ypub", BitcoinNetwork::Mainnet, 0x049d_7cb2),
    ("zpub", BitcoinNetwork::Mainnet, 0x04b2_4746),
    ("Ypub", BitcoinNetwork::Mainnet, 0x0295_b43f),
    ("Zpub", BitcoinNetwork::Mainnet, 0x02aa_7ed3),
    ("tpub", BitcoinNetwork::Testnet, 0x0435_87cf),
    ("upub", BitcoinNetwork::Testnet, 0x044a_5262),
    ("vpub", BitcoinNetwork::Testnet, 0x045f_1cf6),
    ("Upub", BitcoinNetwork::Testnet, 0x0242_89ef),
    ("Vpub", BitcoinNetwork::Testnet, 0x0257_5483),
];

/// The refusals of Bitcoin's evidence, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BitcoinError {
    /// An address that is no Bitcoin address of the network.
    AddressNotValid(BitcoinNetwork),
    /// An address of the other network: the one asked and the one it is.
    AddressOtherNetwork(BitcoinNetwork, BitcoinNetwork),
    /// An address of a type no selected profile writes: the profile that writes it.
    OutsideProfiles(&'static str),
    /// A network that is none.
    Network,
    /// No profile.
    NoProfile,
    /// A profile that is none.
    UnknownProfile,
    /// A profile named twice.
    ProfileTwice,
    /// A public key of another length or not hexadecimal.
    PublicKeyLength,
    /// A public key that is not compressed.
    PublicKeyPrefix,
    /// A public key off the curve.
    PublicKeyNotPoint,
    /// A WIF that does not read on the network.
    WifNotValid(BitcoinNetwork),
    /// A WIF whose key is no private key.
    WifNoKey,
    /// An extended key of another prefix.
    ExtendedKeyPrefix,
    /// An extended key of the other network.
    ExtendedKeyNetwork,
    /// An extended key that does not read.
    ExtendedKeyInvalid,
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
            Self::OutsideProfiles(writer) => write!(
                f,
                "The address is a {writer} address, which none of the selected Bitcoin address profiles writes."
            ),
            Self::Network => {
                let names: Vec<&str> = BitcoinNetwork::ALL
                    .iter()
                    .map(|network| network.name())
                    .collect();
                write!(
                    f,
                    "Bitcoin network must be {}.",
                    list_in_words(&names, "or")
                )
            }
            Self::NoProfile => {
                f.write_str("At least one Bitcoin address profile must be selected.")
            }
            Self::UnknownProfile => f.write_str("Unknown Bitcoin address profile."),
            Self::ProfileTwice => {
                f.write_str("Each Bitcoin address profile may be named only once.")
            }
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
            Self::ExtendedKeyPrefix => {
                let prefixes: Vec<&str> = EXTENDED_KEY_VERSIONS
                    .iter()
                    .map(|(prefix, ..)| *prefix)
                    .collect();
                write!(
                    f,
                    "Unsupported extended-key prefix. Supported public forms include {}.",
                    list_in_words(&prefixes, "and")
                )
            }
            Self::ExtendedKeyNetwork => {
                f.write_str("The extended-key prefix does not match the selected Bitcoin network.")
            }
            Self::ExtendedKeyInvalid => f.write_str("The extended public key is not valid."),
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
            Self::OutsideProfiles(_) => "core.wallet-evidence.address-outside-profiles",
            Self::Network => "core.wallet-evidence.bitcoin-network",
            Self::NoProfile => "core.wallet-evidence.at-least-one-bitcoin-address-profile-selected",
            Self::UnknownProfile => "core.wallet-evidence.unknown-bitcoin-address-profile",
            Self::ProfileTwice => "core.wallet-evidence.bitcoin-address-profile-given-twice",
            Self::PublicKeyLength => {
                "core.wallet-evidence.compressed-public-key-exactly-bytes-encoded-as-hexadecimal"
            }
            Self::PublicKeyPrefix => "core.wallet-evidence.compressed-public-key-start-02-03",
            Self::PublicKeyNotPoint => {
                "core.wallet-evidence.compressed-public-key-not-point-secp256k1-curve"
            }
            Self::WifNotValid(_) => "core.wallet-evidence.wif-not-valid-bitcoin",
            Self::WifNoKey => "core.wallet-evidence.wif-holds-no-valid-secp256k1-private-key",
            Self::ExtendedKeyPrefix => {
                "core.wallet-evidence.unsupported-extended-key-prefix-supported-public-forms-include"
            }
            Self::ExtendedKeyNetwork => {
                "core.wallet-evidence.extended-key-prefix-does-not-match-selected-bitcoin"
            }
            Self::ExtendedKeyInvalid => "core.wallet-evidence.extended-public-key-not-valid",
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
    network: BitcoinNetwork,
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

/// The extended public key `text` of `network`, in any of its forms.
pub fn parse_extended_public_key(
    text: &str,
    network: BitcoinNetwork,
) -> Result<ExtendedPublicKey, EvidenceError> {
    let text = trim(text);
    let prefix = text.get(..4).unwrap_or_default();
    let (_, on, version) = EXTENDED_KEY_VERSIONS
        .iter()
        .find(|(known, ..)| *known == prefix)
        .ok_or(BitcoinError::ExtendedKeyPrefix)?;
    if *on != network {
        return Err(BitcoinError::ExtendedKeyNetwork.into());
    }
    ExtendedPublicKey::decode(text, *version).ok_or_else(|| BitcoinError::ExtendedKeyInvalid.into())
}

/// The Bitcoin address `text` on `network`.
pub fn bitcoin_address_on(
    text: &str,
    network: BitcoinNetwork,
) -> Result<CoinAddress, EvidenceError> {
    let address = bitcoin::COIN.parse(text).map_err(|error| match error {
        CoinError::NotSingleKey(_) => EvidenceError::Coin(error),
        _ => BitcoinError::AddressNotValid(network).into(),
    })?;
    let on = BitcoinNetwork::of(address.testnet);
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
    MasterKey(ExtendedPublicKey, BitcoinNetwork),
    Located {
        expected: Expected,
        network: BitcoinNetwork,
        profiles: Vec<BitcoinProfile>,
        location: AddressLocation,
        count: u32,
    },
}

impl Kind {
    /// Whether it is matched by the keys of `root`, the master key of the phrase.
    pub(super) fn compare(&self, root: &ExtendedKey) -> Result<WalletMatch, EvidenceError> {
        match self {
            Self::MasterKey(expected, network) => {
                let derived = root.public()?;
                Ok(WalletMatch {
                    matched: derived == *expected,
                    derived: Some(derived.encode(network.public_version())),
                    path: Some(MASTER_KEY_PATH.to_owned()),
                    warning: None,
                })
            }
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

/// Where a located kind of evidence is looked for: on `network`, under `profiles`, from
/// `location`, and compared with `addresses` keys from its index (the scan's default without).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    /// The network.
    pub network: BitcoinNetwork,
    /// The profiles, at least one.
    pub profiles: Vec<BitcoinProfile>,
    /// The place of the first key.
    pub location: AddressLocation,
    /// How many addresses from it are compared.
    pub addresses: Option<u64>,
}

impl Evidence {
    /// A master extended public key of `network`.
    pub fn master_key(text: &str, network: BitcoinNetwork) -> Result<Self, EvidenceError> {
        Ok(Self(EvidenceKind::Bitcoin(Kind::MasterKey(
            parse_extended_public_key(text, network)?,
            network,
        ))))
    }

    /// A Bitcoin address at `place`: the place checked first, as TS's `LocatedEvidence` checks it,
    /// then the address, which one of the place's profiles must write.
    pub fn bitcoin_address(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let network = place.network;
        let read = |text: &str, profiles: &[BitcoinProfile]| {
            let address = bitcoin_address_on(text, network)?;
            if profiles
                .iter()
                .any(|profile| profile.kind() == address.kind)
            {
                return Ok(Expected::Address(address));
            }
            let writer = BitcoinProfile::ALL
                .into_iter()
                .find(|profile| profile.kind() == address.kind);
            Err(BitcoinError::OutsideProfiles(writer.map_or("", BitcoinProfile::name)).into())
        };
        Self::at_place(text, place, read)
    }

    /// A compressed public key at `place`, the place checked first.
    pub fn public_key(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let read = |text: &str, _: &[BitcoinProfile]| {
            Ok(Expected::PublicKey(parse_compressed_public_key(text)?))
        };
        Self::at_place(text, place, read)
    }

    /// The key of a WIF at `place`, the place checked first.
    pub fn wif(text: &str, place: Place) -> Result<Self, EvidenceError> {
        let network = place.network;
        let read = |text: &str, _: &[BitcoinProfile]| {
            Ok(Expected::PublicKey(wif_public_key(text, network)?))
        };
        Self::at_place(text, place, read)
    }

    /// An account's extended public key at `account` under `profiles`: its account alone places
    /// it, with no branch or index (TS a7aecf5), the place checked first.
    pub fn account_key(
        text: &str,
        network: BitcoinNetwork,
        profiles: Vec<BitcoinProfile>,
        account: u64,
    ) -> Result<Self, EvidenceError> {
        let place = Place {
            network,
            profiles,
            location: AddressLocation::new(account, 0, 0)?,
            addresses: None,
        };
        let read = |text: &str, _: &[BitcoinProfile]| {
            Ok(Expected::Account(parse_extended_public_key(text, network)?))
        };
        Self::at_place(text, place, read)
    }

    /// The evidence that `read` makes of `text` at its place, which is checked before the value is
    /// read, as TS's `LocatedEvidence` checks it: at least one profile, then the addresses compared
    /// from the place's index.
    fn at_place(
        text: &str,
        place: Place,
        read: impl FnOnce(&str, &[BitcoinProfile]) -> Result<Expected, EvidenceError>,
    ) -> Result<Self, EvidenceError> {
        let Place {
            network,
            profiles,
            location,
            addresses,
        } = place;
        if profiles.is_empty() {
            return Err(BitcoinError::NoProfile.into());
        }
        let count = address_count(addresses, u64::from(location.index))?;
        let expected = read(text, &profiles)?;
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
fn account_paths(profile: BitcoinProfile, network: BitcoinNetwork, account: u32) -> Vec<KeyPath> {
    bitcoin_paths(|coin| coin.account_paths(profile.kind(), network.testnet(), account))
}

/// Bitcoin's branch paths of `profile` on `network` at `location`.
fn branch_paths(
    profile: BitcoinProfile,
    network: BitcoinNetwork,
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
    network: BitcoinNetwork,
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

    #[test]
    fn an_address_is_found_among_the_first_keys() {
        let location = AddressLocation::new(0, 0, 0).unwrap();
        let profiles = BitcoinProfile::checked(&["native-segwit"]).unwrap();
        let evidence = Evidence::bitcoin_address(
            "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
            Place {
                network: BitcoinNetwork::Mainnet,
                profiles: profiles.clone(),
                location,
                addresses: Some(5),
            },
        )
        .unwrap();
        let matched = evidence.compare(&root()).unwrap();
        assert_eq!(matched.path.as_deref(), Some("m/84'/0'/0'/0/1"));
        assert_eq!(
            Evidence::bitcoin_address(
                "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
                Place {
                    network: BitcoinNetwork::Mainnet,
                    profiles,
                    location,
                    addresses: None
                },
            )
            .unwrap_err(),
            EvidenceError::Bitcoin(BitcoinError::OutsideProfiles("legacy"))
        );
    }

    #[test]
    fn the_place_is_checked_before_the_value_as_ts_checks_it() {
        let location = AddressLocation::new(0, 0, 0).unwrap();
        let refusal = Evidence::bitcoin_address(
            "garbage",
            Place {
                network: BitcoinNetwork::Mainnet,
                profiles: BitcoinProfile::ALL.to_vec(),
                location,
                addresses: Some(0),
            },
        )
        .unwrap_err();
        assert_eq!(refusal.code(), "core.address-scan.address-count-refused");
        let refusal = Evidence::bitcoin_address(
            "garbage",
            Place {
                network: BitcoinNetwork::Mainnet,
                profiles: Vec::new(),
                location,
                addresses: None,
            },
        )
        .unwrap_err();
        assert_eq!(refusal, EvidenceError::Bitcoin(BitcoinError::NoProfile));
    }

    #[test]
    fn an_account_key_is_found_at_its_account() {
        let zpub = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";
        let profiles = BitcoinProfile::checked(&["legacy", "native-segwit"]).unwrap();
        let matched = Evidence::account_key(zpub, BitcoinNetwork::Mainnet, profiles, 0)
            .unwrap()
            .compare(&root())
            .unwrap();
        assert_eq!(matched.path.as_deref(), Some("m/84'/0'/0'"));
        assert_eq!(
            BitcoinProfile::checked(&["legacy", "legacy"]).unwrap_err(),
            EvidenceError::Bitcoin(BitcoinError::ProfileTwice)
        );
    }
}

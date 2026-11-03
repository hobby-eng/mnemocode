//! What tells that a phrase opens the person's wallet (MnemoCode TS 0.1.0's
//! `core/wallet-evidence.ts`, `wallet-check.ts` and `coin-address-evidence.ts`,
//! CAP-WALLET-EVIDENCE-*, CAP-WALLET-FINGERPRINT-EVIDENCE): a master fingerprint, the master
//! extended public key of `master` or an address at its place in every build, read as every coin
//! whose form it has unless one is named, with Bitcoin also the keys of `bitcoin`; each compared
//! with the keys a master key derives, the private half of each wiped once it is compared.

use std::fmt;

use super::coins::{AddressLocation, Coin, CoinAddress, CoinError, KeyPath, parse_any};
use super::scan::{ScanError, address_count, scan_branch};
use crate::bip32::{Bip32Error, ExtendedKey, ExtendedPublicKey, fingerprint_hex};
use crate::refusal::Refusal;
use crate::text::space::trim;

#[cfg(feature = "coin-bitcoin")]
mod bitcoin;
mod master;

#[cfg(feature = "coin-bitcoin")]
pub use bitcoin::{
    BitcoinError, COMPRESSED_KEY_BYTES, Place, bitcoin_address_on, parse_compressed_public_key,
    wif_public_key,
};
pub use master::{KeyError, KeyNetwork, parse_extended_public_key};

/// The path of the master key.
pub const MASTER_KEY_PATH: &str = "m";
/// What a fingerprint match says of itself.
pub const FINGERPRINT_WARNING: &str =
    "A master fingerprint is only 32 bits and is a filter, not proof of recovery.";

/// The refusals of evidence, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvidenceError {
    /// A fingerprint that is not eight hexadecimal digits.
    Fingerprint,
    /// The refusal of an extended key or its network.
    Key(KeyError),
    /// The refusal of Bitcoin's evidence.
    #[cfg(feature = "coin-bitcoin")]
    Bitcoin(BitcoinError),
    /// The coin's refusal.
    Coin(CoinError),
    /// The scan's refusal.
    Scan(ScanError),
}

impl fmt::Display for EvidenceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Fingerprint => {
                f.write_str("A master fingerprint must be eight hexadecimal characters.")
            }
            Self::Key(error) => error.fmt(f),
            #[cfg(feature = "coin-bitcoin")]
            Self::Bitcoin(error) => error.fmt(f),
            Self::Coin(error) => error.fmt(f),
            Self::Scan(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for EvidenceError {}

impl Refusal for EvidenceError {
    fn code(&self) -> &'static str {
        match self {
            Self::Fingerprint => {
                "core.wallet-check.master-fingerprint-eight-hexadecimal-characters"
            }
            Self::Key(error) => error.code(),
            #[cfg(feature = "coin-bitcoin")]
            Self::Bitcoin(error) => error.code(),
            Self::Coin(error) => error.code(),
            Self::Scan(error) => error.code(),
        }
    }
}

impl From<KeyError> for EvidenceError {
    fn from(error: KeyError) -> Self {
        Self::Key(error)
    }
}

#[cfg(feature = "coin-bitcoin")]
impl From<BitcoinError> for EvidenceError {
    fn from(error: BitcoinError) -> Self {
        Self::Bitcoin(error)
    }
}

impl From<CoinError> for EvidenceError {
    fn from(error: CoinError) -> Self {
        Self::Coin(error)
    }
}

impl From<ScanError> for EvidenceError {
    fn from(error: ScanError) -> Self {
        Self::Scan(error)
    }
}

impl From<Bip32Error> for EvidenceError {
    fn from(error: Bip32Error) -> Self {
        Self::Scan(ScanError::Bip32(error))
    }
}

/// What a comparison found: whether it matched, what was derived where it did, at which path, and
/// a warning of what the match is worth.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct WalletMatch {
    /// Whether it matched.
    pub matched: bool,
    /// What the matching key gives, as the evidence writes it.
    pub derived: Option<String>,
    /// The path of the key, `m` for the master key.
    pub path: Option<String>,
    /// What the match is worth, for a fingerprint.
    pub warning: Option<&'static str>,
}

/// The master fingerprint `text`, trimmed, in lower case.
pub fn parse_master_fingerprint(text: &str) -> Result<String, EvidenceError> {
    let fingerprint = trim(text).to_ascii_lowercase();
    if fingerprint.len() == 8 && fingerprint.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(fingerprint)
    } else {
        Err(EvidenceError::Fingerprint)
    }
}

/// One piece of evidence, read and checked; [`Evidence::compare`] compares it with a master key.
#[derive(Clone, Debug)]
pub struct Evidence(Kind);

#[derive(Clone, Debug)]
enum Kind {
    Fingerprint(String),
    MasterKey(ExtendedPublicKey, KeyNetwork),
    #[cfg(feature = "coin-bitcoin")]
    Bitcoin(bitcoin::Kind),
    Coin {
        /// The address as each coin read it.
        addresses: Vec<CoinAddress>,
        location: AddressLocation,
        count: u32,
    },
}

impl Evidence {
    /// A master fingerprint.
    pub fn master_fingerprint(text: &str) -> Result<Self, EvidenceError> {
        Ok(Self(Kind::Fingerprint(parse_master_fingerprint(text)?)))
    }

    /// An address at `location`, compared with `addresses` keys from its index: of `coin`, or where
    /// none is named, of every coin of this build whose form it has ([`parse_any`]), each on its
    /// own paths.
    pub fn address(
        coin: Option<&'static Coin>,
        text: &str,
        location: AddressLocation,
        addresses: Option<u64>,
    ) -> Result<Self, EvidenceError> {
        let read = match coin {
            Some(coin) => vec![coin.parse(text)?],
            None => parse_any(text)?,
        };
        let count = address_count(addresses, u64::from(location.index))?;
        Ok(Self(Kind::Coin {
            addresses: read,
            location,
            count,
        }))
    }

    /// The coins that an address was read as, in the order of the registry; none for other
    /// evidence.
    pub fn coins(&self) -> Vec<&'static Coin> {
        match &self.0 {
            Kind::Coin { addresses, .. } => addresses.iter().map(|address| address.coin).collect(),
            _ => Vec::new(),
        }
    }

    /// Whether it is matched by the keys of `root`, the master key of the phrase.
    pub fn compare(&self, root: &ExtendedKey) -> Result<WalletMatch, EvidenceError> {
        match &self.0 {
            Kind::Fingerprint(expected) => {
                let derived = fingerprint_hex(root.fingerprint()?);
                Ok(WalletMatch {
                    matched: derived == *expected,
                    derived: Some(derived),
                    path: Some(MASTER_KEY_PATH.to_owned()),
                    warning: Some(FINGERPRINT_WARNING),
                })
            }
            Kind::MasterKey(expected, network) => {
                let derived = root.public()?;
                Ok(WalletMatch {
                    matched: derived == *expected,
                    derived: Some(derived.encode(network.public_version())),
                    path: Some(MASTER_KEY_PATH.to_owned()),
                    warning: None,
                })
            }
            #[cfg(feature = "coin-bitcoin")]
            Kind::Bitcoin(kind) => kind.compare(root),
            Kind::Coin {
                addresses,
                location,
                count,
            } => {
                // The branches of every coin, each once: coins of one form may share one.
                let mut branches: Vec<(KeyPath, Vec<&CoinAddress>)> = Vec::new();
                for address in addresses {
                    for branch in address.branch_paths(*location) {
                        match branches.iter_mut().find(|(known, _)| *known == branch) {
                            Some((_, there)) => there.push(address),
                            None => branches.push((branch, vec![address])),
                        }
                    }
                }
                for (branch, there) in &branches {
                    let mut matched = |_: &ExtendedKey, key: &[u8; 33]| {
                        there
                            .iter()
                            .find(|address| address.is_address_of(key).unwrap_or(false))
                            .map(|address| address.text.clone())
                    };
                    if let Some(found) =
                        scan_branch(root, branch, (location.index, *count), &mut matched)?
                    {
                        return Ok(found_match(found.derived, &found.path));
                    }
                }
                Ok(WalletMatch::default())
            }
        }
    }
}

/// A match at `path` that derived `derived`.
fn found_match(derived: String, path: &KeyPath) -> WalletMatch {
    WalletMatch {
        matched: true,
        derived: Some(derived),
        path: Some(path.to_string()),
        warning: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bip39::phrase::Phrase;
    use crate::self_check::vectors::{PUBLIC_FINGERPRINT, PUBLIC_MNEMONIC};

    pub(super) fn root() -> ExtendedKey {
        ExtendedKey::of_phrase(&Phrase::parse(PUBLIC_MNEMONIC).unwrap(), "").unwrap()
    }

    #[test]
    fn a_fingerprint_matches_with_its_warning() {
        let matched = Evidence::master_fingerprint(" 73C5DA0A ")
            .unwrap()
            .compare(&root())
            .unwrap();
        assert!(matched.matched);
        assert_eq!(matched.derived.as_deref(), Some(PUBLIC_FINGERPRINT));
        assert_eq!(matched.warning, Some(FINGERPRINT_WARNING));
        assert_eq!(
            Evidence::master_fingerprint("73c5da0").unwrap_err(),
            EvidenceError::Fingerprint
        );
    }
}

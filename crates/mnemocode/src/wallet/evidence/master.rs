//! The master extended public key of a wallet (the part of MnemoCode TS 0.1.0's
//! `core/wallet-evidence.ts` that every coin shares, CAP-WALLET-EVIDENCE-*): one key for every coin,
//! so every build reads it, in BIP32's forms and SLIP-132's, on the network selected, and refuses a
//! prefix of the other. A build without Bitcoin names no Bitcoin network in its refusals (CORE-31).

use std::fmt;

use super::{Evidence, EvidenceError, Kind};
use crate::bip32::ExtendedPublicKey;
use crate::refusal::Refusal;
use crate::text::space::trim;
use crate::text::words::list_in_words;

/// The networks of extended keys: BIP32's main and test versions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyNetwork {
    /// The main network.
    Mainnet,
    /// The test networks.
    Testnet,
}

impl KeyNetwork {
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
            .ok_or(EvidenceError::Key(KeyError::Network))
    }

    /// Whether it is a testnet.
    pub const fn testnet(self) -> bool {
        matches!(self, Self::Testnet)
    }

    /// The version of its xpub (BIP32).
    pub(super) const fn public_version(self) -> u32 {
        match self {
            Self::Mainnet => XPUB_VERSION,
            Self::Testnet => TPUB_VERSION,
        }
    }
}

/// BIP32's versions of an xpub and a tpub.
const XPUB_VERSION: u32 = 0x0488_b21e;
const TPUB_VERSION: u32 = 0x0435_87cf;

/// The extended public keys a check reads: their four letters, the network and the version.
const EXTENDED_KEY_VERSIONS: [(&str, KeyNetwork, u32); 10] = [
    ("xpub", KeyNetwork::Mainnet, XPUB_VERSION),
    ("ypub", KeyNetwork::Mainnet, 0x049d_7cb2),
    ("zpub", KeyNetwork::Mainnet, 0x04b2_4746),
    ("Ypub", KeyNetwork::Mainnet, 0x0295_b43f),
    ("Zpub", KeyNetwork::Mainnet, 0x02aa_7ed3),
    ("tpub", KeyNetwork::Testnet, TPUB_VERSION),
    ("upub", KeyNetwork::Testnet, 0x044a_5262),
    ("vpub", KeyNetwork::Testnet, 0x045f_1cf6),
    ("Upub", KeyNetwork::Testnet, 0x0242_89ef),
    ("Vpub", KeyNetwork::Testnet, 0x0257_5483),
];

/// The refusals of an extended key and its network, word for word as TS 0.1.0 writes them where
/// Bitcoin is built.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyError {
    /// A network that is none.
    Network,
    /// An extended key of another prefix.
    ExtendedKeyPrefix,
    /// An extended key of the other network.
    ExtendedKeyNetwork,
    /// An extended key that does not read.
    ExtendedKeyInvalid,
}

impl fmt::Display for KeyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network => {
                let names: Vec<&str> = KeyNetwork::ALL
                    .iter()
                    .map(|network| network.name())
                    .collect();
                #[cfg(feature = "coin-bitcoin")]
                let start = "Bitcoin network";
                #[cfg(not(feature = "coin-bitcoin"))]
                let start = "The network";
                write!(f, "{start} must be {}.", list_in_words(&names, "or"))
            }
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
            #[cfg(feature = "coin-bitcoin")]
            Self::ExtendedKeyNetwork => {
                f.write_str("The extended-key prefix does not match the selected Bitcoin network.")
            }
            #[cfg(not(feature = "coin-bitcoin"))]
            Self::ExtendedKeyNetwork => {
                f.write_str("The extended-key prefix does not match the selected network.")
            }
            Self::ExtendedKeyInvalid => f.write_str("The extended public key is not valid."),
        }
    }
}

impl std::error::Error for KeyError {}

impl Refusal for KeyError {
    fn code(&self) -> &'static str {
        match self {
            #[cfg(feature = "coin-bitcoin")]
            Self::Network => "core.wallet-evidence.bitcoin-network",
            #[cfg(not(feature = "coin-bitcoin"))]
            Self::Network => "core.wallet-evidence.network",
            Self::ExtendedKeyPrefix => {
                "core.wallet-evidence.unsupported-extended-key-prefix-supported-public-forms-include"
            }
            #[cfg(feature = "coin-bitcoin")]
            Self::ExtendedKeyNetwork => {
                "core.wallet-evidence.extended-key-prefix-does-not-match-selected-bitcoin"
            }
            #[cfg(not(feature = "coin-bitcoin"))]
            Self::ExtendedKeyNetwork => {
                "core.wallet-evidence.extended-key-prefix-does-not-match-selected-network"
            }
            Self::ExtendedKeyInvalid => "core.wallet-evidence.extended-public-key-not-valid",
        }
    }
}

/// The extended public key `text` of `network`, in any of its forms.
pub fn parse_extended_public_key(
    text: &str,
    network: KeyNetwork,
) -> Result<ExtendedPublicKey, EvidenceError> {
    let text = trim(text);
    let prefix = text.get(..4).unwrap_or_default();
    let (_, on, version) = EXTENDED_KEY_VERSIONS
        .iter()
        .find(|(known, ..)| *known == prefix)
        .ok_or(KeyError::ExtendedKeyPrefix)?;
    if *on != network {
        return Err(KeyError::ExtendedKeyNetwork.into());
    }
    ExtendedPublicKey::decode(text, *version).ok_or_else(|| KeyError::ExtendedKeyInvalid.into())
}

impl Evidence {
    /// A master extended public key of `network`.
    pub fn master_key(text: &str, network: KeyNetwork) -> Result<Self, EvidenceError> {
        Ok(Self(Kind::MasterKey(
            parse_extended_public_key(text, network)?,
            network,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::self_check::vectors::{PUBLIC_MASTER_TPUB, PUBLIC_MASTER_XPUB};

    #[test]
    fn a_master_key_matches_on_its_network_and_is_refused_on_the_other() {
        let root = super::super::tests::root();
        for (text, network) in [
            (PUBLIC_MASTER_XPUB, KeyNetwork::Mainnet),
            (PUBLIC_MASTER_TPUB, KeyNetwork::Testnet),
        ] {
            let found = Evidence::master_key(text, network)
                .unwrap()
                .compare(&root)
                .unwrap();
            assert!(found.matched);
            assert_eq!(found.derived.as_deref(), Some(text));
        }
        let refused = Evidence::master_key(PUBLIC_MASTER_TPUB, KeyNetwork::Mainnet).unwrap_err();
        let named = refused.to_string().contains("Bitcoin");
        assert_eq!(named, cfg!(feature = "coin-bitcoin"));
        assert!(KeyNetwork::named("regtest").is_err());
    }
}

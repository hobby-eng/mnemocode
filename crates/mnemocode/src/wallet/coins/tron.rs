//! Tron: Base58Check of a Keccak account (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-TRON).

use super::encodings::Alphabet;
use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "tron",
    name: "Tron",
    address_forms: "T…",
    testnet_forms: None,
    coin_types: &[195],
    reader: Reader::Base58 {
        versions: &[Version {
            prefix: &[0x41],
            kind: AddressType::Keccak,
            testnet: false,
        }],
        alphabet: Alphabet::Bitcoin,
    },
};

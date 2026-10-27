//! Dogecoin (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-DOGECOIN).

use super::encodings::Alphabet;
use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "dogecoin",
    name: "Dogecoin",
    address_forms: "D…",
    testnet_forms: None,
    coin_types: &[3],
    reader: Reader::Base58 {
        versions: &[Version {
            prefix: &[0x1e],
            kind: AddressType::P2pkh,
            testnet: false,
        }],
        alphabet: Alphabet::Bitcoin,
    },
};

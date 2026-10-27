//! Litecoin (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-LITECOIN).

use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "litecoin",
    name: "Litecoin",
    address_forms: "L…, M…, 3… or ltc1q…",
    testnet_forms: None,
    coin_types: &[2],
    reader: Reader::Segwit {
        versions: &[
            Version {
                prefix: &[0x30],
                kind: AddressType::P2pkh,
                testnet: false,
            },
            Version {
                prefix: &[0x32],
                kind: AddressType::P2shP2wpkh,
                testnet: false,
            },
            Version {
                prefix: &[0x05],
                kind: AddressType::P2shP2wpkh,
                testnet: false,
            },
        ],
        prefixes: ("ltc", None),
        taproot: false,
    },
};

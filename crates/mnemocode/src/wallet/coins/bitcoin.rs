//! Bitcoin (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-BITCOIN, -BITCOIN-NETWORKS, -BITCOIN-PROFILES).

use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "bitcoin",
    name: "Bitcoin",
    address_forms: "1…, 3…, bc1q… or bc1p…",
    testnet_forms: Some("m…, n…, 2…, tb1q… or tb1p…"),
    coin_types: &[0],
    reader: Reader::Segwit {
        versions: &[
            Version {
                prefix: &[0x00],
                kind: AddressType::P2pkh,
                testnet: false,
            },
            Version {
                prefix: &[0x05],
                kind: AddressType::P2shP2wpkh,
                testnet: false,
            },
            Version {
                prefix: &[0x6f],
                kind: AddressType::P2pkh,
                testnet: true,
            },
            Version {
                prefix: &[0xc4],
                kind: AddressType::P2shP2wpkh,
                testnet: true,
            },
        ],
        prefixes: ("bc", Some("tb")),
        taproot: true,
    },
};

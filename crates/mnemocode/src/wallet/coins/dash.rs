//! Dash, Core addresses and Platform payment addresses (DIP-17, DIP-18) (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-DASH).

use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "dash",
    name: "Dash",
    address_forms: "X… or dash1k…",
    testnet_forms: Some("tdash1k…"),
    coin_types: &[5],
    reader: Reader::Dash {
        versions: &[Version {
            prefix: &[0x4c],
            kind: AddressType::P2pkh,
            testnet: false,
        }],
    },
};

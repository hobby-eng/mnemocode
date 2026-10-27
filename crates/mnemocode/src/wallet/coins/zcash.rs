//! Zcash, transparent addresses only (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-ZCASH).

use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "zcash",
    name: "Zcash",
    address_forms: "t1…",
    testnet_forms: None,
    coin_types: &[133],
    reader: Reader::Zcash {
        versions: &[Version {
            prefix: &[0x1c, 0xb8],
            kind: AddressType::P2pkh,
            testnet: false,
        }],
    },
};

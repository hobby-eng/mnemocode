//! Bitcoin Cash, CashAddr and legacy addresses, of the coin types 145 and 0 (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-BITCOIN-CASH).

use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "bitcoin-cash",
    name: "Bitcoin Cash",
    address_forms: "bitcoincash:q… or 1…",
    testnet_forms: None,
    coin_types: &[145, 0],
    reader: Reader::CashAddr {
        versions: &[Version {
            prefix: &[0x00],
            kind: AddressType::P2pkh,
            testnet: false,
        }],
    },
};

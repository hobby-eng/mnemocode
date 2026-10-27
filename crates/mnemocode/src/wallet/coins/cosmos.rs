//! Cosmos: a Bech32 account of a key's HASH160 (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-COSMOS).

use super::{AddressType, Coin, Reader};

/// The coin.
pub static COIN: Coin = Coin {
    id: "cosmos",
    name: "Cosmos",
    address_forms: "cosmos1…",
    testnet_forms: None,
    coin_types: &[118],
    reader: Reader::Bech32Account {
        prefix: "cosmos",
        kind: AddressType::P2pkh,
    },
};

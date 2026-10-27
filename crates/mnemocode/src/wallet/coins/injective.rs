//! Injective: a Bech32 account of a key's Keccak account (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-INJECTIVE).

use super::{AddressType, Coin, Reader};

/// The coin.
pub static COIN: Coin = Coin {
    id: "injective",
    name: "Injective",
    address_forms: "inj1…",
    testnet_forms: None,
    coin_types: &[60],
    reader: Reader::Bech32Account {
        prefix: "inj",
        kind: AddressType::Keccak,
    },
};

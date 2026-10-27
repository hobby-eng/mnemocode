//! Ethereum Classic, of the coin types 61 and 60 (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-ETHEREUM-CLASSIC).

use super::{Coin, Reader};

/// The coin.
pub static COIN: Coin = Coin {
    id: "ethereum-classic",
    name: "Ethereum Classic",
    address_forms: "0x…",
    testnet_forms: None,
    coin_types: &[61, 60],
    reader: Reader::Hex,
};

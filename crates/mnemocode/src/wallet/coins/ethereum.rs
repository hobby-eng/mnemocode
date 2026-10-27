//! Ethereum and the EVM networks, with or without EIP-55 (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-ETHEREUM).

use super::{Coin, Reader};

/// The coin.
pub static COIN: Coin = Coin {
    id: "ethereum",
    name: "Ethereum and EVM networks",
    address_forms: "0x…",
    testnet_forms: None,
    coin_types: &[60],
    reader: Reader::Hex,
};

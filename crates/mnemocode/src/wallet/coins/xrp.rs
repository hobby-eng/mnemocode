//! XRP, in XRP's Base58 alphabet (MnemoCode TS 0.1.0's `core/coins/`, CAP-WALLET-COIN-XRP).

use super::encodings::Alphabet;
use super::{AddressType, Coin, Reader, Version};

/// The coin.
pub static COIN: Coin = Coin {
    id: "xrp",
    name: "XRP",
    address_forms: "r…",
    testnet_forms: None,
    coin_types: &[144],
    reader: Reader::Base58 {
        versions: &[Version {
            prefix: &[0x00],
            kind: AddressType::P2pkh,
            testnet: false,
        }],
        alphabet: Alphabet::Ripple,
    },
};

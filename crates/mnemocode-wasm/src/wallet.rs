//! The wallet part for a page (`browser-wallet`): the evidence of a wallet, each kind made by its
//! own constructor and refused as the library refuses it before any phrase is asked, compared with
//! a seed phrase; the coins of this build; and the part's self-check. Numbers cross as numbers, a
//! place's account, branch and index whole numbers from 0, and a count of addresses NaN for the
//! scan's default; profiles cross as their names, apart by spaces or commas. An entry that takes a
//! secret, a WIF or a phrase and its passphrase, takes its text as `JsValue`s that Rust reads
//! (ARCHITECTURE.md §6).

use mnemocode::bip32::ExtendedKey;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::checks::Part;
use mnemocode::wallet::coins::{AddressLocation, COINS, Coin};
use mnemocode::wallet::evidence::{BitcoinNetwork, BitcoinProfile, Evidence, Place, WalletMatch};
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, optional_text, refused, self_check, text, whole};

/// The evidence of a wallet, checked when it was made.
#[wasm_bindgen]
pub struct WalletEvidence(Evidence);

/// What a comparison found.
#[wasm_bindgen]
pub struct WalletCheck(WalletMatch);

/// Where a Bitcoin key is looked for: the network, the profiles, the place of the first key and
/// how many addresses from it are compared, checked when it is made. A WIF, which is secret, takes
/// these as numbers and names instead: no class crosses beside a secret.
#[wasm_bindgen]
pub struct WalletPlace(Place);

#[wasm_bindgen]
impl WalletPlace {
    /// The place on `network`, under `profiles`, from `account`, `branch` and `index`, compared
    /// with `count` addresses (NaN: the scan's default).
    #[wasm_bindgen(constructor)]
    pub fn new(
        network_name: &str,
        profiles: &str,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletPlace, JsValue> {
        let at = location(account, branch, index)?;
        place(network_name, profiles, at, count).map(WalletPlace)
    }

    /// Its network, by name.
    #[wasm_bindgen(getter)]
    pub fn network(&self) -> String {
        self.0.network.name().to_owned()
    }
}

/// The network `name` names.
fn network(name: &str) -> Result<BitcoinNetwork, JsValue> {
    BitcoinNetwork::named(name).map_err(|refusal| refused(&refusal))
}

/// The place of `account`, `branch` and `index`, refused outside BIP32's normal indexes.
fn location(account: f64, branch: f64, index: f64) -> Result<AddressLocation, JsValue> {
    AddressLocation::new(whole(account), whole(branch), whole(index))
        .map_err(|refusal| refused(&refusal))
}

/// A count of addresses: none for NaN, the scan's default.
fn addresses(count: f64) -> Option<u64> {
    (!count.is_nan()).then(|| whole(count))
}

/// The place that `network`, `profiles` and the location give.
fn place(
    network_name: &str,
    profiles: &str,
    at: AddressLocation,
    count: f64,
) -> Result<Place, JsValue> {
    let names: Vec<&str> = profiles
        .split(|character: char| character == ',' || character.is_whitespace())
        .filter(|name| !name.is_empty())
        .collect();
    Ok(Place {
        network: network(network_name)?,
        profiles: BitcoinProfile::checked(&names).map_err(|refusal| refused(&refusal))?,
        location: at,
        addresses: addresses(count),
    })
}

#[wasm_bindgen]
impl WalletEvidence {
    /// A master fingerprint, eight hexadecimal digits.
    #[wasm_bindgen(js_name = masterFingerprint)]
    pub fn master_fingerprint(text: &str) -> Result<WalletEvidence, JsValue> {
        Evidence::master_fingerprint(text)
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// A master extended public key of `network`.
    #[wasm_bindgen(js_name = masterKey)]
    pub fn master_key(text: &str, network_name: &str) -> Result<WalletEvidence, JsValue> {
        Evidence::master_key(text, network(network_name)?)
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// A Bitcoin address at `place`.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = bitcoinAddress)]
    pub fn bitcoin_address(text: &str, place: &WalletPlace) -> Result<WalletEvidence, JsValue> {
        Evidence::bitcoin_address(text, place.0.clone())
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// A compressed public key at `place`.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = publicKey)]
    pub fn public_key(text: &str, place: &WalletPlace) -> Result<WalletEvidence, JsValue> {
        Evidence::public_key(text, place.0.clone())
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// The key of a WIF, a private key: only its public key is kept. The place crosses as names
    /// and numbers, never as a `WalletPlace`: no class crosses beside a secret.
    #[cfg(feature = "coin-bitcoin")]
    pub fn wif(
        key: JsValue,
        network_name: JsValue,
        profiles: JsValue,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletEvidence, JsValue> {
        after_secret(|| {
            let at = location(account, branch, index)?;
            let names = (
                crate::host::name(&network_name),
                crate::host::name(&profiles),
            );
            let place = place(&names.0, &names.1, at, count)?;
            Evidence::wif(&text(&key)?, place)
                .map(WalletEvidence)
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// An account's extended public key at `account` under `profiles`.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = accountKey)]
    pub fn account_key(
        text: &str,
        network_name: &str,
        profiles: &str,
        account: f64,
    ) -> Result<WalletEvidence, JsValue> {
        let checked = place(network_name, profiles, location(0.0, 0.0, 0.0)?, f64::NAN)?;
        Evidence::account_key(text, checked.network, checked.profiles, whole(account))
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// An address of the coin named `coin` at its place.
    #[wasm_bindgen(js_name = coinAddress)]
    pub fn coin_address(
        coin: &str,
        text: &str,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletEvidence, JsValue> {
        let coin = Coin::named(coin).map_err(|refusal| refused(&refusal))?;
        let at = location(account, branch, index)?;
        Evidence::coin_address(coin, text, at, addresses(count))
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// The evidence compared with the keys of `phrase` and its BIP39 `passphrase` (undefined:
    /// empty). Both are read inside the call, so that a freed evidence is refused before either
    /// is copied.
    pub fn check(&self, phrase: JsValue, passphrase: JsValue) -> Result<WalletCheck, JsValue> {
        after_secret(|| self.check_text(&text(&phrase)?, &optional_text(&passphrase)?))
    }
}

impl WalletEvidence {
    /// [`WalletEvidence::check`] of the text read.
    fn check_text(&self, phrase: &str, passphrase: &str) -> Result<WalletCheck, JsValue> {
        let phrase = Phrase::parse(phrase).map_err(|refusal| refused(&refusal))?;
        let root =
            ExtendedKey::of_phrase(&phrase, passphrase).map_err(|refusal| refused(&refusal))?;
        self.0
            .compare(&root)
            .map(WalletCheck)
            .map_err(|refusal| refused(&refusal))
    }
}

#[wasm_bindgen]
impl WalletCheck {
    /// Whether the wallet matched.
    #[wasm_bindgen(getter)]
    pub fn matched(&self) -> bool {
        self.0.matched
    }

    /// What the matching key gives, as the evidence writes it; undefined where nothing matched.
    #[wasm_bindgen(getter)]
    pub fn derived(&self) -> Option<String> {
        self.0.derived.clone()
    }

    /// The path of the key, m for the master key.
    #[wasm_bindgen(getter)]
    pub fn path(&self) -> Option<String> {
        self.0.path.clone()
    }

    /// What the match is worth, for a fingerprint.
    #[wasm_bindgen(getter)]
    pub fn warning(&self) -> Option<String> {
        self.0.warning.map(str::to_owned)
    }
}

/// The ids of the coins this build holds.
#[wasm_bindgen(js_name = walletCoins)]
pub fn wallet_coins() -> Vec<String> {
    COINS.iter().map(|coin| coin.id.to_owned()).collect()
}

/// The wallet part's known answers: the startup cases, or with `full` every case.
#[wasm_bindgen(js_name = selfCheckWallet)]
pub fn self_check_wallet(full: bool) -> Result<(), JsValue> {
    self_check(Part::Wallet, full)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mnemocode::self_check::vectors::{PUBLIC_FINGERPRINT, PUBLIC_MNEMONIC};

    #[test]
    fn evidence_is_compared_with_a_phrase() {
        let evidence = WalletEvidence::master_fingerprint(PUBLIC_FINGERPRINT).unwrap();
        let check = evidence.check_text(PUBLIC_MNEMONIC, "").unwrap();
        assert!(check.matched());
        assert_eq!(check.path().as_deref(), Some("m"));
        assert!(check.warning().is_some());
        assert!(
            !evidence
                .check_text(PUBLIC_MNEMONIC, "TREZOR")
                .unwrap()
                .matched()
        );
        // Every build checks master keys, with or without Bitcoin.
        assert!(self_check_wallet(true).is_ok());
    }

    #[cfg(feature = "coin-bitcoin")]
    #[test]
    fn a_bitcoin_address_is_found_at_its_place() {
        let place = WalletPlace::new("mainnet", "legacy, native-segwit", 0.0, 0.0, 0.0, f64::NAN);
        let evidence = WalletEvidence::bitcoin_address(
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
            &place.unwrap(),
        )
        .unwrap();
        let check = evidence.check_text(PUBLIC_MNEMONIC, "").unwrap();
        assert_eq!(check.path().as_deref(), Some("m/84'/0'/0'/0/0"));
        assert!(wallet_coins().contains(&"bitcoin".to_owned()));
    }
}

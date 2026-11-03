//! The wallet part for a page (`browser-wallet`): the evidence of a wallet, each kind made by its
//! own constructor and refused as the library refuses it before any phrase is asked, compared with
//! a seed phrase; the coins of this build; and the part's self-check. Numbers cross as numbers, a
//! place's account, branch and index whole numbers from 0, and a count of addresses NaN for the
//! scan's default. An address names its coins, type and network itself, and a key's form its
//! Bitcoin address profiles. An entry that takes a secret, a WIF or a phrase and its passphrase,
//! takes its text as `JsValue`s that Rust reads (ARCHITECTURE.md §6).

use mnemocode::bip32::ExtendedKey;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::checks::Part;
use mnemocode::wallet::coins::{AddressLocation, COINS, Coin};
#[cfg(feature = "coin-bitcoin")]
use mnemocode::wallet::evidence::Place;
use mnemocode::wallet::evidence::{Evidence, KeyNetwork, WalletMatch};
use wasm_bindgen::prelude::*;

use crate::host::{after_secret, optional_text, refused, self_check, text, whole};

/// The evidence of a wallet, checked when it was made.
#[wasm_bindgen]
pub struct WalletEvidence(Evidence);

/// What a comparison found.
#[wasm_bindgen]
pub struct WalletCheck(WalletMatch);

/// Where a Bitcoin key is looked for: the network, the place of the first key and how many addresses
/// from it are compared, checked when it is made. A WIF, which is secret, takes these as numbers and
/// a name instead: no class crosses beside a secret.
#[cfg(feature = "coin-bitcoin")]
#[wasm_bindgen]
pub struct WalletPlace(Place);

#[cfg(feature = "coin-bitcoin")]
#[wasm_bindgen]
impl WalletPlace {
    /// The place on `network`, from `account`, `branch` and `index`, compared with `count`
    /// addresses (NaN: the scan's default).
    #[wasm_bindgen(constructor)]
    pub fn new(
        network_name: &str,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletPlace, JsValue> {
        let at = location(account, branch, index)?;
        place(network_name, at, count).map(WalletPlace)
    }

    /// Its network, by name.
    #[wasm_bindgen(getter)]
    pub fn network(&self) -> String {
        self.0.network.name().to_owned()
    }
}

/// The network `name` names.
fn network(name: &str) -> Result<KeyNetwork, JsValue> {
    KeyNetwork::named(name).map_err(|refusal| refused(&refusal))
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

/// The place that `network` and the location give.
#[cfg(feature = "coin-bitcoin")]
fn place(network_name: &str, at: AddressLocation, count: f64) -> Result<Place, JsValue> {
    Ok(Place {
        network: network(network_name)?,
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

    /// A master extended public key of `network`, which every coin shares.
    #[wasm_bindgen(js_name = masterKey)]
    pub fn master_key(text: &str, network_name: &str) -> Result<WalletEvidence, JsValue> {
        Evidence::master_key(text, network(network_name)?)
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// A Bitcoin address at `place`, under the address profile its type names.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = bitcoinAddress)]
    pub fn bitcoin_address(text: &str, place: &WalletPlace) -> Result<WalletEvidence, JsValue> {
        Evidence::bitcoin_address(text, place.0.clone())
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// A compressed public key at `place`, under every address profile.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = publicKey)]
    pub fn public_key(text: &str, place: &WalletPlace) -> Result<WalletEvidence, JsValue> {
        Evidence::public_key(text, place.0.clone())
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// The key of a WIF, a private key, under every address profile: only its public key is
    /// kept. The place crosses as a name and numbers, never as a `WalletPlace`: no class crosses
    /// beside a secret.
    #[cfg(feature = "coin-bitcoin")]
    pub fn wif(
        key: JsValue,
        network_name: JsValue,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletEvidence, JsValue> {
        after_secret(|| {
            let at = location(account, branch, index)?;
            let place = place(&crate::host::name(&network_name), at, count)?;
            Evidence::wif(&text(&key)?, place)
                .map(WalletEvidence)
                .map_err(|refusal| refused(&refusal))
        })
    }

    /// An account's extended public key at `account`, under the address profile its SLIP-132 form
    /// names, or every profile for an xpub or a tpub.
    #[cfg(feature = "coin-bitcoin")]
    #[wasm_bindgen(js_name = accountKey)]
    pub fn account_key(
        text: &str,
        network_name: &str,
        account: f64,
    ) -> Result<WalletEvidence, JsValue> {
        Evidence::account_key(text, network(network_name)?, whole(account))
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// An address at its place: of the coin named `coin`, or with `coin` empty, of every coin of
    /// this build whose form it has, each on its own paths.
    #[wasm_bindgen(js_name = coinAddress)]
    pub fn coin_address(
        coin: &str,
        text: &str,
        account: f64,
        branch: f64,
        index: f64,
        count: f64,
    ) -> Result<WalletEvidence, JsValue> {
        let coin = if coin.is_empty() {
            None
        } else {
            Some(Coin::named(coin).map_err(|refusal| refused(&refusal))?)
        };
        let at = location(account, branch, index)?;
        Evidence::address(coin, text, at, addresses(count))
            .map(WalletEvidence)
            .map_err(|refusal| refused(&refusal))
    }

    /// The ids of the coins an address was read as, in the order of [`walletCoins`]; empty for
    /// other evidence.
    #[wasm_bindgen(getter)]
    pub fn coins(&self) -> Vec<String> {
        self.0
            .coins()
            .iter()
            .map(|coin| coin.id.to_owned())
            .collect()
    }

    /// The searches of recovery compared with this wallet and its BIP39 `passphrase` (undefined:
    /// empty).
    #[cfg(feature = "browser-recovery")]
    pub fn recovery(&self, passphrase: JsValue) -> Result<crate::recovery::Recovery, JsValue> {
        after_secret(|| {
            let check = mnemocode::recovery::wallet_check::WalletCheck::new(
                self.0.clone(),
                &optional_text(&passphrase)?,
            );
            Ok(crate::recovery::Recovery::of(check))
        })
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
    use mnemocode::self_check::vectors::{PUBLIC_FINGERPRINT, PUBLIC_MASTER_XPUB, PUBLIC_MNEMONIC};

    #[test]
    fn the_binding_compares_a_fingerprint_and_a_master_key() {
        for evidence in [
            WalletEvidence::master_fingerprint(PUBLIC_FINGERPRINT).unwrap(),
            WalletEvidence::master_key(PUBLIC_MASTER_XPUB, "mainnet").unwrap(),
        ] {
            let check = evidence.check_text(PUBLIC_MNEMONIC, "").unwrap();
            assert!(check.matched());
            assert_eq!(check.path().as_deref(), Some("m"));
            assert!(
                !evidence
                    .check_text(PUBLIC_MNEMONIC, "TREZOR")
                    .unwrap()
                    .matched()
            );
        }
        let fingerprint = WalletEvidence::master_fingerprint(PUBLIC_FINGERPRINT).unwrap();
        assert!(
            fingerprint
                .check_text(PUBLIC_MNEMONIC, "")
                .unwrap()
                .warning()
                .is_some()
        );
        // Every build checks both, with or without Bitcoin, in its self-check.
        assert!(self_check_wallet(true).is_ok());
    }

    #[cfg(feature = "coin-bitcoin")]
    #[test]
    fn a_bitcoin_address_is_found_at_its_place() {
        let place = WalletPlace::new("mainnet", 0.0, 0.0, 0.0, f64::NAN);
        let evidence = WalletEvidence::bitcoin_address(
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
            &place.unwrap(),
        )
        .unwrap();
        let check = evidence.check_text(PUBLIC_MNEMONIC, "").unwrap();
        assert_eq!(check.path().as_deref(), Some("m/84'/0'/0'/0/0"));
        assert!(wallet_coins().contains(&"bitcoin".to_owned()));
        let any = WalletEvidence::coin_address(
            "",
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
            0.0,
            0.0,
            0.0,
            f64::NAN,
        )
        .unwrap();
        assert_eq!(any.coins().first().map(String::as_str), Some("bitcoin"));
        let check = any.check_text(PUBLIC_MNEMONIC, "").unwrap();
        assert_eq!(check.path().as_deref(), Some("m/44'/0'/0'/0/0"));
    }
}

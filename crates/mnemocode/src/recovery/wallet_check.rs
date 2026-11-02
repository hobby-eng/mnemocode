//! The wallet a search compares each checksum-valid phrase with (MnemoCode TS 0.1.0's
//! `core/wallet-check.ts` and `walletCheckOf` of `bitcoin-evidence.ts`): the evidence the person
//! gave and the wallet's BIP39 passphrase, which every search, the page's and the command line's
//! alike, takes through the same path.

use crate::bip32::ExtendedKey;
use crate::bip39::phrase::Phrase;
use crate::secret::SecretText;
use crate::wallet::evidence::{Evidence, EvidenceError, WalletMatch};

/// The wallet the person named: its evidence, and the BIP39 passphrase it is compared under.
#[derive(Debug)]
pub struct WalletCheck {
    evidence: Evidence,
    passphrase: SecretText,
}

impl WalletCheck {
    /// The wallet of `evidence` under `passphrase`, "" for none.
    pub fn new(evidence: Evidence, passphrase: &str) -> Self {
        Self {
            evidence,
            passphrase: SecretText::copy_of("a BIP39 passphrase", passphrase),
        }
    }

    /// The evidence compared with.
    pub const fn evidence(&self) -> &Evidence {
        &self.evidence
    }

    /// What the wallet says of `phrase`.
    pub fn check(&self, phrase: &Phrase) -> Result<WalletMatch, EvidenceError> {
        let root = ExtendedKey::of_phrase(phrase, &self.passphrase)?;
        self.evidence.compare(&root)
    }
}

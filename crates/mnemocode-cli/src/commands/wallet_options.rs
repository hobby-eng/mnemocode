//! The wallet that the options give (MnemoCode TS 0.1.0's `cli/bitcoin-options.ts`,
//! CAP-WALLET-EVIDENCE-OPTIONS, CAP-WALLET-BIP39-PASSPHRASE-INPUT): one kind of evidence and where
//! in the wallet it sits, read and checked before any secret is used, with the BIP39 passphrase.

use std::fmt;
use std::path::Path;
use std::rc::Rc;

use mnemocode::backup::re_encoding::MatchedBy;
use mnemocode::recovery::wallet_check::WalletCheck;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretText;
use mnemocode::text::space::without_byte_order_mark;
use mnemocode::text::words::list_in_words;
use mnemocode::wallet::coins::{AddressLocation, Coin};
use mnemocode::wallet::evidence::{Evidence, KeyNetwork, Place};
use mnemocode::wallet::scan::{ADDRESS_COUNT_RANGE, NORMAL_INDEX_RANGE, default_address_count};

use super::given::PATH_LIMIT;
use crate::args::{Parsed, integer_option, is_on, option_label, value};
use crate::gate::Stop;
use crate::input::{check_readable, read_input_path};

/// What a refusal of the WIF file names it by.
const WIF_FILE: &str = "The WIF file";
/// What a refusal of the file of the BIP39 passphrase names it by.
const PASSPHRASE_FILE: &str = "The BIP39 passphrase file";
/// A compressed WIF of 52 characters, with a byte order mark and a line break.
const WIF_LIMIT: usize = 64;

/// The option of each kind of evidence; a WIF is read from the file it names.
const EVIDENCE_OPTIONS: [&str; 7] = [
    "bitcoin-address",
    "coin-address",
    "master-xpub",
    "account-xpub",
    "compressed-public-key",
    "master-fingerprint",
    "wif-file",
];
/// The evidence compared with several addresses in a row.
const SCANNED_OPTIONS: [&str; 4] = [
    "bitcoin-address",
    "coin-address",
    "compressed-public-key",
    "wif-file",
];
/// What an account key, which its account places, refuses.
const ADDRESS_PLACE_OPTIONS: [&str; 2] = ["branch", "index"];
/// What a master key, which has no place, refuses.
const ACCOUNT_PLACE_OPTIONS: [&str; 3] = ["account", "branch", "index"];
/// What says where a wallet given with an option is looked for.
const WALLET_PLACE_OPTIONS: [&str; 4] = ["network", "account", "branch", "index"];
/// What only Bitcoin evidence takes: the address of a coin tells its own network.
const BITCOIN_ONLY_OPTIONS: [&str; 1] = ["network"];
/// The options that name a wallet, which decode takes only on the private screen.
pub(crate) const WALLET_EVIDENCE_OPTIONS: [&str; 14] = [
    "bitcoin-address",
    "coin-address",
    "master-xpub",
    "account-xpub",
    "compressed-public-key",
    "master-fingerprint",
    "wif-file",
    "coin",
    "network",
    "account",
    "branch",
    "index",
    "scan-gap",
    "bip39-passphrase-file",
];

/// Whether an option gives the wallet's evidence, before it is read and checked.
pub(crate) fn wallet_option_given(parsed: &Parsed) -> bool {
    WALLET_EVIDENCE_OPTIONS[..7]
        .iter()
        .any(|key| value(parsed, key).is_some())
}

/// The refusals of the wallet's options, word for word as TS 0.1.0 writes them.
#[derive(Debug)]
enum WalletOptionError {
    /// A network that is none.
    Network,
    /// --coin without --coin-address.
    CoinWithoutAddress,
    /// More than one kind of evidence.
    NotOne,
    /// --scan-gap beside evidence of one key.
    ScanGapKind,
    /// A Bitcoin option beside a coin's address.
    BitcoinOnly(&'static str),
    /// A place beside a master key.
    MasterPlace(&'static str),
    /// A branch or an index beside an account key.
    AccountPlace(&'static str),
    /// --scan-gap with nothing to scan.
    ScanGapUnused,
    /// A place of no wallet; whether one is asked on the screen.
    PlaceUnused(&'static str, bool),
}

impl fmt::Display for WalletOptionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Network => f.write_str("The Bitcoin network must be mainnet or testnet."),
            Self::CoinWithoutAddress => f.write_str("--coin names the coin of --coin-address."),
            Self::NotOne => f.write_str("Select exactly one recovery-evidence option."),
            Self::ScanGapKind => f.write_str(
                "--scan-gap applies to an address, a compressed public key or a WIF, one of several in a row.",
            ),
            Self::BitcoinOnly(key) => write!(
                f,
                "--{key} is for Bitcoin evidence; the coin's address tells its own."
            ),
            Self::MasterPlace(key) => write!(
                f,
                "--{key} places an address, a key or a WIF; a master key has no place."
            ),
            Self::AccountPlace(key) => write!(
                f,
                "--{key} places an address, a key or a WIF in its account; an account key has no branch or index."
            ),
            Self::ScanGapUnused => f.write_str(
                "--scan-gap applies to an address given with an option, or asked on the screen with --ask-secrets.",
            ),
            Self::PlaceUnused(key, asked) => write!(
                f,
                "--{key} applies to a wallet given as an option, such as --bitcoin-address{}.",
                if *asked {
                    "; the wallet asked on the screen is looked for among its first receiving addresses, on the network its address names"
                } else {
                    ""
                }
            ),
        }
    }
}

impl std::error::Error for WalletOptionError {}

impl Refusal for WalletOptionError {
    fn code(&self) -> &'static str {
        match self {
            Self::Network => "cli.bitcoin-options.bitcoin-network",
            Self::CoinWithoutAddress => "cli.bitcoin-options.coin-names-coin-coin-address",
            Self::NotOne => "cli.bitcoin-options.select-exactly-one-recovery-evidence-option",
            Self::ScanGapKind => {
                "cli.bitcoin-options.scan-gap-applies-address-compressed-public-key-wif"
            }
            Self::BitcoinOnly(_) => "cli.bitcoin-options.bitcoin-evidence-coin-s-address-tells-own",
            Self::MasterPlace(_) => {
                "cli.bitcoin-options.places-address-key-wif-master-key-no-place"
            }
            Self::AccountPlace(_) => "cli.bitcoin-options.account-key-no-branch-or-index",
            Self::ScanGapUnused => {
                "cli.bitcoin-options.scan-gap-applies-address-given-option-asked-on"
            }
            Self::PlaceUnused(..) => {
                "cli.bitcoin-options.applies-wallet-given-as-option-such-as-bitcoin"
            }
        }
    }
}

/// Evidence of a wallet, with what a report names it by.
#[derive(Debug)]
pub(crate) struct AskedEvidence {
    pub(crate) evidence: Evidence,
    pub(crate) label: String,
    pub(crate) fingerprint: bool,
    /// The options that give the same evidence, for the command that the menu builds.
    pub(crate) options: Vec<String>,
}

/// The wallet of one command: the check of a phrase against what the options give or a question
/// told, with the BIP39 passphrase; what a report names it by; and where another is looked for.
#[derive(Debug)]
pub(crate) struct GivenWallet {
    /// The check, none without a wallet.
    pub(crate) check: Option<Rc<WalletCheck>>,
    /// The evidence as a sentence names it: "master fingerprint".
    pub(crate) label: Option<String>,
    /// Whether it is a master fingerprint, whose match a terminal says in words.
    pub(crate) fingerprint: bool,
    /// What its match is of, for the line that says how a phrase was confirmed.
    matched_by: MatchedBy,
    /// Where a wallet asked on the screen is looked for.
    pub(crate) place: Place,
    /// Whether a BIP39 passphrase was given.
    pub(crate) with_passphrase: bool,
    passphrase: SecretText,
}

impl GivenWallet {
    /// This wallet compared with `asked` from now on, none with no wallet.
    pub(crate) fn set_evidence(&mut self, asked: Option<AskedEvidence>) {
        let Some(asked) = asked else {
            self.check = None;
            self.label = None;
            self.fingerprint = false;
            return;
        };
        let check = WalletCheck::new(asked.evidence, self.passphrase.as_str());
        self.check = Some(Rc::new(check));
        self.label = Some(asked.label);
        self.fingerprint = asked.fingerprint;
        self.matched_by = if asked.fingerprint {
            MatchedBy::Fingerprint
        } else {
            MatchedBy::Address
        };
    }

    /// What the wallet's match is of.
    pub(crate) const fn matched_by(&self) -> MatchedBy {
        self.matched_by
    }

    /// The BIP39 passphrase, empty for none.
    pub(crate) fn passphrase(&self) -> &str {
        self.passphrase.as_str()
    }
}

/// What a report names an address by: "address of Bitcoin or Bitcoin Cash", the coins it was read
/// as.
pub(crate) fn address_label(evidence: &Evidence) -> String {
    let names: Vec<&str> = evidence.coins().iter().map(|coin| coin.name).collect();
    format!("address of {}", list_in_words(&names, "or"))
}

/// The first of `keys` given, as the program spells it.
fn given_of(parsed: &Parsed, keys: &[&'static str]) -> Option<&'static str> {
    keys.iter()
        .find(|key| value(parsed, key).is_some())
        .copied()
}

/// The network of --network, mainnet by default.
fn network_of(parsed: &Parsed) -> Result<KeyNetwork, WalletOptionError> {
    value(parsed, "network").map_or(Ok(KeyNetwork::Mainnet), |name| {
        KeyNetwork::named(name).map_err(|_| WalletOptionError::Network)
    })
}

/// The account, branch and index of an address or a key; each defaults to 0.
fn location_of(parsed: &Parsed) -> Result<AddressLocation, Stop> {
    let part = |key: &str, label: &str| {
        integer_option(parsed, key, NORMAL_INDEX_RANGE, Some(0), Some(label))
    };
    Ok(AddressLocation::new(
        part("account", "--account address account")?,
        part("branch", "--branch address branch")?,
        part("index", "--index first address index")?,
    )?)
}

/// How many addresses --scan-gap compares; the scan's default without it.
fn scan_gap_of(parsed: &Parsed) -> Result<Option<u64>, Stop> {
    if value(parsed, "scan-gap").is_none() {
        return Ok(None);
    }
    Ok(Some(integer_option(
        parsed,
        "scan-gap",
        ADDRESS_COUNT_RANGE,
        None,
        None,
    )?))
}

/// The first receiving address of the first account on mainnet.
fn first_receiving(addresses: Option<u64>) -> Place {
    Place {
        network: KeyNetwork::Mainnet,
        location: AddressLocation {
            account: 0,
            branch: 0,
            index: 0,
        },
        addresses,
    }
}

/// Where another wallet is looked for after the one of `option`: on its network, and for an address
/// or a key at its place and among as many addresses.
fn place_of(parsed: &Parsed, option: &str) -> Result<Place, Stop> {
    let mut place = first_receiving(scan_gap_of(parsed)?);
    match option {
        "master-fingerprint" | "master-xpub" => place.network = network_of(parsed)?,
        "coin-address" => place.location = location_of(parsed)?,
        _ => {
            place.network = network_of(parsed)?;
            place.location = location_of(parsed)?;
        }
    }
    Ok(place)
}

/// What the reading of the wallet's options does with the secret files they name.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SecretFiles {
    /// Reads them.
    Read,
    /// Only looks at them, for a command that reads them after its first questions.
    Look,
}

/// The evidence of `option`, given as `text`, or none for a WIF file only looked at. An address, a
/// public key or a WIF is compared with the first 20 addresses from --index on, or as many as
/// --scan-gap says.
fn evidence_of(
    parsed: &Parsed,
    option: &str,
    text: &str,
    files: SecretFiles,
) -> Result<Option<Evidence>, Stop> {
    let counted = scan_gap_of(parsed)?;
    if counted.is_some() && !SCANNED_OPTIONS.contains(&option) {
        return Err(WalletOptionError::ScanGapKind.into());
    }
    let location = location_of(parsed)?;
    let counted = counted.or(Some(u64::from(default_address_count(location.index))));
    if option == "coin-address" {
        if let Some(key) = given_of(parsed, &BITCOIN_ONLY_OPTIONS) {
            return Err(WalletOptionError::BitcoinOnly(key).into());
        }
        let coin = value(parsed, "coin").map(Coin::named).transpose()?;
        return Ok(Some(Evidence::address(coin, text, location, counted)?));
    }
    let wif_path = (option == "wif-file").then(|| Path::new(text));
    if let (Some(path), SecretFiles::Look) = (wif_path, files) {
        check_readable(path, WIF_FILE)?;
    }
    // A file may begin with a byte order mark besides.
    let wif_file = wif_path
        .filter(|_| files == SecretFiles::Read)
        .map(|path| read_input_path(path, WIF_FILE, WIF_LIMIT, false))
        .transpose()?;
    let text = wif_file
        .as_ref()
        .map_or(text, |file| without_byte_order_mark(file.as_str()));
    if option == "master-fingerprint" || option == "master-xpub" {
        let network = network_of(parsed)?;
        if let Some(key) = given_of(parsed, &ACCOUNT_PLACE_OPTIONS) {
            return Err(WalletOptionError::MasterPlace(key).into());
        }
        return Ok(Some(if option == "master-xpub" {
            Evidence::master_key(text, network)?
        } else {
            Evidence::master_fingerprint(text)?
        }));
    }
    if option == "account-xpub" {
        let network = network_of(parsed)?;
        if let Some(key) = given_of(parsed, &ADDRESS_PLACE_OPTIONS) {
            return Err(WalletOptionError::AccountPlace(key).into());
        }
        return Ok(Some(Evidence::account_key(
            text,
            network,
            u64::from(location.account),
        )?));
    }
    let place = Place {
        network: network_of(parsed)?,
        location,
        addresses: counted,
    };
    Ok(match option {
        "bitcoin-address" => Some(Evidence::bitcoin_address(text, place)?),
        "compressed-public-key" => Some(Evidence::public_key(text, place)?),
        _ if files == SecretFiles::Look => None,
        _ => Some(Evidence::wif(text, place)?),
    })
}

/// The text of --bip39-passphrase-file, without one line break at its end; empty without it, and
/// for a file only looked at.
fn passphrase_of(parsed: &Parsed, files: SecretFiles) -> Result<SecretText, Stop> {
    let Some(path) = value(parsed, "bip39-passphrase-file") else {
        return Ok(SecretText::copy_of("no passphrase", ""));
    };
    if files == SecretFiles::Look {
        check_readable(Path::new(path), PASSPHRASE_FILE)?;
        return Ok(SecretText::copy_of("no passphrase", ""));
    }
    let file = read_input_path(Path::new(path), PASSPHRASE_FILE, PATH_LIMIT, false)?;
    let text = file.as_str();
    let line = text
        .strip_suffix('\n')
        .map_or(text, |line| line.strip_suffix('\r').unwrap_or(line));
    Ok(SecretText::copy_of("a BIP39 passphrase", line))
}

/// Every option of the wallet, read and checked in one order for every command that compares
/// phrases with one: the evidence, options that place a wallet that no option gives, and the BIP39
/// passphrase.
pub(crate) fn given_wallet(parsed: &Parsed) -> Result<GivenWallet, Stop> {
    wallet_of(parsed, SecretFiles::Read)
}

/// The checks of [`given_wallet`], for a command that asks questions before it reads a secret: the
/// secret files named are only looked at.
pub(crate) fn check_given_wallet(parsed: &Parsed) -> Result<(), Stop> {
    wallet_of(parsed, SecretFiles::Look).map(|_| ())
}

/// Whether an option names the wallet's evidence.
pub(crate) fn wallet_evidence_given(parsed: &Parsed) -> bool {
    EVIDENCE_OPTIONS
        .iter()
        .any(|option| value(parsed, option).is_some())
}

/// The wallet that the options give, the secret files treated as `files` says.
fn wallet_of(parsed: &Parsed, files: SecretFiles) -> Result<GivenWallet, Stop> {
    let supplied: Vec<(&str, &str)> = EVIDENCE_OPTIONS
        .iter()
        .filter_map(|option| value(parsed, option).map(|text| (*option, text)))
        .collect();
    if value(parsed, "coin").is_some() && value(parsed, "coin-address").is_none() {
        return Err(WalletOptionError::CoinWithoutAddress.into());
    }
    if supplied.len() > 1 {
        return Err(WalletOptionError::NotOne.into());
    }
    let asked = is_on(parsed, "ask-secrets");
    let Some(&(option, text)) = supplied.first() else {
        if let Some(key) = given_of(parsed, &WALLET_PLACE_OPTIONS) {
            return Err(WalletOptionError::PlaceUnused(key, asked).into());
        }
        let addresses = scan_gap_of(parsed)?;
        if addresses.is_some() && !asked {
            return Err(WalletOptionError::ScanGapUnused.into());
        }
        let passphrase = passphrase_of(parsed, files)?;
        return Ok(GivenWallet {
            check: None,
            label: None,
            fingerprint: false,
            matched_by: MatchedBy::Address,
            place: first_receiving(addresses),
            with_passphrase: !passphrase.is_empty(),
            passphrase,
        });
    };
    let evidence = evidence_of(parsed, option, text, files)?;
    let label = match option {
        "bitcoin-address" => option_label("address").to_owned(),
        "wif-file" => "WIF".to_owned(),
        "coin-address" => evidence.as_ref().map(address_label).unwrap_or_default(),
        kind => option_label(kind).to_owned(),
    };
    let place = place_of(parsed, option)?;
    let passphrase = passphrase_of(parsed, files)?;
    Ok(GivenWallet {
        check: evidence.map(|evidence| Rc::new(WalletCheck::new(evidence, passphrase.as_str()))),
        label: Some(label),
        fingerprint: option == "master-fingerprint",
        matched_by: match option {
            "master-fingerprint" => MatchedBy::Fingerprint,
            "bitcoin-address" | "coin-address" => MatchedBy::Address,
            _ => MatchedBy::Key,
        },
        place,
        with_passphrase: !passphrase.is_empty(),
        passphrase,
    })
}

#[cfg(test)]
mod tests {
    use mnemocode::bip39::phrase::Phrase;
    use mnemocode::self_check::vectors::PUBLIC_MNEMONIC;

    use super::*;
    use crate::args::parse_arguments;

    /// The public phrase's first legacy Bitcoin address, which Bitcoin Cash writes alike.
    const LEGACY: &str = "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA";

    fn parsed(arguments: &[&str]) -> Parsed {
        let arguments: Vec<String> = arguments.iter().map(|item| (*item).to_owned()).collect();
        parse_arguments(&arguments).unwrap()
    }

    #[test]
    fn an_address_without_a_coin_is_read_as_every_coin_of_its_form() {
        let wallet = given_wallet(&parsed(&["--coin-address", LEGACY])).unwrap();
        assert_eq!(
            wallet.label.as_deref(),
            Some("address of Bitcoin or Bitcoin Cash")
        );
        let phrase = Phrase::parse(PUBLIC_MNEMONIC).unwrap();
        let found = wallet.check.unwrap().check(&phrase).unwrap();
        assert_eq!(found.path.as_deref(), Some("m/44'/0'/0'/0/0"));
        let narrowed = given_wallet(&parsed(&[
            "--coin-address",
            LEGACY,
            "--coin",
            "bitcoin-cash",
        ]))
        .unwrap();
        assert_eq!(narrowed.label.as_deref(), Some("address of Bitcoin Cash"));
        let refused = given_wallet(&parsed(&["--coin-address", LEGACY, "--network", "testnet"]));
        assert_eq!(
            refused.unwrap_err().message(),
            "--network is for Bitcoin evidence; the coin's address tells its own."
        );
    }
}

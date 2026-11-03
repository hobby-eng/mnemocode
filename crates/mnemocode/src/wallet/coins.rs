//! The coins whose addresses a wallet check reads (MnemoCode TS 0.1.0's `core/coins/coin.ts`,
//! CAP-WALLET-COIN-REGISTRY): each a static entry in its own module behind its feature `coin-<id>`
//! (ADR 0002), listed once in [`COINS`]. A coin reads an address into its type and the commitment
//! it holds, a HASH160, a Keccak account or a Taproot key, and says the BIP32 paths of its keys;
//! an address is a key's when the key's commitment of that type is the address's.

pub mod encodings;

#[cfg(feature = "coin-bitcoin")]
pub mod bitcoin;
#[cfg(feature = "coin-bitcoin-cash")]
pub mod bitcoin_cash;
#[cfg(feature = "coin-cosmos")]
pub mod cosmos;
#[cfg(feature = "coin-dash")]
pub mod dash;
#[cfg(feature = "coin-dogecoin")]
pub mod dogecoin;
#[cfg(feature = "coin-ethereum")]
pub mod ethereum;
#[cfg(feature = "coin-ethereum-classic")]
pub mod ethereum_classic;
#[cfg(feature = "coin-injective")]
pub mod injective;
#[cfg(feature = "coin-litecoin")]
pub mod litecoin;
#[cfg(feature = "coin-tron")]
pub mod tron;
#[cfg(feature = "coin-xrp")]
pub mod xrp;
#[cfg(feature = "coin-zcash")]
pub mod zcash;

use std::fmt;

use crate::bip32::{HARDENED_OFFSET, LAST_NORMAL_INDEX};
use crate::refusal::Refusal;
use crate::text::numbers::{WholeRange, integer_refusal};
use crate::text::space::trim;
use encodings::{
    Alphabet, BECH32_ALPHABET, CASHADDR_CHECKSUM_GROUPS, HASH160_BYTES, bytes_of_groups,
    cashaddr_polymod, checked_data, decode_bech32, decode_segwit, hash160, keccak_account,
    nested_segwit_hash, taproot_output_key, written_as_an_address,
};

/// Every coin of this build, in the order of the help and of a page's list.
pub static COINS: &[&Coin] = &[
    #[cfg(feature = "coin-bitcoin")]
    &bitcoin::COIN,
    #[cfg(feature = "coin-bitcoin-cash")]
    &bitcoin_cash::COIN,
    #[cfg(feature = "coin-cosmos")]
    &cosmos::COIN,
    #[cfg(feature = "coin-dash")]
    &dash::COIN,
    #[cfg(feature = "coin-dogecoin")]
    &dogecoin::COIN,
    #[cfg(feature = "coin-ethereum")]
    &ethereum::COIN,
    #[cfg(feature = "coin-ethereum-classic")]
    &ethereum_classic::COIN,
    #[cfg(feature = "coin-injective")]
    &injective::COIN,
    #[cfg(feature = "coin-litecoin")]
    &litecoin::COIN,
    #[cfg(feature = "coin-tron")]
    &tron::COIN,
    #[cfg(feature = "coin-xrp")]
    &xrp::COIN,
    #[cfg(feature = "coin-zcash")]
    &zcash::COIN,
];

/// The coin type of every testnet (SLIP-44).
const TESTNET_COIN_TYPE: u32 = 1;
/// BIP44's purpose, for every type but those of [`AddressType::purpose`].
const BIP44_PURPOSE: u32 = 44;
/// DIP-17's feature index of Dash Platform payment keys.
const DIP17_FEATURE: u32 = 17;
/// What a P2WPKH address has after its prefix and separator.
const P2WPKH_CHARACTERS_AFTER_PREFIX: usize = 40;
/// The bytes of a Taproot key.
const X_ONLY_KEY_BYTES: usize = 32;
/// The Bitcoin P2SH version, which Bitcoin Cash's legacy addresses share.
const P2SH_VERSION: u8 = 0x05;
/// Dash Platform's types of payment: a key's hash, and Orchard, which is shielded.
const PLATFORM_P2PKH: u8 = 0xb0;
const PLATFORM_ORCHARD: u8 = 0x10;
/// The prefixes of shielded Zcash addresses.
const ZCASH_SHIELDED: [&str; 6] = ["zs1", "ztestsapling1", "u1", "utest1", "zc", "zt"];
/// The prefix of a CashAddr.
const CASHADDR_PREFIX: &str = "bitcoincash";

/// The refusals of the coins, word for word as TS 0.1.0 writes them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoinError {
    /// A checksum or format that does not read.
    Damaged,
    /// Capital and small letters mixed where the form allows none; the form.
    MixedCase(&'static str),
    /// A length no address of the type has.
    WrongLength,
    /// Another coin's address: the coin's name and its forms.
    NotThisCoin(&'static str, &'static str),
    /// No single key's address: the forms that can be checked.
    NotSingleKey(String),
    /// A shielded address: what to use instead.
    Shielded(&'static str),
    /// A part of an address's place outside BIP32's normal indexes: the refusal.
    Location(String),
    /// A coin this build has not: the coins it has.
    UnknownCoin(String),
    /// No 40 hexadecimal digits after 0x.
    #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
    NotHexAccount,
    /// A wrong EIP-55 checksum.
    #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
    WrongEip55,
    /// A key BIP341's tweak gives no output key for.
    NoTaprootKey,
    /// An address that no coin of this build reads, with no reason of a coin whose form it has.
    NoCoin,
}

impl CoinError {
    /// Whether it says only that an address is not of the coin's form, or does not read, and nothing
    /// of what is wrong with it: a reading as every coin keeps the reason of a coin whose form the
    /// address has instead.
    const fn says_another_form(&self) -> bool {
        matches!(self, Self::Damaged | Self::NotThisCoin(..))
    }
}

/// A refusal of an address, after what it is about.
fn address_refusal(f: &mut fmt::Formatter<'_>, reason: &str) -> fmt::Result {
    write!(f, "The address cannot be used for the check: {reason}.")
}

impl fmt::Display for CoinError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Damaged => address_refusal(f, "its checksum or format is wrong"),
            Self::MixedCase(form) => address_refusal(
                f,
                &format!("it mixes capital and small letters, which {form} does not allow"),
            ),
            Self::WrongLength => address_refusal(f, "it has the wrong length"),
            Self::NotThisCoin(name, forms) => {
                address_refusal(f, &format!("it is not an address of {name} ({forms})"))
            }
            Self::NotSingleKey(forms) => address_refusal(
                f,
                &format!("it is not the address of a single key; only {forms} can be checked"),
            ),
            Self::Shielded(instead) => address_refusal(
                f,
                &format!("it is shielded; use {instead} address of the same wallet"),
            ),
            Self::Location(message) => f.write_str(message),
            Self::UnknownCoin(coins) => write!(f, "Unknown coin; the coins are {coins}."),
            #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
            Self::NotHexAccount => address_refusal(
                f,
                &format!(
                    "it is not {} hexadecimal digits after 0x",
                    2 * HASH160_BYTES
                ),
            ),
            #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
            Self::WrongEip55 => address_refusal(
                f,
                "its EIP-55 checksum, the mix of capital and small letters, is wrong",
            ),
            Self::NoTaprootKey => f.write_str("BIP341 gives no Taproot output key for this key."),
            Self::NoCoin => address_refusal(
                f,
                "its checksum or format is wrong, or it is no address of a coin the check knows",
            ),
        }
    }
}

impl std::error::Error for CoinError {}

impl Refusal for CoinError {
    fn code(&self) -> &'static str {
        match self {
            Self::Damaged => "core.coins.coin.address-damaged",
            Self::MixedCase(_) => "core.coins.coin.address-mixed-case",
            Self::WrongLength => "core.coins.coin.address-wrong-length",
            Self::NotThisCoin(..) => "core.coins.coin.address-not-this-coin",
            Self::NotSingleKey(_) => "core.coins.coin.address-not-single-key",
            Self::Shielded(_) => "core.coins.coin.address-shielded",
            Self::Location(_) => "core.coins.coin.assert-address-location-refused",
            Self::UnknownCoin(_) => "core.coins.coin.unknown-coin-coins",
            #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
            Self::NotHexAccount => "core.coins.ethereum.address-not-hex-account",
            #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
            Self::WrongEip55 => "core.coins.ethereum.address-wrong-eip55-checksum",
            Self::NoTaprootKey => "core.coins.taproot.bip341-gives-no-taproot-output-key-key",
            Self::NoCoin => "core.coins.coin.address-of-no-coin",
        }
    }
}

/// What an address commits to, by the kind of key it pays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AddressType {
    /// HASH160 of the key.
    P2pkh,
    /// HASH160 of a P2WPKH script inside P2SH (BIP49).
    P2shP2wpkh,
    /// HASH160 of the key, native SegWit (BIP84).
    P2wpkh,
    /// BIP341's output key (BIP86).
    P2tr,
    /// The last 20 bytes of Keccak-256 of the key's point.
    Keccak,
    /// Dash Platform's payment key hash (DIP-17).
    DashPlatform,
}

impl AddressType {
    /// The BIP32 purpose of its keys.
    pub const fn purpose(self) -> u32 {
        match self {
            Self::P2shP2wpkh => 49,
            Self::P2wpkh => 84,
            Self::P2tr => 86,
            Self::DashPlatform => 9,
            Self::P2pkh | Self::Keccak => BIP44_PURPOSE,
        }
    }

    /// What `public_key`, compressed, commits to in an address of this type.
    pub fn commitment(self, public_key: &[u8]) -> Result<Vec<u8>, CoinError> {
        match self {
            Self::P2shP2wpkh => Ok(nested_segwit_hash(public_key)),
            Self::P2tr => taproot_output_key(public_key).ok_or(CoinError::NoTaprootKey),
            // A key the derivation gave is a point; no other reaches here, and none matches.
            Self::Keccak => Ok(keccak_account(public_key).unwrap_or_default()),
            Self::P2pkh | Self::P2wpkh | Self::DashPlatform => Ok(hash160(public_key).to_vec()),
        }
    }
}

/// A Base58Check version of a coin: its first bytes, the type it gives and whether it is a
/// testnet's.
#[derive(Debug)]
pub struct Version {
    /// The first bytes.
    pub prefix: &'static [u8],
    /// The type.
    pub kind: AddressType,
    /// Whether it is a testnet's.
    pub testnet: bool,
}

/// How a coin reads its addresses.
#[derive(Debug)]
pub enum Reader {
    /// Base58Check in `alphabet`, each of `versions`.
    Base58 {
        /// The versions.
        versions: &'static [Version],
        /// The alphabet.
        alphabet: Alphabet,
    },
    /// Base58Check, or SegWit where an address begins with a prefix of `prefixes` (the mainnet's,
    /// then a testnet's).
    Segwit {
        /// The Base58Check versions.
        versions: &'static [Version],
        /// The Bech32 prefixes.
        prefixes: (&'static str, Option<&'static str>),
        /// Whether Taproot addresses are the coin's.
        taproot: bool,
    },
    /// Zcash's transparent Base58Check addresses; a shielded one is refused.
    Zcash {
        /// The versions.
        versions: &'static [Version],
    },
    /// Base58Check, or a Dash Platform payment address (Bech32m `dash1k…`, `tdash1k…`).
    Dash {
        /// The versions.
        versions: &'static [Version],
    },
    /// Base58Check legacy addresses, or CashAddr.
    CashAddr {
        /// The versions.
        versions: &'static [Version],
    },
    /// An account in 40 hexadecimal digits after 0x, with or without EIP-55.
    #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
    Hex,
    /// A Bech32 account of 20 bytes under `prefix`, of `kind`.
    Bech32Account {
        /// The prefix.
        prefix: &'static str,
        /// The type.
        kind: AddressType,
    },
}

/// A coin of the registry.
#[derive(Debug)]
pub struct Coin {
    /// Its identifier, such as `bitcoin-cash`.
    pub id: &'static str,
    /// Its name, such as "Bitcoin Cash".
    pub name: &'static str,
    /// The forms of its addresses, as messages name them.
    pub address_forms: &'static str,
    /// The forms of its testnet's addresses, where they differ.
    pub testnet_forms: Option<&'static str>,
    /// Its SLIP-44 coin types, the usual one first.
    pub coin_types: &'static [u32],
    /// How it reads its addresses.
    pub reader: Reader,
}

/// Where an address's key stands below its coin type: the account, the branch (0 receiving, 1
/// change) and the index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AddressLocation {
    /// The account.
    pub account: u32,
    /// The branch.
    pub branch: u32,
    /// The index.
    pub index: u32,
}

impl AddressLocation {
    /// The location, each part refused outside BIP32's normal indexes.
    pub fn new(account: u64, branch: u64, index: u64) -> Result<Self, CoinError> {
        let range = WholeRange::new(0, u64::from(LAST_NORMAL_INDEX));
        let part = |name: &str, value: u64| {
            u32::try_from(value)
                .ok()
                .filter(|value| *value <= LAST_NORMAL_INDEX)
                .ok_or_else(|| CoinError::Location(integer_refusal(name, range, None)))
        };
        Ok(Self {
            account: part("account", account)?,
            branch: part("branch", branch)?,
            index: part("index", index)?,
        })
    }
}

/// A BIP32 path: its indexes, hardened from 2^31 up, written `m/44'/0'/0'/0`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyPath(pub Vec<u32>);

impl fmt::Display for KeyPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("m")?;
        for &index in &self.0 {
            if index >= HARDENED_OFFSET {
                write!(f, "/{}'", index - HARDENED_OFFSET)?;
            } else {
                write!(f, "/{index}")?;
            }
        }
        Ok(())
    }
}

/// `index` hardened.
const fn hardened(index: u32) -> u32 {
    index | HARDENED_OFFSET
}

/// Whether `text` begins, in lower case, with one of `prefixes`.
fn starts_with_any(text: &str, prefixes: &[String]) -> bool {
    let lower = text.to_ascii_lowercase();
    prefixes
        .iter()
        .any(|prefix| lower.starts_with(prefix.as_str()))
}

impl Coin {
    /// The coin `id` names, in any case and spacing; refused where this build has none.
    pub fn named(id: &str) -> Result<&'static Self, CoinError> {
        let wanted = trim(id).to_ascii_lowercase();
        COINS
            .iter()
            .copied()
            .find(|coin| coin.id == wanted)
            .ok_or_else(|| {
                CoinError::UnknownCoin(
                    COINS
                        .iter()
                        .map(|coin| coin.id)
                        .collect::<Vec<_>>()
                        .join(", "),
                )
            })
    }

    /// The forms of its addresses on a testnet or its main network.
    pub fn address_forms_on(&self, testnet: bool) -> &'static str {
        if testnet {
            self.testnet_forms.unwrap_or(self.address_forms)
        } else {
            self.address_forms
        }
    }

    /// The path of the account `account` of keys of `kind` under `coin_type`.
    pub fn account_path(&self, kind: AddressType, coin_type: u32, account: u32) -> KeyPath {
        let mut path = vec![hardened(kind.purpose()), hardened(coin_type)];
        if kind == AddressType::DashPlatform {
            path.push(hardened(DIP17_FEATURE));
        }
        path.push(hardened(account));
        KeyPath(path)
    }

    /// The path of the branch of `location`, under `coin_type`; Dash Platform hardens it.
    pub fn branch_path(
        &self,
        kind: AddressType,
        coin_type: u32,
        location: AddressLocation,
    ) -> KeyPath {
        let KeyPath(mut path) = self.account_path(kind, coin_type, location.account);
        path.push(if kind == AddressType::DashPlatform {
            hardened(location.branch)
        } else {
            location.branch
        });
        KeyPath(path)
    }

    /// The coin types of its keys: the testnets' one, or its own.
    fn coin_types_on(&self, testnet: bool) -> &'static [u32] {
        if testnet {
            &[TESTNET_COIN_TYPE]
        } else {
            self.coin_types
        }
    }

    /// The branch paths of `location` for keys of `kind`, one for each coin type.
    pub fn branch_paths(
        &self,
        kind: AddressType,
        testnet: bool,
        location: AddressLocation,
    ) -> Vec<KeyPath> {
        self.coin_types_on(testnet)
            .iter()
            .map(|&coin_type| self.branch_path(kind, coin_type, location))
            .collect()
    }

    /// The account paths of `account` for keys of `kind`, one for each coin type.
    pub fn account_paths(&self, kind: AddressType, testnet: bool, account: u32) -> Vec<KeyPath> {
        self.coin_types_on(testnet)
            .iter()
            .map(|&coin_type| self.account_path(kind, coin_type, account))
            .collect()
    }

    /// What an address of `kind` is called, where the coin names its types.
    pub fn describe(&self, kind: AddressType) -> Option<String> {
        match &self.reader {
            Reader::Segwit { .. } => {
                let name = match kind {
                    AddressType::P2pkh => "legacy",
                    AddressType::P2shP2wpkh => "nested SegWit",
                    AddressType::P2wpkh => "native SegWit",
                    AddressType::P2tr => "Taproot",
                    AddressType::Keccak | AddressType::DashPlatform => "",
                };
                Some(format!("{name} (BIP{})", kind.purpose()))
            }
            Reader::Zcash { .. } => Some("transparent".to_owned()),
            Reader::Dash { .. } if kind == AddressType::DashPlatform => {
                Some(format!("Platform payment (DIP{DIP17_FEATURE})"))
            }
            Reader::Dash { .. } => Some(format!("Core (BIP{})", kind.purpose())),
            _ => None,
        }
    }

    /// The beginnings of its addresses that only it writes, in lower case.
    fn own_prefixes(&self) -> Vec<String> {
        match &self.reader {
            Reader::Segwit {
                prefixes: (main, test),
                ..
            } => std::iter::once(main)
                .chain(test)
                .map(|prefix| format!("{prefix}1"))
                .collect(),
            Reader::Bech32Account { prefix, .. } => vec![format!("{prefix}1")],
            Reader::Dash { .. } => vec!["dash1".to_owned(), "tdash1".to_owned()],
            Reader::CashAddr { .. } => vec![format!("{CASHADDR_PREFIX}:")],
            _ => Vec::new(),
        }
    }

    /// The forms of its addresses of a single key, for the refusal of another.
    fn single_key_forms(&self) -> String {
        match &self.reader {
            Reader::Segwit {
                prefixes: (main, _),
                taproot,
                ..
            } => {
                let key_hash = format!(
                    "{main}1q with {} characters",
                    main.len() + P2WPKH_CHARACTERS_AFTER_PREFIX
                );
                if *taproot {
                    format!("{key_hash} or {main}1p")
                } else {
                    key_hash
                }
            }
            _ => self.address_forms.to_owned(),
        }
    }

    /// The refusal of another coin's address.
    const fn not_ours(&self) -> CoinError {
        CoinError::NotThisCoin(self.name, self.address_forms)
    }

    /// `text`, trimmed, read as one of its addresses. An address that does not read and begins
    /// as none of its own, but reads as some coin's, is refused as another coin's.
    pub fn parse(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        let trimmed = trim(text);
        self.read(trimmed).map_err(|error| {
            let unreadable = matches!(error, CoinError::Damaged | CoinError::MixedCase(_));
            if unreadable
                && !starts_with_any(trimmed, &self.own_prefixes())
                && written_as_an_address(trimmed)
            {
                self.not_ours()
            } else {
                error
            }
        })
    }

    /// An address of this coin.
    fn address(
        &'static self,
        kind: AddressType,
        commitment: Vec<u8>,
        text: String,
        testnet: bool,
    ) -> CoinAddress {
        CoinAddress {
            coin: self,
            kind,
            commitment,
            text,
            testnet,
        }
    }

    fn read(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        match &self.reader {
            Reader::Base58 { versions, alphabet } => self.read_base58(text, versions, *alphabet),
            Reader::Segwit { versions, .. } => {
                if starts_with_any(text, &self.own_prefixes()) {
                    self.read_segwit(text)
                } else {
                    self.read_base58(text, versions, Alphabet::Bitcoin)
                }
            }
            Reader::Zcash { versions } => {
                let shielded: Vec<String> = ZCASH_SHIELDED
                    .iter()
                    .map(|prefix| (*prefix).to_owned())
                    .collect();
                if starts_with_any(text, &shielded) {
                    return Err(CoinError::Shielded("a transparent t1…"));
                }
                self.read_base58(text, versions, Alphabet::Bitcoin)
            }
            Reader::Dash { versions } => {
                if starts_with_any(text, &self.own_prefixes()) {
                    self.read_platform(text)
                } else {
                    self.read_base58(text, versions, Alphabet::Bitcoin)
                }
            }
            Reader::CashAddr { versions } => {
                let legacy = checked_data(text, Alphabet::Bitcoin);
                if text.starts_with('1') || legacy.is_some() {
                    if legacy.as_deref().and_then(<[u8]>::first) == Some(&P2SH_VERSION) {
                        return Err(CoinError::NotSingleKey(self.single_key_forms()));
                    }
                    return self.read_base58(text, versions, Alphabet::Bitcoin);
                }
                self.read_cashaddr(text)
            }
            #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
            Reader::Hex => self.read_hex(text),
            Reader::Bech32Account { prefix, kind } => {
                let read = decode_bech32(text, false).ok_or(CoinError::Damaged)?;
                if read.prefix != *prefix {
                    return Err(self.not_ours());
                }
                if read.groups.len() != (8 * HASH160_BYTES).div_ceil(5) {
                    return Err(CoinError::WrongLength);
                }
                let account = bytes_of_groups(&read.groups).ok_or(CoinError::Damaged)?;
                Ok(self.address(*kind, account, text.to_ascii_lowercase(), false))
            }
        }
    }

    fn read_base58(
        &'static self,
        text: &str,
        versions: &[Version],
        alphabet: Alphabet,
    ) -> Result<CoinAddress, CoinError> {
        let data = checked_data(text, alphabet).ok_or(CoinError::Damaged)?;
        let version = versions
            .iter()
            .find(|version| data.starts_with(version.prefix))
            .ok_or_else(|| self.not_ours())?;
        let hash = &data[version.prefix.len()..];
        if hash.len() != HASH160_BYTES {
            return Err(CoinError::WrongLength);
        }
        Ok(self.address(
            version.kind,
            hash.to_vec(),
            text.to_owned(),
            version.testnet,
        ))
    }

    fn read_segwit(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        let Reader::Segwit {
            prefixes: (main, test),
            taproot,
            ..
        } = &self.reader
        else {
            return Err(CoinError::Damaged);
        };
        let (prefix, version, program) = decode_segwit(text).ok_or(CoinError::Damaged)?;
        let testnet = if prefix == *main {
            false
        } else if Some(prefix.as_str()) == *test {
            true
        } else {
            return Err(self.not_ours());
        };
        let kind = match (version, program.len()) {
            (0, HASH160_BYTES) => AddressType::P2wpkh,
            (1, X_ONLY_KEY_BYTES) if *taproot => AddressType::P2tr,
            _ => return Err(CoinError::NotSingleKey(self.single_key_forms())),
        };
        Ok(self.address(kind, program, text.to_ascii_lowercase(), testnet))
    }

    fn read_platform(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        let read = decode_bech32(text, true).ok_or(CoinError::Damaged)?;
        let testnet = match read.prefix.as_str() {
            "dash" => false,
            "tdash" => true,
            _ => return Err(self.not_ours()),
        };
        // The groups as whole bytes, a leftover of fewer than eight bits dropped, as TS reads them.
        let (bytes, _, _) = encodings::whole_bytes_of_groups(&read.groups);
        match bytes.split_first() {
            Some((&PLATFORM_P2PKH, hash)) => {
                if hash.len() != HASH160_BYTES {
                    return Err(CoinError::WrongLength);
                }
                let payment_groups = (8 * (1 + HASH160_BYTES)).div_ceil(5);
                let padding = (1 << (payment_groups * 5 - 8 * (1 + HASH160_BYTES))) - 1;
                let last = read.groups.last().copied().unwrap_or(0);
                if read.groups.len() != payment_groups || last & padding != 0 {
                    return Err(CoinError::Damaged);
                }
                Ok(self.address(
                    AddressType::DashPlatform,
                    hash.to_vec(),
                    text.to_ascii_lowercase(),
                    testnet,
                ))
            }
            Some((&PLATFORM_ORCHARD, _)) => {
                Err(CoinError::Shielded("a Dash Core X… or Platform dash1k…"))
            }
            _ => Err(CoinError::NotSingleKey(self.single_key_forms())),
        }
    }

    fn read_cashaddr(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        let lower = text.to_ascii_lowercase();
        let payload = match lower.split_once(':') {
            Some((prefix, _)) if prefix != CASHADDR_PREFIX => return Err(self.not_ours()),
            Some((_, payload)) => payload,
            // Without the prefix only q… and p… have the form of a CashAddr, so that another coin's
            // damaged address is not taken for one (mhfe 8fd9f46).
            None if lower.starts_with(['q', 'p']) => lower.as_str(),
            None => return Err(self.not_ours()),
        };
        let groups: Option<Vec<u8>> = payload
            .chars()
            .map(|character| {
                BECH32_ALPHABET
                    .find(character)
                    .and_then(|at| u8::try_from(at).ok())
            })
            .collect();
        let groups = groups.ok_or_else(|| self.not_ours())?;
        if lower != text && text.to_ascii_uppercase() != text {
            return Err(CoinError::MixedCase("CashAddr"));
        }
        let mut checked: Vec<u8> = CASHADDR_PREFIX.bytes().map(|byte| byte & 0x1f).collect();
        checked.push(0);
        checked.extend_from_slice(&groups);
        if groups.len() <= CASHADDR_CHECKSUM_GROUPS || cashaddr_polymod(&checked) != 0 {
            return Err(CoinError::Damaged);
        }
        let data = bytes_of_groups(&groups[..groups.len() - CASHADDR_CHECKSUM_GROUPS])
            .ok_or(CoinError::Damaged)?;
        match data.split_first() {
            Some((0, hash)) if hash.len() == HASH160_BYTES => Ok(self.address(
                AddressType::P2pkh,
                hash.to_vec(),
                format!("{CASHADDR_PREFIX}:{payload}"),
                false,
            )),
            _ => Err(CoinError::NotSingleKey(self.single_key_forms())),
        }
    }

    #[cfg(any(feature = "coin-ethereum", feature = "coin-ethereum-classic"))]
    fn read_hex(&'static self, text: &str) -> Result<CoinAddress, CoinError> {
        let digits = text
            .strip_prefix("0x")
            .or_else(|| text.strip_prefix("0X"))
            .ok_or_else(|| self.not_ours())?;
        if digits.len() != 2 * HASH160_BYTES || !digits.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(CoinError::NotHexAccount);
        }
        let lower = digits.to_ascii_lowercase();
        let account: Vec<u8> = (0..HASH160_BYTES)
            .map(|at| u8::from_str_radix(&lower[2 * at..2 * at + 2], 16).unwrap_or(0))
            .collect();
        let checksummed = encodings::eip55(&account);
        let small = digits.bytes().any(|byte| matches!(byte, b'a'..=b'f'));
        let capital = digits.bytes().any(|byte| matches!(byte, b'A'..=b'F'));
        if small && capital && digits != checksummed {
            return Err(CoinError::WrongEip55);
        }
        Ok(self.address(
            AddressType::Keccak,
            account,
            format!("0x{checksummed}"),
            false,
        ))
    }
}

/// `text`, trimmed, read as an address of every coin of this build whose form it has, in the order
/// of [`COINS`]: one coin for most addresses, more where coins share a form, as Bitcoin and Bitcoin
/// Cash share 1…, Bitcoin and Litecoin's older P2SH 3…, and Ethereum and Ethereum Classic 0x…, so
/// that a check searches the paths of each. A coin added to the registry takes part with no list
/// of such pairs.
///
/// # Errors
///
/// An address of no coin is refused with the reason of the first coin whose form it has, such as a
/// wrong EIP-55 checksum or a shielded address; else as [`CoinError::NoCoin`].
pub fn parse_any(text: &str) -> Result<Vec<CoinAddress>, CoinError> {
    let mut read = Vec::new();
    let mut reason = None;
    for coin in COINS {
        match coin.parse(text) {
            Ok(address) => read.push(address),
            Err(error) if reason.is_none() && !error.says_another_form() => reason = Some(error),
            Err(_) => {}
        }
    }
    if read.is_empty() {
        return Err(reason.unwrap_or(CoinError::NoCoin));
    }
    Ok(read)
}

/// An address read by its coin: its type, the commitment it holds, its text as the coin writes it,
/// and whether it is a testnet's.
#[derive(Clone, Debug)]
pub struct CoinAddress {
    /// The coin.
    pub coin: &'static Coin,
    /// The type.
    pub kind: AddressType,
    commitment: Vec<u8>,
    /// The text.
    pub text: String,
    /// Whether it is a testnet's.
    pub testnet: bool,
}

impl CoinAddress {
    /// What it is called, "testnet, " before it on a testnet; none where the coin names no types.
    pub fn description(&self) -> Option<String> {
        let kind = self.coin.describe(self.kind)?;
        Some(if self.testnet {
            format!("testnet, {kind}")
        } else {
            kind
        })
    }

    /// The branch paths its key may stand at, at `location`.
    pub fn branch_paths(&self, location: AddressLocation) -> Vec<KeyPath> {
        self.coin.branch_paths(self.kind, self.testnet, location)
    }

    /// Whether it is the address of `public_key`, compressed.
    pub fn is_address_of(&self, public_key: &[u8]) -> Result<bool, CoinError> {
        Ok(crate::secret::equal_bytes(
            &self.kind.commitment(public_key)?,
            &self.commitment,
        ))
    }
}

// The tests read every coin's addresses: they run in a build of all of them.
#[cfg(all(
    test,
    feature = "coin-bitcoin",
    feature = "coin-bitcoin-cash",
    feature = "coin-cosmos",
    feature = "coin-dash",
    feature = "coin-dogecoin",
    feature = "coin-ethereum",
    feature = "coin-ethereum-classic",
    feature = "coin-injective",
    feature = "coin-litecoin",
    feature = "coin-tron",
    feature = "coin-xrp",
    feature = "coin-zcash"
))]
mod tests {
    use super::*;
    use crate::bip32::ExtendedKey;
    use crate::bip39::phrase::Phrase;
    use crate::self_check::vectors::PUBLIC_MNEMONIC;

    /// `path` as written, `m/44'/0'/0'/0/0`, into indexes.
    fn indexes(path: &str) -> Vec<u32> {
        path.trim_start_matches("m/")
            .split('/')
            .map(|part| {
                part.strip_suffix('\'').map_or_else(
                    || part.parse().unwrap_or(0),
                    |index| hardened(index.parse().unwrap_or(0)),
                )
            })
            .collect()
    }

    /// The known answers of TS's coin self-tests: the public phrase's key at a path and its address.
    const ANSWERS: [(&str, &str, &str); 16] = [
        (
            "bitcoin",
            "m/44'/0'/0'/0/0",
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
        ),
        (
            "bitcoin",
            "m/49'/0'/0'/0/0",
            "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
        ),
        (
            "bitcoin",
            "m/84'/0'/0'/0/0",
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        ),
        (
            "bitcoin",
            "m/86'/0'/0'/0/0",
            "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
        ),
        (
            "bitcoin-cash",
            "m/44'/145'/0'/0/0",
            "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
        ),
        (
            "bitcoin-cash",
            "m/44'/145'/3'/1/7",
            "bitcoincash:qrhejavdmlfh9eajjxra3s3mn8gxls9hkvsq2yd62y",
        ),
        (
            "xrp",
            "m/44'/144'/0'/0/0",
            "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3",
        ),
        (
            "xrp",
            "m/44'/144'/3'/1/7",
            "rnU3BdqhZk8DL3FKjQcaAyf3DJSoUZD8eM",
        ),
        (
            "cosmos",
            "m/44'/118'/0'/0/0",
            "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
        ),
        (
            "cosmos",
            "m/44'/118'/3'/1/7",
            "cosmos1j8dc8g9sux68h924yj646shrsjmkd7g6fwevky",
        ),
        (
            "injective",
            "m/44'/60'/0'/0/0",
            "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz",
        ),
        (
            "ethereum",
            "m/44'/60'/0'/0/0",
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        ),
        (
            "ethereum",
            "m/44'/60'/3'/1/7",
            "0xc1A30611797762aea209daC2aC7E900f0cE95f9e",
        ),
        (
            "dash",
            "m/44'/5'/0'/0/0",
            "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5",
        ),
        (
            "dash",
            "m/44'/5'/3'/1/7",
            "XbAei18dD6mdL9LR6sTmbFJTQAJBcpxuxL",
        ),
        (
            "dash",
            "m/9'/5'/17'/0'/0'/0",
            "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs",
        ),
    ];

    #[test]
    fn each_coin_reads_its_published_addresses() {
        let master = ExtendedKey::of_phrase(&Phrase::parse(PUBLIC_MNEMONIC).unwrap(), "").unwrap();
        for (id, path, text) in ANSWERS {
            let coin = Coin::named(id).unwrap();
            let address = coin.parse(text).unwrap();
            let key = master.derive(&indexes(path)).unwrap().public_key().unwrap();
            assert!(address.is_address_of(&key).unwrap(), "{id} {path}");
            let location = AddressLocation::new(0, 0, 0).unwrap();
            assert!(!address.branch_paths(location).is_empty());
        }
    }

    /// An address is read as every coin whose form it has; an address of no coin keeps the reason
    /// of the coin whose form it has.
    #[test]
    fn an_address_is_read_as_every_coin_of_its_form() {
        let coins = |text: &str| -> Vec<&str> {
            parse_any(text)
                .unwrap()
                .iter()
                .map(|address| address.coin.id)
                .collect()
        };
        assert_eq!(
            coins("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA"),
            ["bitcoin", "bitcoin-cash"]
        );
        assert_eq!(
            coins("37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf"),
            ["bitcoin", "litecoin"]
        );
        assert_eq!(
            coins("0x9858EfFD232B4033E47d90003D41EC34EcaEda94"),
            ["ethereum", "ethereum-classic"]
        );
        assert_eq!(
            coins("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"),
            ["bitcoin"]
        );
        assert_eq!(coins("XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5"), ["dash"]);
        assert_eq!(
            parse_any("0x9858efFD232B4033E47d90003D41EC34EcaEda94").unwrap_err(),
            CoinError::WrongEip55
        );
        // 39 digits, none of them 1 or b: no CashAddr reason in place of Ethereum's own.
        assert_eq!(
            parse_any("0x9858EfFD232C4033E47d90003D4CEC34EcaEda9").unwrap_err(),
            CoinError::NotHexAccount
        );
        assert_eq!(
            parse_any(
                "zs1z7rejlpsa98s2rrrfkwmaxu53e4ue0ulcrw0h4x5g8jl04tak0d3mm47vdtahatqrlkngh9sly"
            )
            .unwrap_err()
            .code(),
            "core.coins.coin.address-shielded"
        );
        assert_eq!(
            parse_any("bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv").unwrap_err(),
            CoinError::NoCoin
        );
        assert_eq!(parse_any("not an address").unwrap_err(), CoinError::NoCoin);
    }

    #[test]
    fn damaged_and_foreign_addresses_are_told_apart() {
        let bitcoin = Coin::named("Bitcoin ").unwrap();
        assert_eq!(
            bitcoin
                .parse("1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabB")
                .unwrap_err(),
            CoinError::Damaged
        );
        assert_eq!(
            bitcoin
                .parse("rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3")
                .unwrap_err(),
            CoinError::NotThisCoin("Bitcoin", "1…, 3…, bc1q… or bc1p…")
        );
        let ethereum = Coin::named("ethereum").unwrap();
        assert_eq!(
            ethereum
                .parse("0x9858efFD232B4033E47d90003D41EC34EcaEda94")
                .unwrap_err(),
            CoinError::WrongEip55
        );
        assert_eq!(
            Coin::named("ether").unwrap_err().code(),
            "core.coins.coin.unknown-coin-coins"
        );
        assert_eq!(
            KeyPath(indexes("m/9'/5'/17'/0'/1'/0")).to_string(),
            "m/9'/5'/17'/0'/1'/0"
        );
    }
}

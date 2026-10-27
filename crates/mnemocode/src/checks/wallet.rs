//! The wallet evidence row (MnemoCode TS 0.1.0's `core/wallet-evidence-self-test.ts`,
//! CAP-WALLET-EVIDENCE-CHECK): the public phrase's fingerprint and master keys in every form, in
//! every build; with Bitcoin, its account keys, its addresses under every profile, its key and WIF,
//! a scan, and the refusals.

use super::{Row, ok};
use crate::bip32::ExtendedKey;
use crate::bip39::phrase::Phrase;
use crate::self_check::vectors::{PUBLIC_FINGERPRINT, PUBLIC_MNEMONIC};
use crate::self_check::{CheckFailure, Tier, expect_same};
use crate::wallet::evidence::{BitcoinNetwork, Evidence, EvidenceError};

/// The public phrase's master keys, published or computed independently (TS's KEYS).
const ROOT_XPUB: &str = "xpub661MyMwAqRbcFkPHucMnrGNzDwb6teAX1RbKQmqtEF8kK3Z7LZ59qafCjB9eCRLiTVG3uxBxgKvRgbubRhqSKXnGGb1aoaqLrpMBDrVxga8";
const ROOT_YPUB: &str = "ypub6QqdH2c5z79673aQjy9R4MUVPujYqGA1vY7YCAjmcFWdN9NLbDEiTeKLkP7ECKzds8NrfRnX8zGyZtXA9QFT7mTs8vi1PVeq8YQpcNKUMvQ";
const ROOT_ZPUB: &str = "zpub6jftahH18ngZxLmXaKw3GSZzZsszmt9WqedkyZdezFtWRFBZqsQH5hyUmb4pCEeZGmVfQuP5bedXTB8is6fTv19U1GQRyQUKQGUTzyHACMF";
const ROOT_TPUB: &str = "tpubD6NzVbkrYhZ4XYa9MoLt4BiMZ4gkt2faZ4BcmKu2a9te4LDpQmvEz2L2yDERivHxFPnxXXhqDRkUNnQCpZggCyEZLBktV7VaSmwayqMJy1s";
const ACCOUNT_84_ZPUB: &str = "zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs";

/// The row.
#[cfg(feature = "coin-bitcoin")]
pub(super) const ROW: Row = Row::new(
    "Wallet evidence",
    "fingerprint, xpubs, four profiles, key, WIF, address scan, refusals",
    run,
);
/// The row, of a build without Bitcoin: the master fingerprint and keys.
#[cfg(not(feature = "coin-bitcoin"))]
pub(super) const ROW: Row = Row::new("Wallet evidence", "fingerprint, master keys, refusal", run);

type Build = fn() -> Result<Evidence, EvidenceError>;

/// Each case of the master key: its name, its evidence, what it gives, and the BIP39 passphrase.
const MASTER_MATCHES: [(&str, Build, &str, &str); 7] = [
    (
        "Master fingerprint",
        || Evidence::master_fingerprint(&PUBLIC_FINGERPRINT.to_uppercase()),
        "matched at m",
        "",
    ),
    (
        "Another master fingerprint",
        || Evidence::master_fingerprint("00000000"),
        "not matched",
        "",
    ),
    (
        "Master xpub",
        || Evidence::master_key(ROOT_XPUB, BitcoinNetwork::Mainnet),
        "matched at m",
        "",
    ),
    (
        "Master ypub",
        || Evidence::master_key(ROOT_YPUB, BitcoinNetwork::Mainnet),
        "matched at m",
        "",
    ),
    (
        "Master zpub",
        || Evidence::master_key(ROOT_ZPUB, BitcoinNetwork::Mainnet),
        "matched at m",
        "",
    ),
    (
        "Master tpub",
        || Evidence::master_key(ROOT_TPUB, BitcoinNetwork::Testnet),
        "matched at m",
        "",
    ),
    (
        "Another master key",
        || Evidence::master_key(ACCOUNT_84_ZPUB, BitcoinNetwork::Mainnet),
        "not matched",
        "",
    ),
];

/// Each refused case of the master key: its name, its evidence and words of its refusal.
const MASTER_REFUSED: [(&str, Build, &str); 1] = [(
    "A testnet key on mainnet",
    || Evidence::master_key(ROOT_TPUB, BitcoinNetwork::Mainnet),
    "does not match the selected Bitcoin network",
)];

/// What `build` gives against the public phrase with `passphrase`.
fn match_of(build: Build, passphrase: &str) -> Result<String, CheckFailure> {
    let root = ok(ExtendedKey::of_phrase(
        &ok(Phrase::parse(PUBLIC_MNEMONIC))?,
        passphrase,
    ))?;
    let found = ok(ok(build())?.compare(&root))?;
    Ok(match (found.matched, found.path) {
        (true, Some(path)) => format!("matched at {path}"),
        _ => "not matched".to_owned(),
    })
}

/// Runs `matches` that `startup` names, or every one in the full tier, and in the full tier the
/// `refused` cases.
fn run_cases(
    tier: Tier,
    matches: &[(&'static str, Build, &'static str, &'static str)],
    startup: &[usize],
    refused: &[(&'static str, Build, &'static str)],
) -> Result<(), CheckFailure> {
    for (place, (name, build, expected, passphrase)) in matches.iter().enumerate() {
        if tier == Tier::Full || startup.contains(&place) {
            expect_same(match_of(*build, passphrase)?.as_str(), *expected, name)?;
        }
    }
    if tier == Tier::Startup {
        return Ok(());
    }
    for (name, build, because) in refused {
        let refusal = build().err().map(|error| error.to_string());
        expect_same(
            &refusal.is_some_and(|message| message.contains(because)),
            &true,
            name,
        )?;
    }
    Ok(())
}

fn run(tier: Tier) -> Result<(), CheckFailure> {
    // A build with Bitcoin starts with its addresses; one without, with a master key.
    let startup: &[usize] = if cfg!(feature = "coin-bitcoin") {
        &[]
    } else {
        &[2]
    };
    run_cases(tier, &MASTER_MATCHES, startup, &MASTER_REFUSED)?;
    #[cfg(feature = "coin-bitcoin")]
    bitcoin::run(tier)?;
    Ok(())
}

/// The cases of Bitcoin's keys and addresses.
#[cfg(feature = "coin-bitcoin")]
mod bitcoin {
    use super::{ACCOUNT_84_ZPUB, Build, match_of, run_cases};
    use crate::self_check::{CheckFailure, Tier, expect_same};
    use crate::wallet::coins::AddressLocation;
    use crate::wallet::evidence::{BitcoinNetwork, BitcoinProfile, Evidence, EvidenceError, Place};

    /// The public phrase's account keys and addresses, published or computed independently.
    const ACCOUNT_86_XPUB: &str = "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ";
    const ACCOUNT_49_TESTNET_UPUB: &str = "upub5EFU65HtV5TeiSHmZZm7FUffBGy8UKeqp7vw43jYbvZPpoVsgU93oac7Wk3u6moKegAEWtGNF8DehrnHtv21XXEMYRUocHqguyjknFHYfgY";
    const ADDRESS_44: &str = "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA";
    const ADDRESS_49: &str = "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf";
    const ADDRESS_84: &str = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
    const ADDRESS_86: &str = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";
    const CHANGE_84: &str = "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el";
    const SECOND_84: &str = "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g";
    const PUBLIC_KEY_84: &str =
        "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c";
    const WIF_84: &str = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";
    const TREZOR_ADDRESS_84: &str = "bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu";
    const KEY_ONE_WIF: &str = "KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn";
    const SCRIPT_ADDRESS: &str = "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3";
    const TESTNET_ADDRESS: &str = "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl";

    /// A constructor of located evidence.
    type Located = fn(&str, Place) -> Result<Evidence, EvidenceError>;

    /// The first place of the first account.
    fn first() -> AddressLocation {
        AddressLocation {
            account: 0,
            branch: 0,
            index: 0,
        }
    }

    /// A located piece of evidence under `profiles` on the main network.
    fn located(
        kind: Located,
        value: &str,
        profiles: &[BitcoinProfile],
    ) -> Result<Evidence, EvidenceError> {
        kind(
            value,
            Place {
                network: BitcoinNetwork::Mainnet,
                profiles: profiles.to_vec(),
                location: first(),
                addresses: None,
            },
        )
    }

    /// The second native SegWit address, scanned `addresses` from `index`.
    fn scanned(addresses: Option<u64>, index: u32) -> Result<Evidence, EvidenceError> {
        let location = AddressLocation { index, ..first() };
        Evidence::bitcoin_address(
            SECOND_84,
            Place {
                network: BitcoinNetwork::Mainnet,
                profiles: vec![BitcoinProfile::NativeSegwit],
                location,
                addresses,
            },
        )
    }

    const NATIVE: [BitcoinProfile; 1] = [BitcoinProfile::NativeSegwit];

    /// Each case: its name, its evidence, what it gives, and the BIP39 passphrase.
    const MATCHES: [(&str, Build, &str, &str); 15] = [
        (
            "Account zpub",
            || Evidence::account_key(ACCOUNT_84_ZPUB, BitcoinNetwork::Mainnet, NATIVE.to_vec(), 0),
            "matched at m/84'/0'/0'",
            "",
        ),
        (
            "Account xpub of Taproot",
            || {
                Evidence::account_key(
                    ACCOUNT_86_XPUB,
                    BitcoinNetwork::Mainnet,
                    vec![BitcoinProfile::Taproot],
                    0,
                )
            },
            "matched at m/86'/0'/0'",
            "",
        ),
        (
            "Testnet account upub",
            || {
                Evidence::account_key(
                    ACCOUNT_49_TESTNET_UPUB,
                    BitcoinNetwork::Testnet,
                    vec![BitcoinProfile::NestedSegwit],
                    0,
                )
            },
            "matched at m/49'/1'/0'",
            "",
        ),
        (
            "Legacy address",
            || located(Evidence::bitcoin_address, ADDRESS_44, &BitcoinProfile::ALL),
            "matched at m/44'/0'/0'/0/0",
            "",
        ),
        (
            "Nested SegWit address",
            || located(Evidence::bitcoin_address, ADDRESS_49, &BitcoinProfile::ALL),
            "matched at m/49'/0'/0'/0/0",
            "",
        ),
        (
            "Native SegWit address",
            || located(Evidence::bitcoin_address, ADDRESS_84, &BitcoinProfile::ALL),
            "matched at m/84'/0'/0'/0/0",
            "",
        ),
        (
            "Taproot address",
            || located(Evidence::bitcoin_address, ADDRESS_86, &BitcoinProfile::ALL),
            "matched at m/86'/0'/0'/0/0",
            "",
        ),
        (
            "Compressed public key",
            || located(Evidence::public_key, PUBLIC_KEY_84, &NATIVE),
            "matched at m/84'/0'/0'/0/0",
            "",
        ),
        (
            "WIF",
            || located(Evidence::wif, WIF_84, &NATIVE),
            "matched at m/84'/0'/0'/0/0",
            "",
        ),
        (
            "Another WIF",
            || located(Evidence::wif, KEY_ONE_WIF, &BitcoinProfile::ALL),
            "not matched",
            "",
        ),
        (
            "Address with the passphrase TREZOR",
            || located(Evidence::bitcoin_address, TREZOR_ADDRESS_84, &NATIVE),
            "matched at m/84'/0'/0'/0/0",
            "TREZOR",
        ),
        (
            "Address without its passphrase",
            || located(Evidence::bitcoin_address, TREZOR_ADDRESS_84, &NATIVE),
            "not matched",
            "",
        ),
        (
            "Second address at the first place only",
            || scanned(None, 0),
            "not matched",
            "",
        ),
        (
            "Second address among the first twenty",
            || scanned(Some(20), 0),
            "matched at m/84'/0'/0'/0/1",
            "",
        ),
        (
            "Second address, scanned from the third",
            || scanned(Some(20), 2),
            "not matched",
            "",
        ),
    ];

    /// Each refused case: its name, its evidence and words of its refusal.
    const REFUSED: [(&str, Build, &str); 7] = [
        (
            "A public key that is not compressed",
            || {
                located(
                    Evidence::public_key,
                    "0430d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
                    &NATIVE,
                )
            },
            "must start with 02 or 03",
        ),
        (
            "A public key off the curve",
            || {
                located(
                    Evidence::public_key,
                    "020000000000000000000000000000000000000000000000000000000000000000",
                    &NATIVE,
                )
            },
            "not a point of the secp256k1 curve",
        ),
        (
            "A script address",
            || located(Evidence::bitcoin_address, SCRIPT_ADDRESS, &NATIVE),
            "not the address of a single key",
        ),
        (
            "An address that none of the profiles writes",
            || {
                located(
                    Evidence::bitcoin_address,
                    ADDRESS_86,
                    &[
                        BitcoinProfile::Legacy,
                        BitcoinProfile::NestedSegwit,
                        BitcoinProfile::NativeSegwit,
                    ],
                )
            },
            "none of the selected Bitcoin address profiles writes",
        ),
        (
            "A testnet address on mainnet",
            || located(Evidence::bitcoin_address, TESTNET_ADDRESS, &NATIVE),
            "it is a testnet address",
        ),
        (
            "No address to scan",
            || scanned(Some(0), 0),
            "number of addresses compared",
        ),
        (
            "A scan past the last index",
            || scanned(Some(2), 0x7fff_ffff),
            "would pass index 2147483647",
        ),
    ];

    pub(super) fn run(tier: Tier) -> Result<(), CheckFailure> {
        run_cases(tier, &MATCHES, &[5, 12, 13], &[])?;
        let change = || located(Evidence::bitcoin_address, CHANGE_84, &NATIVE);
        expect_same(
            match_of(change, "")?.as_str(),
            "not matched",
            "Another address of the wallet",
        )?;
        let damaged = located(
            Evidence::bitcoin_address,
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyv",
            &NATIVE,
        );
        let refusal = damaged.err().map(|error| error.to_string());
        expect_same(
            &refusal.as_deref(),
            &Some("The address is not valid for Bitcoin mainnet."),
            "An address with a wrong checksum",
        )?;
        if tier == Tier::Full {
            run_cases(tier, &[], &[], &REFUSED)?;
        }
        Ok(())
    }
}

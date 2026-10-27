//! The coins' rows (MnemoCode TS 0.1.0's `core/coins/*-self-test.ts`, CAP-WALLET-COIN-SELF-TESTS):
//! each family's published addresses of the public phrase found at their paths, one elsewhere not
//! found, a second address found by a scan of two, and its refusals; each row built only with its
//! coins.

use super::{Row, ok};
use crate::bip32::ExtendedKey;
use crate::bip39::phrase::Phrase;
use crate::self_check::vectors::PUBLIC_MNEMONIC;
use crate::self_check::{CheckFailure, Tier, expect_same};
use crate::wallet::coins::{AddressLocation, Coin};
use crate::wallet::evidence::Evidence;

/// One family's known answers: (coin, passphrase, path, address); the vectors checked at start, the
/// one looked for elsewhere, the one found by a scan of two, and (coin, address, refusal) cases.
struct Family {
    vectors: &'static [(&'static str, &'static str, &'static str, &'static str)],
    startup: &'static [usize],
    elsewhere: usize,
    scanned: Option<usize>,
    refused: &'static [(&'static str, &'static str, &'static str)],
}

/// The account, branch and index of the last three steps of `path`.
fn location_of(path: &str) -> Result<AddressLocation, CheckFailure> {
    let steps: Vec<u64> = path
        .rsplit('/')
        .take(3)
        .map(|step| step.trim_end_matches('\'').parse().unwrap_or(u64::MAX))
        .collect();
    match steps.as_slice() {
        [index, branch, account] => ok(AddressLocation::new(*account, *branch, *index)),
        _ => Err(CheckFailure::Mismatch("Coin vector path")),
    }
}

impl Family {
    /// Where the public phrase's key matches the vector `place` at `location`, `addresses` of them.
    fn found_at(
        &self,
        place: usize,
        location: AddressLocation,
        addresses: Option<u64>,
    ) -> Result<String, CheckFailure> {
        let (id, passphrase, _, address) = self
            .vectors
            .get(place)
            .copied()
            .ok_or(CheckFailure::Mismatch("Coin vector"))?;
        let root = ok(ExtendedKey::of_phrase(
            &ok(Phrase::parse(PUBLIC_MNEMONIC))?,
            passphrase,
        ))?;
        let evidence = ok(Evidence::coin_address(
            ok(Coin::named(id))?,
            address,
            location,
            addresses,
        ))?;
        let found = ok(evidence.compare(&root))?;
        Ok(match (found.matched, found.path, found.derived) {
            (true, Some(path), Some(derived)) => format!("{path} {derived}"),
            _ => "not matched".to_owned(),
        })
    }

    /// The vector `place` found at its own path.
    fn check_vector(&self, place: usize) -> Result<(), CheckFailure> {
        let (_, _, path, address) = self
            .vectors
            .get(place)
            .copied()
            .ok_or(CheckFailure::Mismatch("Coin vector"))?;
        expect_same(
            self.found_at(place, location_of(path)?, None)?.as_str(),
            format!("{path} {address}").as_str(),
            "Coin address at its path",
        )
    }

    fn run(&self, tier: Tier) -> Result<(), CheckFailure> {
        for &place in self.startup.iter().filter(|&&place| self.built(place)) {
            self.check_vector(place)?;
        }
        if self.built(self.elsewhere) {
            let first = ok(AddressLocation::new(0, 0, 0))?;
            let found = self.found_at(self.elsewhere, first, None)?;
            expect_same(
                found.as_str(),
                "not matched",
                "Coin address at another place",
            )?;
        }
        if let Some(place) = self.scanned.filter(|&place| self.built(place)) {
            let (_, _, path, address) = self.vectors[place];
            let own = location_of(path)?;
            let start = ok(AddressLocation::new(
                u64::from(own.account),
                u64::from(own.branch),
                0,
            ))?;
            let expected = format!("{path} {address}");
            expect_same(
                self.found_at(place, start, Some(2))?.as_str(),
                expected.as_str(),
                "Second address among two",
            )?;
            expect_same(
                self.found_at(place, start, Some(1))?.as_str(),
                "not matched",
                "First address only",
            )?;
        }
        if tier == Tier::Startup {
            return Ok(());
        }
        for place in (0..self.vectors.len()).filter(|&place| self.built(place)) {
            self.check_vector(place)?;
        }
        for &(id, address, because) in self.refused {
            let Ok(coin) = Coin::named(id) else {
                continue;
            };
            let refused = coin.parse(address).err().map(|error| error.to_string());
            let message = refused.is_some_and(|message| message.contains(because));
            expect_same(&message, &true, "A refused coin address")?;
        }
        Ok(())
    }

    /// Whether the coin of the vector `place` is built; a case of another is left out.
    fn built(&self, place: usize) -> bool {
        self.vectors
            .get(place)
            .is_some_and(|(id, ..)| Coin::named(id).is_ok())
    }
}

/// Bitcoin Cash addresses (TS `core/coins/bitcoin-cash-self-test.ts`).
#[cfg(feature = "coin-bitcoin-cash")]
const BITCOIN_CASH: Family = Family {
    vectors: &[
        (
            "bitcoin-cash",
            "",
            "m/44'/145'/0'/0/0",
            "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
        ),
        (
            "bitcoin-cash",
            "",
            "m/44'/145'/3'/1/7",
            "bitcoincash:qrhejavdmlfh9eajjxra3s3mn8gxls9hkvsq2yd62y",
        ),
        (
            "bitcoin-cash",
            "",
            "m/44'/145'/0'/0/0",
            "1mW6fDEMjKrDHvLvoEsaeLxSCzZBf3Bfg",
        ),
        (
            "bitcoin-cash",
            "",
            "m/44'/0'/0'/0/0",
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
        ),
    ],
    startup: &[0],
    elsewhere: 1,
    scanned: None,
    refused: &[(
        "bitcoin-cash",
        "bitcoincash:pqkh9ahfj069qv8l6eysyufazpe4fdjq3u4hna323j",
        "not the address of a single key; only bitcoincash:q… or 1…",
    )],
};

/// Bitcoin, Litecoin, Dogecoin and Zcash addresses (TS `core/coins/bitcoin-like-self-test.ts`).
#[cfg(any(
    feature = "coin-bitcoin",
    feature = "coin-dogecoin",
    feature = "coin-litecoin",
    feature = "coin-zcash"
))]
const BITCOIN_LIKE: Family = Family {
    vectors: &[
        (
            "bitcoin",
            "",
            "m/44'/0'/0'/0/0",
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
        ),
        (
            "bitcoin",
            "",
            "m/49'/0'/0'/0/0",
            "37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf",
        ),
        (
            "bitcoin",
            "",
            "m/84'/0'/0'/0/0",
            "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
        ),
        (
            "bitcoin",
            "",
            "m/84'/0'/0'/0/1",
            "bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g",
        ),
        (
            "bitcoin",
            "",
            "m/84'/0'/0'/1/0",
            "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el",
        ),
        (
            "bitcoin",
            "",
            "m/86'/0'/0'/0/0",
            "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr",
        ),
        (
            "bitcoin",
            "",
            "m/86'/0'/0'/1/0",
            "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7",
        ),
        (
            "bitcoin",
            "",
            "m/44'/0'/3'/1/7",
            "12DCYXCcRpBJ5VoWDvSijepPu8mshEihvX",
        ),
        (
            "bitcoin",
            "",
            "m/49'/0'/3'/1/7",
            "3K7gGbTWfdq3kyBgkVTMbhfftnrhxB6jpW",
        ),
        (
            "bitcoin",
            "",
            "m/84'/0'/3'/1/7",
            "bc1q8r4wsa3nye5qypv80vpfg4sh99uf02u5mmh5ry",
        ),
        (
            "bitcoin",
            "",
            "m/86'/0'/3'/1/7",
            "bc1preq6saz8z9zrn3clx9eaen0dcsynwseakek7nwqlrj52wd2dsfsqlfsyut",
        ),
        (
            "bitcoin",
            "",
            "m/44'/1'/0'/0/0",
            "mkpZhYtJu2r87Js3pDiWJDmPte2NRZ8bJV",
        ),
        (
            "bitcoin",
            "",
            "m/49'/1'/0'/0/0",
            "2Mww8dCYPUpKHofjgcXcBCEGmniw9CoaiD2",
        ),
        (
            "bitcoin",
            "",
            "m/84'/1'/0'/0/0",
            "tb1q6rz28mcfaxtmd6v789l9rrlrusdprr9pqcpvkl",
        ),
        (
            "bitcoin",
            "",
            "m/86'/1'/0'/0/0",
            "tb1p8wpt9v4frpf3tkn0srd97pksgsxc5hs52lafxwru9kgeephvs7rqlqt9zj",
        ),
        (
            "bitcoin",
            "TREZOR",
            "m/84'/0'/0'/0/0",
            "bc1qv5rmq0kt9yz3pm36wvzct7p3x6mtgehjul0feu",
        ),
        (
            "zcash",
            "",
            "m/44'/133'/0'/0/0",
            "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F",
        ),
        (
            "zcash",
            "",
            "m/44'/133'/3'/1/7",
            "t1Pii1UXFrpcFucY5NBEFa664pymr7boHq4",
        ),
        (
            "dogecoin",
            "",
            "m/44'/3'/0'/0/0",
            "DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC",
        ),
        (
            "dogecoin",
            "",
            "m/44'/3'/3'/1/7",
            "DNuJKZiVoQ6t67t8dE4NuBDhd2FNpMBsg6",
        ),
        (
            "litecoin",
            "",
            "m/44'/2'/0'/0/0",
            "LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez",
        ),
        (
            "litecoin",
            "",
            "m/49'/2'/0'/0/0",
            "M7wtsL7wSHDBJVMWWhtQfTMSYYkyooAAXM",
        ),
        (
            "litecoin",
            "",
            "m/84'/2'/3'/1/7",
            "ltc1qnnphcvq5zgyf4f0uepust6d7gyt2zl69vftnz2",
        ),
    ],
    startup: &[20, 16, 18, 5],
    elsewhere: 7,
    scanned: Some(3),
    refused: &[
        (
            "bitcoin",
            "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
            "not the address of a single key; only bc1q with 42 characters or bc1p",
        ),
        (
            "litecoin",
            "1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA",
            "not an address of Litecoin",
        ),
    ],
};

/// Cosmos and Injective addresses (TS `core/coins/cosmos-self-test.ts`).
#[cfg(any(feature = "coin-cosmos", feature = "coin-injective"))]
const COSMOS: Family = Family {
    vectors: &[
        (
            "cosmos",
            "",
            "m/44'/118'/0'/0/0",
            "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
        ),
        (
            "cosmos",
            "",
            "m/44'/118'/3'/1/7",
            "cosmos1j8dc8g9sux68h924yj646shrsjmkd7g6fwevky",
        ),
        (
            "injective",
            "",
            "m/44'/60'/0'/0/0",
            "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz",
        ),
    ],
    startup: &[0, 2],
    elsewhere: 1,
    scanned: None,
    refused: &[(
        "cosmos",
        "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal5",
        "checksum or format",
    )],
};

/// Dash addresses (TS `core/coins/dash-self-test.ts`).
#[cfg(feature = "coin-dash")]
const DASH: Family = Family {
    vectors: &[
        (
            "dash",
            "",
            "m/44'/5'/0'/0/0",
            "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5",
        ),
        (
            "dash",
            "",
            "m/44'/5'/3'/1/7",
            "XbAei18dD6mdL9LR6sTmbFJTQAJBcpxuxL",
        ),
        (
            "dash",
            "",
            "m/9'/5'/17'/0'/0'/0",
            "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rs",
        ),
        (
            "dash",
            "",
            "m/9'/5'/17'/0'/0'/1",
            "dash1kzjl7qzxy9lar37j8r37z3kvt07epqe20ckxfezw",
        ),
        (
            "dash",
            "",
            "m/9'/5'/17'/0'/1'/0",
            "dash1kpkeye606ez89g7lelp7hnldwwpt76va0v3j6x28",
        ),
    ],
    startup: &[2],
    elsewhere: 1,
    scanned: Some(3),
    refused: &[(
        "dash",
        "dash1krma5z3ttj75la4m93xcndna9ullamq9y5e9n5rt",
        "checksum or format",
    )],
};

/// Ethereum addresses (TS `core/coins/ethereum-self-test.ts`).
#[cfg(feature = "coin-ethereum")]
const ETHEREUM: Family = Family {
    vectors: &[
        (
            "ethereum",
            "",
            "m/44'/60'/0'/0/0",
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        ),
        (
            "ethereum",
            "",
            "m/44'/60'/3'/1/7",
            "0xc1A30611797762aea209daC2aC7E900f0cE95f9e",
        ),
    ],
    startup: &[0],
    elsewhere: 1,
    scanned: None,
    refused: &[(
        "ethereum",
        "0x9858efFD232B4033E47d90003D41EC34EcaEda94",
        "EIP-55 checksum",
    )],
};

/// Ethereum Classic and Tron addresses (TS `core/coins/evm-self-test.ts`).
#[cfg(any(feature = "coin-ethereum-classic", feature = "coin-tron"))]
const EVM: Family = Family {
    vectors: &[
        (
            "ethereum-classic",
            "",
            "m/44'/61'/0'/0/0",
            "0xFA22515E43658ce56A7682B801e9B5456f511420",
        ),
        (
            "ethereum-classic",
            "",
            "m/44'/60'/0'/0/0",
            "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        ),
        (
            "tron",
            "",
            "m/44'/195'/0'/0/0",
            "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
        ),
        (
            "tron",
            "",
            "m/44'/195'/3'/1/7",
            "TTD7MudE8L26nvnrEf2LHzXm6stKRpFZH1",
        ),
    ],
    startup: &[0, 2],
    elsewhere: 3,
    scanned: None,
    refused: &[(
        "tron",
        "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdJ",
        "checksum or format",
    )],
};

/// XRP addresses (TS `core/coins/xrp-self-test.ts`).
#[cfg(feature = "coin-xrp")]
const XRP: Family = Family {
    vectors: &[
        (
            "xrp",
            "",
            "m/44'/144'/0'/0/0",
            "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3",
        ),
        (
            "xrp",
            "",
            "m/44'/144'/3'/1/7",
            "rnU3BdqhZk8DL3FKjQcaAyf3DJSoUZD8eM",
        ),
    ],
    startup: &[0],
    elsewhere: 1,
    scanned: None,
    refused: &[(
        "xrp",
        "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v4",
        "checksum or format",
    )],
};

#[cfg(feature = "coin-bitcoin-cash")]
fn family_bitcoin_cash(tier: Tier) -> Result<(), CheckFailure> {
    BITCOIN_CASH.run(tier)
}

#[cfg(any(
    feature = "coin-bitcoin",
    feature = "coin-dogecoin",
    feature = "coin-litecoin",
    feature = "coin-zcash"
))]
fn family_bitcoin_like(tier: Tier) -> Result<(), CheckFailure> {
    BITCOIN_LIKE.run(tier)
}

#[cfg(any(feature = "coin-cosmos", feature = "coin-injective"))]
fn family_cosmos(tier: Tier) -> Result<(), CheckFailure> {
    COSMOS.run(tier)
}

#[cfg(feature = "coin-dash")]
fn family_dash(tier: Tier) -> Result<(), CheckFailure> {
    DASH.run(tier)
}

#[cfg(feature = "coin-ethereum")]
fn family_ethereum(tier: Tier) -> Result<(), CheckFailure> {
    ETHEREUM.run(tier)
}

#[cfg(any(feature = "coin-ethereum-classic", feature = "coin-tron"))]
fn family_evm(tier: Tier) -> Result<(), CheckFailure> {
    EVM.run(tier)
}

#[cfg(feature = "coin-xrp")]
fn family_xrp(tier: Tier) -> Result<(), CheckFailure> {
    XRP.run(tier)
}

/// The coins' rows of this build, in the order of the families' files.
pub(super) const ROWS: &[Row] = &[
    #[cfg(feature = "coin-bitcoin-cash")]
    Row::new(
        "Bitcoin Cash addresses",
        "4 addresses, another place, refusals",
        family_bitcoin_cash,
    ),
    #[cfg(any(
        feature = "coin-bitcoin",
        feature = "coin-dogecoin",
        feature = "coin-litecoin",
        feature = "coin-zcash"
    ))]
    Row::new(
        "Bitcoin, Litecoin, Dogecoin and Zcash addresses",
        "23 addresses, another place, a scan, refusals",
        family_bitcoin_like,
    ),
    #[cfg(any(feature = "coin-cosmos", feature = "coin-injective"))]
    Row::new(
        "Cosmos and Injective addresses",
        "3 addresses, another place, refusals",
        family_cosmos,
    ),
    #[cfg(feature = "coin-dash")]
    Row::new(
        "Dash addresses",
        "5 addresses, another place, a scan, refusals",
        family_dash,
    ),
    #[cfg(feature = "coin-ethereum")]
    Row::new(
        "Ethereum addresses",
        "2 addresses, another place, refusals",
        family_ethereum,
    ),
    #[cfg(any(feature = "coin-ethereum-classic", feature = "coin-tron"))]
    Row::new(
        "Ethereum Classic and Tron addresses",
        "4 addresses, another place, refusals",
        family_evm,
    ),
    #[cfg(feature = "coin-xrp")]
    Row::new(
        "XRP addresses",
        "2 addresses, another place, refusals",
        family_xrp,
    ),
];

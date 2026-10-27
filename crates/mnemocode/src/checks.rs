//! The self-test rows of the library (MnemoCode TS 0.1.0's `core/self-test.ts` and its feature
//! self-tests, CAP-PHRASE-FORMATS-SELF-TEST-KNOWN-ANSWERS), in the order of the report: each part's
//! known answers and refusals, run before any secret is asked ([`Tier::Startup`]) or on request
//! ([`Tier::Full`]). The rows of each part join here with the increment that builds the part.

mod candidates;
#[cfg(feature = "any-coin")]
mod coins;
pub mod public_vectors;
mod qr;
mod re_encoding;
#[cfg(feature = "coin-bitcoin")]
mod wallet;

use bip39::{Language, Mnemonic};
use sha2::{Digest, Sha256};

use crate::bip32::{ExtendedKey, fingerprint_hex};
use crate::bip39::phrase::{Phrase, legacy_valid_last_words};
use crate::bip39::seed::seed;
use crate::bip39::sizes::{WORD_COUNTS, entropy_bytes};
use crate::bip39::table::{self, Format, chinese, english};
use crate::dates::{Date, parse_date};
use crate::forms::Form;
use crate::forms::hints::{BIP39, LineWordHints, WordHint, WordHints, codes_list};
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;
pub(crate) use crate::self_check::ok;
use crate::self_check::vectors::{
    MASKED_DATE, MASKED_ENGLISH, PUBLIC_MNEMONIC, PUBLIC_MNEMONIC_24, SEEDSHIFT_DATES,
};
use crate::self_check::{Check, CheckFailure, Tier, expect_refused, expect_same};
use crate::text::hex::hex_of_bytes;
use public_vectors::{PUBLIC_VECTORS, PublicVector};

/// SHA-256 of each BIP39 word list joined by line feeds, as TS's lists give it.
const ENGLISH_SHA256: &str = "187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae";
const CHINESE_SHA256: &str = "407312f9014543242bd157c255125a753ac60128fc15883a33b8685a9328b0cc";
/// A phrase of the Original Seedshift's vector, its dates and its codes.
const LEGACY_SOURCE: &str =
    "oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog";
const LEGACY_DATES: [&str; 3] = ["10-07-1963", "27-04-1956", "31-01-1994"];
const LEGACY_ENGLISH: &str =
    "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";
/// The public phrase's last words and the Original Seedshift's with a valid last word, under
/// [`MASKED_DATE`], for each length: the phrase's last word, the codes' and how many phrases they
/// give.
const LEGACY_VALID_ANSWERS: [(usize, &str, &str, usize); 5] = [
    (12, "about", "actress", 128),
    (15, "address", "alert", 64),
    (18, "agent", "afford", 32),
    (21, "admit", "arrest", 16),
    (24, "art", "bridge", 8),
];
/// The BIP39 passphrase of the published vectors.
const VECTOR_PASSPHRASE: &str = "TREZOR";
/// The seed of the public phrase with [`VECTOR_PASSPHRASE`], and its master fingerprint.
const TREZOR_SEED: &str = "c55257c360c07c72029aebc1b53c05ed0362ada38ead3e3e9efa3708e53495531f09a6987599d18264c1e1c92f2cf141630c7a3c4ab7c81b2f001698e7463b04";
const TREZOR_FINGERPRINT: &str = "b4e3f5ed";
/// The seed of the public phrase with no passphrase.
const PUBLIC_SEED: &str = "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4";
/// A passphrase NFKD changes, and the public phrase's seed with it.
const UNICODE_PASSPHRASE: &str =
    "\u{dc}n\u{ef}c\u{f6}d\u{e9} \u{fb01} \u{30d1}\u{30b9}\u{30ef}\u{30fc}\u{30c9}";
const UNICODE_PASSPHRASE_SEED: &str = "44bc81fa7507a9b6d45ea4c5e011daaec62aa41bfc00e123b271dabd34c6f8fec7dbf5638eade336155e9fd229257cf328ad8368cb2c17f69d5582ab2403c935";
/// The English vectors of BIP39 (trezor/python-mnemonic, vectors.json): each phrase and its seed
/// with [`VECTOR_PASSPHRASE`].
const BIP39_VECTORS: [(&str, &str); 24] = [
    (PUBLIC_MNEMONIC, TREZOR_SEED),
    (
        "legal winner thank year wave sausage worth useful legal winner thank yellow",
        "2e8905819b8723fe2c1d161860e5ee1830318dbf49a83bd451cfb8440c28bd6fa457fe1296106559a3c80937a1c1069be3a3a5bd381ee6260e8d9739fce1f607",
    ),
    (
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
        "d71de856f81a8acc65e6fc851a38d4d7ec216fd0796d0a6827a3ad6ed5511a30fa280f12eb2e47ed2ac03b5c462a0358d18d69fe4f985ec81778c1b370b652a8",
    ),
    (
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong",
        "ac27495480225222079d7be181583751e86f571027b0497b5b5d11218e0a8a13332572917f0f8e5a589620c6f15b11c61dee327651a14c34e18231052e48c069",
    ),
    (
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon agent",
        "035895f2f481b1b0f01fcf8c289c794660b289981a78f8106447707fdd9666ca06da5a9a565181599b79f53b844d8a71dd9f439c52a3d7b3e8a79c906ac845fa",
    ),
    (
        "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal will",
        "f2b94508732bcbacbcc020faefecfc89feafa6649a5491b8c952cede496c214a0c7b3c392d168748f2d4a612bada0753b52a1c7ac53c1e93abd5c6320b9e95dd",
    ),
    (
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter always",
        "107d7c02a5aa6f38c58083ff74f04c607c2d2c0ecc55501dadd72d025b751bc27fe913ffb796f841c49b1d33b610cf0e91d3aa239027f5e99fe4ce9e5088cd65",
    ),
    (
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo when",
        "0cd6e5d827bb62eb8fc1e262254223817fd068a74b5b449cc2f667c3f1f985a76379b43348d952e2265b4cd129090758b3e3c2c49103b5051aac2eaeb890a528",
    ),
    (
        PUBLIC_MNEMONIC_24,
        "bda85446c68413707090a52022edd26a1c9462295029f2e60cd7c4f2bbd3097170af7a4d73245cafa9c3cca8d561a7c3de6f5d4a10be8ed2a5e608d68f92fcc8",
    ),
    (
        "legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title",
        "bc09fca1804f7e69da93c2f2028eb238c227f2e9dda30cd63699232578480a4021b146ad717fbb7e451ce9eb835f43620bf5c514db0f8add49f5d121449d3e87",
    ),
    (
        "letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic avoid letter advice cage absurd amount doctor acoustic bless",
        "c0c519bd0e91a2ed54357d9d1ebef6f5af218a153624cf4f2da911a0ed8f7a09e2ef61af0aca007096df430022f7a2b6fb91661a9589097069720d015e4e982f",
    ),
    (
        "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo vote",
        "dd48c104698c30cfe2b6142103248622fb7bb0ff692eebb00089b32d22484e1613912f0a5b694407be899ffd31ed3992c456cdf60f5d4564b8ba3f05a69890ad",
    ),
    (
        "ozone drill grab fiber curtain grace pudding thank cruise elder eight picnic",
        "274ddc525802f7c828d8ef7ddbcdc5304e87ac3535913611fbbfa986d0c9e5476c91689f9c8a54fd55bd38606aa6a8595ad213d4c9c9f9aca3fb217069a41028",
    ),
    (
        "gravity machine north sort system female filter attitude volume fold club stay feature office ecology stable narrow fog",
        "628c3827a8823298ee685db84f55caa34b5cc195a778e52d45f59bcf75aba68e4d7590e101dc414bc1bbd5737666fbbef35d1f1903953b66624f910feef245ac",
    ),
    (
        "hamster diagram private dutch cause delay private meat slide toddler razor book happy fancy gospel tennis maple dilemma loan word shrug inflict delay length",
        "64c87cde7e12ecf6704ab95bb1408bef047c22db4cc7491c4271d170a1b213d20b385bc1588d9c7b38f1b39d415665b8a9030c9ec653d75e65f847d8fc1fc440",
    ),
    (
        "scheme spot photo card baby mountain device kick cradle pact join borrow",
        "ea725895aaae8d4c1cf682c1bfd2d358d52ed9f0f0591131b559e2724bb234fca05aa9c02c57407e04ee9dc3b454aa63fbff483a8b11de949624b9f1831a9612",
    ),
    (
        "horn tenant knee talent sponsor spell gate clip pulse soap slush warm silver nephew swap uncle crack brave",
        "fd579828af3da1d32544ce4db5c73d53fc8acc4ddb1e3b251a31179cdb71e853c56d2fcb11aed39898ce6c34b10b5382772db8796e52837b54468aeb312cfc3d",
    ),
    (
        "panda eyebrow bullet gorilla call smoke muffin taste mesh discover soft ostrich alcohol speed nation flash devote level hobby quick inner drive ghost inside",
        "72be8e052fc4919d2adf28d5306b5474b0069df35b02303de8c1729c9538dbb6fc2d731d5f832193cd9fb6aeecbc469594a70e3dd50811b5067f3b88b28c3e8d",
    ),
    (
        "cat swing flag economy stadium alone churn speed unique patch report train",
        "deb5f45449e615feff5640f2e49f933ff51895de3b4381832b3139941c57b59205a42480c52175b6efcffaa58a2503887c1e8b363a707256bdd2b587b46541f5",
    ),
    (
        "light rule cinnamon wrap drastic word pride squirrel upgrade then income fatal apart sustain crack supply proud access",
        "4cbdff1ca2db800fd61cae72a57475fdc6bab03e441fd63f96dabd1f183ef5b782925f00105f318309a7e9c3ea6967c7801e46c8a58082674c860a37b93eda02",
    ),
    (
        "all hour make first leader extend hole alien behind guard gospel lava path output census museum junior mass reopen famous sing advance salt reform",
        "26e975ec644423f4a4c4f4215ef09b4bd7ef924e85d1d17c4cf3f136c2863cf6df0a475045652c57eb5fb41513ca2a2d67722b77e954b4b3fc11f7590449191d",
    ),
    (
        "vessel ladder alter error federal sibling chat ability sun glass valve picture",
        "2aaa9242daafcee6aa9d7269f17d4efe271e1b9a529178d7dc139cd18747090bf9d60295d0ce74309a78852a9caadf0af48aae1c6253839624076224374bc63f",
    ),
    (
        "scissors invite lock maple supreme raw rapid void congress muscle digital elegant little brisk hair mango congress clump",
        "7b4a10be9d98e6cba265566db7f136718e1398c71cb581e1b2f464cac1ceedf4f3e274dc270003c670ad8d02c4558b2f8e39edea2775c9e232c7cb798b069e88",
    ),
    (
        "void come effort suffer camp survey warrior heavy shoot primary clutch crush open amazing screen patrol group space point ten exist slush involve unfold",
        "01f5bced59dec48e362f2c45b5de68b9fd6c92c6634f44d6d40aab69056506f0e35524a518034ddc1192e1dacd32c1ed3eaa3c3b131c88ed8e7e54c49a5d0998",
    ),
];
/// The modes the representation matrix goes through, each forward and back in every form.
const MATRIX_MODES: [Mode; 3] = [Mode::Direct, Mode::Seedshift, Mode::SeedshiftLegacy];
/// The round trips of the representation matrix: every length, form and mode of it.
pub const ROUND_TRIPS: usize = WORD_COUNTS.len() * Form::ALL.len() * MATRIX_MODES.len();

/// One row: its name and what it covers, as the report shows them, and its cases.
#[derive(Debug)]
pub struct Row {
    name: &'static str,
    detail: &'static str,
    run: fn(Tier) -> Result<(), CheckFailure>,
}

impl Row {
    /// A row named `name`, covering `detail`, whose cases `run` runs.
    pub(crate) const fn new(
        name: &'static str,
        detail: &'static str,
        run: fn(Tier) -> Result<(), CheckFailure>,
    ) -> Self {
        Self { name, detail, run }
    }
}

impl Check for Row {
    fn name(&self) -> &'static str {
        self.name
    }

    fn detail(&self) -> &'static str {
        self.detail
    }

    fn run(&self, tier: Tier) -> Result<(), CheckFailure> {
        (self.run)(tier)
    }
}

/// The library's rows, in the report's order.
pub const ROWS: [Row; 11] = [
    Row {
        name: "Core integrity",
        detail: "word list and fixed forward/reverse vectors",
        run: core_integrity,
    },
    Row {
        name: "Public vectors",
        detail: "versioned JSON file",
        run: public_vectors,
    },
    Row {
        name: "Representation matrix",
        detail: "all lengths, formats, and modes",
        run: representation_matrix,
    },
    Row {
        name: "Date ordering",
        detail: "deterministic sorting",
        run: date_ordering,
    },
    Row {
        name: "Word lists",
        detail: "numbered English, Traditional Chinese, Unicode and full mapping; refusals",
        run: word_lists,
    },
    Row {
        name: "BIP39 seed",
        detail: "published seed, NFKD salt, refusals; 24 BIP39 vectors",
        run: bip39_seed,
    },
    Row {
        name: "Word hints",
        detail: "BIP39 words below a word typed, Tab completion, codes without hints",
        run: word_hints,
    },
    re_encoding::ROW,
    candidates::ROW,
    qr::PNG_ADMISSION,
    qr::QR_ADAPTER,
];

/// Every row of this build: the library's, then the coins' it holds.
pub fn rows() -> impl Iterator<Item = &'static Row> {
    #[cfg(feature = "any-coin")]
    let coins = coins::ROWS;
    #[cfg(not(feature = "any-coin"))]
    let coins: &[Row] = &[];
    #[cfg(feature = "coin-bitcoin")]
    let wallet: &[Row] = &[wallet::ROW];
    #[cfg(not(feature = "coin-bitcoin"))]
    let wallet: &[Row] = &[];
    ROWS.iter().chain(wallet).chain(coins)
}

/// The startup cases of every row, before any secret is asked; fails at the first difference.
pub fn startup() -> Result<(), CheckFailure> {
    rows().try_for_each(|row| row.run(Tier::Startup))
}

/// The dates written DD-MM-YYYY.
fn dates_of(texts: &[&str]) -> Result<Vec<Date>, CheckFailure> {
    texts.iter().map(|text| ok(parse_date(text))).collect()
}

/// SHA-256 of `words` joined by line feeds, in hexadecimal.
fn digest(words: &[&str]) -> String {
    hex_of_bytes(&Sha256::digest(words.join("\n").as_bytes()))
}

/// The codes `text` in `form`, read back with `dates` in `mode`: the first phrase they give, in
/// English words.
fn decoded(mode: Mode, form: Form, text: &str, dates: &[Date]) -> Result<String, CheckFailure> {
    let indexes = Indexes::new(ok(form.read(text))?);
    let phrases = ok(mode.undo(&indexes, dates))?;
    let first = phrases
        .first()
        .ok_or(CheckFailure::Mismatch("Decoded phrase"))?;
    ok(Form::English.codes(first.recovered.as_slice()))
}

/// Every form of `vector`, forward and back.
fn check_vector(vector: &PublicVector) -> Result<(), CheckFailure> {
    let phrase = ok(Phrase::parse(vector.source))?;
    let dates = dates_of(vector.dates)?;
    let masked = ok(vector.mode.encode(&phrase, &dates))?;
    let forms = [
        (Form::English, vector.english),
        (Form::Indexes, vector.indexes),
        (Form::Unicode, vector.unicode),
        (Form::Colors, vector.colors),
        (Form::ColorsUnicode, vector.colors_unicode),
    ];
    for (form, codes) in forms {
        expect_same(
            ok(form.codes(masked.shifted.as_slice()))?.as_str(),
            codes,
            vector.name,
        )?;
        expect_same(
            decoded(vector.mode, form, codes, &dates)?.as_str(),
            vector.source,
            vector.name,
        )?;
    }
    if let Some(expected) = vector.source_fingerprint {
        let fingerprint = ok(ok(ExtendedKey::of_phrase(&phrase, ""))?.fingerprint())?;
        expect_same(fingerprint_hex(fingerprint).as_str(), expected, vector.name)?;
    }
    if let Some(expected) = vector.encoded_fingerprint {
        let codes = ok(Phrase::parse(vector.english))?;
        let fingerprint = ok(ok(ExtendedKey::of_phrase(&codes, ""))?.fingerprint())?;
        expect_same(fingerprint_hex(fingerprint).as_str(), expected, vector.name)?;
    }
    Ok(())
}

/// The word lists, the fixed vectors of each mode and the refusals of the forms: quick enough
/// before every command.
fn core_integrity(_: Tier) -> Result<(), CheckFailure> {
    expect_same(
        digest(english()).as_str(),
        ENGLISH_SHA256,
        "English BIP39 word-list SHA-256",
    )?;
    expect_same(
        digest(chinese()).as_str(),
        CHINESE_SHA256,
        "Traditional Chinese BIP39 word-list SHA-256",
    )?;
    for vector in &PUBLIC_VECTORS[..2] {
        check_vector(vector)?;
    }
    let about = ok(legacy_valid_last_words(PUBLIC_MNEMONIC))?
        .into_iter()
        .find(|candidate| english()[candidate.index] == "about")
        .map(|candidate| candidate.index);
    expect_same(&about, &Some(3), "Final-word BIP39 index")?;
    let legacy_last_words = ok(legacy_valid_last_words(LEGACY_ENGLISH))?;
    expect_same(
        &legacy_last_words.len(),
        &128,
        "Legacy final-word candidate count",
    )?;
    expect_same(
        &legacy_last_words
            .iter()
            .filter(|candidate| candidate.preserves_entropy)
            .count(),
        &1,
        "Legacy entropy-preserving final-word count",
    )?;
    let masked_date = dates_of(&[MASKED_DATE])?;
    expect_same(
        &Phrase::parse(MASKED_ENGLISH).is_ok(),
        &true,
        "Checksum-valid Seedshift checksum",
    )?;
    let legacy_dates = dates_of(&LEGACY_DATES)?;
    let legacy =
        ok(Mode::SeedshiftLegacy.encode(&ok(Phrase::parse(LEGACY_SOURCE))?, &legacy_dates))?;
    expect_same(
        ok(Form::English.codes(legacy.shifted.as_slice()))?.as_str(),
        LEGACY_ENGLISH,
        "Legacy Seedshift vector",
    )?;
    expect_same(
        decoded(
            Mode::SeedshiftLegacy,
            Form::English,
            LEGACY_ENGLISH,
            &legacy_dates,
        )?
        .as_str(),
        LEGACY_SOURCE,
        "Legacy Seedshift reverse vector",
    )?;
    let ones = "1 ".repeat(11);
    for bad in ["0", "2049"] {
        expect_refused(
            Form::Indexes.read(&format!("{bad} {ones}4")),
            "core.words.indexes-use-seedshift-compatible-numbering-from",
            "Direct word number",
        )?;
    }
    let invalid = Indexes::new(ok(Form::Indexes.read(&"1 ".repeat(12)))?);
    expect_same(
        &ok(Mode::Direct.undo(&invalid, &[]))?
            .first()
            .map(|phrase| phrase.checksum_valid),
        &Some(false),
        "Bad direct checksum",
    )?;
    expect_refused(
        Mode::Seedshift.undo(&invalid, &masked_date),
        "core.masking.missing-checksum",
        "Bad Seedshift container",
    )?;
    expect_refused(
        Form::ColorsUnicode.read(&format!(
            "F8FFF8FF{}",
            &PUBLIC_VECTORS[0].colors_unicode[8..]
        )),
        "core.colors.color-unicode-contains-value-outside-rrggbb-range",
        "Color Unicode beyond RGB",
    )?;
    expect_refused(
        Form::named("unknown"),
        "core.encoded-form.unsupported-encoded-format",
        "Unknown representation",
    )?;
    for (words, source_last, stored_last, candidates) in LEGACY_VALID_ANSWERS {
        let source = format!("{}{source_last}", "abandon ".repeat(words - 1));
        let stored = format!(
            "{}wool abuse {stored_last}",
            "wool abuse actual ".repeat(words / 3 - 1)
        );
        let masked =
            ok(Mode::SeedshiftLegacyValid.encode(&ok(Phrase::parse(&source))?, &masked_date))?;
        expect_same(
            ok(Form::English.codes(masked.shifted.as_slice()))?.as_str(),
            stored.as_str(),
            "Legacy-valid encoding",
        )?;
        let indexes = Indexes::new(ok(Form::English.read(&stored))?);
        let recovered = ok(Mode::SeedshiftLegacyValid.undo(&indexes, &masked_date))?;
        expect_same(&recovered.len(), &candidates, "Legacy-valid candidates")?;
        let source_indexes = ok(Form::English.read(&source))?;
        expect_same(
            &recovered
                .iter()
                .any(|phrase| phrase.recovered.as_slice() == source_indexes),
            &true,
            "Legacy-valid source",
        )?;
    }
    Ok(())
}

/// Every form and fingerprint of every public vector.
fn public_vectors(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    PUBLIC_VECTORS.iter().try_for_each(check_vector)
}

/// Every phrase length of counting entropy in every form and mode, forward and back.
fn representation_matrix(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let dates = dates_of(&SEEDSHIFT_DATES)?;
    for words in WORD_COUNTS {
        let entropy: Vec<u8> = (0..entropy_bytes(words)).map(|byte| byte as u8).collect();
        let mnemonic = Mnemonic::from_entropy_in(Language::English, &entropy)
            .map_err(|_| CheckFailure::Mismatch("Counting entropy"))?;
        let indexes: Vec<usize> = mnemonic.word_indices().collect();
        let phrase = ok(Phrase::of_indexes(&indexes))?;
        for form in Form::ALL {
            for mode in MATRIX_MODES {
                let dates = if mode.masked() { &dates[..] } else { &[] };
                let masked = ok(mode.encode(&phrase, dates))?;
                let text = ok(form.codes(masked.shifted.as_slice()))?;
                let read = Indexes::new(ok(form.read(&text))?);
                let back = ok(mode.undo(&read, dates))?;
                let same = back.first().is_some_and(|phrase| {
                    phrase
                        .recovered
                        .as_slice()
                        .iter()
                        .map(|&index| usize::from(index))
                        .eq(indexes.iter().copied())
                });
                expect_same(&same, &true, "Representation round trip")?;
            }
        }
    }
    Ok(())
}

/// The same codes whatever order the dates are given in.
fn date_ordering(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let phrase = ok(Phrase::parse(PUBLIC_MNEMONIC))?;
    let first = dates_of(&SEEDSHIFT_DATES)?;
    let reversed: Vec<Date> = first.iter().rev().copied().collect();
    expect_same(
        ok(Mode::Seedshift.encode(&phrase, &first))?
            .shifted
            .as_slice(),
        ok(Mode::Seedshift.encode(&phrase, &reversed))?
            .shifted
            .as_slice(),
        "Date-order independence",
    )
}

/// The numbered dictionaries in every format, and an unknown format refused.
fn word_lists(_: Tier) -> Result<(), CheckFailure> {
    let answers = [
        (
            None,
            "index\tenglish\tunicode_hex",
            "1\tabandon\t7684",
            "2048\tzoo\t6B47",
        ),
        (
            Some(Format::English),
            "index  english",
            "    1  abandon",
            " 2048  zoo",
        ),
        (
            Some(Format::Chinese),
            "index  chinese",
            "    1  的",
            " 2048  歇",
        ),
        (
            Some(Format::Unicode),
            "index  unicode_hex  chinese",
            "    1  7684         的",
            " 2048  6B47         歇",
        ),
        (
            Some(Format::Mapping),
            "index  english   unicode_hex  chinese",
            "    1  abandon   7684         的",
            " 2048  zoo       6B47         歇",
        ),
    ];
    for (format, header, first, last) in answers {
        let text = table::text(format);
        let rows: Vec<&str> = text.trim_end().split('\n').collect();
        expect_same(&rows.len(), &2049, "Numbered dictionary row count")?;
        expect_same(
            &rows.first().copied(),
            &Some(header),
            "Numbered dictionary header",
        )?;
        expect_same(
            &rows.get(1).copied(),
            &Some(first),
            "Numbered dictionary first word",
        )?;
        expect_same(
            &rows.last().copied(),
            &Some(last),
            "Numbered dictionary last word",
        )?;
    }
    expect_refused(
        Format::named("unknown"),
        "core.words.word-table-format",
        "An unknown numbered dictionary format",
    )
}

/// The seed and master fingerprint of the published vector, a composed passphrase as its NFKD,
/// and an incomplete phrase refused; the full tier adds every BIP39 vector.
fn bip39_seed(tier: Tier) -> Result<(), CheckFailure> {
    let public = ok(Phrase::parse(PUBLIC_MNEMONIC))?;
    let fingerprint = ok(ok(ExtendedKey::of_phrase(&public, VECTOR_PASSPHRASE))?.fingerprint())?;
    expect_same(
        fingerprint_hex(fingerprint).as_str(),
        TREZOR_FINGERPRINT,
        "Master fingerprint of the first BIP39 vector",
    )?;
    expect_same(
        &*ok(seed(&public, "caf\u{e9}"))?,
        &*ok(seed(&public, "cafe\u{301}"))?,
        "NFKD passphrase of the BIP39 seed",
    )?;
    let eleven = PUBLIC_MNEMONIC.trim_end_matches(" about");
    expect_refused(
        Phrase::parse(eleven),
        "core.words.enter-english-bip39-words",
        "A phrase of eleven words",
    )?;
    if tier == Tier::Startup {
        return Ok(());
    }
    let seed_hex = |text: &str, passphrase: &str| -> Result<String, CheckFailure> {
        Ok(hex_of_bytes(&ok(seed(
            &ok(Phrase::parse(text))?,
            passphrase,
        ))?))
    };
    for (text, expected) in BIP39_VECTORS {
        expect_same(
            seed_hex(text, VECTOR_PASSPHRASE)?.as_str(),
            expected,
            "BIP39 seed vector",
        )?;
    }
    expect_same(
        seed_hex(PUBLIC_MNEMONIC, "")?.as_str(),
        PUBLIC_SEED,
        "BIP39 seed without a passphrase",
    )?;
    expect_same(
        seed_hex(PUBLIC_MNEMONIC, UNICODE_PASSPHRASE)?.as_str(),
        UNICODE_PASSPHRASE_SEED,
        "BIP39 seed of a Unicode passphrase",
    )
}

/// The hint as the case table writes it.
fn hint_text(hint: &WordHint) -> String {
    match hint {
        WordHint::Nothing => "nothing".to_owned(),
        WordHint::Count(_, text) => format!("count {text}"),
        WordHint::Words(words) => format!("words {}", words.join(" ")),
        WordHint::NoWord(text) => format!("no-word {text}"),
    }
}

/// Hints below typed words and codes, and Tab completion.
fn word_hints(_: Tier) -> Result<(), CheckFailure> {
    let codes = LineWordHints::new(codes_list, |line| line);
    let cases: [(&dyn WordHints, &str, &str, &'static str); 8] = [
        (
            &*BIP39,
            "z",
            "count 4 BIP39 words begin with this letter",
            "Count of a letter",
        ),
        (
            &*BIP39,
            "abandon AB",
            "words abandon ability able about above absent absorb abstract absurd abuse",
            "Words of two letters",
        ),
        (
            &*BIP39,
            "xq",
            "no-word No BIP39 word begins like this.",
            "No word",
        ),
        (
            &*BIP39,
            "art",
            "words art artefact artist artwork",
            "Word that begins others",
        ),
        (
            &*BIP39,
            "toolongforanyword",
            "no-word No BIP39 word begins like this.",
            "Long word",
        ),
        (&*BIP39, "abandon ?", "nothing", "Mark"),
        (&codes, "abandon zo", "words zone zoo", "English codes"),
        (&codes, "7684 5728 CA", "nothing", "Unicode codes"),
    ];
    for (hints, line, expected, name) in cases {
        expect_same(hint_text(&hints.hint(line)).as_str(), expected, name)?;
    }
    let completion = |line: &str| {
        let completion = BIP39.completion(line);
        format!("{} {}", completion.letters, completion.word_ends)
    };
    expect_same(
        completion("ABOU").as_str(),
        "t true",
        "Completion of a word",
    )?;
    expect_same(
        completion("artw").as_str(),
        "ork true",
        "Completion of letters",
    )?;
    expect_same(
        completion("abs").as_str(),
        " false",
        "Completion of words that differ",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_row_passes_in_both_tiers() {
        for row in rows() {
            assert_eq!(row.run(Tier::Startup), Ok(()), "{}", row.name());
            assert_eq!(row.run(Tier::Full), Ok(()), "{}", row.name());
        }
        assert_eq!(ROUND_TRIPS, 75);
    }
}

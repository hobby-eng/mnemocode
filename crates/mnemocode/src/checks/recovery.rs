//! The rows of how a backup is read and checked (MnemoCode TS 0.1.0's
//! `core/backup-reading-self-test.ts` and `backup-check-self-test.ts`): codes marked with ?, shares
//! told from the codes of a phrase, the encoded fingerprint, and a written backup checked. What TS
//! checks of an owner after it was wiped has no case here: an owner that was dropped cannot be
//! called. Public data only.

use super::{Row, ok};
use crate::backup::Backup;
use crate::bip32::fingerprint_hex;
use crate::bip39::phrase::Phrase;
use crate::dates::{Dates, parse_date};
use crate::forms::Form;
use crate::forms::colors::word_position_placements;
use crate::modes::Mode;
use crate::modes::seedshift::Indexes;
use crate::recovery::backup_check::{
    BackupPart, BackupResult, BackupVerdict, EncodedBackupCheck, EncodedOriginal, WrittenBackup,
};
#[cfg(feature = "sskr")]
use crate::recovery::backup_check::{ShareBackupCheck, ShareOriginal};
use crate::recovery::marked::MissingCodes;
#[cfg(feature = "sskr")]
use crate::recovery::reading::ShareKind;
use crate::recovery::reading::{BackupReading, ReadingRules};
#[cfg(any(feature = "search-date", feature = "search-word"))]
use crate::recovery::wallet_check::WalletCheck;
#[cfg(any(feature = "search-date", feature = "search-word"))]
use crate::search::{Search, Step};
#[cfg(any(feature = "search-date", feature = "search-word"))]
use crate::self_check::vectors::PUBLIC_FINGERPRINT;
use crate::self_check::vectors::{
    ENCODED_FINGERPRINT, MASKED_DATE, MASKED_ENGLISH, MASKED_NUMBERS, PUBLIC_MNEMONIC,
};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};
#[cfg(feature = "sskr")]
use crate::sskr::typed::ShareInput;
use crate::text::codes::UNICODE_CODE_DIGITS;
use crate::text::pieces::text_pieces;
#[cfg(any(feature = "search-date", feature = "search-word"))]
use crate::wallet::evidence::Evidence;

/// The candidates a step of a search checks here.
#[cfg(any(feature = "search-date", feature = "search-word"))]
const STEP_WORK: u32 = 4096;
/// What the rows call the host's reader of shares and of an encoded phrase.
const SHARE_READER: &str = "the share reader";
#[cfg(feature = "sskr")]
const DECODE_ENTRY: &str = "Decode";
/// The masked phrase of the Seedshift vector in colors ([`MASKED_ENGLISH`]).
const MASKED_COLORS: &str = "#0317CC #200B38 #4020CC #5D1438 #7D29CC #9A1D38 #BA32CC #D72799";
/// The word numbers of the first share of the official BCR-2020-011 vector, and its colors.
#[cfg(feature = "sskr")]
const SHARE_NUMBERS: &str =
    "527 288 1158 1328 5 1544 734 1605 1692 1812 710 1654 2045 598 582 241 365 1779 1467 551 897";
#[cfg(feature = "sskr")]
const SHARE_COLORS: &str =
    "#41C47E #42D1F0 #0981D6 #EE44D3 #7C4D62 #E75FF8 #955228 #F02D9B #CADD22 #670000";

/// A marked backup, and what its marks leave, counted independently with Python's hashlib.
struct MarkedCase {
    text: &'static str,
    form: Form,
    /// The combinations of codes that the marks allow.
    combinations: u64,
    /// The combinations that keep the BIP39 checksum.
    candidates: u64,
    /// Where the right codes come among them, counted from 1.
    right: u64,
}

/// A ? for one digit of a word number at place 2 and one at place 12: 10 numbers each.
const MARKED_DIGITS: MarkedCase = MarkedCase {
    text: "2027 1? 24 2027 10 24 2027 10 24 2027 10 3?7",
    form: Form::Indexes,
    combinations: 100,
    candidates: 4,
    right: 2,
};
/// A ? for one digit of a Unicode code at place 5, which two codes fit, and a whole code at 12.
const MARKED_UNICODE: MarkedCase = MarkedCase {
    text: "8F44 9019 5011 8F44 9?19 5011 8F44 9019 5011 8F44 9019 ?",
    form: Form::Unicode,
    combinations: 4_096,
    candidates: 256,
    right: 24,
};
/// The first color unread: any word fits place 1, and 21 word numbers place 2.
const MARKED_COLOR: MarkedCase = MarkedCase {
    text: "? #200B38 #4020CC #5D1438 #7D29CC #9A1D38 #BA32CC #D72799",
    form: Form::Colors,
    combinations: 43_008,
    candidates: 2_655,
    right: 2_627,
};

/// The backup reading row.
pub(super) const BACKUP_READING: Row = Row::new(
    "Backup reading",
    "codes marked with ?, shares told apart; encoded search",
    backup_reading,
);

/// The backup check row.
pub(super) const BACKUP_CHECK: Row = Row::new(
    "Backup check",
    if cfg!(feature = "sskr") {
        "codes and dates right and wrong; shares"
    } else {
        "codes and dates right and wrong"
    },
    backup_check,
);

/// What `search` gives when nothing stops it.
#[cfg(any(feature = "search-date", feature = "search-word"))]
pub(super) fn ran<S: Search>(mut search: S) -> Result<S::Outcome, CheckFailure> {
    while let Step::Running(_) = ok(search.step(STEP_WORK))? {}
    Ok(search.finish())
}

/// The wallet of the public phrase.
#[cfg(any(feature = "search-date", feature = "search-word"))]
pub(super) fn public_wallet() -> Result<WalletCheck, CheckFailure> {
    Ok(WalletCheck::new(
        ok(Evidence::master_fingerprint(PUBLIC_FINGERPRINT))?,
        "",
    ))
}

/// The masked phrase's word numbers, counted from 1, as BIP39 indexes from 0.
pub(super) fn masked_indexes() -> Vec<u16> {
    MASKED_NUMBERS
        .split(' ')
        .filter_map(|number| number.parse::<u16>().ok())
        .map(|number| number - 1)
        .collect()
}

// How a backup is read.

/// `text`, codes separated by spaces, with those at `places`, from 1, marked with ?.
#[cfg(feature = "sskr")]
pub(super) fn with_marks(text: &str, places: &[usize]) -> String {
    let codes: Vec<&str> = text
        .split(' ')
        .enumerate()
        .map(|(index, code)| {
            if places.contains(&(index + 1)) {
                "?"
            } else {
                code
            }
        })
        .collect();
    codes.join(" ")
}

/// The candidates of `marked` with Seedshift's checksum: their count, and where the right codes
/// come among them.
fn check_marked(marked: &MarkedCase) -> Result<(), CheckFailure> {
    let codes = ok(MissingCodes::read(
        marked.text,
        marked.form,
        Mode::Seedshift,
    ))?;
    expect_same(
        &codes.combinations(),
        &marked.combinations,
        "Marked combinations",
    )?;
    let wanted = masked_indexes();
    let mut candidates = codes.candidates();
    let (mut count, mut right) = (0, 0);
    while let Some(candidate) = candidates.next_codes() {
        count += 1;
        if right == 0 && candidate.as_slice() == wanted.as_slice() {
            right = count;
        }
    }
    expect_same(&count, &marked.candidates, "Marked candidates")?;
    expect_same(&right, &marked.right, "Marked right codes")
}

/// A rotated unread color must not exclude the placement of the published direct-12 vector; the
/// first six decimal digits of its payload removed, these word numbers are left.
fn check_color_placements() -> Result<(), CheckFailure> {
    const EXPECTED: &str = "???? ??01 0001 0001 0001 0001 0001 0001 0001 0001 0001 0004";
    let colors: Vec<Option<String>> = super::PUBLIC_VECTORS[0]
        .colors
        .split(' ')
        .skip(1)
        .map(|color| Some(color.to_owned()))
        .chain([None])
        .collect();
    let placements = ok(word_position_placements(&colors))?;
    expect_same(
        &placements.iter().any(|place| place.join(" ") == EXPECTED),
        &true,
        "Reordered colors keep the missing leading color",
    )
}

/// Color Unicode with its last code unread, as codes and as the characters they are, read with a
/// declared word count.
fn check_marked_color_unicode() -> Result<(), CheckFailure> {
    let mut codes: Vec<String> = ok(text_pieces(
        super::PUBLIC_VECTORS[0].colors_unicode,
        UNICODE_CODE_DIGITS,
    ))?
    .iter()
    .map(|code| (*code).to_owned())
    .collect();
    if let Some(last) = codes.last_mut() {
        "?".clone_into(last);
    }
    let characters: String = codes
        .iter()
        .map(|code| {
            u32::from_str_radix(code, 16)
                .ok()
                .and_then(char::from_u32)
                .unwrap_or('?')
        })
        .collect();
    for text in [codes.join(" "), characters] {
        let reading = ok(BackupReading::of(
            &format!("MNC1:direct:colors-unicode:{text}"),
            ReadingRules {
                seedshift_only: false,
                share_reader: SHARE_READER,
                words: Some(12),
            },
        ))?;
        expect_same(
            &reading.marked(),
            &true,
            "Color Unicode mark with a word count",
        )?;
    }
    Ok(())
}

/// What is read as a share in place of the codes, and what is not.
#[cfg(feature = "sskr")]
fn check_shares_told_apart() -> Result<(), CheckFailure> {
    let kind = |text: &str| ok(BackupReading::share_kind(text));
    expect_same(
        &kind(SHARE_COLORS)?,
        &Some(ShareKind::Share),
        "A share in place of the codes",
    )?;
    expect_same(
        &kind(&SHARE_COLORS.replace("#7C4D62", "?"))?,
        &Some(ShareKind::Share),
        "A marked share in place of the codes",
    )?;
    expect_same(
        &kind("not-a-share\nalso-not-a-share")?,
        &None,
        "Unreadable lines are no share",
    )?;
    // 21 word numbers are a share or the codes of a 21-word phrase. Two numbers unread are 22 bits,
    // which the share's checksum settles; three are 33, more than its 32 bits, so either may fit.
    expect_same(
        &kind(&with_marks(SHARE_NUMBERS, &[2, 6]))?,
        &Some(ShareKind::Share),
        "A share in word numbers with two marks",
    )?;
    expect_same(
        &kind(&with_marks(SHARE_NUMBERS, &[2, 6, 10]))?,
        &Some(ShareKind::Either),
        "A share in word numbers with three marks",
    )?;
    expect_same(&kind(MASKED_ENGLISH)?, &None, "The codes of a phrase")?;
    expect_same(
        &kind(MARKED_DIGITS.text)?,
        &None,
        "Marked codes of a phrase",
    )?;
    {
        let [first, _, third, ..] = crate::self_check::vectors::OFFICIAL_SHARES;
        let lines = format!("{first}\n{third}");
        expect_same(
            &kind(&lines)?,
            &Some(ShareKind::Share),
            "Several shares in place of the codes",
        )?;
        let parts = ok(ShareInput::parts_of_text(&lines))?;
        expect_same(
            &parts,
            &vec![first.to_owned(), third.to_owned()],
            "Every share line is kept",
        )?;
    }
    expect_refused(
        BackupReading::of(
            SHARE_COLORS,
            ReadingRules {
                seedshift_only: false,
                share_reader: SHARE_READER,
                words: None,
            },
        ),
        "core.backup-reading.shamir-share-not-encoded-seed-phrase-reads",
        "A share given as an encoded phrase",
    )
}

/// The refusals of marks, and what each mode keeps of the candidates: codes without Seedshift are
/// the phrase itself, whose checksum holds them as Seedshift's does; the Original Seedshift, with
/// no checksum of its own, does not narrow them.
fn check_marks() -> Result<(), CheckFailure> {
    let digits = MARKED_DIGITS.text;
    let forms: Vec<&str> = MissingCodes::forms(digits)
        .iter()
        .map(|form| form.name())
        .collect();
    expect_same(
        forms.as_slice(),
        ["indexes"].as_slice(),
        "Forms of marked word numbers",
    )?;
    let unchecked = ok(MissingCodes::read(
        digits,
        Form::Indexes,
        Mode::SeedshiftLegacy,
    ))?;
    expect_same(
        &unchecked.expected(),
        &MARKED_DIGITS.combinations,
        "Original Seedshift candidates",
    )?;
    let direct = ok(MissingCodes::read(digits, Form::Indexes, Mode::Direct))?;
    let mut candidates = direct.candidates();
    let mut count = 0;
    while candidates.next_codes().is_some() {
        count += 1;
    }
    expect_same(
        &count,
        &MARKED_DIGITS.candidates,
        "Candidates without Seedshift",
    )?;
    expect_refused(
        MissingCodes::read(
            &MASKED_COLORS.replace("#200B38", "#200B3?"),
            Form::Colors,
            Mode::Seedshift,
        ),
        "core.missing-codes.mark-color-cannot-read-one-place-whole-color",
        "A color with a digit marked",
    )?;
    expect_refused(
        MissingCodes::read(MASKED_NUMBERS, Form::Indexes, Mode::Seedshift),
        "core.missing-codes.no-code-marked-mark-each-code-cannot-read",
        "Codes without a mark",
    )?;
    expect_refused(
        MissingCodes::read(
            &MASKED_NUMBERS.replace("377", "2049"),
            Form::Indexes,
            Mode::Seedshift,
        ),
        "core.missing-codes.word-number-no-number-from",
        "A word number of 2049",
    )
}

/// The candidates of an unread color, and the encoded fingerprint of the masked phrase with the
/// search of marked codes that it decides, which keeps exactly the codes written.
fn check_encoded_search() -> Result<(), CheckFailure> {
    check_marked(&MARKED_COLOR)?;
    let backup = ok(Backup::read(MASKED_ENGLISH, Form::English, Mode::Seedshift))?;
    let fingerprint = ok(backup.fingerprint())?.map(fingerprint_hex);
    expect_same(
        &fingerprint.as_deref(),
        &Some(ENCODED_FINGERPRINT),
        "Encoded fingerprint",
    )?;
    let codes = ok(MissingCodes::read(
        MARKED_DIGITS.text,
        Form::Indexes,
        Mode::Seedshift,
    ))?;
    let mut candidates = codes.candidates();
    let (mut count, mut passed) = (0, Vec::new());
    while let Some(candidate) = candidates.next_codes() {
        count += 1;
        let backup = ok(Backup::of(
            candidate.as_slice(),
            Form::Indexes,
            Mode::Seedshift,
        ))?;
        if ok(backup.fingerprint())?.map(fingerprint_hex).as_deref() == Some(ENCODED_FINGERPRINT) {
            passed.push(ok(backup.text())?);
        }
    }
    expect_same(&count, &MARKED_DIGITS.candidates, "Marked codes checked")?;
    expect_same(
        &passed.join(" "),
        &MASKED_NUMBERS.to_owned(),
        "Marked codes found",
    )
}

/// The backup reading row.
fn backup_reading(tier: Tier) -> Result<(), CheckFailure> {
    check_color_placements()?;
    check_marked_color_unicode()?;
    check_marked(&MARKED_DIGITS)?;
    check_marked(&MARKED_UNICODE)?;
    check_marks()?;
    #[cfg(feature = "sskr")]
    check_shares_told_apart()?;
    if tier == Tier::Startup {
        return Ok(());
    }
    check_encoded_search()
}

// The check of a written backup.

/// A result as its verdict and the part and places of its finding.
fn verdict_of(result: &BackupResult) -> (BackupVerdict, Option<BackupPart>, Vec<usize>) {
    let (part, places) = result
        .finding
        .as_ref()
        .map_or((None, Vec::new()), |finding| {
            (Some(finding.part), finding.places.clone())
        });
    (result.verdict, part, places)
}

/// Shares of the published set typed again: two of them right, one with a color unread right too,
/// two of another set wrong, and one with a wrong color unreadable at its place.
#[cfg(feature = "sskr")]
fn check_share_backup() -> Result<(), CheckFailure> {
    /// Two shares of another set of vectors/sskr-v1.json, "bip39-160-2-of-3".
    const OTHER_SET: &str = "ur:sskr/hdcfemjzaeadaentleykkitkwlptsskispvwbkbwjnamsttssnpmhpgwmoetcm; ur:sskr/hdcfemjzaeadadfdsfbbvospcheycndschfhcmkelyvavefzfewezsinfdtbfz";
    let check = ok(ShareBackupCheck::new(
        ShareOriginal {
            phrase: ok(Phrase::parse(super::sskr::SET_PHRASE))?,
            mode: Mode::Direct,
            threshold: 2,
            dates: None,
        },
        DECODE_ENTRY,
    ))?;
    let [first, _, third] = super::sskr::SET_SHARES;
    let [first_colors, second_colors] = super::sskr::SET_COLORS;
    let right = format!("{first}; {third}");
    let marked = format!("{}; {second_colors}", first_colors.replace("#0CF800", "?"));
    let wrong = format!(
        "{}; {second_colors}",
        first_colors.replace("#0CF800", "#0CF801")
    );
    let cases: [(&str, BackupVerdict, Vec<usize>, &'static str); 4] = [
        (
            &right,
            BackupVerdict::Restores,
            Vec::new(),
            "Share check of the set",
        ),
        (
            &marked,
            BackupVerdict::Restores,
            Vec::new(),
            "Marked share check",
        ),
        (
            OTHER_SET,
            BackupVerdict::Differs,
            Vec::new(),
            "Share check of another set",
        ),
        (
            &wrong,
            BackupVerdict::Unreadable,
            vec![1],
            "Share check with a wrong color",
        ),
    ];
    for (backup, verdict, places, name) in cases {
        let result = ok(check.check(WrittenBackup {
            backup,
            dates: None,
        }))?;
        let (found, _, at) = verdict_of(&result);
        expect_same(&(found, at), &(verdict, places), name)?;
    }
    Ok(())
}

/// The backup check row: the published Seedshift vector typed again, right, with a wrong date and
/// with a wrong word; in the full self-test the shares.
fn backup_check(tier: Tier) -> Result<(), CheckFailure> {
    let date = ok(parse_date(MASKED_DATE))?;
    let check = ok(EncodedBackupCheck::new(EncodedOriginal {
        phrase: ok(Phrase::parse(PUBLIC_MNEMONIC))?,
        form: Form::English,
        mode: Mode::Seedshift,
        codes: Indexes::new(masked_indexes()),
        dates: Dates::new(&[date]),
    }))?;
    let wrong_word = MASKED_ENGLISH.replacen("actual", "wool", 1);
    let right = (BackupVerdict::Restores, None, Vec::new());
    let at = |part, place| (BackupVerdict::Differs, Some(part), vec![place]);
    let cases = [
        (
            MASKED_ENGLISH,
            MASKED_DATE,
            right,
            "Backup check of the Seedshift vector",
        ),
        (
            MASKED_ENGLISH,
            "24-09-2026",
            at(BackupPart::Dates, 1),
            "Backup check with a wrong date",
        ),
        (
            wrong_word.as_str(),
            MASKED_DATE,
            at(BackupPart::Codes, 3),
            "Backup check with a wrong word",
        ),
    ];
    for (backup, dates, wanted, name) in cases {
        let result = ok(check.check(WrittenBackup {
            backup,
            dates: Some(dates),
        }))?;
        expect_same(&verdict_of(&result), &wanted, name)?;
    }
    #[cfg(feature = "sskr")]
    if tier == Tier::Full {
        check_share_backup()?;
    }
    #[cfg(not(feature = "sskr"))]
    let _ = tier;
    Ok(())
}

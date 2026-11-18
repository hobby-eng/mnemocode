//! The re-encoding row (MnemoCode TS 0.1.0's `core/re-encoding-self-test.ts`,
//! CAP-PHRASE-FORMATS-REENCODING-CONFIRMATION): a backup decoded, held back until confirmed by the
//! person or the wallet, and encoded again; the Original Seedshift both as the original program
//! writes it and with the last word MnemoCode writes, and the refusals.

use super::{Row, ok};
use crate::backup::Backup;
use crate::backup::re_encoding::{MatchedBy, ReEncoding};
use crate::bip39::table::english;
use crate::dates::{Date, parse_date};
use crate::forms::Form;
use crate::modes::Mode;
use crate::self_check::vectors::{MASKED_DATE, MASKED_NUMBERS, PUBLIC_MNEMONIC, PUBLIC_UNICODE};
use crate::self_check::{CheckFailure, Tier, expect_refused, expect_same};
use crate::wallet::evidence::{FINGERPRINT_WARNING, WalletMatch};

/// The public phrase masked with the Original Seedshift and [`MASKED_DATE`], in Unicode codes.
const LEGACY_UNICODE: &str = "8F44901950118F44901950118F44901950118F4490194F5C";

/// The row.
pub(super) const ROW: Row = Row::new(
    "Re-encoding",
    "a backup decoded, held back until confirmed, encoded again",
    run,
);

/// The re-encoding of the masked public phrase with `date`.
fn re_encoding_at(date: Date) -> Result<ReEncoding, CheckFailure> {
    let backup = ok(Backup::read(MASKED_NUMBERS, Form::Indexes, Mode::Seedshift))?;
    ok(ReEncoding::of(&backup, &[date], None))
}

/// Whether `re_encoding` holds the public phrase.
fn is_public(re_encoding: &ReEncoding) -> bool {
    re_encoding.phrase().text().as_str() == PUBLIC_MNEMONIC
}

fn run(tier: Tier) -> Result<(), CheckFailure> {
    let right = ok(parse_date(MASKED_DATE))?;
    let wrong = ok(parse_date("24-09-2026"))?;
    let mut re_encoding = re_encoding_at(right)?;
    expect_same(&is_public(&re_encoding), &true, "Re-encoded phrase")?;
    expect_refused(
        re_encoding.confirmed_phrase(),
        "core.re-encoding.not-confirmed",
        "Phrase before confirmation",
    )?;
    re_encoding.confirm_by_person();
    let again = ok(Backup::encode(
        ok(re_encoding.confirmed_phrase())?,
        &[],
        Form::Unicode,
        Mode::Direct,
    ))?;
    expect_same(
        ok(again.backup.text())?.as_str(),
        PUBLIC_UNICODE,
        "Phrase encoded again",
    )?;
    expect_same(
        &is_public(&re_encoding_at(wrong)?),
        &false,
        "Phrase of a wrong date",
    )?;
    let legacy = ok(Backup::read(
        LEGACY_UNICODE,
        Form::Unicode,
        Mode::SeedshiftLegacy,
    ))?;
    expect_same(
        &is_public(&ok(ReEncoding::of(&legacy, &[right], None))?),
        &true,
        "Original Seedshift",
    )?;
    expect_refused(
        ReEncoding::of(&legacy, &[wrong], None),
        "core.re-encoding.checksum-fails",
        "Original Seedshift with a wrong date",
    )?;
    let phrase = ok(crate::bip39::phrase::Phrase::parse(PUBLIC_MNEMONIC))?;
    let matching = ok(Backup::encode(
        &phrase,
        &[right],
        Form::Indexes,
        Mode::SeedshiftLegacy,
    ))?;
    let several = &matching.backup;
    expect_same(
        &several.mode(),
        &Mode::SeedshiftLegacyValid,
        "Original Seedshift written with a last word keeping the checksum",
    )?;
    let named = usize::from(matching.original_last_word.unwrap_or(0));
    expect_same(
        &is_public(&ok(ReEncoding::of(
            several,
            &[right],
            Some(english()[named]),
        ))?),
        &true,
        "Last word Encode named",
    )?;
    expect_refused(
        ReEncoding::of(several, &[right], Some(english()[named ^ 0x400])),
        "core.re-encoding.no-such-last-word",
        "Last word that does not fit",
    )?;
    if tier == Tier::Startup {
        return Ok(());
    }
    let mut by_wallet = re_encoding_at(right)?;
    by_wallet.confirm_by_wallet(&WalletMatch::default());
    expect_refused(
        by_wallet.confirmed_phrase(),
        "core.re-encoding.not-confirmed",
        "Phrase of another wallet",
    )?;
    let its_wallet = WalletMatch {
        matched: true,
        path: Some("m/84'/0'/0'/0/0".to_owned()),
        ..WalletMatch::default()
    };
    by_wallet.confirm_by_wallet(&its_wallet);
    expect_same(
        &by_wallet.confirmed_phrase().is_ok(),
        &true,
        "Phrase confirmed by the wallet",
    )?;
    let mut by_fingerprint = re_encoding_at(right)?;
    let fingerprint = WalletMatch {
        matched: true,
        path: Some("m".to_owned()),
        warning: Some(FINGERPRINT_WARNING),
        derived: None,
    };
    by_fingerprint.confirm_by_wallet(&fingerprint);
    let line = ok(by_fingerprint.confirmation_line(MatchedBy::Fingerprint))?;
    expect_same(
        line.as_str(),
        "The fingerprint matches: the seed phrase is accepted, not proven.",
        "Fingerprint's confirmation",
    )?;
    Ok(())
}

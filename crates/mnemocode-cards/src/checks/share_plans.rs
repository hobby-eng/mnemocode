//! The plans and drawings of the share cards' row, on the two designs its cases need, a tile for
//! the sheets and a business design for separate cards: the row of a build without them stops at
//! the cards' faces (CORE-31).

use mnemocode::self_check::vectors::{FIRST_SHARE_COLORS, FIRST_SHARE_UNICODE};
use mnemocode::self_check::{CheckFailure, expect_refused, expect_same, ok};
use mnemocode::sskr::forms::{ShareFormat, check_share_qr};

use super::{A6_WIDTH, FixedChoices, POINT_TOLERANCE, card_details};
use crate::content::SskrLayout;
use crate::export::{ShareCardOptions, ShareCardSet};
use crate::pdf::document;
use crate::settings::{CardSettings, PageSize};
use crate::templates::{CardDrawing, select_template};

/// The Unicode code of the word of index 0, which every fixed decoy beside Unicode codes is.
const FIXED_DECOY_CODE: &str = "7684";

/// A set of the official shares with nothing chosen at random, on a tile design.
fn share_options(format: ShareFormat) -> Result<ShareCardOptions, CheckFailure> {
    Ok(ShareCardOptions {
        template: ok(select_template(Some("material-tile")))?,
        layout: Some(SskrLayout::Qr),
        share_format: format,
        title: None,
        settings: card_details(),
    })
}

/// The plans of share cards: decoys, retained separate cards, refused layouts and QR codes.
fn share_plans(drawing: &CardDrawing, records: &[&str]) -> Result<ShareCardSet, CheckFailure> {
    let set = |options: &ShareCardOptions| {
        ShareCardSet::create(drawing, &mut FixedChoices, records, options)
    };
    let colors = share_options(ShareFormat::Colors)?;
    let unicode = share_options(ShareFormat::Unicode)?;
    let cards = ok(set(&colors))?;
    let printed = ok(cards.printed_codes(0))?;
    let own: Vec<&str> = FIRST_SHARE_COLORS
        .split(' ')
        .map(|color| color.trim_start_matches('#'))
        .collect();
    expect_same(
        &ok(cards.own_codes(0))?,
        &own.len(),
        "Own codes of a share's cards",
    )?;
    expect_same(
        &printed
            .get(..own.len())
            .map(|codes| codes.join(" "))
            .as_deref(),
        &Some(own.join(" ").as_str()),
        "Codes of a share's cards",
    )?;
    if printed.len() <= own.len() {
        return Err(CheckFailure::Mismatch("Decoys of a share's cards"));
    }
    expect_same(
        &printed.last().map(String::as_str),
        &Some("000000"),
        "Decoy of a share's colors",
    )?;
    let in_codes = ok(set(&unicode))?;
    expect_same(
        &ok(in_codes.printed_codes(0))?.last().map(String::as_str),
        &Some(FIXED_DECOY_CODE),
        "Decoy of a share's Unicode codes",
    )?;
    let qr_codes = in_codes.qr_codes();
    let first_qr = qr_codes
        .first()
        .ok_or(CheckFailure::Mismatch("Share card QR code without decoys"))?;
    expect_same(
        format!("{}: {}", first_qr.reference, first_qr.payload).as_str(),
        format!("4BBF-1-1: {FIRST_SHARE_UNICODE}").as_str(),
        "Share card QR code without decoys",
    )?;
    let it = ok(select_template(Some("business-it")))?;
    let business_page = CardSettings {
        page_size: Some(PageSize::Business),
        ..card_details()
    };
    // Separate cards are drawn in the business card designs only.
    let separate = ok(set(&ShareCardOptions {
        template: it,
        layout: Some(SskrLayout::Individual),
        settings: business_page.clone(),
        ..colors.clone()
    }))?;
    expect_same(&separate.qr_codes().len(), &0, "QR codes of separate cards")?;
    let business = ok(set(&ShareCardOptions {
        template: it,
        layout: Some(SskrLayout::Collection),
        ..unicode
    }))?;
    // The vector's own codes and the fixed decoy, never the plan's own counts.
    let own_unicode = FIRST_SHARE_UNICODE.split(' ').count();
    expect_same(
        &ok(business.own_codes(0))?,
        &own_unicode,
        "Own Unicode codes of a share's cards",
    )?;
    let retained = ok(business.for_individual_cards(None, None))?;
    expect_same(
        ok(retained.printed_codes(0))?.join(" ").as_str(),
        format!("{FIRST_SHARE_UNICODE} {FIXED_DECOY_CODE}").as_str(),
        "Retained share codes and first decoy",
    )?;
    // Each own code and the one decoy of separate cards on a card of its own.
    let documents = retained.shares().next().map(|share| share.documents);
    expect_same(&documents, &Some(own_unicode + 1), "Retained share cards")?;
    expect_same(
        &retained.qr_codes().len(),
        &0,
        "QR codes of retained individual cards",
    )?;
    expect_refused(
        retained.for_individual_cards(Some(PageSize::A4), None),
        "export.card-settings.separate-cards-business-size-choose-business-size-leave",
        "Retained individual cards on a sheet size",
    )?;
    expect_refused(
        set(&ShareCardOptions {
            layout: Some(SskrLayout::Individual),
            settings: business_page,
            ..colors.clone()
        }),
        "export.template-catalog.sheets-only",
        "Separate share cards of a material design",
    )?;
    expect_refused(
        set(&ShareCardOptions {
            share_format: ShareFormat::Indexes,
            ..colors
        }),
        "sskr.transport.shares-written-as-no-cards-cards-print-shares",
        "Share cards in word numbers",
    )?;
    let qr_codes = cards.qr_codes();
    let (first, second) = match qr_codes.as_slice() {
        [first, second, ..] => (first, second),
        _ => return Err(CheckFailure::Mismatch("QR codes of a set of cards")),
    };
    ok(check_share_qr(FIRST_SHARE_COLORS, &first.payload, None))?;
    expect_refused(
        check_share_qr(FIRST_SHARE_COLORS, &second.payload, None),
        "sskr.transport.share-qr-does-not-match-printed-references",
        "A QR code of another share",
    )?;
    // Cards that print Unicode codes: the QR code must hold the share those spell.
    let in_codes_qr = in_codes.qr_codes();
    let other = in_codes_qr
        .get(1)
        .ok_or(CheckFailure::Mismatch("QR codes of a set of cards"))?;
    expect_refused(
        check_share_qr("", &other.payload, Some(FIRST_SHARE_UNICODE)),
        "sskr.transport.share-qr-does-not-match-printed-references",
        "A QR code of another share beside Unicode codes",
    )?;
    Ok(cards)
}

/// The plans of the cards of `records` and the pages of the first share, on A6.
pub(super) fn run(records: &[&str]) -> Result<(), CheckFailure> {
    let drawing = CardDrawing::new();
    let cards = share_plans(&drawing, records)?;
    let pages = ok(cards.render_share(&drawing, &mut FixedChoices, 0))?;
    if pages.is_empty() {
        return Err(CheckFailure::Mismatch("Share card PDF pages"));
    }
    if !pages
        .iter()
        .all(|page| (page.width - A6_WIDTH).abs() <= POINT_TOLERANCE)
    {
        return Err(CheckFailure::Mismatch("Share card A6 dimensions"));
    }
    ok(document(&drawing.font, &pages)).map(|_| ())
}

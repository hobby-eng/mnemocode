//! The cards' entries of the memory scan: the sheet of a public phrase in colors, planned, drawn and
//! written out as a page gets it, on one design, since a page is the same work in every design.

use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;

use wasm_bindgen::JsValue;

use super::{Met, js};
use crate::cards::shares::own_cards;
use crate::cards::{CardExport, HeirPage};
use crate::host::after_secret;

/// The designs that the probe's file holds: for sheets, and for separate cards.
const DESIGN: &str = "material-tile";
const SEPARATE_DESIGN: &str = "business-it";

/// `phrase` written in colors.
pub(super) fn colors_of(phrase: &str) -> Option<String> {
    // This prepares secret fixture data outside a binding; it needs its own stack boundary.
    after_secret(|| {
        let phrase = Phrase::parse(phrase).ok()?;
        let indexes: Vec<u16> = (0..phrase.len())
            .filter_map(|place| phrase.index(place))
            .map(|index| index as u16)
            .collect();
        Form::Colors
            .codes(&indexes)
            .ok()
            .map(|codes| codes.as_str().to_owned())
    })
}

/// Calls the secret entries of the cards on the colors of `phrase`.
pub(super) fn card_entries(phrase: &str, met: &mut Met) {
    let Some(codes) = colors_of(phrase) else {
        met.failed("card codes");
        return;
    };
    met.text(&codes);
    // Public settings: no secret entry, so the gate asks no scrub of it.
    let Ok(export) = CardExport::new(Some(DESIGN.to_owned()), None, None, true) else {
        met.failed("card export");
        return;
    };
    let plan = export.backup(js(&codes), js("colors"), js("direct"));
    let Some(plan) = met.ok("card plan", plan) else {
        return;
    };
    let Some(sheets) = met.ok("card sheets", plan.sheets()) else {
        return;
    };
    met.ok("card pdf", sheets.pdf(0.0));
    met.ok("card image", sheets.image(0.0, 0.0, "png"));
    met.ok("card qr image", plan.qr_png());
    met.ok(
        "hidden qr image of a record",
        export.hidden_qr_png(js(&codes)),
    );
    // Separate cards are a business design's.
    let Ok(separate) = CardExport::new(Some(SEPARATE_DESIGN.to_owned()), None, None, false) else {
        met.failed("card export");
        return;
    };
    let plan = separate.backup(js(&codes), js("colors"), js("direct"));
    if let Some(plan) = met.ok("separate plan", plan) {
        met.ok("separate cards", plan.separate());
    }
}

/// Calls the secret entries of the cards of shares on `shares`, public shares as written.
pub(super) fn share_card_entries(shares: &[String], met: &mut Met) {
    let Ok(export) = CardExport::new(Some(DESIGN.to_owned()), None, None, true) else {
        met.failed("card export");
        return;
    };
    let records: Vec<JsValue> = shares.iter().map(|share| js(share)).collect();
    let cards = export.shares(records, js("colors"), JsValue::UNDEFINED);
    if let Some(cards) = met.ok("share cards", cards) {
        met.ok("share documents", cards.documents(0.0));
        if let Some(Some(payload)) = met.ok("share qr payload", cards.qr_payload(0.0)) {
            met.text(&payload);
        }
        met.ok("share qr image", cards.qr_png(0.0));
    }
    if let Some(share) = shares.first() {
        met.ok("own share cards", own_cards(js(share), js("colors")));
    }
}

/// The sheets for heirs of a pattern and of the patterns of shares. They hold no secret, so the
/// gate asks no scrub of them: drawn as a page draws them, so that their entries run in the file a
/// page gets, and told where they fail.
pub(super) fn heir_entries(met: &mut Met) {
    let Ok(page) = HeirPage::new(
        "Wallet tools".to_owned(),
        "https://example.org".to_owned(),
        vec!["Open the page.".to_owned()],
        vec!["Choose Decode.".to_owned()],
        None,
        None,
    ) else {
        met.failed("heir page");
        return;
    };
    if page.pattern_sheet(12.0, "seedshift", 1.0).is_err() {
        met.failed("pattern heir sheet");
    }
    if page
        .pattern_shares_sheet(2.0, 3.0, "seedshift-legacy", 1.0)
        .is_err()
    {
        met.failed("pattern shares heir sheet");
    }
}

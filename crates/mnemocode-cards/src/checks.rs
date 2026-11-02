//! The self-test rows of the cards (MnemoCode TS 0.1.0's `export/cards-self-test.ts`,
//! `card-sets-self-test.ts`, `heir-sheet-self-test.ts` and `sskr-render-self-test.ts`): how a set of
//! cards is made, the words of the sheet for heirs, the cards of two shares of the official vector,
//! and one sheet of each artwork family, all drawn from public data with nothing chosen at random.
//! They write no file.

use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::checks::Row;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::random::{Random, RandomError};
#[cfg(feature = "sskr")]
use mnemocode::self_check::vectors::{FIRST_SHARE_COLORS, FIRST_SHARE_UNICODE, OFFICIAL_SHARES};
use mnemocode::self_check::vectors::{PUBLIC_MNEMONIC, PUBLIC_UNICODE_CODES};
use mnemocode::self_check::{Check, CheckFailure, Tier, expect_refused, expect_same, ok};
#[cfg(feature = "sskr")]
use mnemocode::sskr::forms::ShareFormat;
#[cfg(feature = "sskr")]
use mnemocode::sskr::set::read_set;

use crate::content::{CardCodes, ColorCards, ContentKind, MAX_DECOYS, backup_card_content};
#[cfg(feature = "template-material-tile")]
use crate::export::{CardJob, planned_card_job, render_cards};
#[cfg(feature = "sskr")]
use crate::export::{share_card_codes, share_reference};
use crate::heir::{
    HeirBackup, HeirRoute, HeirSheetFacts, HeirSheetSize, HeirSheetText, heir_sheet_text,
    render_heir_sheet,
};
use crate::palette::{artwork_brightness, closest_pair, code_colors, oklab};
use crate::pdf::document;
use crate::scene::Page;
use crate::settings::{
    CardPresentation, CardProfile, CardSettings, Orientation, PageSize, ProfileField,
};
use crate::sheet::{LayoutRequest, collection_sheet_layout};
#[cfg(feature = "template-material-tile")]
use crate::templates::select_template;
use crate::templates::{BusinessStyle, CARD_TEMPLATES, CardDrawing, CardStyle};

#[cfg(all(
    feature = "sskr",
    feature = "template-material-tile",
    feature = "template-business-it"
))]
mod share_plans;

/// The rows of the cards in the report, after the coins'.
pub const ROWS: &[Row] = &[
    Row::new(
        "Heir sheet",
        "words for a backup and for shares, their codes before decoys, refusals; A5, A6 PDF",
        heir_sheet,
    ),
    #[cfg(feature = "sskr")]
    Row::new(
        "Share cards",
        "references, codes, colors, decoys and QR codes in colors and Unicode codes; A6 PDF",
        share_cards,
    ),
    Row::new(
        "Card sets",
        "colors of codes, brightness, full rows, decoys, codes before them; undated A6 PDF",
        card_sets,
    ),
];

/// The row of the drawings, late in the report: only a full self-test draws them.
pub const CARD_EXPORT: Row = Row::new(
    "Card export assets",
    "templates, fonts, artwork and single-page A6 PDF",
    card_export,
);

/// The startup cases of the rows, before any secret is asked.
pub fn startup() -> Result<(), CheckFailure> {
    ROWS.iter().try_for_each(|row| row.run(Tier::Startup))
}

/// The source of the decoys: fixed, so that a check draws nothing at random. The word of index 0
/// has the Unicode code 7684, and the color of 0 is #000000.
struct FixedChoices;

impl Random for FixedChoices {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(0);
        Ok(())
    }

    fn below(&mut self, _upper: u32) -> Result<u32, RandomError> {
        Ok(0)
    }
}

/// The width of an A6 page in landscape, in points.
const A6_WIDTH: f64 = 148.0 * 72.0 / 25.4;
/// How far a measure of a drawn page may be from it.
const POINT_TOLERANCE: f64 = 0.01;

/// Every field of a card given: one left out would be invented, with the platform's randomness.
fn card_details() -> CardSettings {
    let mut profile = CardProfile::default();
    for (field, value) in [
        (ProfileField::Name, "Alex Morgan"),
        (ProfileField::Role, "Design Director"),
        (ProfileField::Company, "VECTOR STUDIO"),
        (ProfileField::Email, "alex@vector.example"),
        (ProfileField::Phone, "+44 20 7946 0281"),
        (ProfileField::Website, "vector.example"),
        (ProfileField::Location, "London"),
    ] {
        profile.set(field, value.to_owned());
    }
    CardSettings {
        page_size: Some(PageSize::A6),
        orientation: Some(Orientation::Landscape),
        profile,
        presentation: Some(CardPresentation {
            studio_name: "VECTOR STUDIO".to_owned(),
            slogan: "Design with purpose.".to_owned(),
            subtitle: "Selected finishes".to_owned(),
            footer: "Crafted with care.".to_owned(),
            reference_label: "Ref.".to_owned(),
        }),
        card_qr: false,
    }
}

/// The cards of the public phrase in Unicode codes, before their decoys.
fn phrase_cards(settings: CardSettings) -> Result<ColorCards, CheckFailure> {
    Ok(ColorCards {
        kind: ContentKind::Colors,
        codes: CardCodes {
            colors: ok(code_colors(&PUBLIC_UNICODE_CODES))?,
            labels: Some(PUBLIC_UNICODE_CODES.map(str::to_owned).to_vec()),
            payload: PUBLIC_UNICODE_CODES.concat(),
        },
        decoys: None,
        title: None,
        reference: None,
        qr_card: false,
        settings,
    })
}

/// How a set of cards is made.
fn card_sets(tier: Tier) -> Result<(), CheckFailure> {
    expect_same(
        oklab(1.0, 0.0, 0.0)
            .map(|part| format!("{part:.3}"))
            .join(" ")
            .as_str(),
        "0.628 0.225 0.126",
        "OKLab of red",
    )?;
    expect_same(
        ok(code_colors(&[
            "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8",
        ]))?
        .join(" ")
        .as_str(),
        "#468080 #060680 #FFFF0D #FF0DFF #800606 #FF490D #0DFFFF #5A47FF",
        "Colors of the codes of a set",
    )?;
    expect_same(
        ok(code_colors(&["C1", "C2", "C1"]))?.join(" ").as_str(),
        "#468080 #060680 #468080",
        "Same code",
    )?;
    let forty: Vec<String> = (0..40).map(|index: u32| index.to_string()).collect();
    let apart = ok(closest_pair(&ok(code_colors(&forty))?))? > MIN_APART;
    expect_same(&apart, &true, "Colors of a set apart")?;
    let brightness = ["#000000", "#FFFFFF", "#336699"]
        .iter()
        .map(|hex| ok(artwork_brightness(hex)).map(|value| value.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    expect_same(
        brightness.join(" ").as_str(),
        "0.35 1 0.74",
        "Brightness of the business artwork",
    )?;
    // 28 cards of 1.8 on an A6 page turned upright: 4 to a row, 7 full rows.
    let layout = ok(collection_sheet_layout(&LayoutRequest {
        size: PageSize::A6,
        orientation: Some(Orientation::Portrait),
        count: 28,
        aspect: 1.8,
        caption_lines: &|_, _| 1,
        code: None,
        minimum_caption_width: 0.0,
    }))?;
    expect_same(
        &(layout.columns, layout.rows),
        &(4, 7),
        "Sheet in full rows",
    )?;
    decoys_of_a_set()?;
    if tier == Tier::Startup {
        return Ok(());
    }
    #[cfg(feature = "template-material-tile")]
    drawn_set()?;
    Ok(())
}

/// A set planned and drawn on a tile design.
#[cfg(feature = "template-material-tile")]
fn drawn_set() -> Result<(), CheckFailure> {
    let drawing = CardDrawing::new();
    let settings = CardSettings {
        card_qr: true,
        ..card_details()
    };
    let template = ok(select_template(Some("material-tile")))?;
    let job = ok(planned_card_job(
        &drawing,
        &mut FixedChoices,
        &CardJob {
            template,
            cards: phrase_cards(settings)?,
        },
    ))?;
    if job.cards.decoys.unwrap_or(0) < 1 {
        return Err(CheckFailure::Mismatch("Decoys of a planned set"));
    }
    let labels = job.cards.codes.labels.clone().unwrap_or_default();
    expect_same(
        &labels.get(..12).map(<[String]>::concat).as_deref(),
        &Some(PUBLIC_UNICODE_CODES.concat().as_str()),
        "Codes of a set",
    )?;
    expect_same(
        job.cards.codes.payload.as_str(),
        PUBLIC_UNICODE_CODES.concat().as_str(),
        "QR code of a set",
    )?;
    let pages = ok(render_cards(&drawing, &mut FixedChoices, &[job]))?;
    expect_same(&pages.len(), &1, "Pages of a set")?;
    let pdf = ok(document(&drawing.font, &pages))?;
    let informed = pdf.windows(INFORMATION.len()).any(|at| at == INFORMATION);
    expect_same(&informed, &false, "Document information of a set")
}

/// More than this, in millionths of OKLab units, between the two closest colours of 40 codes: no
/// design shows two of them alike.
const MIN_APART: u64 = 60_000;
/// What a PDF names its document information by.
#[cfg(feature = "template-material-tile")]
const INFORMATION: &[u8] = b"/Info";

/// The decoys of a phrase, the codes before them read back, and cards that lose a code.
fn decoys_of_a_set() -> Result<(), CheckFailure> {
    let phrase = phrase_cards(CardSettings::default())?;
    // A fixed source: every decoy is the code of word 0, which the set colours alike.
    let pool = ok(phrase.with_decoy_pool(&mut FixedChoices))?;
    expect_same(&pool.decoys, &Some(MAX_DECOYS), "Decoys of a set")?;
    let labels = pool.codes.labels.as_deref().unwrap_or_default();
    expect_same(
        &labels.last().map(String::as_str),
        &PUBLIC_UNICODE_CODES.first().copied(),
        "Decoy code",
    )?;
    expect_same(
        &pool.codes.colors.last(),
        &pool.codes.colors.first(),
        "Decoy colour",
    )?;
    let kept = ok(pool.kept(15))?;
    expect_same(
        &(ok(kept.own())?, kept.decoys),
        &(12, Some(3)),
        "Decoys kept",
    )?;
    let individual = ok(pool.kept_individual())?;
    expect_same(
        &(ok(individual.own())?, individual.decoys),
        &(12, Some(1)),
        "Separate cards",
    )?;
    let labels = individual.codes.labels.as_deref().unwrap_or_default();
    expect_same(
        &labels.get(..12).map(<[String]>::concat).as_deref(),
        &Some(phrase.codes.payload.as_str()),
        "Separate real codes",
    )?;
    ok(kept.check())?;
    expect_refused(
        pool.kept(11),
        "export.card-decoys.cards-kept-hold-every-code-backup",
        "Cards that lose a code",
    )?;
    let miscounted = ColorCards {
        decoys: Some(4),
        ..kept
    };
    expect_refused(
        miscounted.check(),
        "core.bip39-sizes.expected-word-indexes",
        "Decoys that count a code as one",
    )?;
    let abandon = PUBLIC_UNICODE_CODES[0];
    let about = PUBLIC_UNICODE_CODES[11];
    let text = format!("{} {abandon} {about}", PUBLIC_UNICODE_CODES.join(" "));
    expect_same(
        Form::Unicode.leading_codes(&text, 12).as_str(),
        PUBLIC_UNICODE_CODES.join(" ").as_str(),
        "Codes before the decoys",
    )
}

/// An address reserved for examples (RFC 2606), the one the test route prints.
const ROUTE_ADDRESS: &str = "example.org/heirs";

/// A route through no real program: what the sheet adds around its steps is what is checked.
struct TestRoute {
    other_address: bool,
}

impl HeirRoute for TestRoute {
    fn subtitle(&self) -> String {
        "Made by the self-test.".to_owned()
    }

    fn address(&self) -> String {
        ROUTE_ADDRESS.to_owned()
    }

    fn start(&self) -> Vec<String> {
        let mut steps = vec![format!("Open {ROUTE_ADDRESS} offline.")];
        if self.other_address {
            steps.push("Or open example.com/elsewhere.".to_owned());
        }
        steps
    }

    fn decode(&self, mode: Mode, words: usize, dates: Option<&str>) -> Vec<String> {
        let dates = dates.unwrap_or("no dates");
        vec![format!("Decode {words} words {}; {dates}.", mode.id())]
    }

    fn restore(&self, mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String> {
        let dates = dates.unwrap_or("no dates");
        vec![format!(
            "Restore {threshold} shares {}; {dates}.",
            mode.id()
        )]
    }

    fn date_digit_help(&self) -> Option<String> {
        Some("Search an unclear digit.".to_owned())
    }
}

const ROUTE: TestRoute = TestRoute {
    other_address: false,
};

/// Shares in colors, any 2 of 3, masked with two dates, 10 colors each on their cards.
#[cfg(feature = "sskr")]
const SHARES_FACTS: HeirSheetFacts = HeirSheetFacts {
    backup: HeirBackup::Shares {
        format: ShareFormat::Colors,
        threshold: 2,
        count: 3,
        codes: Some(10),
    },
    mode: Mode::Seedshift,
    dates: 2,
};
/// The seed phrase itself in 12 English words, not masked.
const PHRASE_FACTS: HeirSheetFacts = HeirSheetFacts {
    backup: HeirBackup::Encoded {
        form: Form::English,
        words: 12,
    },
    mode: Mode::Direct,
    dates: 0,
};
/// A 24-word phrase in colors, masked with one date: 16 colors, which its cards print first.
const COLORS_FACTS: HeirSheetFacts = HeirSheetFacts {
    backup: HeirBackup::Encoded {
        form: Form::Colors,
        words: 24,
    },
    mode: Mode::Seedshift,
    dates: 1,
};

const OPEN_WALLET: &str = "Open the wallet with this seed phrase in a wallet program (see below).";

/// The words that the facts above give: a change of these words must change this check too.
#[cfg(feature = "sskr")]
const SHARES_LINES: [&str; 8] = [
    "Any 2 of the 3 Shamir shares, written as color codes such as #1EAB91, on paper or on printed cards.",
    "On printed cards each share is the first 10 codes; the cards after them belong to nothing.",
    "The owner's 2 secret dates (see the back). They are written nowhere; the hint may lead to them.",
    "Open example.org/heirs offline.",
    "Restore 2 shares seedshift; the secret dates as day-month-year (23-09-2026).",
    OPEN_WALLET,
    "An error usually means a mistyped code or word: check each one against the paper. Type ? for each code you cannot read. Search an unclear digit.",
    "Never type the backup, the dates or the seed phrase into a website or send them to anyone.",
];
const PHRASE_LINES: [&str; 4] = [
    "The seed phrase itself: 12 English words, not masked.",
    "No secret dates are needed.",
    OPEN_WALLET,
    "Never type the backup or the seed phrase into a website or send them to anyone.",
];
const COLORS_LINES: [&str; 5] = [
    "The backup: color codes such as #1EAB91, on paper or on printed cards.",
    "The seed phrase has 24 words. On printed cards its backup is the first 16 codes; the cards after them belong to nothing.",
    "The owner's secret date (see the back). It is written nowhere; the hint may lead to it.",
    "Open example.org/heirs offline.",
    "Decode 24 words seedshift; the secret date as day-month-year (23-09-2026).",
];

/// The lines of a sheet that its facts decide, without its advice.
fn needs_and_steps(text: &HeirSheetText) -> Vec<&str> {
    text.needs
        .iter()
        .chain(&text.steps)
        .map(String::as_str)
        .collect()
}

/// The words for shares and for the phrase itself, and the facts and the route refused.
fn heir_words() -> Result<(), CheckFailure> {
    #[cfg(feature = "sskr")]
    {
        let text = ok(heir_sheet_text(&ROUTE, &SHARES_FACTS))?;
        let mut lines = needs_and_steps(&text);
        lines.extend([text.trouble.as_str(), text.warning.as_str()]);
        expect_same(lines.as_slice(), &SHARES_LINES[..], "Heir sheet for shares")?;
    }
    let text = ok(heir_sheet_text(&ROUTE, &PHRASE_FACTS))?;
    let mut lines = needs_and_steps(&text);
    lines.push(text.warning.as_str());
    expect_same(
        lines.as_slice(),
        &PHRASE_LINES[..],
        "Heir sheet for the phrase itself",
    )?;
    let text = ok(heir_sheet_text(&ROUTE, &COLORS_FACTS))?;
    let lines = needs_and_steps(&text);
    expect_same(
        &lines.get(..COLORS_LINES.len()),
        &Some(&COLORS_LINES[..]),
        "Heir sheet for a phrase in colors",
    )?;
    expect_refused(
        heir_sheet_text(
            &ROUTE,
            &HeirSheetFacts {
                backup: HeirBackup::Encoded {
                    form: Form::Colors,
                    words: 13,
                },
                ..COLORS_FACTS
            },
        ),
        "core.bip39-sizes.expected-word-indexes",
        "Heir sheet for a phrase of 13 words",
    )?;
    #[cfg(feature = "sskr")]
    {
        expect_refused(
            heir_sheet_text(
                &ROUTE,
                &HeirSheetFacts {
                    mode: Mode::SeedshiftLegacy,
                    ..SHARES_FACTS
                },
            ),
            "core.masking.split-modes-only",
            "Heir sheet for shares of the Original Seedshift",
        )?;
        expect_refused(
            heir_sheet_text(
                &ROUTE,
                &HeirSheetFacts {
                    backup: HeirBackup::Shares {
                        format: ShareFormat::Colors,
                        threshold: 4,
                        count: 3,
                        codes: None,
                    },
                    ..SHARES_FACTS
                },
            ),
            "export.heir-sheet-text.sheet-heirs-threshold-from-number-shares-at-most",
            "Heir sheet for more shares than there are",
        )?;
    }
    expect_refused(
        heir_sheet_text(
            &ROUTE,
            &HeirSheetFacts {
                dates: 1,
                ..PHRASE_FACTS
            },
        ),
        "core.masking.assert-takes-dates-refused",
        "Heir sheet with dates and no Seedshift",
    )?;
    expect_refused(
        heir_sheet_text(
            &TestRoute {
                other_address: true,
            },
            &COLORS_FACTS,
        ),
        "export.heir-sheet-text.sheet-heirs-may-print-route-s-address-once",
        "Heir sheet with another address",
    )
}

/// The sheet for heirs: its words, and in the full self-test its pages in A5 and A6.
fn heir_sheet(tier: Tier) -> Result<(), CheckFailure> {
    heir_words()?;
    if tier == Tier::Startup {
        return Ok(());
    }
    let drawing = CardDrawing::new();
    let text = ok(heir_sheet_text(&ROUTE, &PHRASE_FACTS))?;
    for (size, width, height) in [
        (HeirSheetSize::A5, 148.0, 210.0),
        (HeirSheetSize::A6, 105.0, 148.0),
    ] {
        let pages = ok(render_heir_sheet(&drawing.font, &text, size))?;
        expect_same(&pages.len(), &2, "Heir sheet pages")?;
        if !pages.iter().all(|page| measures(page, width, height)) {
            return Err(CheckFailure::Mismatch("Heir sheet page size"));
        }
    }
    let overflowing = HeirSheetText {
        steps: vec![OPEN_WALLET.to_owned(); 200],
        ..text
    };
    expect_refused(
        render_heir_sheet(&drawing.font, &overflowing, HeirSheetSize::A6),
        "export.heir-sheet.steps-basics-heirs-do-not-fit-on-back",
        "Heir sheet whose steps overflow",
    )
}

/// Whether `page` is `width` by `height` millimetres.
fn measures(page: &Page, width: f64, height: f64) -> bool {
    (page.width - width * 72.0 / 25.4).abs() <= POINT_TOLERANCE
        && (page.height - height * 72.0 / 25.4).abs() <= POINT_TOLERANCE
}

/// The second share of the official vector's first group.
#[cfg(feature = "sskr")]
const SECOND_SHARE: &str = "ur:sskr/gogrrsbyadadbnluotnykpaootdaweatrotlmsttrobsghbnurrh";
/// The share forms with cards.
#[cfg(feature = "sskr")]
const FORMS_WITH_CARDS: &str = "unicode colors colors-unicode";

/// The references of the cards, what they print and their QR codes hold, the forms with cards, and
/// a damaged share refused.
#[cfg(feature = "sskr")]
fn share_faces(records: &[&str]) -> Result<(), CheckFailure> {
    let shares = ok(read_set(records, false))?;
    let references: Vec<String> = shares
        .iter()
        .map(|read| share_reference(&read.share))
        .collect();
    expect_same(
        references.join(" ").as_str(),
        "4BBF-1-1 4BBF-1-2",
        "Share card references",
    )?;
    let first = &shares
        .first()
        .ok_or(CheckFailure::Mismatch("Share card references"))?
        .share;
    let colors = ok(share_card_codes(first, ShareFormat::Colors))?;
    expect_same(
        colors.payload.as_str(),
        FIRST_SHARE_COLORS,
        "Share card QR code in colors",
    )?;
    expect_same(
        &colors.labels.is_none(),
        &true,
        "Share cards in colors print their colors",
    )?;
    let codes = ok(share_card_codes(first, ShareFormat::Unicode))?;
    expect_same(
        codes.payload.as_str(),
        FIRST_SHARE_UNICODE,
        "Share card QR code in Unicode codes",
    )?;
    let labels = codes.labels.clone().unwrap_or_default();
    expect_same(
        labels.join(" ").as_str(),
        FIRST_SHARE_UNICODE,
        "Share card Unicode codes",
    )?;
    // One color for each distinct code, and the same color for the same code.
    expect_same(
        &distinct(&codes.colors),
        &distinct(&labels),
        "Colors of the Unicode codes",
    )?;
    let with_cards: Vec<&str> = ShareFormat::ALL
        .into_iter()
        .filter(|format| format.has_cards())
        .map(ShareFormat::name)
        .collect();
    expect_same(
        with_cards.join(" ").as_str(),
        FORMS_WITH_CARDS,
        "Share forms with cards",
    )?;
    let damaged = format!("{}y", OFFICIAL_SHARES[0].trim_end_matches('w'));
    expect_refused(
        read_set(&[damaged.as_str(), SECOND_SHARE], false),
        "sskr.transport.sskr-transport-checksum-does-not-match",
        "Share cards of a damaged share",
    )
}

/// How many different texts `texts` holds.
#[cfg(feature = "sskr")]
fn distinct(texts: &[String]) -> usize {
    let mut sorted: Vec<&String> = texts.iter().collect();
    sorted.sort();
    sorted.dedup();
    sorted.len()
}

/// The cards of two shares of the official vector.
#[cfg(feature = "sskr")]
fn share_cards(tier: Tier) -> Result<(), CheckFailure> {
    let records = [OFFICIAL_SHARES[0], SECOND_SHARE];
    share_faces(&records)?;
    if tier == Tier::Startup {
        return Ok(());
    }
    #[cfg(all(feature = "template-material-tile", feature = "template-business-it"))]
    share_plans::run(&records)?;
    Ok(())
}

/// One sheet of each artwork family from the public phrase: mixed covers the seven business
/// artworks, and each material has its own.
fn card_export(tier: Tier) -> Result<(), CheckFailure> {
    if tier == Tier::Startup {
        return Ok(());
    }
    let drawing = CardDrawing::new();
    let phrase = ok(Phrase::parse(PUBLIC_MNEMONIC))?;
    let encoding = ok(Backup::encode(
        &phrase,
        &[],
        Form::Colors,
        Mode::Direct,
        false,
    ))?;
    for template in CARD_TEMPLATES {
        if matches!(
            template.style,
            CardStyle::Business(BusinessStyle::Physical(_))
        ) {
            continue;
        }
        let settings = CardSettings {
            card_qr: true,
            ..card_details()
        };
        let cards = ok(backup_card_content(&encoding.backup, settings, None))?;
        let page = ok(template.draw(&drawing, &mut FixedChoices, &cards, None, 0))?;
        if (page.width - A6_WIDTH).abs() > POINT_TOLERANCE {
            return Err(CheckFailure::Mismatch("A6 dimensions"));
        }
        ok(document(&drawing.font, &[page]))?;
    }
    Ok(())
}

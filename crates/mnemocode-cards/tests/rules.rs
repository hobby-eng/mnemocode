//! The rules of what a card prints, as MnemoCode TS 0.1.0's tests pin them (card-font-refusals,
//! card-presentation-rule, card-title, card-copy, card-identities, business-cards, card-session):
//! what is refused, with which code and words, before anything is drawn, and what is kept.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use std::collections::HashSet;

use common::{
    Choices, NoChoices, PHRASE, colors_of, direct_backup, first_choices, last_choices,
    phrase_cards, refused, template,
};
use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::parse_date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::refusal::Refusal;
use mnemocode::self_check::vectors::{MASKED_DATE, OFFICIAL_SHARES};
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::content::{ColorCards, ContentError, backup_card_content};
use mnemocode_cards::details::{
    CARD_FOOTERS, CARD_SLOGANS, CARD_SUBTITLES, COMMON_ROLES, CardCopy, CardSession, CompanySector,
    ExportDetails, PERSON_NAMES, STUDIO_NAMES, card_identity, resolve_presentation,
};
use mnemocode_cards::export::{
    CardJob, ShareCardOptions, ShareCardSet, render_cards, render_individual_cards,
};
use mnemocode_cards::scene::{Step, UiFont};
use mnemocode_cards::settings::{
    CardPresentation, CardProfile, CardSettings, PageSize, ProfileField, SettingsError,
};
use mnemocode_cards::templates::{CardDrawing, DEFAULT_SHARE_TEMPLATE_ID};
use mnemocode_cards::text_rules::MAX_CARD_TEXT_LENGTH;

const BLANK: &str = "export.card-settings.card-non-empty-text-on-one-line";
const LONG: &str = "export.card-settings.card-too-long-maximum-characters";
const BLANK_TITLE: &str =
    "Card title must be non-empty text on one line; leave it out to print the studio name.";
/// One code point that NFC writes as two, U+0308 U+0301.
const LONGER_IN_NFC: char = '\u{344}';
/// The sectors of the employers.
const SECTORS: [CompanySector; 4] = [
    CompanySector::It,
    CompanySector::Architecture,
    CompanySector::Property,
    CompanySector::Consulting,
];

#[test]
fn a_supported_text_that_fits_keeps_its_preferred_size() {
    let size = UiFont::load().fit("Public fixture", 10.0, 5.0, 100.0, "Name");
    assert_eq!(size, Ok(10.0));
}

#[test]
fn a_character_outside_the_font_is_refused_by_its_field_and_never_repeated() {
    let refusal = UiFont::load().fit("Synthetic \u{1F512}", 10.0, 5.0, 100.0, "Name");
    assert_eq!(
        refused(refusal),
        (
            "export.business-render-primitives.contains-character-not-supported-by-card-font",
            "Name contains a character not supported by the card font.".to_owned()
        )
    );
}

#[test]
fn a_supported_text_too_wide_for_its_least_size_is_refused() {
    let refusal = UiFont::load().fit("Public fixture", 10.0, 5.0, 1.0, "Name");
    assert_eq!(
        refused(refusal),
        (
            "export.business-render-primitives.too-long-fit-legibly-on-card-shorten",
            "Name is too long to fit legibly on the card; shorten it.".to_owned()
        )
    );
}

/// The presentation that a host gives whole.
fn given() -> CardPresentation {
    CardPresentation {
        studio_name: "  Orven Studio ".to_owned(),
        slogan: String::new(),
        subtitle: "Proof set, first round.".to_owned(),
        footer: "Printed for review.".to_owned(),
        reference_label: "Ref.".to_owned(),
    }
}

/// The presentation that an export settles from `presentation`.
fn settled(presentation: CardPresentation) -> Result<CardPresentation, ContentError> {
    let settings = CardSettings {
        presentation: Some(presentation),
        ..CardSettings::default()
    };
    ExportDetails::of(&mut first_choices(), &settings, None).map(|details| details.presentation)
}

#[test]
fn a_presentation_given_whole_is_trimmed_and_a_hidden_line_stays_empty() {
    let trimmed = CardPresentation {
        studio_name: "Orven Studio".to_owned(),
        ..given()
    };
    assert_eq!(settled(given()).expect("a presentation"), trimmed);
}

#[test]
fn a_presentation_given_whole_is_refused_for_each_wrong_text() {
    let cases = [
        (
            CardPresentation {
                studio_name: "   ".to_owned(),
                ..given()
            },
            BLANK,
        ),
        (
            CardPresentation {
                slogan: "One\u{2028}two".to_owned(),
                ..given()
            },
            BLANK,
        ),
        (
            CardPresentation {
                subtitle: "Proof\u{AD}set".to_owned(),
                ..given()
            },
            BLANK,
        ),
        (
            CardPresentation {
                footer: "x".repeat(MAX_CARD_TEXT_LENGTH + 1),
                ..given()
            },
            LONG,
        ),
    ];
    for (presentation, code) in cases {
        assert_eq!(refused(settled(presentation)).0, code);
    }
}

/// The subtitle that `text`, given by a host, is drawn as.
fn subtitle_of(text: &str) -> Result<String, ContentError> {
    let copy = CardCopy {
        subtitle: Some(text.to_owned()),
        ..CardCopy::default()
    };
    let presentation = resolve_presentation(&mut first_choices(), &copy)?;
    Ok(presentation.subtitle)
}

/// A profile that gives `value` for `field` alone.
fn profile_with(field: ProfileField, value: &str) -> CardProfile {
    let mut profile = CardProfile::default();
    profile.set(field, value.to_owned());
    profile
}

/// The company that `text`, given by a host, is drawn as.
fn company_of(text: &str) -> Result<Option<String>, SettingsError> {
    let profile = profile_with(ProfileField::Company, text).validated()?;
    Ok(profile.get(ProfileField::Company).map(str::to_owned))
}

#[test]
fn a_card_text_is_counted_in_nfc_where_a_host_gives_it() {
    let over = format!("{}{LONGER_IN_NFC}", "b".repeat(99));
    let longest = format!("{}{LONGER_IN_NFC}", "b".repeat(98));
    let drawn = format!("{}\u{308}\u{301}", "b".repeat(98));
    assert_eq!(refused(subtitle_of(&over)).0, LONG);
    assert_eq!(subtitle_of(&longest).expect("the longest"), drawn);
    assert_eq!(refused(company_of(&over)).0, LONG);
    assert_eq!(company_of(&longest), Ok(Some(drawn)));
}

#[test]
fn a_text_that_the_rule_settled_passes_again_as_it_is() {
    // Pieces that NFC makes longer, shorter or keeps as long, and a space that is trimmed.
    let pieces = [
        "\u{344}",
        "\u{FB2C}",
        "\u{958}",
        "e\u{301}",
        "\u{1100}\u{1161}",
        "\u{212B}",
        "\u{2000}",
    ];
    let mut accepted = 0;
    for piece in pieces {
        for length in MAX_CARD_TEXT_LENGTH - 5..=MAX_CARD_TEXT_LENGTH {
            let letters = "b".repeat(length);
            for text in [
                format!("{letters}{piece}"),
                format!("{piece}{letters}"),
                format!(" {letters}{piece} "),
            ] {
                let copy = CardCopy {
                    subtitle: Some(text.clone()),
                    ..CardCopy::default()
                };
                match resolve_presentation(&mut first_choices(), &copy) {
                    Err(error) => assert_eq!(error.code(), LONG, "{text:?}"),
                    Ok(presentation) => {
                        accepted += 1;
                        assert!(presentation.subtitle.chars().count() <= MAX_CARD_TEXT_LENGTH);
                        let again = settled(presentation.clone()).expect("a settled text");
                        assert_eq!(again, presentation, "{text:?}");
                    }
                }
            }
        }
    }
    assert!(accepted > 0);
}

/// The cards of the public phrase in colors, masked with the public date, with `title`.
fn cards_titled(title: &str) -> Result<ColorCards, ContentError> {
    let phrase = Phrase::parse(PHRASE).expect("a public phrase");
    let dates = [parse_date(MASKED_DATE).expect("a public date")];
    let encoding = Backup::encode(&phrase, &dates, Form::Colors, Mode::Seedshift, false);
    let backup = encoding.expect("a backup").backup;
    backup_card_content(&backup, CardSettings::default(), Some(title))
}

#[test]
fn a_title_is_refused_for_each_text_that_is_no_card_text() {
    let cases = [
        ("Studio\u{2028}Two".to_owned(), BLANK),
        ("Stu\u{AD}dio".to_owned(), BLANK),
        ("Stu\u{200B}dio".to_owned(), BLANK),
        ("   ".to_owned(), BLANK),
        (String::new(), BLANK),
        ("Studio\nTwo".to_owned(), BLANK),
        ("i".repeat(MAX_CARD_TEXT_LENGTH + 1), LONG),
        // Combining accents have no width, so the fit of the heading never stops them. NFC joins the
        // first to the S; the others stay, one too many.
        (
            format!("S{}", "\u{301}".repeat(MAX_CARD_TEXT_LENGTH + 1)),
            LONG,
        ),
    ];
    for (title, code) in cases {
        assert_eq!(refused(cards_titled(&title)).0, code, "{title:?}");
    }
}

#[test]
fn a_refused_title_says_why_and_how_long_a_title_may_be() {
    assert_eq!(refused(cards_titled("   ")).1, BLANK_TITLE);
    assert_eq!(
        refused(cards_titled(&"i".repeat(MAX_CARD_TEXT_LENGTH + 1))).1,
        "Card title is too long (maximum 100 characters)."
    );
}

#[test]
fn a_title_is_kept_as_it_is_drawn_up_to_the_longest() {
    let title_of = |title: &str| cards_titled(title).expect("a title").title;
    assert_eq!(title_of("  Atelier  ").as_deref(), Some("Atelier"));
    assert_eq!(title_of("Cafe\u{301}").as_deref(), Some("Caf\u{E9}"));
    let longest = "i".repeat(MAX_CARD_TEXT_LENGTH);
    assert_eq!(title_of(&longest), Some(longest));
    // None given: the sheet names the studio.
    let backup = direct_backup(PHRASE, Form::Colors);
    let cards = backup_card_content(&backup, CardSettings::default(), None).expect("the cards");
    assert_eq!(cards.title, None);
}

#[test]
fn a_title_of_the_sheets_of_a_share_is_refused_before_any_choice_is_made() {
    let drawing = CardDrawing::new();
    let mut random = first_choices();
    let options = |title: String| ShareCardOptions {
        template: template(DEFAULT_SHARE_TEMPLATE_ID),
        layout: None,
        share_format: ShareFormat::Colors,
        title: Some(title),
        settings: CardSettings::default(),
    };
    let share = [OFFICIAL_SHARES[0]];
    let mut create = |title: String| {
        ShareCardSet::create(&drawing, &mut random, &share, &options(title)).map(|_| ())
    };
    assert_eq!(
        refused(create("Studio\u{2028}Two".to_owned())),
        (BLANK, BLANK_TITLE.to_owned())
    );
    assert_eq!(
        refused(create("i".repeat(MAX_CARD_TEXT_LENGTH + 1))).0,
        LONG
    );
    assert!(random.asked.is_empty());
}

#[test]
fn a_title_written_into_the_content_is_refused_before_a_page_is_drawn() {
    let mut cards = cards_titled("Atelier").expect("a title");
    cards.title = Some("Studio\u{2028}Two".to_owned());
    let job = CardJob {
        template: template(DEFAULT_SHARE_TEMPLATE_ID),
        cards,
    };
    let refusal = render_cards(&CardDrawing::new(), &mut first_choices(), &[job]);
    assert_eq!(refused(refusal), (BLANK, BLANK_TITLE.to_owned()));
}

#[test]
fn the_text_pools_are_whole_and_hold_no_repeats() {
    let distinct = |pool: &[&str]| pool.iter().collect::<HashSet<_>>().len();
    assert_eq!(distinct(&STUDIO_NAMES), 37);
    assert!(STUDIO_NAMES.contains(&"Alder & Vale"));
    assert!(STUDIO_NAMES.contains(&"Fallow & Reed"));
    assert_eq!(CARD_SLOGANS.len(), 29);
    assert_eq!(CARD_SUBTITLES.len(), 5);
    assert_eq!(CARD_FOOTERS.len(), 6);
}

#[test]
fn the_documents_count_the_text_pools_as_they_are() {
    const DOCUMENT: &str = include_str!("../../../docs/card-identities.md");
    let (studios, slogans) = (STUDIO_NAMES.len(), CARD_SLOGANS.len());
    assert_eq!((CARD_SUBTITLES.len(), CARD_FOOTERS.len()), (5, 6));
    assert!(DOCUMENT.contains(&format!(
        "{studios} studio names, {slogans} slogans, five subtitles and six footers"
    )));
}

#[test]
fn the_sheet_copy_is_chosen_in_its_order_one_choice_for_each_text() {
    let mut answers = [0, 28, 4, 5].into_iter();
    let mut random = Choices::new(move |_| answers.next().expect("four choices"));
    let presentation =
        resolve_presentation(&mut random, &CardCopy::default()).expect("the presentation");
    assert_eq!(random.asked, [37, 29, 5, 6]);
    assert_eq!(
        presentation,
        CardPresentation {
            studio_name: "Alder & Vale".to_owned(),
            slogan: CARD_SLOGANS[28].to_owned(),
            subtitle: CARD_SUBTITLES[4].to_owned(),
            footer: CARD_FOOTERS[5].to_owned(),
            reference_label: "Ref.".to_owned(),
        }
    );
}

#[test]
fn overrides_of_the_copy_are_kept_and_a_dash_hides_a_line() {
    let copy = CardCopy {
        studio_name: Some("Print Studio".to_owned()),
        slogan: Some("-".to_owned()),
        subtitle: Some("Custom subtitle".to_owned()),
        footer: Some("-".to_owned()),
        reference_label: Some("-".to_owned()),
    };
    assert_eq!(
        resolve_presentation(&mut NoChoices, &copy).expect("given texts"),
        CardPresentation {
            studio_name: "Print Studio".to_owned(),
            slogan: String::new(),
            subtitle: "Custom subtitle".to_owned(),
            footer: String::new(),
            reference_label: String::new(),
        }
    );
}

#[test]
fn optional_copy_that_is_no_card_text_is_refused() {
    let too_long = "x".repeat(MAX_CARD_TEXT_LENGTH + 1);
    for (slogan, code) in [
        ("", BLANK),
        (" ", BLANK),
        ("Two\nlines", BLANK),
        ("Hidden\u{200B}text", BLANK),
        (too_long.as_str(), LONG),
    ] {
        let copy = CardCopy {
            slogan: Some(slogan.to_owned()),
            ..CardCopy::default()
        };
        let refusal = resolve_presentation(&mut first_choices(), &copy);
        assert_eq!(refused(refusal).0, code, "{slogan:?}");
    }
}

#[test]
fn a_drawn_page_shows_none_of_its_codes_in_debug() {
    let colors = colors_of((0..12).map(|index| index * 7));
    let cards = ColorCards {
        settings: CardSettings {
            page_size: Some(PageSize::Business),
            ..CardSettings::default()
        },
        ..phrase_cards(&colors)
    };
    let job = CardJob {
        template: template("business-it"),
        cards,
    };
    let drawing = CardDrawing::new();
    let pages = render_cards(&drawing, &mut first_choices(), std::slice::from_ref(&job))
        .expect("the pages");
    let documents =
        render_individual_cards(&drawing, &mut first_choices(), job.template, &job.cards)
            .expect("the cards");
    let code = &colors[0][1..];
    assert!(
        pages[0]
            .steps
            .iter()
            .any(|step| { matches!(step, Step::Text { text, .. } if text.contains(code)) })
    );
    assert!(format!("{:?}", pages[0]) == "[Page: redacted]");
    assert!(!format!("{:?}", pages[0].steps).contains(code));
    assert!(!format!("{documents:?}").contains(code));
}

#[test]
fn details_settled_once_come_back_as_they_are_and_nothing_is_chosen_again() {
    // Chosen from the end of every list, which no choice of a later pass could take for the start.
    let first = ExportDetails::of(&mut last_choices(), &CardSettings::default(), None);
    let first = first.expect("the details");
    let settled = CardSettings {
        profile: first.profile.clone(),
        presentation: Some(first.presentation.clone()),
        ..CardSettings::default()
    };
    // Each output of an export takes them so, and a design that draws them directly too.
    let again = ExportDetails::of(&mut NoChoices, &settled, None).expect("the details");
    assert_eq!(again, first);
    let drawn = ExportDetails::person_first(&mut NoChoices, &settled, None).expect("the details");
    assert_eq!(drawn, first);
}

#[test]
fn every_detail_given_is_kept_trimmed_and_a_name_must_be_latin() {
    let mut supplied = profile_with(ProfileField::Name, " Alex Morgan ");
    supplied.set(ProfileField::Email, "me@example.com".to_owned());
    let profile = card_identity(&mut first_choices(), &supplied, None).expect("a person");
    assert_eq!(profile.get(ProfileField::Name), Some("Alex Morgan"));
    assert_eq!(profile.get(ProfileField::Email), Some("me@example.com"));
    let name = "Jean-Luc D\u{2019}Angelo";
    let validated = profile_with(ProfileField::Name, name).validated();
    assert_eq!(
        validated.expect("a Latin name").get(ProfileField::Name),
        Some(name)
    );
    let greek = profile_with(ProfileField::Name, "\u{39D}\u{3AF}\u{3BA}\u{3BF}\u{3C2}").validated();
    assert!(refused(greek).1.contains("Latin letters only"));
}

#[test]
fn details_that_are_no_card_text_and_sizes_of_no_page_are_refused() {
    let too_long = "x".repeat(MAX_CARD_TEXT_LENGTH + 1);
    for (name, code) in [
        ("", BLANK),
        ("  ", BLANK),
        ("x\ny", BLANK),
        ("\u{1b}[0m", BLANK),
        (too_long.as_str(), LONG),
    ] {
        let refusal = profile_with(ProfileField::Name, name).validated();
        assert_eq!(refused(refusal).0, code, "{name:?}");
    }
    let refusal = refused(PageSize::parse(Some("wallet")));
    assert_eq!(refusal.1, "Page size must be a6, a5, a4 or business.");
    assert_eq!(PageSize::parse(Some("business")), Ok(PageSize::Business));
}

#[test]
fn accepted_latin_diacritics_and_punctuation_are_in_the_bundled_font() {
    let font = UiFont::load();
    for name in [
        "Jos\u{E9} Silva",
        "Jean-Luc D\u{2019}Angelo",
        "Jean\u{2010}Luc",
    ] {
        let validated = profile_with(ProfileField::Name, name).validated();
        let validated = validated.expect("a Latin name");
        let drawn = validated.get(ProfileField::Name).expect("the name");
        assert!(font.has_every_character(drawn), "{name}");
    }
}

/// The widest of `values` in `font`.
fn widest<'a>(font: &UiFont, values: impl Iterator<Item = &'a str>) -> &'a str {
    values
        .max_by(|one, other| font.width(one, 1.0).total_cmp(&font.width(other, 1.0)))
        .expect("some values")
}

#[test]
fn invented_details_fit_every_business_design_at_their_widest() {
    let drawing = CardDrawing::new();
    let font = &drawing.font;
    let identities: Vec<CardProfile> = SECTORS
        .iter()
        .flat_map(|sector| sector.employers())
        .map(|company| {
            let supplied = profile_with(ProfileField::Company, company);
            card_identity(&mut first_choices(), &supplied, None).expect("a person")
        })
        .collect();
    // A detail fits by its own width alone, so the widest of each stands for every employer, and
    // the mixed design shows every business design.
    let mut profile = CardProfile::default();
    for field in ProfileField::ALL {
        let values = identities.iter().filter_map(|person| person.get(field));
        profile.set(field, widest(font, values).to_owned());
    }
    profile.set(
        ProfileField::Name,
        widest(font, PERSON_NAMES.into_iter()).to_owned(),
    );
    let roles = SECTORS
        .iter()
        .flat_map(|sector| sector.roles().iter().copied())
        .chain(COMMON_ROLES);
    profile.set(ProfileField::Role, widest(font, roles).to_owned());
    let mut cards = phrase_cards(&colors_of(0..12));
    cards.settings.profile = profile;
    template("business-mixed")
        .draw(&drawing, &mut first_choices(), &cards, None, 0)
        .expect("every detail fits every design");
}

#[test]
fn invented_addresses_end_in_the_reserved_domain_and_a_long_company_is_shortened() {
    let person = |supplied: &CardProfile| {
        card_identity(&mut first_choices(), supplied, None).expect("a person")
    };
    let company = "Northern Harbour Business Services";
    let identity = person(&profile_with(ProfileField::Company, company));
    assert_eq!(
        identity.get(ProfileField::Website),
        Some("northernharbour.example")
    );
    assert_eq!(
        identity.get(ProfileField::Email),
        Some("contact@northernharbour.example")
    );
    // One long word has no shorter form, so it is cut.
    let long = person(&profile_with(
        ProfileField::Company,
        "Abcdefghijklmnopqrstuvwxyz",
    ));
    assert_eq!(
        long.get(ProfileField::Website),
        Some("abcdefghijklmnopqr.example")
    );
    // A supplied address is printed as given.
    let mut supplied = profile_with(ProfileField::Company, "Any");
    supplied.set(ProfileField::Website, "any.org".to_owned());
    assert_eq!(
        person(&supplied).get(ProfileField::Website),
        Some("any.org")
    );
}

/// The details of the design `id` for one export of `session`, with nothing supplied.
fn session_details(
    session: &mut CardSession,
    random: &mut dyn mnemocode::random::Random,
    id: &str,
) -> ExportDetails {
    session
        .settings_for(
            random,
            template(id).sector(),
            &CardProfile::default(),
            &CardCopy::default(),
        )
        .expect("the details")
}

#[test]
fn a_session_gives_every_export_the_same_invented_details() {
    let mut session = CardSession::default();
    let mut random = first_choices();
    let first = session_details(&mut session, &mut random, "business-it");
    for _ in 0..20 {
        assert_eq!(
            session_details(&mut session, &mut random, "business-it"),
            first
        );
    }
    // The studio and the person stay; only the employer follows the sector of the design.
    let other = session_details(&mut session, &mut random, "business-architect");
    assert_eq!(other.presentation, first.presentation);
    assert_eq!(
        other.profile.get(ProfileField::Name),
        first.profile.get(ProfileField::Name)
    );
    assert_eq!(
        session_details(&mut session, &mut random, "business-architect"),
        other
    );
    assert_eq!(
        session_details(&mut session, &mut random, "material-tile"),
        session_details(&mut session, &mut random, "material-tile")
    );
}

#[test]
fn a_new_session_makes_fresh_choices_and_leaves_the_others_as_they_were() {
    let (mut random, mut last) = (first_choices(), last_choices());
    let mut first = CardSession::default();
    let original = session_details(&mut first, &mut random, "business-it");
    let facts = |details: &ExportDetails| {
        [
            ProfileField::Name,
            ProfileField::Company,
            ProfileField::Role,
        ]
        .map(|field| {
            details
                .profile
                .get(field)
                .map(str::to_owned)
                .unwrap_or_default()
        })
    };
    assert_eq!(
        facts(&original),
        ["Alex Morgan", "Norvale Systems", "Software Engineer"]
    );
    assert_eq!(original.presentation.studio_name, "Alder & Vale");
    assert_eq!(
        session_details(&mut first, &mut last, "business-it"),
        original
    );
    let chosen = last.asked.len();
    let fresh = session_details(&mut CardSession::default(), &mut last, "business-it");
    assert!(last.asked.len() > chosen);
    assert_eq!(
        facts(&fresh),
        ["Amina Diallo", "Fenwick Networks", "Project Manager"]
    );
    assert_eq!(fresh.presentation.studio_name, "Fallow & Reed");
    assert_eq!(
        session_details(&mut first, &mut last, "business-it"),
        original
    );
}

#[test]
fn a_session_prints_what_is_supplied_and_remembers_the_rest() {
    let mut session = CardSession::default();
    let mut random = first_choices();
    let invented = session_details(&mut session, &mut random, "business-it");
    let mut supplied = profile_with(ProfileField::Name, "John Smith");
    supplied.set(ProfileField::Company, "Example Systems".to_owned());
    let copy = CardCopy {
        studio_name: Some("AURORA STUDIO".to_owned()),
        ..CardCopy::default()
    };
    let it = template("business-it").sector();
    let own = session
        .settings_for(&mut random, it, &supplied, &copy)
        .expect("the details");
    let detail = |details: &ExportDetails, field| details.profile.get(field).map(str::to_owned);
    assert_eq!(
        detail(&own, ProfileField::Name).as_deref(),
        Some("John Smith")
    );
    assert_eq!(
        detail(&own, ProfileField::Company).as_deref(),
        Some("Example Systems")
    );
    assert_eq!(
        detail(&own, ProfileField::Email).as_deref(),
        Some("contact@examplesystems.example")
    );
    assert_eq!(
        detail(&own, ProfileField::Website).as_deref(),
        Some("examplesystems.example")
    );
    assert_eq!(
        detail(&own, ProfileField::Role),
        detail(&invented, ProfileField::Role)
    );
    assert_eq!(own.presentation.studio_name, "AURORA STUDIO");
    assert_eq!(own.presentation.slogan, invented.presentation.slogan);
    // Supplying details does not disturb what the session remembers.
    assert_eq!(
        session_details(&mut session, &mut random, "business-it"),
        invented
    );
    let digits = profile_with(ProfileField::Name, "1234");
    let refusal = session.settings_for(&mut random, it, &digits, &CardCopy::default());
    assert!(refused(refusal).1.contains("Latin letters"));
}

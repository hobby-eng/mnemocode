//! How a set of cards is made, as MnemoCode TS 0.1.0's tests pin it (card-sets,
//! individual-card-plan, encode-card-content, aud-021-export): the colors of cards that print codes,
//! the brightness of the artwork, the decoys after a backup's codes, the codes read back before
//! them, and the one plan of an export, for its sheets and for its separate cards.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use std::collections::HashSet;

use common::{
    LONG_PHRASE, NoChoices, PHRASE, SET_SHARES, colors_of, direct_backup, first_choices,
    last_choices, phrase_cards, refused, template,
};
use mnemocode::backup::Backup;
use mnemocode::bip39::phrase::Phrase;
use mnemocode::bip39::sizes::WORD_COUNTS;
use mnemocode::bip39::table::unicode_code;
use mnemocode::dates::{Date, parse_date};
use mnemocode::forms::Form;
use mnemocode::forms::colors::color_counts;
use mnemocode::modes::Mode;
use mnemocode::recovery::reading::{BackupReading, ReadingRules};
use mnemocode::self_check::vectors::{LONG_SHARES, MASKED_DATE, OFFICIAL_SHARES};
use mnemocode::sskr::forms::{ShareFormat, read_share};
use mnemocode_cards::content::{
    ColorCards, ContentKind, MAX_DECOYS, SskrLayout, backup_card_content,
};
use mnemocode_cards::export::{
    CardJob, ShareCardOptions, ShareCardSet, ShareCardShare, planned_card_job, separate_card_job,
};
use mnemocode_cards::palette::{
    BusinessTint, ReferenceTint, artwork_brightness, closest_pair, code_colors,
};
use mnemocode_cards::plan::with_planned_decoys;
use mnemocode_cards::settings::{CardSettings, Orientation, PageSize};
use mnemocode_cards::sheet::MAX_SHEET_CARDS;
use mnemocode_cards::templates::CardDrawing;

/// What TS's scripts/card-palette-reference.py, written apart from the palette, prints for 64.
const REFERENCE_COLORS: &str = "#468080 #060680 #FFFF0D #FF0DFF #800606 #FF490D #0DFFFF #5A47FF \
    #0ABF0A #FF8CE2 #790680 #BFAB36 #064980 #804663 #806106 #FF0D6E #47FF6C #8CC0FF #06802B \
    #0D0DFF #0D86FF #FFDD8C #AA69BF #36BF88 #BF250A #AA0DFF #3F2480 #BF8369 #BF0AA4 #FF47C8 \
    #FFA98C #466080 #BF0A52 #0DB6FF #C847FF #800643 #8CFFBA #FF860D #8C92FF #678006 #803D06 \
    #FFCF0D #74BF36 #8836BF #3643BF #5B0ABF #697ABF #BF770A #8CE8FF #0A64BF #AAFF0D #BF3688 \
    #805A46 #062B80 #FF4763 #7D8046 #69BFBB #699DBF #6E0DFF #0A0ABF #0DFF0D #BF6983 #FF0D25 \
    #BF520A";
/// How many cards of a share of the official vector print its own codes, in each form with cards,
/// from the vector's independent values: 21 Unicode codes, or ten colors.
const OWN_SHARE_CODES: [(ShareFormat, usize); 3] = [
    (ShareFormat::Unicode, 21),
    (ShareFormat::Colors, 10),
    (ShareFormat::ColorsUnicode, 10),
];
/// The forms of a phrase that have cards.
const CARD_FORMS: [Form; 3] = [Form::ColorsUnicode, Form::Colors, Form::Unicode];

/// The codes that `cards` print and what their QR code holds.
fn codes_of(cards: &ColorCards) -> (&[String], Option<&[String]>, &str) {
    let codes = &cards.codes;
    (&codes.colors, codes.labels.as_deref(), &codes.payload)
}

/// The numbered codes that `cards` print, as a card or a sheet prints them.
fn numbered(cards: &ColorCards) -> Vec<String> {
    (0..cards.codes.colors.len())
        .map(|index| cards.codes.numbered(index, "  "))
        .collect()
}

/// The texts `0` to `count`, each a code of its own.
fn numbers(count: usize) -> Vec<String> {
    (0..count).map(|index| index.to_string()).collect()
}

#[test]
fn the_colors_of_codes_are_those_of_the_independent_reference() {
    let codes: Vec<String> = (0..64).map(|index| format!("code {index}")).collect();
    let reference: Vec<&str> = REFERENCE_COLORS.split_whitespace().collect();
    assert_eq!(code_colors(&codes).expect("the colors"), reference);
}

#[test]
fn a_palette_has_one_distinct_color_for_each_of_its_1080_candidates_and_no_more() {
    let mut codes = numbers(1080);
    let colors = code_colors(&codes).expect("the colors");
    assert_eq!(colors.iter().collect::<HashSet<_>>().len(), 1080);
    codes.push("one more".to_owned());
    assert_eq!(
        refused(code_colors(&codes)),
        (
            "export.card-palette.cards-print-codes-at-most-colours",
            "Cards that print codes have at most 1080 colours.".to_owned()
        )
    );
}

#[test]
fn each_distinct_code_takes_one_color_in_the_order_they_first_appear() {
    let colors = |codes: &[&str]| code_colors(codes).expect("the colors");
    let first = colors(&["x"]).remove(0);
    let second = colors(&["x", "y"]).remove(1);
    let third = colors(&["x", "y", "z"]).remove(2);
    assert_eq!(
        colors(&["B", "A", "B", "C"]),
        [first.clone(), second, first, third]
    );
    // A larger set keeps the colors of a smaller one.
    let small = colors(&["1", "2", "3"]);
    assert_eq!(colors(&["1", "2", "3", "4", "5"])[..3], small);
}

#[test]
fn the_forty_codes_of_a_long_phrase_and_its_decoys_stay_far_apart() {
    let colors = code_colors(&numbers(40)).expect("the colors");
    assert_eq!(colors.iter().collect::<HashSet<_>>().len(), 40);
    assert!(closest_pair(&colors).expect("colors") > 60_000);
    assert_eq!(closest_pair(&["#123456", "#123456"]).expect("colors"), 0);
}

/// Expects `value` to be `wanted`, within what floating point keeps.
#[track_caller]
fn assert_close(value: f64, wanted: f64) {
    assert!((value - wanted).abs() < 1e-12, "{value} for {wanted}");
}

#[test]
fn the_brightness_of_the_artwork_follows_the_brightest_channel() {
    let brightness = |hex: &str| artwork_brightness(hex).expect("a color");
    assert_eq!(brightness("#000000"), 0.35);
    assert_eq!(brightness("#FFFFFF"), 1.0);
    assert_eq!(brightness("#FF0000"), 1.0);
    assert_close(brightness("#808000"), 0.35 + 0.65 * (128.0 / 255.0));
}

#[test]
fn a_dark_color_gives_darker_artwork_than_a_light_one_of_its_hue() {
    let typical = |hex: &str, tint| ReferenceTint::new(hex).expect("a color").typical(tint);
    let (_, _, dark) = typical("#404000", BusinessTint::Vivid);
    let (_, _, light) = typical("#FFFF00", BusinessTint::Vivid);
    assert!(dark < light);
    // Saturation within each design's range, from the color's own.
    assert_close(typical("#FFE0E0", BusinessTint::Vivid).1, 0.9 * 0.4);
    // A grey color turns the artwork grey.
    assert_eq!(typical("#FFF0F0", BusinessTint::Vivid).1, 0.0);
    assert_close(typical("#FF0000", BusinessTint::Muted).1, 0.9 * 0.75);
    // A neutral pixel of the photograph keeps its color.
    assert!(ReferenceTint::keeps((0.0, 0.1, 0.5)));
    assert!(ReferenceTint::keeps((0.0, 0.5, 0.05)));
    assert!(!ReferenceTint::keeps((0.0, 0.5, 0.5)));
}

/// The cards of a share that prints `colors`.
fn share_cards(colors: &[&str]) -> ColorCards {
    let colors: Vec<String> = colors.iter().map(|color| (*color).to_owned()).collect();
    ColorCards {
        kind: ContentKind::Sskr,
        ..phrase_cards(&colors)
    }
}

#[test]
fn decoys_look_like_the_codes_of_a_phrase_or_a_share_and_keep_the_codes_before_them() {
    let colors = colors_of([0; 12]);
    let phrase = phrase_cards(&colors)
        .with_decoy_pool(&mut last_choices())
        .expect("the decoys");
    assert_eq!(phrase.codes.colors[..colors.len()], colors);
    assert_eq!(phrase.decoys, Some(MAX_DECOYS));
    // A color of a phrase of 12 words: an even order tag and four-digit word positions.
    for decoy in &phrase.codes.colors[colors.len()..] {
        let value = u32::from_str_radix(&decoy[1..], 16).expect("a color");
        let digits = format!("{value:08}");
        let (first, second) = (digits.as_bytes()[0], digits.as_bytes()[1]);
        assert!(matches!(first, b'0' | b'1') && second % 2 == 0, "{decoy}");
    }
    let share = share_cards(&["#41C47E"])
        .with_decoy_pool(&mut last_choices())
        .expect("the decoys");
    assert_eq!(share.codes.colors[1..], ["#FFFFFF"; MAX_DECOYS]);
    let abandon = unicode_code(0);
    let mut codes = phrase_cards(&code_colors(&[&abandon]).expect("a color"));
    codes.codes.labels = Some(vec![abandon]);
    let codes = codes
        .with_decoy_pool(&mut last_choices())
        .expect("the decoys");
    let labels = codes.codes.labels.clone().expect("the codes");
    assert_eq!(labels[1..], vec![unicode_code(2047); MAX_DECOYS]);
    assert_eq!(codes.codes.colors, code_colors(&labels).expect("colors"));
}

#[test]
fn decoys_are_counted_kept_and_refused_by_one_rule() {
    let pool = share_cards(&["#41C47E", "#42D1F0"])
        .with_decoy_pool(&mut first_choices())
        .expect("the decoys");
    assert_eq!(pool.own().expect("a count"), 2);
    let kept = pool.kept(5).expect("the cards");
    assert_eq!(
        (
            kept.codes.colors.len(),
            kept.decoys,
            kept.own().expect("a count")
        ),
        (5, Some(3), 2)
    );
    for count in [1, 2 + MAX_DECOYS + 1] {
        assert!(
            refused(pool.kept(count))
                .1
                .contains("every code of the backup")
        );
    }
    let again = refused(kept.with_decoy_pool(&mut first_choices()));
    assert!(again.1.contains("have their decoys already"));
    let miscounted = ColorCards {
        decoys: Some(5),
        ..kept
    };
    assert!(refused(miscounted.own()).1.contains("fewer than the cards"));
}

#[test]
fn the_qr_code_of_a_sheet_holds_the_backup_alone_which_its_own_cards_must_be() {
    let kept = phrase_cards(&colors_of([0; 12]))
        .with_decoy_pool(&mut first_choices())
        .expect("the decoys")
        .kept(15)
        .expect("the cards");
    kept.check().expect("the backup's own cards");
    // Counting a decoy as a code of the backup, or a code as a decoy: 13 or 11 colors are no phrase's.
    for decoys in [2, 4] {
        let miscounted = ColorCards {
            decoys: Some(decoys),
            ..kept.clone()
        };
        assert_eq!(
            refused(miscounted.check()).0,
            "core.colors.enter-colors-standard-bip39-word-count"
        );
    }
}

#[test]
fn planned_cards_come_back_as_they_are_for_every_file_of_an_export() {
    let drawing = CardDrawing::new();
    let it = template("business-it");
    let cards = phrase_cards(&colors_of([0; 12]));
    let planned =
        with_planned_decoys(it, &drawing, &mut first_choices(), &cards, true).expect("the plan");
    assert!(planned.decoys.is_some_and(|decoys| decoys > 0));
    let again = with_planned_decoys(it, &drawing, &mut NoChoices, &planned, false).expect("a plan");
    assert_eq!(codes_of(&again), codes_of(&planned));
    assert_eq!(again.decoys, planned.decoys);
    assert_eq!(again.settings, planned.settings);
}

/// The public phrase as a backup of its own words.
fn phrase_backup() -> Backup {
    Backup::read(PHRASE, Form::English, Mode::Direct).expect("a public phrase")
}

#[test]
fn the_codes_before_the_decoys_are_taken_from_the_start_in_every_form() {
    let backup = phrase_backup();
    for form in Form::ALL {
        let text = form.codes(backup.indexes()).expect("the codes");
        let decoys = form.codes(&[2047; 12]).expect("the decoys");
        let codes = format!("{} {}", text.as_str(), decoys.as_str());
        let read = form.read(&form.leading_codes(&codes, 12));
        assert_eq!(
            read.expect("the codes"),
            backup.indexes(),
            "{}",
            form.name()
        );
    }
    let marked = format!("{} 4E?0 {}", unicode_code(0), unicode_code(3));
    assert_eq!(Form::Unicode.leading_codes(&marked, 12), marked);
    assert_eq!(Some(&Form::Colors.element_count(24)), color_counts().last());
    assert_eq!(Form::Unicode.element_count(15), 15);
}

#[test]
fn the_codes_before_the_decoys_are_read_by_the_words_of_the_phrase_given() {
    let backup = phrase_backup();
    let own = Form::Unicode.codes(backup.indexes()).expect("the codes");
    // Four decoys: sixteen codes, which no phrase has.
    let codes = format!("{} 4E00 5E7E 7684 7684", own.as_str());
    let rules = ReadingRules {
        seedshift_only: false,
        share_reader: "the restore",
        words: None,
    };
    let every_code = BackupReading::of(&codes, rules).expect("a reading");
    assert_eq!(
        refused(every_code.codes(Form::Unicode)).0,
        "core.encoded-backup.encoded-seed-phrase"
    );
    let words = |words| ReadingRules {
        words: Some(words),
        ..rules
    };
    let reading = BackupReading::of(&codes, words(12)).expect("a reading");
    assert_eq!(reading.forms(None).expect("the forms"), [Form::Unicode]);
    let read = reading.codes(Form::Unicode).expect("the codes");
    assert_eq!(read.indexes(), backup.indexes());
    assert_eq!(
        refused(BackupReading::of(&codes, words(13))).0,
        "core.bip39-sizes.expected-word-indexes"
    );
}

/// The word indexes `indexes` with three decoys after them.
fn with_three_decoys(indexes: &[u16]) -> Vec<u16> {
    [indexes, &[2047, 5, 9]].concat()
}

/// The words of the phrases that `found` holds, each with its word count.
fn phrases_of(found: &[(usize, mnemocode::modes::seedshift::Unmasked)]) -> Vec<(usize, String)> {
    found
        .iter()
        .map(|(words, result)| {
            let phrase = Form::English.codes(result.recovered.as_slice());
            (*words, phrase.expect("a phrase").as_str().to_owned())
        })
        .collect()
}

#[test]
fn a_phrase_is_found_where_its_decoys_make_a_longer_one_whose_checksum_fails() {
    let backup = phrase_backup();
    let codes = with_three_decoys(backup.indexes());
    let longer = Backup::of(&codes, Form::Unicode, Mode::Direct).expect("the codes");
    assert!(!longer.decode(&[]).expect("a phrase").checksum_valid);
    let found = longer.shorter_phrases(&[]).expect("the starts");
    assert_eq!(phrases_of(&found), [(12, PHRASE.to_owned())]);
    assert!(backup.shorter_phrases(&[]).expect("the starts").is_empty());
}

#[test]
fn a_shorter_start_passes_on_a_refusal_of_the_dates_and_leaves_out_what_cannot_have_been_written() {
    let backup = phrase_backup();
    let codes = with_three_decoys(backup.indexes());
    let date = parse_date(MASKED_DATE).expect("a public date");
    // Dates that a start's decoding refuses are refused here too, never taken for no shorter phrase.
    let direct = Backup::of(&codes, Form::Unicode, Mode::Direct).expect("the codes");
    assert_eq!(
        refused(direct.shorter_phrases(&[date])).0,
        "core.masking.assert-takes-dates-refused"
    );
    // A date of no calendar is refused where it is made, which TS's host object is not.
    assert_eq!(
        refused(Date::new(2026, 2, 30)).0,
        "core.dates.day-outside-selected-calendar-month"
    );
    // MnemoCode Seedshift keeps the checksum, which no start of this phrase has.
    let masked = Backup::read(LONG_PHRASE, Form::English, Mode::Seedshift).expect("the codes");
    assert!(
        masked
            .shorter_phrases(&[date])
            .expect("the starts")
            .is_empty()
    );
    // Eight dates, which 24 words take and no shorter start does: Encode refuses them for it.
    let in_month = |month: u64, days: std::ops::RangeInclusive<u64>| -> Vec<Date> {
        days.map(|day| Date::new(2020, month, day).expect("a public date"))
            .collect()
    };
    let eight = in_month(1, 1..=8);
    let long = Backup::read(LONG_PHRASE, Form::English, Mode::SeedshiftLegacy).expect("the codes");
    assert!(long.shorter_phrases(&eight).expect("the starts").is_empty());
    // Four dates, the most 12 words take: the 12-word start is kept, decoys after its codes.
    let four = in_month(3, 1..=4);
    let phrase = Phrase::parse(PHRASE).expect("a public phrase");
    let written = Backup::encode(&phrase, &four, Form::Unicode, Mode::SeedshiftLegacy, false);
    let written = written.expect("a backup").backup;
    let codes = with_three_decoys(written.indexes());
    let typed = Backup::of(&codes, Form::Unicode, Mode::SeedshiftLegacy).expect("the codes");
    let found = typed.shorter_phrases(&four).expect("the starts");
    assert_eq!(phrases_of(&found), [(12, PHRASE.to_owned())]);
}

#[test]
fn the_codes_of_a_share_are_read_by_its_own_length_and_a_share_cut_short_is_refused() {
    let share = read_share(SET_SHARES[0]).expect("a public share").share;
    for (format, decoys) in [
        (ShareFormat::Unicode, "7684 4E00"),
        (ShareFormat::Colors, "#123456 #ABCDEF"),
        (ShareFormat::Indexes, "5 77"),
    ] {
        let text = format!("{} {decoys}", format.write(&share).as_str());
        let read = read_share(&text).expect("the share").share;
        assert_eq!(read.ur().as_str(), SET_SHARES[0], "{}", format.name());
    }
    // In word numbers, which no other form reads, so that the refusal is the truncated share's.
    let written = ShareFormat::Indexes.write(&share);
    let (short, _) = written.as_str().rsplit_once(' ').expect("word numbers");
    assert_eq!(
        refused(read_share(short)).0,
        "sskr.transport.mixed-share-refused"
    );
    // Two units hold no length of their own to read.
    let first_two: Vec<&str> = written.as_str().split(' ').take(2).collect();
    assert_eq!(
        refused(read_share(&first_two.join(" "))).0,
        "sskr.transport.mixed-share-refused"
    );
}

#[test]
fn shares_are_printed_on_cards_in_colors_and_unicode_codes_only() {
    let with_cards: Vec<&str> = ShareFormat::ALL
        .into_iter()
        .filter(|format| format.has_cards())
        .map(ShareFormat::name)
        .collect();
    assert_eq!(with_cards, ["unicode", "colors", "colors-unicode"]);
    let words = refused(ShareFormat::Words.check_has_cards());
    assert!(words.1.contains("Shares written as words have no cards"));
    let unknown = refused(ShareFormat::named("nothing"));
    assert!(unknown.1.contains("The share format must be one of"));
}

#[test]
fn a_share_sheet_has_room_for_its_longest_codes_with_every_decoy() {
    let longest = read_share(LONG_SHARES[0]).expect("a public share").share;
    let written = ShareFormat::Unicode.write(&longest);
    let codes = written.as_str().split(' ').count();
    assert_eq!((MAX_DECOYS, MAX_SHEET_CARDS), (16, 64));
    assert!(codes + MAX_DECOYS <= MAX_SHEET_CARDS);
}

/// The cards of shares in `format` in the IT design, laid out as `layout` with `settings`.
fn share_options(
    format: ShareFormat,
    layout: Option<SskrLayout>,
    settings: CardSettings,
) -> ShareCardOptions {
    ShareCardOptions {
        template: template("business-it"),
        layout,
        share_format: format,
        title: None,
        settings,
    }
}

#[test]
fn a_retained_share_sheet_keeps_each_forms_codes_and_first_decoy_as_separate_cards() {
    let drawing = CardDrawing::new();
    let settings = CardSettings {
        orientation: Some(Orientation::Portrait),
        card_qr: true,
        ..CardSettings::default()
    };
    for (format, own) in OWN_SHARE_CODES {
        let options = share_options(format, Some(SskrLayout::Collection), settings.clone());
        let sheet =
            ShareCardSet::create(&drawing, &mut first_choices(), &OFFICIAL_SHARES, &options)
                .expect("the sheets");
        let cards = sheet.for_individual_cards(None, None).expect("the cards");
        assert_eq!(cards.layout(), SskrLayout::Individual);
        assert!(cards.qr_codes().is_empty());
        assert_eq!(sheet.qr_codes().len(), OFFICIAL_SHARES.len());
        let shares: Vec<&ShareCardShare> = sheet.shares().collect();
        assert_eq!(shares.len(), OFFICIAL_SHARES.len());
        assert_eq!(cards.shares().count(), shares.len());
        for (place, share) in cards.shares().enumerate() {
            assert_eq!(sheet.own_codes(place).expect("a share"), own);
            assert_eq!(cards.own_codes(place).expect("a share"), own);
            let printed = sheet.printed_codes(place).expect("a share");
            assert_eq!(
                cards.printed_codes(place).expect("a share"),
                printed[..=own]
            );
            assert_eq!(shares[place].documents, 1);
            let retained = ShareCardShare {
                documents: own + 1,
                folder: Some(share.name.clone()),
                ..shares[place].clone()
            };
            assert_eq!(*share, retained);
        }
        let again = cards
            .for_individual_cards(Some(PageSize::Business), Some(Orientation::Landscape))
            .expect("the cards");
        assert_eq!(
            again.printed_codes(0).expect("a share"),
            cards.printed_codes(0).expect("a share")
        );
        let sheet_size = cards.for_individual_cards(Some(PageSize::A4), None);
        assert!(refused(sheet_size).1.contains("business"));
    }
    assert_eq!(
        refused(Orientation::parse(Some("diagonal"))).1,
        "Orientation must be portrait or landscape."
    );
}

#[test]
fn a_whole_share_qr_card_cannot_become_separate_cards() {
    let options = share_options(
        ShareFormat::Colors,
        Some(SskrLayout::Qr),
        CardSettings::default(),
    );
    let share = [OFFICIAL_SHARES[0]];
    let qr = ShareCardSet::create(&CardDrawing::new(), &mut first_choices(), &share, &options)
        .expect("the card");
    assert_eq!(
        refused(qr.for_individual_cards(None, None)),
        (
            "export.sskr-render.qr-cards-cannot-become-fragments",
            "A whole-share QR card cannot become individual fragments. Start with a collection sheet."
                .to_owned()
        )
    );
}

#[test]
fn a_material_sheet_cannot_become_separate_cards() {
    let options = ShareCardOptions {
        template: template("material-switch"),
        ..share_options(ShareFormat::Colors, None, CardSettings::default())
    };
    let share = [OFFICIAL_SHARES[0]];
    let sheet = ShareCardSet::create(&CardDrawing::new(), &mut first_choices(), &share, &options)
        .expect("the sheet");
    let refusal = refused(sheet.for_individual_cards(None, None));
    assert!(refusal.1.contains("sheets only"));
}

#[test]
fn separate_cards_keep_one_decoy_for_every_printable_form_of_every_length() {
    let drawing = CardDrawing::new();
    let it = template("business-it");
    for words in WORD_COUNTS {
        let phrase = Phrase::of_entropy(&vec![0; words * 4 / 3]).expect("a public phrase");
        for form in CARD_FORMS {
            let backup = Backup::encode(&phrase, &[], form, Mode::Direct, false);
            let backup = backup.expect("a backup").backup;
            let original = backup_card_content(&backup, CardSettings::default(), None);
            let original = original.expect("the cards");
            let planned = with_planned_decoys(it, &drawing, &mut first_choices(), &original, true);
            let planned = planned.expect("the plan");
            let own = if form == Form::Unicode {
                words
            } else {
                words * 2 / 3
            };
            assert_eq!(planned.decoys, Some(1));
            assert_eq!(planned.codes.colors.len(), own + 1);
            assert_eq!(planned.codes.colors[..own], original.codes.colors);
            assert_eq!(
                planned.codes.labels.as_ref().map(|labels| &labels[..own]),
                original.codes.labels.as_deref()
            );
            assert_eq!(planned.codes.payload, original.codes.payload);
            assert_eq!(planned.own().expect("a count"), own);
            let again = with_planned_decoys(it, &drawing, &mut NoChoices, &planned, true);
            assert_eq!(codes_of(&again.expect("the plan")), codes_of(&planned));
        }
    }
}

#[test]
fn a_sheet_of_28_cards_gives_25_separate_cards_and_stays_as_it_was() {
    let drawing = CardDrawing::new();
    let it = template("business-it");
    let backup = direct_backup(LONG_PHRASE, Form::Unicode);
    let content = backup_card_content(&backup, CardSettings::default(), None).expect("the cards");
    let mut sheet = content
        .with_decoy_pool(&mut first_choices())
        .expect("the decoys")
        .kept(28)
        .expect("the cards");
    sheet.settings.orientation = Some(Orientation::Portrait);
    let separate = with_planned_decoys(it, &drawing, &mut NoChoices, &sheet, true);
    let separate = separate.expect("the plan");
    assert_eq!(separate.decoys, Some(1));
    assert_eq!(
        separate.codes.labels.as_deref(),
        sheet.codes.labels.as_ref().map(|all| &all[..25])
    );
    assert_eq!(separate.codes.colors, sheet.codes.colors[..25]);
    assert_eq!(separate.codes.payload, sheet.codes.payload);
    assert_eq!(sheet.codes.colors.len(), 28);
    let same = with_planned_decoys(it, &drawing, &mut NoChoices, &sheet, false);
    assert_eq!(codes_of(&same.expect("the plan")), codes_of(&sheet));
    let job = CardJob {
        template: it,
        cards: sheet,
    };
    let unturned = separate_card_job(&job, None).expect("the job");
    assert_eq!(unturned.cards.codes.colors.len(), 25);
    assert_eq!(unturned.cards.settings.orientation, None);
    let landscape = Some(Orientation::Landscape);
    let turned = separate_card_job(&job, landscape).expect("the job");
    assert_eq!(turned.cards.settings.orientation, landscape);
}

#[test]
fn cards_of_the_business_size_are_planned_without_a_sheet() {
    let backup = direct_backup(LONG_PHRASE, Form::Unicode);
    let settings = CardSettings {
        page_size: Some(PageSize::Business),
        ..CardSettings::default()
    };
    let job = CardJob {
        template: template("business-it"),
        cards: backup_card_content(&backup, settings, None).expect("the cards"),
    };
    let planned = planned_card_job(&CardDrawing::new(), &mut first_choices(), &job);
    let planned = planned.expect("the plan");
    assert_eq!(planned.cards.codes.colors.len(), 25);
    assert_eq!(planned.cards.decoys, Some(1));
}

#[test]
fn separate_shares_take_one_decoy_each_in_every_printable_form() {
    let drawing = CardDrawing::new();
    let share = [OFFICIAL_SHARES[0]];
    for (format, own) in OWN_SHARE_CODES {
        let layout = Some(SskrLayout::Individual);
        let options = share_options(format, layout, CardSettings::default());
        let set = ShareCardSet::create(&drawing, &mut first_choices(), &share, &options);
        let set = set.expect("the cards");
        assert_eq!(set.own_codes(0).expect("a share"), own);
        let documents = set.shares().next().map(|share| share.documents);
        assert_eq!(documents, Some(own + 1));
        assert_eq!(set.printed_codes(0).expect("a share").len(), own + 1);
        assert!(set.qr_codes().is_empty());
    }
}

#[test]
fn unicode_codes_print_in_colors_that_decorate_them_and_a_form_without_cards_is_refused() {
    let phrase = Phrase::parse(PHRASE).expect("a public phrase");
    let dates = [parse_date(MASKED_DATE).expect("a public date")];
    let backup = |form| {
        Backup::encode(&phrase, &dates, form, Mode::Seedshift, false)
            .expect("a backup")
            .backup
    };
    let unicode = backup(Form::Unicode);
    let cards = backup_card_content(&unicode, CardSettings::default(), None).expect("the cards");
    let labels = cards.codes.labels.clone().expect("the codes");
    let codes: Vec<String> = unicode
        .indexes()
        .iter()
        .map(|index| unicode_code(usize::from(*index)))
        .collect();
    assert_eq!(labels, codes);
    assert_eq!(cards.codes.colors, code_colors(&labels).expect("colors"));
    assert_eq!(
        cards.codes.payload,
        unicode.text().expect("the text").as_str()
    );
    for (form, name) in [(Form::English, "english"), (Form::Indexes, "indexes")] {
        let refusal = backup_card_content(&backup(form), CardSettings::default(), None);
        assert_eq!(
            refused(refusal).1,
            format!("No card prints codes written as {name}.")
        );
    }
}

#[test]
fn every_output_of_an_export_shows_the_real_codes_and_decoys_of_its_one_plan() {
    let drawing = CardDrawing::new();
    for form in CARD_FORMS {
        let backup = direct_backup(PHRASE, form);
        let own = backup_card_content(&backup, CardSettings::default(), None).expect("the cards");
        let job = CardJob {
            template: template("business-it"),
            cards: own.clone(),
        };
        let planned = planned_card_job(&drawing, &mut first_choices(), &job).expect("the plan");
        let (codes, sheet) = (numbered(&own), numbered(&planned.cards));
        assert_eq!(sheet[..codes.len()], codes, "{}", form.name());
        assert!(sheet.len() > codes.len());
        // Separate cards keep every real code and the first decoy of the sheet's plan.
        let separate = separate_card_job(&planned, None).expect("the cards");
        assert_eq!(numbered(&separate.cards), sheet[..=codes.len()]);
        // The plan is settled: a second job of the same plan chooses nothing.
        let again = planned_card_job(&drawing, &mut NoChoices, &planned).expect("the plan");
        assert_eq!(numbered(&again.cards), sheet);
    }
}

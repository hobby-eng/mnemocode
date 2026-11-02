//! What the commands that save cards leave on the disk, as MnemoCode TS 0.1.0's tests pin it
//! (card-title, card-file-names, encode-card-content, aud-021-export, aud-026-export,
//! cards-fit-before-secrets, heir-sheet, share-export-decision, export): tests/ts_transcripts.rs
//! compares what recorded commands say; here the files they write, their count, names and first
//! bytes, the order of the refusals, and that nothing is left behind after one; tests/card_saves.rs
//! holds the saves that fail. The program runs on public inputs, in a folder of each test's own.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too.
#![cfg(test)]
#![expect(
    clippy::disallowed_methods,
    reason = "the test writes the public inputs of a command to the folder that it runs in"
)]

mod common;

use std::fs;
use std::rc::Rc;

use common::{
    DATES, LONG_PHRASE, MOST_DATES, NEVER, PDF_START, PHRASE, PNG_START, PUBLIC_SHARES, SHARE,
    SHARES, assert_no_metadata, assert_private, assert_refused, assert_same_cards,
    assert_same_pictures, folder, names, numbered, outputs, page_sizes, printed_pages, read, saved,
};
use mnemocode::recovery::shares::flow::PhrasesFound;
use mnemocode::recovery::shares::repair::{ShareExportDecision, export_decision};
use mnemocode::self_check::vectors::LONG_SHARES;
use mnemocode::sskr::forms::{ShareFormat, read_share};
use mnemocode::sskr::restore::ShareSet;
use mnemocode_cards::templates::MaterialStyle;
use mnemocode_cards::templates::material::material_samples;

/// The fingerprint of the public phrase.
const FINGERPRINT: &str = "73c5da0a";
/// The eight colors of the public phrase, as `encode --format colors` of TS 0.1.0 prints them.
const PHRASE_COLORS: [&str; 8] = [
    "000064", "1EAB91", "3D0964", "5BB491", "7A1264", "98BD91", "B71B64", "D5C694",
];
/// Standard input as the file of a phrase or a share: empty here, so that a command that read it
/// would refuse that first.
const NOTHING_TO_READ: &str = "-";
/// A company too long for its line on a business card.
const COMPANY: &str = "Northern Atlantic Consolidated Engineering and Logistics Holdings";
/// Why a wallet check of shares needs a whole set: no phrase is restored from fewer.
const WALLET_NEEDS_THRESHOLD: &str =
    "The wallet can be checked only with as many shares as the threshold.";
/// Why nothing is saved where no set of shares fits.
const NO_PHRASE_FITS: &str = "No phrase fits these shares: a ? may stand at a wrong place, or an element without ? be misread.";
/// What every refusal of the cards of a share starts with.
const SHARE_CARDS_REFUSED: &str =
    "These share cards cannot be printed for every seed phrase, the longest of 24 words included:";
/// The words of a detail too long for its line.
const COMPANY_TOO_LONG: &str = "Company is too long to fit legibly on the card; shorten it.";
/// A5, in whole millimetres, upright.
const A5: (u32, u32) = (148, 210);
/// A6, in whole millimetres, upright.
const A6: (u32, u32) = (105, 148);

#[test]
fn a_title_is_refused_before_the_preview_writes_its_file() {
    let folder = folder("title");
    assert_refused(
        &folder,
        &["preview", "--title", "Studio\u{2028}Two", "--pdf", NEVER],
        "Card title must be non-empty text on one line; leave it out to print the studio name.",
    );
    let args = [
        "preview",
        "--template",
        "material-tile",
        "--title",
        "Atelier",
        "--pdf",
        "sample.pdf",
    ];
    assert!(saved(&folder, &args).contains("sample.pdf"));
    assert_eq!(outputs(&folder), ["sample.pdf"]);
    let sample = read(&folder, "sample.pdf");
    assert!(sample.starts_with(PDF_START));
    assert_eq!(page_sizes(&sample).len(), 1);
}

#[test]
fn every_output_of_one_encode_shows_the_same_cards_under_their_numbers() {
    let folder = folder("one-plan");
    let errors = saved(
        &folder,
        &[
            "encode",
            "--mnemonic-file",
            PHRASE,
            "--mode",
            "direct",
            "--format",
            "colors",
            "--template",
            "business-it",
            "--page-size",
            "business",
            "--pdf",
            "public.pdf",
            "--images-dir",
            "images",
            "--cards-dir",
            "cards",
        ],
    );
    // The eight codes of the phrase, then the one decoy of separate cards.
    let notices = [
        "Saved PDF: public.pdf",
        "Saved 9 PNG pages to: images",
        "Saved 9 individual card files to: cards",
    ];
    let places = notices.map(|notice| errors.find(notice).expect("each output says so"));
    assert!(places.is_sorted(), "{errors}");
    assert_eq!(outputs(&folder), ["cards", "images", "public.pdf"]);
    let sheet = read(&folder, "public.pdf");
    assert!(sheet.starts_with(PDF_START));
    assert_eq!(page_sizes(&sheet), [(90, 50); 9]);
    assert_no_metadata(&sheet);
    let images = folder.join("images");
    assert_eq!(names(&images), numbered("page-", 9, ".png"));
    let cards = folder.join("cards");
    assert_eq!(names(&cards), numbered("", 9, ".pdf"));
    for (name, start) in [
        ("images/page-09.png", PNG_START),
        ("cards/09.pdf", PDF_START),
    ] {
        assert!(read(&folder, name).starts_with(start), "{name}");
    }
    assert_private(&images);
    assert_private(&cards);
    // The same cards, with the same details, in the PDF and in the card files.
    assert_same_cards(&folder.join("public.pdf"), &cards, 9);
    let Some(pages) = printed_pages(&folder.join("public.pdf")) else {
        return;
    };
    // The number of each card stands directly before its code, a decoy's of six hexadecimal digits
    // too: the codes of the phrase first, and no card names the size of the set.
    for (index, page) in pages.iter().enumerate() {
        let line = format!("Ref. {:02} ", index + 1);
        let (_, after) = page.split_once(&line).expect("the number of the card");
        let code = &after[..6];
        match PHRASE_COLORS.get(index) {
            Some(color) => assert_eq!(code, *color, "{page}"),
            None => assert!(code.bytes().all(|byte| byte.is_ascii_hexdigit()), "{page}"),
        }
        assert!(!page.contains(" / "), "{page}");
    }
}

#[test]
fn the_page_images_and_the_card_files_of_one_encode_are_the_same_pictures() {
    let folder = folder("one-plan-images");
    // Eight codes or twelve, then the one decoy of separate cards.
    for (format, count) in [("colors-unicode", 9), ("unicode", 13)] {
        let (images, cards) = (format!("images-{format}"), format!("cards-{format}"));
        saved(
            &folder,
            &[
                "encode",
                "--mnemonic-file",
                PHRASE,
                "--mode",
                "direct",
                "--format",
                format,
                "--template",
                "business-it",
                "--page-size",
                "business",
                "--images-dir",
                &images,
                "--cards-dir",
                &cards,
                "--image-format",
                "png",
            ],
        );
        assert_same_pictures(&folder.join(images), &folder.join(cards), count);
    }
}

#[test]
fn the_cards_of_a_share_are_saved_by_number_in_the_folder_of_the_share() {
    let folder = folder("share-cards");
    let errors = saved(
        &folder,
        &[
            "sskr-export",
            "--share-file",
            SHARE,
            "--format",
            "colors",
            "--page-size",
            "business",
            "--cards-dir",
            "cards",
        ],
    );
    assert!(errors.contains("Saved 11 PDF files to: cards"), "{errors}");
    assert_eq!(outputs(&folder), ["cards"]);
    let cards = folder.join("cards");
    assert_eq!(names(&cards), ["collection-376C-1-1"]);
    let share = cards.join("collection-376C-1-1");
    // The ten colors of the share, then its one decoy.
    assert_eq!(names(&share), numbered("", 11, ".pdf"));
    assert_private(&share);
}

#[test]
fn a_sheet_with_a_qr_code_saves_its_image_beside_it_and_without_one_its_pdf_alone() {
    let folder = folder("sheet");
    let encode = |pdf: &'static str, more: &[&'static str]| {
        let mut args = vec![
            "encode",
            "--mnemonic-file",
            PHRASE,
            "--mode",
            "direct",
            "--format",
            "colors",
            "--template",
            "material-tile",
            "--pdf",
            pdf,
        ];
        args.extend_from_slice(more);
        saved(&folder, &args)
    };
    let errors = encode("public.pdf", &["--card-qr"]);
    assert!(
        errors.contains("Saved the QR code of the sheet as an image: public-qr.png"),
        "{errors}"
    );
    assert_eq!(outputs(&folder), ["public-qr.png", "public.pdf"]);
    assert!(read(&folder, "public-qr.png").starts_with(PNG_START));
    let first = read(&folder, "public.pdf");
    assert_eq!(page_sizes(&first).len(), 1);
    assert_no_metadata(&first);
    encode("second.pdf", &[]);
    assert_eq!(
        outputs(&folder),
        ["public-qr.png", "public.pdf", "second.pdf"]
    );
}

#[test]
fn the_next_encode_plans_cards_of_its_own() {
    let folder = folder("fresh-plan");
    let sheet = |images: &'static str| {
        saved(
            &folder,
            &[
                "encode",
                "--mnemonic-file",
                PHRASE,
                "--mode",
                "direct",
                "--format",
                "colors",
                "--template",
                "material-tile",
                "--images-dir",
                images,
            ],
        );
        read(&folder.join(images), "page.png")
    };
    // Page images, which only the plan and the details change: a PDF differs by its writer too.
    assert!(sheet("first") != sheet("second"));
}

#[test]
fn a_record_and_a_standalone_qr_image_plan_no_cards() {
    let folder = folder("record");
    let errors = saved(
        &folder,
        &[
            "encode",
            "--mnemonic-file",
            PHRASE,
            "--mode",
            "direct",
            "--format",
            "unicode",
            "--output",
            "public.txt",
            "--qr",
            "public.png",
        ],
    );
    assert_eq!(outputs(&folder), ["public.png", "public.txt"]);
    assert!(errors.contains("QR code verified."), "{errors}");
    assert!(read(&folder, "public.png").starts_with(PNG_START));
    assert!(read(&folder, "public.txt").starts_with(b"MNC1:direct:unicode:"));
}

#[test]
fn a_detail_too_long_for_its_card_is_refused_before_a_secret_is_asked_or_read() {
    let folder = folder("fit-phrase");
    let cards = [
        "--mode",
        "direct",
        "--template",
        "business-it",
        "--card-company",
        COMPANY,
        "--pdf",
        NEVER,
    ];
    let encode = |source: &[&'static str], format: &'static str| {
        let mut args = vec!["encode", "--format", format];
        args.extend_from_slice(source);
        args.extend_from_slice(&cards);
        assert_refused(&folder, &args, COMPANY_TOO_LONG);
    };
    // In the form they are printed in, Unicode codes too, with no phrase asked for.
    encode(&["--ask-secrets"], "3");
    // Before a phrase in a file is read.
    encode(&["--mnemonic-file", NOTHING_TO_READ], "5");
    encode(&["--mnemonic-file", PHRASE], "5");
}

#[test]
fn a_missing_input_file_is_named_before_cards_that_are_refused() {
    let folder = folder("fit-missing");
    assert_refused(
        &folder,
        &[
            "encode",
            "--format",
            "5",
            "--mnemonic-file",
            "no-such-phrase.txt",
            "--mode",
            "direct",
            "--template",
            "business-it",
            "--card-company",
            COMPANY,
            "--pdf",
            NEVER,
        ],
        "The mnemonic file could not be read.",
    );
    assert_refused(
        &folder,
        &[
            "sskr-export",
            "--share-file",
            "no-such-shares.txt",
            "--card-company",
            COMPANY,
            "--pdf",
            NEVER,
        ],
        "The share file could not be read.",
    );
}

/// The published shares of the longest secret written as Unicode codes, one to a line.
fn unicode_shares() -> String {
    LONG_SHARES
        .iter()
        .map(|record| {
            let share = read_share(record).expect("a public share").share;
            format!("{}\n", ShareFormat::Unicode.write(&share).as_str())
        })
        .collect()
}

#[test]
fn cards_that_cannot_print_a_share_in_its_own_form_are_refused_before_the_shares_are_read() {
    let folder = folder("fit-shares");
    let shares = "unicode-shares.txt";
    fs::write(folder.join(shares), unicode_shares()).expect("a file");
    let samples = material_samples(MaterialStyle::Tile).expect("the samples");
    let refusal = format!(
        "Unicode codes; --format colors prints every share in colors. {SHARE_CARDS_REFUSED} The tile material offers only {} distinct samples.",
        samples.len()
    );
    let too_long = format!("{SHARE_CARDS_REFUSED} {COMPANY_TOO_LONG}");
    for file in [shares, NOTHING_TO_READ] {
        // Unicode codes keep their form without --format: more codes than the tile has samples.
        let tile = [
            "sskr-export",
            "--share-file",
            file,
            "--template",
            "material-tile",
            "--pdf",
            NEVER,
        ];
        assert_refused(&folder, &tile, &refusal);
    }
    for file in [SHARES, NOTHING_TO_READ] {
        let company = [
            "sskr-export",
            "--share-file",
            file,
            "--card-company",
            COMPANY,
            "--pdf",
            NEVER,
        ];
        assert_refused(&folder, &company, &too_long);
    }
}

#[test]
fn the_sheet_for_heirs_is_saved_beside_the_shares_in_a5_or_a6_and_never_over_a_file() {
    let folder = folder("heirs");
    let split = |path: &'static str, more: &[&'static str]| {
        let mut args = vec![
            "encode",
            "--sskr",
            "--mnemonic-file",
            PHRASE,
            "--dates-file",
            DATES,
            "--threshold",
            "3",
            "--shares",
            "5",
            "--heir-sheet",
            path,
        ];
        args.extend_from_slice(more);
        saved(&folder, &args)
    };
    let pages = |path: &str| page_sizes(&read(&folder, path));
    let errors = split("heirs.pdf", &[]);
    assert!(
        errors.contains("Saved instructions for heirs: heirs.pdf"),
        "{errors}"
    );
    // A5 unless --heir-sheet-size says otherwise, on both sides of one sheet.
    assert_eq!(pages("heirs.pdf"), [A5; 2]);
    assert_no_metadata(&read(&folder, "heirs.pdf"));
    split("heirs-a6.pdf", &["--heir-sheet-size", "a6"]);
    assert_eq!(pages("heirs-a6.pdf"), [A6; 2]);
    // sskr-split, the older name of encode --sskr, saves it as well.
    let older = [
        "sskr-split",
        "--mode",
        "seedshift",
        "--mnemonic-file",
        PHRASE,
        "--dates-file",
        DATES,
        "--threshold",
        "3",
        "--shares",
        "5",
        "--heir-sheet",
        "heirs-split.pdf",
    ];
    saved(&folder, &older);
    assert_eq!(pages("heirs-split.pdf"), [A5; 2]);
    // A taken name does not stop the command: the sheet is saved under a free one.
    let before = read(&folder, "heirs.pdf");
    let errors = split("heirs.pdf", &[]);
    assert!(
        errors.contains("heirs.pdf already exists: saved as heirs-1.pdf instead."),
        "{errors}"
    );
    assert_eq!(read(&folder, "heirs.pdf"), before);
    assert_eq!(pages("heirs-1.pdf"), [A5; 2]);
}

#[test]
fn the_sheet_for_heirs_leads_through_the_menu_in_its_own_words() {
    let folder = folder("heirs-route");
    let sheet = |args: &[&'static str], name: &'static str| {
        let mut args = args.to_vec();
        args.extend(["--dates-file", DATES, "--heir-sheet", name]);
        saved(&folder, &args);
        printed_pages(&folder.join(name)).map(|pages| pages.join(" "))
    };
    let split = [
        "encode",
        "--sskr",
        "--mnemonic-file",
        PHRASE,
        "--threshold",
        "3",
        "--shares",
        "5",
    ];
    let Some(shares) = sheet(&split, "shares.pdf") else {
        return;
    };
    let version = env!("CARGO_PKG_VERSION");
    assert!(
        shares.contains(&format!("Made with MnemoCode {version}, free and offline.")),
        "{shares}"
    );
    for words in [
        "Choose \"5 Restore a seed phrase from Shamir shares\".",
        "To \"Was Seedshift used before it was split?\" answer \"Yes\".",
        "Type any 3 shares, separated by \";\", then the secret dates as day-month-year (23-09-2026). MnemoCode shows the seed phrase.",
        "If a digit of a date is unclear, menu entry 6 tries every possibility.",
    ] {
        assert!(shares.contains(words), "{words}: {shares}");
    }
    // One address, the repository's, printed once; its README leads to the guide for heirs.
    assert_eq!(shares.matches("https://").count(), 1, "{shares}");
    assert!(
        shares.contains("https://github.com/hobby-eng/mnemocode,"),
        "{shares}"
    );
    let unicode = [
        "encode",
        "--mnemonic-file",
        LONG_PHRASE,
        "--format",
        "unicode",
    ];
    let codes = sheet(&unicode, "unicode.pdf").expect("Poppler reads every file");
    for words in [
        "Choose \"3 Decode numbers, codes or colors back into a seed phrase\", then \"Type or paste it\".",
        "To \"How many words does the seed phrase have?\" answer \"24 words\"",
        "On printed cards its backup is the first 24 codes",
    ] {
        assert!(codes.contains(words), "{words}: {codes}");
    }
}

#[test]
fn the_longest_words_of_the_menu_route_fit_the_smallest_sheet() {
    let folder = folder("heirs-longest");
    let dated = |command: &[&'static str], sheet: &'static str| {
        let mut args: Vec<&str> = command.to_vec();
        args.extend(["--mnemonic-file", LONG_PHRASE, "--dates-file", MOST_DATES]);
        args.extend(["--heir-sheet", sheet, "--heir-sheet-size", "a6"]);
        saved(&folder, &args);
        assert_eq!(page_sizes(&read(&folder, sheet)), [A6; 2]);
    };
    // Colors say the most of a share: how they look, and how many cards are its own.
    let shares = [
        "encode",
        "--sskr",
        "--threshold",
        "16",
        "--shares",
        "16",
        "--share-format",
        "colors",
    ];
    dated(&shares, "shares.pdf");
    let legacy = ["encode", "--mode", "seedshift-legacy", "--format", "colors"];
    dated(&legacy, "legacy.pdf");
}

#[test]
fn a_sheet_for_heirs_that_cannot_be_made_is_refused_before_anything_is_written() {
    let folder = folder("heirs-refused");
    let phrase = ["encode", "--mnemonic-file", PHRASE, "--dates-file", DATES];
    let with = |more: &[&'static str]| [&phrase[..], more].concat();
    let unknown_size = with(&["--heir-sheet", NEVER, "--heir-sheet-size", "a4"]);
    assert_refused(&folder, &unknown_size, "must be a5 or a6");
    let no_sheet = with(&["--heir-sheet-size", "a6"]);
    assert_refused(&folder, &no_sheet, "--heir-sheet-size needs --heir-sheet");
    let replaced = with(&[
        "--mode",
        "seedshift-legacy",
        "--legacy-valid-last-word",
        "--heir-sheet",
        NEVER,
    ]);
    assert_refused(
        &folder,
        &replaced,
        "A sheet for heirs cannot be made for the Original Seedshift with a valid last word",
    );
}

#[test]
fn one_share_is_written_again_alone_and_a_wallet_check_of_it_is_refused() {
    let folder = folder("export-few");
    saved(
        &folder,
        &[
            "sskr-export",
            "--share-file",
            SHARE,
            "--output",
            "again.txt",
        ],
    );
    assert_eq!(outputs(&folder), ["again.txt"]);
    let again = read(&folder, "again.txt");
    assert_eq!(again, format!("{}\n", PUBLIC_SHARES[0]).into_bytes());
    let wallet = [
        "sskr-export",
        "--share-file",
        SHARE,
        "--master-fingerprint",
        FINGERPRINT,
        "--output",
        NEVER,
    ];
    assert_refused(&folder, &wallet, WALLET_NEEDS_THRESHOLD);
}

#[test]
fn a_set_that_restores_its_phrase_is_written_again_whole() {
    let folder = folder("export-set");
    saved(
        &folder,
        &[
            "sskr-export",
            "--share-file",
            SHARES,
            "--output",
            "again.txt",
        ],
    );
    assert_eq!(outputs(&folder), ["again.txt"]);
    let again = read(&folder, "again.txt");
    assert_eq!(
        again,
        format!("{}\n", PUBLIC_SHARES.join("\n")).into_bytes()
    );
}

#[test]
fn a_detail_given_twice_a_detail_without_a_card_file_and_a_page_of_no_size_are_refused() {
    let folder = folder("card-options");
    let encode = [
        "encode",
        "--mnemonic-file",
        PHRASE,
        "--mode",
        "direct",
        "--format",
        "colors",
    ];
    let with = |more: &[&'static str]| [&encode[..], more].concat();
    assert_refused(
        &folder,
        &with(&["--card-name", "One", "--card-name", "Two", "--pdf", NEVER]),
        "Provide only one value for the card name setting.",
    );
    assert_refused(
        &folder,
        &with(&["--card-email", "me@example.com"]),
        "Card settings require a PDF file, an image output folder or an individual-card output folder.",
    );
    assert_refused(
        &folder,
        &with(&["--pdf", NEVER, "--page-size", "a3"]),
        "Page size must be a6, a5, a4 or business.",
    );
}

#[test]
fn no_command_takes_the_labels_of_dated_cards() {
    let folder = folder("event");
    for command in [
        "encode",
        "decode",
        "re-encode",
        "recover-date",
        "recover-word",
        "sskr-combine",
        "sskr-export",
        "sskr-split",
        "preview",
        "table",
        "self-test",
    ] {
        assert_refused(
            &folder,
            &[command, "--event", "Wedding"],
            &format!("The {command} command does not support the unknown option setting."),
        );
    }
}

/// The restore of the public set.
fn restored_set() -> Rc<ShareSet> {
    Rc::new(ShareSet::restore(&PUBLIC_SHARES, None).expect("a public set"))
}

/// What a restore that found `sets` found.
fn found_sets(sets: Vec<Rc<ShareSet>>) -> PhrasesFound {
    PhrasesFound {
        phrases: Vec::new(),
        sets,
        matches: 0,
        listed: Vec::new(),
    }
}

#[test]
fn one_set_that_fits_is_saved_and_of_several_none_is() {
    let set = restored_set();
    let one = found_sets(vec![Rc::clone(&set)]);
    let ShareExportDecision::Set(found, saved) = export_decision(Some(&one), false) else {
        panic!("one set to save");
    };
    assert!(std::ptr::eq(found, &one) && Rc::ptr_eq(&saved, &set));
    let several = found_sets(vec![restored_set(), restored_set()]);
    let ShareExportDecision::Variants(found) = export_decision(Some(&several), false) else {
        panic!("no set to save");
    };
    assert!(std::ptr::eq(found, &several));
    let none = found_sets(Vec::new());
    assert!(matches!(
        export_decision(Some(&none), false),
        ShareExportDecision::Trouble(message) if message == NO_PHRASE_FITS
    ));
}

#[test]
fn too_few_shares_are_repaired_each_alone_unless_a_wallet_is_checked_against_them() {
    assert!(matches!(
        export_decision(None, false),
        ShareExportDecision::Each
    ));
    assert!(matches!(
        export_decision(None, true),
        ShareExportDecision::Trouble(message) if message == WALLET_NEEDS_THRESHOLD
    ));
}

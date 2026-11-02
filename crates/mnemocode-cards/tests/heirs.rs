//! The sheet for heirs, as MnemoCode TS 0.1.0's tests pin it (heir-sheet, aud-014-export): what it
//! says of a backup, the facts it refuses, the one address it prints, and that every kind of backup
//! fits one sheet. The route through the program's own menu is private to the command line, whose
//! tests/cards.rs saves the sheet and reads its words back; here a host's routes lead.

// Test code throughout, so that clippy's allow-*-in-tests keys cover the helpers too. The default
// features hold the shares and every design, which the manifest asks of ts_cards one by one.
#![cfg(test)]
#![cfg(feature = "default")]

mod common;

use common::refused;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode_cards::heir::{
    HeirBackup, HeirRoute, HeirSheetFacts, HeirSheetSize, HeirSheetText, heir_sheet_text,
    render_heir_sheet,
};
use mnemocode_cards::scene::UiFont;

/// The address of the stand-in program.
const ADDRESS: &str = "https://example.com/wallet-tool";
/// The most dates MnemoCode takes: one for every three words of a 24-word phrase.
const MOST_DATES: usize = 8;
/// The address of MnemoCode's own route, which names its repository.
const REPOSITORY: &str = "https://github.com/hobby-eng/mnemocode";

/// ", then `dates`", or nothing without dates.
fn then(dates: Option<&str>) -> String {
    dates.map_or_else(String::new, |dates| format!(", then {dates}"))
}

/// A stand-in for another program, such as a page with tabs.
#[derive(Clone)]
struct WalletTool {
    subtitle: &'static str,
    address: &'static str,
    start: Vec<String>,
    /// What the steps of a restore say in place of the tool's own.
    restore: Option<String>,
}

impl WalletTool {
    fn new() -> Self {
        Self {
            subtitle: "Made with the Wallet Tool, free and offline.",
            address: ADDRESS,
            start: vec![format!(
                "Open {ADDRESS} on a computer you trust, then go offline."
            )],
            restore: None,
        }
    }

    /// The same tool, whose `start` steps name `address`.
    fn at(address: &'static str, start: &[String]) -> Self {
        Self {
            address,
            start: start.to_vec(),
            ..Self::new()
        }
    }
}

impl HeirRoute for WalletTool {
    fn subtitle(&self) -> String {
        self.subtitle.to_owned()
    }

    fn address(&self) -> String {
        self.address.to_owned()
    }

    fn start(&self) -> Vec<String> {
        self.start.clone()
    }

    fn decode(&self, mode: Mode, _words: usize, _dates: Option<&str>) -> Vec<String> {
        vec![format!(
            "Open the Decode tab in {} mode and type the backup.",
            mode.id()
        )]
    }

    fn restore(&self, _mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String> {
        vec![self.restore.clone().unwrap_or_else(|| {
            format!(
                "Open the Shares tab and type {threshold} shares{}.",
                then(dates)
            )
        })]
    }

    fn date_digit_help(&self) -> Option<String> {
        None
    }
}

/// The steps of TS's route through MnemoCode's menu, as long as the sheet ever prints them; the
/// entries of the Rust menu's own route are the command line's.
struct MenuWords;

impl HeirRoute for MenuWords {
    fn subtitle(&self) -> String {
        "Made with MnemoCode 0.1.0, free and offline.".to_owned()
    }

    fn address(&self) -> String {
        REPOSITORY.to_owned()
    }

    fn start(&self) -> Vec<String> {
        vec![
            format!(
                "On a computer you trust, open {REPOSITORY}, download MnemoCode under \"Releases\" and check it as the guide for heirs there says."
            ),
            "Go offline, then start MnemoCode by a double-click: it shows a menu.".to_owned(),
        ]
    }

    fn decode(&self, mode: Mode, words: usize, dates: Option<&str>) -> Vec<String> {
        vec![
            format!(
                "Choose \"3 Decode numbers, codes or colors back into a seed phrase\", then \"Type or paste it\". To \"How many words does the seed phrase have?\" answer \"{words} words\", and to \"Was Seedshift used when it was encoded?\" answer \"{}\".",
                mode.name()
            ),
            format!(
                "Type the backup{}. MnemoCode shows the seed phrase.",
                then(dates)
            ),
        ]
    }

    fn restore(&self, _mode: Mode, threshold: usize, dates: Option<&str>) -> Vec<String> {
        vec![
            "Choose \"5 Restore a seed phrase from Shamir shares\". To \"Was Seedshift used before it was split?\" answer \"Yes\".".to_owned(),
            format!(
                "Type any {threshold} shares, separated by \";\"{}. MnemoCode shows the seed phrase.",
                then(dates)
            ),
        ]
    }

    fn date_digit_help(&self) -> Option<String> {
        Some("If a digit of a date is unclear, menu entry 6 tries every possibility.".to_owned())
    }
}

/// Shares written as `format`, any `threshold` of `count`, without a count of codes.
const fn shares(format: ShareFormat, threshold: usize, count: usize) -> HeirBackup {
    HeirBackup::Shares {
        format,
        threshold,
        count,
        codes: None,
    }
}

/// `backup` as it is made without Seedshift.
const fn direct(backup: HeirBackup) -> HeirSheetFacts {
    HeirSheetFacts {
        backup,
        mode: Mode::Direct,
        dates: 0,
    }
}

/// The facts of 2 of 3 shares in Bytewords, masked with one date.
const MASKED_SHARES: HeirSheetFacts = HeirSheetFacts {
    backup: shares(ShareFormat::Words, 2, 3),
    mode: Mode::Seedshift,
    dates: 1,
};

/// The words of the sheet for `facts`, through the stand-in program.
fn text_of(facts: HeirSheetFacts) -> HeirSheetText {
    heir_sheet_text(&WalletTool::new(), &facts).expect("the words")
}

/// The headings of the basics of `text`.
fn headings(text: &HeirSheetText) -> Vec<&str> {
    text.basics
        .iter()
        .map(|section| section.heading.as_str())
        .collect()
}

#[test]
fn a_sheet_names_the_threshold_the_form_of_the_shares_and_the_dates() {
    let text = text_of(HeirSheetFacts {
        backup: shares(ShareFormat::Words, 3, 5),
        mode: Mode::Seedshift,
        dates: 2,
    });
    assert!(text.needs[0].contains("Any 3 of the 5 Shamir shares"));
    assert!(text.needs[0].contains("tuna next keep gyro"));
    // A UR stays a UR: the guide does not promise a conversion to cards.
    let ur = text_of(direct(shares(ShareFormat::Ur, 3, 5)));
    assert!(ur.needs[0].contains("codes that start with ur:sskr/"));
    assert!(!ur.needs[0].contains("printed cards"));
    assert!(!ur.needs[0].contains("words such as"));
    assert!(text.needs[1].contains("The owner's 2 secret dates (see the back)"));
    assert!(headings(&text).contains(&"Secret dates"));
    let plain = text_of(direct(HeirBackup::Encoded {
        form: Form::Indexes,
        words: 12,
    }));
    // Word numbers have no cards: the sheet names the words alone.
    assert_eq!(plain.needs[1], "The seed phrase has 12 words.");
    assert_eq!(plain.needs[2], "No secret dates are needed.");
    assert!(!plain.warning.contains("dates"));
    assert!(!headings(&plain).contains(&"Secret dates"));
}

#[test]
fn a_sheet_says_how_many_codes_are_the_backup_as_printed_cards_end_with_decoys() {
    let long = text_of(HeirSheetFacts {
        backup: HeirBackup::Encoded {
            form: Form::Unicode,
            words: 24,
        },
        mode: Mode::Seedshift,
        dates: 1,
    });
    assert_eq!(
        long.needs[1],
        "The seed phrase has 24 words. On printed cards its backup is the first 24 codes; the cards after them belong to nothing."
    );
    let colors = text_of(direct(HeirBackup::Encoded {
        form: Form::Colors,
        words: 15,
    }));
    assert!(colors.needs[1].contains("the first 10 codes"));
    let with_codes = |format, codes| HeirBackup::Shares {
        format,
        threshold: 2,
        count: 3,
        codes,
    };
    let unicode = text_of(direct(with_codes(ShareFormat::Unicode, Some(21))));
    assert_eq!(
        unicode.needs[1],
        "On printed cards each share is the first 21 codes; the cards after them belong to nothing."
    );
    // Shares in Bytewords have no cards, and the sheet says nothing of them.
    let words = text_of(direct(with_codes(ShareFormat::Words, Some(21))));
    assert!(!words.needs.join(" ").contains("printed cards each share"));
    let none = heir_sheet_text(
        &WalletTool::new(),
        &direct(with_codes(ShareFormat::Unicode, Some(0))),
    );
    assert!(refused(none).1.contains("a whole number of codes"));
}

#[test]
fn a_sheet_leads_through_the_route_of_any_program() {
    let text = text_of(MASKED_SHARES);
    // The route names its own program under the title.
    assert_eq!(
        text.subtitle,
        "Made with the Wallet Tool, free and offline."
    );
    assert_eq!(
        text.steps,
        [
            format!("Open {ADDRESS} on a computer you trust, then go offline."),
            "Open the Shares tab and type 2 shares, then the secret date as day-month-year (23-09-2026)."
                .to_owned(),
            "Open the wallet with this seed phrase in a wallet program (see below).".to_owned(),
        ]
    );
    // One address, the route's, printed once.
    assert_eq!(format!("{text:?}").matches("https://").count(), 1);
    // What every program shares stays the same: what is needed, the warning and the basics.
    let own = heir_sheet_text(&MenuWords, &MASKED_SHARES).expect("the words");
    assert_eq!(text.needs, own.needs);
    assert_eq!(text.basics, own.basics);
    // Without a search for a date digit, the advice offers none.
    assert!(!text.trouble.contains("digit"));
    assert!(own.trouble.contains("menu entry 6 tries every possibility"));
}

/// Expects the route `tool` to make no sheet: it prints an address too many.
#[track_caller]
fn assert_address_refused(tool: &WalletTool) {
    let refusal = refused(heir_sheet_text(tool, &MASKED_SHARES));
    assert_eq!(
        refusal.1,
        "The sheet for heirs may print the route's address once and no other."
    );
}

#[test]
fn a_route_may_print_its_own_address_once_and_no_other() {
    let opening = format!("Open {ADDRESS} on a computer you trust, then go offline.");
    // Another address, with or without http(s)://.
    for other in [
        "https://elsewhere.example/guide",
        "www.elsewhere.example",
        "elsewhere.example/guide",
        "elsewhere.example",
    ] {
        let start = [opening.clone(), format!("See {other}.")];
        assert_address_refused(&WalletTool::at(ADDRESS, &start));
    }
    let name = "hobby-eng/multi-chain-wallet-tools";
    let once = [format!("Find {name} on GitHub, then go offline.")];
    let named = WalletTool::at(name, &once);
    let text = heir_sheet_text(&named, &MASKED_SHARES).expect("the words");
    assert!(text.steps[0].contains(name));
    let twice = [format!("Find {name}."), format!("Or {name}.")];
    assert_address_refused(&WalletTool::at(name, &twice));
    // A longer address that starts with the route's is another address, not the route's.
    for longer in ["/releases/tag/v0.1.0", "-mirror", ".git", "?ref=x"] {
        let start = [
            format!("Open {REPOSITORY}."),
            format!("Or {REPOSITORY}{longer} instead."),
        ];
        assert_address_refused(&WalletTool::at(REPOSITORY, &start));
    }
    let at_end = format!("Open {REPOSITORY}, then go offline.");
    let tool = WalletTool::at(REPOSITORY, std::slice::from_ref(&at_end));
    let text = heir_sheet_text(&tool, &MASKED_SHARES).expect("the words");
    assert_eq!(text.steps[0], at_end);
}

#[test]
fn facts_that_would_print_a_wrong_sheet_are_refused() {
    let route = WalletTool::new();
    let sheet = |facts: HeirSheetFacts| heir_sheet_text(&route, &facts);
    let no_dates = sheet(HeirSheetFacts {
        dates: 0,
        ..MASKED_SHARES
    });
    assert!(refused(no_dates).1.contains("at least one"));
    let dated = sheet(HeirSheetFacts {
        backup: HeirBackup::Encoded {
            form: Form::Unicode,
            words: 24,
        },
        mode: Mode::Direct,
        dates: 1,
    });
    assert_eq!(refused(dated).1, "Dates cannot be used in direct mode.");
    let legacy = sheet(HeirSheetFacts {
        mode: Mode::SeedshiftLegacy,
        ..MASKED_SHARES
    });
    assert_eq!(
        refused(legacy).1,
        "Shares are made without Seedshift or with MnemoCode Seedshift."
    );
    let replaced = sheet(HeirSheetFacts {
        backup: HeirBackup::Encoded {
            form: Form::English,
            words: 12,
        },
        mode: Mode::SeedshiftLegacyValid,
        dates: 1,
    });
    assert!(
        refused(replaced)
            .1
            .contains("A sheet for heirs cannot be made")
    );
}

/// Every kind of backup the sheet describes, with the longest wording of each: the most shares and
/// dates, and the most codes of a share on its cards, the Unicode codes of a 24-word share.
fn every_sheet() -> Vec<HeirSheetFacts> {
    let dated = |mode| if mode == Mode::Direct { 0 } else { MOST_DATES };
    let mut sheets = Vec::new();
    for format in ShareFormat::ALL {
        for mode in [Mode::Direct, Mode::Seedshift] {
            sheets.push(HeirSheetFacts {
                backup: HeirBackup::Shares {
                    format,
                    threshold: 16,
                    count: 16,
                    codes: Some(33),
                },
                mode,
                dates: dated(mode),
            });
        }
    }
    for form in Form::ALL {
        for mode in [Mode::Direct, Mode::Seedshift, Mode::SeedshiftLegacy] {
            sheets.push(HeirSheetFacts {
                backup: HeirBackup::Encoded { form, words: 24 },
                mode,
                dates: dated(mode),
            });
        }
    }
    sheets
}

#[test]
fn every_kind_of_backup_fits_one_sheet_in_both_sizes() {
    let font = UiFont::load();
    // Drawing refuses a front without room for the hint and a back the basics overflow.
    for size in HeirSheetSize::ALL {
        for facts in every_sheet() {
            let text = heir_sheet_text(&MenuWords, &facts).expect("the words");
            let pages = render_heir_sheet(&font, &text, size).expect("the sheet");
            assert_eq!(pages.len(), 2, "{facts:?}");
        }
    }
}

#[test]
fn the_words_of_a_host_with_a_character_outside_the_font_are_refused() {
    // The arrow, U+2192, is outside the font.
    let facts = direct(shares(ShareFormat::Words, 2, 3));
    let subtitle = WalletTool {
        subtitle: "Made with the Wallet Tool \u{2192} free and offline.",
        ..WalletTool::new()
    };
    let restore = WalletTool {
        restore: Some("Choose Tools \u{2192} Shares and type the shares.".to_owned()),
        ..WalletTool::new()
    };
    // On the front, which is measured before it is drawn, and on the back.
    for arrowed in [subtitle, restore] {
        let text = heir_sheet_text(&arrowed, &facts).expect("the words");
        let refusal = render_heir_sheet(&UiFont::load(), &text, HeirSheetSize::A5);
        assert_eq!(
            refused(refusal),
            (
                "export.heir-sheet.instructions-heirs-contain-character-not-supported-by-font",
                "The instructions for heirs contain a character not supported by the font."
                    .to_owned()
            )
        );
    }
}

#[test]
fn a_word_of_a_host_wider_than_the_page_is_refused() {
    // A subtitle without a space, which no line break can split, would run off the page
    // (AUD-039-UI001).
    let wide = WalletTool {
        subtitle: "W".repeat(100).leak(),
        ..WalletTool::new()
    };
    let text = heir_sheet_text(&wide, &direct(shares(ShareFormat::Words, 2, 3))).expect("words");
    for size in HeirSheetSize::ALL {
        assert_eq!(
            refused(render_heir_sheet(&UiFont::load(), &text, size)),
            (
                "export.heir-sheet.instructions-heirs-word-wider-than-page",
                "The instructions for heirs contain a word wider than the page.".to_owned()
            )
        );
    }
}

#[test]
fn a_quorum_that_no_set_has_is_refused_and_each_that_a_restore_reads_is_kept() {
    let needs = |threshold, count| text_of(direct(shares(ShareFormat::Ur, threshold, count))).needs;
    assert!(needs(2, 3)[0].starts_with("Any 2 of the 3 Shamir shares"));
    assert!(needs(16, 16)[0].starts_with("Any 16 of the 16 Shamir shares"));
    // A split never makes them, but a restore reads them.
    assert!(needs(1, 2)[0].starts_with("Any 1 of the 2 Shamir shares"));
    let colors = text_of(direct(HeirBackup::Encoded {
        form: Form::Colors,
        words: 12,
    }));
    assert!(colors.needs[0].starts_with("The backup: color codes"));
    for (threshold, count) in [(4, 3), (0, 3), (2, 17)] {
        let facts = direct(shares(ShareFormat::Ur, threshold, count));
        let refusal = refused(heir_sheet_text(&WalletTool::new(), &facts));
        assert!(
            refusal
                .1
                .starts_with("A sheet for heirs needs a threshold from 1 to the number of shares")
                && refusal.1.ends_with("and at most 16 shares."),
            "{threshold} of {count}"
        );
    }
    assert_eq!(
        refused(Form::named("unknown")).0,
        "core.encoded-form.unsupported-encoded-format"
    );
    assert!(
        refused(ShareFormat::named("unknown"))
            .1
            .contains("The share format must be one of:")
    );
}

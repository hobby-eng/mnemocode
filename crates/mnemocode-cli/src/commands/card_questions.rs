//! The questions of the printable cards of a backup (MnemoCode TS 0.1.0's `cli/card-questions.ts`,
//! CAP-CARDS-MENU-CARD-QUESTIONS): the design, the layout and the turn of the sheets, the kind of
//! file and where it goes, and the details printed on them. None of them is a secret.

use mnemocode::random::{Random, RandomError};
use mnemocode_cards::details::{CardCopy, resolve_presentation};
use mnemocode_cards::settings::{CardProfile, Orientation, PageSize, ProfileField, SHEET_QR_HOLDS};
use mnemocode_cards::sheet::SHEET_PLAN_TEXT;
use mnemocode_cards::templates::CARD_TEMPLATES;
use mnemocode_cards::text_rules::{HIDE_MARKER, MAX_CARD_TEXT_LENGTH};

use super::asking::{ask_list, ask_warned};
use super::cards::PROFILE_OPTIONS;
use super::encode_questions::file_questions;
use super::output_questions::{ask_new_folder, ask_output_file};
use crate::gate::Stop;
use crate::terminal::{Choice, Chosen, Explanation, LineQuestion, ask_line, readme_link};

/// A random source that always answers 0: the fixed choice of the other texts, which a check of one
/// text does not use.
struct FirstChoice;

impl Random for FirstChoice {
    fn fill(&mut self, bytes: &mut [u8]) -> Result<(), RandomError> {
        bytes.fill(0);
        Ok(())
    }
}

/// Why a detail that starts with - is typed again.
const OPTION_LIKE: &str =
    "A detail that starts with - would be read as an option; leave out the -.";

/// Which design, with Every design first where `with_every`; for `separate` cards only the designs
/// that draw them. Its id, empty for every design; none for back.
pub(crate) fn ask_design(with_every: bool, separate: bool) -> Result<Option<String>, Stop> {
    let mut designs: Vec<Choice<String>> = Vec::new();
    if with_every {
        designs.push(Choice::noted(
            "Every design",
            "all in one PDF",
            String::new(),
        ));
    }
    for template in CARD_TEMPLATES {
        if !separate || template.draws_separate_cards() {
            designs.push(Choice::noted(
                &template.name(),
                template.id,
                template.id.to_owned(),
            ));
        }
    }
    ask_list("Which card design?", "Design", &designs, None)
}

/// How the cards are laid out: on sheets of one size, or as separate business cards.
#[derive(Clone, Copy, PartialEq, Eq)]
enum CardLayout {
    Sheets(PageSize),
    Separate,
}

/// How sheets are turned.
#[derive(Clone, Copy)]
enum SheetTurn {
    Turned(Orientation),
    Best,
}

/// A kind of file.
#[derive(Clone, Copy, PartialEq, Eq)]
enum FileKind {
    Pdf,
    Png,
    Jpg,
}

impl FileKind {
    /// Its value of --image-format; none for the PDF.
    const fn image(self) -> Option<&'static str> {
        match self {
            Self::Pdf => None,
            Self::Png => Some("png"),
            Self::Jpg => Some("jpg"),
        }
    }
}

/// The options of how the sheets are turned; none where their size decides.
fn ask_sheet_turn() -> Result<Option<Vec<String>>, Stop> {
    let turns = [
        Choice::noted(
            "Landscape",
            "wider than tall",
            SheetTurn::Turned(Orientation::Landscape),
        ),
        Choice::noted(
            "Portrait",
            "taller than wide",
            SheetTurn::Turned(Orientation::Portrait),
        ),
        // Without --orientation the commands turn each sheet as the plan chooses.
        Choice::noted(
            "Whichever fills the sheet best",
            SHEET_PLAN_TEXT,
            SheetTurn::Best,
        ),
    ];
    let turn = ask_list(
        "How should the sheets be turned?",
        "Orientation",
        &turns,
        None,
    )?;
    Ok(turn.map(|turn| match turn {
        SheetTurn::Best => Vec::new(),
        SheetTurn::Turned(orientation) => {
            vec!["--orientation".to_owned(), orientation.name().to_owned()]
        }
    }))
}

/// The options of the chosen way of saving, and whether it gives sheets.
struct CardFiles {
    options: Vec<String>,
    sheets: bool,
}

/// How the cards are saved, in files named after `base`: first the kind of file, then the layout.
/// Sheets in a PDF go into one file; separate business cards and images go into a new folder.
fn ask_card_files(base: &str, shares: bool) -> Result<Option<CardFiles>, Stop> {
    let kinds = [
        Choice::noted("PDF", "prints at its exact size", FileKind::Pdf),
        Choice::noted("PNG", "sharp text and QR codes", FileKind::Png),
        Choice::noted("JPEG", "smaller files", FileKind::Jpg),
    ];
    let Some(kind) = ask_list("Which kind of file?", "Files", &kinds, None)? else {
        return Ok(None);
    };
    let sheet = |size: PageSize, note: String| {
        Choice::noted(
            &format!("{} sheets", size.name().to_uppercase()),
            &note,
            CardLayout::Sheets(size),
        )
    };
    let layouts = [
        sheet(
            PageSize::A6,
            format!("{}, the usual choice", PageSize::A6.label()),
        ),
        sheet(PageSize::A5, PageSize::A5.label()),
        sheet(PageSize::A4, PageSize::A4.label()),
        Choice::noted(
            "Separate business cards",
            &format!("{}, one file each", PageSize::Business.label()),
            CardLayout::Separate,
        ),
    ];
    let Some(layout) = ask_list(
        "How should the cards be laid out?",
        "Layout",
        &layouts,
        None,
    )?
    else {
        return Ok(None);
    };
    let image: Vec<String> = kind
        .image()
        .map(|format| vec!["--image-format".to_owned(), format.to_owned()])
        .unwrap_or_default();
    let CardLayout::Sheets(size) = layout else {
        let Some(folder) = ask_new_folder(base)? else {
            return Ok(None);
        };
        let mut options = vec!["--cards-dir".to_owned(), folder];
        if shares {
            options.extend(["--card-layout".to_owned(), "individual".to_owned()]);
        }
        options.extend(image);
        return Ok(Some(CardFiles {
            options,
            sheets: false,
        }));
    };
    // Sheets only: a separate card has the shape of a business card.
    let Some(turn) = ask_sheet_turn()? else {
        return Ok(None);
    };
    // The page size that the commands take when none is given is left out of the command.
    let mut size_options = Vec::new();
    if size != PageSize::A6 {
        size_options.extend(["--page-size".to_owned(), size.name().to_owned()]);
    }
    size_options.extend(turn);
    let mut options = Vec::new();
    if kind == FileKind::Pdf {
        let path = ask_output_file(file_questions::PDF, &format!("{base}.pdf"))?;
        let Some(path) = path else {
            return Ok(None);
        };
        options.extend(["--pdf".to_owned(), path]);
    } else {
        let Some(folder) = ask_new_folder(&format!("{base}-images"))? else {
            return Ok(None);
        };
        options.extend(["--images-dir".to_owned(), folder]);
        options.extend(image);
    }
    options.extend(size_options);
    Ok(Some(CardFiles {
        options,
        sheets: true,
    }))
}

/// A detail's answer that the command line would read as an option.
fn refuse_option_like(answer: &str) -> Result<(), String> {
    if answer.starts_with('-') {
        return Err(OPTION_LIKE.to_owned());
    }
    Ok(())
}

/// The question of each detail of the person on the cards.
const fn person_question(field: ProfileField) -> &'static str {
    match field {
        ProfileField::Name => "Name, in Latin letters",
        ProfileField::Role => "Role",
        ProfileField::Company => "Company",
        ProfileField::Email => "Email",
        ProfileField::Phone => "Phone",
        ProfileField::Website => "Website",
        ProfileField::Location => "Location",
    }
}

/// A person's detail, checked as the command checks it.
fn check_person(field: ProfileField, answer: &str) -> Result<String, String> {
    refuse_option_like(answer)?;
    let mut profile = CardProfile::default();
    profile.set(field, answer.to_owned());
    let checked = profile.validated().map_err(|error| error.to_string())?;
    Ok(checked.get(field).unwrap_or_default().to_owned())
}

/// A text around the cards, which "-" leaves off, checked as a presentation is.
fn check_text(copy: impl FnOnce(String) -> CardCopy, answer: &str) -> Result<String, String> {
    if answer == HIDE_MARKER {
        return Ok(answer.to_owned());
    }
    refuse_option_like(answer)?;
    resolve_presentation(&mut FirstChoice, &copy(answer.to_owned()))
        .map_err(|error| error.to_string())?;
    Ok(answer.to_owned())
}

/// The longest detail that a card prints, in the longest characters: 400 bytes.
const DETAIL_LIMIT: usize = (4 * MAX_CARD_TEXT_LENGTH).next_power_of_two();

/// Asks one detail; its answer checked by `check`; none for back, empty keeps it random.
fn ask_detail(
    question: &str,
    label: &str,
    check: &dyn Fn(&str) -> Result<String, String>,
) -> Result<Option<String>, Stop> {
    let asked = ask_line(
        question,
        label,
        LineQuestion {
            optional: Some("random"),
            limit: DETAIL_LIMIT,
            ..LineQuestion::default()
        },
        check,
    )?;
    match asked {
        Chosen::One(answer) => Ok(Some(answer)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// One asking of the details, with `warning` above its first question; none for back.
fn ask_details_once(sheets: bool, warning: Option<&str>) -> Result<Option<Vec<String>>, Stop> {
    let explanation = Explanation {
        lines: vec![
            "A decoy that makes the cards look ordinary; no secret, shown in the command."
                .to_owned(),
        ],
        more: vec![readme_link("cards-and-qr-codes")],
    };
    let choices = [
        Choice::noted("No, random", "invented names and contacts", false),
        Choice::noted("Yes", "Enter on a detail keeps it random", true),
    ];
    let own = ask_warned(
        "Type your own details for the cards?",
        "Details",
        &choices,
        Some(&explanation),
        warning,
    )?;
    let Some(own) = own else {
        return Ok(None);
    };
    if !own {
        return Ok(Some(Vec::new()));
    }
    let mut options = Vec::new();
    for (field, option) in PROFILE_OPTIONS {
        let label = field.label();
        let check = move |answer: &str| check_person(field, answer);
        let Some(answer) = ask_detail(person_question(field), &label, &check)? else {
            return Ok(None);
        };
        if !answer.is_empty() {
            options.extend([format!("--{option}"), answer]);
        }
    }
    type Text = (
        &'static str,
        &'static str,
        &'static str,
        fn(String) -> CardCopy,
    );
    let texts: Vec<Text> = if sheets {
        vec![
            ("studio-name", "Studio name", "Studio", |text| CardCopy {
                studio_name: Some(text),
                ..CardCopy::default()
            }),
            ("card-slogan", "Slogan", "Slogan", |text| CardCopy {
                slogan: Some(text),
                ..CardCopy::default()
            }),
            ("card-subtitle", "Subtitle", "Subtitle", |text| CardCopy {
                subtitle: Some(text),
                ..CardCopy::default()
            }),
            ("card-footer", "Footer", "Footer", |text| CardCopy {
                footer: Some(text),
                ..CardCopy::default()
            }),
        ]
    } else {
        vec![(
            "card-reference-label",
            "Label before each code",
            "Reference",
            |text| CardCopy {
                reference_label: Some(text),
                ..CardCopy::default()
            },
        )]
    };
    for (option, question, label, copy) in texts {
        let check = move |answer: &str| check_text(copy, answer);
        let Some(answer) = ask_detail(question, label, &check)? else {
            return Ok(None);
        };
        if !answer.is_empty() {
            options.extend([format!("--{option}"), answer]);
        }
    }
    Ok(Some(options))
}

/// The details on the cards: random, or typed one by one. Typed details that the cards with the
/// options `chosen` cannot print (`fit`) are explained in one warning line and asked for again,
/// with every other answer kept.
fn ask_card_details(
    sheets: bool,
    chosen: &[String],
    fit: &dyn Fn(&[String]) -> Result<(), Stop>,
) -> Result<Option<Vec<String>>, Stop> {
    let mut warning: Option<String> = None;
    loop {
        let Some(details) = ask_details_once(sheets, warning.as_deref())? else {
            return Ok(None);
        };
        // Random details fit every design: only a typed one may not.
        if details.is_empty() {
            return Ok(Some(details));
        }
        let all: Vec<String> = chosen.iter().chain(&details).cloned().collect();
        match fit(&all) {
            Ok(()) => return Ok(Some(details)),
            Err(Stop::Refused(refusal)) => warning = Some(refusal.to_string()),
            Err(stop) => return Err(stop),
        }
    }
}

/// Printable cards: how the cards are saved in files named after `base`, the design, a QR code on
/// each sheet, and the details on them, which `fit` checks as the command will. Separate business
/// cards never carry a QR code. `shares`: the cards of Shamir shares, one set per share.
pub(crate) fn ask_cards(
    base: &str,
    shares: bool,
    fit: &dyn Fn(&[String]) -> Result<(), Stop>,
) -> Result<Option<Vec<String>>, Stop> {
    let Some(files) = ask_card_files(base, shares)? else {
        return Ok(None);
    };
    let Some(design) = ask_design(false, !files.sheets)? else {
        return Ok(None);
    };
    let qr = if files.sheets {
        let choices = [
            Choice::noted("Yes", "also saved as a PNG image", true),
            Choice::noted("No", "the cards alone", false),
        ];
        let question = format!("Add a QR code with {SHEET_QR_HOLDS}?");
        match ask_list(&question, "QR code", &choices, None)? {
            Some(qr) => qr,
            None => return Ok(None),
        }
    } else {
        false
    };
    let mut chosen = vec!["--template".to_owned(), design];
    chosen.extend(files.options);
    if qr {
        chosen.push("--card-qr".to_owned());
    }
    let Some(details) = ask_card_details(files.sheets, &chosen, fit)? else {
        return Ok(None);
    };
    chosen.extend(details);
    Ok(Some(chosen))
}

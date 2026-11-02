//! The questions of a new backup, as Encode asks them (MnemoCode TS 0.1.0's
//! `cli/encode-questions.ts`): its form, Seedshift, Shamir shares, where it goes, its cards and the
//! sheet for heirs, each answer checked at once and recorded as the command line takes it. The
//! start menu asks them for Encode and for its other entries that write a backup; re-encode asks
//! them on its private screen once the phrase of the old backup is confirmed. None of them is a
//! secret.

use mnemocode::bip39::phrase::Phrase;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::split::{MAX_SHARES, MIN_THRESHOLD, ShareSetChoice};
use mnemocode::text::words::list_in_words;

use super::asking::ask_list;
use super::card_questions::ask_cards;
use super::cards::color_cards_fit_of;
use super::encode::ORIGINAL_COPY_FORM;
use super::given::{PATH_LIMIT, format_number};
use super::output_questions::{ask_new_folder, ask_output_file};
use super::share_output::share_cards_fit_of;
use crate::gate::Stop;
use crate::terminal::{
    Choice, Chosen, Explanation, LineQuestion, ask_line, notes_room, readme_link,
};

/// The phrase of the examples: a public BIP39 test vector (entropy 0x80 repeated). The usual test
/// phrase, abandon ... about, would show the same number and code eleven times.
const EXAMPLE_PHRASE: &str =
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
/// The file that Encode saves a record in by default, and that Decode reads by default.
pub(crate) const RECORD_FILE: &str = "mnemocode-record.txt";
/// The QR code image that Encode saves by default, and that Decode reads by default.
pub(crate) const QR_FILE: &str = "mnemocode-qr.png";
/// The sheet for heirs by default.
pub(crate) const HEIR_SHEET_FILE: &str = "mnemocode-heirs.pdf";
/// The notes of the sheet's sizes, as the menu offers them.
const HEIR_SHEET_SIZES: [(&str, &str, &str); 2] = [
    ("a5", "A5", "notebook size, 148 x 210 mm, larger print"),
    ("a6", "A6", "postcard size, 105 x 148 mm, small print"),
];
/// The name of a question for each kind of file.
pub(crate) mod file_questions {
    pub(crate) const PDF: &str = "PDF file name";
    pub(crate) const TEXT: &str = "Text file name";
    pub(crate) const RECORD: &str = "Record file name";
    pub(crate) const QR: &str = "QR code file name";
}

/// `form` written out for the example phrase, in groups that read well.
pub(crate) fn example(form: Form) -> Result<String, Stop> {
    let phrase = Phrase::parse(EXAMPLE_PHRASE)?;
    let indexes: Vec<u16> = (0..phrase.len())
        .filter_map(|place| phrase.index(place))
        .map(|index| index as u16)
        .collect();
    let written = form.codes(&indexes)?;
    // Forms written joined, as Unicode codes are, are spaced apart code by code.
    Ok(form
        .apart_codes(written.as_str())?
        .map_or_else(|| written.as_str().to_owned(), |codes| codes.join(" ")))
}

/// `text`, a sample of codes separated by spaces, cut after the last whole code that fits `room`
/// with " …", so that a list never cuts a code in half.
pub(crate) fn sample_of(text: &str, room: usize) -> String {
    if text.chars().count() <= room {
        return text.to_owned();
    }
    let mut sample = String::new();
    for code in text.split(' ') {
        let longer = if sample.is_empty() {
            code.to_owned()
        } else {
            format!("{sample} {code}")
        };
        // Two characters for " …".
        if longer.chars().count() + 2 > room {
            break;
        }
        sample = longer;
    }
    format!("{sample} …")
}

/// What the question says of each form, beside its name.
fn form_texts(form: Form) -> (&'static str, String) {
    match form {
        Form::English => (
            "English words",
            "the seed phrase itself, masked with your dates".to_owned(),
        ),
        Form::Indexes => (
            "Word numbers",
            "its place in the BIP39 word list, masked with your dates".to_owned(),
        ),
        Form::Unicode => (
            "Unicode codes",
            "four-digit hexadecimal codes of the Chinese BIP39 words".to_owned(),
        ),
        Form::ColorsUnicode => (
            "Colors as text",
            "the colors written as Unicode codes, no font needed".to_owned(),
        ),
        Form::Colors => (
            "Colors",
            format!(
                "color codes, {} for the whole seed phrase",
                mnemocode::forms::colors::COLOR_COUNTS_TEXT
            ),
        ),
    }
}

/// The forms in the order of their --format numbers, so that the place of a form in the list is its
/// number everywhere; each but the words themselves with a sample.
fn form_choices() -> Result<Vec<Choice<Form>>, Stop> {
    let mut choices: Vec<Choice<Form>> = Form::ALL
        .iter()
        .map(|form| {
            let (label, note) = form_texts(*form);
            Choice::noted(label, &note, *form)
        })
        .collect();
    let room = notes_room(&choices);
    for choice in &mut choices {
        if !choice.value.written_in_words() {
            choice.example = Some(sample_of(&example(choice.value)?, room));
        }
    }
    Ok(choices)
}

/// What Seedshift is, shown with the first question about it; the README explains it.
pub(crate) fn seedshift_explanation() -> Explanation {
    Explanation {
        lines: vec![
            "Masks the seed phrase with dates you remember; only they turn it back.".to_owned(),
        ],
        more: vec![readme_link("transformation-modes")],
    }
}

/// How the two Seedshift transformations differ, shown with the question that chooses one.
pub(crate) fn variant_explanation(always_masked: bool) -> Explanation {
    let mut lines = Vec::new();
    if always_masked {
        lines.push("Always masked: unmasked, this form shows the seed phrase itself.".to_owned());
    }
    lines.push(
        "MnemoCode's result keeps a valid checksum; the original's usually fails it.".to_owned(),
    );
    Explanation {
        lines,
        more: vec![readme_link("how-checksum-valid-seedshift-works")],
    }
}

/// Whether Seedshift is used and which; none means back. A form that is always masked is asked only
/// which (`required`). Standard shares take only MnemoCode Seedshift (`shares`), so there is nothing
/// to choose between, and without it the shares themselves still protect the phrase.
pub(crate) fn ask_seedshift(
    question: &str,
    required: bool,
    shares: bool,
) -> Result<Option<Mode>, Stop> {
    if !required {
        let unmasked = if shares {
            "the shares alone restore it"
        } else {
            "weak: only disguised, anyone with MnemoCode reads it"
        };
        let used = ask_list(
            question,
            "Seedshift",
            &[
                Choice::noted("Yes", "the same dates are needed to get it back", true),
                Choice::noted("No", unmasked, false),
            ],
            Some(&seedshift_explanation()),
        )?;
        match used {
            None => return Ok(None),
            Some(false) => return Ok(Some(Mode::Direct)),
            Some(true) => {}
        }
    }
    if shares {
        return Ok(Some(Mode::Seedshift));
    }
    ask_list(
        "Which Seedshift?",
        "Variant",
        &super::backup_questions::seedshift_choices(),
        Some(&variant_explanation(required)),
    )
}

/// A place a result may go, besides the screen.
#[derive(Clone, Copy)]
enum Place {
    Record,
    ShareFile,
    QrImage,
    QrFolder,
    /// Printable cards of a backup in a form.
    Cards(Form),
    /// Printable cards of shares in a form.
    ShareCards(ShareFormat),
}

/// What each place is called: its note, its name, and the options it asks for.
impl Place {
    const fn note(self) -> &'static str {
        match self {
            Self::Record => "text that Decode reads back",
            Self::ShareFile => "one share per line",
            Self::QrImage => "a PNG file that Decode reads back",
            Self::QrFolder => "one PNG per share, in a new folder",
            Self::Cards(_) => "a PDF or images in a card design",
            Self::ShareCards(format) if format.is_color() => "disguised, one sheet per share",
            Self::ShareCards(_) => "its codes on cards, one sheet per share",
        }
    }

    /// Whether a QR code goes with the cards' questions, not one of its own.
    const fn is_qr(self) -> bool {
        matches!(self, Self::QrImage | Self::QrFolder)
    }

    const fn is_cards(self) -> bool {
        matches!(self, Self::Cards(_) | Self::ShareCards(_))
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Record => "a record file",
            Self::ShareFile => "a text file",
            Self::QrImage => "a QR code image",
            Self::QrFolder => "QR code images",
            Self::Cards(_) | Self::ShareCards(_) => "printable cards",
        }
    }

    /// Asks where it goes; none when the person goes back.
    fn ask(self) -> Result<Option<Vec<String>>, Stop> {
        let (option, path) = match self {
            Self::Record => (
                "--output",
                ask_output_file(file_questions::RECORD, RECORD_FILE)?,
            ),
            Self::ShareFile => (
                "--output",
                ask_output_file(file_questions::TEXT, "mnemocode-shares.txt")?,
            ),
            Self::QrImage => ("--qr", ask_output_file(file_questions::QR, QR_FILE)?),
            Self::QrFolder => ("--qr-dir", ask_new_folder("mnemocode-share-qr")?),
            Self::Cards(form) => {
                return ask_cards("mnemocode-cards", false, &|options| {
                    color_cards_fit_of(options, form)
                });
            }
            Self::ShareCards(format) => {
                return ask_cards("mnemocode-share-cards", true, &|options| {
                    share_cards_fit_of(options, format)
                });
            }
        };
        Ok(path.map(|path| vec![option.to_owned(), path]))
    }
}

/// Where a result goes.
#[derive(Clone, Copy)]
enum Destination {
    Screen,
    One(Place),
    All,
}

/// One extra destination, or all of them: the result is shown on the screen in any case.
fn ask_destination(question: &str, places: &[Place]) -> Result<Option<Vec<String>>, Stop> {
    // Card questions own QR output when cards are offered.
    let offered: Vec<Place> = if places.iter().any(|place| place.is_cards()) {
        places
            .iter()
            .copied()
            .filter(|place| !place.is_qr())
            .collect()
    } else {
        places.to_vec()
    };
    let places = offered.as_slice();
    let mut choices = vec![Choice::new("Only on this screen", Destination::Screen)];
    for place in places {
        choices.push(Choice::noted(
            &format!("Screen and {}", place.name()),
            place.note(),
            Destination::One(*place),
        ));
    }
    let mut named = vec!["the screen"];
    named.extend(places.iter().map(|place| place.name()));
    choices.push(Choice::noted(
        "All of these",
        &list_in_words(&named, "and"),
        Destination::All,
    ));
    let Some(destination) = ask_list(question, "Output", &choices, None)? else {
        return Ok(None);
    };
    let asks: Vec<Place> = match destination {
        Destination::Screen => Vec::new(),
        Destination::One(place) => vec![place],
        Destination::All => places.to_vec(),
    };
    let mut options = Vec::new();
    for place in asks {
        let Some(asked) = place.ask()? else {
            return Ok(None);
        };
        options.extend(asked);
    }
    Ok(Some(options))
}

/// One copy in the chosen form, and where it goes.
fn ask_copy_destination(form: Form, mode: Mode) -> Result<Option<Vec<String>>, Stop> {
    let mut places = vec![Place::Record, Place::QrImage];
    if form.has_cards() {
        places.push(Place::Cards(form));
    }
    let Some(destination) = ask_destination("Where should the result go?", &places)? else {
        return Ok(None);
    };
    let mut run: Vec<String> = ["encode", "--ask-secrets", "--format"]
        .map(str::to_owned)
        .to_vec();
    run.push(format_number(form).to_string());
    run.extend(["--mode".to_owned(), mode.id().to_owned()]);
    run.extend(destination);
    Ok(Some(run))
}

/// Where the shares go, written in `format`.
pub(crate) fn ask_shares(
    set: ShareSetChoice,
    format: ShareFormat,
) -> Result<Option<Vec<String>>, Stop> {
    let mut places = vec![Place::ShareFile, Place::QrFolder];
    // Cards print each share in its form: its colors, or its codes beside colors that only decorate.
    if format.has_cards() {
        places.push(Place::ShareCards(format));
    }
    let Some(outputs) = ask_destination("Where should the shares go?", &places)? else {
        return Ok(None);
    };
    let mut options = vec![
        "--threshold".to_owned(),
        set.threshold().to_string(),
        "--shares".to_owned(),
        set.count().to_string(),
        "--share-format".to_owned(),
        format.name().to_owned(),
    ];
    options.extend(outputs);
    Ok(Some(options))
}

/// What the answer to the shares is.
#[derive(Clone, Copy)]
enum SetAnswer {
    No,
    Set(ShareSetChoice),
    Other,
}

/// What Shamir shares are, shown with the question how many to make.
pub(crate) fn shares_explanation() -> Explanation {
    Explanation {
        lines: vec![
            "Shares in this form; restoring gives it back.".to_owned(),
            "Fewer cannot restore it, but still show its length.".to_owned(),
        ],
        more: vec![readme_link("splitting-a-mnemonic-into-shares")],
    }
}

/// How many Shamir shares, and how many of them restore the seed phrase: one of the usual sets, or
/// Other, which takes any that SSKR allows. `Some(None)` for No, which Encode offers first
/// (`with_no`); none at all for back.
pub(crate) fn ask_share_set(
    question: &str,
    explanation: &Explanation,
    with_no: bool,
) -> Result<Option<Option<ShareSetChoice>>, Stop> {
    let mut choices = Vec::new();
    if with_no {
        choices.push(Choice::noted(
            "No",
            "one encoded copy, not split",
            SetAnswer::No,
        ));
    }
    for preset in ShareSetChoice::PRESETS {
        choices.push(Choice::noted(
            &preset.label(),
            &preset.note(),
            SetAnswer::Set(preset),
        ));
    }
    choices.push(Choice::noted(
        "Other",
        &format!("type the numbers, up to {MAX_SHARES} shares"),
        SetAnswer::Other,
    ));
    Ok(
        match ask_list(question, "Shares", &choices, Some(explanation))? {
            None => None,
            Some(SetAnswer::No) => Some(None),
            Some(SetAnswer::Set(set)) => Some(Some(set)),
            Some(SetAnswer::Other) => ask_other_share_set()?.map(Some),
        },
    )
}

/// A typed number of a share set, recorded as the command line takes it.
fn ask_number(
    question: &str,
    label: &str,
    what: &str,
    parse: impl Fn(&str) -> Result<usize, mnemocode::text::numbers::TypedNumberRefused>,
) -> Result<Option<usize>, Stop> {
    let how = LineQuestion {
        what: Some(what),
        limit: PATH_LIMIT,
        ..LineQuestion::default()
    };
    let answer = ask_line(question, label, how, |answer: &str| {
        parse(answer).map(|number| number.to_string())
    })?;
    match answer {
        Chosen::One(number) => Ok(number.parse().ok()),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// A threshold of the person's own: the number of shares, then how many of them restore the phrase,
/// each checked as SSKR checks it and asked again alone when it cannot be used.
fn ask_other_share_set() -> Result<Option<ShareSetChoice>, Stop> {
    let Some(count) = ask_number(
        &format!("How many shares in all? ({MIN_THRESHOLD} to {MAX_SHARES})"),
        "In all",
        &format!("a number from {MIN_THRESHOLD} to {MAX_SHARES}"),
        ShareSetChoice::typed_count,
    )?
    else {
        return Ok(None);
    };
    let Some(threshold) = ask_number(
        "How many of them restore the seed phrase?",
        "Restore",
        &format!("a number from {MIN_THRESHOLD} to {count}"),
        |answer| ShareSetChoice::typed_threshold(answer, count),
    )?
    else {
        return Ok(None);
    };
    Ok(Some(ShareSetChoice::of(threshold, count)?))
}

/// One opt-in original-copy question for masked backups and shares; the default shows none.
fn ask_original_copy(mode: Mode, shares: bool) -> Result<Option<bool>, Stop> {
    let masked = mode.masked();
    let question = if masked {
        "Also show the original seed phrase, before Seedshift?"
    } else {
        "Also show the original seed phrase beside the shares?"
    };
    let line = format!(
        "{}{}",
        if masked {
            "Before Seedshift; no dates needed. "
        } else {
            ""
        },
        if shares {
            "No shares needed. Keep it apart from the shares."
        } else {
            "Keep it apart from the encoded backup."
        }
    );
    ask_list(
        question,
        "Copy",
        &[
            Choice::noted(
                "No",
                if shares {
                    "only the shares"
                } else {
                    "only the encoded result"
                },
                false,
            ),
            Choice::noted("Yes, show the words", "for visual checking", true),
        ],
        Some(&Explanation {
            lines: vec![line],
            more: Vec::new(),
        }),
    )
}

/// The optional sheet that tells heirs how to restore the backup, where a backup made in `mode` can
/// have one.
pub(crate) fn ask_heir_sheet(mode: Mode) -> Result<Option<Vec<String>>, Stop> {
    if !mode.capabilities().heir_sheet {
        return Ok(Some(Vec::new()));
    }
    let mut choices = vec![Choice::new("No", "")];
    for (size, name, note) in HEIR_SHEET_SIZES {
        choices.push(Choice::noted(&format!("Yes, {name}"), note, size));
    }
    let explanation = Explanation {
        lines: vec!["A printed page on how to restore the backup; it holds no secret.".to_owned()],
        more: vec![readme_link("instructions-for-heirs")],
    };
    let Some(size) = ask_list(
        "Instructions for your heirs?",
        "Heirs",
        &choices,
        Some(&explanation),
    )?
    else {
        return Ok(None);
    };
    if size.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let Some(path) = ask_output_file(file_questions::PDF, HEIR_SHEET_FILE)? else {
        return Ok(None);
    };
    Ok(Some(vec![
        "--heir-sheet".to_owned(),
        path,
        "--heir-sheet-size".to_owned(),
        size.to_owned(),
    ]))
}

/// The questions of a new backup, as Encode asks them: its form, Seedshift, Shamir shares, where it
/// goes and the sheet for heirs; Encode's command line, or none for back. The shares are written in
/// the same form, so that whatever is chosen looks alike.
pub(crate) fn ask_encoding() -> Result<Option<Vec<String>>, Stop> {
    let Some(form) = ask_form()? else {
        return Ok(None);
    };
    ask_encoding_in(form)
}

/// The first question of a new backup: its form; none for back.
pub(crate) fn ask_form() -> Result<Option<Form>, Stop> {
    ask_list(
        "Which form should the seed phrase take?",
        "Form",
        &form_choices()?,
        None,
    )
}

/// The questions of a new backup after its `form`.
pub(crate) fn ask_encoding_in(form: Form) -> Result<Option<Vec<String>>, Stop> {
    let Some(mode) = ask_seedshift("Use Seedshift?", form.always_masked(), false)? else {
        return Ok(None);
    };
    // The Original Seedshift cannot be split into shares (mnemocode encode --help).
    let set = if mode.capabilities().split {
        match ask_share_set("Split it into Shamir shares?", &shares_explanation(), true)? {
            Some(set) => set,
            None => return Ok(None),
        }
    } else {
        None
    };
    let run = match set {
        None => ask_copy_destination(form, mode)?,
        Some(set) => ask_shares(set, ShareFormat::mirroring(form))?.map(|shares| {
            let mut run: Vec<String> = ["encode", "--sskr", "--ask-secrets", "--mode"]
                .map(str::to_owned)
                .to_vec();
            run.push(mode.id().to_owned());
            run.extend(shares);
            run
        }),
    };
    let Some(mut run) = run else {
        return Ok(None);
    };
    if set.is_some() || mode.masked() {
        let Some(copy) = ask_original_copy(mode, set.is_some())? else {
            return Ok(None);
        };
        if copy {
            run.extend(["--show-original".to_owned(), ORIGINAL_COPY_FORM.to_owned()]);
        }
    }
    // Codes in words show the masked words already; shares never do.
    if mode.masked() && (set.is_some() || !form.written_in_words()) {
        let Some(show_words) = ask_list(
            "Also show the Seedshift phrase as English words?",
            "Decoy words",
            &[
                Choice::noted("No", "keep only the codes or shares", false),
                Choice::noted("Yes", "the masked phrase; the dates are still needed", true),
            ],
            None,
        )?
        else {
            return Ok(None);
        };
        if show_words {
            run.push("--show-masked-words".to_owned());
        }
    }
    let Some(heirs) = ask_heir_sheet(mode)? else {
        return Ok(None);
    };
    run.extend(heirs);
    Ok(Some(run))
}

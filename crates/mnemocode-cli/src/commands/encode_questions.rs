//! The questions of a new backup as Encode asks them, each answer checked at once and recorded as
//! the command line takes it. Re-encode and embroidery reuse them; the dates stay in a secret owner
//! beside the non-secret arguments.

use mnemocode::bip39::phrase::Phrase;
use mnemocode::dates::Date;
use mnemocode::forms::Form;
use mnemocode::modes::Mode;
use mnemocode::secret::SecretVec;
use mnemocode::sskr::forms::ShareFormat;
use mnemocode::sskr::split::{MAX_SHARES, MIN_THRESHOLD, ShareSetChoice};
use mnemocode_embroidery::legend::EXAMPLE as LEGEND_EXAMPLE;

use super::asking::{ask_checks, ask_list};
use super::card_questions::ask_cards;
use super::cards::color_cards_fit_of;
use super::given::{PATH_LIMIT, format_number};
use super::output_questions::{new_folder, output_file};
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
pub(crate) const RECORD_FILE: &str = "notes.txt";
/// The QR code image that Encode saves by default, and that Decode reads by default.
pub(crate) const QR_FILE: &str = "qr-code.png";
/// The sheet for heirs by default.
pub(crate) const HEIR_SHEET_FILE: &str = "mnemocode-heirs.pdf";
/// The legend line of a cross-stitch pattern by default, its name saying nothing of what it holds.
const LEGEND_FILE: &str = "cross-stitch-legend.txt";
/// Its QR code image by default.
const LEGEND_QR_FILE: &str = "cross-stitch-legend.png";
/// The first question of a new backup.
const FORM_QUESTION: &str = "Which form should the seed phrase take?";
/// The notes of the sheet's sizes, as the menu offers them.
const HEIR_SHEET_SIZES: [(&str, &str, &str); 2] = [
    ("a5", "A5", "notebook size, 148 x 210 mm, larger print"),
    ("a6", "A6", "postcard size, 105 x 148 mm, small print"),
];
/// The name of a question for each kind of file.
pub(crate) mod file_questions {
    pub(crate) const PDF: &str = "Enter the folder of the patterns, or one pattern's PDF";
    pub(crate) const RECORD: &str = "Enter the record file name";
    pub(crate) const QR: &str = "Enter the QR code file name";
    pub(crate) const PICTURE: &str = "Enter the picture's file name (PNG, JPEG or WebP)";
    pub(crate) const FOUND: &str = "Enter the folder to look in, or the full path of a file";
    pub(crate) const CARDS: &str = "Enter the folder of the cards, or the full path of a card file";
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

/// The name of `form` in the menu's list of forms.
pub(crate) fn form_label(form: Form) -> &'static str {
    form_texts(form).0
}

/// What the question says of each form, beside its name.
fn form_texts(form: Form) -> (&'static str, String) {
    match form {
        Form::English => (
            "English words",
            "looks like an ordinary seed phrase".to_owned(),
        ),
        Form::Indexes => (
            "Word numbers",
            "a number from 1 to 2048 for each word".to_owned(),
        ),
        Form::Unicode => (
            "Unicode codes",
            "a code of four digits and letters for each word".to_owned(),
        ),
        Form::ColorsUnicode => (
            "Colors as text",
            "colors written as codes of four characters".to_owned(),
        ),
        Form::Colors => (
            "Colors",
            format!(
                "{} colors for the whole seed phrase",
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

/// What Seedshift does, as its questions say it.
const MASKS: &str = "Masks the seed phrase with dates you remember; only they turn it back.";
/// Why a form that would show the phrase itself is always masked.
const ALWAYS_MASKED: &str = "Always masked: unmasked, this form shows the seed phrase itself.";
/// How the two Seedshift transformations differ.
const CHECKSUMS: &str = "Both write a valid BIP39 phrase. The Original also shows the last word its shift gave: remember it to restore the phrase exactly.";

/// What Seedshift is, shown with the first question about it; the README explains it.
pub(crate) fn seedshift_explanation() -> Explanation {
    Explanation {
        lines: vec![MASKS.to_owned()],
        more: vec![readme_link("transformation-modes")],
    }
}

/// How the two Seedshift transformations differ, shown with the question that chooses one.
pub(crate) fn variant_explanation(always_masked: bool) -> Explanation {
    let mut lines = Vec::new();
    if always_masked {
        lines.push(ALWAYS_MASKED.to_owned());
    }
    lines.push(CHECKSUMS.to_owned());
    Explanation {
        lines,
        more: vec![readme_link("how-checksum-valid-seedshift-works")],
    }
}

/// What No Seedshift leaves of a backup, where nothing else protects it.
pub(crate) const WEAK: &str = "weak: only disguised, anyone with MnemoCode reads it";

/// Which Seedshift a backup takes, and so which answers its question offers.
#[derive(Clone, Copy)]
pub(crate) enum Takes {
    /// Either transformation.
    Either,
    /// Only MnemoCode Seedshift, whose result is a valid phrase again, as standard shares and the
    /// legend of a pattern need: the original stays in its place, greyed, with `why`. `unmasked`
    /// says what no Seedshift leaves.
    MnemoCodeOnly {
        unmasked: &'static str,
        why: &'static str,
    },
}

/// Whether Seedshift is used and which, on one screen for every new backup: MnemoCode Seedshift,
/// the original and none, always in this order. An answer the backup cannot take stays greyed with
/// its reason: the original where it `takes` only MnemoCode's, none where the form is always
/// masked (`required`). None means back.
pub(crate) fn ask_seedshift(
    question: &str,
    required: bool,
    takes: Takes,
) -> Result<Option<Mode>, Stop> {
    let mut choices = super::backup_questions::seedshift_choices();
    // One line and the link, the same for every backup; a greyed answer says why in its note.
    let lines = vec![MASKS.to_owned()];
    let unmasked = match takes {
        Takes::Either => WEAK,
        Takes::MnemoCodeOnly { unmasked, why } => {
            for choice in choices
                .iter_mut()
                .filter(|choice| choice.value != Mode::Seedshift)
            {
                choice.enabled = false;
                choice.note = Some(why.to_owned());
            }
            unmasked
        }
    };
    let mut none = Choice::noted("No Seedshift", unmasked, Mode::Direct);
    if required {
        none.enabled = false;
        none.note = Some("this form would show the seed phrase itself".to_owned());
    }
    choices.push(none);
    let explanation = Explanation {
        lines,
        more: vec![readme_link("transformation-modes")],
    };
    ask_list(question, "Seedshift", &choices, Some(&explanation))
}

/// A place a result may go, besides the screen.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Place {
    Record,
    /// The PDF of a cross-stitch pattern, its legend in it.
    Pattern,
    /// The PDFs of the patterns of shares, one a share, in a new folder.
    SharePatterns,
    /// The legend line of a cross-stitch pattern, as Decode reads it back.
    Legend,
    /// That line as a QR code image.
    LegendQr,
    /// The legend lines of a pattern's shares, one to a line.
    ShareLegends,
    /// Those lines as QR code images, one to a share.
    ShareLegendQr,
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
            Self::Pattern => "the chart and its legend, to print",
            Self::SharePatterns => "one pattern per share, in a new folder",
            Self::Legend => "the legend line, which Decode reads back",
            Self::LegendQr => "the legend line in a PNG file that Decode reads back",
            Self::ShareLegends => "every share's legend line, one to a line",
            Self::ShareLegendQr => "one PNG per share's legend, in a new folder",
            Self::ShareFile => "one share per line",
            Self::QrImage => "a PNG file that Decode reads back",
            Self::QrFolder => "one PNG per share, in a new folder",
            Self::Cards(_) => "a PDF or images in a card design",
            Self::ShareCards(format) if format.is_color() => "disguised, one sheet per share",
            Self::ShareCards(_) => "its codes on cards, one sheet per share",
        }
    }

    /// Whether it is ticked when the list is first shown: the PDF to print, of cards or a pattern.
    const fn ticked_first(self) -> bool {
        matches!(
            self,
            Self::Pattern | Self::SharePatterns | Self::Cards(_) | Self::ShareCards(_)
        )
    }

    /// Whether it is a QR code image, which asks how the QR code shows its data.
    const fn is_qr(self) -> bool {
        matches!(
            self,
            Self::QrImage | Self::LegendQr | Self::QrFolder | Self::ShareLegendQr
        )
    }

    const fn name(self) -> &'static str {
        match self {
            Self::Record => "a record file",
            Self::Pattern => "a PDF pattern",
            Self::SharePatterns => "PDF patterns",
            Self::Legend => "a text file",
            Self::LegendQr => "a QR code image",
            Self::ShareLegends => "a text file",
            Self::ShareLegendQr => "QR code images",
            Self::ShareFile => "a text file",
            Self::QrImage => "a QR code image",
            Self::QrFolder => "QR code images",
            Self::Cards(_) | Self::ShareCards(_) => "printable cards",
        }
    }

    /// What a QR code of this place holds, the files it is saved as, and their name in a list.
    const fn qr_words(self) -> (&'static str, &'static str, &'static str) {
        match self {
            Self::QrFolder => ("the shares", "PNG files, one per share", "PNG files"),
            Self::LegendQr => ("the legend", "a PNG file", "PNG file"),
            Self::ShareLegendQr => ("the legends", "PNG files, one per share", "PNG files"),
            _ => ("the codes", "a PNG file", "PNG file"),
        }
    }

    /// Asks where it goes; none when the person goes back. `qr`: the QR code's question, which
    /// cards ask after their layout, told whether they are sheets that can carry one.
    fn ask(
        self,
        qr: &mut dyn FnMut(Option<&'static str>) -> Result<Option<Vec<String>>, Stop>,
    ) -> Result<Option<Vec<String>>, Stop> {
        let (option, path) = match self {
            Self::Record => ("--output", output_file(RECORD_FILE)?),
            Self::Pattern => return super::pattern_questions::pattern_file(),
            Self::SharePatterns => return super::pattern_questions::pattern_folder(),
            Self::Legend => ("--output", output_file(LEGEND_FILE)?),
            Self::ShareFile => ("--output", output_file("notes.txt")?),
            Self::QrImage => ("--qr", output_file(QR_FILE)?),
            Self::LegendQr => ("--qr", output_file(LEGEND_QR_FILE)?),
            Self::ShareLegends => ("--output", output_file(LEGEND_FILE)?),
            Self::ShareLegendQr => ("--qr-dir", new_folder("cross-stitch-legend-qr")?),
            Self::QrFolder => ("--qr-dir", new_folder("qr-codes")?),
            Self::Cards(form) => {
                return ask_cards("card-designs", false, qr, &|options| {
                    color_cards_fit_of(options, form)
                });
            }
            Self::ShareCards(format) => {
                return ask_cards("card-design-series", true, qr, &|options| {
                    share_cards_fit_of(options, format)
                });
            }
        };
        let Some(path) = path else {
            return Ok(None);
        };
        Ok(Some(vec![option.to_owned(), path]))
    }
}

/// How a QR code is made: none, an ordinary one, or one that hides what it holds; and where it
/// goes.
#[derive(Clone, Copy, PartialEq, Eq)]
enum QrMade {
    None,
    Ordinary(QrGoes),
    Hidden(QrGoes),
}

/// Where a QR code goes: into the cards only, into them and a PNG file apart, or that file only.
#[derive(Clone, Copy, PartialEq, Eq)]
enum QrGoes {
    Cards,
    CardsAndFile,
    File,
}

/// The options that a QR code's answer gives: those for the cards, and those of its own file.
type QrOptions = (Vec<String>, Vec<String>);

/// The QR code of `place` on one page: none, an ordinary one, or one that hides what it holds;
/// where the cards are sheets, named `cards` ("PDF", "JPEG" or "PNG cards"), also whether they
/// print it, with a PNG file apart or not, or that file holds it alone. A hidden one shows ordinary
/// scanners a business card: the one printed on the cards, or one that MnemoCode invents for a file
/// alone. A file's name is asked in the task's folder. Every entry and its note fit one line. The
/// options for the cards and those of the file apart; none for back.
fn ask_qr(place: Place, cards: Option<&'static str>) -> Result<Option<QrOptions>, Stop> {
    let (holds, files, file) = place.qr_words();
    let ordinary = format!("any scanner shows {holds}");
    let hidden = "scanners see only a contact card";
    let (choices, explanation) = match cards {
        Some(cards) => {
            let mut all = vec![Choice::new("No QR code", QrMade::None)];
            for (kind, note, made) in [
                (
                    "Ordinary",
                    ordinary.as_str(),
                    QrMade::Ordinary as fn(QrGoes) -> QrMade,
                ),
                ("With hidden data", hidden, QrMade::Hidden),
            ] {
                all.push(Choice::noted(
                    &format!("{kind}, {cards} only"),
                    note,
                    made(QrGoes::Cards),
                ));
                all.push(Choice::noted(
                    &format!("{kind}, {cards} + {file}"),
                    note,
                    made(QrGoes::CardsAndFile),
                ));
                all.push(Choice::noted(
                    &format!("{kind}, {file} only"),
                    note,
                    made(QrGoes::File),
                ));
            }
            (
                all,
                format!(
                    "In the {cards} it is printed on every sheet; as {files} it is saved apart. Of a QR code with hidden data, regular scanners see only a contact card, the one on the cards or one MnemoCode invents; MnemoCode reads {holds} from it."
                ),
            )
        }
        None => (
            vec![
                Choice::new("No QR code", QrMade::None),
                Choice::noted(
                    "Ordinary QR code",
                    &ordinary,
                    QrMade::Ordinary(QrGoes::File),
                ),
                Choice::noted(
                    "QR code with hidden data",
                    hidden,
                    QrMade::Hidden(QrGoes::File),
                ),
            ],
            format!(
                "It is saved as {files}. Of a QR code with hidden data, regular scanners see only a contact card that MnemoCode invents; MnemoCode reads {holds} from it."
            ),
        ),
    };
    let explanation = Explanation {
        lines: vec![explanation],
        more: vec![readme_link("qr-codes-with-hidden-records")],
    };
    loop {
        let Some(made) = ask_list("Add a QR code?", "QR code", &choices, Some(&explanation))?
        else {
            return Ok(None);
        };
        let (hidden, goes) = match made {
            QrMade::None => return Ok(Some((Vec::new(), Vec::new()))),
            QrMade::Ordinary(goes) => (false, goes),
            QrMade::Hidden(goes) => (true, goes),
        };
        let mut on_cards: Vec<String> = Vec::new();
        if !matches!(goes, QrGoes::File) {
            on_cards.push("--card-qr".to_owned());
            // The business card printed on the cards is what a scanner shows of the sheets' code.
            if hidden {
                on_cards.push("--qr-hidden".to_owned());
            }
        }
        match goes {
            QrGoes::Cards => return Ok(Some((on_cards, Vec::new()))),
            // The file apart is saved where the cards go, under their name.
            QrGoes::CardsAndFile => {
                on_cards.push("--card-qr-png".to_owned());
                return Ok(Some((on_cards, Vec::new())));
            }
            QrGoes::File => {}
        }
        let mut apart = if hidden {
            super::hidden_qr::invented_card_options()?
        } else {
            Vec::new()
        };
        // The file apart, named in the task's folder; back from its name, this page again.
        let Some(named) = place.ask(&mut |_| Ok(Some(Vec::new())))? else {
            continue;
        };
        apart.extend(named);
        return Ok(Some((on_cards, apart)));
    }
}

/// The ticks of the last list of places answered, with its places: coming back to it from a later
/// step finds them as they were, and another list of places starts from its own defaults.
static LAST_TICKS: std::sync::Mutex<Option<(Vec<Place>, Vec<bool>)>> = std::sync::Mutex::new(None);

/// Asks where the result goes besides the screen, as a checklist, then every ticked place's own
/// questions, the folder among them, then the QR code on a page of its own: within the cards'
/// questions, after their layout, where cards are ticked. None ticked keeps the result on the
/// screen only.
fn ask_destination(question: &str, places: &[Place]) -> Result<Option<Vec<String>>, Stop> {
    let qr_place = places.iter().copied().find(|place| place.is_qr());
    let listed: Vec<Place> = places
        .iter()
        .copied()
        .filter(|place| !place.is_qr())
        .collect();
    let choices: Vec<Choice<Place>> = listed
        .iter()
        .map(|place| Choice::noted(&upper_first(place.name()), place.note(), *place))
        .collect();
    // Shift+Tab after the list, at a place's own question or the QR code, comes back to it with
    // its ticks, the files those claimed given back; so does a later step of the task.
    let remembered = LAST_TICKS
        .lock()
        .ok()
        .and_then(|last| last.clone())
        .filter(|(places, _)| *places == listed)
        .map(|(_, ticks)| ticks);
    let mut ticked: Vec<bool> =
        remembered.unwrap_or_else(|| listed.iter().map(|place| place.ticked_first()).collect());
    let start = super::output_questions::claims_now();
    'list: loop {
        super::output_questions::claims_back_to(start);
        let Some(asks) = ask_checks(question, "Output", &choices, &ticked)? else {
            return Ok(None);
        };
        ticked = listed.iter().map(|place| asks.contains(place)).collect();
        if let Ok(mut last) = LAST_TICKS.lock() {
            *last = Some((listed.clone(), ticked.clone()));
        }
        let mut options = Vec::new();
        // The options of an image apart, once the QR code is asked.
        let mut apart: Option<Vec<String>> = None;
        for place in asks {
            let mut qr = |sheets: Option<&'static str>| -> Result<Option<Vec<String>>, Stop> {
                let Some(qr_place) = qr_place else {
                    return Ok(Some(Vec::new()));
                };
                Ok(ask_qr(qr_place, sheets)?.map(|(on_cards, image)| {
                    apart = Some(image);
                    on_cards
                }))
            };
            let Some(asked) = place.ask(&mut qr)? else {
                continue 'list;
            };
            options.extend(asked);
        }
        // Without cards, the QR code comes last.
        if apart.is_none()
            && let Some(qr_place) = qr_place
        {
            let Some((_, image)) = ask_qr(qr_place, None)? else {
                continue 'list;
            };
            apart = Some(image);
        }
        options.extend(apart.unwrap_or_default());
        return Ok(Some(options));
    }
}

/// `text` with its first letter in upper case: "A record file".
fn upper_first(text: &str) -> String {
    let mut letters = text.chars();
    letters.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(letters).collect()
    })
}

/// Where one copy of a backup is saved besides the screen: a checklist of `places`.
pub(crate) fn ask_copy_destination(places: &[Place]) -> Result<Option<Vec<String>>, Stop> {
    ask_destination(
        "Where should the result be saved? The screen shows it in any case.",
        places,
    )
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
    Ok(share_places(set, &places)?.map(|mut options| {
        options.extend(["--share-format".to_owned(), format.name().to_owned()]);
        options
    }))
}

/// Where the shares of a pattern go, besides the patterns themselves: their legend lines as text
/// and as QR code images.
pub(crate) fn ask_pattern_shares(set: ShareSetChoice) -> Result<Option<Vec<String>>, Stop> {
    share_places(
        set,
        &[
            Place::SharePatterns,
            Place::ShareLegends,
            Place::ShareLegendQr,
        ],
    )
}

/// The options of the share `set`, then of the `places` its shares are saved to, as asked; none for
/// back.
fn share_places(set: ShareSetChoice, places: &[Place]) -> Result<Option<Vec<String>>, Stop> {
    let Some(outputs) = ask_destination(
        "Where should the shares be saved? The screen shows them in any case.",
        places,
    )?
    else {
        return Ok(None);
    };
    let mut options = vec![
        "--threshold".to_owned(),
        set.threshold().to_string(),
        "--shares".to_owned(),
        set.count().to_string(),
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
            "The seed phrase is split into shares, each written in the form you chose."
                .to_owned(),
            "Enough of them, such as any 2 of 3, restore it; one share alone tells only how many words it has."
                .to_owned(),
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

/// Whether a sheet that tells heirs how to restore the backup is made, and its size: asked of every
/// backup. `Some(None)` for none, none for back. Its file is named with the others, last
/// (heir_sheet_files).
pub(crate) fn ask_heir_sheet() -> Result<Option<Option<&'static str>>, Stop> {
    let mut choices = vec![Choice::new("No", None)];
    for (size, name, note) in HEIR_SHEET_SIZES {
        choices.push(Choice::noted(&format!("Yes, {name}"), note, Some(size)));
    }
    let lines = vec!["A printed page on how to restore the backup; it holds no secret.".to_owned()];
    let explanation = Explanation {
        lines,
        more: vec![readme_link("instructions-for-heirs")],
    };
    ask_list(
        "Instructions for your heirs?",
        "Heirs",
        &choices,
        Some(&explanation),
    )
}

/// The options of the sheet for heirs of `size`, its file named in the task's folder; none for
/// back.
pub(crate) fn heir_sheet_files(size: Option<&str>) -> Result<Option<Vec<String>>, Stop> {
    let Some(size) = size else {
        return Ok(Some(Vec::new()));
    };
    let Some(path) = output_file(HEIR_SHEET_FILE)? else {
        return Ok(None);
    };
    Ok(Some(vec![
        "--heir-sheet".to_owned(),
        path,
        "--heir-sheet-size".to_owned(),
        size.to_owned(),
    ]))
}

/// What the first question of the menu's Encode chose.
#[derive(Clone, Copy)]
enum Made {
    Form(Form),
    /// A cross-stitch pattern whose legend holds the phrase masked with Seedshift
    /// (docs/SEEDSTITCH.md).
    Embroidery,
}

/// The questions of a new backup, as Encode asks them: its form, Seedshift, Shamir shares, where it
/// goes and the sheet for heirs; Encode's command line, or none for back. The shares are written in
/// the same form, so that whatever is chosen looks alike. After the forms comes embroidery, which
/// asks its own questions.
pub(crate) fn ask_encoding() -> Result<Option<Vec<String>>, Stop> {
    let mut choices: Vec<Choice<Made>> = form_choices()?
        .into_iter()
        .map(|choice| Choice {
            label: choice.label,
            note: choice.note,
            example: choice.example,
            shortcut: choice.shortcut,
            value: Made::Form(choice.value),
            enabled: choice.enabled,
        })
        .collect();
    // Its label is shorter than the longest form's, so it leaves the room of their samples as it is.
    let sample = sample_of(LEGEND_EXAMPLE, notes_room(&choices));
    choices.push(Choice {
        example: Some(sample),
        ..Choice::noted(
            "Embroidery",
            "hidden in a cross-stitch pattern made from your picture",
            Made::Embroidery,
        )
    });
    match ask_list(FORM_QUESTION, "Form", &choices, None)? {
        None => Ok(None),
        Some(Made::Form(form)) => Ok(Some(vec![
            "encode".to_owned(),
            "--configure".to_owned(),
            "--ask-secrets".to_owned(),
            "--format".to_owned(),
            format_number(form).to_string(),
        ])),
        Some(Made::Embroidery) => Ok(Some(
            ["stitch", "--configure", "--ask-secrets"]
                .map(str::to_owned)
                .to_vec(),
        )),
    }
}

/// The first question of a new backup: its form; none for back.
pub(crate) fn ask_form() -> Result<Option<Form>, Stop> {
    ask_list(FORM_QUESTION, "Form", &form_choices()?, None)
}

/// Non-secret command arguments and separately owned dates from the private screen.
pub(crate) type EncodingAnswers = (Vec<String>, SecretVec<Date>);

/// Asks the new backup's settings in `form`, as every new backup is asked them, and keeps its dates
/// outside the command arguments.
pub(crate) fn ask_encoding_in(
    form: Form,
    finish: &mut super::new_backup::Finish<'_>,
) -> Result<bool, Stop> {
    super::new_backup::ask_new_backup(super::new_backup::Way::Form(form), finish)
}

/// Protected setup for the menu entry that creates standard SSKR shares, in the steps of every new
/// backup; Shift+Tab goes back a step.
pub(crate) fn ask_splitting(finish: &mut super::new_backup::Finish<'_>) -> Result<bool, Stop> {
    use super::new_backup::{Answered, answered, named_file, run_steps};
    let shares = Takes::MnemoCodeOnly {
        unmasked: "the shares alone restore it",
        why: "not for standard shares, which split a valid seed phrase",
    };
    let formats = [
        Choice::noted(
            "Words",
            "Bytewords, such as tuna next keep gyro ...",
            ShareFormat::Words,
        ),
        Choice::noted(
            "Short code",
            "ur:sskr/..., the standard short form",
            ShareFormat::Ur,
        ),
    ];
    let explanation = Explanation {
        lines: vec![
            "Standard SSKR shares of the seed phrase itself, which other SSKR tools read."
                .to_owned(),
        ],
        more: vec![readme_link("splitting-a-mnemonic-into-shares")],
    };
    let mut mode = Mode::Seedshift;
    let mut dates = mnemocode::secret::SecretVec::new(Vec::new());
    let mut format = ShareFormat::Words;
    let mut set = None;
    let mut heir_size = None;
    let mut saved = Vec::new();
    let mut heirs = Vec::new();
    crate::terminal::set_screen_title("Split into shares");
    let names = [
        Some("Seedshift"),
        Some("Dates"),
        Some("Format"),
        Some("Shares"),
        Some("Heirs"),
        Some("Saving"),
        None,
        Some("Phrase"),
    ];
    let done = run_steps(8, &names, |step| {
        Ok(match step {
            0 => answered(
                ask_seedshift("Use Seedshift before splitting?", false, shares)?
                    .map(|chosen| mode = chosen),
            ),
            1 => super::new_backup::dates_step(mode, &mut dates)?,
            // Its own question, after the dates, as every new backup asks its way's.
            2 => answered(
                ask_list(
                    "How should each share be written?",
                    "Shares as",
                    &formats,
                    None,
                )?
                .map(|chosen| format = chosen),
            ),
            3 => match ask_share_set(
                "How many shares, and how many of them restore the seed phrase?",
                &explanation,
                false,
            )? {
                Some(Some(chosen)) => {
                    set = Some(chosen);
                    Answered::Next
                }
                _ => Answered::Back,
            },
            4 => answered(ask_heir_sheet()?.map(|size| heir_size = size)),
            // Last, where the shares are saved.
            5 => match set {
                Some(set) => answered(ask_shares(set, format)?.map(|chosen| saved = chosen)),
                None => Answered::Back,
            },
            6 => {
                let (files, step) = named_file(|| heir_sheet_files(heir_size))?;
                if let Some(files) = files {
                    heirs = files;
                }
                step
            }
            // The seed phrase, Shift+Tab there coming back to the answers.
            _ => {
                let mut run = ["encode", "--sskr", "--ask-secrets", "--mode", mode.id()]
                    .map(str::to_owned)
                    .to_vec();
                run.extend(saved.iter().cloned());
                run.extend(super::new_backup::shown_masked_words(mode, false));
                run.extend(heirs.iter().cloned());
                let dates = mnemocode::secret::SecretVec::new(dates.to_vec());
                if finish((run, dates))? {
                    Answered::Next
                } else {
                    Answered::Back
                }
            }
        })
    })?;
    Ok(done)
}

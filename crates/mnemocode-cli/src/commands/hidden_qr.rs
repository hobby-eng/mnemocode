//! The hidden QR export choice, shared by phrase, share and arbitrary-record exports.
use super::resolved;
use super::saving::{ResultName, save_output};
use crate::args::{ArgsError, Parsed, is_on, value};
use crate::gate::Stop;
use crate::input::read_input_text;
use crate::os;
use mnemocode::qr::{self, QrError};
use mnemocode::secret::SecretBytes;
use mnemocode_cards::details::card_identity;
use mnemocode_cards::settings::{CardProfile, ProfileField};

use super::asking::ask_list;
use crate::os::SystemRandom;
use crate::terminal::{Choice, Chosen, Explanation, LineQuestion, ask_line, readme_link};

const DEFAULT_VISIBLE: &str = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Design collection\r\nEND:VCARD";
/// The options for wrapping an existing exact record without changing its encoding.
pub(crate) const OPEN_OPTIONS: [&str; 2] = ["qr-file", "output"];

pub(crate) const OPTIONS: [&str; 4] = ["input-file", "qr-text", "qr", "qr-hidden"];

/// A plain QR, or an exact hidden record with the chosen public text.
pub(crate) fn image(parsed: &Parsed, record: &str) -> Result<SecretBytes, QrError> {
    if is_on(parsed, "qr-hidden") {
        qr::hidden::png(value(parsed, "qr-text").unwrap_or(DEFAULT_VISIBLE), record)
    } else {
        qr::png(record)
    }
}

/// Wrap an already protected record or a SeedStitch legend in a separate QR image.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let input = value(parsed, "input-file")
        .ok_or_else(|| ArgsError::Required("--input-file PATH".to_owned()))?;
    if value(parsed, "qr").is_none() {
        return Err(ArgsError::Required("--qr PATH".to_owned()).into());
    }
    let record = read_input_text(input, "The hidden record", 4096)?;
    let shown = value(parsed, "qr-text").unwrap_or(DEFAULT_VISIBLE);
    let image = qr::hidden::png(shown, record.as_str())?;
    if save_output(
        &mut parsed.clone(),
        "qr",
        ResultName::one("The QR code"),
        |path| os::publish_new_file(&resolved(path), &image),
    )?
    .is_some()
    {
        super::share_output::report_qr_verified(1);
    }
    Ok(())
}

/// What a QR scanner shows of a QR code image of a backup.
#[derive(Clone, Copy)]
enum Shown {
    /// A contact that MnemoCode invents.
    InventedCard,
    /// The person's own contact.
    OwnCard,
    /// A web address.
    Link,
    /// A short text.
    Text,
    /// The backup codes themselves: an ordinary QR code.
    Codes,
}

/// The longest public text a person types.
const PUBLIC_TEXT_LIMIT: usize = 400;

/// What a QR scanner shows of the QR code, asked until a public text is given or the backup
/// codes chosen: the options of the QR code image, or none for back.
pub(crate) fn ask_options() -> Result<Option<Vec<String>>, Stop> {
    let choices = [
        Choice::noted(
            "A business card",
            "a contact that MnemoCode invents",
            Shown::InventedCard,
        ),
        Choice::noted(
            "My own business card",
            "your name, company, phone and email",
            Shown::OwnCard,
        ),
        Choice::noted(
            "A web link",
            "an address such as https://example.com",
            Shown::Link,
        ),
        Choice::noted("A short text", "any words you choose", Shown::Text),
        Choice::noted(
            "Nothing hidden",
            "a scanner shows the backup codes themselves",
            Shown::Codes,
        ),
    ];
    let explanation = Explanation {
        lines: vec![
            "A QR scanner shows only this; MnemoCode reads your backup, hidden in the same code. Never put your dates or anything private here.".to_owned(),
        ],
        more: vec![readme_link("qr-codes-with-hidden-records")],
    };
    loop {
        let Some(shown) = ask_list(
            "What should a QR scanner show?",
            "QR code",
            &choices,
            Some(&explanation),
        )?
        else {
            return Ok(None);
        };
        let text = match shown {
            Shown::Codes => return Ok(Some(Vec::new())),
            Shown::InventedCard => Some(business_card(&CardProfile::default())?),
            Shown::OwnCard => ask_own_card()?,
            Shown::Link => ask_public(
                ("Web address", "Web link"),
                "A QR scanner offers to open this address. Choose one that says nothing about you, such as a shop or a museum.",
                web_link,
            )?,
            Shown::Text => ask_public(
                ("Text", "Text"),
                "A QR scanner shows these words as they are.",
                |text| Ok(text.to_owned()),
            )?,
        };
        // Back from a typed text: what the QR code shows is asked again.
        if let Some(text) = text {
            return Ok(Some(vec![
                "--qr-hidden".to_owned(),
                "--qr-text".to_owned(),
                text,
            ]));
        }
    }
}

/// The vCard of `given` with the details left out invented, as cards invent theirs.
fn business_card(given: &CardProfile) -> Result<String, Stop> {
    Ok(card_identity(&mut SystemRandom, given, None)?.qr_contact())
}

/// The person's own contact, typed on one line; none for back.
fn ask_own_card() -> Result<Option<String>, Stop> {
    ask_public(
        ("Name; company; phone; email", "Business card"),
        "A QR scanner shows these as a contact card. Separate them with semicolons, such as: Anna Berg; Linden Studio; +49 30 1234567; anna@linden.studio. Leave any out and MnemoCode invents it.",
        |typed| {
            let parts: Vec<&str> = typed.split(';').map(str::trim).collect();
            if parts.len() > 4 {
                return Err("Give at most four details, separated by semicolons.".to_owned());
            }
            let mut profile = CardProfile::default();
            let fields = [
                ProfileField::Name,
                ProfileField::Company,
                ProfileField::Phone,
                ProfileField::Email,
            ];
            for (field, part) in fields.into_iter().zip(parts) {
                if !part.is_empty() {
                    profile.set(field, part.to_owned());
                }
            }
            let profile = profile.validated().map_err(|error| error.to_string())?;
            business_card(&profile).map_err(|stop| stop.message())
        },
    )
}

/// `typed` where it is a web address.
fn web_link(typed: &str) -> Result<String, String> {
    let web = ["https://", "http://"]
        .iter()
        .any(|start| typed.len() > start.len() && typed.to_ascii_lowercase().starts_with(start));
    if web && !typed.contains(char::is_whitespace) {
        Ok(typed.to_owned())
    } else {
        Err("Type an address that starts with https://, without spaces.".to_owned())
    }
}

/// A public text typed after `note`, as `check` takes it; none for back.
fn ask_public(
    (question, label): (&str, &str),
    note: &str,
    check: impl Fn(&str) -> Result<String, String>,
) -> Result<Option<String>, Stop> {
    let answer = ask_line(
        question,
        label,
        LineQuestion {
            note: Some(note),
            what: Some("the text a QR scanner shows"),
            limit: PUBLIC_TEXT_LIMIT,
            ..LineQuestion::default()
        },
        |typed: &str| {
            if typed.trim().is_empty() {
                Err("Type the text a QR scanner shows.".to_owned())
            } else {
                check(typed.trim())
            }
        },
    )?;
    match answer {
        Chosen::One(text) => Ok(Some(text)),
        Chosen::Back => Ok(None),
        Chosen::Cancelled => Err(Stop::Cancelled),
    }
}

/// Extract an exact record to a private file without interpreting its chosen representation.
pub(crate) fn open(parsed: &Parsed) -> Result<(), Stop> {
    let path =
        value(parsed, "qr-file").ok_or_else(|| ArgsError::Required("--qr-file PATH".to_owned()))?;
    if value(parsed, "output").is_none() {
        return Err(ArgsError::Required("--output PATH".to_owned()).into());
    }
    let file = crate::input::read_qr_bytes(&resolved(path), false)?;
    let record = qr::hidden::read_png(&file)?;
    save_output(
        &mut parsed.clone(),
        "output",
        ResultName::one("The recovered record"),
        |path| os::publish_new_file(&resolved(path), record.as_bytes()),
    )?;
    Ok(())
}

/// Reject public-text options that would otherwise be silently ignored.
pub(crate) fn validate(parsed: &Parsed) -> Result<(), Stop> {
    if value(parsed, "qr-text").is_some() && !is_on(parsed, "qr-hidden") {
        return Err(ArgsError::Required("--qr-hidden with --qr-text".to_owned()).into());
    }
    if is_on(parsed, "qr-hidden")
        && !["qr", "qr-dir", "pdf", "images-dir", "cards-dir"]
            .iter()
            .any(|key| value(parsed, key).is_some())
    {
        return Err(ArgsError::Required("a QR output destination".to_owned()).into());
    }
    Ok(())
}

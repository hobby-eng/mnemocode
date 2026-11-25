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
use mnemocode_cards::settings::CardProfile;

use crate::os::SystemRandom;

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

/// The most bytes of a record that qr-hide reads.
const MOST_RECORD_BYTES: usize = 4096;

/// The checks of qr-hide's options before its image is reserved. The record is secret and read
/// only later; its size, which its file tells, says already where it cannot fit beside the text.
pub(crate) fn check(parsed: &Parsed) -> Result<(), Stop> {
    let input = required(parsed)?;
    let Ok(os::FileLook::File { bytes, .. }) = os::look_at_file(&resolved(input)) else {
        return Ok(());
    };
    let bytes = usize::try_from(bytes).unwrap_or(usize::MAX);
    let shown = value(parsed, "qr-text").unwrap_or(DEFAULT_VISIBLE);
    if bytes == 0 {
        return Err(QrError::Empty.into());
    }
    if bytes <= MOST_RECORD_BYTES && !qr::hidden::fits(shown.len(), bytes) {
        return Err(QrError::TooLarge.into());
    }
    Ok(())
}

/// The file of the record, where the image is named too: qr-hide needs both.
fn required(parsed: &Parsed) -> Result<&str, Stop> {
    let input = value(parsed, "input-file")
        .ok_or_else(|| ArgsError::Required("--input-file PATH".to_owned()))?;
    if value(parsed, "qr").is_none() {
        return Err(ArgsError::Required("--qr PATH".to_owned()).into());
    }
    Ok(input)
}

/// Wrap an already protected record or a SeedStitch legend in a separate QR image.
pub(crate) fn run(parsed: &Parsed) -> Result<(), Stop> {
    let input = required(parsed)?;
    let record = read_input_text(input, "The hidden record", MOST_RECORD_BYTES)?;
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

/// The options of a QR code image that hides the backup behind a business card that MnemoCode
/// invents, as cards invent their details: all that ordinary scanners show of it.
pub(crate) fn invented_card_options() -> Result<Vec<String>, Stop> {
    let card = card_identity(&mut SystemRandom, &CardProfile::default(), None)?.qr_contact();
    Ok(vec!["--qr-hidden".to_owned(), "--qr-text".to_owned(), card])
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

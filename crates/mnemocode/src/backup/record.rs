//! The MNC1 record (MnemoCode TS 0.1.0's `record.ts`, CAP-PHRASE-FORMATS-RECORD):
//! `MNC1:<mode>:<form>:<codes>`, which names the mode and the form of the codes it holds. Writing
//! takes a mode and a form value, so an unsupported one cannot be written.

use std::fmt;

use crate::forms::Form;
use crate::modes::Mode;
use crate::refusal::Refusal;
use crate::text::space::{trim, without_byte_order_mark};

/// The version of the record that this program writes, and the only one it reads.
pub const RECORD_VERSION: u32 = 1;

/// The refusals of records, word for word as TS 0.1.0 writes them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordError {
    /// A form that names none.
    Format,
    /// Codes that are only white space.
    EmptyPayload,
    /// A header that does not read.
    MalformedHeader,
    /// Another version: a newer one, as the header admits only versions from 1 up.
    Version,
}

impl fmt::Display for RecordError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Format => "Unsupported MnemoCode record format.",
            Self::EmptyPayload => "A MnemoCode record payload must not be empty.",
            Self::MalformedHeader => "Malformed MnemoCode record header.",
            // The version's digits stay out: they are typed text (CORE-24).
            Self::Version => "Unsupported MnemoCode record version. A newer MnemoCode reads it.",
        })
    }
}

impl std::error::Error for RecordError {}

impl Refusal for RecordError {
    fn code(&self) -> &'static str {
        match self {
            Self::Format => "record.unsupported-format",
            Self::EmptyPayload => "record.empty-payload",
            Self::MalformedHeader => "record.malformed-header",
            Self::Version => "record.unsupported-version",
        }
    }
}

/// A record as it is read: its mode, its form and its codes.
#[derive(Debug, PartialEq, Eq)]
pub struct Record<'a> {
    /// The mode the codes were written in.
    pub mode: Mode,
    /// The form the codes are written in.
    pub form: Form,
    /// The codes, as written.
    pub payload: &'a str,
}

/// The record of the codes `payload`, trimmed, in `form` and `mode`; refused for codes that are
/// only white space.
pub fn serialize_record(mode: Mode, form: Form, payload: &str) -> Result<String, RecordError> {
    let codes = trim(payload);
    if codes.is_empty() {
        return Err(RecordError::EmptyPayload);
    }
    Ok(format!(
        "MNC{RECORD_VERSION}:{}:{}:{codes}",
        mode.id(),
        form.name()
    ))
}

/// The record that `value` holds, without a byte order mark at its start and white space at its
/// ends; none for text that does not begin with MNC. Refused: a header that does not read
/// (`MNC<version>:<mode>:<form>:<codes>` with a mode that names one), another version, and a form
/// that names none, in this order.
pub fn parse_record(value: &str) -> Result<Option<Record<'_>>, RecordError> {
    let normalized = trim(without_byte_order_mark(value));
    let Some(rest) = normalized.strip_prefix("MNC") else {
        return Ok(None);
    };
    let mut parts = rest.splitn(4, ':');
    let (Some(version), Some(mode), Some(form), Some(payload)) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(RecordError::MalformedHeader);
    };
    let name = |text: &str| {
        !text.is_empty()
            && text
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte == b'-')
    };
    let number = !version.starts_with('0')
        && !version.is_empty()
        && version.bytes().all(|byte| byte.is_ascii_digit());
    if !number || !name(mode) || !name(form) || payload.is_empty() {
        return Err(RecordError::MalformedHeader);
    }
    let mode = Mode::named(mode).map_err(|_| RecordError::MalformedHeader)?;
    if version.parse::<u32>().ok() != Some(RECORD_VERSION) {
        return Err(RecordError::Version);
    }
    let form = Form::named(form).map_err(|_| RecordError::Format)?;
    Ok(Some(Record {
        mode,
        form,
        payload,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_record_names_its_mode_and_form() {
        let record = serialize_record(Mode::Seedshift, Form::Unicode, " 7684 ").unwrap();
        assert_eq!(record, "MNC1:seedshift:unicode:7684");
        let text = format!("\u{feff}{record}\n");
        let parsed = parse_record(&text).unwrap().unwrap();
        assert_eq!(
            parsed,
            Record {
                mode: Mode::Seedshift,
                form: Form::Unicode,
                payload: "7684"
            }
        );
        assert_eq!(
            serialize_record(Mode::Direct, Form::Indexes, " \n"),
            Err(RecordError::EmptyPayload)
        );
    }

    #[test]
    fn a_header_is_refused_in_order() {
        assert_eq!(parse_record("abandon"), Ok(None));
        assert_eq!(parse_record(" \u{feff}MNC1:direct:indexes:1"), Ok(None));
        assert_eq!(
            parse_record("MNC1:x:indexes:1"),
            Err(RecordError::MalformedHeader)
        );
        assert_eq!(
            parse_record("MNC01:direct:indexes:1"),
            Err(RecordError::MalformedHeader)
        );
        assert_eq!(
            parse_record("MNC1:direct:indexes:"),
            Err(RecordError::MalformedHeader)
        );
        assert_eq!(parse_record("MNC2:direct:x:1"), Err(RecordError::Version));
        assert_eq!(
            parse_record("MNC99999999999:direct:indexes:1"),
            Err(RecordError::Version)
        );
        assert_eq!(parse_record("MNC1:direct:x:1"), Err(RecordError::Format));
        assert_eq!(
            parse_record("MNC1:direct:indexes:1:2")
                .unwrap()
                .unwrap()
                .payload,
            "1:2"
        );
    }
}

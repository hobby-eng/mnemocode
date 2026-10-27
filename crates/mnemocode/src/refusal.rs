//! The one shape of every refusal of the library: an error with the stable code that MnemoCode TS
//! 0.1.0 gives the same condition, so that the terminal and a page tell refusals apart alike and a
//! page can word them itself (CAP-PHRASE-FORMATS-REFUSAL-CODES, ADR 0004).

/// The kind of JavaScript error TS throws for a condition, which a page may tell apart and which
/// the binding keeps: a plain `Error`, a `RangeError` for a number or length outside what is
/// allowed, a `TypeError` for a value of the wrong kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RefusalKind {
    /// `Error`.
    Error,
    /// `RangeError`.
    Range,
    /// `TypeError`.
    Type,
}

impl RefusalKind {
    /// The name of the JavaScript constructor: "Error", "RangeError" or "TypeError".
    pub const fn name(self) -> &'static str {
        match self {
            Self::Error => "Error",
            Self::Range => "RangeError",
            Self::Type => "TypeError",
        }
    }
}

/// A refusal: its `Display` is the one message of the condition, word for word as TS 0.1.0 writes
/// it, and [`Refusal::code`] its stable code, such as `core.pieces.length-no-whole-number-pieces`.
///
/// Each module has its own error enum, one variant per condition (RUST-04). A variant holds
/// positions, counts and option names, never text a person typed (CORE-24), so a message never
/// repeats a secret.
pub trait Refusal: std::error::Error {
    /// The stable code of the condition: the module's namespace, a dot, and the condition's name.
    fn code(&self) -> &'static str;

    /// The kind of error TS throws for the condition: [`RefusalKind::Error`] unless TS's catalog
    /// gives the condition a range or a type kind.
    fn kind(&self) -> RefusalKind {
        RefusalKind::Error
    }
}

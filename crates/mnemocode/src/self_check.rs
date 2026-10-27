//! Self-checks (CORE-27, CORE-30, CORE-31): every part of the library compared with its known
//! answers, so that a broken build, a faulty processor or memory, or a damaged table shows before
//! a secret is asked. Each part brings its rows through its registry entry or its module, built
//! only with its feature; `checks` orders them. This module holds the shapes and the shared public
//! vectors, runs nothing on its own and reads no clock.

pub mod vectors;

use std::fmt;

use crate::refusal::Refusal;

/// How much a self-check runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    /// The quick known answers of every start: milliseconds, before any secret is asked.
    Startup,
    /// Every startup case and the slower ones, for the self-test a person runs on request.
    Full,
}

/// Why a check failed, with the code and message TS gives it (core.self-test-check), or the
/// refusal of the rule the check called.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CheckFailure {
    /// A known answer came out different; names what was compared.
    Mismatch(&'static str),
    /// A case that must be refused was accepted; names the case.
    WasAccepted(&'static str),
    /// A case was refused for another reason than it must be; names the case.
    RefusedForAnotherReason(&'static str),
    /// The rule refused a case it must accept, with that refusal's code and message.
    Refused {
        /// The refusal's code.
        code: &'static str,
        /// The refusal's message.
        message: String,
    },
}

impl CheckFailure {
    /// The failure of a check whose rule refused, carried as the rule's own code and message.
    pub fn refused(refusal: &impl Refusal) -> Self {
        Self::Refused {
            code: refusal.code(),
            message: refusal.to_string(),
        }
    }
}

impl fmt::Display for CheckFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Mismatch(name) => write!(f, "{name} mismatch."),
            Self::WasAccepted(name) => write!(f, "{name} was accepted."),
            Self::RefusedForAnotherReason(name) => {
                write!(f, "{name} was refused for another reason.")
            }
            Self::Refused { message, .. } => f.write_str(message),
        }
    }
}

impl std::error::Error for CheckFailure {}

impl Refusal for CheckFailure {
    fn code(&self) -> &'static str {
        match self {
            Self::Mismatch(_) => "core.self-test-check.mismatch",
            Self::WasAccepted(_) => "core.self-test-check.was-accepted",
            Self::RefusedForAnotherReason(_) => "core.self-test-check.was-refused-another-reason",
            Self::Refused { code, .. } => code,
        }
    }
}

/// One row of the self-test: its name and what it covers, as the report shows them, and its cases.
pub trait Check {
    /// The row's name in the report, such as "Word lists".
    fn name(&self) -> &'static str;

    /// What the row covers, short enough for one line of the report beside its name.
    fn detail(&self) -> &'static str;

    /// Runs the cases of `tier`; the first difference fails the row.
    fn run(&self, tier: Tier) -> Result<(), CheckFailure>;
}

/// Fails, naming what was compared, unless `actual` is exactly `expected`.
pub fn expect_same<T: PartialEq + ?Sized>(
    actual: &T,
    expected: &T,
    name: &'static str,
) -> Result<(), CheckFailure> {
    if actual == expected {
        Ok(())
    } else {
        Err(CheckFailure::Mismatch(name))
    }
}

/// `result`'s value, or its refusal as the failure of the check that called the rule.
pub fn ok<T, E: Refusal>(result: Result<T, E>) -> Result<T, CheckFailure> {
    result.map_err(|refusal| CheckFailure::refused(&refusal))
}

/// Fails, naming the case, unless `result` is a refusal with `code`: a case the rule must refuse,
/// for the reason it must refuse it.
pub fn expect_refused<T, E: Refusal>(
    result: Result<T, E>,
    code: &str,
    name: &'static str,
) -> Result<(), CheckFailure> {
    match result {
        Ok(_) => Err(CheckFailure::WasAccepted(name)),
        Err(refusal) if refusal.code() == code => Ok(()),
        Err(_) => Err(CheckFailure::RefusedForAnotherReason(name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_known_answer_that_differs_fails_with_its_name() {
        assert_eq!(expect_same("a", "a", "Word lists"), Ok(()));
        let failure = expect_same(&1, &2, "Word lists").unwrap_err();
        assert_eq!(failure.to_string(), "Word lists mismatch.");
        assert_eq!(failure.code(), "core.self-test-check.mismatch");
    }

    #[test]
    fn a_refusal_must_come_for_its_own_reason() {
        let mismatch = || Err::<(), _>(CheckFailure::Mismatch("Word lists"));
        assert_eq!(
            expect_refused(mismatch(), "core.self-test-check.mismatch", "Case"),
            Ok(())
        );
        let accepted: Result<(), CheckFailure> = Ok(());
        let failure =
            expect_refused(accepted, "core.self-test-check.mismatch", "Case").unwrap_err();
        assert_eq!(failure.to_string(), "Case was accepted.");
        let other = expect_refused(mismatch(), "other", "Width").unwrap_err();
        assert_eq!(other.to_string(), "Width was refused for another reason.");
        assert_eq!(
            other.code(),
            "core.self-test-check.was-refused-another-reason"
        );
    }

    #[test]
    fn a_rule_refusal_keeps_its_code_and_message() {
        let failure = CheckFailure::refused(&CheckFailure::WasAccepted("Case 2"));
        assert_eq!(failure.code(), "core.self-test-check.was-accepted");
        assert_eq!(failure.to_string(), "Case 2 was accepted.");
    }
}

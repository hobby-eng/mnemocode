//! Protected menu configuration: dates stay in memory while output paths are settled.

use mnemocode::dates::Date;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretVec;

use super::encode_questions::EncodingAnswers;
use crate::args::{self, Parsed, is_on};
use crate::gate::Stop;
use crate::os::Protection;

/// Configuration is explicit so existing --ask-secrets scripts keep their question order.
pub(crate) const OPTIONS: [&str; 1] = ["configure"];

/// Whether this command asks its output paths on the protected screen.
pub(crate) fn asks_options(parsed: &Parsed) -> bool {
    is_on(parsed, "configure")
}

#[derive(Debug)]
struct ConfigureOptions;

impl std::fmt::Display for ConfigureOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Use --configure with --ask-secrets and optionally --format or --sskr; answer the remaining settings on the private screen.")
    }
}

impl std::error::Error for ConfigureOptions {}

impl Refusal for ConfigureOptions {
    fn code(&self) -> &'static str {
        "cli.configure.options"
    }
}

/// Refuses conflicting options before preflight can create any output directories.
pub(crate) fn check_options(parsed: &Parsed) -> Result<(), Stop> {
    if asks_options(parsed)
        && ((is_on(parsed, "sskr") && parsed.contains_key("format"))
            || !is_on(parsed, "ask-secrets")
            || parsed.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "configure" | "ask-secrets" | "format" | "sskr"
                )
            }))
    {
        return Err(ConfigureOptions.into());
    }
    Ok(())
}

/// Reads settings behind the secret gate, then limits writes to the selected destinations.
/// A normal command line keeps its settings and has no retained dates; dates never enter arguments.
pub(crate) fn asked_options(
    parsed: &Parsed,
    protection: &mut Protection,
    ask: impl FnOnce() -> Result<Option<EncodingAnswers>, Stop>,
) -> Result<(Parsed, Option<SecretVec<Date>>), Stop> {
    if !asks_options(parsed) {
        return Ok((parsed.clone(), None));
    }
    super::output_questions::forget_claimed();
    // The menu's task asked here: Shift+Tab goes back a step, Escape ends it for the main menu.
    crate::terminal::set_steps_back(true);
    let asked = ask();
    crate::terminal::set_steps_back(false);
    let (arguments, dates) = asked?.ok_or(Stop::Cancelled)?;
    let mut fresh = args::parse_arguments(&arguments[1..])?;
    let needs = crate::output::preflight(&mut fresh)?;
    protection.rule_writes(&needs.folders);
    crate::terminal::show_protection(&protection.report());
    crate::output::warn_of_cloud_copies(&fresh);
    Ok((fresh, Some(dates)))
}

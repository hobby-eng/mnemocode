//! Protected menu configuration: dates stay in memory while output paths are settled.

use mnemocode::dates::Date;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretVec;

use super::encode_questions::EncodingAnswers;
use super::new_backup::Finish;
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

/// Runs the command with `run`: a normal command line with its own settings and no retained
/// dates; with --configure, the settings asked behind the secret gate by `ask`, writes limited to
/// the folders they name before the seed phrase is asked. Shift+Tab at the seed phrase comes back
/// to the last answer; the folders stay closed then, so a folder chosen again must be the same.
/// Dates never enter arguments.
pub(crate) fn run_configured(
    parsed: &Parsed,
    protection: &mut Protection,
    ask: impl FnOnce(&mut Finish<'_>) -> Result<bool, Stop>,
    mut run: impl FnMut(&Parsed, Option<SecretVec<Date>>) -> Result<(), Stop>,
) -> Result<(), Stop> {
    if !asks_options(parsed) {
        return run(parsed, None);
    }
    super::output_questions::forget_claimed();
    let mut ruled = false;
    let mut finish = |(arguments, dates): EncodingAnswers| -> Result<bool, Stop> {
        let mut fresh = args::parse_arguments(&arguments[1..])?;
        let needs = crate::output::preflight(&mut fresh)?;
        // Writes are closed once; a second time they could only be closed further.
        if !ruled {
            // With nothing to save, the start folder stays open: the folder question offers it
            // first, so a file ticked after going back from the seed phrase can still be saved.
            let folders = if needs.folders.is_empty() {
                vec![crate::output::resolved(".")]
            } else {
                needs.folders.clone()
            };
            protection.rule_writes(&folders);
            crate::terminal::show_protection(&protection.report());
            ruled = true;
        }
        crate::output::warn_of_cloud_copies(&fresh);
        match run(&fresh, Some(dates)) {
            Err(Stop::Cancelled) if crate::terminal::take_step_back() => {
                // The seed phrase is asked again with steps to go back to.
                crate::terminal::set_steps_back(true);
                Ok(false)
            }
            ended => ended.map(|()| true),
        }
    };
    // The menu's task asked here: Shift+Tab goes back a step, Escape ends it for the main menu;
    // a question asked again shows the answer chosen before.
    crate::terminal::set_steps_back(true);
    crate::terminal::remember_choices(true);
    let done = ask(&mut finish);
    crate::terminal::set_steps_back(false);
    if done? { Ok(()) } else { Err(Stop::Cancelled) }
}

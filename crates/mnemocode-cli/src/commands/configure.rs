//! Protected menu configuration: the output paths settled and every other folder closed to writing,
//! then the dates asked, which stay in memory.

use mnemocode::dates::Date;
use mnemocode::refusal::Refusal;
use mnemocode::secret::SecretVec;

use super::new_backup::{Ending, Finish};
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
/// the folders they name before the dates and the seed phrase are asked. Shift+Tab at the seed
/// phrase comes back to the dates, and on to the settings; the folders stay closed then, so a
/// folder chosen again must be the same. Dates never enter arguments.
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
    let mut settled = None;
    let mut finish = |ending: Ending| -> Result<bool, Stop> {
        match ending {
            Ending::Named(arguments) => {
                let mut fresh = args::parse_arguments(&arguments[1..])?;
                // The files go into a new folder of the task, the only one that stays open to
                // writing.
                let needs = crate::output::preflight_answered(&mut fresh)?;
                // Writes are closed once, before the dates; a second time they could only be
                // closed further. With nothing to save, every folder is closed: a file ticked after
                // going back needs the task started again.
                if !ruled {
                    protection.rule_writes(&needs.folders);
                    crate::terminal::show_protection(&protection.report());
                    ruled = true;
                }
                crate::output::warn_of_cloud_copies(&fresh);
                settled = Some(fresh);
                Ok(true)
            }
            Ending::Dated(dates) => {
                let Some(fresh) = &settled else {
                    return Ok(false);
                };
                match run(fresh, Some(dates)) {
                    Err(Stop::Cancelled) if crate::terminal::take_step_back() => {
                        // The seed phrase is asked again with steps to go back to.
                        crate::terminal::set_steps_back(true);
                        Ok(false)
                    }
                    ended => ended.map(|()| true),
                }
            }
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

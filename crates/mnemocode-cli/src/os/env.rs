//! The arguments and the few environment variables the command line reads, once, at start: the
//! colour rule's (NO_COLOR, CLICOLOR_FORCE, CLICOLOR, TERM), the home folder for `~` and the cloud
//! folders, and the folders in which Windows names OneDrive. Nothing secret is ever read from the
//! environment (`N-NO-ARGV-ENV`).

#![expect(
    clippy::disallowed_methods,
    reason = "the environment and the arguments are read here, in the os module, and nowhere else"
)]

use std::ffi::OsString;
use std::path::PathBuf;

/// The program's arguments after its own name, as the system gave them.
pub(crate) fn arguments() -> Vec<OsString> {
    std::env::args_os().skip(1).collect()
}

/// The environment variables the command line reads, read once.
#[derive(Clone, Debug, Default)]
pub(crate) struct Environment {
    /// NO_COLOR, where set and not empty: no colour.
    pub(crate) no_color: bool,
    /// CLICOLOR_FORCE, where set, not empty and not "0": colour even without a terminal.
    pub(crate) force_color: bool,
    /// CLICOLOR=0: no colour on a terminal.
    pub(crate) clicolor_off: bool,
    /// TERM=dumb: a terminal that cannot move its cursor or clear its screen.
    pub(crate) dumb_terminal: bool,
    /// The home folder, for `~` in a typed path and for macOS's cloud storage.
    pub(crate) home: Option<PathBuf>,
    /// The folders that Windows names OneDrive in (OneDrive, OneDriveConsumer,
    /// OneDriveCommercial).
    pub(crate) onedrive: Vec<PathBuf>,
    /// The current folder, against which relative paths are resolved.
    pub(crate) current: Option<PathBuf>,
    /// Whether the menu started this command, which Escape returns to.
    pub(crate) for_menu: bool,
}

/// The variable that the menu sets for each command it starts.
pub(crate) const FOR_MENU: &str = "MNEMOCODE_MENU";

/// The settings of the colour rule. The tests remove them from every program they start: their
/// helper `tests/common/colour.rs` keeps a deliberate copy, which a test below keeps in step.
const COLOUR_SETTINGS: [&str; 3] = ["NO_COLOR", "CLICOLOR", "CLICOLOR_FORCE"];

impl Environment {
    /// Reads the variables.
    pub(crate) fn read() -> Self {
        let set = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        let [no_color, clicolor, clicolor_force] = COLOUR_SETTINGS;
        Self {
            no_color: set(no_color).is_some(),
            force_color: set(clicolor_force).is_some_and(|value| value != "0"),
            clicolor_off: std::env::var_os(clicolor).is_some_and(|value| value == "0"),
            dumb_terminal: std::env::var_os("TERM").is_some_and(|value| value == "dumb"),
            home: home_folder(),
            onedrive: ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
                .into_iter()
                .filter_map(set)
                .map(PathBuf::from)
                .collect(),
            current: std::env::current_dir().ok(),
            for_menu: set(FOR_MENU).is_some(),
        }
    }
}

/// The home folder on Windows: the profile folder that USERPROFILE names, as Node.js takes it.
/// std's home_dir would import userenv.dll, which is no KnownDLL, so that a file of that name
/// beside the executable would load (W-DLL-SEARCH).
#[cfg(windows)]
fn home_folder() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// The home folder: HOME, or the account's own entry.
#[cfg(not(windows))]
fn home_folder() -> Option<PathBuf> {
    std::env::home_dir()
}

#[cfg(test)]
mod tests {
    use super::COLOUR_SETTINGS;

    /// AUD-006 follow-up: the tests' copy of the colour settings is this list, written the same
    /// way, so that a setting added here reaches every program a test starts (CORE-10).
    #[test]
    fn the_tests_remove_exactly_the_colour_settings() {
        let helper = include_str!("../../tests/common/colour.rs");
        let list = format!("= {COLOUR_SETTINGS:?};");
        assert!(
            helper.contains(&list),
            "tests/common/colour.rs lacks {list}"
        );
    }
}

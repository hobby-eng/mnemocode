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
}

impl Environment {
    /// Reads the variables.
    pub(crate) fn read() -> Self {
        let set = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
        Self {
            no_color: set("NO_COLOR").is_some(),
            force_color: set("CLICOLOR_FORCE").is_some_and(|value| value != "0"),
            clicolor_off: std::env::var_os("CLICOLOR").is_some_and(|value| value == "0"),
            dumb_terminal: std::env::var_os("TERM").is_some_and(|value| value == "dumb"),
            home: home_folder(),
            onedrive: ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
                .into_iter()
                .filter_map(set)
                .map(PathBuf::from)
                .collect(),
            current: std::env::current_dir().ok(),
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

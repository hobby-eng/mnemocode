//! The protections of one process that handles secrets, applied in the order of
//! docs/design/platform/protections.md, decision 2, and each read back before it is named:
//!
//! - [`Protection::start`], the first lines of `main`: no core dumps (and on Linux not dumpable),
//!   the memory cap, on macOS no debugger, on Windows no DLLs from the program's folder and no
//!   heap in crash reports;
//! - [`Protection::restrict`], once the options and the outputs' folders are known and before any
//!   secret: on Linux no_new_privs, seccomp and Landlock, on macOS Seatbelt;
//! - [`Protection::refusal`]: a secret is refused only while core dumps are not off or, on Linux, a
//!   tracer is attached (decision 1); everything else the system refuses is reported, never assumed.

use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};

/// What a command needs beyond reading: the folders it saves into, each the parent folder of an
/// output, made before the secret (files::make_folders). Empty for a command that saves nothing.
#[derive(Debug, Default)]
pub(crate) struct Needs {
    /// The folders beneath which the command writes, resolved.
    pub(crate) folders: Vec<PathBuf>,
    /// Whether the answers on its private screen name the folders: writes stay open until then.
    pub(crate) answers_name_folders: bool,
}

/// What the system did with core dumps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum CoreDumps {
    /// Switched off and read back so.
    Off,
    /// Not switched off, for the reason given.
    Failed(String),
    /// Left as the system has them: Windows writes none unless an administrator set one up.
    #[cfg_attr(
        not(windows),
        allow(dead_code, reason = "Windows's own, and the tests'")
    )]
    Untouched,
}

/// What a probe of one protection found.
#[cfg(unix)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Found {
    /// The probe was refused as the protection refuses it.
    Holds,
    /// The probe got through.
    Broken,
    /// The probe could not tell.
    Unknown,
}

/// The folders beneath which the system lets this process write, where it rules writes.
static RULED: Mutex<Option<Vec<PathBuf>>> = Mutex::new(None);

/// The folders that the rules on writes leave open; none where the system rules no writes.
pub(crate) fn ruled_folders() -> Option<Vec<PathBuf>> {
    RULED.lock().unwrap_or_else(PoisonError::into_inner).clone()
}

/// What the report says where a command's answers name the folders it saves into.
pub(super) const WRITES_OPEN: &str = "file writes: open, as the answers name the outputs";

/// What protects this process, as read back: what holds, what the system did not give and why,
/// and the core dumps.
#[derive(Debug)]
pub(crate) struct Protection {
    held: Vec<String>,
    reasons: Vec<String>,
    core_dumps: CoreDumps,
    /// On Linux, the process that traces this one, where one does.
    tracer: Option<u32>,
}

impl Protection {
    /// Applies what does not depend on the command, core dumps first: called by `main` before it
    /// reads its options or starts any thread.
    pub(crate) fn start() -> Self {
        let mut protection = Self {
            held: Vec::new(),
            reasons: Vec::new(),
            core_dumps: CoreDumps::Failed("not switched off yet".to_owned()),
            tracer: None,
        };
        protection.core_dumps = platform::start(&mut protection);
        protection
    }

    /// Applies for good what the command does not need, once `needs` is known and before any
    /// secret: none of it can be taken back.
    pub(crate) fn restrict(&mut self, needs: &Needs) {
        platform::restrict(self, needs);
        self.read_back();
    }

    /// Rules writes where a command's answers named its folders, which `restrict` left open.
    pub(crate) fn rule_writes(&mut self, folders: &[PathBuf]) {
        self.reasons.retain(|reason| reason != WRITES_OPEN);
        platform::rule_writes(self, folders);
        self.read_back();
    }

    /// Records that the system now lets this process write beneath `folders` alone.
    #[cfg(target_os = "linux")]
    pub(super) fn writes_ruled(folders: &[PathBuf]) {
        *RULED.lock().unwrap_or_else(PoisonError::into_inner) = Some(folders.to_vec());
    }

    /// Reads back what can change after start: on Linux, whether the process is still not
    /// dumpable and whether a tracer is attached.
    pub(crate) fn read_back(&mut self) {
        let (core_dumps, tracer) = platform::read_back(&self.core_dumps);
        self.core_dumps = core_dumps;
        self.tracer = tracer;
    }

    /// Why no secret may be asked: core dumps that are not off where the system can switch them
    /// off, or a tracer attached; `None` when a secret may be asked.
    pub(crate) fn refusal(&self) -> Option<String> {
        if let CoreDumps::Failed(reason) = &self.core_dumps {
            return Some(format!(
                "MnemoCode could not switch off core dumps ({reason}); it asks for no secret without that."
            ));
        }
        self.tracer.map(|pid| {
            format!(
                "Another program (process {pid}) traces MnemoCode and could read its memory; it asks for no secret so."
            )
        })
    }

    /// What protects this process now, for the private screen: "no core dumps · kernel: no
    /// sockets, no file writes" and the like.
    pub(crate) fn summary(&self) -> String {
        let mut parts = Vec::new();
        if self.core_dumps == CoreDumps::Off {
            parts.push("no core dumps".to_owned());
        }
        parts.extend(self.held.iter().cloned());
        parts.join(" · ")
    }

    /// What the system enforces for this run and what it could not.
    pub(crate) fn report(&self) -> String {
        let held = self.summary();
        let mut text = if held.is_empty() {
            "nothing".to_owned()
        } else {
            held
        };
        if !self.reasons.is_empty() {
            text.push_str("; not available: ");
            text.push_str(&self.reasons.join("; "));
        }
        text
    }

    /// Records `protection` as holding.
    pub(super) fn hold(&mut self, protection: impl Into<String>) {
        self.held.push(protection.into());
    }

    /// Records why a protection is not enforced.
    pub(super) fn lack(&mut self, reason: impl Into<String>) {
        self.reasons.push(reason.into());
    }

    /// Runs `step`; the reason it gives for failing is recorded under `what`.
    pub(super) fn attempt(
        &mut self,
        what: &str,
        step: impl FnOnce(&mut Self) -> Result<(), String>,
    ) {
        if let Err(reason) = step(self) {
            self.lack(format!("{what}: {reason}"));
        }
    }

    /// Records `protection` as holding when its probe `found` so; otherwise why not.
    #[cfg(unix)]
    pub(super) fn claim(&mut self, protection: &str, found: Found, broken: &str) {
        match found {
            Found::Holds => self.hold(protection),
            Found::Broken => self.lack(format!("{protection} did not hold: {broken}")),
            Found::Unknown => self.lack(format!("{protection} could not be checked")),
        }
    }

    /// The held protections recorded since `from`, joined after `label`, replacing them: the
    /// kernel's own as "kernel: no sockets, no file writes".
    #[cfg(unix)]
    pub(super) fn group_since(&mut self, from: usize, label: &str) {
        if self.held.len() > from {
            let group = self.held.split_off(from).join(", ");
            let start = format!("{label}: ");
            match self.held.iter_mut().find(|held| held.starts_with(&start)) {
                Some(earlier) => {
                    earlier.push_str(", ");
                    earlier.push_str(&group);
                }
                None => self.held.push(format!("{start}{group}")),
            }
        }
    }

    /// How many protections hold so far, for [`Protection::group_since`].
    #[cfg(unix)]
    pub(super) fn held_count(&self) -> usize {
        self.held.len()
    }
}

/// The memory cap of a command's process (decision 5, `L-RLIMIT-DATA`, `W-JOB-MEMORY`): the
/// heaviest operation's measured peak plus a quarter, rounded up to a multiple of 64 MiB. The
/// increments that bring the heaviest operations (the encrypted candidate list, the card export)
/// measure them and run them under it: the largest list the writer makes, encrypted through scrypt
/// and opened again, peaks at 293 MiB resident (increment 6, `os::linux` tests). A card export draws
/// and writes one page at a time: the largest, the cards of 16 shares of a 24-word phrase in Unicode
/// codes on release builds, peak at 147 MiB resident and 145 MiB of data, as A4 page images; their
/// PDFs of up to 337 MB at 73 MiB, and their business-size images and separate files at 55 MiB.
#[cfg(any(target_os = "linux", windows))]
pub(super) const MEMORY_CAP_BYTES: u64 = 768 * 1024 * 1024;

/// The read-back of a system where nothing changes after start: the core dumps as they were
/// switched off, and no tracer read.
#[cfg(not(target_os = "linux"))]
pub(super) fn unchanged(dumps: &CoreDumps) -> (CoreDumps, Option<u32>) {
    (dumps.clone(), None)
}

#[cfg(target_os = "linux")]
use super::linux as platform;
#[cfg(target_os = "macos")]
use super::macos as platform;
#[cfg(windows)]
use super::windows as platform;

#[cfg(test)]
mod tests {
    use super::*;

    fn record() -> Protection {
        Protection {
            held: Vec::new(),
            reasons: Vec::new(),
            core_dumps: CoreDumps::Off,
            tracer: None,
        }
    }

    #[test]
    fn a_secret_is_refused_only_for_core_dumps_or_a_tracer() {
        let mut protection = record();
        protection.lack("seccomp: refused");
        assert_eq!(protection.refusal(), None);
        protection.core_dumps = CoreDumps::Untouched;
        assert_eq!(protection.refusal(), None);
        protection.tracer = Some(42);
        assert!(
            protection
                .refusal()
                .is_some_and(|text| text.contains("process 42"))
        );
        protection.core_dumps = CoreDumps::Failed("setrlimit refused".to_owned());
        assert!(
            protection
                .refusal()
                .is_some_and(|text| text.contains("setrlimit refused"))
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_kernel_protections_are_named_together() {
        let mut protection = record();
        let from = protection.held_count();
        protection.claim("no sockets", Found::Holds, "a socket was made");
        protection.claim(
            "no file writes",
            Found::Broken,
            "/dev/null opened for writing",
        );
        protection.claim("no TCP", Found::Unknown, "");
        protection.group_since(from, "kernel");
        assert_eq!(protection.summary(), "no core dumps · kernel: no sockets");
        assert_eq!(
            protection.report(),
            "no core dumps · kernel: no sockets; not available: no file writes did not hold: \
             /dev/null opened for writing; no TCP could not be checked"
        );
    }
}

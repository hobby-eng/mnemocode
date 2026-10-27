//! The operating system as the command line meets it: the process protections
//! (docs/design/platform/protections.md, ARCHITECTURE.md §5), the standard descriptors and the
//! terminal's modes, the signals, the files, the environment and the system's random source. Every
//! unsafe call and every std item that clippy.toml keeps out of the other modules lives here.

mod console;
mod env;
mod files;
mod protect;
mod random;
mod signals;
mod swap;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(windows)]
mod windows;

pub(crate) use console::{
    RawMode, Stream, input_within, is_terminal, prepare, read_input, terminal_size, write_error,
    write_output,
};
pub(crate) use env::{Environment, arguments};
pub(crate) use files::{
    Entry, FileError, Folder, entry_at, make_folders, new_private_file as write_new_private_file,
    publish_new_file, read_bounded, read_secret_file, remove_left, resolve,
};
pub(crate) use protect::{Needs, Protection};
pub(crate) use signals::{
    Signal, cleanup_done, handle_signals, pending_signal, suspend_now, suspend_requested,
};
pub(crate) use swap::unprotected_swap;

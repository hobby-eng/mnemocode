//! The operating system as the command line meets it: the process protections
//! (docs/design/platform/protections.md, ARCHITECTURE.md §5), the standard descriptors and the
//! terminal's modes, the signals, the files, the environment and the system's random source. Every
//! unsafe call and every std item that clippy.toml keeps out of the other modules lives here.

mod child;
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

pub(crate) use child::{CommandEnd, run_own_process, start_failure};
pub(crate) use console::{
    RawMode, Stream, drop_typed_ahead, input_within, is_terminal, prepare, read_input, restore,
    terminal_size, without_echo, write_error, write_output,
};
pub(crate) use env::{Environment, arguments};
pub(crate) use files::{
    Entry, FileError, FileLook, Folder, entry_at, in_temporary_folder, look_at_file, make_folders,
    may_write, new_private_file as write_new_private_file, private_folder as make_private_folder,
    publish_new_file, publish_written_file, read_bounded, read_public_file, read_secret_file,
    real_path, remove_left, resolve, stop_if_signalled, temporary_folder,
};
pub(crate) use protect::{Needs, Protection, ruled_folders};
pub(crate) use random::SystemRandom;
pub(crate) use signals::{
    Signal, cancel, cleanup_done, forget_cancel, handle_signals, pending_signal, suspend_now,
    suspend_requested,
};
pub(crate) use swap::unprotected_swap;

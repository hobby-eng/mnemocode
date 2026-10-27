//! macOS's protections (protections.md, `M-*`), as MnemoCode TS 0.1.0 sets them
//! (`src/cli/sandbox-macos.ts`): no core dumps, no debugger attaches (ptrace(PT_DENY_ATTACH), at
//! start; a process that a debugger already traces ends at this call, and nothing reads it back),
//! and a Seatbelt profile that refuses the network, read back by a UDP connect to the loopback
//! address, which sends nothing.

#![allow(
    unsafe_code,
    reason = "setrlimit, ptrace and sandbox_init are system calls that Rust offers only through \
              unsafe foreign functions (RUST-07: the CLI's os module only)"
)]

use std::ffi::{CStr, c_char, c_int};
use std::ptr;

use super::protect::{CoreDumps, Found, Needs, Protection};

unsafe extern "C" {
    /// libsystem_sandbox: applies a profile in Seatbelt's language to this process for good.
    fn sandbox_init(profile: *const c_char, flags: u64, error: *mut *mut c_char) -> c_int;
    /// Frees the message of a refusal of sandbox_init.
    fn sandbox_free_error(error: *mut c_char);
}

/// ptrace's request that denies every later attach (sys/ptrace.h).
const PT_DENY_ATTACH: c_int = 31;
/// The profile: everything allowed but the network (`M-SEATBELT-NETWORK`). File writes are not
/// refused: a profile that refused them was not tested against output to the terminal
/// (`M-SEATBELT-WRITES`, optional).
const PROFILE: &CStr = c"(version 1)\n(allow default)\n(deny network*)";

/// Core dumps off (`M-CORE-LIMIT`), read back, then no debugger (`M-DENY-ATTACH`).
pub(super) fn start(protection: &mut Protection) -> CoreDumps {
    let dumps = core_dumps_off();
    // SAFETY: PT_DENY_ATTACH takes no address or data.
    if unsafe { libc::ptrace(PT_DENY_ATTACH, 0, ptr::null_mut(), 0) } == 0 {
        protection.hold("no debugger attach (requested)");
    } else {
        protection.lack("debugger attach: not refused");
    }
    dumps
}

/// Both core dump limits 0, read back.
fn core_dumps_off() -> CoreDumps {
    let none = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    // SAFETY: setrlimit reads the struct, which lives for the call.
    if unsafe { libc::setrlimit(libc::RLIMIT_CORE, &none) } != 0 {
        return CoreDumps::Failed("setrlimit refused RLIMIT_CORE 0".to_owned());
    }
    let mut read = libc::rlimit {
        rlim_cur: u64::MAX,
        rlim_max: u64::MAX,
    };
    // SAFETY: getrlimit writes the struct, which lives for the call.
    if unsafe { libc::getrlimit(libc::RLIMIT_CORE, &mut read) } != 0
        || read.rlim_cur != 0
        || read.rlim_max != 0
    {
        return CoreDumps::Failed("the core dump limit did not read back as 0".to_owned());
    }
    CoreDumps::Off
}

/// Nothing changes after start on macOS: the limit stays, and no tracer is read.
pub(super) use super::protect::unchanged as read_back;

/// The Seatbelt profile, then its probe.
pub(super) fn restrict(protection: &mut Protection, _needs: &Needs) {
    let from = protection.held_count();
    protection.attempt("sandbox", |protection| {
        let mut error: *mut c_char = ptr::null_mut();
        // SAFETY: the profile is a static C string; sandbox_init writes a message pointer into
        // `error` on refusal, which is freed below.
        if unsafe { sandbox_init(PROFILE.as_ptr(), 0, &mut error) } != 0 {
            let reason = if error.is_null() {
                "unknown reason".to_owned()
            } else {
                // SAFETY: a non-null message is a C string of sandbox_init, freed once after this.
                let text = unsafe { CStr::from_ptr(error) }
                    .to_string_lossy()
                    .into_owned();
                // SAFETY: the message came from sandbox_init and is freed once.
                unsafe { sandbox_free_error(error) };
                text
            };
            return Err(format!("refused ({reason})"));
        }
        protection.claim(
            "no network",
            network_refused(),
            "a connection was not refused",
        );
        Ok(())
    });
    protection.group_since(from, "sandbox");
}

/// A UDP socket connected to the discard port of the loopback address, which sends nothing.
fn network_refused() -> Found {
    let refused = |error: i32| error == libc::EPERM || error == libc::EACCES;
    let errno = || std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    // SAFETY: socket takes integers; a descriptor it returns is closed below.
    let socket = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0) };
    if socket < 0 {
        return if refused(errno()) {
            Found::Holds
        } else {
            Found::Unknown
        };
    }
    let address = libc::sockaddr_in {
        sin_len: 16,
        sin_family: u8::try_from(libc::AF_INET).unwrap_or(2),
        sin_port: 9_u16.to_be(),
        sin_addr: libc::in_addr {
            s_addr: u32::from_be_bytes([127, 0, 0, 1]).to_be(),
        },
        sin_zero: [0; 8],
    };
    // SAFETY: the address lives for the call and its length is its own size.
    let connected =
        unsafe { libc::connect(socket, (&raw const address).cast::<libc::sockaddr>(), 16) } == 0;
    let error = errno();
    // SAFETY: the descriptor came from the call above and is closed once.
    unsafe { libc::close(socket) };
    if connected {
        Found::Broken
    } else if refused(error) {
        Found::Holds
    } else {
        Found::Unknown
    }
}

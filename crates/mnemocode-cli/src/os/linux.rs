//! The Linux kernel's protections (protections.md, `L-*`), as mhfe sets them
//! (`mhfe/src/bin/mhfe/protect.rs`, a copy of the same calls in another project: a change goes to
//! both): core dumps off and not dumpable, the memory cap, then no_new_privs, a seccomp filter that
//! refuses sockets and io_uring, and Landlock, which refuses every change to the file system but
//! beneath the outputs' folders. They are applied before the first thread, so the filter's TSYNC
//! and Landlock bind the one thread there is and every thread it starts. Each is read back by a
//! probe that tries what it forbids.

#![allow(
    unsafe_code,
    reason = "setrlimit, prctl, seccomp and the Landlock calls are system calls that Rust offers \
              only through unsafe foreign functions (RUST-07: the CLI's os module only)"
)]
#![expect(
    clippy::disallowed_methods,
    reason = "the tracer is read from /proc/self/status, a file of the os module"
)]

use std::ffi::CString;
use std::mem::size_of;
use std::os::unix::ffi::OsStrExt;
use std::ptr;

use super::protect::{CoreDumps, Found, MEMORY_CAP_BYTES, Needs, Protection};

/// The error number that the filter and Landlock give a refused call.
const REFUSED: i32 = libc::EACCES;

/// Core dumps off (`L-CORE-LIMIT`, `L-DUMPABLE`), then the memory cap (`L-RLIMIT-DATA`).
pub(super) fn start(protection: &mut Protection) -> CoreDumps {
    let dumps = core_dumps_off();
    protection.attempt("memory cap", |protection| {
        set_limit(libc::RLIMIT_DATA, MEMORY_CAP_BYTES)?;
        protection.hold(format!(
            "memory cap {} MiB",
            MEMORY_CAP_BYTES / (1024 * 1024)
        ));
        Ok(())
    });
    dumps
}

/// Both core dump limits 0 and the process not dumpable, each read back.
fn core_dumps_off() -> CoreDumps {
    let result = set_limit(libc::RLIMIT_CORE, 0).and_then(|()| {
        // SAFETY: PR_SET_DUMPABLE takes integers and touches no memory of this process.
        if unsafe { libc::prctl(libc::PR_SET_DUMPABLE, 0, 0, 0, 0) } != 0 {
            return Err("prctl refused".to_owned());
        }
        Ok(())
    });
    match result {
        Ok(()) => read_back(&CoreDumps::Off).0,
        Err(reason) => CoreDumps::Failed(reason),
    }
}

/// Sets both limits of `resource` to `value` and reads them back.
fn set_limit(resource: libc::__rlimit_resource_t, value: u64) -> Result<(), String> {
    let limit = libc::rlimit {
        rlim_cur: value,
        rlim_max: value,
    };
    // SAFETY: setrlimit reads the struct, which lives for the call.
    if unsafe { libc::setrlimit(resource, &limit) } != 0 {
        return Err(format!("setrlimit refused (error {})", errno()));
    }
    let mut read = libc::rlimit {
        rlim_cur: u64::MAX,
        rlim_max: u64::MAX,
    };
    // SAFETY: getrlimit writes the struct, which lives for the call.
    if unsafe { libc::getrlimit(resource, &mut read) } != 0
        || read.rlim_cur != value
        || read.rlim_max != value
    {
        return Err("the limit did not read back".to_owned());
    }
    Ok(())
}

/// The core dumps as the kernel reports them now (the limit stays as set; dumpable is read, as a
/// set-user-ID change would reset it), and the process that traces this one, if any.
pub(super) fn read_back(dumps: &CoreDumps) -> (CoreDumps, Option<u32>) {
    let dumps = match dumps {
        CoreDumps::Off => {
            // SAFETY: PR_GET_DUMPABLE takes integers and touches no memory of this process.
            if unsafe { libc::prctl(libc::PR_GET_DUMPABLE, 0, 0, 0, 0) } == 0 {
                CoreDumps::Off
            } else {
                CoreDumps::Failed("the process is still dumpable".to_owned())
            }
        }
        other => other.clone(),
    };
    (dumps, tracer())
}

/// The process that traces this one (`L-TRACER`): TracerPid of /proc/self/status, where it is
/// not 0. A status that cannot be read names no tracer: dumpable 0 already keeps one out.
fn tracer() -> Option<u32> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    status
        .lines()
        .find_map(|line| line.strip_prefix("TracerPid:"))
        .and_then(|pid| pid.trim().parse::<u32>().ok())
        .filter(|&pid| pid != 0)
}

/// no_new_privs, then seccomp and Landlock for `needs`, each probed, named together as "kernel".
pub(super) fn restrict(protection: &mut Protection, needs: &Needs) {
    let from = protection.held_count();
    // SAFETY: PR_SET_NO_NEW_PRIVS and PR_GET_NO_NEW_PRIVS take integers only.
    let no_new_privs = unsafe {
        libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) == 0
            && libc::prctl(libc::PR_GET_NO_NEW_PRIVS, 0, 0, 0, 0) == 1
    };
    if !no_new_privs {
        protection.lack("no_new_privs: refused, so neither seccomp nor Landlock can be used");
        return;
    }
    protection.attempt("seccomp", |protection| {
        seccomp::forbid_sockets()?;
        protection.claim(
            "no sockets",
            sockets_refused(),
            "a socket or an io_uring was not refused",
        );
        Ok(())
    });
    protection.group_since(from, "kernel");
    if needs.answers_name_folders {
        protection.lack(super::protect::WRITES_OPEN);
    } else {
        rule_writes(protection, &needs.folders);
    }
}

/// Landlock: the process writes beneath `folders` alone, a second restriction after a first.
pub(super) fn rule_writes(protection: &mut Protection, folders: &[std::path::PathBuf]) {
    let from = protection.held_count();
    protection.attempt("Landlock", |protection| {
        landlock::restrict_writes(folders)?;
        Protection::writes_ruled(folders);
        let what = if folders.is_empty() {
            "no file writes"
        } else {
            "file writes only to the chosen folders"
        };
        protection.claim(what, writes_refused(), "/dev/null opened for writing");
        Ok(())
    });
    protection.group_since(from, "kernel");
}

/// errno of the call just made.
fn errno() -> i32 {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

/// Both a socket and an io_uring, which could open a socket without the socket call, refused.
fn sockets_refused() -> Found {
    // SAFETY: socket takes integers; a descriptor it returns is closed at once.
    let socket = unsafe { libc::socket(libc::AF_INET, libc::SOCK_DGRAM | libc::SOCK_CLOEXEC, 0) };
    let socket_refused = socket < 0 && errno() == REFUSED;
    if socket >= 0 {
        // SAFETY: the descriptor came from the call above and is closed once.
        unsafe { libc::close(socket) };
    }
    // struct io_uring_params is 120 bytes; zero asks for the defaults.
    let mut params = [0_u8; 120];
    // SAFETY: io_uring_setup writes at most the 120 bytes of the parameters, which live for the
    // call; a descriptor it returns is closed at once.
    let ring = unsafe { libc::syscall(libc::SYS_io_uring_setup, 1_u32, params.as_mut_ptr()) };
    let ring_refused = ring < 0 && errno() == REFUSED;
    if let Ok(ring) = libc::c_int::try_from(ring)
        && ring >= 0
    {
        // SAFETY: the descriptor came from the call above and is closed once.
        unsafe { libc::close(ring) };
    }
    if socket_refused && ring_refused {
        Found::Holds
    } else {
        Found::Broken
    }
}

/// /dev/null opened for writing, outside every chosen folder: refused.
fn writes_refused() -> Found {
    // SAFETY: the path is a static C string; a descriptor the call returns is closed at once.
    let file = unsafe { libc::open(c"/dev/null".as_ptr(), libc::O_WRONLY | libc::O_CLOEXEC) };
    if file >= 0 {
        // SAFETY: the descriptor came from the call above and is closed once.
        unsafe { libc::close(file) };
        return Found::Broken;
    }
    if errno() == REFUSED {
        Found::Holds
    } else {
        Found::Unknown
    }
}

/// The seccomp filter (`L-SECCOMP-SOCKETS`): system calls of another architecture and x32 ones,
/// socket, socketpair and the three io_uring calls are refused with EACCES; every other call is
/// allowed. io_uring is refused altogether: its operations, a socket among them, run in the kernel
/// without a system call the filter could see (mhfe AUD-008-SEC001).
mod seccomp {
    /// The architecture of the system calls the filter expects (AUDIT_ARCH_* of linux/audit.h).
    #[cfg(target_arch = "x86_64")]
    const ARCH: u32 = 0xC000_003E;
    #[cfg(target_arch = "aarch64")]
    const ARCH: u32 = 0xC000_00B7;
    /// x32 system calls on x86-64 carry this bit in their number (__X32_SYSCALL_BIT).
    #[cfg(target_arch = "x86_64")]
    const X32_SYSCALL_BIT: u32 = 0x4000_0000;
    /// Offsets in `struct seccomp_data` (linux/seccomp.h): `int nr`, then `__u32 arch`.
    const NUMBER_OFFSET: u32 = 0;
    const ARCH_OFFSET: u32 = 4;
    /// SECCOMP_FILTER_FLAG_TSYNC: every thread of the process takes the filter.
    const TSYNC: libc::c_ulong = 1;

    /// One instruction of classic BPF.
    fn instruction(code: u32, jt: u8, jf: u8, k: u32) -> libc::sock_filter {
        libc::sock_filter {
            code: u16::try_from(code).unwrap_or(u16::MAX),
            jt,
            jf,
            k,
        }
    }

    /// The system call numbers the filter refuses, each with its test.
    fn tests() -> Vec<(u32, u32)> {
        let number = |call: libc::c_long| u32::try_from(call).unwrap_or(u32::MAX);
        let mut tests = Vec::new();
        #[cfg(target_arch = "x86_64")]
        tests.push((libc::BPF_JGE, X32_SYSCALL_BIT));
        for call in [
            libc::SYS_socket,
            libc::SYS_socketpair,
            libc::SYS_io_uring_setup,
            libc::SYS_io_uring_enter,
            libc::SYS_io_uring_register,
        ] {
            tests.push((libc::BPF_JEQ, number(call)));
        }
        tests
    }

    /// Installs the filter on every thread, or says why not.
    pub(super) fn forbid_sockets() -> Result<(), String> {
        let refuse = libc::SECCOMP_RET_ERRNO | super::REFUSED.unsigned_abs();
        let tests = tests();
        let count = u8::try_from(tests.len()).map_err(|_| "too many tests".to_owned())?;
        let load = libc::BPF_LD | libc::BPF_W | libc::BPF_ABS;
        let jump = |condition: u32| libc::BPF_JMP | condition | libc::BPF_K;
        let ret = libc::BPF_RET | libc::BPF_K;
        // Past the number's load, the tests and the allowance, to the refusal.
        let mut program = vec![
            instruction(load, 0, 0, ARCH_OFFSET),
            instruction(jump(libc::BPF_JEQ), 0, count + 2, ARCH),
            instruction(load, 0, 0, NUMBER_OFFSET),
        ];
        for (index, (condition, value)) in (0..count).zip(tests) {
            program.push(instruction(jump(condition), count - index, 0, value));
        }
        program.push(instruction(ret, 0, 0, libc::SECCOMP_RET_ALLOW));
        program.push(instruction(ret, 0, 0, refuse));
        let filter = libc::sock_fprog {
            len: u16::try_from(program.len()).map_err(|_| "too long".to_owned())?,
            filter: program.as_mut_ptr(),
        };
        // SAFETY: the program points to `len` instructions that live for the call; the kernel
        // copies them.
        let result = unsafe {
            libc::syscall(
                libc::SYS_seccomp,
                libc::SECCOMP_SET_MODE_FILTER,
                TSYNC,
                &raw const filter,
            )
        };
        match result {
            0 => Ok(()),
            // A positive result names a thread that could not take the filter.
            thread if thread > 0 => Err(format!("refused for thread {thread}")),
            _ => Err(format!("refused (error {})", super::errno())),
        }
    }
}

/// Landlock (`L-LANDLOCK-WRITES`): every right to change the file system that the kernel's ABI
/// knows is handled, and granted only beneath the outputs' folders, opened before the secret; TCP
/// bind and connect are handled too where the kernel knows them (ABI 4). A command that saves
/// needs ABI 2 (REFER, for the rename and the link of a publication); on ABI 1 it gets no Landlock
/// and the report says so.
mod landlock {
    use super::{CString, OsStrExt, ptr, size_of};
    use std::path::PathBuf;

    /// `struct landlock_ruleset_attr` of linux/landlock.h; ABI 1 to 3 know only its first field.
    #[repr(C)]
    struct RulesetAttr {
        handled_access_fs: u64,
        handled_access_net: u64,
    }

    /// `struct landlock_path_beneath_attr`, packed as the kernel reads it.
    #[repr(C, packed)]
    struct PathBeneathAttr {
        allowed_access: u64,
        parent_fd: i32,
    }

    /// LANDLOCK_CREATE_RULESET_VERSION: asks for the ABI version instead of creating a ruleset.
    const CREATE_RULESET_VERSION: u32 = 1;
    /// LANDLOCK_RULE_PATH_BENEATH.
    const RULE_PATH_BENEATH: u32 = 1;
    /// The rights of linux/landlock.h that change the file system, by the ABI that added them.
    const WRITE_FILE: u64 = 1 << 1;
    const REMOVE_DIR: u64 = 1 << 4;
    const REMOVE_FILE: u64 = 1 << 5;
    const MAKE_CHAR: u64 = 1 << 6;
    const MAKE_DIR: u64 = 1 << 7;
    const MAKE_REG: u64 = 1 << 8;
    const MAKE_SOCK: u64 = 1 << 9;
    const MAKE_FIFO: u64 = 1 << 10;
    const MAKE_BLOCK: u64 = 1 << 11;
    const MAKE_SYM: u64 = 1 << 12;
    const REFER: u64 = 1 << 13; // ABI 2
    const TRUNCATE: u64 = 1 << 14; // ABI 3
    /// TCP bind and connect, ABI 4.
    const TCP: u64 = (1 << 0) | (1 << 1);
    /// What a publication does beneath a chosen folder: a staging folder made and removed, a new
    /// private file written, linked or renamed into place (output.rs).
    const PUBLICATION: u64 =
        WRITE_FILE | REMOVE_DIR | REMOVE_FILE | MAKE_DIR | MAKE_REG | REFER | TRUNCATE;

    /// Restricts the process so that it changes the file system only beneath `folders`.
    pub(super) fn restrict_writes(folders: &[PathBuf]) -> Result<(), String> {
        // SAFETY: with a null attribute and the version flag the call only returns a number.
        let abi = unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                ptr::null::<RulesetAttr>(),
                0_usize,
                CREATE_RULESET_VERSION,
            )
        };
        if abi < 1 {
            return Err("switched off or missing in this kernel".to_owned());
        }
        if abi < 2 && !folders.is_empty() {
            return Err("this kernel's Landlock (ABI 1) cannot allow a save".to_owned());
        }
        let mut handled = WRITE_FILE
            | REMOVE_DIR
            | REMOVE_FILE
            | MAKE_CHAR
            | MAKE_DIR
            | MAKE_REG
            | MAKE_SOCK
            | MAKE_FIFO
            | MAKE_BLOCK
            | MAKE_SYM;
        if abi >= 2 {
            handled |= REFER;
        }
        if abi >= 3 {
            handled |= TRUNCATE;
        }
        let with_network = abi >= 4;
        let attr = RulesetAttr {
            handled_access_fs: handled,
            handled_access_net: if with_network { TCP } else { 0 },
        };
        let size = if with_network {
            size_of::<RulesetAttr>()
        } else {
            size_of::<u64>()
        };
        // SAFETY: the attribute lives for the call and `size` covers only the fields this ABI
        // knows; the kernel returns a new descriptor or an error.
        let ruleset = unsafe {
            libc::syscall(
                libc::SYS_landlock_create_ruleset,
                &raw const attr,
                size,
                0_u32,
            )
        };
        let ruleset = libc::c_int::try_from(ruleset)
            .ok()
            .filter(|&ruleset| ruleset >= 0)
            .ok_or_else(|| format!("the ruleset was refused (error {})", super::errno()))?;
        let result = add_rules(ruleset, folders, PUBLICATION & handled).and_then(|()| {
            // SAFETY: the descriptor came from the call above.
            if unsafe { libc::syscall(libc::SYS_landlock_restrict_self, ruleset, 0_u32) } == 0 {
                Ok(())
            } else {
                Err(format!(
                    "the restriction was refused (error {})",
                    super::errno()
                ))
            }
        });
        // SAFETY: the descriptor came from the call above and is closed once.
        unsafe { libc::close(ruleset) };
        result
    }

    /// One rule per folder: the publication's rights beneath it.
    fn add_rules(ruleset: libc::c_int, folders: &[PathBuf], rights: u64) -> Result<(), String> {
        for folder in folders {
            let path = CString::new(folder.as_os_str().as_bytes())
                .map_err(|_| "a folder's path holds a zero byte".to_owned())?;
            // SAFETY: the path is a C string that lives for the call; the descriptor is closed
            // below.
            let parent = unsafe {
                libc::open(
                    path.as_ptr(),
                    libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC,
                )
            };
            if parent < 0 {
                return Err(format!(
                    "a chosen folder could not be opened (error {})",
                    super::errno()
                ));
            }
            let beneath = PathBeneathAttr {
                allowed_access: rights,
                parent_fd: parent,
            };
            // SAFETY: the attribute lives for the call; the kernel copies it.
            let added = unsafe {
                libc::syscall(
                    libc::SYS_landlock_add_rule,
                    ruleset,
                    RULE_PATH_BENEATH,
                    &raw const beneath,
                    0_u32,
                )
            };
            let error = super::errno();
            // SAFETY: the descriptor came from the open above and is closed once.
            unsafe { libc::close(parent) };
            if added != 0 {
                return Err(format!("a folder's rule was refused (error {error})"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use mnemocode::candidates::age::Opener;
    use mnemocode::candidates::format::{
        CandidateList, MAX_CANDIDATE_RECORDS, MAX_PASSPHRASE_BYTES,
    };
    use mnemocode::candidates::gate::Gate;
    use mnemocode::candidates::protection::Protection;
    use mnemocode::candidates::writer::{ListOutcome, Writer};
    use mnemocode::secret::SecretBytes;

    use super::*;
    use crate::os::random::SystemRandom;

    /// A public test passphrase for the list's file.
    const FILE_PASSPHRASE: &str = "public memory cap test passphrase";

    /// The heaviest operation of a command, as the child process runs it: the largest list the
    /// writer makes (every record, the longest BIP39 passphrase for all) encrypted with a
    /// passphrase through scrypt at 2^18, and opened and read again, under the memory cap.
    #[test]
    #[ignore = "the child process of the_heaviest_operation_runs_under_the_memory_cap: it sets this process's cap"]
    fn heaviest_operation_under_the_cap() {
        set_limit(libc::RLIMIT_DATA, MEMORY_CAP_BYTES).unwrap();
        let entropies = SecretBytes::zeroed("test entropies", MAX_CANDIDATE_RECORDS * 32);
        let protection = Protection::passphrase(FILE_PASSPHRASE).unwrap();
        let writer = Writer::new(protection, &"p".repeat(MAX_PASSPHRASE_BYTES)).unwrap();
        let mut gate = Gate::new();
        let written = writer
            .write(entropies, 32, &mut gate, &mut SystemRandom)
            .unwrap();
        let ListOutcome::List(file) = written else {
            panic!("no list was written");
        };
        let plain = gate
            .decrypt(&file.bytes, Opener::Passphrase(FILE_PASSPHRASE))
            .unwrap();
        let list = CandidateList::decode(&plain).unwrap();
        assert_eq!(list.count(), MAX_CANDIDATE_RECORDS);
    }

    #[test]
    #[expect(
        clippy::disallowed_types,
        reason = "the test starts its own binary as the child that runs under the cap"
    )]
    fn the_heaviest_operation_runs_under_the_memory_cap() {
        let test = "os::linux::tests::heaviest_operation_under_the_cap";
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "--quiet", test])
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "{test} failed under the memory cap");
    }
}

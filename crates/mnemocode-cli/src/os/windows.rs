//! Windows's protections without an administrator (protections.md, `W-*`): DLLs only from the
//! system's folder (`W-DLL-SEARCH`, with the release gate on the executable's imports), no heap in
//! crash reports (`W-WER-NOHEAP`), and a job whose process-memory limit is the memory cap
//! (`W-JOB-MEMORY`), each read back. Windows offers no program a way to refuse its own network or
//! file writes without an administrator or a new process, and writes no core dump unless an
//! administrator set up LocalDumps; the report says both.

#![allow(
    unsafe_code,
    reason = "the kernel32 calls are system calls that Rust offers only through unsafe foreign \
              functions (RUST-07: the CLI's os module only)"
)]

use std::mem::size_of;
use std::path::PathBuf;
use std::ptr;

use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, HANDLE};
use windows_sys::Win32::System::ErrorReporting::{
    WER_FAULT_REPORTING_FLAG_NOHEAP, WerGetFlags, WerSetFlags,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, IsProcessInJob, JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    QueryInformationJobObject, SetInformationJobObject,
};
use windows_sys::Win32::System::LibraryLoader::{
    LOAD_LIBRARY_SEARCH_SYSTEM32, SetDefaultDllDirectories,
};
use windows_sys::Win32::System::Threading::GetCurrentProcess;

use super::protect::{CoreDumps, MEMORY_CAP_BYTES, Needs, Protection};

/// DLLs from the system's folder only, no heap in crash reports, and the memory cap.
pub(super) fn start(protection: &mut Protection) -> CoreDumps {
    // SAFETY: SetDefaultDllDirectories takes flags only.
    if unsafe { SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32) } == 0 {
        protection.lack(format!("DLL search: refused (error {})", last_error()));
    } else {
        protection.hold("DLLs from the system only");
    }
    protection.attempt("crash reports", |protection| {
        // SAFETY: WerSetFlags takes flags only; WerGetFlags writes the DWORD, which lives for the
        // call, and GetCurrentProcess returns a pseudo handle that needs no closing.
        let flags = unsafe {
            if WerSetFlags(WER_FAULT_REPORTING_FLAG_NOHEAP) != 0 {
                return Err("WerSetFlags refused".to_owned());
            }
            let mut flags = 0;
            if WerGetFlags(GetCurrentProcess(), &mut flags) != 0 {
                return Err("WerGetFlags refused".to_owned());
            }
            flags
        };
        if flags & WER_FAULT_REPORTING_FLAG_NOHEAP == 0 {
            return Err("the heap is still reported".to_owned());
        }
        protection.hold("no heap in crash reports");
        Ok(())
    });
    protection.attempt("memory cap", |protection| {
        cap_memory()?;
        protection.hold(format!(
            "memory cap {} MiB",
            MEMORY_CAP_BYTES / (1024 * 1024)
        ));
        Ok(())
    });
    CoreDumps::Untouched
}

/// Puts this process into a new job whose process-memory limit is the cap, and reads it back.
fn cap_memory() -> Result<(), String> {
    let cap = usize::try_from(MEMORY_CAP_BYTES).map_err(|_| "the cap is too large".to_owned())?;
    let size = u32::try_from(size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>())
        .map_err(|_| "the limit is too large".to_owned())?;
    // SAFETY: a zeroed limit structure is a valid empty one.
    let mut limit: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limit.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY;
    limit.ProcessMemoryLimit = cap;
    // SAFETY: no attributes or name; the handle stays open for the life of the process, and the
    // job ends with it.
    let job: HANDLE = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if job.is_null() {
        return Err(format!("not created (error {})", last_error()));
    }
    // SAFETY: the structure and its size live for the calls; the handles are this process's.
    let result = unsafe {
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            (&raw const limit).cast(),
            size,
        ) == 0
        {
            Err(format!("its limit was refused (error {})", last_error()))
        } else if AssignProcessToJobObject(job, GetCurrentProcess()) == 0 {
            Err(format!(
                "this process could not join it (error {})",
                last_error()
            ))
        } else {
            read_job(job, cap, size)
        }
    };
    if result.is_err() {
        // SAFETY: the job's handle came from CreateJobObjectW and is closed once.
        unsafe { CloseHandle(job) };
    }
    result
}

/// Whether this process is in `job` and the job's process-memory limit is `cap`.
///
/// # Safety
///
/// `job` is a handle of a job object and `size` the size of its extended limit structure.
unsafe fn read_job(job: HANDLE, cap: usize, size: u32) -> Result<(), String> {
    let mut in_job = 0;
    // SAFETY: a zeroed limit structure is a valid empty one.
    let mut read: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the flag and the structure live for the calls, `size` is the structure's size.
    let joined = unsafe {
        IsProcessInJob(GetCurrentProcess(), job, &mut in_job) != 0
            && in_job != 0
            && QueryInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                (&raw mut read).cast(),
                size,
                ptr::null_mut(),
            ) != 0
    };
    let limited = read.BasicLimitInformation.LimitFlags & JOB_OBJECT_LIMIT_PROCESS_MEMORY != 0
        && read.ProcessMemoryLimit == cap;
    if joined && limited {
        Ok(())
    } else {
        Err("its limit could not be read back".to_owned())
    }
}

/// Nothing changes after start: no dumps to read, no tracer read.
pub(super) use super::protect::unchanged as read_back;

/// Windows has nothing to restrict without an administrator; the report says what.
pub(super) fn restrict(protection: &mut Protection, _needs: &Needs) {
    protection.lack("network and file writes: Windows refuses them only for an administrator");
    protection.lack("core dumps: written only where an administrator set up LocalDumps");
}

/// Windows rules no writes for an unprivileged program.
pub(super) const fn rule_writes(_protection: &mut Protection, _folders: &[PathBuf]) {}

/// The error of the call just made.
fn last_error() -> u32 {
    // SAFETY: GetLastError reads the thread's last error only.
    unsafe { GetLastError() }
}

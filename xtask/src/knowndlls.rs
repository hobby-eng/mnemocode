//! `cargo xtask knowndlls`, on each Windows runner of CI: lists the \KnownDlls object directory of
//! this Windows, whose DLLs the loader always takes from the system, and fails unless it holds
//! every DLL of xtask/knowndlls.json besides ntdll.dll, which the kernel maps itself
//! (W-DLL-SEARCH). Reading an object directory needs ntdll's calls, the only unsafe code of the
//! repository's tools.

#![allow(
    unsafe_code,
    reason = "ntdll's object directory calls are reached only through unsafe foreign functions"
)]

use std::path::Path;

use crate::repository::json;
use crate::{Failure, report};

/// The names of the sections of \KnownDlls, lower case and sorted.
#[cfg(windows)]
fn sections() -> Result<Vec<String>, Failure> {
    use std::ptr;
    use windows_sys::Wdk::Foundation::{NtClose, OBJECT_ATTRIBUTES};
    use windows_sys::Wdk::Storage::FileSystem::{NtOpenDirectoryObject, NtQueryDirectoryObject};
    use windows_sys::Win32::Foundation::{HANDLE, UNICODE_STRING};

    /// DIRECTORY_QUERY, OBJ_CASE_INSENSITIVE, STATUS_NO_MORE_ENTRIES.
    const DIRECTORY_QUERY: u32 = 0x0001;
    const CASE_INSENSITIVE: u32 = 0x40;
    const NO_MORE_ENTRIES: i32 = 0x8000_001A_u32.cast_signed();

    /// One entry of an object directory: its name and its type's name.
    #[repr(C)]
    struct DirectoryEntry {
        name: UNICODE_STRING,
        type_name: UNICODE_STRING,
    }

    fn text(string: &UNICODE_STRING) -> String {
        let units = usize::from(string.Length / 2);
        if string.Buffer.is_null() || units == 0 {
            return String::new();
        }
        // SAFETY: the kernel wrote `Length` bytes of UTF-16 at `Buffer`, inside the buffer given to
        // the call, which outlives this read.
        let slice = unsafe { std::slice::from_raw_parts(string.Buffer, units) };
        String::from_utf16_lossy(slice)
    }

    let mut path: Vec<u16> = "\\KnownDlls".encode_utf16().collect();
    let length = u16::try_from(path.len() * 2).map_err(|_| Failure("path too long".to_owned()))?;
    let name = UNICODE_STRING {
        Length: length,
        MaximumLength: length,
        Buffer: path.as_mut_ptr(),
    };
    let attributes = OBJECT_ATTRIBUTES {
        Length: u32::try_from(size_of::<OBJECT_ATTRIBUTES>()).unwrap_or(0),
        RootDirectory: ptr::null_mut(),
        ObjectName: &raw const name,
        Attributes: CASE_INSENSITIVE,
        SecurityDescriptor: ptr::null(),
        SecurityQualityOfService: ptr::null(),
    };
    let mut handle: HANDLE = ptr::null_mut();
    // SAFETY: the attributes and the name they point to live for the call, which writes the handle.
    let status = unsafe { NtOpenDirectoryObject(&mut handle, DIRECTORY_QUERY, &attributes) };
    if status != 0 {
        return Err(Failure(format!(
            "NtOpenDirectoryObject failed: {status:#010x}"
        )));
    }
    // A buffer of u64, aligned for the entry's pointers.
    let mut buffer = vec![0_u64; 8192];
    let bytes = u32::try_from(buffer.len() * 8).unwrap_or(u32::MAX);
    let mut names = Vec::new();
    let (mut context, mut restart) = (0_u32, true);
    let status = loop {
        let mut returned = 0_u32;
        // SAFETY: the buffer of `bytes` bytes and the counters live for the call.
        let status = unsafe {
            NtQueryDirectoryObject(
                handle,
                buffer.as_mut_ptr().cast(),
                bytes,
                true,
                restart,
                &mut context,
                &mut returned,
            )
        };
        restart = false;
        if status < 0 {
            break status;
        }
        // SAFETY: a successful call wrote one entry at the start of the aligned buffer.
        let entry = unsafe { &*buffer.as_ptr().cast::<DirectoryEntry>() };
        if text(&entry.type_name) == "Section" {
            names.push(text(&entry.name).to_lowercase());
        }
    };
    // SAFETY: the handle came from NtOpenDirectoryObject and is closed once.
    unsafe { NtClose(handle) };
    if status != NO_MORE_ENTRIES {
        return Err(Failure(format!(
            "NtQueryDirectoryObject failed: {status:#010x}"
        )));
    }
    names.sort();
    names.dedup();
    Ok(names)
}

/// No other system has a \KnownDlls directory.
#[cfg(not(windows))]
fn sections() -> Result<Vec<String>, Failure> {
    Err(Failure(
        "knowndlls reads the \\KnownDlls object directory of Windows; run it there".to_owned(),
    ))
}

/// The task.
pub(crate) fn run(root: &Path) -> Result<(), Failure> {
    let listed = sections()?;
    println!("\\KnownDlls ({} sections):", listed.len());
    for name in &listed {
        println!("  {name}");
    }
    let stored = json(root, "xtask/knowndlls.json")?;
    let missing: Vec<String> = stored["dlls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_lowercase)
        .filter(|name| name != "ntdll.dll" && !listed.contains(name))
        .collect();
    let problems = if missing.is_empty() {
        Vec::new()
    } else {
        vec![format!(
            "Not KnownDLLs on this Windows: {}",
            missing.join(", ")
        )]
    };
    report(
        &problems,
        "knowndlls: the stored list does not hold here",
        "Every DLL of xtask/knowndlls.json is a KnownDLL here.",
    )
}

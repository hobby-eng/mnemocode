//! W-DLL-SEARCH's release gate (docs/design/platform/protections.json): every DLL that a Windows
//! executable imports, directly or delay-loaded, is in the stored KnownDLL list
//! (xtask/knowndlls.json) or is an API set, so the loader takes it from the system and never from
//! the executable's folder, where a planted DLL would wait. The GNU target cannot set
//! DependentLoadFlags: the MinGW-w64 libraries of the pinned build define no `_load_config_used`
//! (increment 0's probe, 2026-10-27).

use std::path::Path;

use crate::repository::json;
use crate::{Failure, report};

/// The PE data directories read: imports and delay-load imports, each with its descriptor's size
/// and the offset of its name in it.
const DIRECTORIES: [(usize, usize, usize); 2] = [(1, 20, 12), (13, 32, 4)];

fn u16_at(bytes: &[u8], at: usize) -> Result<usize, Failure> {
    bytes
        .get(at..at + 2)
        .and_then(|slice| slice.try_into().ok())
        .map(|array| usize::from(u16::from_le_bytes(array)))
        .ok_or_else(|| Failure("the file ends inside a PE header".to_owned()))
}

fn u32_at(bytes: &[u8], at: usize) -> Result<usize, Failure> {
    bytes
        .get(at..at + 4)
        .and_then(|slice| slice.try_into().ok())
        .and_then(|array| usize::try_from(u32::from_le_bytes(array)).ok())
        .ok_or_else(|| Failure("the file ends inside a PE header".to_owned()))
}

/// A section: its virtual address and size, and where its bytes start in the file.
struct Section {
    virtual_address: usize,
    virtual_size: usize,
    raw_offset: usize,
}

/// The file offset of a relative virtual address.
fn offset_of(rva: usize, sections: &[Section]) -> Result<usize, Failure> {
    sections
        .iter()
        .find(|section| {
            rva >= section.virtual_address && rva < section.virtual_address + section.virtual_size
        })
        .map(|section| rva - section.virtual_address + section.raw_offset)
        .ok_or_else(|| Failure(format!("address {rva:#x} is in no section")))
}

/// The names of the DLLs a PE32+ file imports, directly and delay-loaded, in file order.
pub(crate) fn imported_dlls(bytes: &[u8]) -> Result<Vec<String>, Failure> {
    if bytes.get(..2) != Some(b"MZ") {
        return Err(Failure("not a PE file (no MZ header)".to_owned()));
    }
    let pe = u32_at(bytes, 0x3c)?;
    if bytes.get(pe..pe + 4) != Some(b"PE\0\0") {
        return Err(Failure("no PE header".to_owned()));
    }
    let optional = pe + 24;
    if u16_at(bytes, optional)? != 0x20b {
        return Err(Failure("not a PE32+ (64-bit) file".to_owned()));
    }
    let count = u16_at(bytes, pe + 6)?;
    let first = optional + u16_at(bytes, pe + 20)?;
    let sections = (0..count)
        .map(|index| {
            let at = first + index * 40;
            Ok(Section {
                virtual_address: u32_at(bytes, at + 12)?,
                virtual_size: u32_at(bytes, at + 8)?.max(u32_at(bytes, at + 16)?),
                raw_offset: u32_at(bytes, at + 20)?,
            })
        })
        .collect::<Result<Vec<_>, Failure>>()?;
    let mut names = Vec::new();
    for (index, size, name_field) in DIRECTORIES {
        let rva = u32_at(bytes, optional + 112 + index * 8)?;
        if rva == 0 {
            continue;
        }
        let mut at = offset_of(rva, &sections)?;
        loop {
            let name_rva = u32_at(bytes, at + name_field)?;
            if name_rva == 0 {
                break;
            }
            let start = offset_of(name_rva, &sections)?;
            let end = bytes
                .get(start..)
                .and_then(|rest| rest.iter().position(|&byte| byte == 0))
                .ok_or_else(|| Failure("a DLL name runs past the file".to_owned()))?;
            names.push(String::from_utf8_lossy(&bytes[start..start + end]).into_owned());
            at += size;
        }
    }
    Ok(names)
}

/// Whether `name` is an API set, which resolves through the loader's schema.
fn is_api_set(name: &str) -> bool {
    (name.starts_with("api-ms-") || name.starts_with("ext-ms-"))
        && name.ends_with(".dll")
        && name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-.".contains(&byte))
}

/// Lists the imports of `file`; with `check`, fails on any outside the KnownDLL list.
pub(crate) fn run(root: &Path, file: &Path, check: bool) -> Result<(), Failure> {
    let bytes =
        std::fs::read(file).map_err(|error| Failure(format!("{}: {error}", file.display())))?;
    let imports = imported_dlls(&bytes)?;
    if !check {
        return report(&[], "", &imports.join("\n"));
    }
    let known: Vec<String> = json(root, "xtask/knowndlls.json")?["dlls"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_lowercase)
        .collect();
    let outside: Vec<String> = imports
        .iter()
        .map(|name| name.to_lowercase())
        .filter(|name| !known.contains(name) && !is_api_set(name))
        .collect();
    let problems = if outside.is_empty() {
        Vec::new()
    } else {
        vec![format!(
            "{} imports DLLs that are neither KnownDLLs nor API sets: {}",
            file.display(),
            outside.join(", ")
        )]
    };
    report(
        &problems,
        "windows-imports: an import could be planted beside the executable",
        &format!(
            "{}: {} imports, each a KnownDLL or an API set",
            file.display(),
            imports.len()
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_sets_are_told_from_other_dlls() {
        assert!(is_api_set("api-ms-win-core-synch-l1-2-0.dll"));
        assert!(!is_api_set("dbghelp.dll"));
        assert!(imported_dlls(b"not a pe file").is_err());
    }
}

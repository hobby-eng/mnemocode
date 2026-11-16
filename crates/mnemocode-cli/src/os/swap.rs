//! Whether swap may write this program's memory to a disk unencrypted (`L-SWAP-CHECK`): each area
//! of /proc/swaps is safe on dm-crypt (also below LVM) or on zram without a backing device. A table
//! that cannot be read warns too: a warning too many is safe, a missing one is not.

#![expect(
    clippy::disallowed_methods,
    reason = "/proc and /sys are read here, in the os module"
)]

use std::fs;
use std::path::Path;

use mnemocode::text::display::safe_display;

/// The start of the warning, for areas that are not encrypted or not known to be.
const SWAP_RISK: &str = "Swap may write this memory to the disk unencrypted";
/// The columns that the first line of /proc/swaps names (Linux, mm/swapfile.c).
const SWAP_COLUMNS: &str = "Filename Type Size Used Priority";
/// Device stacks are shallow; a loop in a strange /sys must not hang the check.
const MAX_DEPTH: usize = 8;

/// A swap area that may write memory to a disk unencrypted, by its path in /proc/swaps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SwapArea(pub(crate) String);

/// The swap areas under `root` that are not encrypted or not known to be; `Err` when the table
/// cannot be read or does not have its form.
fn unencrypted_swap(root: &Path) -> Result<Vec<SwapArea>, ()> {
    let table = fs::read_to_string(root.join("proc/swaps")).map_err(|_| ())?;
    let mut lines = table.lines();
    let header: Vec<&str> = lines.next().ok_or(())?.split_whitespace().collect();
    if header.join(" ") != SWAP_COLUMNS {
        return Err(());
    }
    let mut risky = Vec::new();
    for line in lines {
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [path, kind, _, _, _] = fields.as_slice() else {
            return Err(());
        };
        let path = unescape(path)?;
        let device = match *kind {
            "partition" => device_name(root, &path),
            "file" => device_of_file(root, &path),
            _ => return Err(()),
        };
        if !device.is_some_and(|name| encrypted(root, &name, 0)) {
            risky.push(SwapArea(path));
        }
    }
    Ok(risky)
}

/// A path as /proc/swaps writes it, a backslash and three octal digits for an ASCII character.
fn unescape(path: &str) -> Result<String, ()> {
    let mut text = String::new();
    let mut rest = path;
    while let Some(at) = rest.find('\\') {
        text.push_str(rest.get(..at).ok_or(())?);
        let octal = rest.get(at + 1..at + 4).ok_or(())?;
        let code = u8::from_str_radix(octal, 8).map_err(|_| ())?;
        if !code.is_ascii() {
            return Err(());
        }
        text.push(char::from(code));
        rest = rest.get(at + 4..).ok_or(())?;
    }
    text.push_str(rest);
    Ok(text)
}

/// The kernel's name of a block device, such as dm-0 or sda2, from its path in /dev.
fn device_name(root: &Path, path: &str) -> Option<String> {
    let resolved = fs::canonicalize(root.join(path.trim_start_matches('/'))).ok()?;
    Some(resolved.file_name()?.to_string_lossy().into_owned())
}

/// The block device that holds a swap file, by the file's device number.
fn device_of_file(root: &Path, path: &str) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::MetadataExt;
        let device = fs::metadata(root.join(path.trim_start_matches('/')))
            .ok()?
            .dev();
        let (major, minor) = (libc::major(device), libc::minor(device));
        let link = root.join(format!("sys/dev/block/{major}:{minor}"));
        let resolved = fs::canonicalize(link).ok()?;
        Some(resolved.file_name()?.to_string_lossy().into_owned())
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _unused = (root, path);
        None
    }
}

/// Whether a block device is encrypted: dm-crypt, zram without a backing device, or built only on
/// such devices.
fn encrypted(root: &Path, name: &str, depth: usize) -> bool {
    if depth > MAX_DEPTH {
        return false;
    }
    if name.starts_with("zram") {
        // A zram device written back to a disk keeps idle pages there unencrypted. A kernel without
        // writeback has no backing_dev at all: RAM only. One that cannot be read, or a device not in
        // /sys at all, tells nothing, so it is not taken as safe (AUD-007-SEC003).
        let device = root.join("sys/block").join(name);
        return match fs::read_to_string(device.join("backing_dev")) {
            Ok(backing) => backing.trim() == "none",
            Err(error) => error.kind() == std::io::ErrorKind::NotFound && device.is_dir(),
        };
    }
    let device = root.join("sys/class/block").join(name);
    if fs::read_to_string(device.join("dm/uuid")).is_ok_and(|uuid| uuid.starts_with("CRYPT-")) {
        return true;
    }
    let Ok(entries) = fs::read_dir(device.join("slaves")) else {
        return false;
    };
    let below: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    !below.is_empty() && below.iter().all(|slave| encrypted(root, slave, depth + 1))
}

/// The warning that comes before a secret, or `None` when there is no swap or all of it is safe.
pub(crate) fn unprotected_swap() -> Option<String> {
    if cfg!(target_os = "linux") {
        warning_under(Path::new("/"))
    } else {
        None
    }
}

/// [`unprotected_swap`] with /proc and /sys under `root`, for the tests.
fn warning_under(root: &Path) -> Option<String> {
    match unencrypted_swap(root) {
        Err(()) => Some(format!(
            "{SWAP_RISK}: MnemoCode cannot read /proc/swaps to tell"
        )),
        Ok(risky) if risky.is_empty() => None,
        Ok(risky) => {
            let names: Vec<String> = risky.iter().map(|area| safe_display(&area.0)).collect();
            Some(format!("{SWAP_RISK}: {}", names.join(", ")))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_are_undone_and_a_stray_backslash_is_refused() {
        assert_eq!(unescape("/swap\\040file"), Ok("/swap file".to_owned()));
        assert_eq!(unescape("/a\\9"), Err(()));
        assert_eq!(unescape("/a\\377"), Err(()));
    }

    // AUD-007-SEC003: zram is safe without a backing device, unsafe with one, and not known safe
    // where its attribute cannot be read or the device is not in /sys.
    #[cfg(unix)]
    #[test]
    fn zram_is_safe_only_without_a_backing_device() {
        use std::os::unix::fs::PermissionsExt;
        let root = std::env::temp_dir().join(format!("mnemocode-zram-{}", std::process::id()));
        let attribute = root.join("sys/block/zram0/backing_dev");
        assert!(
            !encrypted(&root, "zram0", 0),
            "no device in /sys: nothing known"
        );
        fs::create_dir_all(attribute.parent().unwrap()).unwrap();
        assert!(
            encrypted(&root, "zram0", 0),
            "no attribute: a kernel without writeback"
        );
        fs::write(&attribute, "none\n").unwrap();
        assert!(encrypted(&root, "zram0", 0));
        fs::write(&attribute, "/dev/sda3\n").unwrap();
        assert!(!encrypted(&root, "zram0", 0));
        fs::set_permissions(&attribute, fs::Permissions::from_mode(0o000)).unwrap();
        if fs::read_to_string(&attribute).is_err() {
            assert!(!encrypted(&root, "zram0", 0), "an unreadable attribute");
        }
        fs::set_permissions(&attribute, fs::Permissions::from_mode(0o600)).unwrap();
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_unreadable_table_warns() {
        let warning = warning_under(Path::new("/nonexistent-root-for-the-test"));
        assert_eq!(
            warning.as_deref(),
            Some(
                "Swap may write this memory to the disk unencrypted: MnemoCode cannot read /proc/swaps to tell"
            )
        );
    }
}

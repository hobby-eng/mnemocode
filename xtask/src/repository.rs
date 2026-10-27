//! The repository's files as the gates read them: those Git tracks or would track (new, not
//! ignored), each once and only while it exists, and their SHA-256.

use std::fmt::Write as _;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::{Failure, output_of};

/// The files that `git ls-files` lists in `root` with `options`, for `pathspecs` (every file when
/// none is given), as paths from `root`, sorted, each once, and only those that exist.
pub(crate) fn listed_files(
    root: &Path,
    options: &[&str],
    pathspecs: &[&str],
) -> Result<Vec<String>, Failure> {
    let mut arguments = vec!["ls-files", "-z"];
    arguments.extend_from_slice(options);
    arguments.push("--");
    arguments.extend_from_slice(pathspecs);
    let listing = output_of(root, "git", &arguments)?;
    let mut files: Vec<String> = listing
        .split('\0')
        .filter(|path| !path.is_empty() && root.join(path).is_file())
        .map(str::to_owned)
        .collect();
    files.sort();
    files.dedup();
    Ok(files)
}

/// The files Git tracks or would track in `root`.
pub(crate) fn tracked_or_new(root: &Path) -> Result<Vec<String>, Failure> {
    listed_files(root, &["--cached", "--others", "--exclude-standard"], &[])
}

/// The text of the file at `path` under `root`.
pub(crate) fn read(root: &Path, path: &str) -> Result<String, Failure> {
    std::fs::read_to_string(root.join(path)).map_err(|error| Failure(format!("{path}: {error}")))
}

/// The SHA-256 of `bytes`, in lower-case hexadecimal.
pub(crate) fn sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(64);
    for byte in digest {
        let _infallible = write!(text, "{byte:02x}");
    }
    text
}

/// The SHA-256 of the file at `path` under `root`.
pub(crate) fn sha256_of(root: &Path, path: &str) -> Result<String, Failure> {
    let bytes =
        std::fs::read(root.join(path)).map_err(|error| Failure(format!("{path}: {error}")))?;
    Ok(sha256(&bytes))
}

/// The JSON of the file at `path` under `root`.
pub(crate) fn json(root: &Path, path: &str) -> Result<serde_json::Value, Failure> {
    serde_json::from_str(&read(root, path)?).map_err(|error| Failure(format!("{path}: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_gives_the_published_check_value() {
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}

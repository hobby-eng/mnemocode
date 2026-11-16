//! The release tasks (ARCHITECTURE.md §1, docs/RELEASING.md): `release build` (an executable with
//! its notices and checksums), `release pages`, `verify-executable` (run away from the checkout on
//! public data), `reproducible` (rebuilt in the pinned container and compared), `features` and
//! `sign` (a draft release's SHA256SUMS signed on the owner's computer).

use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::check::clippy;
use crate::repository::{read, sha256};
use crate::wasm::remapped_rustflags;
use crate::{Failure, output_of, run_tool};

/// Where the files of a release are written.
const RELEASE_FOLDER: &str = "dist/release";
/// The Rust triples of the canonical container and the name of each in a file of a release.
const CANONICAL_TARGETS: [(&str, &str); 3] = [
    ("x86_64-unknown-linux-gnu", "linux-x64"),
    ("aarch64-unknown-linux-gnu", "linux-arm64"),
    ("x86_64-pc-windows-gnu", "win-x64"),
];
/// The targets of the macOS runners.
const MACOS_TARGETS: [(&str, &str); 2] = [
    ("aarch64-apple-darwin", "macos-arm64"),
    ("x86_64-apple-darwin", "macos-x64"),
];
/// The repository whose draft release and build attestations are checked.
const REPOSITORY: &str = "hobby-eng/mnemocode";
/// The fingerprint of the owner's OpenPGP release key, which signs SHA256SUMS of every release.
const SIGNING_KEY: &str = "28FC51B1DB80DF2101128CB30EDD4814591DD095";
const CHECKSUMS: &str = "SHA256SUMS";
const SIGNATURE: &str = "SHA256SUMS.asc";
const PUBLIC_KEY: &str = "RELEASE-SIGNING-KEY.asc";
/// The public BIP39 test phrase, and its Seedshift encoding with the date 23-09-2026.
const TEST_PHRASE: &str =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SHIFTED: &str = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";

/// The version of the workspace.
fn version(root: &Path) -> Result<String, Failure> {
    crate::wasm::metadata(root)?["packages"]
        .as_array()
        .and_then(|packages| {
            packages
                .iter()
                .find(|package| package["name"] == "mnemocode-cli")
        })
        .and_then(|package| package["version"].as_str())
        .map(str::to_owned)
        .ok_or_else(|| Failure("cargo metadata names no version".to_owned()))
}

/// The name of `target` in a file of a release.
fn system_of(target: &str) -> Result<&'static str, Failure> {
    CANONICAL_TARGETS
        .iter()
        .chain(&MACOS_TARGETS)
        .find(|(triple, _)| *triple == target)
        .map(|(_, name)| *name)
        .ok_or_else(|| Failure(format!("No executable is built for {target}.")))
}

/// The file name of the executable of `target` in a release of `version`.
fn executable_name(target: &str, system: &str, version: &str) -> String {
    let ending = if target.contains("windows") {
        ".exe"
    } else {
        ""
    };
    format!("mnemocode-{version}-{system}{ending}")
}

/// Every file a release of `version` holds besides SHA256SUMS: each executable with its notices,
/// and the archive of the pages' WebAssembly files.
fn release_files(version: &str) -> Vec<String> {
    let mut files: Vec<String> = CANONICAL_TARGETS
        .iter()
        .chain(&MACOS_TARGETS)
        .flat_map(|(target, system)| {
            [
                executable_name(target, system, version),
                format!("mnemocode-{version}-{system}-licenses.txt"),
            ]
        })
        .collect();
    files.push(format!("mnemocode-{version}-wasm.tar"));
    files
}

/// A line of a checksum file, as sha256sum writes it.
fn checksum_line(bytes: &[u8], file: &str) -> String {
    format!("{}  {file}\n", sha256(bytes))
}

/// Writes the executable of `target`, as mnemocode-<version>-<system>[.exe], with its notices and
/// their checksums, in the release folder.
pub(crate) fn build(root: &Path, target: &str) -> Result<(), Failure> {
    let system = system_of(target)?;
    let mut cargo = Command::new("cargo");
    cargo
        .current_dir(root)
        .args([
            "build",
            "--locked",
            "--release",
            "-p",
            "mnemocode-cli",
            "--target",
            target,
        ])
        .envs(remapped_rustflags(root)?);
    if !cargo.status()?.success() {
        return Err(Failure(format!(
            "The executable of {target} did not build."
        )));
    }
    let version = version(root)?;
    let name = format!("mnemocode-{version}-{system}");
    let folder = root.join(RELEASE_FOLDER);
    fs::create_dir_all(&folder)?;
    let target_folder = crate::wasm::target_folder(root)?;
    let built = target_folder
        .join(target)
        .join("release")
        .join(if target.contains("windows") {
            "mnemocode.exe"
        } else {
            "mnemocode"
        });
    let executable = executable_name(target, system, &version);
    let notices = format!("{name}-licenses.txt");
    fs::copy(&built, folder.join(&executable))?;
    fs::copy(root.join("THIRD_PARTY_NOTICES.md"), folder.join(&notices))?;
    let mut checksums = String::new();
    for file in [&executable, &notices] {
        checksums.push_str(&checksum_line(&fs::read(folder.join(file))?, file));
    }
    fs::write(folder.join(format!("{executable}.sha256")), checksums)?;
    println!("Built {RELEASE_FOLDER}/{executable}");
    Ok(())
}

/// The license and notice files every distribution carries; the WebAssembly archive holds them in
/// its wasm/ folder, as an executable has its notices beside it.
const DISTRIBUTION_NOTICES: [&str; 4] = [
    "LICENSE-MIT",
    "LICENSE-APACHE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
];

/// Packs every page's file with the license and notices, in a tar archive that holds no time and no
/// owner.
pub(crate) fn pack_pages(root: &Path) -> Result<(), Failure> {
    let version = version(root)?;
    let archive = format!("mnemocode-{version}-wasm.tar");
    let folder = root.join(RELEASE_FOLDER);
    fs::create_dir_all(&folder)?;
    for name in DISTRIBUTION_NOTICES {
        fs::copy(root.join(name), root.join("dist/wasm").join(name))?;
    }
    run_tool(
        &root.join("dist"),
        "tar",
        &[
            "--create",
            "--sort=name",
            "--mtime=@0",
            "--owner=0",
            "--group=0",
            "--numeric-owner",
            "--mode=u=rwX,go=rX",
            // The test profile holds the gates' probes, which no page takes.
            "--exclude=wasm/test",
            "--file",
            &format!("release/{archive}"),
            "wasm",
        ],
    )?;
    let sum = checksum_line(&fs::read(folder.join(&archive))?, &archive);
    fs::write(folder.join(format!("{archive}.sha256")), sum)?;
    println!("Built {RELEASE_FOLDER}/{archive}");
    Ok(())
}

/// Rebuilds the canonical files in the pinned container, without Docker's cache, and compares them
/// byte for byte with those of the release folder.
pub(crate) fn reproducible(root: &Path) -> Result<(), Failure> {
    let rebuilt = root.join("dist/rebuilt");
    if rebuilt.exists() {
        fs::remove_dir_all(&rebuilt)?;
    }
    run_tool(
        root,
        "docker",
        &[
            "buildx",
            "build",
            "--no-cache",
            "--platform",
            "linux/amd64",
            "--target",
            "artifacts",
            "--output",
            "type=local,dest=dist/rebuilt",
            "-f",
            "packaging/Dockerfile.reproducible",
            ".",
        ],
    )?;
    let release = root.join(RELEASE_FOLDER);
    let mut compared = 0;
    for entry in fs::read_dir(rebuilt.join("release"))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        // The checksum of one job, which SHA256SUMS takes over: a release holds no such file.
        if name.ends_with(".sha256") {
            continue;
        }
        let published = fs::read(release.join(&name))
            .map_err(|_| Failure(format!("{name} is not in {RELEASE_FOLDER}/.")))?;
        if fs::read(entry.path())? != published {
            return Err(Failure(format!("{name} differs from the canonical build.")));
        }
        compared += 1;
    }
    if compared == 0 {
        return Err(Failure("The container built nothing.".to_owned()));
    }
    println!("{compared} files equal, byte for byte.");
    Ok(())
}

/// Runs `executable` in `folder`.
fn run_in(folder: &Path, executable: &Path, arguments: &[&str]) -> Result<String, Failure> {
    let output = Command::new(executable)
        .args(arguments)
        .current_dir(folder)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .output()
        .map_err(|error| Failure(format!("The executable could not run: {error}")))?;
    if !output.status.success() {
        return Err(Failure(format!(
            "The executable failed: {}: {}",
            arguments.join(" "),
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Says that `what` held, or refuses it.
fn check(holds: bool, what: &str) -> Result<(), Failure> {
    if holds {
        println!("ok  {what}");
        Ok(())
    } else {
        Err(Failure(format!("The executable failed: {what}.")))
    }
}

/// The steps of a run of a built executable: version, the full self-test, a Seedshift encoding, a
/// re-encoding, a Shamir split and restore, a card PDF and the help, with public data only.
fn verify_in(folder: &Path, executable: &Path, version: &str) -> Result<(), Failure> {
    let run = |arguments: &[&str]| run_in(folder, executable, arguments);
    check(
        run(&["--version"])? == format!("mnemocode {version}\n"),
        &format!("prints version {version}"),
    )?;
    let self_test = run(&["self-test"])?;
    check(self_test.contains("PASS"), "passes the full self-test")?;
    let sandbox = if cfg!(target_os = "linux") {
        "kernel: no sockets"
    } else if cfg!(target_os = "macos") {
        "sandbox: no network"
    } else {
        "no heap in crash reports"
    };
    check(
        self_test.contains(sandbox),
        &format!("is held by the system's sandbox ({sandbox})"),
    )?;
    fs::write(
        folder.join("public-mnemonic.txt"),
        format!("{TEST_PHRASE}\n"),
    )?;
    fs::write(folder.join("public-dates.txt"), "23-09-2026\n")?;
    fs::write(folder.join("public-shifted.txt"), format!("{SHIFTED}\n"))?;
    let shifted = run(&[
        "encode",
        "--mnemonic-file",
        "public-mnemonic.txt",
        "--dates-file",
        "public-dates.txt",
        "--format",
        "1",
    ])?;
    check(
        shifted.contains(SHIFTED),
        "masks the test phrase with a date",
    )?;
    let re_encoded = run(&[
        "re-encode",
        "--input-file",
        "public-shifted.txt",
        "--old-mode",
        "seedshift",
        "--old-dates-file",
        "public-dates.txt",
        "--format",
        "3",
        "--master-fingerprint",
        "73c5da0a",
    ])?;
    let codes = format!("{}5728", "7684".repeat(11));
    check(re_encoded.contains(&codes), "re-encodes the masked phrase")?;
    run(&[
        "encode",
        "--sskr",
        "--mnemonic-file",
        "public-mnemonic.txt",
        "--threshold",
        "2",
        "--shares",
        "3",
        "--output",
        "shares.txt",
    ])?;
    let shares = fs::read_to_string(folder.join("shares.txt"))?;
    let lines: Vec<&str> = shares.lines().collect();
    if let [first, _, third] = lines.as_slice() {
        fs::write(folder.join("two.txt"), format!("{first}\n{third}\n"))?;
    }
    check(
        run(&["sskr-combine", "--share-file", "two.txt"])?.contains(TEST_PHRASE),
        "restores the phrase from 2 of 3 Shamir shares",
    )?;
    run(&[
        "preview",
        "--template",
        "business-it",
        "--pdf",
        "preview.pdf",
    ])?;
    check(
        fs::read(folder.join("preview.pdf"))?.starts_with(b"%PDF-"),
        "draws a card PDF with its embedded artwork",
    )?;
    check(
        run(&["encode", "--help"])?.contains("Usage: mnemocode encode"),
        "prints the help",
    )
}

/// Runs the executable at `path` from a new folder, away from the checkout, and checks that it
/// works on its own and that its notices stand beside it.
pub(crate) fn verify_executable(root: &Path, path: &Path) -> Result<(), Failure> {
    let executable = fs::canonicalize(path)?;
    let version = version(root)?;
    let folder = std::env::temp_dir().join(format!("mnemocode-executable-{}", std::process::id()));
    fs::create_dir(&folder)?;
    let result = verify_in(&folder, &executable, &version);
    fs::remove_dir_all(&folder)?;
    result?;
    let name = executable
        .file_name()
        .map(|name| name.to_string_lossy().trim_end_matches(".exe").to_owned())
        .unwrap_or_default();
    let notices = executable.with_file_name(format!("{name}-licenses.txt"));
    let text = fs::read_to_string(&notices).unwrap_or_default();
    check(
        text.contains("DejaVu") && text.contains("Card artwork"),
        "has its license notices next to it",
    )
}

/// Clippy on `crate_name` with `features` alone, its default ones left out.
fn check_features(root: &Path, crate_name: &str, features: &str) -> Result<(), Failure> {
    println!("{crate_name}: {features}");
    clippy(
        root,
        &[
            "--quiet",
            "-p",
            crate_name,
            "--no-default-features",
            "--features",
            features,
        ],
    )
}

/// The features of `crate_name`, as its manifest lists them, but its default set.
fn units_of(root: &Path, crate_name: &str) -> Result<Vec<String>, Failure> {
    let manifest = read(root, &format!("crates/{crate_name}/Cargo.toml"))?;
    let section = manifest.split("\n[features]\n").nth(1).unwrap_or_default();
    let section = section.split("\n[").next().unwrap_or_default();
    Ok(section
        .lines()
        .filter(|line| !line.starts_with([' ', '#', ']']))
        .filter_map(|line| line.split_once('=').map(|(name, _)| name.trim().to_owned()))
        // any-coin is what every coin implies, which no build chooses on its own.
        .filter(|name| name != "default" && name != "any-coin")
        .collect())
}

/// Gate `features`: each unit of the library and the cards alone, none and all, then the tests
/// with what they leave out by default.
pub(crate) fn features(root: &Path) -> Result<(), Failure> {
    for crate_name in ["mnemocode", "mnemocode-cards"] {
        check_features(root, crate_name, "")?;
        let units = units_of(root, crate_name)?;
        for unit in &units {
            check_features(root, crate_name, unit)?;
        }
        check_features(root, crate_name, &units.join(","))?;
    }
    run_tool(
        root,
        "cargo",
        &[
            "test",
            "--locked",
            "--workspace",
            "--release",
            "--",
            "--include-ignored",
        ],
    )
}

/// The files that `checksums` lists, each with its hash; refused where a line is not of its form.
fn listed_files(checksums: &str) -> Result<Vec<(String, String)>, Failure> {
    checksums
        .lines()
        .map(|line| {
            let (hash, file) = line
                .split_once("  ")
                .filter(|(hash, file)| {
                    hash.len() == 64
                        && hash.bytes().all(|byte| byte.is_ascii_hexdigit())
                        && !file.starts_with(['-', '.'])
                        && !file.contains(['/', '\\'])
                })
                .ok_or_else(|| Failure(format!("{CHECKSUMS}: not <sha-256>  <file>: {line}")))?;
            Ok((file.to_owned(), hash.to_owned()))
        })
        .collect()
}

/// The most files that a draft may hold, and the largest: what `gh` then downloads.
const DRAFT_FILES_MAX: usize = 32;
const DRAFT_FILE_BYTES: u64 = 512 * 1024 * 1024;

/// Refuses a draft whose `assets`, one "<size> <name>" to a line, are too many or too large.
fn check_assets(assets: &str) -> Result<(), Failure> {
    let lines: Vec<&str> = assets.lines().filter(|line| !line.is_empty()).collect();
    if lines.len() > DRAFT_FILES_MAX {
        return Err(Failure(format!(
            "The draft holds {} files, more than the {DRAFT_FILES_MAX} of a release.",
            lines.len()
        )));
    }
    for line in lines {
        let size = line
            .split(' ')
            .next()
            .and_then(|size| size.parse::<u64>().ok());
        if size.is_none_or(|size| size > DRAFT_FILE_BYTES) {
            return Err(Failure(format!("A file of the draft is too large: {line}")));
        }
    }
    Ok(())
}

/// Checks the files of a draft of `version` in `folder` against its SHA256SUMS: each listed once
/// and of that version, there with its hash, exactly the files of a release (release_files: no
/// executable, notice or archive missing, none added), and no file beyond them but an earlier run's
/// signature and key.
fn check_draft(folder: &Path, version: &str) -> Result<Vec<String>, Failure> {
    let listed = listed_files(&fs::read_to_string(folder.join(CHECKSUMS))?)?;
    let expected = release_files(version);
    for file in &expected {
        if !listed.iter().any(|(name, _)| name == file) {
            return Err(Failure(format!(
                "{CHECKSUMS} does not list {file}: the draft is incomplete."
            )));
        }
    }
    if let Some((extra, _)) = listed.iter().find(|(name, _)| !expected.contains(name)) {
        return Err(Failure(format!(
            "{CHECKSUMS} lists {extra}, which is no file of a release."
        )));
    }
    let prefix = format!("mnemocode-{version}-");
    for (place, (file, hash)) in listed.iter().enumerate() {
        if !file.starts_with(&prefix) {
            return Err(Failure(format!(
                "{CHECKSUMS} lists {file}, which is no file of version {version}."
            )));
        }
        if listed[..place].iter().any(|(earlier, _)| earlier == file) {
            return Err(Failure(format!("{CHECKSUMS} lists {file} twice.")));
        }
        if sha256(&fs::read(folder.join(file))?) != *hash {
            return Err(Failure(format!(
                "{file}: the download differs from {CHECKSUMS}."
            )));
        }
    }
    for entry in fs::read_dir(folder)? {
        let name = entry?.file_name().to_string_lossy().into_owned();
        let known = [CHECKSUMS, SIGNATURE, PUBLIC_KEY].contains(&name.as_str())
            || listed.iter().any(|(file, _)| *file == name);
        if !known {
            return Err(Failure(format!(
                "The draft holds {name}, which {CHECKSUMS} does not list."
            )));
        }
    }
    Ok(listed.into_iter().map(|(file, _)| file).collect())
}

/// The arguments of `gh` that verify the build attestation of `file`: made by the release workflow
/// of the repository, on GitHub's runners, for `tag` at `commit`.
fn attestation_args(file: &str, tag: &str, commit: &str) -> Vec<String> {
    vec![
        "attestation".to_owned(),
        "verify".to_owned(),
        file.to_owned(),
        "--repo".to_owned(),
        REPOSITORY.to_owned(),
        "--signer-workflow".to_owned(),
        format!("{REPOSITORY}/.github/workflows/release.yml"),
        "--source-ref".to_owned(),
        format!("refs/tags/{tag}"),
        "--source-digest".to_owned(),
        commit.to_owned(),
        "--deny-self-hosted-runners".to_owned(),
    ]
}

/// Whether `tag` has the form of a release tag: "v" and a version of three numbers.
fn is_release_tag(tag: &str) -> bool {
    let parts: Vec<&str> = tag
        .strip_prefix('v')
        .unwrap_or_default()
        .split('.')
        .collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
}

/// Checks that every file of the draft in `folder` and its SHA256SUMS were built by the release
/// workflow for `tag` at the commit the tag names here, which GitHub's tag must name too.
fn check_provenance(
    root: &Path,
    folder: &Path,
    tag: &str,
    files: &[String],
) -> Result<(), Failure> {
    let commit = output_of(
        root,
        "git",
        &["rev-parse", "--verify", &format!("{tag}^{{commit}}")],
    )?;
    let commit = commit.trim();
    let remote = output_of(
        root,
        "gh",
        &[
            "api",
            &format!("repos/{REPOSITORY}/commits/{tag}"),
            "--jq",
            ".sha",
        ],
    )?;
    if remote.trim() != commit {
        return Err(Failure(format!(
            "GitHub's {tag} names {}, the tag here {commit}.",
            remote.trim()
        )));
    }
    for file in files.iter().map(String::as_str).chain([CHECKSUMS]) {
        let args = attestation_args(file, tag, commit);
        run_tool(
            folder,
            "gh",
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
        )?;
    }
    Ok(())
}

/// Signs the draft release of `tag` on the owner's computer, so that the OpenPGP key never enters
/// GitHub Actions: downloads it into a new folder, checks every file against SHA256SUMS and its
/// build attestation, signs SHA256SUMS with the release key, checks the signature, uploads it with
/// the public key and, with `publish`, publishes the release. GnuPG makes the signature and asks
/// for the passphrase: this task never reads a private key.
pub(crate) fn sign(root: &Path, tag: &str, publish: bool) -> Result<(), Failure> {
    if !is_release_tag(tag) {
        return Err(Failure(format!("{tag} is no release tag.")));
    }
    run_tool(root, "gpg", &["--batch", "--list-secret-keys", SIGNING_KEY])?;
    let folder_name = format!("release-signing-{tag}");
    let folder: PathBuf = root.join(&folder_name);
    if folder.exists() {
        return Err(Failure(format!(
            "{folder_name}/ exists already; move it away or remove it, then run again."
        )));
    }
    let drafts = output_of(
        root,
        "gh",
        &[
            "api",
            "--paginate",
            &format!("repos/{REPOSITORY}/releases"),
            "--jq",
            &format!(".[] | select(.tag_name == \"{tag}\") | .draft"),
        ],
    )?;
    if drafts.trim() != "true" {
        return Err(Failure(format!(
            "{tag} must have one draft and no published release; GitHub lists: {}",
            drafts.split_whitespace().collect::<Vec<_>>().join(" ")
        )));
    }
    check_assets(&output_of(
        root,
        "gh",
        &[
            "api",
            "--paginate",
            &format!("repos/{REPOSITORY}/releases"),
            "--jq",
            &format!(".[] | select(.tag_name == \"{tag}\") | .assets[] | \"\\(.size) \\(.name)\""),
        ],
    )?)?;
    run_tool(
        root,
        "gh",
        &[
            "release",
            "download",
            tag,
            "--repo",
            REPOSITORY,
            "--dir",
            &folder_name,
        ],
    )?;
    let files = check_draft(&folder, tag.trim_start_matches('v'))?;
    check_provenance(root, &folder, tag, &files)?;
    run_tool(
        &folder,
        "gpg",
        // GnuPG asks for the passphrase in this terminal itself: a pinentry that the agent starts
        // knows no terminal unless GPG_TTY names it, and the signing then fails as cancelled.
        &[
            "--pinentry-mode",
            "loopback",
            "--yes",
            "--armor",
            "--local-user",
            SIGNING_KEY,
            "--output",
            SIGNATURE,
            "--detach-sign",
            CHECKSUMS,
        ],
    )?;
    let verified = Command::new("gpg")
        .args(["--status-fd", "1", "--verify", SIGNATURE, CHECKSUMS])
        .current_dir(&folder)
        .output()?;
    let status = String::from_utf8_lossy(&verified.stdout);
    if !verified.status.success() || !status.contains(&format!("VALIDSIG {SIGNING_KEY}")) {
        return Err(Failure(format!(
            "GnuPG did not confirm {SIGNATURE} as a signature by {SIGNING_KEY}."
        )));
    }
    run_tool(
        &folder,
        "gpg",
        &[
            "--yes",
            "--armor",
            "--output",
            PUBLIC_KEY,
            "--export",
            SIGNING_KEY,
        ],
    )?;
    run_tool(
        &folder,
        "gh",
        &[
            "release",
            "upload",
            tag,
            SIGNATURE,
            PUBLIC_KEY,
            "--repo",
            REPOSITORY,
            "--clobber",
        ],
    )?;
    if publish {
        run_tool(
            root,
            "gh",
            &[
                "release",
                "edit",
                tag,
                "--repo",
                REPOSITORY,
                "--draft=false",
            ],
        )?;
    }
    let mut said = format!("{tag}: {} files checked and signed", files.len());
    let _infallible = write!(said, "{}", if publish { ", published." } else { "." });
    println!("{said}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_checksum_line_names_a_plain_file() {
        let line = format!("{}  mnemocode-0.2.0-linux-x64", "0".repeat(64));
        assert_eq!(listed_files(&line).expect("a line").len(), 1);
        for bad in [
            "x  y".to_owned(),
            format!("{}  ../up", "0".repeat(64)),
            format!("{}  -option", "0".repeat(64)),
            format!("{}  .hidden", "0".repeat(64)),
        ] {
            assert!(listed_files(&bad).is_err(), "{bad}");
        }
    }

    /// A draft folder holding `files`, each with its line in SHA256SUMS; removed when dropped.
    struct Draft(PathBuf);
    impl Draft {
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for Draft {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn draft(files: &[String]) -> Draft {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let folder =
            std::env::temp_dir().join(format!("mnemocode-draft-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&folder);
        fs::create_dir_all(&folder).expect("a folder");
        let mut sums = String::new();
        for file in files {
            fs::write(folder.join(file), file.as_bytes()).expect("a file");
            sums.push_str(&checksum_line(file.as_bytes(), file));
        }
        fs::write(folder.join(CHECKSUMS), sums).expect("the checksums");
        Draft(folder)
    }

    // AUD-007-BLD001: a draft is signed only when it holds exactly the files of a release.
    #[test]
    fn a_draft_holds_exactly_the_files_of_a_release() {
        let files = release_files("0.2.0");
        assert_eq!(files.len(), 11);
        assert!(files.contains(&"mnemocode-0.2.0-win-x64.exe".to_owned()));
        assert!(files.contains(&"mnemocode-0.2.0-macos-arm64-licenses.txt".to_owned()));
        assert!(files.contains(&"mnemocode-0.2.0-wasm.tar".to_owned()));
        let complete = draft(&files);
        assert_eq!(
            check_draft(complete.path(), "0.2.0")
                .expect("complete")
                .len(),
            11
        );
        for missing in &files {
            let fewer: Vec<String> = files
                .iter()
                .filter(|file| *file != missing)
                .cloned()
                .collect();
            let error = check_draft(draft(&fewer).path(), "0.2.0").expect_err(missing);
            assert!(error.0.contains("incomplete"), "{}", error.0);
        }
        let mut more = files.clone();
        more.push("mnemocode-0.2.0-extra".to_owned());
        assert!(check_draft(draft(&more).path(), "0.2.0").is_err());
    }

    #[test]
    fn an_attestation_is_bound_to_the_workflow_the_tag_and_its_commit() {
        let args = attestation_args("SHA256SUMS", "v0.2.0", "abc123");
        let joined = args.join(" ");
        for part in [
            "attestation verify SHA256SUMS --repo hobby-eng/mnemocode",
            "--signer-workflow hobby-eng/mnemocode/.github/workflows/release.yml",
            "--source-ref refs/tags/v0.2.0",
            "--source-digest abc123",
            "--deny-self-hosted-runners",
        ] {
            assert!(joined.contains(part), "{joined}");
        }
    }

    // AUD-007-BLD003: the files the WebAssembly archive takes are in the repository.
    #[test]
    fn the_distribution_notices_exist() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("the workspace");
        for name in DISTRIBUTION_NOTICES {
            assert!(root.join(name).is_file(), "{name}");
        }
    }

    #[test]
    fn a_release_tag_is_v_and_three_numbers() {
        assert!(is_release_tag("v0.2.0"));
        for bad in ["0.2.0", "v0.2", "v0.2.x", "v0.2.0-rc1"] {
            assert!(!is_release_tag(bad), "{bad}");
        }
    }
}

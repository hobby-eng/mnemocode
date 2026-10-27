//! The deps part: each crate's direct and test dependencies against module-map.json, pinned exactly
//! (CORE-25); no refused crate in an artifact's resolve on any release target (RUST-10); the
//! bc-crypto stand-in and the vendored engine as recorded (CORE-47); the recorded vectors as their
//! PROVENANCE.json lists them (DOC-04).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use super::Problems;
use super::layers::names;
use crate::repository::{json, read, sha256, sha256_of};
use crate::{Failure, output_of};

/// The release targets of the executable, and the binding's (ARCHITECTURE.md §1).
pub(crate) const EXECUTABLE_TARGETS: [&str; 5] = [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-pc-windows-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
];
pub(crate) const WASM_TARGET: &str = "wasm32-unknown-unknown";

/// cargo metadata's JSON with `arguments`.
fn metadata(root: &Path, arguments: &[&str]) -> Result<Value, Failure> {
    let mut all = vec!["metadata", "--locked", "--format-version", "1"];
    all.extend_from_slice(arguments);
    let text = output_of(root, "cargo", &all)?;
    serde_json::from_str(&text).map_err(|error| Failure(format!("cargo metadata: {error}")))
}

/// The part.
pub(super) fn check(
    problems: &mut Problems,
    root: &Path,
    files: &[String],
    map: &Value,
) -> Result<(), Failure> {
    let data = metadata(root, &[])?;
    check_direct(problems, root, &data, map);
    let artifacts = EXECUTABLE_TARGETS
        .iter()
        .map(|target| (*target, "mnemocode-cli"))
        .chain([(WASM_TARGET, "mnemocode-wasm")]);
    let refused = names(map["refusedInTree"].get("crates"));
    for (target, start) in artifacts {
        let resolve = metadata(root, &["--all-features", "--filter-platform", target])?;
        let tree = reachable(&resolve, start);
        for name in &refused {
            if tree.contains(name) {
                problems.report(
                    "Cargo.lock",
                    1,
                    "RUST-10",
                    &format!("{name} is in the {target} tree of {start}"),
                );
            }
        }
    }
    check_lock_vendor_vectors(problems, root, files)
}

fn check_direct(problems: &mut Problems, root: &Path, data: &Value, map: &Value) {
    let members: BTreeSet<&str> = data["workspace_members"]
        .as_array()
        .map(|ids| ids.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let root_text = root.to_string_lossy();
    let packages = data["packages"].as_array().cloned().unwrap_or_default();
    for package in packages.iter().filter(|package| {
        package["id"]
            .as_str()
            .is_some_and(|id| members.contains(id))
    }) {
        let name = package["name"].as_str().unwrap_or_default();
        let manifest_path = package["manifest_path"].as_str().unwrap_or_default();
        let manifest = manifest_path
            .strip_prefix(root_text.as_ref())
            .unwrap_or(manifest_path)
            .trim_start_matches('/');
        let entry = &map["crates"][name];
        if entry.is_null() {
            problems.report(
                manifest,
                1,
                "CORE-25",
                &format!("{name} is not in module-map.json"),
            );
            continue;
        }
        for dependency in package["dependencies"].as_array().into_iter().flatten() {
            let dep = dependency["name"].as_str().unwrap_or_default();
            let where_ = dependency["target"].as_str().unwrap_or("all");
            match dependency["kind"].as_str() {
                Some("dev") => {
                    if !names(entry.get("devDependencies"))
                        .iter()
                        .any(|allowed| allowed == dep)
                    {
                        let message =
                            format!("{dep} is not a dev dependency module-map.json allows");
                        problems.report(manifest, 1, "CORE-25", &message);
                    }
                }
                Some(kind) => problems.report(
                    manifest,
                    1,
                    "CORE-25",
                    &format!("{dep} is a {kind} dependency"),
                ),
                None => {
                    if !names(entry["dependencies"].get(where_))
                        .iter()
                        .any(|allowed| allowed == dep)
                    {
                        let message = format!("{dep} ({where_}) is not allowed by module-map.json");
                        problems.report(manifest, 1, "CORE-25", &message);
                    }
                }
            }
            let local = dependency["path"]
                .as_str()
                .is_some_and(|path| path.starts_with(root_text.as_ref()));
            let requirement = dependency["req"].as_str().unwrap_or_default();
            if !local && !requirement.starts_with('=') {
                let message = format!("{dep} is not pinned exactly: {requirement}");
                problems.report(manifest, 1, "CORE-25", &message);
            }
        }
    }
}

/// The names of the packages reachable from the workspace member `start` through normal
/// dependencies in a resolve.
fn reachable(data: &Value, start: &str) -> BTreeSet<String> {
    let names: BTreeMap<&str, &str> = data["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|package| Some((package["id"].as_str()?, package["name"].as_str()?)))
        .collect();
    let nodes: BTreeMap<&str, &Value> = data["resolve"]["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|node| Some((node["id"].as_str()?, node)))
        .collect();
    let members = workspace_members(data);
    let mut queue: Vec<&str> = names
        .iter()
        .filter(|(id, name)| **name == start && members.contains(**id))
        .map(|(id, _)| *id)
        .collect();
    let mut seen = BTreeSet::new();
    while let Some(id) = queue.pop() {
        if !seen.insert(id) {
            continue;
        }
        for dep in nodes
            .get(id)
            .and_then(|node| node["deps"].as_array())
            .into_iter()
            .flatten()
        {
            let normal = dep["dep_kinds"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|kind| kind["kind"].is_null());
            if normal && let Some(package) = dep["pkg"].as_str() {
                queue.push(package);
            }
        }
    }
    seen.into_iter()
        .filter_map(|id| names.get(id).map(|name| (*name).to_owned()))
        .collect()
}

/// The workspace members of a resolve.
fn workspace_members(data: &Value) -> BTreeSet<&str> {
    data["workspace_members"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect()
}

/// Every file of `folder` (but `record`) against its SHA-256 in `hashes`, both ways.
fn check_hashes(
    problems: &mut Problems,
    root: &Path,
    present: &[&String],
    folder: &str,
    record: &str,
    hashes: &serde_json::Map<String, Value>,
    rule: &str,
) -> Result<(), Failure> {
    for path in present {
        let name = path.get(folder.len() + 1..).unwrap_or_default();
        match hashes.get(name).and_then(Value::as_str) {
            None => problems.report(path, 1, rule, &format!("not listed in {record}")),
            Some(expected) => {
                if sha256_of(root, path)? != expected {
                    problems.report(
                        path,
                        1,
                        rule,
                        &format!("differs from its SHA-256 in {record}"),
                    );
                }
            }
        }
    }
    for name in hashes.keys() {
        if !present
            .iter()
            .any(|path| path.as_str() == format!("{folder}/{name}"))
        {
            problems.report(record, 1, rule, &format!("{name} is missing"));
        }
    }
    Ok(())
}

/// The files under `folder`, `record` and any of `left_out` left out.
fn files_in<'a>(
    files: &'a [String],
    folder: &str,
    record: &str,
    left_out: &[&str],
) -> Vec<&'a String> {
    files
        .iter()
        .filter(|path| path.starts_with(&format!("{folder}/")) && *path != record)
        .filter(|path| !left_out.iter().any(|other| path.starts_with(other)))
        .collect()
}

fn check_lock_vendor_vectors(
    problems: &mut Problems,
    root: &Path,
    files: &[String],
) -> Result<(), Failure> {
    let lock = read(root, "Cargo.lock")?;
    let stand_in = lock
        .split("[[package]]\n")
        .find(|entry| entry.starts_with("name = \"bc-crypto\"\n"));
    if stand_in.is_none_or(|entry| entry.lines().any(|line| line.starts_with("source = "))) {
        let message = "bc-crypto must be the workspace stand-in, without a registry source";
        problems.report("Cargo.lock", 1, "CORE-47", message);
    }
    for upstream in files
        .iter()
        .filter(|path| path.starts_with("vendor/") && path.ends_with("/UPSTREAM.json"))
    {
        let folder = upstream.trim_end_matches("/UPSTREAM.json");
        if folder.contains('/') && folder.matches('/').count() == 1 {
            let record = json(root, upstream)?;
            let hashes = record["downstreamSourceSha256"]
                .as_object()
                .cloned()
                .unwrap_or_default();
            check_hashes(
                problems,
                root,
                &files_in(files, folder, upstream, &[]),
                folder,
                upstream,
                &hashes,
                "CORE-47",
            )?;
        }
    }
    let recorded = json(root, "vectors/ts-0.1.0/PROVENANCE.json")?;
    let record = "vectors/ts-0.1.0/PROVENANCE.json";
    let hashes = recorded["files"].as_object().cloned().unwrap_or_default();
    check_hashes(
        problems,
        root,
        &files_in(files, "vectors/ts-0.1.0", record, &[]),
        "vectors/ts-0.1.0",
        record,
        &hashes,
        "DOC-04",
    )?;
    check_recorders(problems, root, &recorded)?;
    let carried = json(root, "vectors/PROVENANCE.json")?;
    let own: serde_json::Map<String, Value> = carried["files"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(name, file)| (name.clone(), file["sha256"].clone()))
        .collect();
    let record = "vectors/PROVENANCE.json";
    check_hashes(
        problems,
        root,
        &files_in(files, "vectors", record, &["vectors/ts-0.1.0/"]),
        "vectors",
        record,
        &own,
        "DOC-04",
    )
}

/// The recorders' SHA-256 in the recording's provenance, `recorded`, against the TS repository
/// beside this one at the commit it names, both ways; said, not failed, where that repository is
/// not beside this one, as in CI.
fn check_recorders(problems: &mut Problems, root: &Path, recorded: &Value) -> Result<(), Failure> {
    const RECORD: &str = "vectors/ts-0.1.0/PROVENANCE.json";
    const FOLDER: &str = "scripts/rust-parity/";
    let own = root.canonicalize()?;
    let beside = ["mnemocode_typescript", "mnemocode"]
        .into_iter()
        .find_map(|name| {
            let folder = own.parent()?.join(name);
            (folder.join(".git").exists() && folder.canonicalize().ok()? != own).then_some(folder)
        });
    let Some(ts) = beside else {
        println!(
            "code-rules: the TS repository is not beside this one; its recorders are not checked here."
        );
        return Ok(());
    };
    let commit = recorded["commit"].as_str().unwrap_or_default();
    let listed = output_of(&ts, "git", &["ls-tree", "--name-only", commit, FOLDER])?;
    let names: BTreeSet<&str> = listed
        .lines()
        .filter_map(|line| line.strip_prefix(FOLDER))
        .collect();
    let hashes = recorded["recorders"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let keys: BTreeSet<&str> = hashes.keys().map(String::as_str).collect();
    if names != keys {
        problems.report(
            RECORD,
            1,
            "DOC-04",
            &format!("lists the recorders {keys:?}; the TS commit {commit} has {names:?}"),
        );
    }
    for name in names.intersection(&keys) {
        let text = output_of(&ts, "git", &["show", &format!("{commit}:{FOLDER}{name}")])?;
        if hashes[*name].as_str() != Some(sha256(text.as_bytes()).as_str()) {
            problems.report(
                RECORD,
                1,
                "DOC-04",
                &format!(
                    "the SHA-256 of the recorder {name} is not that of the TS commit {commit}"
                ),
            );
        }
    }
    Ok(())
}

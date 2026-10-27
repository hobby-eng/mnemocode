//! The WebAssembly file of each wallet-tools page (ADR 0007, ARCHITECTURE.md §9), from its profile
//! in wasm-profiles.json:
//!
//! - `wasm build [<edition>/<page>]` writes dist/wasm/<edition>/<page>/: mnemocode.wasm, its glue
//!   mnemocode.js with initSync only (the network loader and the asynchronous start removed, each
//!   found exactly once), mnemocode.d.ts, and modules.json with the version, the profile and the
//!   SHA-256 of each file. No directory of the builder's computer reaches the file: the repository,
//!   CARGO_HOME and RUSTUP_HOME are remapped to fixed names (mhfe's remap-builder-paths.sh).
//! - `wasm verify` checks every page's files: modules.json against the folder, no network code in
//!   the glue, no builder's directory in the WebAssembly, exactly the exports of the profile's
//!   modules as the glue exports them, each file started in wasmi, an interpreter of WebAssembly
//!   written in Rust, with every import it takes given by the glue and every export the glue reads
//!   present (the glue's JavaScript itself is read, not run: there is no JavaScript engine here),
//!   a test profile with the probe module, and that profile's checks (`probe`): the instance's
//!   memory holds no marker after the probe entries, and a refusal reaches the page as TS's kind
//!   of error with an enumerable, read-only code.

mod probe;

use std::fmt::Write as _;
use std::path::Path;
use std::process::Command;

use serde_json::Value;

use crate::code_rules::deps::WASM_TARGET;
use crate::repository::{read, sha256};
use crate::{Failure, output_of, report};

/// The wasm-bindgen that the glue's removals are written for.
const WASM_BINDGEN: &str = "wasm-bindgen 0.2.129";
const MANIFEST: &str = "modules.json";
/// Hex digits of the build id: 64 bits, enough to tell builds apart.
const BUILD_ID_DIGITS: usize = 16;
/// Code that could reach the network or load a file by URL: none may remain in a page's glue.
const NETWORK_CODE: [&str; 7] = [
    "fetch(",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "sendBeacon",
    "import.meta",
    "import(",
];
/// The release targets whose rustflags get the remapping, the computer's own among them.
const REMAPPED_TARGETS: [&str; 6] = [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "x86_64-pc-windows-gnu",
    "x86_64-apple-darwin",
    "aarch64-apple-darwin",
    "wasm32-unknown-unknown",
];

/// One page's profile: the binding's browser-* modules and the library's unit features.
#[derive(Clone, Debug)]
pub(crate) struct Profile {
    pub(crate) modules: Vec<String>,
    pub(crate) units: Vec<String>,
}

impl Profile {
    /// The cargo features: its modules as browser-<module>, then its units.
    pub(crate) fn features(&self) -> Vec<String> {
        self.modules
            .iter()
            .map(|module| format!("browser-{module}"))
            .chain(self.units.iter().cloned())
            .collect()
    }
}

/// An edition and a page: lower-case words joined by hyphens, one slash between them.
fn valid_name(name: &str) -> bool {
    let word = |part: &str| {
        !part.is_empty()
            && part.split('-').all(|piece| {
                !piece.is_empty()
                    && piece
                        .bytes()
                        .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
            })
    };
    matches!(name.split_once('/'), Some((edition, page)) if word(edition) && word(page))
}

fn strings(value: &Value) -> Option<Vec<String>> {
    value.as_array().map(|items| {
        items
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    })
}

/// Every profile of wasm-profiles.json, by name.
pub(crate) fn profiles(root: &Path) -> Result<Vec<(String, Profile)>, Failure> {
    let data = crate::repository::json(root, "wasm-profiles.json")?;
    let mut all = Vec::new();
    for (name, profile) in data["profiles"].as_object().into_iter().flatten() {
        if !valid_name(name) {
            return Err(Failure(format!(
                "wasm-profiles.json: bad profile name {name}"
            )));
        }
        let (Some(modules), Some(units)) =
            (strings(&profile["modules"]), strings(&profile["units"]))
        else {
            return Err(Failure(format!(
                "wasm-profiles.json: {name} needs modules and units"
            )));
        };
        all.push((name.clone(), Profile { modules, units }));
    }
    Ok(all)
}

/// The binding's browser-* features, as its manifest declares them.
pub(crate) fn binding_modules(root: &Path) -> Result<Vec<String>, Failure> {
    let manifest = read(root, "crates/mnemocode-wasm/Cargo.toml")?;
    let features = manifest.split("\n[features]\n").nth(1).unwrap_or_default();
    let features = features.split("\n[").next().unwrap_or_default();
    Ok(features
        .lines()
        .filter_map(|line| line.split_once('=').map(|(name, _)| name.trim()))
        .filter(|name| name.starts_with("browser-"))
        .map(str::to_owned)
        .collect())
}

/// The remapping flags for the builder's directories, refused where RUSTFLAGS would replace them.
fn remapped_rustflags(root: &Path) -> Result<Vec<(String, String)>, Failure> {
    if std::env::var_os("RUSTFLAGS").is_some()
        || std::env::var_os("CARGO_ENCODED_RUSTFLAGS").is_some()
    {
        return Err(Failure(
            "RUSTFLAGS or CARGO_ENCODED_RUSTFLAGS is set and would replace the remapping of the builder's directories; unset it for a release build".to_owned(),
        ));
    }
    let home = std::env::home_dir().unwrap_or_default();
    let cargo_home = std::env::var_os("CARGO_HOME").map_or_else(|| home.join(".cargo"), Into::into);
    let rustup_home =
        std::env::var_os("RUSTUP_HOME").map_or_else(|| home.join(".rustup"), Into::into);
    // rustc applies the last prefix that matches, so the repository comes first.
    let mut flags = String::new();
    for (directory, name) in [
        (root.to_path_buf(), "mnemocode"),
        (cargo_home, "cargo"),
        (rustup_home, "rustup"),
    ] {
        let text = directory.to_string_lossy().trim_end_matches('/').to_owned();
        if text.contains(char::is_whitespace) {
            return Err(Failure(format!(
                "Cannot remap a directory whose name has a space: {text}"
            )));
        }
        if !flags.is_empty() {
            flags.push(' ');
        }
        let _infallible = write!(flags, "--remap-path-prefix={text}={name}");
    }
    Ok(REMAPPED_TARGETS
        .iter()
        .map(|triple| {
            let variable = format!(
                "CARGO_TARGET_{}_RUSTFLAGS",
                triple.to_uppercase().replace('-', "_")
            );
            let current = std::env::var(&variable).unwrap_or_default();
            let value = if current.contains(&flags) {
                current
            } else if current.is_empty() {
                flags.clone()
            } else {
                format!("{current} {flags}")
            };
            (variable, value)
        })
        .collect())
}

/// Builds the file of the profile `name`.
pub(crate) fn build(root: &Path, name: &str) -> Result<(), Failure> {
    let profile = profiles(root)?
        .into_iter()
        .find(|(known, _)| known == name)
        .map(|(_, profile)| profile)
        .ok_or_else(|| Failure(format!("wasm-profiles.json has no profile {name}")))?;
    let found = output_of(root, "wasm-bindgen", &["--version"])?;
    if found.trim() != WASM_BINDGEN {
        return Err(Failure(format!(
            "Expected {WASM_BINDGEN}, found {}",
            found.trim()
        )));
    }
    let features = profile.features().join(",");
    let mut cargo = Command::new("cargo");
    cargo.current_dir(root).args([
        "rustc",
        "--locked",
        "--profile",
        "wasm",
        "-p",
        "mnemocode-wasm",
        "--lib",
        "--target",
        WASM_TARGET,
        "--no-default-features",
    ]);
    if !features.is_empty() {
        cargo.args(["--features", &features]);
    }
    cargo
        .args(["--crate-type", "cdylib"])
        .envs(remapped_rustflags(root)?);
    let status = cargo.status()?;
    if !status.success() {
        return Err(Failure(format!(
            "the WebAssembly of {name} did not build ({status})"
        )));
    }
    let metadata: Value = serde_json::from_str(&output_of(
        root,
        "cargo",
        &["metadata", "--locked", "--no-deps", "--format-version", "1"],
    )?)
    .map_err(|error| Failure(format!("cargo metadata: {error}")))?;
    let target = Path::new(metadata["target_directory"].as_str().unwrap_or("target")).to_path_buf();
    let out = root.join("dist/wasm").join(name);
    if out.exists() {
        std::fs::remove_dir_all(&out)?;
    }
    std::fs::create_dir_all(&out)?;
    let built = target.join(WASM_TARGET).join("wasm/mnemocode_wasm.wasm");
    let status = Command::new("wasm-bindgen")
        .arg(&built)
        .args(["--target", "web", "--out-name", "mnemocode", "--out-dir"])
        .arg(&out)
        .status()?;
    if !status.success() {
        return Err(Failure(format!(
            "wasm-bindgen failed for {name} ({status})"
        )));
    }
    let glue = out.join("mnemocode.js");
    let declarations = out.join("mnemocode.d.ts");
    std::fs::write(&glue, offline_glue(&std::fs::read_to_string(&glue)?)?)?;
    std::fs::write(
        &declarations,
        offline_declarations(&std::fs::read_to_string(&declarations)?)?,
    )?;
    // Nothing loads the file by the name wasm-bindgen gives it; its declarations are internals.
    std::fs::rename(out.join("mnemocode_bg.wasm"), out.join("mnemocode.wasm"))?;
    std::fs::remove_file(out.join("mnemocode_bg.wasm.d.ts"))?;
    write_manifest(root, &out, name, &profile)?;
    println!("Built dist/wasm/{name}");
    Ok(())
}

/// Builds every profile's file.
pub(crate) fn build_all(root: &Path) -> Result<(), Failure> {
    for (name, _) in profiles(root)? {
        build(root, &name)?;
    }
    Ok(())
}

/// `text` without the part from `start` up to, not including, `end`; each found exactly once.
fn remove_section(text: &str, start: &str, end: &str) -> Result<String, Failure> {
    let from = text
        .find(start)
        .filter(|&from| text.matches(start).count() == 1 && text[from..].contains(end));
    let Some(from) = from else {
        return Err(Failure(format!(
            "glue: \"{}\" up to \"{}\" not found exactly once",
            start.trim(),
            end.trim()
        )));
    };
    let to = from + start.len() + text[from + start.len()..].find(end).unwrap_or(0);
    Ok(format!("{}{}", &text[..from], &text[to..]))
}

/// `text` with `find`, which must occur exactly once, replaced.
fn replace_once(text: &str, find: &str, replacement: &str) -> Result<String, Failure> {
    if text.matches(find).count() != 1 {
        return Err(Failure(format!(
            "glue: \"{}\" not found exactly once",
            find.trim()
        )));
    }
    Ok(text.replacen(find, replacement, 1))
}

/// The glue without the network loader and the asynchronous start, keeping initSync.
fn offline_glue(glue: &str) -> Result<String, Failure> {
    let async_export = "\nexport { initSync, __wbg_init as default };";
    let mut text = remove_section(glue, "\nasync function __wbg_load", "\nfunction initSync")?;
    text = remove_section(&text, "\nasync function __wbg_init", async_export)?;
    text = replace_once(&text, async_export, "\nexport { initSync };")?;
    if text.contains("__wbg_init.__wbindgen_wasm_module = module;") {
        text = replace_once(
            &text,
            "__wbg_init.__wbindgen_wasm_module = module;",
            "initSync.__wbindgen_wasm_module = module;",
        )?;
    }
    if let Some(left) = network_code_in(&text) {
        return Err(Failure(format!("glue: network code left: {left}")));
    }
    let kept = functions_in(&text);
    if let Some(name) = functions_in(glue)
        .into_iter()
        .find(|name| !kept.contains(name) && names_word(&text, name))
    {
        return Err(Failure(format!(
            "glue: {name}, whose function was removed, is still referenced"
        )));
    }
    Ok(text)
}

/// Whether `character` may stand in a JavaScript name.
fn name_character(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '$'
}

/// The functions `text` declares: `function name(`, `async function name(` among them.
fn functions_in(text: &str) -> Vec<&str> {
    text.match_indices("function ")
        .filter_map(|(at, found)| {
            let rest = &text[at + found.len()..];
            let end = rest
                .find(|c: char| !name_character(c))
                .unwrap_or(rest.len());
            (end > 0).then(|| &rest[..end])
        })
        .collect()
}

/// Whether `text` names `name` as a word of its own.
fn names_word(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(at, _)| {
        let before = text[..at].chars().next_back();
        let after = text[at + name.len()..].chars().next();
        !before.is_some_and(name_character) && !after.is_some_and(name_character)
    })
}

/// The declarations without the documented asynchronous start, which ends the file.
fn offline_declarations(declarations: &str) -> Result<String, Failure> {
    let start = declarations
        .rfind("export default function __wbg_init")
        .ok_or_else(|| Failure("declarations: the asynchronous start was not found".to_owned()))?;
    let documentation = declarations[..start].rfind("\n/**").ok_or_else(|| {
        Failure("declarations: the asynchronous start's documentation was not found".to_owned())
    })?;
    let rest = declarations[start..].trim_end();
    if rest.lines().count() != 1 || !rest.ends_with(';') {
        return Err(Failure(
            "declarations: more follows the asynchronous start".to_owned(),
        ));
    }
    Ok(format!("{}\n", declarations[..documentation].trim_end()))
}

/// The first network code `text` holds, `fetch (` with a space included.
fn network_code_in(text: &str) -> Option<&'static str> {
    let squeezed: String = text
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .replace(" (", "(");
    NETWORK_CODE
        .into_iter()
        .find(|code| squeezed.contains(code))
}

/// The names of a page's files beside modules.json, sorted.
fn page_files(folder: &Path) -> Result<Vec<String>, Failure> {
    let mut names: Vec<String> = std::fs::read_dir(folder)?
        .filter_map(|entry| {
            entry
                .ok()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
        })
        .filter(|file| file != MANIFEST)
        .collect();
    names.sort();
    Ok(names)
}

/// modules.json beside a page's files: version, build id, profile and each file's SHA-256.
fn write_manifest(
    root: &Path,
    folder: &Path,
    name: &str,
    profile: &Profile,
) -> Result<(), Failure> {
    let workspace = read(root, "Cargo.toml")?;
    let version = workspace
        .split("[workspace.package]")
        .nth(1)
        .and_then(|section| {
            section
                .lines()
                .find_map(|line| line.strip_prefix("version = \""))
        })
        .and_then(|rest| rest.strip_suffix('"'))
        .ok_or_else(|| Failure("Cargo.toml: no workspace version".to_owned()))?;
    let mut files = serde_json::Map::new();
    let mut listing = String::new();
    for file in page_files(folder)? {
        let hash = sha256(&std::fs::read(folder.join(&file))?);
        let _infallible = writeln!(listing, "{hash}  {file}");
        files.insert(file, Value::from(hash));
    }
    let build_id: String = sha256(listing.as_bytes())
        .chars()
        .take(BUILD_ID_DIGITS)
        .collect();
    let manifest = serde_json::json!({
        "version": version,
        "buildId": build_id,
        "profile": name,
        "modules": profile.modules,
        "units": profile.units,
        "files": files,
    });
    let text =
        serde_json::to_string_pretty(&manifest).map_err(|error| Failure(error.to_string()))?;
    std::fs::write(folder.join(MANIFEST), format!("{text}\n"))?;
    Ok(())
}

/// The directories of this computer that no shipped file may name.
fn builder_directories(root: &Path) -> Vec<String> {
    let home = std::env::home_dir().map(|home| home.to_string_lossy().into_owned());
    [
        Some(root.to_string_lossy().into_owned()),
        std::env::var("CARGO_HOME").ok(),
        std::env::var("RUSTUP_HOME").ok(),
        home,
    ]
    .into_iter()
    .flatten()
    .map(|directory| directory.trim_end_matches('/').to_owned())
    .filter(|directory| !directory.is_empty())
    .collect()
}

/// The names the glue exports: each `export function`, `class`, `const`, `let` or `var`, the name
/// of each item of an `export { … }` list, after its `as` where it is renamed, and `default`.
fn exports_of(glue: &str) -> Vec<String> {
    let mut names = Vec::new();
    for list in glue.split("export {").skip(1) {
        let items = list.split('}').next().unwrap_or_default();
        for item in items.split(',') {
            let name = item.rsplit(" as ").next().unwrap_or_default().trim();
            if !name.is_empty() {
                names.push(name.to_owned());
            }
        }
    }
    for line in glue.lines() {
        let Some(rest) = line.trim_start().strip_prefix("export ") else {
            continue;
        };
        if rest.starts_with("default") {
            names.push("default".to_owned());
            continue;
        }
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        let declared = [
            "function* ",
            "function ",
            "class ",
            "const ",
            "let ",
            "var ",
        ]
        .iter()
        .find_map(|keyword| rest.strip_prefix(keyword));
        if let Some(name) = declared
            .and_then(|rest| {
                rest.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
                    .next()
            })
            .filter(|name| !name.is_empty())
        {
            names.push(name.to_owned());
        }
    }
    names.sort();
    names
}

/// The names the glue reads from the instance's exports: `wasm.<name>`.
fn wasm_names_in(glue: &str) -> Vec<&str> {
    glue.match_indices("wasm.")
        .filter(|(at, _)| {
            glue[..*at].chars().next_back().is_none_or(|before| {
                !before.is_alphanumeric() && before != '_' && before != '$' && before != '.'
            })
        })
        .filter_map(|(at, found)| {
            let rest = &glue[at + found.len()..];
            let end = rest
                .find(|c: char| !c.is_alphanumeric() && c != '_' && c != '$')
                .unwrap_or(rest.len());
            (end > 0).then(|| &rest[..end])
        })
        .collect()
}

/// What `initSync` would meet in a page, checked in wasmi without a JavaScript engine: an import
/// of the file that the glue does not give, an export the glue reads that the file lacks, and a
/// start that traps. Each import is a stub that traps, so a start that calls the page fails too.
fn instance_problems(bytes: &[u8], glue: &str) -> Result<Vec<String>, Failure> {
    let wasm_error = |error: wasmi::Error| Failure(format!("wasmi: {error}"));
    let engine = wasmi::Engine::default();
    let module = wasmi::Module::new(&engine, bytes).map_err(wasm_error)?;
    let mut problems = Vec::new();
    let mut linker = wasmi::Linker::<()>::new(&engine);
    for import in module.imports() {
        let (namespace, name) = (import.module().to_owned(), import.name().to_owned());
        if !glue.contains(&format!("{name}: function(")) {
            problems.push(format!("the glue gives no import {namespace}.{name}"));
        }
        let wasmi::ExternType::Func(ty) = import.ty() else {
            problems.push(format!(
                "{namespace}.{name} is no function the glue can give"
            ));
            continue;
        };
        let called = format!("{namespace}.{name} was called while the file started");
        linker
            .func_new(&namespace, &name, ty.clone(), move |_, _, _| {
                Err(wasmi::Error::new(called.clone()))
            })
            .map_err(|error| Failure(format!("wasmi: {error}")))?;
    }
    for name in wasm_names_in(glue) {
        if module.get_export(name).is_none() {
            problems.push(format!(
                "the glue reads wasm.{name}, which the file does not export"
            ));
        }
    }
    let mut store = wasmi::Store::new(&engine, ());
    match linker.instantiate_and_start(&mut store, &module) {
        Err(error) => problems.push(format!("the file does not start in wasmi: {error}")),
        Ok(instance) => {
            if let Ok(start) = instance.get_typed_func::<(), ()>(&store, "__wbindgen_start")
                && let Err(error) = start.call(&mut store, ())
            {
                problems.push(format!("__wbindgen_start traps: {error}"));
            }
        }
    }
    Ok(problems)
}

/// Checks one profile's folder.
fn verify_profile(
    root: &Path,
    name: &str,
    profile: &Profile,
    exports: &Value,
    problems: &mut Vec<String>,
) -> Result<(), Failure> {
    let folder = root.join("dist/wasm").join(name);
    let manifest: Value = serde_json::from_str(&std::fs::read_to_string(folder.join(MANIFEST))?)
        .map_err(|error| Failure(format!("{name}: {MANIFEST}: {error}")))?;
    let files = page_files(&folder)?;
    let listed: Vec<String> = manifest["files"]
        .as_object()
        .map(|map| map.keys().cloned().collect())
        .unwrap_or_default();
    if listed != files {
        problems.push(format!(
            "{name}: modules.json lists {listed:?}, the folder {files:?}"
        ));
    }
    for file in &files {
        if manifest["files"][file].as_str()
            != Some(sha256(&std::fs::read(folder.join(file))?).as_str())
        {
            problems.push(format!(
                "{name}: {file} differs from its SHA-256 in modules.json"
            ));
        }
    }
    if manifest["profile"].as_str() != Some(name) {
        problems.push(format!(
            "{name}: modules.json names {}",
            manifest["profile"]
        ));
    }
    let glue = std::fs::read_to_string(folder.join("mnemocode.js"))?;
    if let Some(code) = network_code_in(&glue) {
        problems.push(format!("{name}: the glue holds network code ({code})"));
    }
    let bytes = std::fs::read(folder.join("mnemocode.wasm"))?;
    for directory in builder_directories(root) {
        if bytes
            .windows(directory.len())
            .any(|window| window == directory.as_bytes())
        {
            problems.push(format!(
                "{name}: mnemocode.wasm names the builder directory {directory}"
            ));
        }
    }
    let mut expected: Vec<String> = profile
        .modules
        .iter()
        .flat_map(|module| strings(&exports[module.as_str()]).unwrap_or_default())
        .chain(["initSync".to_owned()])
        .collect();
    expected.sort();
    let found = exports_of(&glue);
    if found != expected {
        problems.push(format!(
            "{name}: exports {found:?}, its modules give {expected:?}"
        ));
    }
    let probe = profile.modules.iter().any(|module| module == "probe");
    if probe && !name.starts_with("test/") {
        problems.push(format!(
            "{name}: a page's file may not take the probe module"
        ));
    }
    for problem in instance_problems(&bytes, &glue)? {
        problems.push(format!("{name}: {problem}"));
    }
    if probe {
        for problem in probe::problems(&bytes, &glue)? {
            problems.push(format!("{name}: {problem}"));
        }
    }
    Ok(())
}

/// The gate's checks of every page's built files.
pub(crate) fn verify(root: &Path) -> Result<(), Failure> {
    let all = profiles(root)?;
    let exports = crate::repository::json(root, "wasm-profiles.json")?["exports"].clone();
    let mut problems = Vec::new();
    // The probe scan is the only check that the allocator and after_secret wipe anything until each
    // module's entries arrive: a test profile must take the probe module.
    let probed = all.iter().any(|(name, profile)| {
        name.starts_with("test/") && profile.modules.iter().any(|module| module == "probe")
    });
    if !probed {
        problems.push("no test profile takes the probe module (wasm-profiles.json)".to_owned());
    }
    for (name, profile) in &all {
        verify_profile(root, name, profile, &exports, &mut problems)?;
    }
    report(
        &problems,
        "wasm: the page files have problems",
        &format!("wasm: {} page files checked", all.len()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_names_are_an_edition_and_a_page() {
        assert!(valid_name("multi-chain/key-derivation"));
        assert!(!valid_name("multi-chain"));
        assert!(!valid_name("Multi/page"));
        assert!(!valid_name("a//b"));
    }

    #[test]
    fn every_export_of_the_glue_is_read() {
        let glue = "export function a(x) {}\nexport class B {}\nexport const C = Object.freeze({});\nexport let d;\nexport { e, f as g };\nexport { initSync, __wbg_init as default };\n";
        assert_eq!(
            exports_of(glue),
            ["B", "C", "a", "d", "default", "e", "g", "initSync"]
        );
    }

    #[test]
    fn the_glue_names_of_the_instance_are_read() {
        let glue = "const ret = wasm.probeFreed(ptr0, len0);\nwasm.__wbindgen_start();\ninitSync.__wbindgen_wasm_module = module;\nmywasm.x();\n";
        assert_eq!(wasm_names_in(glue), ["probeFreed", "__wbindgen_start"]);
        assert!(names_word("f(); g()", "g"));
        assert!(!names_word("gg()", "g"));
        assert_eq!(
            functions_in("async function __wbg_load(m) {}\nfunction initSync(module) {"),
            ["__wbg_load", "initSync"]
        );
    }

    #[test]
    fn network_code_is_found_with_spaces_too() {
        assert_eq!(network_code_in("const r = fetch (url);"), Some("fetch("));
        assert_eq!(network_code_in("export { initSync };"), None);
    }
}

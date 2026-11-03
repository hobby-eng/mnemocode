//! Gate `notices`: the Rust crates part of THIRD_PARTY_NOTICES.md, the licence of every crate that
//! the executable or a page's WebAssembly file ships, written or checked. mhfe's rules
//! (scripts/third-party-licenses.py):
//!
//! - The crates are the union of `cargo tree --locked --offline -e normal,no-proc-macro` for the
//!   executable on every release target and for the binding with each profile; build scripts,
//!   build dependencies, procedural macros and the workspace's own crates are left out, not the
//!   vendored SSKR engine. The texts come from the crates' sources in the local Cargo registry.
//! - The licence expression is read from the crate's manifest; "A/B" is the old "A OR B". Every
//!   part joined by AND is required; within one with alternatives joined by OR, MIT is used when it
//!   is offered, otherwise Apache-2.0, otherwise the only licence.
//! - The text is the crate's own licence file, unchanged but for LF line endings and no trailing
//!   blank space. A crate without one gets the standard text: for MIT the SPDX text with the
//!   holders from its `authors`, for CC0-1.0 the legal code another crate of the list ships.
//! - Crates with byte-identical texts share one text section.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde_json::Value;

use crate::code_rules::deps::{EXECUTABLE_TARGETS, WASM_TARGET};
use crate::wasm::{Profile, profiles};
use crate::{Failure, output_of};

const OUTPUT: &str = "THIRD_PARTY_NOTICES.md";
/// The hand-written notices come first; everything from this line on is generated.
const MARKER: &str = "<!-- Everything below is written by `cargo xtask notices` from Cargo.lock and the crates' own licence files; do not edit it by hand. -->";
/// The workspace's own crates, which are MnemoCode itself.
const OWN: [&str; 7] = [
    "mnemocode",
    "mnemocode-cards",
    "mnemocode-embroidery",
    "mnemocode-cli",
    "mnemocode-wasm",
    "bc-crypto",
    "xtask",
];
/// Licence file names to look for, per licence, before the generic names.
const FILE_NAMES: [(&str, &[&str]); 6] = [
    (
        "MIT",
        &[
            "LICENSE-MIT",
            "LICENSE-MIT.md",
            "LICENSE-MIT.txt",
            "license-mit",
            "LICENSE.MIT",
        ],
    ),
    (
        "Apache-2.0",
        &[
            "LICENSE-APACHE",
            "LICENSE-APACHE.md",
            "LICENSE-APACHE.txt",
            "license-apache-2.0",
            "LICENSE-APACHE-2.0",
        ],
    ),
    ("IJG", &["LICENSE-IJG"]),
    ("ISC", &["LICENSE-ISC"]),
    ("Unicode-3.0", &["LICENSE-UNICODE"]),
    ("Zlib", &["LICENSE-ZLIB", "LICENSE-ZLIB.md"]),
];
const GENERIC_NAMES: [&str; 5] = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "COPYING"];
/// A phrase every text of the licence contains, so that no other licence's file is copied.
const MARKERS: [(&str, &str); 10] = [
    ("IJG", "Independent JPEG Group"),
    ("MIT", "Permission is hereby granted, free of charge"),
    ("Apache-2.0", "Apache License"),
    (
        "BSD-2-Clause",
        "Redistribution and use in source and binary forms",
    ),
    (
        "BSD-2-Clause-Patent",
        "Redistribution and use in source and binary forms",
    ),
    (
        "BSD-3-Clause",
        "Redistribution and use in source and binary forms",
    ),
    ("CC0-1.0", "CC0 1.0 Universal"),
    (
        "ISC",
        "Permission to use, copy, modify, and/or distribute this software for",
    ),
    ("Unicode-3.0", "UNICODE LICENSE V3"),
    (
        "Zlib",
        "This notice may not be removed or altered from any source distribution",
    ),
];
/// The SPDX MIT text with the year left out; {holders} comes from the crate's `authors`.
const SPDX_MIT: &str = "MIT License\n\nCopyright (c) {holders}\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the \"Software\"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.";

/// A shipped crate: its name, its version, its licence expression and the licences it is used under.
type Shipped = (String, String, String, Vec<Licence>);

/// One licence a crate is used under: its name, its text and a note where the text is standard.
struct Licence {
    name: String,
    text: Option<String>,
    note: Option<&'static str>,
}

/// "name version" of every crate compiled into a release, the workspace's own left out.
fn shipped_crates(root: &Path) -> Result<BTreeSet<(String, String)>, Failure> {
    let mut trees: Vec<(&str, &str, Vec<String>)> = EXECUTABLE_TARGETS
        .iter()
        .map(|target| ("mnemocode-cli", *target, Vec::new()))
        .collect();
    for (_, profile) in profiles(root)? {
        let features = Profile::features(&profile);
        let mut arguments = vec!["--no-default-features".to_owned()];
        if !features.is_empty() {
            arguments.push("--features".to_owned());
            arguments.push(features.join(","));
        }
        trees.push(("mnemocode-wasm", WASM_TARGET, arguments));
    }
    let mut crates = BTreeSet::new();
    for (package, target, features) in trees {
        let mut arguments = vec![
            "tree",
            "--locked",
            "--offline",
            "-p",
            package,
            "-e",
            "normal,no-proc-macro",
            "--target",
            target,
            "--prefix",
            "none",
            "--format",
            "{p}",
        ];
        arguments.extend(features.iter().map(String::as_str));
        for line in output_of(root, "cargo", &arguments)?.lines() {
            let mut words = line.split_whitespace();
            if let (Some(name), Some(version)) = (words.next(), words.next())
                && let Some(version) = version.strip_prefix('v')
                && !OWN.contains(&name)
            {
                crates.insert((name.to_owned(), version.to_owned()));
            }
        }
    }
    Ok(crates)
}

/// The alternatives of each part joined by AND.
fn licence_parts(expression: &str) -> Result<Vec<Vec<String>>, Failure> {
    expression
        .replace('/', " OR ")
        .split(" AND ")
        .map(|part| {
            let bare = part.trim().trim_start_matches('(').trim_end_matches(')');
            let alternatives: Vec<String> = bare
                .split(" OR ")
                .map(|alternative| alternative.trim().to_owned())
                .collect();
            let plain = alternatives.iter().all(|name| {
                !name.is_empty()
                    && name
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || "+.-".contains(c))
            });
            if plain {
                Ok(alternatives)
            } else {
                Err(Failure(format!(
                    "licence expression \"{expression}\" is not a plain AND of ORs"
                )))
            }
        })
        .collect()
}

fn choose(alternatives: &[String]) -> Result<String, Failure> {
    for preferred in ["MIT", "Apache-2.0"] {
        if alternatives.iter().any(|name| name == preferred) {
            return Ok(preferred.to_owned());
        }
    }
    match alternatives {
        [only] => Ok(only.clone()),
        _ => Err(Failure(format!(
            "no rule chooses between {}",
            alternatives.join(" OR ")
        ))),
    }
}

/// The text of the crate's own file for `licence`, or none.
fn licence_file_text(directory: &Path, licence: &str) -> Result<Option<String>, Failure> {
    let marker = MARKERS
        .iter()
        .find(|(name, _)| *name == licence)
        .map(|(_, marker)| *marker)
        .ok_or_else(|| Failure(format!("no marker phrase is known for {licence}")))?;
    let own = FILE_NAMES
        .iter()
        .find(|(name, _)| *name == licence)
        .map_or(&[][..], |(_, names)| *names);
    for name in own.iter().chain(GENERIC_NAMES.iter()) {
        if let Ok(text) = std::fs::read_to_string(directory.join(name)) {
            let text = text.replace("\r\n", "\n").trim_end().to_owned();
            if text.contains(marker) {
                return Ok(Some(text));
            }
        }
    }
    Ok(None)
}

/// The crates with the licences they are used under.
fn resolve(root: &Path) -> Result<Vec<Shipped>, Failure> {
    let metadata: Value = serde_json::from_str(&output_of(
        root,
        "cargo",
        &[
            "metadata",
            "--locked",
            "--offline",
            "--all-features",
            "--format-version",
            "1",
        ],
    )?)
    .map_err(|error| Failure(format!("cargo metadata: {error}")))?;
    let packages: BTreeMap<(String, String), &Value> = metadata["packages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|package| {
            Some((
                (
                    package["name"].as_str()?.to_owned(),
                    package["version"].as_str()?.to_owned(),
                ),
                package,
            ))
        })
        .collect();
    let mut standard: BTreeMap<String, String> = BTreeMap::new();
    let mut resolved = Vec::new();
    for (name, version) in shipped_crates(root)? {
        let package = packages
            .get(&(name.clone(), version.clone()))
            .ok_or_else(|| Failure(format!("cargo metadata does not list {name} {version}")))?;
        let expression = package["license"]
            .as_str()
            .filter(|text| !text.is_empty())
            .ok_or_else(|| Failure(format!("{name} {version} declares no licence expression")))?;
        let directory = Path::new(package["manifest_path"].as_str().unwrap_or_default())
            .parent()
            .unwrap_or(Path::new("."))
            .to_path_buf();
        let mut licences = Vec::new();
        for alternatives in licence_parts(expression)? {
            let licence = choose(&alternatives)?;
            let mut text = licence_file_text(&directory, &licence)?;
            let mut note = None;
            if text.is_none() && licence == "MIT" {
                let holders: Vec<String> = package["authors"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(|author| {
                        author
                            .split('<')
                            .next()
                            .unwrap_or_default()
                            .trim()
                            .to_owned()
                    })
                    .filter(|author| !author.is_empty())
                    .collect();
                if holders.is_empty() {
                    return Err(Failure(format!(
                        "{name} ships no MIT text and names no authors"
                    )));
                }
                text = Some(SPDX_MIT.replace("{holders}", &holders.join(", ")));
                note = Some(
                    "The crate publishes no licence file. This is the standard SPDX MIT text with the copyright holders taken from the crate's `authors`.",
                );
            } else if text.is_none() && licence == "CC0-1.0" {
                note = Some(
                    "The crate publishes no licence file. This is the CC0 1.0 legal code as other crates in this list ship it.",
                );
            } else if text.is_none() {
                return Err(Failure(format!("{name} {version} ships no {licence} text")));
            }
            if let (None, Some(own)) = (note, &text)
                && licence == "CC0-1.0"
            {
                standard
                    .entry(licence.clone())
                    .or_insert_with(|| own.clone());
            }
            licences.push(Licence {
                name: licence,
                text,
                note,
            });
        }
        resolved.push((name, version, expression.to_owned(), licences));
    }
    for (name, version, _, licences) in &mut resolved {
        for licence in licences.iter_mut().filter(|licence| licence.text.is_none()) {
            let text = standard.get(&licence.name).ok_or_else(|| {
                Failure(format!(
                    "{name} {version}: no crate ships a {} text to use",
                    licence.name
                ))
            })?;
            licence.text = Some(text.clone());
        }
    }
    Ok(resolved)
}

/// A code fence longer than any run of backticks in the text.
fn fence(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat((longest + 1).max(3))
}

fn render(resolved: &[Shipped]) -> String {
    let mut numbers: Vec<((String, String), Vec<String>)> = Vec::new();
    let mut lines: Vec<String> = [
        MARKER, "", "## Rust crates", "",
        "The `mnemocode` executable and the WebAssembly file of each wallet-tools page are compiled from",
        "the Rust crates below. Each crate is listed with its licence expression, the licence MnemoCode",
        "uses it under and the text of that licence.", "", "### How the licence is chosen", "",
        "- The crates are those compiled into the executable for every release target (Linux, Windows and",
        "  macOS on x86-64, Linux and macOS on ARM64) and into the WebAssembly file of every page. Build",
        "  scripts and procedural macros, which run only while building, are left out. Not every crate is",
        "  in every file.",
        "- Every licence joined by AND is required and listed. Among licences joined by OR, MIT is used",
        "  when it is offered, otherwise Apache-2.0, otherwise the only licence.",
        "- The text is the crate's own licence file, unchanged, with its copyright lines. Where a crate",
        "  publishes no licence file, its entry says so and the standard text of its licence is used.",
        "", "### Crates", "",
    ]
    .iter()
    .map(|line| (*line).to_owned())
    .collect();
    for (name, version, expression, licences) in resolved {
        let mut texts = Vec::new();
        for licence in licences {
            let key = (
                licence.name.clone(),
                licence.text.clone().unwrap_or_default(),
            );
            let number = match numbers.iter().position(|(known, _)| *known == key) {
                Some(index) => index,
                None => {
                    numbers.push((key, Vec::new()));
                    numbers.len() - 1
                }
            };
            if let Some((_, users)) = numbers.get_mut(number) {
                users.push(format!("{name} {version}"));
            }
            texts.push(format!("[text {}](#text-{})", number + 1, number + 1));
        }
        let used: Vec<&str> = licences
            .iter()
            .map(|licence| licence.name.as_str())
            .collect();
        lines.push(format!(
            "- `{name}` {version}: `{expression}`, used under {}; {}.",
            used.join(" and "),
            texts.join(", ")
        ));
        for note in licences.iter().filter_map(|licence| licence.note) {
            lines.push(format!("  {note}"));
        }
    }
    lines.extend(["".to_owned(), "### Licence texts".to_owned(), String::new()]);
    for (index, ((licence, text), users)) in numbers.iter().enumerate() {
        let marker = fence(text);
        lines.push(format!("#### Text {}", index + 1));
        lines.push(String::new());
        lines.push(format!("{licence}, for {}.", users.join(", ")));
        lines.extend([
            String::new(),
            marker.clone(),
            text.clone(),
            marker,
            String::new(),
        ]);
    }
    lines.join("\n")
}

/// The gate: writes the generated part, or with `check` fails where the file is out of date.
pub(crate) fn run(root: &Path, check: bool) -> Result<(), Failure> {
    let generated = render(&resolve(root)?);
    let path = root.join(OUTPUT);
    let written = std::fs::read_to_string(&path).unwrap_or_default();
    let Some(at) = written.find(MARKER) else {
        return Err(Failure(format!(
            "{OUTPUT} lacks the line that starts the generated part:\n{MARKER}"
        )));
    };
    let content = format!("{}{generated}", written.get(..at).unwrap_or_default());
    if check {
        if written != content {
            return Err(Failure(format!(
                "{OUTPUT} is out of date; run cargo xtask notices."
            )));
        }
        println_ok(&format!("{OUTPUT} matches the shipped crates."));
        return Ok(());
    }
    std::fs::write(&path, content)?;
    println_ok(&format!("Wrote {OUTPUT}."));
    Ok(())
}

fn println_ok(text: &str) {
    crate::report(&[], "", text).unwrap_or(());
}

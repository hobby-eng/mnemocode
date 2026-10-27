//! The layers part (CORE-04, RUST-15): every module a file reaches against module-map.json, both
//! ways for the library's listed edges.

use std::collections::BTreeSet;

use serde_json::Value;

use super::{Problems, Source, module_path_of};

/// The names of a JSON array of strings; none for anything else.
pub(super) fn names(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The modules `module` of `crate_name` may use; `None` for every module.
fn allowed_for(crate_name: &str, entry: &Value, module: &str) -> Option<BTreeSet<String>> {
    if module == "lib" || module == "main" {
        return None;
    }
    let mut allowed = BTreeSet::from([module.to_owned()]);
    if crate_name == "mnemocode" {
        let listed = entry.get("modules").and_then(|modules| modules.get(module));
        if listed.and_then(Value::as_str) == Some("*") {
            return None;
        }
        let foundation = names(entry.get("foundation"));
        if !foundation.iter().any(|name| name == module) {
            allowed.extend(foundation);
        }
        allowed.extend(names(listed));
        return Some(allowed);
    }
    let order = names(entry.get("order"));
    if !order.is_empty() {
        let at = order.iter().position(|name| name == module).unwrap_or(0);
        allowed.extend(order.into_iter().take(at));
        return Some(allowed);
    }
    allowed.extend(names(
        entry.get("modules").and_then(|modules| modules.get(module)),
    ));
    Some(allowed)
}

/// Whether `module` is a module of `entry`.
fn known_module(crate_name: &str, entry: &Value, module: &str) -> bool {
    if module == "lib" || module == "main" {
        return true;
    }
    if crate_name == "mnemocode" {
        return names(entry.get("foundation"))
            .iter()
            .any(|name| name == module)
            || entry
                .get("modules")
                .and_then(|modules| modules.get(module))
                .is_some();
    }
    let order = names(entry.get("order"));
    if !order.is_empty() {
        return order.iter().any(|name| name == module);
    }
    entry
        .get("modules")
        .and_then(Value::as_object)
        .is_some_and(|modules| modules.contains_key(module))
}

/// The part over `sources`.
pub(super) fn check(problems: &mut Problems, sources: &[Source], map: &Value) {
    let crates = &map["crates"];
    let mut uses = BTreeSet::new();
    let mut existing = BTreeSet::new();
    for source in sources {
        let crate_name = source.crate_name;
        let Some(inside) = source
            .path
            .strip_prefix(&format!("{}/src/", source.crate_dir))
        else {
            continue;
        };
        if crate_name == "bc-crypto" || crate_name == "xtask" {
            continue;
        }
        let entry = &crates[crate_name];
        let path = module_path_of(&format!("src/{inside}"));
        let module = path
            .first()
            .cloned()
            .unwrap_or_else(|| inside.trim_end_matches(".rs").to_owned());
        if !known_module(crate_name, entry, &module) {
            problems.report(
                &source.path,
                1,
                "CORE-04",
                &format!("module {module} is not in module-map.json"),
            );
            continue;
        }
        if crate_name == "mnemocode" {
            existing.insert(module.clone());
        }
        for &(line, what) in &source.file.aliases {
            problems.report(
                &source.path,
                line,
                "CORE-04",
                &format!("{what} under another name hides its uses"),
            );
        }
        let may = allowed_for(crate_name, entry, &module);
        for (used, &line) in &source.file.crate_uses {
            if may.as_ref().is_some_and(|may| !may.contains(used)) {
                problems.report(
                    &source.path,
                    line,
                    "CORE-04",
                    &format!("{module} may not use crate::{used} (module-map.json)"),
                );
            }
            if crate_name == "mnemocode" {
                uses.insert(format!("{module}>{used}"));
            }
        }
        if crate_name == "mnemocode-cards" {
            let mut listed = Vec::new();
            for name in names(entry.get("library")) {
                if name == "foundation" {
                    listed.extend(names(crates["mnemocode"].get("foundation")));
                } else {
                    listed.push(name);
                }
            }
            if let Some(external) = source.file.external_uses.get("mnemocode") {
                for (used, &line) in external {
                    if !listed.contains(used) {
                        problems.report(
                            &source.path,
                            line,
                            "CORE-04",
                            &format!(
                                "the cards crate may not use mnemocode::{used} (module-map.json)"
                            ),
                        );
                    }
                }
            }
        }
    }
    let Some(modules) = crates["mnemocode"]
        .get("modules")
        .and_then(Value::as_object)
    else {
        return;
    };
    for (module, listed) in modules {
        if !existing.contains(module) || listed.as_str() == Some("*") {
            continue;
        }
        for target in names(Some(listed)) {
            if !uses.contains(&format!("{module}>{target}")) {
                problems.report(
                    "module-map.json",
                    1,
                    "CORE-04",
                    &format!("{module} lists {target}, which its code never uses"),
                );
            }
        }
    }
}

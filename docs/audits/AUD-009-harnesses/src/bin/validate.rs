//! Checks the audit JSON against the retained schema and the paired Markdown identifiers.
#[path = "../../../AUD-008-harnesses/src/bin/unique.rs"]
mod unique;
use serde_json::Value;
use std::{collections::BTreeSet, error::Error, fs, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn has_type(value: &Value, kind: &str) -> bool {
    match kind {
        "object" => value.is_object(),
        "array" => value.is_array(),
        "string" => value.is_string(),
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "integer" => value.is_i64() || value.is_u64(),
        "number" => value.is_number(),
        _ => false,
    }
}

/// The schema uses only these keywords; unfamiliar validation rules refuse validation.
fn validate(value: &Value, schema: &Value, root: &Value, at: &str) -> Result<()> {
    let object = schema.as_object().ok_or("schema is not an object")?;
    for (key, rule) in object {
        let valid = match key.as_str() {
            "$schema" | "$id" | "title" | "$defs" | "description" => true,
            "$ref" => {
                let pointer = rule
                    .as_str()
                    .and_then(|s| s.strip_prefix('#'))
                    .ok_or("external schema reference")?;
                validate(
                    value,
                    root.pointer(pointer).ok_or("missing schema reference")?,
                    root,
                    at,
                )?;
                true
            }
            "allOf" => {
                for part in rule.as_array().ok_or("allOf is not an array")? {
                    validate(value, part, root, at)?;
                }
                true
            }
            "type" => match rule {
                Value::String(kind) => has_type(value, kind),
                Value::Array(kinds) => kinds
                    .iter()
                    .any(|kind| kind.as_str().is_some_and(|kind| has_type(value, kind))),
                _ => false,
            },
            "required" => rule
                .as_array()
                .ok_or("bad required")?
                .iter()
                .all(|key| key.as_str().is_some_and(|key| value.get(key).is_some())),
            "properties" => {
                for (key, part) in rule.as_object().ok_or("bad properties")? {
                    if let Some(child) = value.get(key) {
                        validate(child, part, root, &format!("{at}/{key}"))?;
                    }
                }
                true
            }
            "items" => {
                if let Some(items) = value.as_array() {
                    for (index, child) in items.iter().enumerate() {
                        validate(child, rule, root, &format!("{at}/{index}"))?;
                    }
                }
                true
            }
            "const" => value == rule,
            "enum" => rule.as_array().ok_or("bad enum")?.contains(value),
            "pattern" => match value.as_str() {
                Some(text) => {
                    regex::Regex::new(rule.as_str().ok_or("bad pattern")?)?.is_match(text)
                }
                None => true,
            },
            "minLength" => value.as_str().is_none_or(|text| {
                text.chars().count() as u64 >= rule.as_u64().unwrap_or(u64::MAX)
            }),
            "minimum" => value
                .as_f64()
                .is_none_or(|number| number >= rule.as_f64().unwrap_or(f64::INFINITY)),
            _ => return Err(format!("unsupported schema keyword {key}").into()),
        };
        if !valid {
            return Err(format!("{at}: schema keyword {key} failed").into());
        }
    }
    Ok(())
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("usage: validate SCHEMA REPORT.json REPORT.md".into());
    }
    let schema = unique::read(&fs::read_to_string(&args[0])?)?;
    let text = fs::read_to_string(&args[1])?;
    let report = unique::read(&text)?;
    validate(&report, &schema, &schema, "$")?;
    let markdown = fs::read_to_string(&args[2])?;
    let id_pattern = regex::Regex::new(r"AUD-009-(?:SEC|FUN|API|BLD|DOC|UI|ARC)[0-9]{3,}")?;
    let mut json_ids = BTreeSet::new();
    for field in ["findings", "observations"] {
        for finding in report[field].as_array().ok_or("missing record array")? {
            let id = finding["id"].as_str().ok_or("missing id")?;
            if !json_ids.insert(id.to_owned()) {
                return Err("duplicate finding ID".into());
            }
            for reference in finding["evidence"]
                .as_array()
                .ok_or("evidence is not an array")?
            {
                let reference = reference.as_str().ok_or("non-string reference")?;
                if reference.starts_with("Local evidence:") {
                    continue;
                }
                let path = reference.split(':').next().ok_or("empty reference")?;
                if !Path::new(path).is_file() {
                    return Err(format!("missing evidence source: {path}").into());
                }
            }
        }
    }
    let markdown_ids: BTreeSet<String> = id_pattern
        .find_iter(&markdown)
        .map(|m| m.as_str().to_owned())
        .collect();
    if json_ids != markdown_ids {
        return Err("Markdown/JSON finding IDs differ".into());
    }
    for forbidden in ["/home/", "Europe/", "owner asked", "user requested"] {
        if text.contains(forbidden) || markdown.contains(forbidden) {
            return Err(format!("private attribution: {forbidden}").into());
        }
    }
    println!(
        "schema valid; no duplicate keys; {} record IDs agree; source references exist; privacy checks passed",
        json_ids.len()
    );
    Ok(())
}

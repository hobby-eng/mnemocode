//! Part refusals (CORE-23, ADR 0004): each code that a `Refusal` of the library, the cards, the
//! command line or the binding gives is one of TS's, as `vectors/ts-0.1.0/refusals-v1.json` lists
//! them, or the port's own, with its reason in module-map.json; and one code stands for one
//! condition, so two enums do not write it.

use std::collections::BTreeMap;

use serde_json::Value;
use syn::visit::{self, Visit};

use super::{Problems, Source};

/// What TS's catalogs hold, recorded.
const RECORDED: &str = include_str!("../../../vectors/ts-0.1.0/refusals-v1.json");

/// The code literals inside `fn code` of an `impl Refusal`.
struct Codes {
    in_code: bool,
    found: Vec<(String, usize)>,
}

impl<'ast> Visit<'ast> for Codes {
    fn visit_impl_item_fn(&mut self, item: &'ast syn::ImplItemFn) {
        self.in_code = item.sig.ident == "code";
        visit::visit_impl_item_fn(self, item);
        self.in_code = false;
    }

    fn visit_lit_str(&mut self, literal: &'ast syn::LitStr) {
        if self.in_code {
            self.found
                .push((literal.value(), literal.span().start().line));
        }
    }
}

/// The name of the type that `item` is for.
fn type_of(item: &syn::ItemImpl) -> String {
    match &*item.self_ty {
        syn::Type::Path(path) => path
            .path
            .segments
            .last()
            .map_or_else(String::new, |segment| segment.ident.to_string()),
        _ => String::new(),
    }
}

/// The `impl Refusal for` blocks of `file`.
struct Impls<'a> {
    source: &'a Source,
    codes: &'a mut BTreeMap<String, (String, String, usize)>,
    problems: &'a mut Problems,
    known: &'a [String],
}

impl<'ast> Visit<'ast> for Impls<'_> {
    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        let refusal = item.trait_.as_ref().is_some_and(|(path, _)| {
            path.segments
                .last()
                .is_some_and(|segment| segment.ident == "Refusal")
        });
        if !refusal {
            return;
        }
        let owner = type_of(item);
        let mut codes = Codes {
            in_code: false,
            found: Vec::new(),
        };
        visit::visit_item_impl(&mut codes, item);
        for (code, line) in codes.found {
            if !self.known.contains(&code) {
                self.problems.report(
                    &self.source.path,
                    line,
                    "CORE-23",
                    &format!("{code} is no code of TS and not the port's own (module-map.json)"),
                );
            }
            let at = (owner.clone(), self.source.path.clone(), line);
            if let Some((earlier, path, _)) = self.codes.insert(code.clone(), at)
                && earlier != owner
            {
                self.problems.report(
                    &self.source.path,
                    line,
                    "CORE-23",
                    &format!("{code} is written by {owner} and by {earlier} ({path})"),
                );
            }
        }
    }
}

/// The codes of `recorded`, and of `map`'s list of the port's own.
fn known_codes(recorded: &Value, map: &Value) -> Vec<String> {
    let listed = recorded["codes"].as_array().into_iter().flatten();
    let own = map["ownRefusalCodes"]
        .as_object()
        .into_iter()
        .flat_map(|codes| codes.keys());
    listed
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .chain(own.cloned())
        .collect()
}

/// The part.
pub(crate) fn check(problems: &mut Problems, sources: &[Source], map: &Value) {
    let recorded: Value = serde_json::from_str(RECORDED).unwrap_or_default();
    let known = known_codes(&recorded, map);
    let mut codes = BTreeMap::new();
    for source in sources {
        let inside = source
            .path
            .get(source.crate_dir.len()..)
            .unwrap_or_default();
        if !inside.starts_with("/src/") || source.crate_dir == "xtask" {
            continue;
        }
        if let Ok(file) = syn::parse_file(&source.text) {
            Impls {
                source,
                codes: &mut codes,
                problems: &mut *problems,
                known: &known,
            }
            .visit_file(&file);
        }
    }
}

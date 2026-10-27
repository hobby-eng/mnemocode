//! A Rust file read as far as the code rules need it, with syn's parser: its attributes and the
//! lint levels they set (those inside `cfg_attr` included), the top modules its `crate::`,
//! `super::` and `self::` paths reach (in `use` trees, in code and in macro tokens, `$crate::`
//! included), the uses of an outside crate, any other name for the crate root or a workspace crate
//! (a rename, or a glob of the root), its unit-test modules, its tests, the traits it declares and
//! implements, the `OsRng` it names, and its lines of code. Macro tokens are read for attributes,
//! tests and trait impls too, as rustc applies what a macro expands to. Comments and strings are
//! never taken for code.

use std::collections::{BTreeMap, BTreeSet};

use proc_macro2::{Delimiter, Span, TokenStream, TokenTree};
use syn::punctuated::Punctuated;
use syn::visit::{self, Visit};
use syn::{Attribute, ItemMod, Meta, Token, UseTree};

/// A lint level an attribute sets.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Levels {
    /// allow, expect, warn, deny or forbid.
    pub(crate) level: String,
    /// The lints, such as `clippy::disallowed_methods`.
    pub(crate) lints: Vec<String>,
}

/// One attribute.
#[derive(Clone, Debug)]
pub(crate) struct Attr {
    /// Its line.
    pub(crate) line: usize,
    /// An inner attribute of the file itself, at its top.
    pub(crate) at_top: bool,
    /// The lint levels it sets.
    pub(crate) levels: Vec<Levels>,
}

/// What the code rules read from one Rust file.
#[derive(Debug, Default)]
pub(crate) struct RustFile {
    pub(crate) attributes: Vec<Attr>,
    /// The top modules its crate-relative paths reach, each with the line of its first use.
    pub(crate) crate_uses: BTreeMap<String, usize>,
    /// The top modules of each outside crate it names, by crate.
    pub(crate) external_uses: BTreeMap<String, BTreeMap<String, usize>>,
    /// The lines where the crate root or a workspace crate gets another name, with which.
    pub(crate) aliases: Vec<(usize, &'static str)>,
    /// The lines of attributes in macro bodies that a macro's parameters build, whose lints the
    /// gate cannot read.
    pub(crate) built_attributes: Vec<usize>,
    /// The [first, last] lines of its unit-test modules.
    pub(crate) test_ranges: Vec<(usize, usize)>,
    /// The modules declared `#[cfg(test)] mod name;`.
    pub(crate) test_module_files: Vec<String>,
    /// Its `#[test]` functions, with their lines.
    pub(crate) tests: Vec<(String, usize)>,
    /// The traits it implements (`impl Trait for …`), with their lines.
    pub(crate) impls: Vec<(String, usize)>,
    /// The traits it declares.
    pub(crate) traits: Vec<String>,
    /// The lines where it names `OsRng`.
    pub(crate) os_rng: Vec<usize>,
}

impl RustFile {
    /// Whether `line` lies in a unit-test module.
    pub(crate) fn in_test(&self, line: usize) -> bool {
        self.test_ranges
            .iter()
            .any(|&(first, last)| line >= first && line <= last)
    }
}

/// The line of `span`.
fn line_of(span: Span) -> usize {
    span.start().line
}

/// `text`, the file at module path `module` (`[]` for a crate root), as the code rules read it;
/// `Err` with the parser's message where it is no Rust.
pub(crate) fn read(text: &str, module: &[String]) -> Result<RustFile, String> {
    let file = syn::parse_file(text)
        .map_err(|error| format!("{} at line {}", error, line_of(error.span())))?;
    let mut reader = Reader {
        found: RustFile::default(),
        module: module.to_vec(),
        nested: Vec::new(),
    };
    for attribute in &file.attrs {
        reader.attribute(attribute, true);
    }
    for item in &file.items {
        reader.visit_item(item);
    }
    Ok(reader.found)
}

struct Reader {
    found: RustFile,
    module: Vec<String>,
    nested: Vec<String>,
}

impl Reader {
    fn attribute(&mut self, attribute: &Attribute, at_top: bool) {
        let inner = matches!(attribute.style, syn::AttrStyle::Inner(_));
        let line = line_of(attribute.pound_token.spans[0]);
        let mut levels = Vec::new();
        levels_of(&attribute.meta, &mut levels);
        self.found.attributes.push(Attr {
            line,
            at_top: at_top && inner,
            levels,
        });
    }

    /// The module path where code now stands: the file's, then the inline modules around it.
    fn around(&self) -> Vec<String> {
        self.module.iter().chain(&self.nested).cloned().collect()
    }

    /// The module path a path of `segments` that starts at the crate's root, `self` or `super`
    /// stands at, and the segments after it; none for another path or one above the root.
    fn resolved<'s>(&self, segments: &'s [String]) -> Option<(Vec<String>, &'s [String])> {
        let around = self.around();
        match segments.first()?.as_str() {
            "crate" | "$crate" => Some((Vec::new(), segments.get(1..).unwrap_or_default())),
            // `self` stands here; each `super` after it, or at the start, goes one module up.
            "self" | "super" => {
                let rest = if segments[0] == "self" {
                    &segments[1..]
                } else {
                    segments
                };
                let ups = rest
                    .iter()
                    .take_while(|segment| *segment == "super")
                    .count();
                let base = around.get(..around.len().checked_sub(ups)?)?.to_vec();
                Some((base, rest.get(ups..).unwrap_or_default()))
            }
            _ => None,
        }
    }

    /// Whether `segments` name the crate root itself, a trailing `self` included.
    fn is_root(&self, segments: &[String]) -> bool {
        self.resolved(segments).is_some_and(|(base, rest)| {
            base.is_empty() && rest.iter().all(|segment| segment == "self")
        })
    }

    /// Records a path of `segments` that starts at the crate's root, `self` or `super`.
    fn crate_path(&mut self, segments: &[String], line: usize) {
        let Some((base, rest)) = self.resolved(segments) else {
            return;
        };
        let top = base.first().cloned().or_else(|| rest.first().cloned());
        if let Some(top) =
            top.filter(|name| !matches!(name.as_str(), "self" | "super" | "crate" | "*"))
        {
            self.found.crate_uses.entry(top).or_insert(line);
        }
    }

    fn external_path(&mut self, crate_name: &str, module: &str, line: usize) {
        if module == "self" {
            return;
        }
        self.found
            .external_uses
            .entry(crate_name.to_owned())
            .or_default()
            .entry(module.to_owned())
            .or_insert(line);
    }

    /// Every path a `use` tree names, `prefix` being the segments above it.
    fn use_tree(&mut self, tree: &UseTree, prefix: &mut Vec<String>, line: usize) {
        match tree {
            UseTree::Path(path) => {
                prefix.push(path.ident.to_string());
                self.use_tree(&path.tree, prefix, line);
                prefix.pop();
            }
            UseTree::Name(name) => self.use_leaf(prefix, &name.ident.to_string(), line),
            UseTree::Rename(rename) => {
                let name = rename.ident.to_string();
                let mut renamed = prefix.clone();
                renamed.push(name.clone());
                if self.is_root(&renamed) {
                    self.found.aliases.push((line, "the crate root"));
                } else if (prefix.is_empty() && WORKSPACE_CRATES.contains(&name.as_str()))
                    || (name == "self"
                        && prefix.len() == 1
                        && WORKSPACE_CRATES.contains(&prefix[0].as_str()))
                {
                    self.found.aliases.push((line, "a workspace crate"));
                }
                self.use_leaf(prefix, &name, line);
            }
            UseTree::Glob(_) => {
                // The crate root's own file may take all of it; any other module would reach
                // through it every module the map keeps from it.
                if !self.module.is_empty() && self.is_root(prefix) {
                    self.found.aliases.push((line, "the crate root"));
                }
                self.use_leaf(prefix, "*", line);
            }
            UseTree::Group(group) => {
                for item in &group.items {
                    self.use_tree(item, prefix, line);
                }
            }
        }
    }

    fn use_leaf(&mut self, prefix: &[String], name: &str, line: usize) {
        let mut segments = prefix.to_vec();
        segments.push(name.to_owned());
        self.segments(&segments, line);
    }

    /// A path of `segments`, wherever it stands.
    fn segments(&mut self, segments: &[String], line: usize) {
        match segments.first().map(String::as_str) {
            Some("crate" | "$crate" | "self" | "super") => self.crate_path(segments, line),
            Some(first) => {
                if let Some(module) = segments.get(1) {
                    self.external_path(first, module, line);
                }
            }
            None => {}
        }
    }

    /// Every path written in macro tokens, which syn does not parse: runs of names joined by `::`.
    fn tokens(&mut self, tokens: &TokenStream) {
        let trees: Vec<TokenTree> = tokens.clone().into_iter().collect();
        let mut index = 0;
        while let Some(tree) = trees.get(index) {
            match tree {
                TokenTree::Group(group) => self.tokens(&group.stream()),
                TokenTree::Ident(ident) => {
                    if ident == "OsRng" {
                        self.found.os_rng.push(line_of(ident.span()));
                    }
                    let dollar = index > 0
                        && matches!(trees.get(index - 1), Some(TokenTree::Punct(punct)) if punct.as_char() == '$');
                    let (segments, end) = path_at(&trees, index);
                    if segments.len() > 1 {
                        let mut segments = segments;
                        if dollar && segments.first().is_some_and(|first| first == "crate") {
                            segments[0] = "$crate".to_owned();
                        }
                        self.segments(&segments, line_of(ident.span()));
                        index = end;
                        continue;
                    }
                }
                TokenTree::Punct(punct) if punct.as_char() == '#' => {
                    self.macro_attribute(&trees, index);
                }
                TokenTree::Punct(_) | TokenTree::Literal(_) => {}
            }
            if let TokenTree::Ident(ident) = tree
                && ident == "impl"
                && let Some(name) = implemented_trait(&trees, index + 1)
            {
                self.found.impls.push((name, line_of(ident.span())));
            }
            index += 1;
        }
    }

    /// An attribute written in macro tokens at `index`, its `#`: its lint levels, and the test it
    /// marks.
    fn macro_attribute(&mut self, trees: &[TokenTree], index: usize) {
        let inner =
            matches!(trees.get(index + 1), Some(TokenTree::Punct(punct)) if punct.as_char() == '!');
        let at = if inner { index + 2 } else { index + 1 };
        let Some(TokenTree::Group(group)) = trees.get(at) else {
            return;
        };
        if group.delimiter() != Delimiter::Bracket {
            return;
        }
        // `#[$m]` alone forwards what the call gives, doc comments as a rule; a lint given to a
        // call is caught in the call's tokens (`lint_words`).
        let lint_attribute = matches!(group.stream().into_iter().next(),
            Some(TokenTree::Ident(ident)) if LINT_ATTRIBUTES.contains(&ident.to_string().as_str()));
        if lint_attribute && holds_dollar(&group.stream()) {
            self.found
                .built_attributes
                .push(line_of(trees[index].span()));
            return;
        }
        let Ok(meta) = syn::parse2::<Meta>(group.stream()) else {
            return;
        };
        let mut levels = Vec::new();
        levels_of(&meta, &mut levels);
        self.found.attributes.push(Attr {
            line: line_of(trees[index].span()),
            at_top: false,
            levels,
        });
        if meta.path().is_ident("test")
            && let Some((name, line)) = function_after(trees, at + 1)
        {
            self.found.tests.push((name, line));
        }
    }
}

/// The attributes that set lint levels, `cfg_attr` with them.
const LINT_ATTRIBUTES: [&str; 6] = ["allow", "expect", "warn", "deny", "forbid", "cfg_attr"];

/// The line of a lint attribute's words given to a macro outside an attribute, `allow(…)` and its
/// like, which the macro may make an attribute of; none where there are none.
fn lint_words(trees: &[TokenTree]) -> Option<usize> {
    let mut index = 0;
    while let Some(tree) = trees.get(index) {
        match tree {
            TokenTree::Punct(punct) if punct.as_char() == '#' => {
                let bang = matches!(trees.get(index + 1), Some(TokenTree::Punct(next)) if next.as_char() == '!');
                let at = if bang { index + 2 } else { index + 1 };
                if matches!(trees.get(at), Some(TokenTree::Group(group)) if group.delimiter() == Delimiter::Bracket)
                {
                    // An attribute: macro_attribute reads it.
                    index = at + 1;
                    continue;
                }
            }
            TokenTree::Group(group) => {
                let inner: Vec<TokenTree> = group.stream().into_iter().collect();
                if let Some(line) = lint_words(&inner) {
                    return Some(line);
                }
            }
            // A method or a path's function, `.expect(…)` or `input::warn(…)`, is no lint.
            TokenTree::Ident(ident)
                if LINT_ATTRIBUTES.contains(&ident.to_string().as_str())
                    && !matches!(index.checked_sub(1).and_then(|before| trees.get(before)), Some(TokenTree::Punct(punct)) if matches!(punct.as_char(), '.' | ':'))
                    && matches!(trees.get(index + 1), Some(TokenTree::Group(group)) if group.delimiter() == Delimiter::Parenthesis) =>
            {
                return Some(line_of(ident.span()));
            }
            _ => {}
        }
        index += 1;
    }
    None
}

/// Whether `tokens` hold a `$`, a macro's parameter, at any depth.
fn holds_dollar(tokens: &TokenStream) -> bool {
    tokens.clone().into_iter().any(|tree| match tree {
        TokenTree::Punct(punct) => punct.as_char() == '$',
        TokenTree::Group(group) => holds_dollar(&group.stream()),
        TokenTree::Ident(_) | TokenTree::Literal(_) => false,
    })
}

/// The crates of the workspace whose uses the module map limits.
const WORKSPACE_CRATES: [&str; 2] = ["mnemocode", "mnemocode_cards"];

/// The name and line of the function that the tokens from `start` declare, past its other
/// attributes and qualifiers; none where another item comes first.
fn function_after(trees: &[TokenTree], start: usize) -> Option<(String, usize)> {
    let mut index = start;
    while let Some(tree) = trees.get(index) {
        match tree {
            TokenTree::Ident(ident) if ident == "fn" => {
                let TokenTree::Ident(name) = trees.get(index + 1)? else {
                    return None;
                };
                return Some((name.to_string(), line_of(ident.span())));
            }
            TokenTree::Group(group) if group.delimiter() == Delimiter::Brace => return None,
            TokenTree::Punct(punct) if punct.as_char() == ';' => return None,
            _ => index += 1,
        }
    }
    None
}

/// The trait that the `impl` before `start` implements: the last name before its `for`, outside
/// angle brackets; none for an inherent impl.
fn implemented_trait(trees: &[TokenTree], start: usize) -> Option<String> {
    let mut depth = 0_usize;
    let mut last = None;
    for tree in trees.get(start..)? {
        match tree {
            TokenTree::Punct(punct) if punct.as_char() == '<' => depth += 1,
            TokenTree::Punct(punct) if punct.as_char() == '>' => depth = depth.saturating_sub(1),
            TokenTree::Punct(punct) if punct.as_char() == ';' => return None,
            TokenTree::Group(group) if group.delimiter() == Delimiter::Brace => return None,
            TokenTree::Ident(ident) if depth == 0 && ident == "for" => return last,
            TokenTree::Ident(ident) if depth == 0 => last = Some(ident.to_string()),
            _ => {}
        }
    }
    None
}

/// The names of a path that starts with the name at `start`, joined by `::`, and the index after
/// it.
fn path_at(trees: &[TokenTree], start: usize) -> (Vec<String>, usize) {
    let mut segments = Vec::new();
    let mut index = start;
    while let Some(TokenTree::Ident(ident)) = trees.get(index) {
        segments.push(ident.to_string());
        let colons = matches!(
            (trees.get(index + 1), trees.get(index + 2)),
            (Some(TokenTree::Punct(first)), Some(TokenTree::Punct(second)))
                if first.as_char() == ':' && second.as_char() == ':'
        );
        if !colons {
            return (segments, index + 1);
        }
        index += 3;
    }
    (segments, index)
}

/// The lint levels that `meta` sets, `cfg_attr`'s attributes included.
fn levels_of(meta: &Meta, levels: &mut Vec<Levels>) {
    let Meta::List(list) = meta else {
        return;
    };
    let Some(name) = list.path.get_ident().map(ToString::to_string) else {
        return;
    };
    let parsed = list.parse_args_with(Punctuated::<Meta, Token![,]>::parse_terminated);
    let Ok(items) = parsed else {
        return;
    };
    match name.as_str() {
        "allow" | "expect" | "warn" | "deny" | "forbid" => {
            let lints = items
                .iter()
                .filter_map(|item| match item {
                    Meta::Path(path) => Some(path_text(path)),
                    _ => None,
                })
                .collect();
            levels.push(Levels { level: name, lints });
        }
        "cfg_attr" => {
            for item in items.iter().skip(1) {
                levels_of(item, levels);
            }
        }
        _ => {}
    }
}

/// A path as it is written: `clippy::disallowed_methods`.
fn path_text(path: &syn::Path) -> String {
    path.segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}

/// Whether `attributes` hold `#[cfg(test)]` or `#[cfg(all(test, …))]`.
fn is_test_cfg(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        if !attribute.path().is_ident("cfg") {
            return false;
        }
        let Meta::List(list) = &attribute.meta else {
            return false;
        };
        let mut trees = list.tokens.clone().into_iter();
        match trees.next() {
            Some(TokenTree::Ident(ident)) if ident == "test" => trees.next().is_none(),
            Some(TokenTree::Ident(ident)) if ident == "all" => match trees.next() {
                Some(TokenTree::Group(group)) if group.delimiter() == Delimiter::Parenthesis => {
                    matches!(group.stream().into_iter().next(), Some(TokenTree::Ident(first)) if first == "test")
                }
                _ => false,
            },
            _ => false,
        }
    })
}

impl<'ast> Visit<'ast> for Reader {
    fn visit_attribute(&mut self, attribute: &'ast Attribute) {
        self.attribute(attribute, false);
        if let Meta::List(list) = &attribute.meta {
            self.tokens(&list.tokens);
        }
    }

    fn visit_item_mod(&mut self, item: &'ast ItemMod) {
        let test = is_test_cfg(&item.attrs);
        match &item.content {
            Some((brace, _)) => {
                if test {
                    let first = item
                        .attrs
                        .first()
                        .map_or(line_of(item.mod_token.span), |attribute| {
                            line_of(attribute.pound_token.spans[0])
                        });
                    self.found
                        .test_ranges
                        .push((first, brace.span.close().end().line));
                }
                self.nested.push(item.ident.to_string());
                visit::visit_item_mod(self, item);
                self.nested.pop();
            }
            None => {
                if test {
                    self.found.test_module_files.push(item.ident.to_string());
                }
                visit::visit_item_mod(self, item);
            }
        }
    }

    fn visit_item_use(&mut self, item: &'ast syn::ItemUse) {
        for attribute in &item.attrs {
            self.visit_attribute(attribute);
        }
        let line = line_of(item.use_token.span);
        self.use_tree(&item.tree, &mut Vec::new(), line);
    }

    fn visit_item_extern_crate(&mut self, item: &'ast syn::ItemExternCrate) {
        if item.rename.is_some() {
            let line = line_of(item.extern_token.span);
            if item.ident == "self" {
                self.found.aliases.push((line, "the crate root"));
            } else if WORKSPACE_CRATES.contains(&item.ident.to_string().as_str()) {
                self.found.aliases.push((line, "a workspace crate"));
            }
        }
        visit::visit_item_extern_crate(self, item);
    }

    fn visit_path(&mut self, path: &'ast syn::Path) {
        let segments: Vec<String> = path
            .segments
            .iter()
            .map(|segment| segment.ident.to_string())
            .collect();
        if let Some(first) = path.segments.first() {
            self.segments(&segments, line_of(first.ident.span()));
        }
        visit::visit_path(self, path);
    }

    fn visit_ident(&mut self, ident: &'ast proc_macro2::Ident) {
        if ident == "OsRng" {
            self.found.os_rng.push(line_of(ident.span()));
        }
    }

    fn visit_macro(&mut self, mac: &'ast syn::Macro) {
        visit::visit_macro(self, mac);
        self.tokens(&mac.tokens);
        let trees: Vec<TokenTree> = mac.tokens.clone().into_iter().collect();
        if let Some(line) = lint_words(&trees) {
            self.found.built_attributes.push(line);
        }
    }

    fn visit_item_fn(&mut self, item: &'ast syn::ItemFn) {
        if item
            .attrs
            .iter()
            .any(|attribute| attribute.path().is_ident("test"))
        {
            self.found
                .tests
                .push((item.sig.ident.to_string(), line_of(item.sig.fn_token.span)));
        }
        visit::visit_item_fn(self, item);
    }

    fn visit_item_impl(&mut self, item: &'ast syn::ItemImpl) {
        if let Some((path, _)) = &item.trait_
            && let Some(last) = path.segments.last()
        {
            self.found
                .impls
                .push((last.ident.to_string(), line_of(item.impl_token.span)));
        }
        visit::visit_item_impl(self, item);
    }

    fn visit_item_trait(&mut self, item: &'ast syn::ItemTrait) {
        self.found.traits.push(item.ident.to_string());
        visit::visit_item_trait(self, item);
    }
}

/// The lines of `text` that hold code, a Rust file's: every line a token of it covers, but doc
/// comments and the lines of unit-test modules (`test_ranges`).
pub(crate) fn code_lines(
    text: &str,
    test_ranges: &[(usize, usize)],
) -> Result<BTreeSet<usize>, String> {
    let tokens: TokenStream = text
        .parse()
        .map_err(|error: proc_macro2::LexError| error.to_string())?;
    let mut lines = BTreeSet::new();
    collect_lines(tokens, &mut lines);
    lines.retain(|line| {
        !test_ranges
            .iter()
            .any(|&(first, last)| *line >= first && *line <= last)
    });
    Ok(lines)
}

fn collect_lines(tokens: TokenStream, lines: &mut BTreeSet<usize>) {
    let trees: Vec<TokenTree> = tokens.into_iter().collect();
    let mut index = 0;
    while let Some(tree) = trees.get(index) {
        // A doc comment reaches the lexer as `#[doc = "…"]` (or `#![doc …]`): a comment.
        if let TokenTree::Punct(punct) = tree
            && punct.as_char() == '#'
        {
            let bang = matches!(trees.get(index + 1), Some(TokenTree::Punct(next)) if next.as_char() == '!');
            let group = trees.get(index + if bang { 2 } else { 1 });
            if let Some(TokenTree::Group(group)) = group
                && group.delimiter() == Delimiter::Bracket
                && matches!(group.stream().into_iter().next(), Some(TokenTree::Ident(ident)) if ident == "doc")
                && group.span().start().line == punct.span().start().line
                && is_doc_comment(group)
            {
                index += if bang { 3 } else { 2 };
                continue;
            }
        }
        match tree {
            TokenTree::Group(group) => {
                lines.insert(group.span_open().start().line);
                lines.insert(group.span_close().end().line);
                collect_lines(group.stream(), lines);
            }
            other => {
                let span = other.span();
                for line in span.start().line..=span.end().line {
                    lines.insert(line);
                }
            }
        }
        index += 1;
    }
}

/// Whether a `doc` attribute was a comment (`///`, `//!`, `/** */`) rather than written out: the
/// lexer gives a comment's attribute the comment's own span, which starts with a slash.
fn is_doc_comment(group: &proc_macro2::Group) -> bool {
    group
        .span()
        .source_text()
        .is_none_or(|text| text.starts_with('/'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn module(path: &[&str]) -> Vec<String> {
        path.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn crate_paths_reach_their_top_modules() {
        let text = "use crate::{refusal::Refusal, wallet};\nuse super::bip39::X;\nfn f() { crate::text::trim(); }\nmacro_rules! m { () => { $crate::dates::f() }; }\n";
        let file = read(text, &module(&["text"])).unwrap();
        let used: Vec<&str> = file.crate_uses.keys().map(String::as_str).collect();
        assert_eq!(used, vec!["bip39", "dates", "refusal", "text", "wallet"]);
    }

    #[test]
    fn lint_levels_are_read_inside_cfg_attr() {
        let text = "#![cfg_attr(all(), allow(unsafe_code, reason = \"x\"))]\n#[expect(clippy::disallowed_methods, reason = \"y\")]\nfn f() {}\n";
        let file = read(text, &[]).unwrap();
        assert_eq!(file.attributes.len(), 2);
        assert!(file.attributes[0].at_top);
        assert_eq!(file.attributes[0].levels[0].lints, vec!["unsafe_code"]);
        assert_eq!(file.attributes[1].levels[0].level, "expect");
        assert!(!file.attributes[1].at_top);
    }

    #[test]
    fn test_modules_and_doc_comments_are_not_code() {
        let text = "/// A doc.\nfn f() {}\n\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn one_two_three() {}\n}\n";
        let file = read(text, &[]).unwrap();
        assert_eq!(file.test_ranges, vec![(4, 8)]);
        assert_eq!(file.tests, vec![("one_two_three".to_owned(), 7)]);
        let lines = code_lines(text, &file.test_ranges).unwrap();
        assert_eq!(lines.into_iter().collect::<Vec<_>>(), vec![2]);
    }
}

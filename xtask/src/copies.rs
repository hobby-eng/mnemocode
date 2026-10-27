//! Gate `copies` (CORE-10): the same run of at least 50 tokens in two places of the repository's
//! Rust code (crates/, shims/, xtask/), whatever the white space, the line breaks and the comments,
//! read with the Rust lexer. A copy is reported as "file A:lines = file B:lines": the code belongs
//! in one function that both call. A deliberate copy says so in a comment that contains
//! "deliberate copy" inside the copied lines or the three lines above them, with its reason; it is
//! then not reported. `use` lists are left out: two files that use the same modules share no code.
//! Taken from mhfe, whose recipe is MnemoCode TS's scripts/verify-no-copies.mjs.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use proc_macro2::{Delimiter, LineColumn, TokenStream, TokenTree};

use crate::repository::{read, tracked_or_new};
use crate::{Failure, report};

/// The shortest run of tokens that counts as a copy, about four to six lines of code: jscpd's
/// default, below which the same few lines of ordinary code meet by chance.
const MIN_TOKENS: usize = 50;
/// The folders read.
const FOLDERS: [&str; 3] = ["crates/", "shims/", "xtask/"];
/// Lines above a copy in which its marker may stand.
const MARKER_LINES_ABOVE: usize = 3;

/// One token: its text, which two copies share, and its line.
#[derive(Clone, Debug)]
struct Token {
    key: String,
    line: usize,
}

/// One file's tokens, `use` lists and doc comments left out, and the lines that mark a copy.
struct Tokens {
    path: String,
    tokens: Vec<Token>,
    marked: BTreeSet<usize>,
}

/// The tokens of `text` (`flatten`), `use` lists left out, and the lines a copy marker stands on.
fn tokens_of(path: &str, text: &str) -> Result<Tokens, Failure> {
    let stream: TokenStream = text
        .parse()
        .map_err(|error: proc_macro2::LexError| Failure(format!("{path}: {error}")))?;
    let mut literals = Vec::new();
    let mut tokens = Vec::new();
    flatten(stream, &mut tokens, &mut literals);
    let marked = marker_lines(text, &literals);
    Ok(Tokens {
        path: path.to_owned(),
        tokens: without_use_lists(tokens),
        marked,
    })
}

/// The marker "deliberate copy" in a comment, line or block, and never inside a literal, so that
/// text in a string hides no copy.
fn marker_lines(text: &str, literals: &[(LineColumn, LineColumn)]) -> BTreeSet<usize> {
    const MARKER: &str = "deliberate copy";
    let mut marked = BTreeSet::new();
    let mut depth = 0_usize;
    for (index, line) in text.lines().enumerate() {
        let number = index + 1;
        let characters: Vec<char> = line.chars().collect();
        // Whether each character stands in a comment.
        let mut comment = vec![false; characters.len()];
        let mut column = 0;
        while column < characters.len() {
            let position = (number, column);
            if depth == 0
                && let Some((_, end)) = literals.iter().find(|(start, end)| {
                    (start.line, start.column) <= position && position < (end.line, end.column)
                })
            {
                column = if end.line == number {
                    end.column
                } else {
                    characters.len()
                };
                continue;
            }
            let pair = (characters[column], characters.get(column + 1).copied());
            match pair {
                ('/', Some('/')) if depth == 0 => {
                    comment[column..].fill(true);
                    break;
                }
                ('/', Some('*')) => {
                    depth += 1;
                    comment[column] = true;
                    comment[column + 1] = true;
                    column += 2;
                    continue;
                }
                ('*', Some('/')) if depth > 0 => {
                    depth -= 1;
                    comment[column] = true;
                    comment[column + 1] = true;
                    column += 2;
                    continue;
                }
                _ => comment[column] = depth > 0,
            }
            column += 1;
        }
        let lower: Vec<char> = line.to_lowercase().chars().collect();
        let marker: Vec<char> = MARKER.chars().collect();
        if lower.len() == characters.len()
            && lower
                .windows(marker.len())
                .enumerate()
                .any(|(at, window)| window == marker.as_slice() && comment[at])
        {
            marked.insert(number);
        }
    }
    marked
}

/// Whether `tree` and `next` are a doc comment as the lexer gives it: `#` and its bracket group.
fn is_doc(tree: &TokenTree, next: Option<&TokenTree>) -> bool {
    matches!((tree, next), (TokenTree::Punct(punct), Some(TokenTree::Group(group)))
        if punct.as_char() == '#'
            && group.delimiter() == Delimiter::Bracket
            && matches!(group.stream().into_iter().next(), Some(TokenTree::Ident(ident)) if ident == "doc"))
}

/// The tokens of `stream` into `tokens`, each group's delimiters as tokens of their own, doc
/// comments left out; where each literal begins and ends into `literals`.
fn flatten(
    stream: TokenStream,
    tokens: &mut Vec<Token>,
    literals: &mut Vec<(LineColumn, LineColumn)>,
) {
    let trees: Vec<TokenTree> = stream.into_iter().collect();
    let mut index = 0;
    while let Some(tree) = trees.get(index) {
        // A doc comment reaches the lexer as an attribute: a comment, never code.
        if is_doc(tree, trees.get(index + 1)) {
            index += 2;
            continue;
        }
        match tree {
            TokenTree::Group(group) => {
                let (open, close) = match group.delimiter() {
                    Delimiter::Parenthesis => ("(", ")"),
                    Delimiter::Brace => ("{", "}"),
                    Delimiter::Bracket => ("[", "]"),
                    Delimiter::None => ("", ""),
                };
                if !open.is_empty() {
                    tokens.push(Token {
                        key: open.to_owned(),
                        line: group.span_open().start().line,
                    });
                }
                flatten(group.stream(), tokens, literals);
                if !close.is_empty() {
                    tokens.push(Token {
                        key: close.to_owned(),
                        line: group.span_close().start().line,
                    });
                }
            }
            other => {
                if let TokenTree::Literal(literal) = other {
                    literals.push((literal.span().start(), literal.span().end()));
                }
                tokens.push(Token {
                    key: other.to_string(),
                    line: other.span().start().line,
                });
            }
        }
        index += 1;
    }
}

/// `tokens` without the `use` lists that start a statement, `pub use` included, to their `;`.
fn without_use_lists(tokens: Vec<Token>) -> Vec<Token> {
    let mut kept = Vec::with_capacity(tokens.len());
    let mut index = 0;
    while index < tokens.len() {
        let starts = index == 0
            || matches!(
                tokens[index - 1].key.as_str(),
                ";" | "{" | "}" | "]" | "pub" | ")"
            );
        if tokens[index].key == "use"
            && starts
            && let Some(end) = tokens[index..].iter().position(|token| token.key == ";")
        {
            if kept.last().is_some_and(|token: &Token| token.key == "pub") {
                kept.pop();
            }
            index += end + 1;
            continue;
        }
        kept.push(tokens[index].clone());
        index += 1;
    }
    kept
}

/// A copy: the first place, its lines, the second place, its lines, and its tokens.
#[derive(Debug)]
struct Copy {
    a: String,
    lines: (usize, usize),
    b: String,
    other_lines: (usize, usize),
    tokens: usize,
}

fn deliberate(marked: &BTreeSet<usize>, (first, last): (usize, usize)) -> bool {
    marked
        .range(first.saturating_sub(MARKER_LINES_ABOVE).max(1)..=last)
        .next()
        .is_some()
}

/// The copies of `min_tokens` tokens or more among `files`, the longest first, the deliberate ones
/// left out; a place copied several times is named once.
fn find_copies(files: &[Tokens], min_tokens: usize) -> Vec<Copy> {
    // Every window of min_tokens tokens, by its text: where it occurs, as (file, first token).
    let mut windows: BTreeMap<Vec<&str>, Vec<(usize, usize)>> = BTreeMap::new();
    for (file_index, file) in files.iter().enumerate() {
        for start in 0..(file.tokens.len() + 1).saturating_sub(min_tokens) {
            let key = file.tokens[start..start + min_tokens]
                .iter()
                .map(|token| token.key.as_str())
                .collect();
            windows.entry(key).or_default().push((file_index, start));
        }
    }
    // Every pair of places of the same window, grown into runs: windows at the same distance.
    let mut runs: BTreeMap<(usize, usize, isize), Vec<usize>> = BTreeMap::new();
    for places in windows.values() {
        for (i, first) in places.iter().enumerate() {
            for other in &places[i + 1..] {
                let distance = other.1.cast_signed() - first.1.cast_signed();
                if first.0 == other.0 && distance.unsigned_abs() < min_tokens {
                    continue;
                }
                runs.entry((first.0, other.0, distance))
                    .or_default()
                    .push(first.1);
            }
        }
    }
    let mut copies = Vec::new();
    for ((a, b, distance), mut starts) in runs {
        starts.sort_unstable();
        let mut index = 0;
        while index < starts.len() {
            let mut end = index;
            while end + 1 < starts.len() && starts[end + 1] == starts[end] + 1 {
                end += 1;
            }
            let from = starts[index];
            let to = starts[end] + min_tokens - 1;
            let (file_a, file_b) = (&files[a], &files[b]);
            let shift = |at: usize| at.cast_signed() + distance;
            let lines = (file_a.tokens[from].line, file_a.tokens[to].line);
            let other_lines = (
                file_b.tokens[shift(from).unsigned_abs()].line,
                file_b.tokens[shift(to).unsigned_abs()].line,
            );
            if !deliberate(&file_a.marked, lines) && !deliberate(&file_b.marked, other_lines) {
                copies.push(Copy {
                    a: file_a.path.clone(),
                    lines,
                    b: file_b.path.clone(),
                    other_lines,
                    tokens: to - from + 1,
                });
            }
            index = end + 1;
        }
    }
    copies.sort_by(|x, y| x.a.cmp(&y.a).then(x.lines.0.cmp(&y.lines.0)));
    let mut named = BTreeSet::new();
    copies.retain(|copy| named.insert((copy.b.clone(), copy.other_lines)));
    copies.sort_by_key(|copy| std::cmp::Reverse(copy.tokens));
    copies
}

/// The gate: `[]`, `["--tokens", N]` or `["--self-test"]`.
pub(crate) fn run(root: &Path, arguments: &[&str]) -> Result<(), Failure> {
    let usage = || {
        Failure(
            "usage: cargo xtask copies [--tokens N | --self-test], N a whole number from 2"
                .to_owned(),
        )
    };
    let min_tokens = match arguments {
        [] => MIN_TOKENS,
        ["--self-test"] => return self_test(),
        ["--tokens", count] => count
            .parse::<usize>()
            .ok()
            .filter(|count| *count >= 2)
            .ok_or_else(usage)?,
        _ => return Err(usage()),
    };
    let mut files = Vec::new();
    for path in tracked_or_new(root)? {
        if path.ends_with(".rs") && FOLDERS.iter().any(|folder| path.starts_with(folder)) {
            files.push(tokens_of(&path, &read(root, &path)?)?);
        }
    }
    let copies = find_copies(&files, min_tokens);
    let lines: Vec<String> = copies
        .iter()
        .map(|copy| {
            format!(
                "{}:{}-{} = {}:{}-{} ({} tokens)",
                copy.a,
                copy.lines.0,
                copy.lines.1,
                copy.b,
                copy.other_lines.0,
                copy.other_lines.1,
                copy.tokens
            )
        })
        .collect();
    report(
        &lines,
        &format!(
            "{} copies of {min_tokens} tokens or more: move each into one function that both places call, or mark a deliberate one (xtask/src/copies.rs)",
            copies.len()
        ),
        &format!(
            "No copies of {min_tokens} tokens or more in {} Rust files.",
            files.len()
        ),
    )
}

/// A function named `name` whose long body is the same in every one: copies of each other.
fn copied(name: &str) -> String {
    let body: String = (0..12)
        .map(|index| format!("    total = total * 7 + from + {index};\n"))
        .collect();
    format!("fn {name}(from: u64) -> u64 {{\n    let mut total = 0;\n{body}    total\n}}\n")
}

/// The checker against controls it must decide right.
fn self_test() -> Result<(), Failure> {
    let decide = |sources: &[(&str, String)]| -> Result<usize, Failure> {
        let files = sources
            .iter()
            .map(|(path, text)| tokens_of(path, text))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(find_copies(&files, MIN_TOKENS).len())
    };
    let marked = |name: &str| format!("// A deliberate copy: its reason.\n{}", copied(name));
    let mut failed = Vec::new();
    let mut must =
        |what: &str, expected: usize, sources: &[(&str, String)]| -> Result<(), Failure> {
            let found = decide(sources)?;
            if found != expected {
                failed.push(format!("{what}: {found} copies, {expected} expected"));
            }
            Ok(())
        };
    must(
        "an ordinary copy",
        1,
        &[("a.rs", copied("a")), ("b.rs", copied("b"))],
    )?;
    must(
        "a marked copy",
        0,
        &[("a.rs", marked("a")), ("b.rs", copied("b"))],
    )?;
    must(
        "two unmarked beside a marked one",
        1,
        &[
            ("a.rs", marked("a")),
            ("b.rs", copied("b")),
            ("c.rs", copied("c")),
        ],
    )?;
    must(
        "three equal places",
        2,
        &[
            ("a.rs", copied("a")),
            ("b.rs", copied("b")),
            ("c.rs", copied("c")),
        ],
    )?;
    let names: Vec<String> = (0..40).map(|index| format!("name{index}")).collect();
    let uses = format!(
        "use crate::{{{}}};\npub use crate::{{{}}};\n",
        names.join(", "),
        names.join(", ")
    );
    must("use lists", 0, &[("a.rs", uses.clone()), ("b.rs", uses)])?;
    let short: String = (0..2)
        .map(|index| format!("fn f{index}() {{ let x = 1; }}\n"))
        .collect();
    must(
        "a short repeat",
        0,
        &[("a.rs", short.clone()), ("b.rs", short)],
    )?;
    let in_strings = |name: &str| {
        format!(
            "const WHY: &str = \"not a deliberate copy\"; // a constant\nconst URL: &str = \"https://example.org/deliberate copy\";\n{}",
            copied(name)
        )
    };
    must(
        "a copy beside strings that say deliberate copy",
        1,
        &[("a.rs", in_strings("a")), ("b.rs", copied("b"))],
    )?;
    let doc_marked = |name: &str| format!("/// A deliberate copy: its reason.\n{}", copied(name));
    must(
        "a copy marked in its doc comment",
        0,
        &[("a.rs", doc_marked("a")), ("b.rs", copied("b"))],
    )?;
    let block = |name: &str| format!("/*\n   deliberate copy: its reason\n*/\n{}", copied(name));
    must(
        "a copy marked inside a block comment",
        0,
        &[("a.rs", block("a")), ("b.rs", copied("b"))],
    )?;
    let doc = format!("/// {}\nfn a() {{}}\n", "word ".repeat(80));
    must("doc comments", 0, &[("a.rs", doc.clone()), ("b.rs", doc)])?;
    report(
        &failed,
        "copies: the self-test failed",
        "copies: the check finds the copies of its controls and leaves the rest alone.",
    )
}

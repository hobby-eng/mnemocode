// Finds code copied from one place to another: the same run of at least MIN_TOKENS tokens in two
// places of MnemoCode's crates and the bc-crypto stand-in (crates/, shims/) or of the gate scripts
// and the TS recorders (scripts/, parity/), whatever the white space, the line breaks and the comments. It reads the code with a
// small tokenizer of its own, so that it needs no package.
//
// A copy is reported as "file A:lines = file B:lines": the code belongs in one function that both
// call (CORE-10). A deliberate copy, such as a fast path or a worker that cannot import, says so in
// a comment that contains "deliberate copy" inside the copied lines or the three lines above them,
// with its reason; it is then not reported.
//
// It finds copies, not the same rule written in other words, nor a constant written in many
// places: those still need the search before writing and a review. Import and export lists (`use`
// in Rust, `import …;` and `export { … }`, `export type { … }`, `export * …` in JavaScript, each
// at the start of a statement) are left out: two files that use the same modules share no code.
// Exported declarations (`export function`, `export class`, …), `import(…)` and `import.meta` are
// code and are read. Taken from mhfe, whose recipe is MnemoCode TS's scripts/verify-no-copies.mjs;
// the tokenizer of both languages is in code-tokens.mjs.
//
//   node scripts/verify-no-copies.mjs [--tokens N]   N a whole number from 2, 50 by default
//   node scripts/verify-no-copies.mjs --self-test    the checker against copies it must find

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DELIBERATE, tokensOf } from "./code-tokens.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
/**
 * The shortest run of tokens that counts as a copy, about four to six lines of code: jscpd's
 * default, below which the same few lines of ordinary code meet by chance.
 */
const MIN_TOKENS = 50;
/** The folders read, and the endings of the files read in them. */
const SOURCES = [
  { directory: "crates", endings: [".rs"] },
  { directory: "shims", endings: [".rs"] },
  { directory: "scripts", endings: [".mjs"] },
  { directory: "parity", endings: [".mjs"] },
];
/** Data, not code: generated tables that are long by nature and never repeat logic. */
const DATA_FILES = new Set([]);
/** Lines above a copy in which its marker may stand. */
const MARKER_LINES_ABOVE = 3;

/** The usage, said with a refused command line. */
const USAGE = "usage: node scripts/verify-no-copies.mjs [--tokens N | --self-test]";

/**
 * The command line: `--tokens N` with N a whole number from 2, or `--self-test`, each at most once
 * and alone. Anything else is refused, so that a mistyped threshold never passes a check that
 * looked at nothing (AUD-012-ARC002).
 */
function commandLine(args) {
  if (args.length === 0) return { minTokens: MIN_TOKENS, selfTest: false };
  if (args.length === 1 && args[0] === "--self-test")
    return { minTokens: MIN_TOKENS, selfTest: true };
  if (args.length === 2 && args[0] === "--tokens" && /^\d+$/u.test(args[1])) {
    const minTokens = Number(args[1]);
    if (Number.isSafeInteger(minTokens) && minTokens >= 2) return { minTokens, selfTest: false };
  }
  throw new Error(`${USAGE}: N is a whole number from 2`);
}

/** Every source file under `directory` with one of `endings`, by its path from the root. */
function sourceFiles(directory, endings) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path, endings);
    const read = endings.some((ending) => entry.name.endsWith(ending)) && !DATA_FILES.has(path);
    return read ? [path] : [];
  });
}

/** Tokens after which a new statement starts. */
const STATEMENT_ENDS = new Set([";", "{", "}"]);
/** The most tokens an import or export list may have; a longer one is read as code. */
const MOST_LIST_TOKENS = 1024;

/** Whether the token at `at` starts a statement: the first one, or one after an end. */
function startsStatement(tokens, at, ends = STATEMENT_ENDS) {
  return at === 0 || ends.has(tokens[at - 1].key);
}

/**
 * Where the import or export list starting at `at` ends, the index after its last token, or -1
 * when none starts there. Rust's `use` at the start of a statement, `pub use` included, runs to
 * its semicolon; a `use` inside a type, as in `impl Trait + use<'a>`, is code. JavaScript's
 * `import` and `export { … }`, `export type { … }` and `export * …` lists at the start of a
 * statement end after their `from "…"`, or for a local `export { … }` after its brace, with the
 * semicolon if there is one: a list without one (automatic semicolon insertion) ends there too, so
 * that the code after it is read (AUD-013-ARC001). `import(…)`, `import.meta` and exported
 * declarations (`export function`, `export class`, …) are code (AUD-012-ARC001).
 */
function importListEnd(tokens, at, rust) {
  const key = tokens[at].key;
  const next = tokens[at + 1]?.key;
  const last = Math.min(tokens.length, at + MOST_LIST_TOKENS);
  if (rust) {
    if (key !== "use") return -1;
    const visibility = at > 0 && tokens[at - 1].key === "pub";
    const restricted = at > 3 && tokens[at - 1].key === ")" && tokens[at - 4]?.key === "pub";
    const from = visibility ? at - 1 : restricted ? at - 4 : at;
    if (!startsStatement(tokens, from, new Set([...STATEMENT_ENDS, "]"]))) return -1;
    for (let end = at + 1; end < last; end += 1) if (tokens[end].key === ";") return end + 1;
    return -1;
  }
  if (!startsStatement(tokens, at)) return -1;
  const isList =
    key === "import"
      ? next !== "(" && next !== "."
      : key === "export" &&
        (next === "{" || next === "*" || (next === "type" && tokens[at + 2]?.key === "{"));
  if (!isList) return -1;
  // The end after `from "…"`, or after a closing brace that no `from` follows.
  const withSemicolon = (end) => (tokens[end]?.key === ";" ? end + 1 : end);
  const isString = (index) => /^["'`]/u.test(tokens[index]?.key ?? "");
  if (key === "import" && isString(at + 1)) return withSemicolon(at + 2);
  let depth = 0;
  for (let end = at + 1; end < last; end += 1) {
    const token = tokens[end].key;
    if (token === "{") depth += 1;
    else if (token === "}") {
      depth -= 1;
      if (depth === 0 && key === "export" && tokens[end + 1]?.key !== "from") {
        return withSemicolon(end + 1);
      }
    } else if (token === "from" && depth === 0 && isString(end + 1)) {
      return withSemicolon(end + 2);
    }
  }
  return -1;
}

/** `tokens` without the import and export lists. */
function withoutImports(tokens, rust) {
  const kept = [];
  for (let at = 0; at < tokens.length;) {
    const end = importListEnd(tokens, at, rust);
    if (end > at) at = end;
    else kept.push(tokens[at++]);
  }
  return kept;
}

/** Whether a comment on lines `first` to `last`, or on the few above, marks a deliberate copy. */
function deliberate(markedLines, first, last) {
  for (let line = Math.max(1, first - MARKER_LINES_ABOVE); line <= last; line += 1) {
    if (markedLines.has(line)) return true;
  }
  return false;
}

/**
 * The copies of `minTokens` tokens or more among `sources`, `[{ path, text }]`, the longest first:
 * `{ a, lines, b, otherLines, tokens }`, with the deliberate ones left out.
 */
function findCopies(sources, minTokens) {
  const files = sources.map(({ path, text }) => {
    const rust = path.endsWith(".rs");
    const { tokens, markedLines } = tokensOf(text, rust);
    return { path, markedLines, tokens: withoutImports(tokens, rust) };
  });

  // Every window of minTokens tokens, by its text: where it occurs, as [file, first token].
  const windows = new Map();
  files.forEach((file, fileIndex) => {
    for (let start = 0; start + minTokens <= file.tokens.length; start += 1) {
      const key = file.tokens
        .slice(start, start + minTokens)
        .map((token) => token.key)
        .join("\u0000");
      const places = windows.get(key);
      if (places === undefined) windows.set(key, [[fileIndex, start]]);
      else places.push([fileIndex, start]);
    }
  });

  // Every pair of places of the same window, grown into the longest runs: consecutive windows
  // that match at the same distance are one copy. Every pair, not each place against the first,
  // so that a first place marked as deliberate does not hide copies among the others
  // (AUD-013-ARC003).
  const runs = new Map();
  for (const places of windows.values()) {
    for (let i = 0; i < places.length; i += 1) {
      for (let j = i + 1; j < places.length; j += 1) {
        const [first, other] = [places[i], places[j]];
        // Overlapping windows of one file are one run of repeated tokens, not a copy.
        if (first[0] === other[0] && other[1] - first[1] < minTokens) continue;
        const diagonal = `${first[0]}:${other[0]}:${other[1] - first[1]}`;
        const run = runs.get(diagonal) ?? [];
        run.push(first[1]);
        runs.set(diagonal, run);
      }
    }
  }

  const copies = [];
  for (const [diagonal, starts] of runs) {
    const [a, b, distance] = diagonal.split(":").map(Number);
    starts.sort((x, y) => x - y);
    for (let index = 0; index < starts.length;) {
      let end = index;
      while (end + 1 < starts.length && starts[end + 1] === starts[end] + 1) end += 1;
      const from = starts[index];
      const to = starts[end] + minTokens - 1;
      const fileA = files[a];
      const fileB = files[b];
      const lines = [fileA.tokens[from].line, fileA.tokens[to].line];
      const otherLines = [fileB.tokens[from + distance].line, fileB.tokens[to + distance].line];
      if (!deliberate(fileA.markedLines, ...lines) && !deliberate(fileB.markedLines, ...otherLines))
        copies.push({ a: fileA.path, lines, b: fileB.path, otherLines, tokens: to - from + 1 });
      index = end + 1;
    }
  }
  // A place copied several times is named once, against the first place it copies: three equal
  // blocks are two copies, not three.
  const named = new Set();
  return copies
    .sort((x, y) => (x.a === y.a ? x.lines[0] - y.lines[0] : x.a < y.a ? -1 : 1))
    .filter((copy) => {
      const place = `${copy.b}:${copy.otherLines[0]}-${copy.otherLines[1]}`;
      if (named.has(place)) return false;
      named.add(place);
      return true;
    })
    .sort((x, y) => y.tokens - x.tokens);
}

/** The sources the check reads. */
function repositorySources() {
  return SOURCES.flatMap(({ directory, endings }) => sourceFiles(directory, endings)).map(
    (path) => ({ path, text: readFileSync(join(root, path), "utf8") }),
  );
}

/** A body of `count` statements, long enough to be a copy, different for every `seed`. */
function longBody(seed, count = 12) {
  return Array.from(
    { length: count },
    (_, index) => `  total = total * ${seed} + from + ${index};`,
  ).join("\n");
}

/** A function named `name` with a long body, the same in every one: copies of each other. */
function copied(name) {
  return `function ${name}(from) {\n  let total = 0;\n${longBody(7)}\n}`;
}

/** The same function, marked as a deliberate copy. */
function markedCopy(name) {
  return `// A deliberate copy: its reason.\n${copied(name)}`;
}

/** Fails the self-test unless `sources` hold a copy exactly when `expected` says so. */
function must(expected, sources, what) {
  const found = findCopies(sources, MIN_TOKENS).length > 0;
  if (found !== expected) throw new Error(`self-test: ${what} ${expected ? "not found" : "found"}`);
}

/** The copies the checker must find, in JavaScript and in Rust. */
function selfTestCopies() {
  const body = longBody(7);
  must(
    true,
    [
      { path: "web/a.js", text: `function a(from) {\n  let total = 0;\n${body}\n}` },
      { path: "web/b.js", text: `function b(from) {\n  let total = 0;\n${body}\n}` },
    ],
    "an ordinary copy is",
  );
  must(
    true,
    [
      { path: "web/a.js", text: `export function sample(from) {\n  let total = 0;\n${body}\n}` },
      {
        path: "web/b.js",
        text: `export class Other {\n  sample(from) {\n  let total = 0;\n${body}\n}\n}`,
      },
    ],
    "a copy in exported declarations with a parameter named from is",
  );
  must(
    true,
    [
      { path: "web/a.js", text: `const x = import.meta.url;\nlet total = 0;\n${body}` },
      { path: "web/b.js", text: `const y = await import("./c.js");\nlet total = 0;\n${body}` },
    ],
    "a copy after import.meta and import(…) is",
  );
  const rustBody = Array.from(
    { length: 12 },
    (_, i) => `    total = total * 7 + r#"a"b"# .len() + ${i};`,
  ).join("\n");
  must(
    true,
    [
      {
        path: "src/a.rs",
        text: `fn a<'a>(x: &'a str) -> usize {\n    let c = 'x';\n    let mut total = 0;\n${rustBody}\n    total\n}`,
      },
      {
        path: "src/b.rs",
        text: `fn b<'b>(y: &'b str) -> usize {\n    let c = 'y';\n    let mut total = 0;\n${rustBody}\n    total\n}`,
      },
    ],
    "a Rust copy beside raw strings and lifetimes is",
  );
  const names = Array.from({ length: 40 }, (_, i) => `name${i}`).join(", ");
  must(
    false,
    [
      {
        path: "web/a.js",
        text: `import { ${names} } from "./x.js";\nexport { ${names} } from "./x.js";\nexport * from "./y.js";\nexport type { ${names} } from "./z.js";`,
      },
      {
        path: "web/b.js",
        text: `import { ${names} } from "./x.js";\nexport { ${names} } from "./x.js";\nexport * from "./y.js";\nexport type { ${names} } from "./z.js";`,
      },
      { path: "src/a.rs", text: `use crate::{${names}};\npub use crate::{${names}};` },
      { path: "src/b.rs", text: `use crate::{${names}};\npub use crate::{${names}};` },
    ],
    "import and export lists are",
  );
  must(
    false,
    [
      {
        path: "web/a.js",
        text: `// A deliberate copy: a worker cannot import.\nfunction a(from) {\n  let total = 0;\n${body}\n}`,
      },
      { path: "web/b.js", text: `function b(from) {\n  let total = 0;\n${body}\n}` },
    ],
    "a deliberate copy is",
  );
}

/** What the checker must leave alone, and the copies it must still find beside it. */
function selfTestLeftAlone() {
  const body = longBody(7);
  must(
    false,
    [
      { path: "web/a.js", text: `function a(from) {\n  let total = 0;\n${longBody(7, 2)}\n}` },
      { path: "web/b.js", text: `function b(from) {\n  let total = 0;\n${longBody(7, 2)}\n}` },
    ],
    "a short repeat is",
  );
  // AUD-013-ARC001: lists without a semicolon end with their statement; the code after them counts.
  must(
    true,
    [
      { path: "web/a.js", text: `import { x } from "./x.js"\n${copied("a")}` },
      { path: "web/b.js", text: `export { y } from "./y.js"\n${copied("b")}` },
    ],
    "a copy after import and export lists without semicolons is",
  );
  must(
    true,
    [
      { path: "web/a.js", text: `import "./side-effect.js"\nexport { a }\n${copied("a")}` },
      {
        path: "web/b.js",
        text: `export * from "./z.js"\nexport type { T } from "./t.js"\n${copied("b")}`,
      },
    ],
    "a copy after bare imports, local export lists and type lists is",
  );
  const typeBody = Array.from(
    { length: 12 },
    (_, i) => `    total = total * 7 + x.len() + ${i};`,
  ).join("\n");
  must(
    true,
    [
      {
        path: "src/a.rs",
        text: `fn a<'a>(x: &'a str) -> impl Sized + use<'a> {\n    let mut total = 0;\n${typeBody}\n    x\n}`,
      },
      {
        path: "src/b.rs",
        text: `fn b<'a>(x: &'a str) -> impl Sized + use<'a> {\n    let mut total = 0;\n${typeBody}\n    x\n}`,
      },
    ],
    "a Rust copy after `use` in a type is",
  );
  // AUD-013-ARC002: only a comment marks a deliberate copy, never a string with the words.
  must(
    true,
    [
      { path: "web/a.js", text: `const why = "deliberate copy";\n${copied("a")}` },
      { path: "web/b.js", text: `const why = \`deliberate copy\`;\n${copied("b")}` },
    ],
    "a copy beside strings that say deliberate copy is",
  );
  must(
    false,
    [
      {
        path: "web/a.js",
        text: `/*\n * A deliberate copy: a worker\n * cannot import.\n */\n${copied("a")}`,
      },
      { path: "web/b.js", text: copied("b") },
    ],
    "a copy under a block comment that marks it is",
  );
  // AUD-013-ARC003: a marked place hides only itself; the unmarked places are still compared.
}

/**
 * The checker against controls it must decide right: copies it must find, also in exported
 * declarations and beside `import(…)` and `import.meta`, in Rust beside raw strings and lifetimes,
 * and import and export lists, a deliberate copy and short repeats it must leave alone.
 */
function selfTest() {
  selfTestCopies();
  selfTestLeftAlone();
  for (const [order, what] of [
    [[markedCopy("a"), copied("b"), copied("c")], "first"],
    [[copied("a"), markedCopy("b"), copied("c")], "middle"],
    [[copied("a"), copied("b"), markedCopy("c")], "last"],
  ]) {
    must(
      true,
      order.map((text, index) => ({ path: `web/${index}.js`, text })),
      `two unmarked copies beside a marked one, ${what}, are`,
    );
  }
  must(
    true,
    [{ path: "web/one.js", text: `${markedCopy("a")}\n${copied("b")}\n${copied("c")}` }],
    "two unmarked copies in one file beside a marked one are",
  );
  must(
    false,
    [
      { path: "web/a.js", text: markedCopy("a") },
      { path: "web/b.js", text: copied("b") },
    ],
    "one copy of a marked place is",
  );
  const three = findCopies(
    ["a", "b", "c"].map((name) => ({ path: `web/${name}.js`, text: copied(name) })),
    MIN_TOKENS,
  );
  if (three.length !== 2)
    throw new Error(`self-test: three equal places give ${three.length} copies`);
  for (const args of [
    ["--tokens", "NaN"],
    ["--tokens", "Infinity"],
    ["--tokens", "0"],
    ["--tokens", "-5"],
    ["--tokens", "1.5"],
    ["--tokens"],
    ["--tokens", "9007199254740993"],
    ["--tokens", "50", "--tokens", "50"],
    ["--other"],
  ]) {
    let refused = false;
    try {
      commandLine(args);
    } catch {
      refused = true;
    }
    if (!refused) throw new Error(`self-test: ${args.join(" ")} is accepted`);
  }
  console.log("The copy check finds the copies of its controls and refuses bad thresholds.");
}

let options;
try {
  options = commandLine(process.argv.slice(2));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
if (options.selfTest) {
  selfTest();
  process.exit(0);
}
const { minTokens } = options;
const sources = repositorySources();
const copies = findCopies(sources, minTokens);
for (const copy of copies)
  console.error(
    `${copy.a}:${copy.lines[0]}-${copy.lines[1]} = ${copy.b}:${copy.otherLines[0]}-${copy.otherLines[1]} (${copy.tokens} tokens)`,
  );
if (copies.length > 0) {
  console.error(
    `${copies.length} copies of ${minTokens} tokens or more: move each into one function that both places call, or mark a deliberate one (see the top of ${relative(root, fileURLToPath(import.meta.url))}).`,
  );
  process.exit(1);
}
console.log(
  `No copies of ${minTokens} tokens or more in ${sources.length} files of crates/, shims/, scripts/ and parity/.`,
);

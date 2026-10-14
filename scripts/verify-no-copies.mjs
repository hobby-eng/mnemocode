// Finds code copied from one place to another in src/ and the scripts: the same run of at least
// MIN_TOKENS tokens in two places, whatever the white space, the line breaks and the comments. It
// reads the code with a small tokenizer of its own, so that it needs no package; Python scripts
// are not read.
//
// A copy is reported as "file A, lines a to b = file B, lines c to d": the code belongs in one
// function that both call (AGENTS.md, Object-oriented design and no repetition). A deliberate
// copy, such as a fast path or a worker that cannot import, says so in a comment that contains
// "deliberate copy" inside the copied lines or the three lines above them, with its reason; it is
// then not reported. Lists of imports are left out: they name modules, they are no code.
//
// It finds copies, not the same rule written in other words, such as `n < 1 || n > 2048` and
// `!(n >= 1 && n <= 2048)`, nor a constant written in many places: those still need the search
// before writing and a review.
//
//   node scripts/verify-no-copies.mjs [--tokens N]

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensOf } from "./source-tokens.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
/**
 * The shortest run of tokens that counts as a copy, about four to six lines of code: jscpd's
 * default, below which the same few lines of ordinary code meet by chance.
 */
const MIN_TOKENS = 50;
/** Data, not code: lists that are long by nature and never repeat logic. */
const DATA_FILES = new Set(["src/export/world-map-data.ts", "src/sskr/bytewords-list.ts"]);
/** The marker of a deliberate copy, in a comment in or just above the copied lines. */
const DELIBERATE = /deliberate copy/iu;
/** Lines above a copy in which its marker may stand. */
const MARKER_LINES_ABOVE = 3;

/**
 * The whole number that follows `name` among the arguments, or `fallback` without it. A value that
 * is missing or no positive whole number stops the check, which would otherwise compare nothing
 * and report no copy (AUD-012-ARC013).
 */
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at < 0) return fallback;
  const text = process.argv[at + 1];
  // Digits alone are not enough: a long run of them is Infinity as a number.
  const value = text !== undefined && /^[1-9][0-9]*$/u.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value)) {
    console.error(`${name} needs a whole number of tokens from 1 up.`);
    process.exit(2);
  }
  return value;
}

/**
 * Every file under `directory` that ends with `extension`, by its path from the repository root.
 */
function sourceFiles(directory, extension) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path, extension);
    return entry.name.endsWith(extension) && !DATA_FILES.has(path) ? [path] : [];
  });
}

/** Tokens after which a statement starts. */
const STATEMENT_ENDS = new Set([";", "}"]);

/** Whether `token` is a string: the name of a module after `from`. */
function isString(token) {
  return token !== undefined && (token.key.startsWith('"') || token.key.startsWith("'"));
}

/** `index`, or the semicolon right after it: the last token of a statement. */
function withSemicolon(tokens, index) {
  return tokens[index + 1]?.key === ";" ? index + 1 : index;
}

/**
 * The last token of the list of imports or exports that starts at `at`: the module's name of
 * `import "…"` or after `from`, or the brace that closes a local `export { … }`, with the
 * semicolon after it if there is one. Undefined for a list of no form known here, which then stays
 * as code: a list ended at the next semicolon would take the code after it when it has none.
 */
function listEnd(tokens, at) {
  if (isString(tokens[at + 1])) return withSemicolon(tokens, at + 1);
  let depth = 0;
  for (let index = at + 1; index < tokens.length; index += 1) {
    const { key } = tokens[index];
    if (key === "{") depth += 1;
    else if (key === "}") {
      depth -= 1;
      const local = tokens[at].key === "export" && tokens[index + 1]?.key !== "from";
      if (depth === 0 && local) return withSemicolon(tokens, index);
    } else if (depth === 0 && key === "from" && isString(tokens[index + 1]))
      return withSemicolon(tokens, index + 1);
    else if (depth === 0 && key === ";") return undefined;
  }
  return undefined;
}

/**
 * `tokens` without the lists of imports and exports, `import … from "…"`, `export { … }` and
 * the like: two modules that use the same modules share no code, and such lists would only be
 * found as copies (mhfe's check leaves them out too). A dynamic import(…) and import.meta are code
 * and stay, as does an exported declaration.
 */
function withoutImportLists(tokens) {
  const kept = [];
  // The last token of the list left out last: the next statement starts after it.
  let listEndedAt = -1;
  for (let at = 0; at < tokens.length; at += 1) {
    const { key } = tokens[at];
    const startsStatement =
      at === 0 || STATEMENT_ENDS.has(tokens[at - 1].key) || at - 1 === listEndedAt;
    const next = tokens[at + 1]?.key;
    // Not import(…) nor import.meta, which are code.
    const importList = key === "import" && next !== "(" && next !== ".";
    // export { … }, export type { … } and export * …, with or without from: a list of names.
    const exportList =
      key === "export" &&
      (next === "{" || next === "*" || (next === "type" && tokens[at + 2]?.key === "{"));
    const end = startsStatement && (importList || exportList) ? listEnd(tokens, at) : undefined;
    if (end !== undefined) {
      at = end;
      listEndedAt = end;
      continue;
    }
    kept.push(tokens[at]);
  }
  return kept;
}

/**
 * Whether a comment within lines `first` to `last`, or the few above, marks a deliberate copy. Text
 * in a string or anywhere else is no marker (AUD-012-ARC015).
 */
function deliberate(comments, first, last) {
  return comments.some(
    (comment) =>
      comment.last >= first - MARKER_LINES_ABOVE &&
      comment.first <= last &&
      DELIBERATE.test(comment.text),
  );
}

const minTokens = option("--tokens", MIN_TOKENS);
// The library and the command line, and the maintainer scripts beside them.
const files = [...sourceFiles("src", ".ts"), ...sourceFiles("scripts", ".mjs")].map((path) => {
  const text = readFileSync(join(root, path), "utf8");
  const { tokens, comments } = tokensOf(text);
  return { path, comments, tokens: withoutImportLists(tokens) };
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

// Every pair of places of the same window, grown into the longest runs: consecutive windows that
// match at the same distance are one copy. Each place against the first only would let a first
// place marked as deliberate hide the copies among the others.
const runs = new Map();
for (const places of windows.values())
  places.forEach((first, index) => {
    for (const other of places.slice(index + 1)) {
      // Overlapping windows of one file are one run of repeated tokens, not a copy.
      if (first[0] === other[0] && other[1] - first[1] < minTokens) continue;
      const diagonal = `${first[0]}:${other[0]}:${other[1] - first[1]}`;
      const run = runs.get(diagonal) ?? [];
      run.push(first[1]);
      runs.set(diagonal, run);
    }
  });

// The copies, by their later place: a place that copies several others is one copy, against the
// earliest of them that no comment marks, so that three equal places are two copies. Places are
// found in the order of the files and of their tokens, so the first of a pair is the earlier.
const byLaterPlace = new Map();
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
    if (!deliberate(fileA.comments, ...lines) && !deliberate(fileB.comments, ...otherLines)) {
      const later = `${b}:${from + distance}:${to + distance}`;
      const known = byLaterPlace.get(later);
      if (known === undefined || a < known.file || (a === known.file && from < known.from))
        byLaterPlace.set(later, {
          a: fileA.path,
          lines,
          b: fileB.path,
          otherLines,
          tokens: to - from + 1,
          file: a,
          from,
        });
    }
    index = end + 1;
  }
}
const copies = [...byLaterPlace.values()];

copies.sort((x, y) => y.tokens - x.tokens);
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
  `No copies of ${minTokens} tokens or more in ${files.length} files of src/ and scripts/.`,
);

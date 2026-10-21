// The rules of the coding guide that the gate `code-rules` (verify-code-rules.mjs) reads in the
// tokens of TypeScript, JavaScript and the tests (source-tokens.mjs), each problem with the ID of
// its rule:
//
// - TS-04: a type assertion other than `as const` has a comment on its line or on one of the
//   ASSERTION_COMMENT_LINES lines above it, which names the check that proved the shape or, in a
//   test or a self-test, says that the value has the wrong type on purpose.
// - TS-09: a constant with a fixed meaning is UPPER_SNAKE_CASE: a `const` of a module whose value
//   is fixed in the source (fixedValue), such as a string, a number, a pattern, or a list or a
//   table of them.
// - CORE-32: a test fakes only a package, a module of Node.js, or a module of the program whose
//   one job is to cross its edge (EDGE_MODULES). A mock of another module of the program, or a spy
//   that changes what one of its exports does, is a fault injected on purpose, with a comment that
//   starts with "Fault:" and names it.
// - CORE-34: a test's name is a sentence: it starts with a word, not with the value of a case, and
//   has at least SENTENCE_WORDS words besides those values.
// - CORE-20: the doc comment of an exported function of a library module, and of a public method
//   of an exported class there, names the code of each error that the function creates itself
//   (`ERRORS.create("<code>"`, with a catalog that the file makes or imports from a module of
//   errors, `<feature>-errors.js`).

import { dirname, join, normalize } from "node:path";
import {
  docCommentAbove,
  exportedBodies,
  functionBody,
  IDENTIFIER,
  membersOf,
} from "./source-declarations.mjs";
import { afterGroup } from "./source-tokens.mjs";

/** TS-04: the most lines above an assertion that its comment may end on. */
const ASSERTION_COMMENT_LINES = 3;
/** TS-09: the name of a constant with a fixed meaning. */
const UPPER_SNAKE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/u;
/** CORE-20: a module that holds only the catalog of coded errors of a feature. */
const ERRORS_MODULE = /^["'][^"']*-errors\.js["']$/u;
/** CORE-34: the fewest words of a test's name, the values of its cases left out. */
const SENTENCE_WORDS = 3;
/** CORE-34: where the value of a case goes in the name of a test of several cases. */
const CASE_VALUE = /%[sdifjoO#%]|\$[\w.]+/gu;
/**
 * CORE-32: the modules of the program whose one job is to cross its edge, each with that edge;
 * a test may fake them, as it fakes a module of Node.js.
 */
const EDGE_MODULES = new Map([
  ["src/cli/terminal-input.ts", "the terminal: its keys, its size and its raw mode"],
  ["src/cli/bounded-read.ts", "files and standard input, read up to a limit"],
  ["src/cli/protection.ts", "the operating system's protection of the process"],
  ["src/export/image-export.ts", "pdftocairo, another program"],
  ["src/export/private-file.ts", "files written where only their owner can read them"],
  ["src/export/platform-node.ts", "Node.js's files, randomness and fonts for the cards"],
]);
/**
 * CORE-32: how the comment of a fault that a test injects into the program's own code on purpose
 * starts, and the most lines above the fake that it may end on.
 */
const FAULT = "Fault:";
const FAULT_COMMENT_LINES = 3;
/** CORE-32: the methods of a spy that change what the spied function does. */
const FAKING = /^mock(?:Implementation|ReturnValue|ResolvedValue|RejectedValue)(?:Once)?$/u;
/** The tokens after which a `as` renames an import or an export, which is no type assertion. */
const RENAMING = new Set(["import", "export"]);
/** The literals that are words. */
const LITERAL_WORDS = new Set(["true", "false", "Infinity", "NaN"]);
/** The words that stand for no value yet, which the module may fill in: no literal of a table. */
const EMPTY_WORDS = new Set(["null", "undefined"]);
/** The tokens that join the parts of a fixed table, or make a number negative. */
const FIXED_PUNCTUATION = new Set(["[", "]", "{", "}", ",", ":", "-", "(", ")"]);
/** The calls that make a fixed table of their literal arguments. */
const FIXED_WRAPPERS = [
  ["Object", ".", "freeze"],
  ["new", "Set"],
  ["new", "Map"],
];

/** The indexes of the tokens that rename an import or an export: `import { a as b }`, `* as`. */
function renamings(tokens) {
  const renamed = new Set();
  tokens.forEach((token, at) => {
    if (!RENAMING.has(token.key) || tokens[at - 1]?.key === ".") return;
    let next = at + 1;
    if (tokens[next]?.key === "type") next += 1;
    if (tokens[next]?.key === "{")
      for (let inside = next; inside < afterGroup(tokens, next); inside += 1) renamed.add(inside);
    if (tokens[next]?.key === "*") renamed.add(next + 1);
  });
  return renamed;
}

/** TS-04: every type assertion other than `as const` has a comment on its line or right above. */
export function checkAssertions(path, tokens, comments, report) {
  if (!path.endsWith(".ts")) return;
  const renamed = renamings(tokens);
  tokens.forEach((token, at) => {
    if (token.key !== "as" || renamed.has(at) || tokens[at + 1]?.key === "const") return;
    // An assertion follows a value: a name, a literal or a closing bracket.
    if (!/^[\p{L}\p{N}_$)\]}"'`!]/u.test(tokens[at - 1]?.key.at(-1) ?? "")) return;
    const { line } = token;
    const commented = comments.some(
      (comment) => comment.first <= line && comment.last >= line - ASSERTION_COMMENT_LINES,
    );
    if (!commented)
      report(
        path,
        line,
        "TS-04",
        "a type assertion has a comment that names the check of its shape, or, in a test, says the wrong type is on purpose",
      );
  });
}

/** The index of the `;` that ends the statement from `at`, outside brackets; the end otherwise. */
function statementEnd(tokens, at) {
  let index = at;
  while (index < tokens.length && tokens[index].key !== ";")
    index = ["(", "[", "{"].includes(tokens[index].key) ? afterGroup(tokens, index) : index + 1;
  return index;
}

/**
 * Whether the value from `from` to `to` is fixed in the source: literals (strings, templates
 * without expressions, numbers, patterns, LITERAL_WORDS), other constants (UPPER_SNAKE), joined
 * into lists and tables, frozen or made a Set or a Map (FIXED_WRAPPERS), and `as const`; at least
 * one literal, and no empty list or table, which the module fills as its state.
 */
function fixedValue(tokens, from, to) {
  let literals = 0;
  for (let index = from; index < to; index += 1) {
    const { key } = tokens[index];
    const wrapper = FIXED_WRAPPERS.find((words) =>
      words.every((word, offset) => tokens[index + offset]?.key === word),
    );
    if (wrapper !== undefined) {
      index += wrapper.length - 1;
      continue;
    }
    if (key === "as" && tokens[index + 1]?.key === "const") return literals > 0;
    // An empty list or table is one that the module fills: state, not a constant.
    if (
      (key === "[" && tokens[index + 1]?.key === "]") ||
      (key === "{" && tokens[index + 1]?.key === "}")
    )
      return false;
    const text = /^["']/u.test(key) || (key.startsWith("`") && !key.includes("${"));
    const number = /^\d/u.test(key);
    const pattern = key.length > 1 && key.startsWith("/");
    if (text || number || pattern || LITERAL_WORDS.has(key)) literals += 1;
    else if (EMPTY_WORDS.has(key)) continue;
    else if (IDENTIFIER.test(key) && tokens[index + 1]?.key === ":") index += 1;
    else if (!UPPER_SNAKE.test(key) && !FIXED_PUNCTUATION.has(key)) return false;
  }
  return literals > 0;
}

/** The index of the `=` of the declaration whose name is at `name`, after its type; undefined without. */
function initializer(tokens, name, end) {
  let index = name + 1;
  while (index < end) {
    const { key } = tokens[index];
    if (key === "=" && tokens[index + 1]?.key !== ">") return index;
    index = ["(", "[", "{"].includes(key) ? afterGroup(tokens, index) : index + 1;
  }
  return undefined;
}

/** TS-09: a module's constant with a fixed meaning is UPPER_SNAKE_CASE. */
export function checkConstantNames(path, tokens, report) {
  let depth = 0;
  tokens.forEach((token, at) => {
    if (["(", "[", "{"].includes(token.key)) depth += 1;
    else if ([")", "]", "}"].includes(token.key)) depth -= 1;
    if (depth !== 0 || token.key !== "const" || tokens[at - 1]?.key === ".") return;
    const name = tokens[at + 1]?.key ?? "";
    if (!IDENTIFIER.test(name) || UPPER_SNAKE.test(name)) return;
    const end = statementEnd(tokens, at);
    const equals = initializer(tokens, at + 1, end);
    if (equals !== undefined && fixedValue(tokens, equals + 1, end))
      report(
        path,
        token.line,
        "TS-09",
        `the constant ${name} has a fixed meaning, so its name is UPPER_SNAKE_CASE`,
      );
  });
}

/** The module of the program that the path `specifier` of a test at `path` names, if any. */
function programModule(path, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const target = normalize(join(dirname(path), specifier)).replaceAll("\\", "/");
  return target.startsWith("src/") ? target.replace(/\.js$/u, ".ts") : undefined;
}

/**
 * The names that the test at `path` imports from a module of the program that is not one of
 * EDGE_MODULES, whole (`import * as name`) or by name (`import { name }`), each with its module.
 * Types are left out: no test can fake one.
 */
function programImports(path, tokens) {
  const imported = new Map();
  tokens.forEach((token, at) => {
    if (token.key !== "import" || tokens[at + 1]?.key === "type") return;
    const names = [];
    let next = at + 1;
    if (tokens[next]?.key === "*" && tokens[next + 1]?.key === "as") {
      names.push(tokens[next + 2]?.key);
      next += 3;
    } else if (tokens[next]?.key === "{") {
      const close = afterGroup(tokens, next);
      for (let inside = next + 1; inside < close - 1; inside += 1) {
        const { key } = tokens[inside];
        // `type name`, `name as local` and `name` up to each comma: the local name counts.
        if (key === "type" && IDENTIFIER.test(tokens[inside + 1]?.key ?? "")) {
          inside += 1;
          continue;
        }
        if (key === "as") names[names.length - 1] = tokens[inside + 1]?.key;
        else if (IDENTIFIER.test(key) && tokens[inside - 1]?.key !== "as") names.push(key);
      }
      next = close;
    }
    const module = programModule(path, tokens[next + 1]?.key.slice(1, -1) ?? "");
    if (tokens[next]?.key !== "from" || module === undefined || EDGE_MODULES.has(module)) return;
    for (const name of names) imported.set(name, module);
  });
  return imported;
}

/** Whether a comment that starts with FAULT ends on the line `line` or on one of FAULT_COMMENT_LINES above it. */
function faultNamed(comments, line) {
  return comments.some(
    (comment) =>
      comment.first <= line &&
      comment.last >= line - FAULT_COMMENT_LINES &&
      comment.text.replace(/^\/[/*]+\s*/u, "").startsWith(FAULT),
  );
}

/**
 * CORE-32: a test fakes only what crosses the program's edge. A mock (vi.mock, vi.doMock) of a
 * module of the program but those of EDGE_MODULES, and a spy (vi.spyOn) on what such a module
 * exports that changes what it does (FAKING), at once or later through the spy, are each a fault
 * that the test injects on purpose, with a comment above that starts with FAULT and names it. A
 * spy that only watches the calls lets the module run as it is.
 */
export function checkFakes(path, tokens, comments, report) {
  if (!path.startsWith("test/")) return;
  const imported = programImports(path, tokens);
  const spies = new Map();
  const refuse = (line, module) => {
    if (!faultNamed(comments, line))
      report(
        path,
        line,
        "CORE-32",
        `a test fakes ${module}, the program's own module, only as a fault that no input can cause, named in a comment that starts with "${FAULT}"`,
      );
  };
  tokens.forEach((token, at) => {
    if (token.key !== "vi" || tokens[at + 1]?.key !== "." || tokens[at + 3]?.key !== "(") return;
    const call = tokens[at + 2]?.key;
    // vi.mock("…") or vi.mock(import("…")).
    if (call === "mock" || call === "doMock") {
      const quoted = tokens[at + 4]?.key === "import" ? tokens[at + 6]?.key : tokens[at + 4]?.key;
      const module = programModule(path, quoted?.slice(1, -1) ?? "");
      if (module !== undefined && !EDGE_MODULES.has(module)) refuse(token.line, module);
    }
    const module = call === "spyOn" ? imported.get(tokens[at + 4]?.key) : undefined;
    if (module === undefined) return;
    const close = afterGroup(tokens, at + 3);
    if (tokens[close]?.key === "." && FAKING.test(tokens[close + 1]?.key ?? ""))
      refuse(token.line, module);
    // const spy = vi.spyOn(…): what the spy is told later counts too.
    else if (tokens[at - 1]?.key === "=" && IDENTIFIER.test(tokens[at - 2]?.key ?? ""))
      spies.set(tokens[at - 2].key, { module, line: token.line });
  });
  tokens.forEach((token, at) => {
    const spy = spies.get(token.key);
    if (spy === undefined || tokens[at + 1]?.key !== "." || tokens[at - 1]?.key === ".") return;
    if (FAKING.test(tokens[at + 2]?.key ?? "") && !faultNamed(comments, spy.line))
      refuse(token.line, spy.module);
  });
}

/** CORE-34: the name of each test is a sentence. */
export function checkTestNames(path, tokens, report) {
  if (!path.startsWith("test/")) return;
  tokens.forEach((token, at) => {
    if (!["it", "test"].includes(token.key) || tokens[at - 1]?.key === ".") return;
    let next = at + 1;
    // it.skip("name"), and it.each(cases)("name") or it.skipIf(condition)("name"), whose first
    // call gives the test.
    while (tokens[next]?.key === "." && IDENTIFIER.test(tokens[next + 1]?.key ?? "")) next += 2;
    if (tokens[next]?.key === "(" && tokens[afterGroup(tokens, next)]?.key === "(")
      next = afterGroup(tokens, next);
    const name = tokens[next]?.key === "(" ? tokens[next + 1]?.key : undefined;
    if (name === undefined || !/^["'`]/u.test(name)) return;
    const text = name.slice(1, -1);
    const words = text.replace(CASE_VALUE, " ").split(/\s+/u).filter(Boolean);
    if (/^\W*(?:%|\$)/u.test(text) || words.length < SENTENCE_WORDS)
      report(
        path,
        token.line,
        "CORE-34",
        "a test's name says the behaviour it proves as a sentence, not the value of a case",
      );
  });
}

/**
 * The catalogs of coded errors that the file makes, `const NAME = new ErrorCatalog(`, or takes from
 * a module of its own errors, `import { NAME } from "./<feature>-errors.js"`.
 */
function catalogsOf(tokens) {
  const catalogs = new Set();
  tokens.forEach((token, at) => {
    if (
      token.key === "new" &&
      tokens[at + 1]?.key === "ErrorCatalog" &&
      tokens[at - 1]?.key === "="
    )
      catalogs.add(tokens[at - 2]?.key);
    if (token.key !== "import" || tokens[at + 1]?.key !== "{") return;
    const close = afterGroup(tokens, at + 1);
    if (tokens[close]?.key !== "from" || !ERRORS_MODULE.test(tokens[close + 1]?.key ?? "")) return;
    for (let inside = at + 2; inside < close - 1; inside += 1)
      if (UPPER_SNAKE.test(tokens[inside].key)) catalogs.add(tokens[inside].key);
  });
  return catalogs;
}

/** The codes of the errors that the tokens from `from` to `to` create with one of `catalogs`. */
function createdCodes(tokens, catalogs, from, to) {
  const codes = new Set();
  for (let index = from; index < to; index += 1)
    if (
      catalogs.has(tokens[index].key) &&
      tokens[index + 1]?.key === "." &&
      tokens[index + 2]?.key === "create" &&
      /^["']/u.test(tokens[index + 4]?.key ?? "")
    )
      codes.add(tokens[index + 4].key.slice(1, -1));
  return codes;
}

/** CORE-20: a reported problem when the doc comment above `at` leaves out a code of the body. */
function checkNamedCodes(path, tokens, comments, at, params, catalogs, report) {
  const open = functionBody(tokens, params);
  if (open === undefined) return;
  const doc = docCommentAbove(tokens, comments, at) ?? "";
  const missing = [...createdCodes(tokens, catalogs, open, afterGroup(tokens, open))].filter(
    (code) => !doc.includes(code),
  );
  if (missing.length > 0)
    report(
      path,
      tokens[at].line,
      "CORE-20",
      `the doc comment names the errors it creates: ${missing.join(", ")}`,
    );
}

/**
 * CORE-20: the doc comment of each exported function and public method of an exported class of a
 * library module names the codes of the errors that it creates itself.
 */
export function checkThrownCodes(path, tokens, comments, report) {
  const catalogs = catalogsOf(tokens);
  if (catalogs.size === 0) return;
  tokens.forEach((token, at) => {
    if (token.key !== "export") return;
    let keyword = at + 1;
    while (["async", "declare", "default"].includes(tokens[keyword]?.key)) keyword += 1;
    if (tokens[keyword]?.key === "function") {
      const params = tokens.findIndex((next, index) => index > keyword && next.key === "(");
      checkNamedCodes(path, tokens, comments, at, params, catalogs, report);
    }
    for (const { open, isClass } of exportedBodies(tokens, at)) {
      if (!isClass) continue;
      for (const member of membersOf(tokens, open))
        if (member.public && !member.overload && member.params !== undefined)
          checkNamedCodes(path, tokens, comments, member.at, member.params, catalogs, report);
    }
  });
}

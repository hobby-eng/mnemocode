// Checks the rules of the workspace coding guide that the compiler, the linter and the copy check
// cannot see: the gate `code-rules` of the guide (code-core.instructions.md, "Gates by name").
// Every problem is printed with the ID of its rule, which names the rule and its reason in the
// guide:
//
// - CORE-15: a file that the linter does not measure (anything but TypeScript and JavaScript) has
//   at most 800 lines of code (lines-of-code.mjs): a line that holds nothing but a comment, in the
//   comment syntax of its language (a Python docstring included), and a blank line are left out,
//   and so are a Rust file's #[cfg(test)] modules and the generated files listed below; a comment
//   "long: <reason>" on the first line, or the second after a "#!" line, exempts a file.
// - TOOL-02: a shell script starts with `set -euo pipefail` and quotes every expansion
//   (shell-source.mjs).
// - TOOL-03: a Python script imports the standard library alone, or packages pinned with their
//   hashes in "<script>-requirements.txt" next to it.
// - TS-09: the names of the files in src/, test/ and scripts/ are kebab-case.
// - CORE-25: every dependency is pinned to an exact version.
// - TOOL-05: pnpm-lock.yaml is the only lockfile.
// - TS-06: an error class's name ends in "Error", and it carries a `readonly code`.
// - CORE-23: source and tooling use coded errors, not direct native Error construction.
// - TS-08: no `enum`.
// - TS-05: no `private` keyword; private fields and methods are `#name`.
// - TS-11: every exported declaration of a library module (src/ outside the command line), every
//   public member of an exported class or interface there, and every member of the object types
//   that an exported type alias there is made of, has a `/** … */` comment (CORE-20).
// - TS-12: every lint exception names its rules and gives its reason after "--".
// - WEB-01: no `on…=` handler in markup.
//
// The audit records and their harnesses in docs/audits/ are frozen evidence, and the files that the
// SSKR engine's build writes (sskr-wasm/generated/) are its output: neither is read, as the
// formatter leaves them out.
//
//   node scripts/verify-code-rules.mjs

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { linesOfCode } from "./lines-of-code.mjs";
import { isShellScript, readShell } from "./shell-source.mjs";
import { afterGroup, MEMBER_MODIFIERS, tokensOf } from "./source-tokens.mjs";
import { isRepositoryTopLevel, trackedOrNewFiles } from "./git-top-level.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
/** CORE-15: the most lines of code a file may have. */
const MAX_FILE_LINES = 800;
/**
 * Frozen evidence, never changed after its audit, and a build's output: left out of every check.
 */
const LEFT_OUT = ["docs/audits/", "sskr-wasm/generated/"];
/** Files that a tool writes, left out of the file length (CORE-15). */
const GENERATED = new Set(["pnpm-lock.yaml", "sskr-wasm/LINKED_LICENSES.txt"]);
/** Lockfiles of the package managers other than pnpm (TOOL-05). */
const OTHER_LOCKFILES = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
/** The folders whose file names are kebab-case (TS-09). */
const KEBAB_FOLDERS = ["src/", "test/", "scripts/"];
/** A kebab-case file name: lower-case words joined by hyphens, with one or more extensions. */
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+)+$/u;
/** The command line: a front end, whose exports need no doc comment (TS-11). */
const FRONT_END = ["src/cli/", "src/mnemocode.ts"];
/** The error classes of JavaScript itself, which a project's error class extends (TS-06). */
const BUILT_IN_ERRORS = new Set([
  "Error",
  "AggregateError",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
]);
/** A name in JavaScript: a letter, `_` or `$`, then letters, digits, `_` and `$`. */
const IDENTIFIER = /^[\p{L}_$][\p{L}\p{N}_$]*$/u;
/** An exact version: digits, dots and an optional pre-release, no range (CORE-25). */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
/** The keywords after `export` that start a declaration, which needs a doc comment (TS-11). */
const DECLARATIONS = new Set([
  "abstract",
  "async",
  "class",
  "const",
  "declare",
  "function",
  "interface",
  "let",
  "type",
  "var",
]);

const problems = [];
/** Records a problem of `rule` at `path`, line `line`. */
function report(path, line, rule, message) {
  problems.push({ path, line, rule, message });
}

/**
 * Every file of the repository that Git does not ignore, by its path from the root (LEFT_OUT
 * aside), each once.
 */
function repositoryFiles() {
  return listFiles()
    .map((path) => path.split("\\").join("/"))
    .filter((path) => !LEFT_OUT.some((folder) => path.startsWith(folder)))
    .sort();
}

/**
 * The files that exist in the repository, tracked or new (git-top-level.mjs); outside a Git work
 * tree, such as a copy of the scripts in a test or a review snapshot, every file under the root
 * that the root's .gitignore does not leave out (walk).
 */
function listFiles() {
  return isRepositoryTopLevel(root) ? trackedOrNewFiles(root) : walk("");
}

/**
 * The patterns of the root's .gitignore, read as Git reads the simple ones it holds: a line that
 * starts with "#" is a comment, a "/" at the end matches folders alone, a pattern with another "/"
 * is matched from the root and one without against the last name of a path, and "*" stands for any
 * letters but "/".
 */
const IGNORED = (
  existsSync(join(root, ".gitignore"))
    ? readFileSync(join(root, ".gitignore"), "utf8").split("\n")
    : []
)
  .map((line) => line.trim())
  .filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => {
    const pattern = line.replace(/\/$/u, "");
    const letters = pattern
      .replace(/^\//u, "")
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, "\\$&"));
    return {
      folders: line.endsWith("/"),
      fromRoot: pattern.includes("/"),
      matches: new RegExp(`^${letters.join("[^/]*")}$`, "u"),
    };
  });

/** Whether the root's .gitignore leaves out `path`, a folder where `folder` is true. */
function ignored(path, folder) {
  return IGNORED.some(
    (pattern) =>
      (folder || !pattern.folders) &&
      pattern.matches.test(pattern.fromRoot ? path : basename(path)),
  );
}

/**
 * Every file under `directory` of the root that the .gitignore does not leave out, by its path from
 * the root. A link is left out: Git keeps where it points, which no rule here reads, and a link to
 * a folder, such as a snapshot's node_modules, is no file.
 */
function walk(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.name === ".git" || ignored(path, entry.isDirectory())) return [];
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });
}

/** The text of `path`, or undefined for a file that is not UTF-8 text. */
function textOf(path) {
  const bytes = readFileSync(join(root, path));
  if (bytes.includes(0)) return undefined;
  return bytes.toString("utf8");
}

/** The lines of `text`, without the empty piece after a final line break. */
function linesOf(text) {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** CORE-15: the length of a file the linter does not measure, in lines of code. */
function checkLength(path, text) {
  if (GENERATED.has(path)) return;
  const code = linesOfCode(path, text);
  if (code === undefined || code.length <= MAX_FILE_LINES) return;
  const lines = linesOf(text);
  // After a "#!" line, not a Rust attribute of the crate, #![…].
  const exemption = /^#!(?!\s*\[)/u.test(lines[0] ?? "") ? 2 : 1;
  // The exemption is a comment that starts the line, in its language's syntax: a line that holds
  // no code, whose text after the comment's mark starts with "long:".
  const marked = /^\s*[^\w\s]+\s*long:\s*\S/u.test(lines[exemption - 1] ?? "");
  if (marked && !code.includes(exemption)) return;
  report(
    path,
    code[MAX_FILE_LINES],
    "CORE-15",
    `${code.length} lines of code, more than ${MAX_FILE_LINES}: split it, or say why it reads best whole in a "long: <reason>" comment on its first line`,
  );
}

/** TOOL-02: a shell script, read as `shell` (readShell), stops on its first error. */
function checkShellHeader(path, text, shell) {
  const first = Math.min(...shell.code);
  const line = linesOf(text)[first - 1]?.trim() ?? "";
  if (!/^set -euo pipefail\s*(?:#.*)?$/u.test(line))
    report(
      path,
      Number.isFinite(first) ? first : 1,
      "TOOL-02",
      "a shell script starts with `set -euo pipefail`",
    );
}

/** TOOL-02: every expansion of a shell script, read as `shell` (readShell), is quoted. */
function checkShellQuoting(path, shell) {
  for (const line of new Set(shell.unquoted))
    report(path, line, "TOOL-02", 'an expansion outside quotes: write "$name"');
}

/** The names of Python's standard library, as the installed Python 3 lists them. */
function pythonStandardLibrary() {
  const run = spawnSync(
    "python3",
    ["-I", "-c", "import json, sys; print(json.dumps(sorted(sys.stdlib_module_names)))"],
    { encoding: "utf8" },
  );
  if (run.status !== 0) {
    console.error(
      "code-rules needs Python 3.10 or later as python3, to tell its standard library apart (TOOL-03).",
    );
    process.exit(2);
  }
  return new Set(JSON.parse(run.stdout));
}

/** The top-level modules that the Python script `text` imports, each with its first line. */
function pythonImports(text) {
  const imports = new Map();
  linesOf(text).forEach((line, index) => {
    const match =
      /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import\b|import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*))/u.exec(
        line,
      );
    if (match === null) return;
    // A module renamed with "as" keeps its own name.
    const names = (match[1] ?? match[2]).split(",").map(
      (name) =>
        name
          .trim()
          .split(/\s+as\s+/u)[0]
          .split(".")[0],
    );
    for (const name of names) if (!imports.has(name)) imports.set(name, index + 1);
  });
  return imports;
}

/** Whether `name` is a module of the folder `folder`, which a script there imports. */
function isLocalModule(folder, name) {
  return existsSync(join(root, folder, `${name}.py`)) || existsSync(join(root, folder, name));
}

/**
 * The requirements files that may pin the packages of `path`: its own, and those of the scripts
 * of its folder that import it, directly or through other modules of the folder.
 */
function requirementsFilesOf(path, pythonFiles) {
  const folder = dirname(path);
  const owners = new Set([path]);
  for (let grown = true; grown;) {
    grown = false;
    for (const [other, imports] of pythonFiles)
      if (
        dirname(other) === folder &&
        !owners.has(other) &&
        [...owners].some((owner) => imports.has(basename(owner, ".py")))
      ) {
        owners.add(other);
        grown = true;
      }
  }
  return [...owners].map((owner) => join(folder, `${basename(owner, ".py")}-requirements.txt`));
}

/** Modules that Python imports under another name than the package that pip installs. */
const PYTHON_PACKAGES = new Map([
  ["PIL", "pillow"],
  ["fontTools", "fonttools"],
  ["winpty", "pywinpty"],
]);

/** A package name as pip compares names (PEP 503): lower case, runs of - _ . as one -. */
function packageKey(name) {
  return name.toLowerCase().replace(/[-_.]+/gu, "-");
}

/** The requirements of a requirements file, one per entry, without comments. */
function requirementEntries(text) {
  // A requirement continues over the lines that end in a backslash.
  return text
    .replace(/\\\r?\n/gu, " ")
    .split(/\r?\n/u)
    .map((line) => line.replace(/(^|\s)#.*$/u, "").trim())
    .filter((line) => line !== "");
}

/**
 * TOOL-03: a Python script's packages come with their hashes, in its requirements file or, for a
 * module that scripts import, in theirs; every package imported is pinned there.
 */
function checkPythonPackages(path, imports, standardLibrary, pythonFiles) {
  const folder = dirname(path);
  const packages = [...imports].filter(
    ([name]) => name !== "__future__" && !standardLibrary.has(name) && !isLocalModule(folder, name),
  );
  if (packages.length === 0) return;
  const candidates = requirementsFilesOf(path, pythonFiles);
  const present = candidates.filter((requirements) => existsSync(join(root, requirements)));
  const pinned = new Set(
    present.flatMap((requirements) =>
      requirementEntries(readFileSync(join(root, requirements), "utf8")).map((entry) =>
        packageKey(entry.split(/[\s=<>!~[;]/u)[0]),
      ),
    ),
  );
  for (const [name, line] of packages) {
    if (pinned.has(packageKey(PYTHON_PACKAGES.get(name) ?? name))) continue;
    const where =
      present.length === 0
        ? `needs its pin with hashes in ${candidates[0]}`
        : `is not pinned in ${present.join(" or ")}`;
    report(path, line, "TOOL-03", `imports ${name}, which ${where}`);
  }
}

/** TOOL-03, CORE-25: every requirement of a requirements file is exact and hashed. */
function checkRequirements(path, text) {
  for (const line of requirementEntries(text)) {
    const name = line.split(/\s/u)[0];
    if (!/^[A-Za-z0-9._-]+(?:\[[^\]]*\])?==[^\s=]+$/u.test(name))
      report(path, 1, "CORE-25", `${name} is not pinned to one version with ==`);
    if (!/--hash=sha256:[0-9a-f]{64}\b/u.test(line))
      report(path, 1, "TOOL-03", `${name} has no --hash=sha256: pin`);
  }
}

/** CORE-25: the versions of package.json and of a Cargo manifest are exact. */
function checkManifest(path, text) {
  if (basename(path) === "package.json") {
    const manifest = JSON.parse(text);
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ])
      for (const [name, version] of Object.entries(manifest[field] ?? {}))
        if (!EXACT_VERSION.test(version))
          report(path, 1, "CORE-25", `${field} ${name} is "${version}", not one exact version`);
    if (!/^pnpm@\d+\.\d+\.\d+$/u.test(manifest.packageManager ?? ""))
      report(path, 1, "TOOL-05", "packageManager names pnpm at one exact version");
  }
  if (basename(path) === "Cargo.toml") checkCargoManifest(path, text);
}

/** A section of dependencies, `[dependencies]` or a target's, also dev- and build-. */
const CARGO_DEPENDENCIES = /(?:^|\.)(?:dev-|build-)?dependencies$/u;
/** A section of one dependency, `[dependencies.<name>]` and the like. */
const CARGO_DEPENDENCY_TABLE = /(?:^|\.)(?:dev-|build-)?dependencies\.([\w-]+)$/u;

/**
 * CORE-25: every dependency of a Cargo manifest is pinned with "=", in each form TOML allows: a
 * string, an inline table, dotted keys (`name.version = …`) or a table of its own
 * (`[dependencies.name]`). Each dependency is checked once its section ends.
 */
function checkCargoManifest(path, text) {
  // The dependencies of the current section: the line that names each and its version.
  let dependencies;
  // The dependency whose own table the current section is.
  let table;
  const checkSection = () => {
    for (const [name, { line, version }] of dependencies ?? [])
      if (version === undefined || !/^=\d+\.\d+\.\d+/u.test(version))
        report(path, line, "CORE-25", `${name} is not pinned with "=x.y.z"`);
  };
  linesOf(text).forEach((line, index) => {
    const section = /^\s*\[([^\]]+)\]/u.exec(line);
    if (section !== null) {
      checkSection();
      const name = section[1].trim();
      table = CARGO_DEPENDENCY_TABLE.exec(name)?.[1];
      dependencies = table !== undefined || CARGO_DEPENDENCIES.test(name) ? new Map() : undefined;
      if (table !== undefined) dependencies.set(table, { line: index + 1, version: undefined });
      return;
    }
    const entry = /^\s*([\w-]+)(?:\.([\w-]+))?\s*=\s*(.+)$/u.exec(line);
    if (dependencies === undefined || entry === null) return;
    const [, key, field, value] = entry;
    const quoted = /^"([^"]*)"/u.exec(value)?.[1];
    if (table !== undefined) {
      if (key === "version" && field === undefined) dependencies.get(table).version = quoted;
      return;
    }
    const dependency = dependencies.get(key) ?? { line: index + 1, version: undefined };
    if (field === undefined)
      dependency.version = quoted ?? /\bversion\s*=\s*"([^"]*)"/u.exec(value)?.[1];
    else if (field === "version") dependency.version = quoted;
    dependencies.set(key, dependency);
  });
  checkSection();
}

/** TOOL-05: pnpm's lockfile and no other. */
function checkLockfiles(files) {
  for (const path of files)
    if (OTHER_LOCKFILES.has(basename(path)))
      report(path, 1, "TOOL-05", "pnpm-lock.yaml is the only lockfile; remove this one");
  if (!files.includes("pnpm-lock.yaml"))
    report("pnpm-lock.yaml", 1, "TOOL-05", "the repository needs pnpm-lock.yaml");
}

/**
 * TS-09: a file name in src/, test/ and scripts/ is kebab-case. A Python module that a script
 * imports cannot have a hyphen in its name, so Python follows PEP 8 there (TOOL-04).
 */
function checkFileName(path) {
  if (path.endsWith(".py")) return;
  if (KEBAB_FOLDERS.some((folder) => path.startsWith(folder)) && !KEBAB.test(basename(path)))
    report(path, 1, "TS-09", "file names are kebab-case: lower-case words joined by hyphens");
}

/**
 * The index of the token after the angle brackets that open at `at`: `at` itself when none open
 * there. The `>` of an arrow type, (x: T) => U, closes none.
 */
function afterAngles(tokens, at) {
  if (tokens[at]?.key !== "<") return at;
  let depth = 0;
  for (let next = at; next < tokens.length; next += 1) {
    const key = tokens[next].key;
    if (key === "<") depth += 1;
    else if (key === ">" && tokens[next - 1].key !== "=" && --depth === 0) return next + 1;
  }
  return tokens.length;
}

/** The classes of a file: name, parent, line and whether their body declares a `readonly code`. */
function classesOf(tokens) {
  const classes = [];
  tokens.forEach((token, at) => {
    if (token.key !== "class" || tokens[at - 1]?.key === ".") return;
    const name = tokens[at + 1]?.key;
    if (name === undefined || !IDENTIFIER.test(name)) return;
    // The parent follows the type parameters: class Failure<D extends object> extends Error.
    let open = afterAngles(tokens, at + 2);
    const parent = tokens[open]?.key === "extends" ? tokens[open + 1]?.key : undefined;
    // The body opens at the first brace outside angle brackets: extends Base<{ a: 1 }> is a type.
    while (open < tokens.length && tokens[open].key !== "{")
      open = tokens[open].key === "<" ? afterAngles(tokens, open) : open + 1;
    if (open === tokens.length) return;
    const body = tokens.slice(open, afterGroup(tokens, open)).map((candidate) => candidate.key);
    const code = body.some((key, index) => key === "readonly" && body[index + 1] === "code");
    classes.push({ name, parent, line: token.line, code });
  });
  return classes;
}

/** TS-06: error classes end in Error and carry a readonly code, their parents' included. */
function checkErrorClasses(classes) {
  const byName = new Map(classes.map((known) => [known.name, known]));
  const isError = (name, seen = new Set()) => {
    if (BUILT_IN_ERRORS.has(name)) return true;
    const known = byName.get(name);
    if (known?.parent === undefined || seen.has(name)) return false;
    seen.add(name);
    return isError(known.parent, seen);
  };
  const hasCode = (known) => {
    for (let at = known; at !== undefined; at = byName.get(at.parent)) if (at.code) return true;
    return false;
  };
  for (const known of classes) {
    if (known.parent === undefined || !isError(known.parent)) continue;
    if (!known.name.endsWith("Error"))
      report(
        known.path,
        known.line,
        "TS-06",
        `error class ${known.name}: its name ends in "Error"`,
      );
    if (!hasCode(known))
      report(
        known.path,
        known.line,
        "TS-06",
        `error class ${known.name} carries a readonly code from its module's list`,
      );
  }
}

/** CORE-23: native constructors carry no module code. Test fixtures may simulate such faults. */
function checkUncodedErrors(path, tokens) {
  if (!path.startsWith("src/") && !path.startsWith("scripts/")) return;
  tokens.forEach((token, at) => {
    if (!BUILT_IN_ERRORS.has(token.key) || tokens[at + 1]?.key !== "(") return;
    // A named property or method is no call of a native constructor.
    const before = tokens[at - 1]?.key;
    if (before === "." && !["globalThis", "global", "window"].includes(tokens[at - 2]?.key)) return;
    if (before === "function") return;
    report(path, token.line, "CORE-23", "use the module's coded error, not a native constructor");
  });
}

/** TS-05 and TS-08: no `private` keyword, no `enum`. */
function checkKeywords(path, tokens) {
  tokens.forEach((token, at) => {
    const before = tokens[at - 1]?.key;
    const after = tokens[at + 1]?.key ?? "";
    const declares = before !== "." && /^[\p{L}_$#]/u.test(after);
    // A private constructor is neither field nor method, and has no #name.
    if (token.key === "private" && declares && after !== "constructor")
      report(
        path,
        token.line,
        "TS-05",
        "a private field or method is #name, private at run time too",
      );
    if (token.key === "enum" && declares && tokens[at + 2]?.key === "{")
      report(
        path,
        token.line,
        "TS-08",
        "a fixed set of values is a union of string literals or an as const object",
      );
  });
}

/** Whether a `/** … *\/` comment stands right above the token at `at`. */
function documented(tokens, comments, at) {
  const { line } = tokens[at];
  const previous = tokens[at - 1]?.line ?? 0;
  const above = comments.filter((comment) => comment.last <= line && comment.first >= previous);
  const nearest = above.at(-1);
  return nearest !== undefined && nearest.text.startsWith("/**") && nearest.last >= line - 1;
}

/** TS-11: every exported declaration of a library module has a doc comment. */
function checkDocComments(path, tokens, comments) {
  let lastFunction;
  tokens.forEach((token, at) => {
    if (token.key !== "export" || !DECLARATIONS.has(tokens[at + 1]?.key ?? "")) return;
    if (tokens[at + 1].key === "type" && tokens[at + 2]?.key === "{") return;
    // The overloads of a function share the comment of the first.
    const nameAt = tokens.findIndex(
      (candidate, index) => index > at && candidate.key === "function",
    );
    const name = nameAt > at && nameAt <= at + 3 ? tokens[nameAt + 1]?.key : undefined;
    const overload = name !== undefined && name === lastFunction;
    lastFunction = name;
    if (!overload && !documented(tokens, comments, at))
      report(
        path,
        token.line,
        "TS-11",
        "an export of a library module has a /** … */ comment that says what it is for",
      );
  });
}

/** TS-12: a lint exception names its rules and its reason. */
function checkLintExceptions(path, comments) {
  for (const comment of comments) {
    const directive = /\b(?:oxlint|eslint)-(?:disable|enable)(?:-next-line|-line)?\b(.*)/su.exec(
      comment.text,
    );
    if (directive === null || directive[0].replace(/^\w+/u, "").startsWith("-enable")) continue;
    if (!/^\s+[\w/@-]+(?:\s*,\s*[\w/@-]+)*\s+--\s+\S/u.test(directive[1]))
      report(
        path,
        comment.first,
        "TS-12",
        'a lint exception names its rules and gives its reason after "--"',
      );
  }
}

/** WEB-01: markup has no inline handler, also in a tag written over several lines. */
function checkMarkup(path, text) {
  for (const handler of text.matchAll(/<[^>]*\son[a-z]+\s*=/giu))
    report(
      path,
      text.slice(0, handler.index).split("\n").length,
      "WEB-01",
      "no on…= handler in markup: the page's script adds its listeners",
    );
}

/**
 * The words that may come before the name of a member: its modifiers, and the keywords that make
 * it a method or an accessor (`async`, `get`, `set`); each may also be a name itself.
 */
const MEMBER_PREFIXES = new Set([...MEMBER_MODIFIERS, "async", "get", "set"]);
/** The tokens after which a new member of a class, an interface or an object type starts. */
const MEMBER_ENDS = new Set([";", "{", "}"]);
/** The brackets that a member's parts nest in. */
const OPENING = new Set(["(", "[", "{"]);
const CLOSING = new Set([")", "]", "}"]);

/**
 * The index of the `{` that opens the body of the class or interface whose keyword is at `at`: the
 * first one outside the parentheses, brackets and type arguments of its heritage.
 */
function bodyOpening(tokens, at) {
  let depth = 0;
  for (let index = at + 1; index < tokens.length; index += 1) {
    const { key } = tokens[index];
    if (key === "{" && depth === 0) return index;
    if (key === "(" || key === "[" || key === "<") depth += 1;
    else if (key === ")" || key === "]" || key === ">") depth -= 1;
  }
  return undefined;
}

/**
 * The member that starts at `at` in a body: its name, and whether it is public. A modifier is read
 * as one only before another name; `[` names a computed member, unless it opens an index signature
 * ([key: string]) or the keys of a mapped type ([K in Keys]), which name no member.
 */
function memberAt(tokens, at) {
  // A static block has no name, and nothing outside the class can call it.
  if (tokens[at].key === "static" && tokens[at + 1]?.key === "{")
    return { name: "", public: false };
  let index = at;
  const modifiers = new Set();
  while (
    MEMBER_PREFIXES.has(tokens[index].key) &&
    /^[\w#"'[*]/u.test(tokens[index + 1]?.key ?? "")
  ) {
    modifiers.add(tokens[index].key);
    index += 1;
  }
  if (tokens[index].key === "*") index += 1;
  const first = tokens[index];
  const name =
    first.key === "["
      ? tokens
          .slice(index, afterGroup(tokens, index))
          .map((token) => token.key)
          .join("")
      : first.key;
  const signature = first.key === "[" && [":", "in"].includes(tokens[index + 2]?.key);
  const hidden =
    modifiers.has("private") || modifiers.has("protected") || name.startsWith("#") || signature;
  return { name, public: !hidden };
}

/**
 * The `{` of each object type that the type from `from` is made of, up to its `;` or to `to`: the
 * type itself, or the arms of its unions and intersections, grouped in parentheses or not. A
 * literal that belongs to another part is left out: one in a member's type (as in an interface), in
 * a tuple, in angle brackets (type arguments and parameters), after the `extends` of a conditional
 * type (patterns, such as Extract<T, { kind: "few" }>), and in a function type's parameters or
 * result, which belong to its signature.
 */
function objectTypesOf(tokens, from, to) {
  const opens = [];
  let pattern = false;
  let index = from;
  while (index < to && tokens[index].key !== ";") {
    const { key } = tokens[index];
    let next = index + 1;
    if (key === "<") next = afterAngles(tokens, index);
    else if (OPENING.has(key)) next = afterGroup(tokens, index);
    // A function type's parameters: the rest of this part is the function's result.
    if (key === "(" && tokens[next]?.key === "=" && tokens[next + 1]?.key === ">") break;
    if (key === "(" && !pattern) opens.push(...objectTypesOf(tokens, index + 1, next - 1));
    if (key === "{" && !pattern) opens.push(index);
    // The type after `extends` runs to the `?` of its conditional type.
    if (key === "extends") pattern = true;
    else if (key === "?") pattern = false;
    index = next;
  }
  return opens;
}

/**
 * The `{` of each body whose members the export at `at` makes public: a class's or an
 * interface's, or each object type of a type alias (objectTypesOf); none for another export.
 */
function exportedBodies(tokens, at) {
  const keyword = tokens
    .slice(at + 1, at + 4)
    .findIndex((next) => next.key === "class" || next.key === "interface");
  if (keyword !== -1) {
    const open = bodyOpening(tokens, at + 1 + keyword);
    return open === undefined ? [] : [open];
  }
  // export type Name<…> = …, declared or not; export type { … } and export type * re-export.
  const type = tokens[at + 1]?.key === "declare" ? at + 2 : at + 1;
  if (tokens[type]?.key !== "type" || !IDENTIFIER.test(tokens[type + 1]?.key ?? "")) return [];
  const equals = afterAngles(tokens, type + 2);
  return tokens[equals]?.key === "=" ? objectTypesOf(tokens, equals + 1, tokens.length) : [];
}

/**
 * TS-11: every public member of the body that opens at `open` has a doc comment: a field, a
 * method, an accessor, a constructor; the overloads of a method share the comment of the first
 * (CORE-20). A member starts the body and after each `;` that ends one, and on the line after a
 * `}` that ends one, as the formatter writes them: on the line of a `}` a type goes on ({ … }[]),
 * and a line that goes on with a type or a value starts none.
 */
function checkMembers(path, tokens, comments, open) {
  const close = afterGroup(tokens, open) - 1;
  let depth = 0;
  let previous = "{";
  let lastName;
  for (let index = open + 1; index < close; index += 1) {
    const { key, line } = tokens[index];
    const ended = previous === "}" ? line > tokens[index - 1].line : MEMBER_ENDS.has(previous);
    if (depth === 0 && ended && /^[\w#"'[*(]/u.test(key)) {
      const member = memberAt(tokens, index);
      const overload = member.name === lastName;
      lastName = member.name;
      if (member.public && !overload && !documented(tokens, comments, index))
        report(
          path,
          line,
          "TS-11",
          "a public member of an exported class, interface or object type of a library module has a /** … */ comment",
        );
    }
    if (OPENING.has(key)) depth += 1;
    else if (CLOSING.has(key)) depth -= 1;
    if (depth === 0) previous = key;
  }
}

/**
 * TS-11: every public member of an exported class or interface of a library module, and of each
 * object type that an exported type alias there is made of, has a doc comment (checkMembers).
 */
function checkMemberDocComments(path, tokens, comments) {
  tokens.forEach((token, at) => {
    if (token.key !== "export") return;
    for (const open of exportedBodies(tokens, at)) checkMembers(path, tokens, comments, open);
  });
}

/** Every check of one TypeScript or JavaScript file that the linter does not cover. */
function checkScriptSource(path, text, classes) {
  const { tokens, comments } = tokensOf(text);
  checkLintExceptions(path, comments);
  checkUncodedErrors(path, tokens);
  if (!path.endsWith(".ts")) return;
  checkKeywords(path, tokens);
  for (const known of classesOf(tokens)) classes.push({ ...known, path });
  const library = path.startsWith("src/") && !FRONT_END.some((front) => path.startsWith(front));
  if (library && !path.endsWith(".d.ts")) {
    checkDocComments(path, tokens, comments);
    checkMemberDocComments(path, tokens, comments);
  }
}

const files = repositoryFiles();
const classes = [];
// Every Python file with the modules it imports, for the requirements of the modules they import.
const pythonFiles = new Map(
  files
    .filter((path) => path.endsWith(".py"))
    .map((path) => [path, pythonImports(textOf(path) ?? "")]),
);
const standardLibrary = pythonFiles.size > 0 ? pythonStandardLibrary() : new Set();
checkLockfiles(files);
for (const path of files) {
  const text = textOf(path);
  if (text === undefined) continue;
  checkFileName(path);
  checkLength(path, text);
  if (isShellScript(path, text)) {
    const shell = readShell(text);
    checkShellHeader(path, text, shell);
    checkShellQuoting(path, shell);
  }
  if (path.endsWith(".py"))
    checkPythonPackages(path, pythonFiles.get(path), standardLibrary, pythonFiles);
  if (/requirements[^/]*\.txt$/u.test(path)) checkRequirements(path, text);
  if (basename(path) === "package.json" || basename(path) === "Cargo.toml")
    checkManifest(path, text);
  if (/\.(?:ts|mts|js|mjs|cjs)$/u.test(path) && !path.includes("node_modules/"))
    checkScriptSource(path, text, classes);
  if (/\.(?:html?|svg)$/u.test(path)) checkMarkup(path, text);
}
checkErrorClasses(classes);

problems.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
for (const problem of problems)
  console.error(`${problem.path}:${problem.line} ${problem.rule} ${problem.message}`);
if (problems.length > 0) {
  console.error(
    `${problems.length} problems with the coding guide's rules: each line names its rule (see the top of ${relative(root, fileURLToPath(import.meta.url))}).`,
  );
  process.exit(1);
}
console.log(`The coding guide's code rules hold in ${files.length} files.`);

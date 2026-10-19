// Checks the rules of the workspace coding guide that the compiler, the linter and the copy check
// cannot see: the gate `code-rules` of the guide (code-core.instructions.md, "Gates by name").
// Every problem is printed with the ID of its rule, which names the rule and its reason in the
// guide:
//
// - CORE-15: a file that the linter does not measure (anything but TypeScript and JavaScript) has
//   at most 800 lines of code: a line that holds nothing but a comment, in the comment syntax of
//   its kind, and a blank line are left out. A Rust file's #[cfg(test)] module at its end and the
//   generated files listed below are left out; a comment "long: <reason>" on the first line, or
//   the second after a "#!" line, exempts a file.
// - TOOL-02: a shell script starts with `set -euo pipefail` and quotes every expansion.
// - TOOL-03: a Python script imports the standard library alone, or packages pinned with their
//   hashes in "<script>-requirements.txt" next to it.
// - TS-09: the names of the files in src/, test/ and scripts/ are kebab-case.
// - CORE-25: every dependency is pinned to an exact version.
// - TOOL-05: pnpm-lock.yaml is the only lockfile.
// - TS-06: an error class's name ends in "Error", and it carries a `readonly code`.
// - CORE-23: source and tooling use coded errors, not direct native Error construction.
// - TS-08: no `enum`.
// - TS-05: no `private` keyword; private fields and methods are `#name`.
// - TS-11: every exported declaration of a library module (src/ outside the command line) has a
//   `/** … */` comment.
// - TS-12: every lint exception names its rules and gives its reason after "--".
// - WEB-01: no `on…=` handler in markup.
//
// The audit records and their harnesses in docs/audits/ are frozen evidence, and the files that the
// SSKR engine's build writes (sskr-wasm/generated/) are its output: neither is read, as the
// formatter leaves them out.
//
//   node scripts/verify-code-rules.mjs

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensOf } from "./source-tokens.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
/** CORE-15: the most lines a file may have. */
const MAX_FILE_LINES = 800;
/**
 * Frozen evidence, never changed after its audit, and a build's output: left out of every check.
 */
const LEFT_OUT = ["docs/audits/", "sskr-wasm/generated/"];
/** Files that a tool writes, left out of the file length (CORE-15). */
const GENERATED = new Set(["pnpm-lock.yaml"]);
/**
 * The kinds of file whose length this check measures; the linter measures TypeScript and
 * JavaScript.
 */
const MEASURED = new Set([".md", ".py", ".rs", ".sh", ".toml", ".txt", ".yaml", ".yml"]);
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
 * aside).
 */
function repositoryFiles() {
  return listFiles()
    .map((path) => path.split("\\").join("/"))
    .filter((path) => !LEFT_OUT.some((folder) => path.startsWith(folder)))
    .filter((path) => existsSync(join(root, path)))
    .sort();
}

/**
 * The files Git lists for the repository, tracked and new; outside a Git work tree, such as a copy
 * of the scripts in a test, every file under the root.
 */
function listFiles() {
  const topLevel = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  });
  if (topLevel.status === 0 && resolve(topLevel.stdout.trim()) === root)
    return execFileSync(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    )
      .split("\0")
      .filter(Boolean);
  return walk("");
}

/** Every file under `directory` of the root, by its path from the root. */
function walk(directory) {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === ".git" ? [] : walk(path);
    return [path];
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

/**
 * CORE-15: the comment syntax of each kind of file whose length this check measures. Only lines of
 * code count: a line that holds nothing but a comment, and a blank line, are left out.
 */
const HASH_COMMENTS = { line: ["#"], block: [] };
const COMMENT_SYNTAX = {
  ".rs": { line: ["//"], block: [["/*", "*/"]] },
  ".md": { line: [], block: [["<!--", "-->"]] },
  ".py": HASH_COMMENTS,
  ".sh": HASH_COMMENTS,
  ".toml": HASH_COMMENTS,
  ".txt": HASH_COMMENTS,
  ".yaml": HASH_COMMENTS,
  ".yml": HASH_COMMENTS,
  Dockerfile: HASH_COMMENTS,
};

/**
 * Whether `line`, read after the comment that `open` says is still open, holds code: anything but
 * blanks and comments. Returns the closing marker of a block comment left open at its end, if any.
 */
function codeOfLine(line, syntax, open) {
  let rest = line.trim();
  let closer = open;
  for (;;) {
    if (closer !== undefined) {
      const end = rest.indexOf(closer);
      if (end < 0) return { code: false, open: closer };
      rest = rest.slice(end + closer.length).trim();
      closer = undefined;
    }
    if (rest === "" || syntax.line.some((marker) => rest.startsWith(marker)))
      return { code: false, open: undefined };
    const block = syntax.block.find(([start]) => rest.startsWith(start));
    if (block === undefined) return { code: true, open: undefined };
    rest = rest.slice(block[0].length);
    closer = block[1];
  }
}

/** CORE-15: how many of `lines` hold code, by the comment syntax of the file's kind. */
function linesOfCode(lines, syntax) {
  let count = 0;
  let open;
  for (const line of lines) {
    const read = codeOfLine(line, syntax, open);
    open = read.open;
    if (read.code) count += 1;
  }
  return count;
}

/**
 * Where a Rust file's unit tests start: a `#[cfg(test)]` module whose block closes at the end of
 * the file (RUST-08); -1 when there is none. A `#[cfg(test)]` on anything else counts as code.
 */
function rustTestModuleStart(lines) {
  for (let at = 0; at < lines.length; at += 1) {
    if (lines[at].trim() !== "#[cfg(test)]") continue;
    let module = at + 1;
    while (module < lines.length && lines[module].trim().startsWith("#[")) module += 1;
    if (!/^(?:pub(?:\([a-z]+\))?\s+)?mod\s+\w+\s*\{/u.test(lines[module]?.trim() ?? "")) continue;
    let depth = 0;
    let last = module;
    for (let line = module; line < lines.length; line += 1) {
      for (const character of lines[line]) {
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
      }
      if (lines[line].trim() !== "") last = line;
      if (depth === 0) break;
    }
    const after = lines.slice(last + 1).every((line) => line.trim() === "");
    if (depth === 0 && after) return at;
  }
  return -1;
}

/** CORE-15: the length of a file the linter does not measure, in lines of code. */
function checkLength(path, text) {
  const name = basename(path);
  if (GENERATED.has(path)) return;
  const syntax = name.startsWith("Dockerfile")
    ? COMMENT_SYNTAX.Dockerfile
    : MEASURED.has(extname(name))
      ? COMMENT_SYNTAX[extname(name)]
      : undefined;
  if (syntax === undefined) return;
  const lines = linesOf(text);
  const exemption = lines[0]?.startsWith("#!") ? lines[1] : lines[0];
  // The exemption is a comment that starts the line, not "long:" anywhere in it.
  if (exemption !== undefined && /^\s*(?:#|\/\/|\/\*|<!--)\s*long:\s*\S/u.test(exemption)) return;
  // A Rust file's unit tests sit at its end (RUST-08) and do not count.
  const tests = path.endsWith(".rs") ? rustTestModuleStart(lines) : -1;
  const counted = linesOfCode(tests < 0 ? lines : lines.slice(0, tests), syntax);
  if (counted > MAX_FILE_LINES)
    report(
      path,
      MAX_FILE_LINES + 1,
      "CORE-15",
      `${counted} lines of code, more than ${MAX_FILE_LINES}: split it, or say why it reads best whole in a "long: <reason>" comment on its first line`,
    );
}

/** Whether `text` is a shell script: by its name or by its first line. */
function isShellScript(path, text) {
  return (
    path.endsWith(".sh") ||
    /^#!\s*\/(?:usr\/)?bin\/(?:env\s+(?:-S\s+)?)?(?:ba|da|z)?sh\b/u.test(text)
  );
}

/** TOOL-02: a shell script stops on its first error. */
function checkShellHeader(path, text) {
  const lines = linesOf(text);
  const first = lines.findIndex((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  if (first < 0 || !/^set -euo pipefail\s*(?:#.*)?$/u.test(lines[first].trim()))
    report(path, first + 1, "TOOL-02", "a shell script starts with `set -euo pipefail`");
}

/**
 * TOOL-02: an expansion outside quotes ($name, ${name}, $(command), $1) in a shell script; the text
 * after an unquoted # is a comment.
 */
function unquotedExpansion(line) {
  let quote;
  for (let at = 0; at < line.length; at += 1) {
    const character = line[at];
    if (character === "\\" && quote !== "'") {
      at += 1;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === "'" || character === '"') quote = character;
    else if (character === "#" && (at === 0 || /\s/u.test(line[at - 1]))) return false;
    else if (character === "$" && /[\p{L}_{(0-9@*#?!-]/u.test(line[at + 1] ?? "")) return true;
  }
  return false;
}

/** TOOL-02: every expansion of a shell script is quoted. */
function checkShellQuoting(path, text) {
  linesOf(text).forEach((line, index) => {
    if (unquotedExpansion(line))
      report(path, index + 1, "TOOL-02", 'an expansion outside quotes: write "$name"');
  });
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

/** The index of the token after the brace that closes the one at `open`. */
function afterBlock(tokens, open) {
  let depth = 0;
  for (let at = open; at < tokens.length; at += 1) {
    if (tokens[at].key === "{") depth += 1;
    else if (tokens[at].key === "}" && --depth === 0) return at + 1;
  }
  return tokens.length;
}

/** The classes of a file: name, parent, line and whether their body declares a `readonly code`. */
function classesOf(tokens) {
  const classes = [];
  tokens.forEach((token, at) => {
    if (token.key !== "class" || tokens[at - 1]?.key === ".") return;
    const name = tokens[at + 1]?.key;
    if (name === undefined || !/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(name)) return;
    const open = tokens.findIndex((candidate, index) => index > at && candidate.key === "{");
    if (open < 0) return;
    const head = tokens.slice(at + 2, open).map((candidate) => candidate.key);
    // After type parameters too: class Failure<Detail> extends Error.
    const extendsAt = head.indexOf("extends");
    const parent = extendsAt < 0 ? undefined : head[extendsAt + 1];
    const body = tokens.slice(open, afterBlock(tokens, open)).map((candidate) => candidate.key);
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

/** Every check of one TypeScript or JavaScript file that the linter does not cover. */
function checkScriptSource(path, text, classes) {
  const { tokens, comments } = tokensOf(text);
  checkLintExceptions(path, comments);
  checkUncodedErrors(path, tokens);
  if (!path.endsWith(".ts")) return;
  checkKeywords(path, tokens);
  for (const known of classesOf(tokens)) classes.push({ ...known, path });
  const library = path.startsWith("src/") && !FRONT_END.some((front) => path.startsWith(front));
  if (library && !path.endsWith(".d.ts")) checkDocComments(path, tokens, comments);
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
    checkShellHeader(path, text);
    checkShellQuoting(path, text);
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

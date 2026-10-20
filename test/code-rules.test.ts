import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

// scripts/verify-code-rules.mjs, the gate `code-rules` of the coding guide, run over small trees
// of files in a temporary folder: each rule refuses its case and takes the case that keeps it.

/** A tree that keeps every rule: a pnpm manifest with exact versions and its lockfile. */
const BASE: Readonly<Record<string, string>> = {
  "package.json": JSON.stringify({
    packageManager: "pnpm@12.8.1",
    dependencies: { "@scure/bip39": "2.4.0" },
  }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
};

/** The gate's script and the modules it imports. */
const GATE = [
  "verify-code-rules.mjs",
  "lines-of-code.mjs",
  "shell-source.mjs",
  "source-cursor.mjs",
  "source-tokens.mjs",
  "git-top-level.mjs",
];

/** Whether Python 3 runs here, which the gate asks for its standard library (TOOL-03). */
const PYTHON = spawnSync("python3", ["--version"]).status === 0;

/**
 * The gate run over BASE with `files` added (a null removes one), after `prepare` has had the
 * tree: its exit code and its lines.
 */
function codeRules(
  files: Readonly<Record<string, string | null>>,
  prepare?: (root: string) => void,
): {
  readonly status: number | null;
  readonly problems: string;
} {
  const root = mkdtempSync(join(tmpdir(), "mnemocode-code-rules-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const script of GATE) copyFileSync(join("scripts", script), join(root, "scripts", script));
    for (const [path, text] of Object.entries({ ...BASE, ...files })) {
      if (text === null) continue;
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    prepare?.(root);
    const run = spawnSync(process.execPath, [join(root, "scripts", "verify-code-rules.mjs")], {
      encoding: "utf8",
    });
    return { status: run.status, problems: run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The problems that the gate prints for `files` (codeRules), each as its path, line and rule. */
function problemsOf(
  files: Readonly<Record<string, string | null>>,
  prepare?: (root: string) => void,
): string[] {
  return [...codeRules(files, prepare).problems.matchAll(/^(\S+:\d+ \S+) /gmu)].map(
    (match) => match[1]!,
  );
}

/** `count` copies of `line`, each with its line break. */
function repeated(count: number, line: string): string {
  return `${line}\n`.repeat(count);
}

/** The rule IDs that the gate names for `files`, each once. */
function rulesBroken(files: Readonly<Record<string, string | null>>): string[] {
  const { problems } = codeRules(files);
  return [...new Set([...problems.matchAll(/^\S+:\d+ (\S+) /gmu)].map((match) => match[1]!))];
}

describe("the code rules of the coding guide", () => {
  it("refuse native errors in source and tooling, while allowing simulated test faults", () => {
    for (const path of ["src/cli/a.ts", "scripts/check.mjs"])
      for (const constructor of ["Error", "TypeError", "RangeError", "SyntaxError"])
        for (const prefix of ["new ", "", "new globalThis."])
          expect(rulesBroken({ [path]: `throw ${prefix}${constructor}("Refused.");\n` })).toEqual([
            "CORE-23",
          ]);
    expect(rulesBroken({ "test/a.test.ts": 'throw new Error("Synthetic fault.");\n' })).toEqual([]);
    expect(rulesBroken({ "src/cli/a.ts": '// new Error("A comment.")\n' })).toEqual([]);
    expect(rulesBroken({ "src/cli/a.ts": 'const hint = "new Error()";\n' })).toEqual([]);
    expect(rulesBroken({ "src/cli/a.ts": 'throw ERRORS.create("refused", []);\n' })).toEqual([]);
  });

  it("pass a tree that keeps every rule", () => {
    expect(codeRules({})).toEqual({ status: 0, problems: "" });
  });

  it.skipIf(!PYTHON)("refuse a Python package without its pin and hashes", () => {
    const script = { "scripts/trace.py": "import json\nimport numpy as np\n" };
    expect(rulesBroken(script)).toEqual(["TOOL-03"]);
    const hashed = `numpy==2.5.4 \\\n    --hash=sha256:${"0".repeat(64)}\n`;
    expect(rulesBroken({ ...script, "scripts/trace-requirements.txt": hashed })).toEqual([]);
    expect(
      rulesBroken({ ...script, "scripts/trace-requirements.txt": "numpy>=2\n" }).sort(),
    ).toEqual(["CORE-25", "TOOL-03"]);
    // A module that a script imports shares the script's requirements.
    expect(
      rulesBroken({
        "scripts/trace.py": "import shared\n",
        "scripts/shared.py": "import numpy\n",
        "scripts/trace-requirements.txt": hashed,
      }),
    ).toEqual([]);
    // The requirements file pins every package imported, under its published name (AUD-024-BLD001).
    const two = { "scripts/trace.py": "import numpy\nfrom PIL import Image\n" };
    expect(rulesBroken({ ...two, "scripts/trace-requirements.txt": hashed })).toEqual(["TOOL-03"]);
    const pillow = `Pillow==12.3.0 \\\n    --hash=sha256:${"0".repeat(64)}\n`;
    expect(rulesBroken({ ...two, "scripts/trace-requirements.txt": hashed + pillow })).toEqual([]);
    // Every module of one import line counts, renamed or not.
    const renamed = { "scripts/trace.py": "import json as j, numpy\n" };
    expect(rulesBroken(renamed)).toEqual(["TOOL-03"]);
  });

  it("refuse file names that are not kebab-case where the code lives", () => {
    expect(rulesBroken({ "src/CardSheet.ts": "" })).toEqual(["TS-09"]);
    expect(rulesBroken({ "src/card-sheet.ts": "", "docs/README.md": "" })).toEqual([]);
  });

  it("refuse a dependency without an exact version, and another lockfile than pnpm's", () => {
    const ranged = JSON.stringify({
      packageManager: "pnpm@12.8.1",
      devDependencies: { vitest: "^5.0.3" },
    });
    expect(rulesBroken({ "package.json": ranged })).toEqual(["CORE-25"]);
    expect(rulesBroken({ "crate/Cargo.toml": '[dependencies]\nsskr = "0.12.0"\n' })).toEqual([
      "CORE-25",
    ]);
    expect(rulesBroken({ "crate/Cargo.toml": '[dependencies]\nsskr = "=0.12.0"\n' })).toEqual([]);
    // A dependency written as a table or with dotted keys is checked too (AUD-024-BLD002).
    for (const manifest of [
      '[dependencies.sskr]\nversion = "0.12.0"\n',
      '[dev-dependencies.sskr]\nversion = "~0.12"\n',
      "[target.'cfg(unix)'.dependencies.sskr]\nversion = \"0.12.0\"\n",
      '[dependencies.sskr]\nfeatures = ["std"]\n',
      '[dependencies]\nsskr.version = "0.12.0"\n',
    ])
      expect(rulesBroken({ "crate/Cargo.toml": manifest })).toEqual(["CORE-25"]);
    for (const manifest of [
      '[dependencies.sskr]\nversion = "=0.12.0"\nfeatures = ["std"]\n',
      '[dependencies]\nsskr.version = "=0.12.0"\nsskr.features = ["std"]\n',
    ])
      expect(rulesBroken({ "crate/Cargo.toml": manifest })).toEqual([]);
    expect(rulesBroken({ "package-lock.json": "{}" })).toEqual(["TOOL-05"]);
    expect(rulesBroken({ "pnpm-lock.yaml": null })).toEqual(["TOOL-05"]);
  });
});

describe("the length of a file in lines of code (CORE-15)", () => {
  it("refuse a file of more than 800 lines of code, unless it says why", () => {
    const long = "line\n".repeat(801);
    expect(rulesBroken({ "docs/long.md": long })).toEqual(["CORE-15"]);
    expect(
      rulesBroken({ "docs/long.md": `<!-- long: one table of every code -->\n${long}` }),
    ).toEqual([]);
    // Only a comment that starts the line exempts a file, not "long:" anywhere in it.
    expect(rulesBroken({ "docs/long.md": `A table too long: every code\n${long}` })).toEqual([
      "CORE-15",
    ]);
    // A Rust attribute of the crate, #![…], is code, not a "#!" line before the comment.
    const code = repeated(801, "fn f() {}");
    for (const [first, second, broken] of [
      ["#![forbid(unsafe_code)]", "// long: one table", ["CORE-15"]],
      ["// long: one table", "#![forbid(unsafe_code)]", []],
    ] as const)
      expect(rulesBroken({ "a.rs": `${first}\n${second}\n${code}` })).toEqual(broken);
    // A Rust file's unit tests do not count.
    const rust = `${"fn f() {}\n".repeat(700)}#[cfg(test)]\nmod tests {\n${"fn t() {}\n".repeat(200)}}\n`;
    expect(rulesBroken({ "crate/src/lib.rs": rust })).toEqual([]);
    // A #[cfg(test)] on anything but a module leaves its lines counted, and a module's own lines
    // are all that is left out.
    const early = `#[cfg(test)]\nfn helper() {}\n${"fn f() {}\n".repeat(801)}`;
    expect(rulesBroken({ "crate/src/lib.rs": early })).toEqual(["CORE-15"]);
    const middle = `#[cfg(test)]\nmod early {\n}\n${"fn f() {}\n".repeat(801)}`;
    expect(rulesBroken({ "crate/src/lib.rs": middle })).toEqual(["CORE-15"]);
  });

  it("leave out what the .gitignore leaves out and every link, outside a Git checkout", () => {
    const long = "line\n".repeat(801);
    const ignore = "# Built.\nnode_modules/\ndist/\nexport-*/\ndocs/*-evidence/\ndraft.md\n";
    const files = {
      ".gitignore": ignore,
      "dist/cli.md": long,
      "export-1/cards.md": long,
      "docs/AUD-1-evidence/run.md": long,
      "docs/a/draft.md": long,
      "modules/a.md": long,
    };
    // A review snapshot links its node_modules to those of the checkout.
    expect(
      problemsOf(files, (root) => symlinkSync(join(root, "modules"), join(root, "node_modules"))),
    ).toEqual(["modules/a.md:801 CORE-15"]);
    expect(problemsOf({ ...files, ".gitignore": "dist\n" })).toEqual([
      "docs/a/draft.md:801 CORE-15",
      "docs/AUD-1-evidence/run.md:801 CORE-15",
      "export-1/cards.md:801 CORE-15",
      "modules/a.md:801 CORE-15",
    ]);
  });

  it("leave out every test module of a Rust file, however it is written", () => {
    const tests = (head: string, body: string): string =>
      `${head}\n${repeated(200, "    #[test] fn t() { assert!(true); }")}${body}}\n`;
    for (const module of [
      // Two modules, the first not at the end.
      `${tests("#[cfg(test)]\nmod a {", "")}${tests("#[cfg(test)]\nmod b {", "")}`,
      // Braces in character literals, strings and comments, and a comment after the module.
      `${tests("#[cfg(test)]\nmod tests {", "    assert_eq!('{', '{'); // A } in prose.\n    let _ = \"}\";\n")}// The end.\n`,
      // A comment after the attribute, and a module public within a path.
      tests("#[cfg(test)] // Unit tests.\n#[allow(dead_code)]\npub(in crate::a) mod t {", ""),
    ])
      expect(rulesBroken({ "crate/src/lib.rs": `${repeated(800, "fn f() {}")}${module}` })).toEqual(
        [],
      );
  });

  it("name the first line of code over the limit", () => {
    const text = `${repeated(300, "// Why.")}${repeated(801, "fn f() {}")}`;
    expect(problemsOf({ "a.rs": text })).toEqual(["a.rs:1101 CORE-15"]);
  });

  it("count lines of code only: comment lines and blank lines are left out", () => {
    const code = (count: number, line: string): string => `${line}\n`.repeat(count);
    // 800 lines of code with comments and blank lines between them stay within the limit.
    const rust = `${code(800, "fn f() {}")}${code(300, "// Why.")}/* A block\n${code(100, "of text")}*/\n${"\n".repeat(200)}`;
    expect(rulesBroken({ "crate/src/lib.rs": rust })).toEqual([]);
    expect(rulesBroken({ "crate/src/lib.rs": code(801, "fn f() {}") })).toEqual(["CORE-15"]);
    // A line of code that ends in a comment counts once.
    expect(rulesBroken({ "crate/src/lib.rs": code(801, "fn f() {} // why") })).toEqual(["CORE-15"]);
    const python = `${code(800, "x = 1")}${code(300, "# Why.")}${"\n".repeat(100)}`;
    expect(rulesBroken({ "scripts/a.py": python })).toEqual([]);
    expect(rulesBroken({ "scripts/a.py": code(801, "x = 1") })).toEqual(["CORE-15"]);
    const markdown = `${code(800, "A sentence.")}<!--\n${code(300, "a note")}-->\n${"\n".repeat(300)}`;
    expect(rulesBroken({ "docs/a.md": markdown })).toEqual([]);
    expect(rulesBroken({ "docs/a.md": code(801, "A sentence.") })).toEqual(["CORE-15"]);
  });
});

describe("the lines of code of each language (CORE-15)", () => {
  it("read Rust's strings, character literals and nested comments", () => {
    const over = repeated(800, "fn f() {}");
    // Lines inside a string that start like a comment are code.
    expect(rulesBroken({ "a.rs": `const G: &str = "src/**\n/*.rs";\n${over}` })).toEqual([
      "CORE-15",
    ]);
    expect(rulesBroken({ "a.rs": `const R: &str = r#"\n// "quoted"\n"#;\n${over}` })).toEqual([
      "CORE-15",
    ]);
    // Lifetimes start no character literal: each of these lines counts.
    expect(rulesBroken({ "a.rs": repeated(801, "fn f<'a>(x: &'a str) -> &'a str { x }") })).toEqual(
      ["CORE-15"],
    );
    // The text after a nested comment's inner close is still comment.
    const nested = `/* An outer /* inner */ comment\n${repeated(300, "still a comment")}*/\n${over}`;
    expect(rulesBroken({ "a.rs": nested })).toEqual([]);
    // Byte strings, C strings, raw strings that hold a quote and a hash, and raw names.
    for (const line of [
      'const B: &[u8] = b"/*";',
      'const C: &CStr = c"/*";',
      'const R: &str = r##"a "# /* b"##;',
      'let r#type = "/*";',
      "let q = '\\''; let s = \"/*\";",
    ])
      expect(rulesBroken({ "a.rs": repeated(801, line) })).toEqual(["CORE-15"]);
    // A quote in a character literal opens no string.
    const quote = `let q = '"';\n${repeated(300, '// " is no string')}${repeated(799, "fn f() {}")}`;
    expect(rulesBroken({ "a.rs": quote })).toEqual([]);
    // A comment that opens after code on its line goes on over the lines after it.
    const after = `fn g() {} /* Why:\n${repeated(300, "the reason")}*/\n${repeated(799, "fn f() {}")}`;
    expect(rulesBroken({ "a.rs": after })).toEqual([]);
  });

  it("read Markdown's code blocks and inline code as text, and its comments", () => {
    const over = repeated(800, "A sentence.");
    // A code block, fenced with backticks or tildes, indented in a list or not, and inline code
    // are text, whatever they hold.
    for (const [open, close] of [
      ["```html", "```"],
      ["~~~", "~~~"],
      ["      ```", "      ```"],
    ])
      expect(rulesBroken({ "docs/a.md": `${open}\n<!-- An example.\n${close}\n${over}` })).toEqual([
        "CORE-15",
      ]);
    // A block ends at its closing fence: a comment after it is one.
    const closed = `\`\`\`\ncode\n\`\`\`\n<!--\n${repeated(300, "a note")}-->\n${repeated(797, "A sentence.")}`;
    expect(rulesBroken({ "docs/a.md": closed })).toEqual([]);
    // A fence four columns right of the opening one is text of the block, and closes nothing.
    const shifted = `\`\`\`markdown\n    \`\`\`\n<!-- Inside.\n${repeated(300, "inside")}-->\n\`\`\`\n${repeated(500, "A sentence.")}`;
    expect(rulesBroken({ "docs/a.md": shifted })).toEqual(["CORE-15"]);
    const inline = `Write \`<!--\` to open a comment.\n${over}`;
    expect(rulesBroken({ "docs/a.md": inline })).toEqual(["CORE-15"]);
    // A shorter fence, or one with text after it, closes no block.
    for (const inside of ["```", "``` text"])
      expect(
        rulesBroken({ "docs/a.md": `\`\`\`\`\n${inside}\n<!-- An example.\n\`\`\`\`\n${over}` }),
      ).toEqual(["CORE-15"]);
    // Backticks after a fence of backticks make it no fence: the comment below it is one.
    const notFence = `\`\`\` a\`b\n<!--\n${repeated(300, "a note")}-->\n${repeated(799, "A sentence.")}`;
    expect(rulesBroken({ "docs/a.md": notFence })).toEqual([]);
    // Text after a comment that closes on its line is a line of text.
    expect(rulesBroken({ "docs/a.md": repeated(801, "<!-- A note. --> A sentence.") })).toEqual([
      "CORE-15",
    ]);
  });

  it("read Python's and TOML's strings, and leave out Python's docstrings", () => {
    // A line of a Python string that starts with # is text.
    const python = `TEXT = """\n${repeated(801, "# A heading of the text.")}"""\n`;
    expect(rulesBroken({ "scripts/a.py": python })).toEqual(["CORE-15"]);
    // A docstring, of the module or of a function, is the language's documentation comment.
    const notes = repeated(300, "    Why it is so.");
    const documented = `"""The module.\n${notes}"""\ndef f():\n    """What f does.\n${notes}    """\n${repeated(799, "x = 1")}`;
    expect(rulesBroken({ "scripts/a.py": documented })).toEqual([]);
    expect(
      rulesBroken({ "scripts/a.py": documented.replace('    """What', '    r"""What') }),
    ).toEqual([]);
    // An f-string, a string after the first statement of a function, and a string inside
    // brackets are no docstrings.
    const body = (string: string): string =>
      `def f():\n${string}\n${notes}"""\n${repeated(500, "x = 1")}`;
    for (const string of [
      '    return"""Not a docstring.',
      '    f"""Not a docstring.',
      '    x = 1\n    """Not first.',
      '    d = {\n        "key":\n        """A value.',
    ])
      expect(rulesBroken({ "scripts/a.py": body(string) })).toEqual(["CORE-15"]);
    // Nor is a string after a def whose body is on its own line.
    const after = `def f(): return 1\n"""Not a docstring.\n${notes}"""\n${repeated(500, "x = 1")}`;
    expect(rulesBroken({ "scripts/a.py": after })).toEqual(["CORE-15"]);
    // A TOML literal string takes no escapes: 'C:\' ends where it seems to.
    const toml = `path = 'C:\\'\n${repeated(300, "# Why.")}${repeated(799, "a = 1")}`;
    expect(rulesBroken({ "a.toml": toml })).toEqual([]);
  });

  it("read a shell script's here-documents as text and its here-strings as code", () => {
    const shell = "#!/usr/bin/env bash\nset -euo pipefail\n";
    const body = `${shell}cat <<'EOF'\n${repeated(800, "# A line of the text.")}EOF\n`;
    expect(rulesBroken({ "scripts/a.sh": body })).toEqual(["CORE-15"]);
    const commented = `${shell}${repeated(300, "# Why.")}${repeated(799, "echo")}`;
    expect(rulesBroken({ "scripts/a.sh": commented })).toEqual([]);
    // A here-string opens no here-document: the comments after it are comments.
    const here = `${shell}grep -q x <<< "$text"\n${repeated(300, "# Why.")}${repeated(798, "echo")}`;
    expect(rulesBroken({ "scripts/a.sh": here })).toEqual([]);
  });
});

describe("the shell scripts of the coding guide (TOOL-02)", () => {
  it("refuse a shell script that does not stop on its first error", () => {
    expect(rulesBroken({ "scripts/run.sh": "#!/usr/bin/env bash\nset -u\necho\n" })).toEqual([
      "TOOL-02",
    ]);
    expect(
      rulesBroken({ "scripts/run.sh": "#!/usr/bin/env bash\n# Runs it.\nset -euo pipefail\n" }),
    ).toEqual([]);
    // A script without the .sh ending, started through env -S, is a shell script too.
    expect(rulesBroken({ "tools/run": "#!/usr/bin/env -S bash -e\nset -u\necho\n" })).toEqual([
      "TOOL-02",
    ]);
  });

  it("refuse an expansion outside quotes in a shell script, not one inside them", () => {
    const script = (body: string): string => `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`;
    for (const body of [
      "rm -rf $1/build",
      "cp ${source} out",
      "echo $(date)",
      'echo "a" $name',
      // An expansion inside a command substitution is outside quotes again.
      'echo "$(basename $file)"',
      "echo `date`",
      "echo $$",
      "echo $'it\\'s' $x",
      "cat <<< $x",
      "x=$((1 + 2))",
    ])
      expect(rulesBroken({ "scripts/run.sh": script(body) })).toEqual(["TOOL-02"]);
    for (const body of [
      'rm -rf "$1/build"',
      'cp "${source}" out',
      'echo "$(date)"',
      "echo '$literal'",
      "echo price \\$5",
      "# $comment",
      'echo "done" # $note',
      // Quotes inside a command substitution inside quotes.
      'cd "$(dirname "$0")"',
      'root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"',
      // A string over two lines, arithmetic, and a default value that expands.
      'echo "first\n$second"',
      'echo "$((1 + $count))"',
      "(( count += $step ))",
      'for((i = 0; i < $n; i++)); do echo "$i"; done',
      'while((i < $n)); do echo "$i"; break; done',
      // Arithmetic in a case arm and after time.
      'case "$1" in -n) ((count = $2)) ;; esac',
      "time ((total = $a + $b))",
      'x="${a:-$b}"',
      // The body of a here-document is text.
      "cat <<EOF\nVersion: $version\nEOF",
      "cat <<'EOF'\n$literal\nEOF",
      "cat <<-EOF\n\t$x\n\tEOF",
    ])
      expect(rulesBroken({ "scripts/run.sh": script(body) })).toEqual([]);
    // After a here-document, the script is code again: line 6 is its first line after the body,
    // also with Windows line ends.
    for (const end of ["\n", "\r\n"])
      expect(
        problemsOf({
          "scripts/run.sh": script(["cat <<EOF", "$x", "EOF", "echo $after"].join(end)),
        }),
      ).toEqual(["scripts/run.sh:6 TOOL-02"]);
    // Parentheses that group a pattern open no arithmetic: the line after them is read too.
    for (const test of [
      '[[ "$x" =~ ^((a|b)c)$ ]]',
      '[[ "$x" =~ a|((b|c)d) ]]',
      '[[ "$x" == @((a|b)c) ]]',
      // A shift inside arithmetic opens no here-document.
      'case "$1" in -s) ((mask |= 1 << bit)) ;; esac',
    ])
      expect(problemsOf({ "scripts/run.sh": script(`${test}\nrm -rf $dir`) })).toEqual([
        "scripts/run.sh:4 TOOL-02",
      ]);
    // A here-string is code, quoted or not: the line after it is read too.
    for (const here of ['grep -q x <<< "$text"', "grep -q x <<<'word'", "read -r a b <<< word"])
      expect(problemsOf({ "scripts/run.sh": script(`${here}\nrm -rf $dir`) })).toEqual([
        "scripts/run.sh:4 TOOL-02",
      ]);
  });
});

describe("the TypeScript and markup rules of the coding guide", () => {
  it("refuse an error class without the Error suffix or a readonly code", () => {
    expect(rulesBroken({ "src/a.ts": "class Refused extends Error {}\n" })).toEqual(["TS-06"]);
    // A generic class is an error class too.
    for (const parameters of [
      "<D>",
      "<D extends object>",
      "<D extends Map<string, Array<number>>>",
      "<D = {}>",
      // The > of an arrow type closes no angle bracket.
      "<F extends (x: number) => string>",
    ])
      expect(
        rulesBroken({ "src/cli/a.ts": `class Failure${parameters} extends Error {}\n` }),
      ).toEqual(["TS-06"]);
    // An Error in a type parameter is no parent.
    expect(rulesBroken({ "src/cli/a.ts": "export class Holder<E extends Error> {}\n" })).toEqual(
      [],
    );
    const coded = [
      'class RefusedError extends Error {\n  readonly code: "refused" = "refused";\n}',
      // A subclass carries its parent's code.
      "class NarrowError extends RefusedError {}",
    ].join("\n");
    expect(rulesBroken({ "src/cli/a.ts": coded })).toEqual([]);
    expect(
      codeRules({ "src/cli/a.ts": "class RefusedError extends TypeError {}\n" }).problems,
    ).toMatch(/readonly code/u);
  });

  it("refuse enum and the private keyword, not a private constructor", () => {
    expect(rulesBroken({ "src/cli/a.ts": "enum Kind {\n  A,\n}\n" })).toEqual(["TS-08"]);
    expect(rulesBroken({ "src/cli/a.ts": "class A {\n  private x = 1;\n}\n" })).toEqual(["TS-05"]);
    const factory = "class A {\n  #x = 1;\n  private constructor() {}\n  static of() {}\n}\n";
    expect(rulesBroken({ "src/cli/a.ts": factory })).toEqual([]);
    // A property named private is no keyword.
    expect(rulesBroken({ "src/cli/a.ts": "const flags = { private: true };\n" })).toEqual([]);
  });

  it("refuse an export of a library module without a doc comment, not of the command line", () => {
    const bare = "export const LIMIT = 3;\n";
    expect(rulesBroken({ "src/core/a.ts": bare })).toEqual(["TS-11"]);
    expect(rulesBroken({ "src/cli/a.ts": bare })).toEqual([]);
    const documented = [
      "/** The most marks. */",
      "export const LIMIT = 3;",
      "/** The parts of `text`. */",
      "export function parts(text: string): string[];",
      "export function parts(text: string, at: number): string[];",
      "export function parts(text: string): string[] {",
      "  return [text];",
      "}",
      'export { LIMIT as MAX } from "./b.js";',
    ].join("\n");
    expect(rulesBroken({ "src/core/a.ts": documented })).toEqual([]);
    // A line comment is no doc comment.
    expect(rulesBroken({ "src/core/a.ts": `// The most marks.\n${bare}` })).toEqual(["TS-11"]);
  });

  it("refuse a public member of an exported class or interface without a doc comment", () => {
    const source = [
      "/** A count. */",
      "export class Counter {",
      "  /** The count so far. */",
      "  readonly total: number;",
      "  #hidden = 0;",
      "  static {",
      "    Counter.prototype.toString = () => '';",
      "  }",
      "  /** Takes `total`. */",
      "  constructor(total: number) {",
      "    this.total = total;",
      "  }",
      "  /** One more, or `step` more. */",
      "  add(): number;",
      "  add(step: number): number;",
      "  add(step = 1): number {",
      "    return this.total + step + this.#hidden;",
      "  }",
      "  /** Whether it is zero. */",
      "  get zero(): boolean {",
      "    return this.total === 0;",
      "  }",
      "  /** Ends it. */",
      "  [Symbol.dispose](): void {}",
      "  /** Its kind. */",
      "  readonly kind:",
      '    | "small"',
      '    | "large" = "small";',
      "  /** Counts later. */",
      "  readonly later = async (): Promise<number> => {",
      "    return this.total;",
      "  };",
      "}",
      "/** What a count says. */",
      "export interface Said {",
      "  /** The words. */",
      "  readonly words: {",
      "    readonly first: string;",
      "  };",
      "  [name: string]: unknown;",
      "}",
      "/** Made once. */",
      "export class Once {",
      "  private constructor() {}",
      "}",
    ].join("\n");
    expect(problemsOf({ "src/core/a.ts": source })).toEqual([]);
    const bare = source
      .split("\n")
      .filter((line) => !/^ {2}\/\*\*/u.test(line))
      .join("\n");
    expect(problemsOf({ "src/core/a.ts": bare })).toEqual([
      "src/core/a.ts:3 TS-11",
      "src/core/a.ts:8 TS-11",
      "src/core/a.ts:11 TS-11",
      "src/core/a.ts:16 TS-11",
      "src/core/a.ts:19 TS-11",
      "src/core/a.ts:20 TS-11",
      "src/core/a.ts:23 TS-11",
      "src/core/a.ts:29 TS-11",
    ]);
    expect(problemsOf({ "src/cli/a.ts": bare })).toEqual([]);
  });

  it("refuse a lint exception without its rule and reason, and a handler in markup", () => {
    const bare = "// oxlint-disable-next-line max-lines-per-function\nfunction f() {}\n";
    expect(rulesBroken({ "src/cli/a.ts": bare })).toEqual(["TS-12"]);
    const reasoned =
      "// oxlint-disable-next-line max-lines-per-function -- one table of every code\nfunction f() {}\n";
    expect(rulesBroken({ "src/cli/a.ts": reasoned })).toEqual([]);
    expect(rulesBroken({ "page.html": '<button onclick="go()">Go</button>\n' })).toEqual([
      "WEB-01",
    ]);
    // A tag written over several lines.
    expect(
      rulesBroken({ "page.html": '<button\n  type="button"\n  onclick="go()">Go</button>\n' }),
    ).toEqual(["WEB-01"]);
  });
});

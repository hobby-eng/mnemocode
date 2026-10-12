// AUD-010 build reviewer: commands, links and release notes in the documents (CHECK-DOC-002).
//
// Documents: every tracked Markdown file except the frozen audit records (docs/audits/AUD-*).
// Checks, each printed with the values compared:
// 1. every relative link resolves to a file, and its #anchor to a heading of that file (GitHub's
//    slugs: lower case, punctuation removed, spaces to hyphens, -N for repeats);
// 2. every `pnpm <name>` / `pnpm run <name>` in code (inline code or a fenced block; prose such as
//    "the pnpm version" is not a command) names a package.json script or a pnpm command;
// 3. every `node scripts/<file>` / `python3 scripts/<file>` names an existing file;
// 4. every `mnemocode <command>` names a command of the built CLI (node dist/mnemocode.js --help)
//    or one of its aliases (src/cli/command-line.ts);
// 5. every --option in a document is an option that the built CLI's help shows for some command,
//    or a listed option of another tool the documents show (pnpm, node, gh, gpg, git, ...);
// 6. docs/releases/v0.1.0.md has the same sections and bullets as the 0.1.0 section of
//    CHANGELOG.md, links rewritten to the tag's URLs as the release notes write them.
// Exits 1 when a check fails. Runs dist/mnemocode.js only with --help.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize } from "node:path";

let failures = 0;
const fail = (message) => {
  failures += 1;
  console.log(`FAIL ${message}`);
};
const documents = execFileSync("git", ["ls-files", "*.md"], { encoding: "utf8" })
  .split("\n")
  .filter((path) => path !== "" && !path.startsWith("docs/audits/AUD-"));
console.log(`Documents: ${documents.length}`);
const read = (path) => readFileSync(path, "utf8");
/** Text outside fenced code blocks, and the fenced code alone. */
function parts(text) {
  const prose = [];
  const fenced = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    (inFence ? fenced : prose).push(line);
  }
  return { prose: prose.join("\n"), fenced: fenced.join("\n") };
}
function slugs(text) {
  const seen = new Map();
  const result = new Set();
  for (const line of parts(text).prose.split("\n")) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/u.exec(line);
    if (!heading) continue;
    const base = heading[1]
      .replace(/`/gu, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s/gu, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${count}`);
  }
  return result;
}

// 1. Links.
let links = 0;
for (const path of documents) {
  const { prose } = parts(read(path));
  for (const match of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
    const target = match[1];
    if (/^(https?:|mailto:)/u.test(target)) continue;
    links += 1;
    const [file, anchor] = target.split("#");
    const resolved = file === "" ? path : normalize(join(dirname(path), decodeURIComponent(file)));
    if (!existsSync(resolved)) {
      fail(`${path}: link ${target} -> ${resolved} does not exist`);
      continue;
    }
    if (anchor !== undefined && statSync(resolved).isFile() && resolved.endsWith(".md")) {
      if (!slugs(read(resolved)).has(anchor.toLowerCase()))
        fail(`${path}: link ${target}: no heading #${anchor} in ${resolved}`);
    }
  }
}
console.log(`Relative links checked: ${links}`);

// 2 and 3. Scripts.
const manifest = JSON.parse(read("package.json"));
const PNPM_COMMANDS = new Set(["install", "exec", "audit", "dlx", "add", "remove", "update", "outdated", "run", "pack", "store", "why", "list"]);
let pnpmMentions = 0;
for (const path of documents) {
  const text = read(path);
  const code = [...parts(text).prose.matchAll(/`([^`]+)`/gu)].map((m) => m[1]).join("\n") + "\n" + parts(text).fenced;
  for (const match of code.matchAll(/\bpnpm\s+(?:run\s+)?([a-z][\w:-]*)/gu)) {
    pnpmMentions += 1;
    const name = match[1];
    if (!(name in manifest.scripts) && !PNPM_COMMANDS.has(name)) fail(`${path}: pnpm ${name} is no script`);
  }
  for (const match of text.matchAll(/\b(?:node|python3?)\s+(scripts\/[\w./-]+)/gu))
    if (!existsSync(match[1])) fail(`${path}: ${match[1]} does not exist`);
}
console.log(`pnpm mentions checked: ${pnpmMentions}`);

// 4 and 5. Commands and options of the built CLI.
const help = (args) =>
  spawnSync(process.execPath, ["dist/mnemocode.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 60_000,
  }).stdout;
const top = help(["--help"]);
const commands = new Set(
  [...top.slice(top.indexOf("Commands:"), top.indexOf("Topics:")).matchAll(/^ {2}([a-z][\w-]*)\s/gmu)].map((m) => m[1]),
);
const aliases = [...read("src/cli/command-line.ts").matchAll(/case "([a-z][\w-]*)":/gu)].map((m) => m[1]);
aliases.forEach((name) => commands.add(name));
console.log(`CLI commands and aliases: ${[...commands].join(", ")}`);
const cliOptions = new Set(["--help", "--version"]);
for (const command of [...commands, "help modes", "help formats", "help cards"]) {
  const text = command.includes(" ") ? help(command.split(" ")) : help([command, "--help"]);
  for (const match of text.matchAll(/(?<![\w-])(--[a-z][\w-]*)/gu)) cliOptions.add(match[1]);
}
console.log(`CLI options shown by the help pages: ${cliOptions.size}`);
// Options of other tools that the documents show in their commands.
const OTHER_TOOLS = new Set([
  "--frozen-lockfile", "--audit-level", "--dry-run", "--json", "--ignore-scripts", "--publish",
  "--repo", "--draft", "--draft=false", "--show-keys", "--import", "--verify", "--check",
  "--ignore-missing", "--strict", "--require-hashes", "--local-user", "--armor", "--detach-sign",
  "--list-secret-keys", "--paginate", "--clobber", "--dir", "--yes", "--output", "--export",
  "--batch", "--status-fd", "--permission", "--allow-fs-read", "--allow-fs-write",
  "--allow-child-process", "--allow-ffi", "--allow-net", "--disable-warning", "--build-sea",
  "--signer-workflow", "--source-ref", "--network", "--platform", "--file", "--target",
  "--locked", "--offline", "--release", "--testTimeout", "--coverage", "--write", "--noEmit",
]);
let optionMentions = 0;
const unknown = new Map();
for (const path of documents) {
  if (path.startsWith("sskr-wasm/")) continue;
  const text = read(path);
  // Inline code that starts with mnemocode, and lines of fenced blocks that do.
  let commandMentions = 0;
  for (const match of [
    ...text.matchAll(/`mnemocode\s+([a-z][\w-]*)/gu),
    ...parts(text).fenced.matchAll(/^\s*(?:\$\s+)?mnemocode\s+([a-z][\w-]*)/gmu),
  ]) {
    commandMentions += 1;
    if (!commands.has(match[1])) fail(`${path}: mnemocode ${match[1]} is no command`);
  }
  if (commandMentions > 0) console.log(`${path}: mnemocode commands checked ${commandMentions}`);
  for (const match of text.matchAll(/(?<![\w-])(--[a-z][\w-]*(?:=false)?)/gu)) {
    optionMentions += 1;
    const option = match[1];
    if (cliOptions.has(option) || OTHER_TOOLS.has(option)) continue;
    unknown.set(`${path}: ${option}`, (unknown.get(`${path}: ${option}`) ?? 0) + 1);
  }
}
console.log(`--options checked: ${optionMentions}`);
for (const [where, count] of unknown) fail(`${where} (${count}x) is no option of the CLI or of a listed tool`);

// 6. Release notes against the CHANGELOG section.
const TAG_BASE = "https://github.com/hobby-eng/mnemocode/blob/v0.1.0/";
const changelog = read("CHANGELOG.md");
const section = changelog.slice(changelog.indexOf("## 0.1.0"), changelog.indexOf("\n## ", changelog.indexOf("## 0.1.0") + 4) >>> 0 || undefined);
const notes = read("docs/releases/v0.1.0.md");
const rewrite = (line) =>
  line.replace(/\]\(([^)\s:#]+)(#[^)]*)?\)/gu, (_, file, anchor = "") => `](${TAG_BASE}${normalize(file)}${anchor})`);
const bullets = (text) => text.split("\n").filter((line) => line.startsWith("- "));
const headings = (text, level) => text.split("\n").filter((line) => line.startsWith(level)).map((line) => line.replace(/^#+\s*/u, ""));
const changelogBullets = bullets(section).map(rewrite);
const notesBullets = bullets(notes);
const onlyChangelog = changelogBullets.filter((line) => !notesBullets.includes(line));
const onlyNotes = notesBullets.filter((line) => !changelogBullets.includes(line));
console.log(`CHANGELOG 0.1.0 sections: ${headings(section, "### ").join(" | ")}`);
console.log(`Release notes sections:   ${headings(notes, "## ").join(" | ")}`);
console.log(`Bullets: CHANGELOG ${changelogBullets.length}, release notes ${notesBullets.length}; only in CHANGELOG ${onlyChangelog.length}; only in notes ${onlyNotes.length}`);
if (headings(section, "### ").join("|") !== headings(notes, "## ").join("|")) fail("section headings differ");
for (const line of onlyChangelog) fail(`only in CHANGELOG: ${line.slice(0, 140)}`);
for (const line of onlyNotes) fail(`only in release notes: ${line.slice(0, 140)}`);

console.log(failures === 0 ? "PASS build-docs" : `FAIL build-docs: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;

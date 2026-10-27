// Records the known answers of MnemoCode TS as data (DOC-04) in vectors/ts-0.1.0/, for the Rust
// tests to replay (RUST-14; docs/design/architect/PLAN.md, "Parity with TS 0.1.0"). It builds the
// TS program from one commit in the workspace's tmp folder (git archive, then pnpm install
// --offline and pnpm build), runs every recorder of parity/recorders/ against that build, and
// writes PROVENANCE.json: the commit, Node.js, and the SHA-256 of every recorder and every file it
// wrote. A recorder reads the TS build's own modules with public inputs only.
//
//   node parity/record.mjs <ts-repository> <commit>           record every file
//   node parity/record.mjs <ts-repository> <commit> --check   fail if a file would change
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const OUTPUT = join(root, "vectors", "ts-0.1.0");
const RECORDERS = join(root, "parity", "recorders");
const PROVENANCE = "PROVENANCE.json";
/** The file written into a TS build's folder once `pnpm build` has finished there. */
const BUILT_MARKER = ".recorder-build-complete";
/** A full Git commit: the build is named by it, never by a branch that moves. */
const COMMIT = /^[0-9a-f]{40}$/u;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** The TS program of `commit`, built in the workspace's tmp folder; its folder. */
function buildTs(repository, commit) {
  const folder = resolve(root, "..", "tmp", `ts-${commit.slice(0, 12)}`);
  // A build that failed or stopped halfway may leave a dist folder: only one that finished, marked
  // so after pnpm build returned, is used again.
  const marker = join(folder, BUILT_MARKER);
  if (!existsSync(marker)) {
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    const archive = execFileSync("git", ["-C", repository, "archive", commit], {
      maxBuffer: 1024 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", folder], { input: archive });
    run("pnpm", ["install", "--frozen-lockfile", "--offline"], folder);
    run("pnpm", ["build"], folder);
    writeFileSync(marker, `${commit}\n`);
  }
  return folder;
}

/** The recorders, by file name, sorted. */
function recorders() {
  if (!existsSync(RECORDERS)) return [];
  return readdirSync(RECORDERS)
    .filter((name) => name.endsWith(".mjs"))
    .sort();
}

/** One recorded file's bytes: the data as JSON, one value per line where it is an array. */
function serialize(data) {
  return `${JSON.stringify(data, null, 1)}\n`;
}

const [repository, commit, flag] = process.argv.slice(2);
const check = flag === "--check";
if (
  repository === undefined ||
  commit === undefined ||
  (flag !== undefined && !check) ||
  process.argv.length > 5
) {
  process.stderr.write("usage: node parity/record.mjs <ts-repository> <commit> [--check]\n");
  process.exit(2);
}
const full = run("git", ["-C", repository, "rev-parse", `${commit}^{commit}`]).trim();
if (!COMMIT.test(full)) throw new Error(`not a commit: ${commit}`);
const tsRoot = buildTs(repository, full);
const ts = {
  root: tsRoot,
  /** A module of the TS build, by its path under dist/. */
  load: (path) => import(pathToFileURL(join(tsRoot, "dist", path)).href),
};
const outputs = {};
const recorded = {};
let changed = [];
mkdirSync(OUTPUT, { recursive: true });
for (const name of recorders()) {
  const recorder = await import(pathToFileURL(join(RECORDERS, name)).href);
  const bytes = serialize(await recorder.record(ts));
  const path = join(OUTPUT, recorder.file);
  if (check && (!existsSync(path) || readFileSync(path, "utf8") !== bytes))
    changed.push(recorder.file);
  if (!check) writeFileSync(path, bytes);
  outputs[recorder.file] = sha256(bytes);
  recorded[name] = sha256(readFileSync(join(RECORDERS, name)));
}
const provenance = serialize({
  about:
    "Known answers of MnemoCode TS, recorded by parity/record.mjs from the build of one commit; the Rust tests replay them (RUST-14).",
  repository: "hobby-eng/mnemocode",
  commit: full,
  node: process.version,
  recorders: recorded,
  files: outputs,
});
const provenancePath = join(OUTPUT, PROVENANCE);
if (check) {
  if (!existsSync(provenancePath) || readFileSync(provenancePath, "utf8") !== provenance)
    changed.push(PROVENANCE);
  if (changed.length > 0) {
    process.stderr.write(`The recordings differ from the TS build: ${changed.join(", ")}\n`);
    process.exit(1);
  }
  process.stdout.write(`Recordings match the TS build of ${full}.\n`);
} else {
  writeFileSync(provenancePath, provenance);
  process.stdout.write(`Recorded ${recorders().length} files from ${full}.\n`);
}

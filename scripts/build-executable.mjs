// Builds MnemoCode as one executable file for the computer it runs on, with Node.js, the
// command-line program and every file it reads built in: card artwork and fonts, the SSKR engine
// and the public vectors. Nothing needs to be installed to run it.
//
//   node scripts/build-executable.mjs [output folder]   (default release)
//
// Writes mnemocode-<version>-<system>-<processor>[.exe], its license notices
// (mnemocode-<version>-<system>-<processor>-licenses.txt) and their lines of SHA256SUMS. A Node.js
// single executable is built from the running Node.js binary, so each system builds its own:
// CI builds Linux, Windows and macOS (.github/workflows/executable.yml).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { executableName, noticesName } from "./executable-files.mjs";
import { executableNotices } from "./executable-notices.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = resolve(process.argv[2] ?? join(root, "release"));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const nodeVersion = readFileSync(join(root, ".node-version"), "utf8").trim();

const name = executableName(version);

// The executable carries the running Node.js, so it must be the version the project is tested on.
if (process.version !== `v${nodeVersion}`)
  throw new Error(`Build with Node.js ${nodeVersion} from .node-version, not ${process.version}.`);

/** Every file the program reads at run time, by its path from the package root; see bundled-files.ts. */
function bundledFiles() {
  const files = [
    "sskr-wasm/integrity.json",
    "sskr-wasm/generated/recovery_sskr_wasm.js",
    "sskr-wasm/generated/recovery_sskr_wasm_bg.wasm",
    "vectors/mnemocode-v1.json",
  ];
  const walk = (folder) => {
    for (const entry of readdirSync(join(root, folder)).sort()) {
      const path = `${folder}/${entry}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk("assets");
  return files;
}

// The bundle and the configuration are intermediate files, kept out of the output folder. The new
// executable, its notices and their checksums are made in a staging folder beside the old ones and
// replace them only when all three are ready, so that a failed build leaves the last complete set
// as it was (AUD-008-BLD001).
mkdirSync(output, { recursive: true });
let work;
let staging;
let keepStaging = false;
try {
  // Allocation itself can fail; every successfully allocated directory is covered by cleanup.
  work = mkdtempSync(join(tmpdir(), "mnemocode-executable-build-"));
  staging = mkdtempSync(join(output, ".staging-"));
  // One CommonJS file: a Node.js single executable starts from a single script. The SSKR bridge is
  // bundled too; its WASM bytes and the other files come from the embedded assets.
  const bundle = await build({
    absWorkingDir: root,
    entryPoints: [join(root, "src", "mnemocode.ts")],
    outfile: join(work, "mnemocode.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: `node${nodeVersion.split(".")[0]}`,
    legalComments: "inline",
    // Only bundled-files.ts reads it, on the path that the executable never takes.
    define: { "import.meta.url": "undefined" },
    logLevel: "warning",
    // The list of bundled files names the npm packages whose licenses travel with the executable.
    metafile: true,
  });

  const assets = Object.fromEntries(bundledFiles().map((path) => [path, join(root, path)]));
  const executable = join(staging, name);
  const config = join(work, "sea-config.json");
  writeFileSync(
    config,
    `${JSON.stringify(
      {
        // Relative: Node.js records this name in the executable, and a temporary folder would
        // make every build different.
        main: "mnemocode.cjs",
        output: executable,
        disableExperimentalSEAWarning: true,
        // The protection that every run has (src/cli/protection.ts): the permission model and
        // the options that go with it, the same as for node dist/mnemocode.js.
        execArgv: JSON.parse(
          readFileSync(join(root, "src", "cli", "protection-flags.json"), "utf8"),
        ),
        // Neither is reproducible across machines, and start-up is fast enough without them.
        useSnapshot: false,
        useCodeCache: false,
        assets,
      },
      null,
      2,
    )}\n`,
  );
  execFileSync(process.execPath, ["--build-sea", config], { cwd: work, stdio: "inherit" });
  // macOS runs only signed programs; the injected executable needs a new ad-hoc signature.
  if (process.platform === "darwin")
    execFileSync("codesign", ["--sign", "-", "--force", executable]);

  const notices = noticesName(name);
  writeFileSync(
    join(staging, notices),
    executableNotices({ root, name, version, metafile: bundle.metafile }),
  );

  const sha256 = (file) =>
    createHash("sha256")
      .update(readFileSync(join(staging, file)))
      .digest("hex");
  const lines = [name, notices].map((file) => `${sha256(file)}  ${file}`);
  const checksums = `${name}.sha256`;
  writeFileSync(join(staging, checksums), `${lines.join("\n")}\n`);
  const files = [name, notices, checksums];
  // Preserve the old set before any rename. Backups stay on the same filesystem for rollback.
  const backups = new Map();
  for (const [index, file] of files.entries()) {
    const destination = join(output, file);
    if (existsSync(destination)) {
      const backup = join(staging, `previous-${index}`);
      copyFileSync(destination, backup);
      backups.set(file, backup);
    }
  }
  const installed = [];
  try {
    // Checksums last, so a reader of an intermediate set detects mismatched generations.
    for (const file of files) {
      renameSync(join(staging, file), join(output, file));
      installed.push(file);
    }
  } catch (error) {
    const failures = [error];
    for (const file of installed.reverse()) {
      try {
        const backup = backups.get(file);
        if (backup === undefined) rmSync(join(output, file), { force: true });
        else renameSync(backup, join(output, file));
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length > 1) {
      // Never discard the last recoverable copies when the filesystem also refuses rollback.
      keepStaging = true;
      throw new AggregateError(
        failures,
        `Publication and rollback failed; backups remain in ${staging}.`,
      );
    }
    throw error;
  }
  for (const line of lines) console.log(line);
} finally {
  try {
    if (work !== undefined) rmSync(work, { recursive: true, force: true });
  } finally {
    if (staging !== undefined && !keepStaging) rmSync(staging, { recursive: true, force: true });
  }
}

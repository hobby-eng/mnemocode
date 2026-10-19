// Runs a built executable (scripts/build-executable.mjs) from an empty folder, away from the
// checkout, and checks that it works on its own: version, full self-test, a seedshift encoding,
// a re-encoding of the masked phrase, a Shamir split and recovery, a card PDF, the help and the
// license notices next to it. Public test data only.
//
//   node scripts/verify-executable.mjs [executable or its folder]   (default release)
//   node scripts/verify-executable.mjs --print-path   (only prints release/<this system's
// executable>)

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_FOLDER, executableName, noticesName } from "./executable-files.mjs";
import { ErrorCatalog } from "../src/core/error-catalog.ts";

const ERRORS = new ErrorCatalog("scripts.verify-executable", {
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "there-no": (value0, value1) => `There is no ${value0} in ${value1}.`,
  /**
   * @param {string} value0
   */
  "executable-failed": (value0) => `The executable failed: ${value0}.`,
});

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

/**
 * The executable itself, or in a folder the executable of this computer, by the name that
 * build-executable.mjs gives it; the folder may also hold the files of other systems.
 */
function findExecutable(path) {
  if (!statSync(path).isDirectory()) return path;
  const name = executableName(version);
  if (!readdirSync(path).includes(name)) throw ERRORS.create("there-no", [`${name}`, `${path}`]);
  return join(path, name);
}

/** Prints the path of the executable that this computer's build makes, for the release workflow. */
const PRINT_PATH = "--print-path";
if (process.argv[2] === PRINT_PATH) {
  // From the checkout and with "/", as the workflow's bash steps take it on every system.
  console.log(`${RELEASE_FOLDER}/${executableName(version)}`);
  process.exit(0);
}

const executable = findExecutable(resolve(process.argv[2] ?? join(root, RELEASE_FOLDER)));

/** The public BIP39 test phrase, and its seedshift encoding with the date 23-09-2026. */
const TEST_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SHIFTED = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";

const folder = mkdtempSync(join(tmpdir(), "mnemocode-executable-"));
const run = (...arguments_) =>
  execFileSync(executable, arguments_, {
    cwd: folder,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
const check = (condition, what) => {
  if (!condition) throw ERRORS.create("executable-failed", [`${what}`]);
  console.log(`ok  ${what}`);
};

try {
  check(run("--version") === `mnemocode ${version}\n`, `prints version ${version}`);
  const selfTest = run("self-test");
  check(selfTest.includes("PASS"), "passes the full self-test");
  // The system's own sandbox, as every runner of CI offers it (src/cli/system-sandbox.ts).
  const sandboxMark = {
    linux: "kernel: no sockets",
    darwin: "sandbox: no network",
    win32: "no heap in crash reports",
  }[process.platform];
  if (sandboxMark !== undefined)
    check(selfTest.includes(sandboxMark), `is held by the system's sandbox (${sandboxMark})`);
  writeFileSync(join(folder, "public-mnemonic.txt"), `${TEST_PHRASE}\n`);
  writeFileSync(join(folder, "public-dates.txt"), "23-09-2026\n");
  writeFileSync(join(folder, "public-shifted.txt"), `${SHIFTED}\n`);
  const shifted = run(
    "encode",
    "--mnemonic-file",
    "public-mnemonic.txt",
    "--dates-file",
    "public-dates.txt",
    "--format",
    "1",
  );
  check(shifted.includes(SHIFTED), "masks the test phrase with a date");
  // The masked phrase made again without Seedshift, confirmed by the test phrase's fingerprint:
  // the Unicode codes of its words (7684 is abandon, 5728 about).
  const reEncoded = run(
    "re-encode",
    "--input-file",
    "public-shifted.txt",
    "--old-mode",
    "seedshift",
    "--old-dates-file",
    "public-dates.txt",
    "--format",
    "3",
    "--master-fingerprint",
    "73c5da0a",
  );
  check(reEncoded.includes(`${"7684".repeat(11)}5728`), "re-encodes the masked phrase");
  run(
    "encode",
    "--sskr",
    "--mnemonic-file",
    "public-mnemonic.txt",
    "--threshold",
    "2",
    "--shares",
    "3",
    "--output",
    "shares.txt",
  );
  const shares = readFileSync(join(folder, "shares.txt"), "utf8").trim().split("\n");
  writeFileSync(join(folder, "two.txt"), `${shares[0]}\n${shares[2]}\n`);
  check(
    run("sskr-combine", "--share-file", "two.txt").includes(TEST_PHRASE),
    "restores the phrase from 2 of 3 Shamir shares",
  );
  run("preview", "--template", "business-it", "--pdf", "preview.pdf");
  check(
    readFileSync(join(folder, "preview.pdf")).subarray(0, 5).toString() === "%PDF-",
    "draws a card PDF with its embedded artwork",
  );
  check(run("encode", "--help").includes("Usage: mnemocode encode"), "prints the help");
  const notices = join(dirname(executable), noticesName(basename(executable)));
  const text = existsSync(notices) ? readFileSync(notices, "utf8") : "";
  check(
    ["MnemoCode", `Node.js ${process.version}`, "npm package", "SSKR engine"].every((part) =>
      text.includes(part),
    ),
    "has its license notices next to it",
  );
  // The holders of the code under MIT alone that the SSKR engine links (AUD-037-BLD002).
  check(
    ["Pieter Wuille", "Dominik Spicher", "Steven Fackler"].every((holder) => text.includes(holder)),
    "names the holders of every license that the SSKR engine links",
  );
} finally {
  rmSync(folder, { recursive: true, force: true });
}

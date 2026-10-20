// Signs a MnemoCode release on the owner's computer, so that the OpenPGP key never enters GitHub
// Actions (docs/RELEASING.md). A tag's workflow leaves a draft release. This script downloads the
// draft into a new folder release-signing-v<version>/ (ignored by Git), checks every file against
// SHA256SUMS and its GitHub build attestation, signs SHA256SUMS with the release key, checks the
// signature, exports the public key, uploads both to the draft and, with --publish, publishes it.
// It never reads or copies a private key: GnuPG makes the signature and asks for the passphrase.
//
//   node scripts/sign-release.mjs v<version> [--publish] [--dry-run]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// The palette and colour rule of the command line; Node strips the types of this leaf module.
import {
  STYLE,
  failureLine,
  headingLine,
  markedLines,
  paint,
  resultLines,
  statusLine,
} from "../src/cli/terminal-style.ts";
import { CANCELLED_EXIT_CODE, CANCELLED_MESSAGE } from "../src/cli/exit-codes.ts";
import { CANCELLED } from "../src/cli/terminal-keys.ts";
import { typedLine } from "../src/cli/shell-command.ts";
import { describeError } from "../src/core/refusal.ts";
import { InputTooLargeError, MEBIBYTE } from "../src/core/byte-units.ts";
// SHA256SUMS joins the checksum files of build-executable.mjs; their lines and names come from
// here.
import { CHECKSUM_LINE, RELEASE_FILES_MAX, releaseFilePrefix } from "./executable-files.mjs";
import { SIGNING_KEY } from "./release-key.mjs";
import { ErrorCatalog, suppliedMessage } from "../src/core/error-catalog.ts";

const ERRORS = new ErrorCatalog("scripts.sign-release", {
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "not-installed": (value0, value1) => `${value0} is not installed; ${value1}.`,
  "failure-refused": suppliedMessage,
  "unknown-option-see-help": () => "Unknown option; see --help.",
  "give-one-release-tag-not-too": () => "Give exactly one release tag.",
  "give-release-tag-example-node-scripts-sign-release": () =>
    "Give the release tag, for example: node scripts/sign-release.mjs v0.1.0",
  "not-release-tag-looks-like-v0-1-0": () => "The release tag must look like v0.1.0.",
  "git-hub-cli-no-gh-attestation-command-install": () =>
    "This GitHub CLI has no gh attestation command; install a newer one.",
  /**
   * @param {string} value0
   */
  "gnu-pg-on-computer-no-secret-key": (value0) =>
    `GnuPG on this computer has no secret key ${value0}.`,
  "sha256sum-version-failed": () => "sha256sum --version failed.",
  /**
   * @param {string} value0
   */
  "git-hub-no-release-tag-s-workflow-creates": (value0) =>
    `GitHub has no release ${value0}; the tag's workflow creates its draft.`,
  /**
   * @param {string} value0
   */
  "published-already-only-draft-signed": (value0) =>
    `${value0} is published already; only a draft is signed.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "drafts-on-git-hub-delete-all-but-one": (value0, value1) =>
    `${value0} has ${value1} drafts on GitHub; delete all but the one to sign, then retry.`,
  "list-of-releases-malformed": () =>
    `A line of GitHub's list of releases is not "<draft> <page> <files> <largest size>".`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "draft-holds-too-many-files": (value0, value1) =>
    `The draft holds ${value0} files, more than the ${value1} of a release and its signature.`,
  /**
   * @param {string} value0
   */
  "exists-already-move-away-remove-then-run-again": (value0) =>
    `${value0}/ exists already; move it away or remove it, then run again.`,
  /**
   * @param {string} value0
   */
  "draft-no": (value0) => `The draft has no ${value0}.`,
  /**
   * @param {string} value0
   */
  "lists-no-file": (value0) => `${value0} lists no file.`,
  /**
   * @param {string} value0
   * @param {string} value1
   * @param {string} value2
   */
  "lists-too-many-files": (value0, value1, value2) =>
    `${value0} lists ${value1} files, more than the ${value2} of a release.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "lists-file-twice": (value0, value1) => `${value0} lists ${value1} twice.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "line-not-sha-256-file": (value0, value1) =>
    `${value0} line ${value1} is not "<sha-256>  <file>".`,
  /**
   * @param {string} value0
   * @param {string} value1
   * @param {string} value2
   */
  "lists-which-no-file-version": (value0, value1, value2) =>
    `${value0} lists ${value1}, which is no file of version ${value2}.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "draft-holds-which-does-not-list": (value0, value1) =>
    `The draft holds ${value0}, which ${value1} does not list.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "draft-lacks-which-lists": (value0, value1) =>
    `The draft lacks ${value0}, which ${value1} lists.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "checking-files-against-failed": (value0, value1) =>
    `Checking the files against ${value0} failed: ${value1}`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "download-differs-from": (value0, value1) => `${value0}: the download differs from ${value1}.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "gnu-pg-did-not-confirm-as-signature-by": (value0, value1) =>
    `GnuPG did not confirm ${value0} as a signature by ${value1}.`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "gnu-pg-exported-no-public-key": (value0, value1) =>
    `GnuPG exported no public key ${value0} to ${value1}.`,
});

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The repository whose draft release and build attestations are checked. */
const REPOSITORY = "hobby-eng/mnemocode";
const CHECKSUMS = "SHA256SUMS";
const SIGNATURE = "SHA256SUMS.asc";
const PUBLIC_KEY = "RELEASE-SIGNING-KEY.asc";
/**
 * The form of a release tag: "v" and a semantic version. That it is the version in package.json
 * is the release workflow's check, not this one's.
 */
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/**
 * The most a command may write while its output is kept: 1 MiB. The most any step writes is the
 * list of the tag's releases, a line each, or the report of an attestation, a few kilobytes.
 */
const OUTPUT_BYTES = MEBIBYTE;
/**
 * The most files the draft may hold: those of a release, SHA256SUMS, and the signature and the
 * public key that an earlier, unfinished run uploaded.
 */
const DRAFT_FILES_MAX = RELEASE_FILES_MAX + [CHECKSUMS, SIGNATURE, PUBLIC_KEY].length;
/**
 * The largest file the draft may hold: 512 MiB. The largest file of a release is an executable,
 * Node.js with the program inside, of about 160 MB.
 */
const DRAFT_FILE_BYTES = 512 * MEBIBYTE;
/**
 * The most SHA256SUMS may take before it is read: 1 MiB. It has a line of about a hundred bytes
 * for each file of the release.
 */
const CHECKSUMS_BYTES = MEBIBYTE;
/** A line of the list of releases as COMMANDS.releases asks GitHub for it. */
const RELEASE_LINE = /^(true|false) (\S+) (\d+) (\d+)$/u;

/** A checked fact after a green ✓, with its value in bold. */
function passed(label, value) {
  console.error(statusLine(process.stderr, label, value));
}

/** A warning after a yellow !, as the command line shows one (markedLines). */
function warn(message) {
  for (const line of markedLines(process.stderr, message, "warning")) console.error(line);
}

/** One line after a red "✗ Error:"; without colour, the plain form of src/cli/terminal.ts. */
function fail(message) {
  console.error(failureLine(process.stderr, "sign-release", message));
}

/** "MnemoCode · <title>" and its facts as grey labels with their values. */
function printResult(title, rows) {
  for (const line of resultLines(process.stdout, title, rows)) console.log(line);
}

/** A command of COMMANDS as it would be typed in a shell, quoted by the menu's rule. */
function shellLine([command, args]) {
  return typedLine([command, ...args]);
}

/**
 * Every command the script runs, in one place, so that the dry run prints exactly what a real run
 * does. A folder is relative to the checkout, as in the dry run.
 */
const COMMANDS = {
  attestationTool: () => ["gh", ["attestation", "verify", "--help"]],
  // Only a listing: it shows that the key is there, without reading it.
  secretKey: () => ["gpg", ["--batch", "--list-secret-keys", SIGNING_KEY]],
  checksumTool: () => ["sha256sum", ["--version"]],
  // Every release of the tag, drafts included, as "<draft> <page> <files> <largest size>" lines,
  // the size in bytes. GitHub does not tie a draft to its tag, so one tag can have two drafts, and
  // gh would then pick one on its own. The files and their size are what the download fetches.
  releases: (tag) => [
    "gh",
    [
      "api",
      "--paginate",
      `repos/${REPOSITORY}/releases`,
      "--jq",
      `.[] | select(.tag_name == ${JSON.stringify(tag)}) | ` +
        `[(.draft | tostring), .html_url, (.assets | length | tostring), ` +
        `([.assets[].size] | max // 0 | tostring)] | join(" ")`,
    ],
  ],
  download: (tag, folder) => [
    "gh",
    ["release", "download", tag, "--repo", REPOSITORY, "--dir", folder],
  ],
  checksums: () => ["sha256sum", ["--check", "--strict", CHECKSUMS]],
  attestation: (file) => ["gh", ["attestation", "verify", file, "--repo", REPOSITORY]],
  // --yes and --output: an earlier signature that came with the draft is replaced, not asked about.
  sign: () => [
    "gpg",
    [
      "--local-user",
      SIGNING_KEY,
      "--armor",
      "--detach-sign",
      "--yes",
      "--output",
      SIGNATURE,
      CHECKSUMS,
    ],
  ],
  // The status lines on stdout name the key that made the signature (VALIDSIG).
  verify: () => ["gpg", ["--status-fd", "1", "--verify", SIGNATURE, CHECKSUMS]],
  exportKey: () => ["gpg", ["--armor", "--yes", "--output", PUBLIC_KEY, "--export", SIGNING_KEY]],
  upload: (tag) => [
    "gh",
    ["release", "upload", tag, SIGNATURE, PUBLIC_KEY, "--repo", REPOSITORY, "--clobber"],
  ],
  publish: (tag) => ["gh", ["release", "edit", tag, "--repo", REPOSITORY, "--draft=false"]],
};

const INSTALL_HINTS = {
  gh: "install the GitHub CLI from https://cli.github.com/",
  gpg: "install GnuPG",
  sha256sum: "install GNU coreutils",
};

/**
 * Set by Ctrl+C. The terminal sends SIGINT to gh or gpg as well as to Node, so Node only notes it,
 * waits for the step that runs, and stops before the next one.
 */
let interrupted = false;

function listenForCtrlC() {
  process.on("SIGINT", () => {
    interrupted = true;
  });
}

/** One turn of the event loop, in which a Ctrl+C that came meanwhile reaches the listener. */
function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

/** The last non-empty line a command wrote, so that a failure stays on one line. */
function lastLine(text) {
  const lines = (text ?? "").split(/\r?\n/u).map((line) => line.trim());
  return lines.filter((line) => line !== "").at(-1) ?? "";
}

/**
 * Keeps what `child` writes to its pipes, at most OUTPUT_BYTES in all. A child that writes more is
 * stopped, since no step writes that much. The function returned gives the text kept so far and
 * whether the child went past the limit.
 */
function keepOutput(child) {
  const kept = { stdout: [], stderr: [] };
  let bytes = 0;
  let overflowed = false;
  for (const stream of ["stdout", "stderr"]) {
    child[stream]?.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= OUTPUT_BYTES) kept[stream].push(chunk);
      else if (!overflowed) {
        overflowed = true;
        child.kill();
      }
    });
  }
  return () => ({
    stdout: Buffer.concat(kept.stdout).toString("utf8"),
    stderr: Buffer.concat(kept.stderr).toString("utf8"),
    overflowed,
  });
}

/**
 * Runs a command and waits for it. With `terminal` it shares the terminal, where GnuPG asks for the
 * passphrase; otherwise its output is kept back, up to OUTPUT_BYTES, and returned. A program that
 * is not installed, one that writes more than that, or a Ctrl+C, stops the script here.
 */
async function run(step, { cwd = root, terminal = false } = {}) {
  await nextTurn();
  if (interrupted) return CANCELLED;
  const [command, args] = step;
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: terminal ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const output = keepOutput(child);
    child.on("error", (error) => resolve({ ...output(), error }));
    child.on("close", (status, signal) => resolve({ ...output(), status, signal }));
  });
  // A program that catches Ctrl+C may end before Node's listener has run.
  await nextTurn();
  if (interrupted || result.signal === "SIGINT") return CANCELLED;
  if (result.error?.code === "ENOENT") {
    throw ERRORS.create("not-installed", [`${command}`, `${INSTALL_HINTS[command]}`]);
  }
  if (result.overflowed) throw new InputTooLargeError(`The output of ${command}`, OUTPUT_BYTES);
  if (result.error !== undefined) throw result.error;
  return result;
}

function failure(what, result) {
  const said = lastLine(result.stderr) || lastLine(result.stdout);
  return ERRORS.create("failure-refused", [
    said === "" ? `${what} failed.` : `${what} failed: ${said}`,
  ]);
}

/** Whether a checking command succeeds. */
async function succeeds(step) {
  const result = await run(step);
  return result === CANCELLED ? CANCELLED : result.status === 0;
}

/** Runs a command that only reads or checks and returns its output; a failure stops the script. */
async function runQuietly(what, step, cwd = root) {
  const result = await run(step, { cwd });
  if (result === CANCELLED) return CANCELLED;
  if (result.status !== 0) throw failure(what, result);
  return result.stdout;
}

/** Runs a command in the terminal, where GnuPG can ask for the passphrase itself. */
async function runInTerminal(what, step, cwd) {
  const result = await run(step, { cwd, terminal: true });
  if (result === CANCELLED) return CANCELLED;
  if (result.status !== 0) throw failure(what, result);
}

/**
 * Reads signing switches and one release tag without performing any release operation.
 * Throws a stable argument refusal; help may return without a tag.
 * @param {string[]} argv
 */
export function parseReleaseArguments(argv) {
  /** @type {{ tag: string | undefined, publish: boolean, dryRun: boolean, help: boolean }} */
  const options = { tag: undefined, publish: false, dryRun: false, help: false };
  for (const argument of argv) {
    if (argument === "--publish") options.publish = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument.startsWith("-")) throw ERRORS.create("unknown-option-see-help", []);
    else if (options.tag === undefined) options.tag = argument;
    else throw ERRORS.create("give-one-release-tag-not-too", []);
  }
  if (options.help) return options;
  if (options.tag === undefined) {
    throw ERRORS.create("give-release-tag-example-node-scripts-sign-release", []);
  }
  if (!TAG.test(options.tag)) {
    throw ERRORS.create("not-release-tag-looks-like-v0-1-0", []);
  }
  return options;
}

function printHelp() {
  const { stdout } = process;
  const heading = (text) => paint(stdout, STYLE.heading, text);
  const accent = (text) => paint(stdout, STYLE.accent, text);
  const muted = (text) => paint(stdout, STYLE.muted, text);
  console.log(
    [
      headingLine(stdout, "sign a draft release with the owner's OpenPGP key"),
      "",
      "Downloads the draft release, checks every file against SHA256SUMS and its",
      "GitHub build attestation, signs SHA256SUMS, uploads the signature and the",
      "public key, and publishes the draft when asked to.",
      "",
      heading("Usage:"),
      `  node scripts/sign-release.mjs ${accent("v<version>")} [options]`,
      "",
      heading("Options:"),
      `  ${accent("--publish")}   publish the draft after uploading the signature`,
      `  ${accent("--dry-run")}   print the commands in order and run none of them`,
      `  ${accent("-h, --help")}  show this help`,
      "",
      heading("Examples:"),
      `  node scripts/sign-release.mjs ${accent("v0.1.0 --dry-run")}`,
      `  node scripts/sign-release.mjs ${accent("v0.1.0 --publish")}`,
      "",
      muted(`The files land in release-signing-v<version>/, a new folder that Git ignores.`),
      muted(`Signing key: ${SIGNING_KEY}`),
      muted("The whole procedure is in docs/RELEASING.md."),
      paint(
        stdout,
        STYLE.warning,
        "GnuPG asks for the passphrase itself; the private key is never read.",
      ),
    ].join("\n"),
  );
}

/** Prints what a real run would do, without running any command. */
function printPlan({ tag, publish }, folder) {
  printResult(`Release signing plan for ${tag}`, [
    ["Repository", REPOSITORY],
    ["Folder", `${folder}/`],
    ["Key", SIGNING_KEY],
    ["Publish", publish ? "yes, at the end" : "no; --publish publishes the draft at the end"],
  ]);
  const { stdout } = process;
  const show = (line) => console.log(`  ${paint(stdout, STYLE.accent, line)}`);
  console.log(
    `\n${paint(stdout, STYLE.muted, "Commands, in order; this dry run runs none of them:")}`,
  );
  show(shellLine(COMMANDS.attestationTool()));
  show(shellLine(COMMANDS.secretKey()));
  show(shellLine(COMMANDS.checksumTool()));
  show(shellLine(COMMANDS.releases(tag)));
  show(`mkdir ${folder}`);
  show(shellLine(COMMANDS.download(tag, folder)));
  show(`cd ${folder}`);
  show(shellLine(COMMANDS.checksums()));
  // The file names come from the downloaded SHA256SUMS, so the dry run cannot list them.
  show(shellLine(COMMANDS.attestation("FILE")).replace(" FILE ", " <each file of SHA256SUMS> "));
  show(shellLine(COMMANDS.sign()));
  show(shellLine(COMMANDS.verify()));
  show(shellLine(COMMANDS.exportKey()));
  show(shellLine(COMMANDS.upload(tag)));
  if (publish) show(shellLine(COMMANDS.publish(tag)));
}

/** Checks before anything is downloaded that the tools and the signing key are there. */
async function checkTools() {
  const attestation = await succeeds(COMMANDS.attestationTool());
  if (attestation === CANCELLED) return CANCELLED;
  if (!attestation) {
    throw ERRORS.create("git-hub-cli-no-gh-attestation-command-install", []);
  }
  const key = await succeeds(COMMANDS.secretKey());
  if (key === CANCELLED) return CANCELLED;
  if (!key) {
    throw ERRORS.create("gnu-pg-on-computer-no-secret-key", [`${SIGNING_KEY}`]);
  }
  const checksums = await succeeds(COMMANDS.checksumTool());
  if (checksums === CANCELLED) return CANCELLED;
  if (!checksums) throw ERRORS.create("sha256sum-version-failed", []);
}

/** A line of the list of releases (RELEASE_LINE) as its facts; any other line is refused. */
function releaseOf(line) {
  const fields = RELEASE_LINE.exec(line);
  if (fields === null) throw ERRORS.create("list-of-releases-malformed", []);
  const [, draft, page, files, largest] = fields;
  return { draft: draft === "true", page, files: Number(files), largest: Number(largest) };
}

/**
 * The address of the draft's page. The tag must have exactly one release, a draft: a published
 * release is not signed again, and of two drafts gh would download one on its own. The draft may
 * hold no more files, and none larger, than DRAFT_FILES_MAX and DRAFT_FILE_BYTES allow, since the
 * download fetches every one.
 */
async function checkDraft(tag) {
  const output = await runQuietly(`Reading the releases of ${REPOSITORY}`, COMMANDS.releases(tag));
  if (output === CANCELLED) return CANCELLED;
  const releases = output
    .split("\n")
    .filter((line) => line !== "")
    .map(releaseOf);
  if (releases.length === 0) {
    throw ERRORS.create("git-hub-no-release-tag-s-workflow-creates", [`${tag}`]);
  }
  if (releases.some(({ draft }) => !draft)) {
    throw ERRORS.create("published-already-only-draft-signed", [`${tag}`]);
  }
  if (releases.length > 1) {
    throw ERRORS.create("drafts-on-git-hub-delete-all-but-one", [`${tag}`, `${releases.length}`]);
  }
  const [{ page, files, largest }] = releases;
  if (files > DRAFT_FILES_MAX) {
    throw ERRORS.create("draft-holds-too-many-files", [`${files}`, `${DRAFT_FILES_MAX}`]);
  }
  if (largest > DRAFT_FILE_BYTES) {
    throw new InputTooLargeError("A file of the draft", DRAFT_FILE_BYTES);
  }
  return page;
}

/** The download goes into a new folder, so that no file of an earlier run is signed by mistake. */
function folderExistsError(folder) {
  return ERRORS.create("exists-already-move-away-remove-then-run-again", [`${folder}`]);
}

function makeFolder(folder) {
  try {
    mkdirSync(join(root, folder));
  } catch (error) {
    if (error.code === "EEXIST") throw folderExistsError(folder);
    throw error;
  }
}

/**
 * The files that SHA256SUMS lists, each once and at most RELEASE_FILES_MAX of them, since each
 * costs an attestation check. The folder must hold exactly these and SHA256SUMS, apart from a
 * signature and a public key that an earlier, unfinished run uploaded and this run replaces.
 */
function listedFiles(folderPath, version) {
  const present = readdirSync(folderPath);
  if (!present.includes(CHECKSUMS)) throw ERRORS.create("draft-no", [`${CHECKSUMS}`]);
  const checksumsPath = join(folderPath, CHECKSUMS);
  if (statSync(checksumsPath).size > CHECKSUMS_BYTES) {
    throw new InputTooLargeError(CHECKSUMS, CHECKSUMS_BYTES);
  }
  const lines = readFileSync(checksumsPath, "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw ERRORS.create("lists-no-file", [`${CHECKSUMS}`]);
  if (lines.length > RELEASE_FILES_MAX) {
    throw ERRORS.create("lists-too-many-files", [
      `${CHECKSUMS}`,
      `${lines.length}`,
      `${RELEASE_FILES_MAX}`,
    ]);
  }
  const files = [];
  for (const [index, line] of lines.entries()) {
    const name = CHECKSUM_LINE.exec(line)?.[1];
    if (name === undefined) {
      throw ERRORS.create("line-not-sha-256-file", [`${CHECKSUMS}`, `${index + 1}`]);
    }
    if (!name.startsWith(releaseFilePrefix(version))) {
      throw ERRORS.create("lists-which-no-file-version", [`${CHECKSUMS}`, `${name}`, `${version}`]);
    }
    if (files.includes(name)) throw ERRORS.create("lists-file-twice", [`${CHECKSUMS}`, `${name}`]);
    files.push(name);
  }
  for (const name of present) {
    if (name === CHECKSUMS || files.includes(name)) continue;
    if (name === SIGNATURE || name === PUBLIC_KEY) {
      warn(`The draft holds an earlier ${name}; this run replaces it.`);
      continue;
    }
    throw ERRORS.create("draft-holds-which-does-not-list", [`${name}`, `${CHECKSUMS}`]);
  }
  for (const name of files) {
    if (!present.includes(name)) {
      throw ERRORS.create("draft-lacks-which-lists", [`${name}`, `${CHECKSUMS}`]);
    }
  }
  return files;
}

/** sha256sum names each file that differs from its line in SHA256SUMS: "<file>: FAILED". */
async function checkChecksums(folderPath) {
  const result = await run(COMMANDS.checksums(), { cwd: folderPath });
  if (result === CANCELLED) return CANCELLED;
  if (result.status === 0) return;
  const differing = result.stdout
    .split("\n")
    .filter((line) => line.endsWith(": FAILED"))
    .map((line) => line.slice(0, -": FAILED".length));
  if (differing.length === 0) {
    throw ERRORS.create("checking-files-against-failed", [
      `${CHECKSUMS}`,
      `${lastLine(result.stderr)}`,
    ]);
  }
  throw ERRORS.create("download-differs-from", [`${differing.join(", ")}`, `${CHECKSUMS}`]);
}

/**
 * The signature must be good and made by the release key or one of its subkeys: VALIDSIG names
 * the signing key first and the primary key last (GnuPG's doc/DETAILS).
 */
async function checkSignature(folderPath) {
  const status = await runQuietly(`Checking ${SIGNATURE}`, COMMANDS.verify(), folderPath);
  if (status === CANCELLED) return CANCELLED;
  const valid = status
    .split("\n")
    .filter((line) => line.startsWith("[GNUPG:] VALIDSIG "))
    .some((line) => {
      const fields = line.split(" ").slice(2);
      return fields[0] === SIGNING_KEY || fields.at(-1) === SIGNING_KEY;
    });
  if (!valid) {
    throw ERRORS.create("gnu-pg-did-not-confirm-as-signature-by", [
      `${SIGNATURE}`,
      `${SIGNING_KEY}`,
    ]);
  }
}

function checkPublicKey(folderPath) {
  const text = readFileSync(join(folderPath, PUBLIC_KEY), "utf8");
  if (!text.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
    throw ERRORS.create("gnu-pg-exported-no-public-key", [`${SIGNING_KEY}`, `${PUBLIC_KEY}`]);
  }
}

async function signRelease({ tag, publish }, folder) {
  const version = tag.slice(1);
  const folderPath = join(root, folder);
  if (existsSync(folderPath)) throw folderExistsError(folder);
  listenForCtrlC();
  if ((await checkTools()) === CANCELLED) return CANCELLED;
  const draftPage = await checkDraft(tag);
  if (draftPage === CANCELLED) return CANCELLED;
  passed("Draft", tag);

  makeFolder(folder);
  if (
    (await runQuietly(`Downloading the draft ${tag}`, COMMANDS.download(tag, folder))) === CANCELLED
  )
    return CANCELLED;
  const files = listedFiles(folderPath, version);
  if ((await checkChecksums(folderPath)) === CANCELLED) return CANCELLED;
  passed("Checksums", `${files.length} files match ${CHECKSUMS}`);
  for (const file of files) {
    if (
      (await runQuietly(
        `Checking the attestation of ${file}`,
        COMMANDS.attestation(file),
        folderPath,
      )) === CANCELLED
    )
      return CANCELLED;
    passed("Attestation", file);
  }

  if ((await runInTerminal(`Signing ${CHECKSUMS}`, COMMANDS.sign(), folderPath)) === CANCELLED)
    return CANCELLED;
  if ((await checkSignature(folderPath)) === CANCELLED) return CANCELLED;
  passed("Signature", `${SIGNATURE} by ${SIGNING_KEY}`);
  if (
    (await runQuietly(
      `Exporting the public key ${SIGNING_KEY}`,
      COMMANDS.exportKey(),
      folderPath,
    )) === CANCELLED
  )
    return CANCELLED;
  checkPublicKey(folderPath);
  passed("Public key", PUBLIC_KEY);

  if (
    (await runQuietly(
      `Uploading ${SIGNATURE} and ${PUBLIC_KEY}`,
      COMMANDS.upload(tag),
      folderPath,
    )) === CANCELLED
  )
    return CANCELLED;
  passed("Uploaded", `${SIGNATURE} ${PUBLIC_KEY}`);
  if (publish && (await runQuietly(`Publishing ${tag}`, COMMANDS.publish(tag))) === CANCELLED)
    return CANCELLED;

  printResult(publish ? "Release signed and published" : "Release signed", [
    ["Release", tag],
    ["Files", `${files.length} checked against ${CHECKSUMS} and their attestations`],
    ["Signature", `${SIGNATURE}, key ${SIGNING_KEY}`],
    ["Folder", `${folder}/`],
    ["State", publish ? "published" : "draft"],
    // A draft has a page of its own until it is published under its tag.
    ["Page", publish ? `https://github.com/${REPOSITORY}/releases/tag/${tag}` : draftPage],
  ]);
  if (!publish) {
    const { stdout } = process;
    console.log(
      paint(stdout, STYLE.muted, "\nReview the draft on GitHub, then publish it there or with:"),
    );
    console.log(`  ${paint(stdout, STYLE.accent, shellLine(COMMANDS.publish(tag)))}`);
  }
}

async function main(argv) {
  const options = parseReleaseArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const folder = `release-signing-${options.tag}`;
  if (options.dryRun) printPlan(options, folder);
  else return signRelease(options, folder);
}

if (import.meta.main) {
  try {
    if ((await main(process.argv.slice(2))) === CANCELLED) {
      console.error(CANCELLED_MESSAGE);
      process.exitCode = CANCELLED_EXIT_CODE;
    }
  } catch (error) {
    fail(describeError(error));
    process.exitCode = 1;
  }
}

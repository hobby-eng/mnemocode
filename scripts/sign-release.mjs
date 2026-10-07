// Signs a MnemoCode release on the owner's computer, so that the OpenPGP key never enters GitHub
// Actions (docs/RELEASING.md). A tag's workflow leaves a draft release. This script downloads the
// draft into a new folder release-signing-v<version>/ (ignored by Git), checks every file against
// SHA256SUMS and its GitHub build attestation, signs SHA256SUMS with the release key, checks the
// signature, exports the public key, uploads both to the draft and, with --publish, publishes it.
// It never reads or copies a private key: GnuPG makes the signature and asks for the passphrase.
//
//   node scripts/sign-release.mjs v<version> [--publish] [--dry-run]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

/** The repository whose draft release and build attestations are checked. */
const REPOSITORY = "hobby-eng/mnemocode";
/** The owner's OpenPGP release key; README.md and docs/RELEASING.md show the same fingerprint. */
const SIGNING_KEY = "28FC51B1DB80DF2101128CB30EDD4814591DD095";
const CHECKSUMS = "SHA256SUMS";
const SIGNATURE = "SHA256SUMS.asc";
const PUBLIC_KEY = "RELEASE-SIGNING-KEY.asc";
/** A tag as the release workflow accepts it: "v" and the version in package.json. */
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
/**
 * A line of SHA256SUMS as the release workflow writes it: 64 hex digits, two spaces and a plain
 * file name. A name may not start with "-" or ".", so that it can never pass for an option or a
 * hidden file, and never holds a path.
 */
const CHECKSUM_LINE = /^[0-9a-f]{64} {2}([A-Za-z0-9_][A-Za-z0-9._-]*)$/u;

/** SGR codes of the shared palette, the same as STYLE in src/cli/terminal.ts. */
const STYLE = {
  heading: "1;36",
  accent: "36",
  strong: "1",
  muted: "90",
  good: "1;32",
  warning: "1;33",
  bad: "1;31",
};

/** Whether `stream` gets colour, decided as terminalColor in src/cli/terminal.ts decides it. */
function colorOn(stream) {
  const environment = process.env;
  if (environment.NO_COLOR !== undefined && environment.NO_COLOR !== "") return false;
  const force = environment.CLICOLOR_FORCE;
  if (force !== undefined && force !== "" && force !== "0") return true;
  if (stream.isTTY !== true) return false;
  if (environment.TERM === "dumb") return false;
  return environment.CLICOLOR !== "0";
}

function paint(stream, code, text) {
  return colorOn(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;
}

/** A checked fact after a green ✓, with its value in bold. */
function passed(label, value) {
  const { stderr } = process;
  console.error(`${paint(stderr, STYLE.good, "✓")} ${label} ${paint(stderr, STYLE.strong, value)}`);
}

function warn(message) {
  const { stderr } = process;
  console.error(`${paint(stderr, STYLE.warning, "!")} ${paint(stderr, STYLE.warning, message)}`);
}

/** One line after a red "✗ Error:"; without colour, the plain form of src/cli/terminal.ts. */
function fail(message) {
  if (!colorOn(process.stderr)) console.error(`sign-release: ${message}`);
  else console.error(`${paint(process.stderr, STYLE.bad, "✗ Error:")} ${message}`);
}

/** "MnemoCode · <title>" and its facts as grey labels with their values. */
function printResult(title, rows) {
  const { stdout } = process;
  const dot = paint(stdout, STYLE.muted, "·");
  console.log(
    `\n${paint(stdout, STYLE.heading, "MnemoCode")} ${dot} ${paint(stdout, STYLE.strong, title)}`,
  );
  const width = Math.max(10, ...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`  ${paint(stdout, STYLE.muted, label.padEnd(width))} ${value}`);
  }
}

/** A command as it would be typed in a shell: an argument with special characters is quoted. */
function shellLine([command, args]) {
  const quote = (part) =>
    /^[\w@%+=:,./-]+$/u.test(part) ? part : `'${part.replaceAll("'", "'\\''")}'`;
  return [command, ...args].map(quote).join(" ");
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
  // Every release of the tag, drafts included, as "<draft> <page>" lines. GitHub does not tie a
  // draft to its tag, so one tag can have two drafts, and gh would then pick one on its own.
  releases: (tag) => [
    "gh",
    [
      "api",
      "--paginate",
      `repos/${REPOSITORY}/releases`,
      "--jq",
      `.[] | select(.tag_name == ${JSON.stringify(tag)}) | ` +
        `[(.draft | tostring), .html_url] | join(" ")`,
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

class Cancelled extends Error {}

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
 * Runs a command and waits for it. With `terminal` it shares the terminal, where GnuPG asks for the
 * passphrase; otherwise its output is kept back and returned. A program that is not installed, or
 * a Ctrl+C, stops the script here.
 */
async function run(step, { cwd = root, terminal = false } = {}) {
  await nextTurn();
  if (interrupted) throw new Cancelled();
  const [command, args] = step;
  const result = await new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: terminal ? "inherit" : ["ignore", "pipe", "pipe"],
    });
    const output = { stdout: "", stderr: "" };
    child.stdout?.setEncoding("utf8").on("data", (text) => (output.stdout += text));
    child.stderr?.setEncoding("utf8").on("data", (text) => (output.stderr += text));
    child.on("error", (error) => resolve({ ...output, error }));
    child.on("close", (status, signal) => resolve({ ...output, status, signal }));
  });
  // A program that catches Ctrl+C may end before Node's listener has run.
  await nextTurn();
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} is not installed; ${INSTALL_HINTS[command]}.`);
  }
  if (result.error !== undefined) throw result.error;
  if (interrupted || result.signal === "SIGINT") throw new Cancelled();
  return result;
}

function failure(what, result) {
  const said = lastLine(result.stderr) || lastLine(result.stdout);
  return new Error(said === "" ? `${what} failed.` : `${what} failed: ${said}`);
}

/** Whether a checking command succeeds. */
async function succeeds(step) {
  return (await run(step)).status === 0;
}

/** Runs a command that only reads or checks and returns its output; a failure stops the script. */
async function runQuietly(what, step, cwd = root) {
  const result = await run(step, { cwd });
  if (result.status !== 0) throw failure(what, result);
  return result.stdout;
}

/** Runs a command in the terminal, where GnuPG can ask for the passphrase itself. */
async function runInTerminal(what, step, cwd) {
  const result = await run(step, { cwd, terminal: true });
  if (result.status !== 0) throw failure(what, result);
}

function parseArguments(argv) {
  const options = { tag: undefined, publish: false, dryRun: false, help: false };
  for (const argument of argv) {
    if (argument === "--publish") options.publish = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "-h" || argument === "--help") options.help = true;
    else if (argument.startsWith("-")) throw new Error(`Unknown option ${argument}; see --help.`);
    else if (options.tag === undefined) options.tag = argument;
    else throw new Error(`Give one release tag, not ${argument} too.`);
  }
  if (options.help) return options;
  if (options.tag === undefined) {
    throw new Error("Give the release tag, for example: node scripts/sign-release.mjs v0.1.0");
  }
  if (!TAG.test(options.tag)) {
    throw new Error(`${options.tag} is not a release tag; it looks like v0.1.0.`);
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
      `${heading("MnemoCode")} ${muted("·")} sign a draft release with the owner's OpenPGP key`,
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
  if (!(await succeeds(COMMANDS.attestationTool()))) {
    throw new Error("This GitHub CLI has no gh attestation command; install a newer one.");
  }
  if (!(await succeeds(COMMANDS.secretKey()))) {
    throw new Error(`GnuPG on this computer has no secret key ${SIGNING_KEY}.`);
  }
  if (!(await succeeds(COMMANDS.checksumTool()))) throw new Error("sha256sum --version failed.");
}

/**
 * The address of the draft's page. The tag must have exactly one release, a draft: a published
 * release is not signed again, and of two drafts gh would download one on its own.
 */
async function checkDraft(tag) {
  const output = await runQuietly(`Reading the releases of ${REPOSITORY}`, COMMANDS.releases(tag));
  const releases = output
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.split(" "));
  if (releases.length === 0) {
    throw new Error(`GitHub has no release ${tag}; the tag's workflow creates its draft.`);
  }
  if (releases.some(([draft]) => draft !== "true")) {
    throw new Error(`${tag} is published already; only a draft is signed.`);
  }
  if (releases.length > 1) {
    throw new Error(
      `${tag} has ${releases.length} drafts on GitHub; delete all but the one to sign, then retry.`,
    );
  }
  return releases[0][1];
}

/** The download goes into a new folder, so that no file of an earlier run is signed by mistake. */
function folderExistsError(folder) {
  return new Error(`${folder}/ exists already; move it away or remove it, then run again.`);
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
 * The files that SHA256SUMS lists. The folder must hold exactly these and SHA256SUMS, apart from
 * a signature and a public key that an earlier, unfinished run uploaded and this run replaces.
 */
function listedFiles(folderPath, version) {
  const present = readdirSync(folderPath);
  if (!present.includes(CHECKSUMS)) throw new Error(`The draft has no ${CHECKSUMS}.`);
  const lines = readFileSync(join(folderPath, CHECKSUMS), "utf8").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) throw new Error(`${CHECKSUMS} lists no file.`);
  const files = lines.map((line, index) => {
    const name = CHECKSUM_LINE.exec(line)?.[1];
    if (name === undefined) {
      throw new Error(`${CHECKSUMS} line ${index + 1} is not "<sha-256>  <file>".`);
    }
    if (!name.startsWith(`mnemocode-${version}-`)) {
      throw new Error(`${CHECKSUMS} lists ${name}, which is no file of version ${version}.`);
    }
    return name;
  });
  for (const name of present) {
    if (name === CHECKSUMS || files.includes(name)) continue;
    if (name === SIGNATURE || name === PUBLIC_KEY) {
      warn(`The draft holds an earlier ${name}; this run replaces it.`);
      continue;
    }
    throw new Error(`The draft holds ${name}, which ${CHECKSUMS} does not list.`);
  }
  for (const name of files) {
    if (!present.includes(name)) {
      throw new Error(`The draft lacks ${name}, which ${CHECKSUMS} lists.`);
    }
  }
  return files;
}

/** sha256sum names each file that differs from its line in SHA256SUMS: "<file>: FAILED". */
async function checkChecksums(folderPath) {
  const result = await run(COMMANDS.checksums(), { cwd: folderPath });
  if (result.status === 0) return;
  const differing = result.stdout
    .split("\n")
    .filter((line) => line.endsWith(": FAILED"))
    .map((line) => line.slice(0, -": FAILED".length));
  if (differing.length === 0) {
    throw new Error(`Checking the files against ${CHECKSUMS} failed: ${lastLine(result.stderr)}`);
  }
  throw new Error(`${differing.join(", ")}: the download differs from ${CHECKSUMS}.`);
}

/**
 * The signature must be good and made by the release key or one of its subkeys: VALIDSIG names
 * the signing key first and the primary key last (GnuPG's doc/DETAILS).
 */
async function checkSignature(folderPath) {
  const status = await runQuietly(`Checking ${SIGNATURE}`, COMMANDS.verify(), folderPath);
  const valid = status
    .split("\n")
    .filter((line) => line.startsWith("[GNUPG:] VALIDSIG "))
    .some((line) => {
      const fields = line.split(" ").slice(2);
      return fields[0] === SIGNING_KEY || fields.at(-1) === SIGNING_KEY;
    });
  if (!valid) {
    throw new Error(`GnuPG did not confirm ${SIGNATURE} as a signature by ${SIGNING_KEY}.`);
  }
}

function checkPublicKey(folderPath) {
  const text = readFileSync(join(folderPath, PUBLIC_KEY), "utf8");
  if (!text.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
    throw new Error(`GnuPG exported no public key ${SIGNING_KEY} to ${PUBLIC_KEY}.`);
  }
}

async function signRelease({ tag, publish }, folder) {
  const version = tag.slice(1);
  const folderPath = join(root, folder);
  if (existsSync(folderPath)) throw folderExistsError(folder);
  listenForCtrlC();
  await checkTools();
  const draftPage = await checkDraft(tag);
  passed("Draft", tag);

  makeFolder(folder);
  await runQuietly(`Downloading the draft ${tag}`, COMMANDS.download(tag, folder));
  const files = listedFiles(folderPath, version);
  await checkChecksums(folderPath);
  passed("Checksums", `${files.length} files match ${CHECKSUMS}`);
  for (const file of files) {
    await runQuietly(`Checking the attestation of ${file}`, COMMANDS.attestation(file), folderPath);
    passed("Attestation", file);
  }

  await runInTerminal(`Signing ${CHECKSUMS}`, COMMANDS.sign(), folderPath);
  await checkSignature(folderPath);
  passed("Signature", `${SIGNATURE} by ${SIGNING_KEY}`);
  await runQuietly(`Exporting the public key ${SIGNING_KEY}`, COMMANDS.exportKey(), folderPath);
  checkPublicKey(folderPath);
  passed("Public key", PUBLIC_KEY);

  await runQuietly(`Uploading ${SIGNATURE} and ${PUBLIC_KEY}`, COMMANDS.upload(tag), folderPath);
  passed("Uploaded", `${SIGNATURE} ${PUBLIC_KEY}`);
  if (publish) await runQuietly(`Publishing ${tag}`, COMMANDS.publish(tag));

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
  const options = parseArguments(argv);
  if (options.help) {
    printHelp();
    return;
  }
  const folder = `release-signing-${options.tag}`;
  if (options.dryRun) printPlan(options, folder);
  else await signRelease(options, folder);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof Cancelled) {
    console.error("Cancelled.");
    process.exitCode = 130;
  } else {
    fail(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

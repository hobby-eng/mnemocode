// The safety limits of scripts/sign-release.mjs (CORE-48, CORE-50): what GitHub and the downloaded
// draft report is refused before any file is checked or signed when it is larger or longer than a
// release can be. The script runs from a copy in a temporary folder, beside a link to src/, so that
// the folder it downloads into lands there and never in the checkout. Fake gh, gpg and sha256sum
// stand in for the programs; the fake gpg refuses to sign, so that a run that passes every check
// ends there. Synthetic data only: no release, key or network is touched.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MEBIBYTE } from "../src/core/byte-units.js";
import { TEST_TIME_LIMIT_MS } from "./helpers/limits.js";

/** The scripts that the signing script runs with; its other imports come from src/. */
const SCRIPTS = ["sign-release.mjs", "executable-files.mjs", "release-key.mjs"];
const VERSION = "9.9.9";
const TAG = `v${VERSION}`;
/** The draft's page, as the fake list of releases gives it. */
const PAGE = "https://example.invalid/draft";
/** The files of a release: two for each of three systems (scripts/executable-files.mjs). */
const RELEASE_FILES = 6;
/** Those files, SHA256SUMS, and the signature and public key of an unfinished earlier run. */
const DRAFT_FILES = 9;
/** The largest file that the draft may hold: 512 MiB. */
const DRAFT_FILE_BYTES = 512 * MEBIBYTE;

/** gh: the list of releases, the download of the draft, and the attestations, each traced. */
const FAKE_GH = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
// The script stops reading once a limit is passed; the rest of the output is not needed.
process.stdout.on("error", () => process.exit(0));
if (args[0] === "attestation" && args[2] === "--help") process.exit(0);
if (args[0] === "api") {
  const line = process.env.FAKE_RELEASES;
  const bytes = Number(process.env.FAKE_RELEASES_BYTES);
  const text = bytes > 0 ? line.repeat(Math.ceil(bytes / line.length)) : line;
  process.stdout.write(text, () => process.exit(0));
} else if (args[0] === "release" && args[1] === "download") {
  const folder = args[args.indexOf("--dir") + 1];
  const files = JSON.parse(fs.readFileSync(process.env.FAKE_FILES, "utf8"));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), text);
} else if (args[0] === "attestation" && args[1] === "verify") {
  fs.appendFileSync(process.env.FAKE_TRACE, args[2] + "\n");
} else {
  process.stderr.write("fake gh: unexpected " + args.join(" ") + "\n");
  process.exit(3);
}
`;

/** gpg: has the key, and refuses to sign, which ends a run that passed every check. */
const FAKE_GPG = String.raw`
if (process.argv.includes("--list-secret-keys")) process.exit(0);
process.stderr.write("fake gpg: refusing to sign\n");
process.exit(1);
`;

/** sha256sum: --version, and --check --strict of SHA256SUMS in the current folder. */
const FAKE_SHA256SUM = String.raw`
const fs = require("node:fs");
const { createHash } = require("node:crypto");
if (process.argv[2] === "--version") process.exit(0);
const lines = fs.readFileSync("SHA256SUMS", "utf8").split("\n").filter((line) => line !== "");
const matches = lines.every((line) => {
  const [sum, name] = line.split("  ");
  return createHash("sha256").update(fs.readFileSync(name)).digest("hex") === sum;
});
process.exit(matches ? 0 : 1);
`;

let folder = "";
let mirror = "";
let fakes = "";

/** Writes `body` as the program `name` that the script finds first on its PATH. */
function fake(name: string, body: string): void {
  const file = join(fakes, name);
  writeFileSync(file, `#!${process.execPath}\n${body}`);
  chmodSync(file, 0o700);
}

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "mnemocode-release-signing-"));
  mirror = join(folder, "checkout");
  fakes = join(folder, "bin");
  mkdirSync(join(mirror, "scripts"), { recursive: true });
  mkdirSync(fakes);
  for (const name of SCRIPTS) copyFileSync(join("scripts", name), join(mirror, "scripts", name));
  symlinkSync(resolve("src"), join(mirror, "src"));
  fake("gh", FAKE_GH);
  fake("gpg", FAKE_GPG);
  fake("sha256sum", FAKE_SHA256SUM);
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** The name of the release file `place`, as a release names its files. */
function releaseFile(place: number | string): string {
  return `mnemocode-${VERSION}-linux-x64-${place}`;
}

/** The SHA256SUMS line of `name`, for the content that `filesOf` gives it. */
function checksumLine(name: string): string {
  return `${createHash("sha256").update(`content of ${name}`).digest("hex")}  ${name}`;
}

/** The files of a draft that holds `names` and a SHA256SUMS of their lines and `extra` ones. */
function filesOf(names: readonly string[], extra: readonly string[] = []): Record<string, string> {
  const files = Object.fromEntries(names.map((name) => [name, `content of ${name}`]));
  return { ...files, SHA256SUMS: `${[...names.map(checksumLine), ...extra].join("\n")}\n` };
}

/** A line of the list of releases: a draft with `count` files, the largest of `largest` bytes. */
function draft(count: number, largest = 1000): string {
  return `true ${PAGE} ${count} ${largest}\n`;
}

/** A whole release: its six files and their SHA256SUMS. */
const RELEASE = filesOf(Array.from({ length: RELEASE_FILES }, (_, place) => releaseFile(place)));

interface Signing {
  /** The list of releases that gh gives, repeated up to `releasesBytes` where that is set. */
  readonly releases: string;
  readonly releasesBytes?: number;
  /** The files of the draft that gh downloads, by name. */
  readonly files: Record<string, string>;
}

/**
 * Runs the copy of the signing script for TAG: its exit status, its output, the last line of its
 * errors, and the files whose attestation it checked, in order.
 */
function sign({ releases, releasesBytes = 0, files }: Signing) {
  const trace = join(fakes, "attestations.txt");
  const filesPath = join(fakes, "files.json");
  writeFileSync(trace, "");
  writeFileSync(filesPath, JSON.stringify(files));
  rmSync(join(mirror, `release-signing-${TAG}`), { recursive: true, force: true });
  const run = spawnSync(process.execPath, [join(mirror, "scripts", "sign-release.mjs"), TAG], {
    encoding: "utf8",
    timeout: TEST_TIME_LIMIT_MS,
    env: {
      PATH: fakes,
      NO_COLOR: "1",
      FAKE_TRACE: trace,
      FAKE_RELEASES: releases,
      FAKE_RELEASES_BYTES: String(releasesBytes),
      FAKE_FILES: filesPath,
    },
  });
  if (run.error) throw run.error;
  const lines = run.stderr.trimEnd().split("\n");
  const attested = readFileSync(trace, "utf8").split("\n").filter(Boolean);
  return { status: run.status, last: lines.at(-1), stdout: run.stdout, attested };
}

describe.skipIf(process.platform === "win32")("Release signing limits", () => {
  it("signs a draft at every limit: nine files, the largest of 512 MiB, six listed", () => {
    const run = sign({ releases: draft(DRAFT_FILES, DRAFT_FILE_BYTES), files: RELEASE });
    // Every check passed: the fake gpg refused the signature, after each attestation.
    expect(run.last).toBe("sign-release: Signing SHA256SUMS failed.");
    expect(run.attested).toEqual(Object.keys(RELEASE).filter((name) => name !== "SHA256SUMS"));
  });

  it.each<[string, Signing, string]>([
    [
      "a list of releases longer than 1 MiB",
      { releases: draft(7), releasesBytes: 2 * MEBIBYTE, files: RELEASE },
      "The output of gh exceeds the 1 MiB safety limit.",
    ],
    [
      "a draft of ten files",
      { releases: draft(DRAFT_FILES + 1), files: RELEASE },
      "The draft holds 10 files, more than the 9 of a release and its signature.",
    ],
    [
      "a draft with a file one byte over 512 MiB",
      { releases: draft(7, DRAFT_FILE_BYTES + 1), files: RELEASE },
      "A file of the draft exceeds the 512 MiB safety limit.",
    ],
    [
      "a line of the list of releases without its counts",
      { releases: `true ${PAGE} seven\n`, files: RELEASE },
      `A line of GitHub's list of releases is not "<draft> <page> <files> <largest size>".`,
    ],
    [
      "a SHA256SUMS over 1 MiB",
      {
        releases: draft(2),
        files: { SHA256SUMS: `${"0".repeat(64)}  ${releaseFile("x".repeat(MEBIBYTE))}\n` },
      },
      "SHA256SUMS exceeds the 1 MiB safety limit.",
    ],
    [
      "a SHA256SUMS of seven files",
      { releases: draft(8), files: filesOf(Array.from({ length: 7 }, (_, at) => releaseFile(at))) },
      "SHA256SUMS lists 7 files, more than the 6 of a release.",
    ],
    [
      "a SHA256SUMS that lists a file twice",
      { releases: draft(2), files: filesOf([releaseFile(1)], [checksumLine(releaseFile(1))]) },
      `SHA256SUMS lists ${releaseFile(1)} twice.`,
    ],
  ])("refuses %s before any attestation is checked", (_, signing, message) => {
    const run = sign(signing);
    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.last).toBe(`sign-release: ${message}`);
    expect(run.attested).toEqual([]);
  });
});

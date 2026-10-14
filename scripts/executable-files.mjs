import { ErrorCatalog } from "../src/core/error-catalog.ts";

const ERRORS = new ErrorCatalog("scripts.executable-files", {
  /**
   * @param {string} value0
   */
  "no-executable-built": (value0) => `No executable is built for ${value0}.`,
});
// The names of the files of a release: a single executable, its license notices and its checksums,
// the folder they are built into and the checksum line. build-executable.mjs writes them,
// verify-executable.mjs checks them and sign-release.mjs reads them back from the draft release,
// so that all three mean the same files.

/** The folder of the checkout that build-executable.mjs writes into by default. */
export const RELEASE_FOLDER = "release";

/** "linux-x64", "win-x64", "macos-arm64": the names Node.js uses for its own downloads. */
const SYSTEM_NAMES = { linux: "linux", win32: "win", darwin: "macos" };

/** What every file of a release of `version` starts with: mnemocode-<version>-. */
export function releaseFilePrefix(version) {
  return `mnemocode-${version}-`;
}

/** mnemocode-<version>-<system>-<processor>[.exe] for the computer this runs on. */
export function executableName(version) {
  const system = SYSTEM_NAMES[process.platform];
  if (system === undefined) throw ERRORS.create("no-executable-built", [`${process.platform}`]);
  return `${releaseFilePrefix(version)}${system}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
}

/**
 * The license notices that travel with an executable: its name without .exe, then -licenses.txt.
 */
export function noticesName(executable) {
  return `${executable.replace(/\.exe$/u, "")}-licenses.txt`;
}

/** The checksums of one executable and its notices; the workflow joins them into SHA256SUMS. */
export function checksumsName(executable) {
  return `${executable}.sha256`;
}

/** A line of a checksum file, as sha256sum writes it: the hex SHA-256, two spaces, the name. */
export function checksumLine(sha256, file) {
  return `${sha256}  ${file}`;
}

/**
 * A line of a checksum file as checksumLine writes it: 64 hex digits, two spaces and a plain file
 * name. A name may not start with "-" or ".", so that it can never pass for an option or a hidden
 * file, and never holds a path.
 */
export const CHECKSUM_LINE = /^[0-9a-f]{64} {2}([A-Za-z0-9_][A-Za-z0-9._-]*)$/u;

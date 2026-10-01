// The file names of a single executable and of its license notices, shared by
// build-executable.mjs and verify-executable.mjs so that both mean the same file.

/** "linux-x64", "win-x64", "macos-arm64": the names Node.js uses for its own downloads. */
const SYSTEM_NAMES = { linux: "linux", win32: "win", darwin: "macos" };

/** mnemocode-<version>-<system>-<processor>[.exe] for the computer this runs on. */
export function executableName(version) {
  const system = SYSTEM_NAMES[process.platform];
  if (system === undefined) throw new Error(`No executable is built for ${process.platform}.`);
  return `mnemocode-${version}-${system}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`;
}

/** The license notices that travel with an executable: its name without .exe, then -licenses.txt. */
export function noticesName(executable) {
  return `${executable.replace(/\.exe$/u, "")}-licenses.txt`;
}

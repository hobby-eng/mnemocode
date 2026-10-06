// AUD-008: compare actual CLI starts under canonical and inherited Node permissions.
// Only a published zero-entropy BIP39 phrase is processed; no network operation is made.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync } from "node:fs";

const flags = JSON.parse(readFileSync("src/cli/protection-flags.json", "utf8"));
const captureRoot = mkdtempSync("docs/audits/AUD-008-evidence/security-permissions-");
const marker = "AUD008_PERMISSION ";
const observe = `process.once("exit", () => console.error(${JSON.stringify(marker)} + JSON.stringify({
  protected: process.permission !== undefined,
  net: process.permission?.has("net"),
  worker: process.permission?.has("worker"),
  addons: process.permission?.has("addons"),
  child: process.permission?.has("child"),
  write: process.permission?.has("fs.write"),
  ffi: process.permission?.has("ffi")
})));`;
const hook = `data:text/javascript,${encodeURIComponent(observe)}`;
const phrase = `${"abandon ".repeat(11)}about`;
const command = [
  "dist/mnemocode.js",
  "decode",
  "--mode",
  "direct",
  "--format",
  "english",
  "--input",
  phrase,
];
const cases = [
  { name: "canonical", arguments: [...flags], environment: {} },
  { name: "caller-granted-network", arguments: [...flags, "--allow-net=*"], environment: {} },
  {
    name: "caller-granted-worker-and-addons",
    arguments: [...flags, "--allow-worker", "--allow-addons"],
    environment: {},
  },
  {
    name: "caller-environment-granted-network",
    arguments: [],
    environment: {
      NODE_OPTIONS: `${flags.join(" ")} --allow-net=*`,
    },
  },
];
let invariantFailures = 0;
for (const probe of cases) {
  // A regular file avoids the independently observed CLI/pipe capture failure under hardening.
  const capturePath = `${captureRoot}/${probe.name}.output.txt`;
  const capture = openSync(capturePath, "wx", 0o600);
  const result = spawnSync(process.execPath, [...probe.arguments, "--import", hook, ...command], {
    env: { ...process.env, NODE_OPTIONS: "", NO_COLOR: "1", ...probe.environment },
    stdio: ["ignore", capture, capture],
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 128 * 1024,
  });
  closeSync(capture);
  const output = readFileSync(capturePath, "utf8");
  assert.equal(result.status, 0, `${probe.name}: ${output}`);
  const observations = output
    .split("\n")
    .filter((line) => line.startsWith(marker))
    .map((line) => JSON.parse(line.slice(marker.length)));
  const protectedRun = observations.find((entry) => entry.protected);
  assert(
    protectedRun,
    `${probe.name}: no protected run observed; output=${JSON.stringify(output)}`,
  );
  assert.equal(protectedRun.ffi, false);
  assert.equal(protectedRun.child, false);
  assert.equal(protectedRun.write, false);
  const invariantHeld = !protectedRun.net && !protectedRun.worker && !protectedRun.addons;
  if (!invariantHeld) invariantFailures += 1;
  console.log(
    JSON.stringify({ name: probe.name, exitCode: result.status, protectedRun, invariantHeld }),
  );
}
console.log(JSON.stringify({ probes: cases.length, invariantFailures, transmittedData: false }));
process.exitCode = invariantFailures === 0 ? 0 : 1;

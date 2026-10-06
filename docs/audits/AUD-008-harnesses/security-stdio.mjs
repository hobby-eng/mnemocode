// AUD-008: isolate empty CLI output under pipe capture using only a synthetic marker.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";

const flags = JSON.parse(readFileSync("src/cli/protection-flags.json", "utf8"));
const captureRoot = mkdtempSync("docs/audits/AUD-008-evidence/security-stdio-");
const probes = [
  { name: "no-hardening", harden: false, early: false, drop: false },
  { name: "harden-only", harden: true, early: false, drop: false },
  { name: "harden-and-drop", harden: true, early: false, drop: true },
  { name: "initialize-stdio-before-hardening", harden: true, early: true, drop: true },
];
let failed = 0;
for (const probe of probes) {
  const capturePath = `${captureRoot}/${probe.name}.json`;
  const program = `
    import { openSync, writeSync, closeSync } from "node:fs";
    import * as protection from "./dist/cli/protection.js";
    const result = openSync(${JSON.stringify(capturePath)}, "wx", 0o600);
    ${probe.early ? "process.stdout; process.stderr;" : ""}
    ${probe.harden ? "await protection.hardenProcess();" : ""}
    ${probe.drop ? 'protection.dropUnneeded("decode", {});' : ""}
    let error;
    try {
      process.stdout.write("synthetic stdout marker\\n", (writeError) => {
        writeSync(result, JSON.stringify({ stdoutWriteError: writeError?.code ?? null }));
        closeSync(result);
      });
      process.stderr.write("synthetic stderr marker\\n");
    } catch (thrown) {
      error = { thrown: thrown.code ?? thrown.message };
      writeSync(result, JSON.stringify(error));
      closeSync(result);
    }
  `;
  const child = spawnSync(process.execPath, [...flags, "--input-type=module", "-e", program], {
    encoding: "utf8",
    timeout: 8_000,
    maxBuffer: 64 * 1024,
  });
  assert.equal(child.status, 0, child.stderr);
  const observed = {
    name: probe.name,
    stdout: child.stdout.trim(),
    stderr: child.stderr.trim(),
    diagnosis: readFileSync(capturePath, "utf8"),
    localEvidence: capturePath,
  };
  const passed =
    child.stdout.includes("synthetic stdout marker") &&
    child.stderr.includes("synthetic stderr marker");
  if (!passed) failed += 1;
  console.log(JSON.stringify({ ...observed, passed }));
}
console.log(JSON.stringify({ probes: probes.length, emptyStreamCases: failed }));
process.exitCode = failed === 0 ? 0 : 1;

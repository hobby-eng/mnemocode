// AUD-037: runs one command and keeps its local evidence in docs/audits/AUD-037-evidence/:
// <name>.log with everything the command printed (standard output and error, in order), and
// <name>.command.json with the exact command, the UTC start and end, the exit code and the log's
// SHA-256. It exits with the command's own exit code, so that a failed check stays failed.
//
// Usage, from the repository root:
//   node docs/audits/AUD-037-harnesses/run.mjs <name> <program> [arguments...]
// A command that needs a shell (a pipe, a redirection) is given as: sh -c "<command>".

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE = "docs/audits/AUD-037-evidence";
const [name, program, ...args] = process.argv.slice(2);
if (name === undefined || program === undefined || !/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(name)) {
  console.error("Usage: node docs/audits/AUD-037-harnesses/run.mjs <name> <program> [arguments...]");
  process.exit(2);
}
mkdirSync(EVIDENCE, { recursive: true });
const log = join(EVIDENCE, `${name}.log`);
// An earlier result is never overwritten: a rerun takes a name of its own.
if (existsSync(log)) {
  console.error(`${log} exists already; give this run another name.`);
  process.exit(2);
}
const started = new Date().toISOString();
const output = openSync(log, "w");
const result = spawnSync(program, args, { stdio: ["ignore", output, output] });
closeSync(output);
const ended = new Date().toISOString();
const exitCode = result.error === undefined ? (result.status ?? 128) : 127;
const record = {
  name,
  command: [program, ...args],
  cwd: process.cwd(),
  startedUtc: started,
  endedUtc: ended,
  exitCode,
  signal: result.signal ?? null,
  spawnError: result.error === undefined ? null : String(result.error),
  logSha256: createHash("sha256").update(readFileSync(log)).digest("hex"),
};
writeFileSync(join(EVIDENCE, `${name}.command.json`), `${JSON.stringify(record, null, 2)}\n`);
console.log(`${name}: exit ${exitCode}, ${started} to ${ended}, log ${log}`);
process.exit(exitCode);

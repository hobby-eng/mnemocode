import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, createWriteStream } from "node:fs";
import { join } from "node:path";

const [name, command, ...args] = process.argv.slice(2);
if (!/^[a-z0-9-]+$/.test(name ?? "") || !command) {
  throw new Error("Usage: node run-command.mjs name command [args]");
}
const directory = "docs/audits/AUD-009-evidence";
mkdirSync(directory, { recursive: true });
const logPath = join(directory, name + ".log");
const log = createWriteStream(logPath);
const startedAt = new Date().toISOString();
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (bytes) => log.write(bytes));
child.stderr.on("data", (bytes) => log.write(bytes));
let failure;
child.on("error", (error) => { failure = error.message; log.write(error.stack + "\n"); });
child.on("close", (code, signal) => {
  log.end(() => {
    const bytes = readFileSync(logPath);
    const record = { command: [command, ...args], cwd: process.cwd(), startedAt,
      endedAt: new Date().toISOString(), exitCode: code, signal, failure: failure ?? null,
      logSha256: createHash("sha256").update(bytes).digest("hex") };
    writeFileSync(join(directory, name + ".command.json"), JSON.stringify(record, null, 2) + "\n");
    process.stdout.write(bytes);
    console.log(JSON.stringify(record));
    process.exitCode = code ?? 1;
  });
});

// Record one command with the retained sequential AUD-026 memory gate.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const [label, ...command] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/u.test(label) || command.length === 0)
  throw new Error("Use run.mjs LABEL COMMAND [ARGUMENTS].");
for (const suffix of [".log", ".command.json"])
  if (existsSync(`${root}docs/audits/AUD-032-evidence/${label}${suffix}`))
    throw new Error("Choose a fresh evidence label; retained results are immutable.");
const script = `
import importlib.util, json, os, sys
from pathlib import Path
root = Path.cwd()
spec = importlib.util.spec_from_file_location("audit_gate", root / "docs/audits/AUD-026-harnesses/audit.py")
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
gate.EVIDENCE = root / "docs/audits/AUD-032-evidence"
gate.EVIDENCE.mkdir(exist_ok=True)
label, *command = sys.argv[1:]
code = gate.check(label, command)
path = gate.EVIDENCE / (label + ".command.json")
record = json.loads(path.read_text())
record["auditId"] = "AUD-032"
record["environmentOverrides"] = {key: os.environ[key] for key in (
    "AUD026_RSS_MIB", "AUD026_HEAP_MIB", "AUD026_TIMEOUT_SECONDS",
    "CARGO_HOME", "RUSTUP_HOME", "CARGO_BUILD_JOBS", "TMPDIR", "TMP", "TEMP"
) if key in os.environ}
record["effectiveEnvironment"] = {"TZ": "UTC", "NODE_OPTIONS": "--max-old-space-size=" + str(gate.HEAP_MIB), "GOMEMLIMIT": "128MiB"}
path.write_text(json.dumps(record, indent=2) + "\\n")
raise SystemExit(code)
`;
try {
  execFileSync("python3", ["-B", "-c", script, label, ...command], {
    cwd: root,
    stdio: "inherit",
  });
} catch (error) {
  if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number")
    throw error;
  process.exitCode = error.status;
}

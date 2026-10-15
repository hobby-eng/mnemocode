// Reuse the retained AUD-026 sequential memory guard without copying its implementation.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const [label, ...command] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/u.test(label) || command.length === 0)
  throw new Error("Use run.mjs LABEL COMMAND [ARGUMENTS].");
for (const suffix of [".log", ".command.json"])
  if (existsSync(root + "docs/audits/AUD-030-evidence/" + label + suffix))
    throw new Error("Use a fresh label; retained command evidence must not be overwritten.");
const script = `
import importlib.util, json, sys
from pathlib import Path
root = Path.cwd()
spec = importlib.util.spec_from_file_location('audit_guard', root / 'docs/audits/AUD-026-harnesses/audit.py')
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.EVIDENCE = root / 'docs/audits/AUD-030-evidence'
guard.EVIDENCE.mkdir(exist_ok=True)
label, *command = sys.argv[1:]
code = guard.check(label, command)
path = guard.EVIDENCE / (label + '.command.json')
record = json.loads(path.read_text())
record['auditId'] = 'AUD-030'
path.write_text(json.dumps(record, indent=2) + '\\n')
raise SystemExit(code)
`;
try {
  execFileSync("python3", ["-B", "-c", script, label, ...command], { cwd: root, stdio: "inherit" });
} catch (error) {
  if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number")
    throw error;
  process.exitCode = error.status;
}

// Reuse the frozen memory guard; this adapter changes only the new evidence destination.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const [label, ...command] = process.argv.slice(2);
if (!label || !/^[a-z0-9-]+$/u.test(label) || !command.length)
  throw new Error("Use run.mjs LABEL COMMAND [ARGUMENTS].");
for (const suffix of [".log", ".command.json"])
  if (existsSync(`docs/audits/AUD-035-evidence/${label}${suffix}`))
    throw new Error("Evidence labels are immutable; choose a fresh label.");
const script = `
import importlib.util, sys
from pathlib import Path
path = Path("docs/audits/AUD-026-harnesses/audit.py")
spec = importlib.util.spec_from_file_location("guard", path)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.EVIDENCE = Path.cwd() / "docs/audits/AUD-035-evidence"
guard.EVIDENCE.mkdir(exist_ok=True)
label, *command = sys.argv[1:]
raise SystemExit(guard.check(label, command))
`;
try {
  execFileSync("python3", ["-B", "-c", script, label, ...command], { stdio: "inherit" });
} catch (error) {
  if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number")
    throw error;
  process.exitCode = error.status;
}

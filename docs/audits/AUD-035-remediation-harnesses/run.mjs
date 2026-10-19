// Keep original audit evidence immutable; new fix checks have their own dated subdirectory.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
const [label, ...command] = process.argv.slice(2);
const evidence = "docs/audits/AUD-035-evidence/remediation-2026-10-19";
if (!/^[a-z0-9-]+$/u.test(label ?? "") || command.length === 0)
  throw new Error("Use run.mjs LABEL COMMAND [ARGUMENTS].");
for (const extension of [".log", ".command.json"])
  if (existsSync(`${evidence}/${label}${extension}`)) throw new Error("Choose an unused evidence label.");
const script = `
import importlib.util, sys
from pathlib import Path
path = Path("docs/audits/AUD-026-harnesses/audit.py")
spec = importlib.util.spec_from_file_location("guard", path)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)
guard.EVIDENCE = Path.cwd() / "${evidence}"
guard.EVIDENCE.mkdir(parents=True, exist_ok=True)
raise SystemExit(guard.check(sys.argv[1], sys.argv[2:]))
`;
try {
  execFileSync("python3", ["-B", "-c", script, label, ...command], { stdio: "inherit" });
} catch (error) {
  if (!(error instanceof Error) || !("status" in error) || typeof error.status !== "number") throw error;
  process.exitCode = error.status;
}

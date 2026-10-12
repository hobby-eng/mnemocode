"""Use the frozen memory guard with AUD-017's own evidence directory from the start."""

import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]
SHARED = ROOT / "docs/audits/AUD-014-harnesses/audit.py"


def recorder():
    """Load definitions only; the historical script has an unguarded CLI entry point."""
    tree = ast.parse(SHARED.read_text(), filename=str(SHARED))
    for index, node in enumerate(tree.body):
        if (isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Tuple)
                and isinstance(node.targets[0].elts[0], ast.Name)
                and node.targets[0].elts[0].id == "mode"):
            tree.body = tree.body[:index]
            break
    else:
        raise RuntimeError("The frozen recorder's entry point was not found")
    namespace = {"__file__": str(SHARED), "__name__": "audit_memory_guard"}
    exec(compile(tree, str(SHARED), "exec"), namespace)
    namespace["EVIDENCE"] = ROOT / "docs/audits/AUD-017-evidence"
    return namespace["AuditRun"]()


if __name__ == "__main__":
    mode, label, *command = sys.argv[1:]
    if not label or not all(char.isalnum() or char == "-" for char in label):
        raise SystemExit("Choose a fresh alphanumeric/hyphen label")
    run = recorder()
    if mode == "snapshot":
        run.snapshot(f"aud017-{label}")
    elif mode == "check" and command:
        raise SystemExit(run.check(f"aud017-{label}", command))
    else:
        raise SystemExit("Usage: run.py snapshot LABEL | check LABEL COMMAND [ARGS]")

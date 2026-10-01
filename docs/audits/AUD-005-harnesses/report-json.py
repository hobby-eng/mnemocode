"""Writes docs/audits/AUD-005-2026-10-01.json from the Markdown report (AUD-005).

The Markdown report is the source; this script copies its metadata, coverage ledger, findings,
observations and remediation table into the shared JSON envelope, and adds the command records
of the local evidence folder (exact argv, UTC start and end, exit code, log SHA-256). Rerun it
after every change of the Markdown report so that both records agree.

    python3 docs/audits/AUD-005-harnesses/report-json.py

Exit 0 means the JSON was written; a report section it cannot parse stops it with an error.
"""

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
MARKDOWN = AUDITS / "AUD-005-2026-10-01.md"
OUTPUT = AUDITS / "AUD-005-2026-10-01.json"
EVIDENCE = AUDITS / "AUD-005-evidence"
FIELDS = {
    "Category": "category",
    "Severity": "severity",
    "Status": "status",
    "Release blocking": "releaseBlocking",
    "Affected files and builds": "affectedFiles",
    "Reproduction": "reproduction",
    "Expected behavior": "expected",
    "Observed behavior": "observed",
    "Impact": "impact",
    "Evidence": "evidence",
    "Recommended fix": "recommendedFix",
    "Required verification": "requiredVerification",
}

text = MARKDOWN.read_text()


def section(start, end):
    begin = text.index(start)
    return text[begin : text.index(end, begin)]


def table_rows(block):
    rows = [line for line in block.splitlines() if line.startswith("| ")]
    return [[cell.strip() for cell in row.strip("|").split(" | ")] for row in rows[2:]]


def plain(value):
    return value.replace("`", "").strip()


title = text.splitlines()[0].split(" — ", 1)[1]

coverage = [
    {"id": row[0], "group": row[1], "outcome": row[2], "evidence": row[3], "category": row[0].split("-")[1]}
    for row in table_rows(section("### Coverage ledger", "### Checks"))
]
if len(coverage) != 32:
    raise SystemExit(f"Expected 32 coverage rows, found {len(coverage)}.")

commands = []
for path in sorted(EVIDENCE.glob("*.command.json")):
    commands.append(json.loads(path.read_text()))

findings = []
for block in re.split(r"\n#### ", section("### Findings", "### Remediation and follow-up"))[1:]:
    heading, _, body = block.partition("\n")
    identifier, severity, name = heading.split(" — ", 2)
    record = {"id": identifier, "kind": "finding", "title": name}
    for line in body.splitlines():
        match = re.match(r"- \*\*(.+?):\*\* (.*)$", line)
        if match and match.group(1) in FIELDS:
            record[FIELDS[match.group(1)]] = match.group(2)
    blocking = record["releaseBlocking"]
    record["releaseBlockingReason"] = blocking.split("; ", 1)[1] if "; " in blocking else ""
    record["releaseBlocking"] = blocking.startswith("true")
    record["severity"] = record["severity"].lower()
    record["affectedFiles"] = [plain(record["affectedFiles"]).rstrip(".")]
    record["evidence"] = [plain(item).rstrip(".") for item in record["evidence"].split("; ")]
    if severity.lower() != record["severity"] or not identifier.startswith(f"AUD-005-{record['category']}"):
        raise SystemExit(f"Inconsistent heading for {identifier}.")
    findings.append(record)

remediation = []
for row in table_rows(section("### Remediation and follow-up", "### Informational observations")):
    remediation.append(
        {
            "id": row[0],
            "status": row[1],
            "fixCommit": None if row[2] == "Not fixed" else row[2],
            "verificationCommit": None if row[3] == "Not run" else row[3],
            "evidence": row[4],
        }
    )
status = {item["id"]: item["status"] for item in remediation}
for record in findings:
    if status.get(record["id"]) != record["status"]:
        raise SystemExit(f"Status of {record['id']} differs between finding and remediation table.")

register = {row[0]: row for row in table_rows(section("## Finding register", "## Review evidence"))}
observations = []
for block in re.split(r"\n#### ", section("### Informational observations", "### Assessment"))[1:]:
    heading, _, body = block.partition("\n")
    identifier, name = heading.split(" — ", 1)
    row = register[identifier]
    paragraphs = [p.strip() for p in body.strip().split("\n\n") if p.strip()]
    observations.append(
        {
            "id": identifier,
            "category": row[1],
            "kind": "observation",
            "title": name,
            "severity": "info",
            "status": row[4],
            "releaseBlocking": False,
            "evidence": ["See the Markdown report section of the same ID."],
            "reproduction": paragraphs[0],
            "expected": "Informational; no supported contract is broken.",
            "observed": paragraphs[0],
            "impact": "No demonstrated defect.",
            "recommendedFix": " ".join(paragraphs[1:]) or "See the observation.",
            "requiredVerification": "None for this audit.",
        }
    )
for identifier, row in register.items():
    source = findings if row[2] == "finding" else observations
    match = [item for item in source if item["id"] == identifier]
    if not match or match[0]["status"] != row[4] or match[0]["title"] != row[5]:
        raise SystemExit(f"Finding register row {identifier} differs from its section.")

assessment = text[text.index("### Assessment and limitations") :]
limitations = [line[2:] for line in assessment.splitlines() if line.startswith("- ")]
procedure = {row[0].strip("`"): row[1].strip("`") for row in table_rows(section("The shared audit procedure", "### Coverage ledger"))}

record = {
    "schemaVersion": 1,
    "auditId": "AUD-005",
    "auditNumber": 5,
    "date": "2026-10-01",
    "title": title,
    "reviewer": {"name": "Claude Code (workspace maintainer subagent)", "model": "claude-opus-5-5", "reasoningEffort": None},
    "snapshot": {
        "commit": "8fbcb1361a45af962d524dfbac6789ecd11554cf",
        "commitComplete": True,
        "branch": "main",
        "workingTree": "clean; only the audit's own untracked docs/audits/AUD-005-harnesses/",
        "capturedAt": "2026-10-01T11:08:42Z",
        "sourceFingerprint": "1866dc7f1d8472307e2089346755f72246f22573284d9cf95280be96e92c8460",
        "sourceFingerprintWithoutDocuments": "4341e1579b394e4e25fef550780a9710a772a3b90ea013edb81cebf6274e3466",
        "executableLinuxX64Sha256": "52af2f2b06edd2f1fbe8e2d8aa9640aedd79d45dc7d1a0f353f2e57390dbdd41",
    },
    "scope": {
        "repository": "mnemocode",
        "version": "0.1.0",
        "supported": "Offline CLI and TypeScript library: five representations, direct/seedshift/legacy modes and legacy-valid recovery, MNC1 records, date and word recovery with local Bitcoin evidence, SSKR with color and Bytewords transport, 16 card templates, QR/PDF/PNG/JPEG export, single executable",
        "procedureHashes": procedure,
        "excluded": "Docker canonical rebuild (not authorized), Windows/macOS execution, remote CI and release runs",
    },
    "checks": {"coverage": coverage, "commands": commands},
    "findings": findings,
    "observations": observations,
    "remediation": remediation,
    "limitations": limitations,
}
OUTPUT.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n")
print(f"Wrote {OUTPUT.relative_to(ROOT)}: {len(findings)} findings, {len(observations)} observations, {len(commands)} commands.")

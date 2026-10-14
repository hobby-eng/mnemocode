"""Writes the AUD-024 report of MnemoCode (Markdown and JSON) from the records in report_data.py and
the recorded command evidence, validates the JSON against the workspace schema, checks privacy, and
writes the local SHA256SUMS and report-validation.json of the evidence. Run from the MnemoCode
repository root:

    python3 docs/audits/AUD-024-harnesses/make-report.py

Needs the Python package jsonschema and a multi-chain-wallet-tools checkout beside this repository,
whose docs/audit-report.schema.json it validates against. Exit 1 when a check of the report fails.
"""
import datetime, getpass, hashlib, json, re, sys
from pathlib import Path

import jsonschema

sys.path.insert(0, str(Path(__file__).parent))
import report_data as D

AUDITS = Path(__file__).resolve().parent.parent
EVIDENCE = AUDITS / "AUD-024-evidence"
SCHEMA = Path("../multi-chain-wallet-tools/docs/audit-report.schema.json")
PROCEDURES = [
    "multi-chain-wallet-tools/docs/FULL_AUDIT_GUIDE.md",
    "multi-chain-wallet-tools/docs/audits/AUDIT_STANDARD.md",
    "multi-chain-wallet-tools/docs/audits/AUDIT_TEMPLATE.md",
    "multi-chain-wallet-tools/docs/audit-report.schema.json",
]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def anonymous(text):
    # Published text names no machine owner (workspace audits rules, Report privacy).
    return re.sub(r"/home/[^/\s\"'`]+", "/home/user", text)


def command(label):
    return json.loads((EVIDENCE / f"{label}.command.json").read_text())


def check_rows():
    rows = []
    for label, text, summary in D.CHECKS:
        record = command(label)
        outcome = "passed" if record["exitCode"] == 0 else "failed"
        if label in D.EXPECTED_FAILURES:
            outcome = D.EXPECTED_FAILURES[label]
        rows.append(dict(label=label, command=text, exitCode=record["exitCode"], outcome=outcome,
                         startUtc=record["startUtc"], endUtc=record["endUtc"],
                         logSha256=record["logSha256"], summary=summary,
                         evidence=f"AUD-024-evidence/{label}.log (local only)"))
    return rows


def cell(text):
    return str(text).replace("|", "\\|").replace("\n", " ")


def addendum_rows(remediation):
    rows = []
    for label, text, summary in D.ADDENDUM["checks"]:
        record = command(label)
        rows.append(dict(label=label, command=text, exitCode=record["exitCode"],
                         outcome="passed" if record["exitCode"] == 0 else "failed",
                         startUtc=record["startUtc"], endUtc=record["endUtc"], logSha256=record["logSha256"],
                         sourceBefore=record["sourceBefore"], summary=summary,
                         evidence=f"AUD-024-evidence/{label}.log (local only)"))
    return rows


def addendum_markdown(remediation):
    a = D.ADDENDUM
    out = ["", f"### Remediation addendum ({a['date']} UTC)", "",
           f"- **Remediated source:** commit `{a['commit']}` with the fixes below, source fingerprint "
           f"`{remediation['sourceFingerprint']}` over {remediation['fileCount']} files, captured "
           f"{remediation['capturedAt']}; every check below ran on that fingerprint.",
           f"- **Status rule:** {a['statusRule']}", "",
           "| Finding ID | Files | Change |", "| --- | --- | --- |"]
    out += [f"| {f['id']} | {cell(', '.join(f['files']))} | {cell(f['change'])} |" for f in a["fixes"]]
    out += ["", "| Check / command | Outcome | Exit | Result | Log SHA-256 |", "| --- | --- | --- | --- | --- |"]
    for c in addendum_rows(remediation):
        out.append(f"| `{cell(c['command'])}` | {c['outcome']} | {c['exitCode']} | {cell(c['summary'])} | "
                   f"`{c['logSha256'][:16]}…` |")
    return out


def markdown(snapshot, checks, procedures, remediation):
    out = [f"# AUD-024 — {D.TITLE}", "", "## Record metadata", ""]
    out += [f"- **{key}:** {value}" for key, value in D.metadata(snapshot)]
    out += ["", "## Finding register", "",
            "| ID | Category | Kind | Severity | Status | Release blocking | Title |",
            "| --- | --- | --- | --- | --- | --- | --- |"]
    for f in D.FINDINGS:
        out.append(f"| {f['id']} | {f['category']} | finding | {f['severity']} | {f['status']} | "
                   f"{str(f['releaseBlocking']).lower()} | {cell(f['title'])} |")
    if not D.FINDINGS:
        out.append("| — | — | — | — | — | — | No finding was confirmed. |")
    out += ["", "## Review evidence", "", "### Scope and methodology", ""]
    out += D.SCOPE_TEXT
    out += ["", "Procedure files, read and hash-bound:", "", "| Procedure | SHA-256 |", "| --- | --- |"]
    out += [f"| `{p}` | `{h}` |" for p, h in procedures.items()]
    out += ["", "### Coverage ledger", "",
            "| Check ID | Group | Outcome | Evidence / gap |", "| --- | --- | --- | --- |"]
    out += [f"| {c} | {cell(g)} | {o} | {cell(e)} |" for c, g, o, e in D.LEDGER]
    out += ["", "### Checks", "",
            "Each command ran once, one at a time, through the AUD-023 `record.py` (log, UTC start and end, exit code, "
            "log SHA-256, source fingerprint before and after) and `cap.sh` (6 GiB, no swap, 30 minutes). "
            "Logs are local only.", "",
            "| Check / command | Outcome | Exit | Result | Log SHA-256 |", "| --- | --- | --- | --- | --- |"]
    for c in checks:
        out.append(f"| `{cell(c['command'])}` | {c['outcome']} | {c['exitCode']} | {cell(c['summary'])} | "
                   f"`{c['logSha256'][:16]}…` |")
    out += [""] + D.CHECKS_NOTES
    out += ["", "### Findings", ""]
    if not D.FINDINGS:
        out.append("No finding was confirmed. Candidate findings that the challenge refuted are listed under "
                   "the informational observations.")
    for f in D.FINDINGS:
        out += [f"#### {f['id']} — {f['severity'].capitalize()} — {f['title']}", "",
                f"- **Category:** {f['category']}.", f"- **Severity:** {f['severity']}.",
                f"- **Status:** {f['status']}.",
                f"- **Release blocking:** {str(f['releaseBlocking']).lower()}"
                + (f"; {f['releaseBlockingReason']}" if f.get("releaseBlockingReason") else "."),
                f"- **Affected files and builds:** {', '.join(f['affectedFiles'])}.",
                f"- **Reproduction:** {f['reproduction']}", f"- **Expected behavior:** {f['expected']}",
                f"- **Observed behavior:** {f['observed']}", f"- **Impact:** {f['impact']}",
                f"- **Evidence:** {f['evidence']}", f"- **Recommended fix:** {f['recommendedFix']}",
                f"- **Required verification:** {f['requiredVerification']}", ""]
    out += ["### Remediation and follow-up", "",
            "Dispositions of earlier findings at this snapshot. The earlier reports keep their own records unchanged.", "",
            "| Finding ID | Status | Fix commit | Verification commit | Evidence |",
            "| --- | --- | --- | --- | --- |"]
    for r in D.REMEDIATION:
        fix = r["fixCommit"] or ("With this record" if r["id"].startswith("AUD-024-") else "None")
        verification = r["verificationCommit"] or ("Not verified" if r["id"].startswith("AUD-024-") else "None")
        out.append(f"| {r['id']} | {r['status']} | {fix} | {verification} | {cell(r['evidence'])} |")
    out += addendum_markdown(remediation)
    out += ["", "### Informational observations and recommendations", ""]
    out += [f"- {o}" for o in D.OBSERVATIONS]
    out += ["", "### Assessment and limitations", ""]
    out += D.ASSESSMENT
    out += [""] + [f"- {item}" for item in D.LIMITATIONS]
    return anonymous("\n".join(out).rstrip() + "\n")


def record(snapshot, checks, procedures, remediation):
    return json.loads(anonymous(json.dumps({
        "schemaVersion": 1, "auditId": "AUD-024", "auditNumber": 24, "date": D.DATE, "title": D.TITLE,
        "reviewer": D.REVIEWER,
        "snapshot": {"commit": snapshot["commit"], "commitComplete": True, "workingTree": "clean",
                     "sourceFingerprint": snapshot["sourceFingerprint"], "fileCount": snapshot["fileCount"],
                     "capturedAt": snapshot["capturedAt"], "aud022Source": D.AUD022_SOURCE},
        "scope": {"summary": " ".join(D.SCOPE_TEXT), "procedureSha256": procedures},
        "checks": {"commands": checks, "ledger": [dict(checkId=c, group=g, outcome=o, evidence=e) for c, g, o, e in D.LEDGER],
                   "ci": D.CI_RUNS},
        "findings": [dict(kind="finding", **f) for f in D.FINDINGS],
        "observations": [],
        "remediation": D.REMEDIATION,
        "limitations": D.LIMITATIONS,
        "informationalObservations": D.OBSERVATIONS,
        "reviewPhases": D.PHASES,
        "remediationAddendum": {**{k: v for k, v in D.ADDENDUM.items() if k != "checks"},
                                "sourceFingerprint": remediation["sourceFingerprint"],
                                "fileCount": remediation["fileCount"], "capturedAt": remediation["capturedAt"],
                                "checks": addendum_rows(remediation)},
    })))


def main():
    snapshot = json.loads((EVIDENCE / "snapshot.json").read_text())
    after = json.loads((EVIDENCE / "snapshot-after.json").read_text())
    procedures = {p: sha(Path("..") / p) for p in PROCEDURES}
    checks = check_rows()
    stem = f"AUD-024-{D.DATE}"
    remediation = json.loads((EVIDENCE / "snapshot-remediation.json").read_text())
    md, js = markdown(snapshot, checks, procedures, remediation), record(snapshot, checks, procedures, remediation)
    (AUDITS / f"{stem}.md").write_text(md)
    (AUDITS / f"{stem}.json").write_text(json.dumps(js, indent=1, ensure_ascii=False) + "\n")
    problems = []
    validator = jsonschema.Draft202012Validator(json.loads(SCHEMA.read_text()))
    problems += [f"schema: {e.message[:160]}" for e in validator.iter_errors(js)]
    problems += [f"finding {f['id']} missing in Markdown" for f in D.FINDINGS if f["id"] not in md]
    problems += [f"remediation {r['id']} missing in Markdown" for r in D.REMEDIATION if r["id"] not in md]
    problems += [f"addendum check {c['label']} failed" for c in addendum_rows(remediation) if c["exitCode"] != 0]
    problems += [f"addendum check {c['label']} ran on another source" for c in addendum_rows(remediation)
                 if c["sourceBefore"] != remediation["sourceFingerprint"]]
    if snapshot["sourceFingerprint"] != after["sourceFingerprint"]:
        problems.append("the source changed during the baseline")
    user = getpass.getuser()
    for name, text in ((f"{stem}.md", md), (f"{stem}.json", json.dumps(js))):
        if user not in ("root", "runner", "user") and user in text:
            problems.append(f"{name} names the account {user}")
        if re.search(r"\d{2}:\d{2}(:\d{2})?[+-](?!00:?00)\d{2}:?\d{2}", text):
            problems.append(f"{name} has a time that is not UTC")
    sums = []
    for path in sorted(p for p in EVIDENCE.rglob("*") if p.is_file() and p.name not in ("SHA256SUMS", "report-validation.json")):
        sums.append(f"{sha(path)}  {path.relative_to(EVIDENCE)}")
    (EVIDENCE / "SHA256SUMS").write_text("\n".join(sums) + "\n")
    (EVIDENCE / "report-validation.json").write_text(json.dumps({
        "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "report": stem,
        "markdownSha256": sha(AUDITS / f"{stem}.md"), "jsonSha256": sha(AUDITS / f"{stem}.json"),
        "problems": problems}, indent=1) + "\n")
    print(f"{stem}: {len(D.FINDINGS)} findings, {len(D.REMEDIATION)} dispositions, {len(checks)} checks; "
          f"{'OK' if not problems else 'PROBLEMS: ' + '; '.join(problems)}")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()

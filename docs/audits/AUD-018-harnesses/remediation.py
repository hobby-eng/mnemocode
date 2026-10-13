"""AUD-018: adds the remediation addendum of 2026-10-12 to both report records and the index row.

    python3 docs/audits/AUD-018-harnesses/remediation.py

Reads the remediation snapshot and the remediation-* command records from the ignored
docs/audits/AUD-018-evidence/. The findings keep their reviewed text; only their status changes, to
fixed (no commit exists, so none is verified), and a dated section says what changed and which
checks passed at the remediation snapshot. Refuses to run twice.
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-018-evidence"
REPORT = AUDITS / "AUD-018-2026-10-12"
HEADING = "## Remediation addendum (2026-10-12)"

snapshot = json.loads((EVIDENCE / "remediation-snapshot.json").read_text())
LABELS = [
    ("remediation-source-check", "pnpm check passed"),
    ("remediation-format", "pnpm format:check passed"),
    ("remediation-build", "Fresh build"),
    ("remediation-tests", "6 files that read QR images, test/aud-018.test.ts included: 171 passed"),
    ("remediation-cli-self-test", "Full CLI self-test PASS, its QR read-backs included"),
    ("remediation-probes", "Both probe cases pass: AUD-018-SEC001 no longer reproduces"),
    ("remediation-readme-arguments", "Every README example with --ask-secrets accepted up to its prompt (0 refused; 2 on the old text)"),
    ("remediation-record-integrity", "0 problems: 79 citations, 12 explained by the index, 2 in multi-chain; 1 warning (AUD-012 link)"),
]
FIXES = {
    "AUD-018-SEC001": {
        "files": ["src/cli/qr-input.ts", "test/aud-018.test.ts", "CHANGELOG.md"],
        "change": "decodeQrPngFile loads its decoders first, then reads, decodes and wipes in one step: the file bytes and the decoded pixels are wiped through the shared wipedAfter rule, after a code is read and when the image is refused. test/aud-018.test.ts holds the probe's case and three more: an image without a code, a file that is no PNG, and the text reader's control.",
    },
    "AUD-018-DOC001": {
        "files": ["README.md"],
        "change": "The two encode examples no longer give --dates with --ask-secrets; the dates are asked on the private screen. readme-secret-arguments.py runs every README example with --ask-secrets up to its terminal check.",
    },
    "AUD-018-DOC002": {
        "files": ["docs/audits/README.md", "docs/audits/AUD-010-2026-10-07.md", "docs/audits/AUD-010-2026-10-07.json"],
        "change": "The index already said that the AUD-001 and AUD-002 identifiers cannot be opened on main; it now names their counterparts in the current history (6d9100e29922ae3bcc964989fdedc93710ff56ef and 2705bf15558bd760daadf189fbf0ed727446eae7, same message and source fingerprint) and says that f17c323… has no commit of its own. The AUD-001 and AUD-002 records stay as they were. AUD-010 cites multi-chain-wallet-tools c82bcace05eed8840610312a498b05528965baa7, its current commit of the schema file with the same bytes (d47df012…). record-integrity.py now accepts a citation that the index explains or that the multi-chain checkout holds.",
    },
}
STATUS_NOTE = "Fixed, not verified: no commit holds the fixes yet."


def checks():
    rows = []
    for label, summary in LABELS:
        record = json.loads((EVIDENCE / f"{label}.command.json").read_text())
        assert record["exitCode"] == 0, label
        assert record["sourceBefore"] == record["sourceAfter"] == snapshot["fingerprint"], label
        rows.append({"label": label, "command": " ".join(record["command"]), "exitCode": 0,
                     "startedAt": record["startedAt"], "summary": summary,
                     "evidence": {"log": f"AUD-018-evidence/{label}.log", "sha256": record["logSha256"],
                                  "localOnly": True}})
    return rows


def update_json(rows):
    path = REPORT.with_suffix(".json")
    record = json.loads(path.read_text())
    assert "remediationAddendum" not in record, "the addendum is there already"
    for finding in record["findings"]:
        finding["status"] = "fixed"
    for row in record["remediation"]:
        if row["id"] in FIXES:
            row["status"] = "fixed"
            row["evidence"] = f"Remediation addendum (2026-10-12). {STATUS_NOTE}"
    record["remediationAddendum"] = {
        "date": "2026-10-12",
        "commit": snapshot["commit"],
        "sourceFingerprint": snapshot["fingerprint"],
        "uncommittedDiffSha256": snapshot["uncommittedDiffSha256"],
        "capturedAt": snapshot["capturedAt"],
        "statusRule": STATUS_NOTE,
        "fixes": [{"id": fid, **fix} for fid, fix in FIXES.items()],
        "checks": rows,
        "notOpened": "The AUD-012 link to a source file removed later stays a warning, as recorded among the observations.",
    }
    path.write_text(json.dumps(record, indent=2) + "\n")


def update_markdown(rows):
    path = REPORT.with_suffix(".md")
    text = path.read_text()
    assert HEADING not in text, "the addendum is there already"
    for fid in FIXES:
        for old, new in [
            (f"| {fid} | {fid.split('-')[2][:3]} | finding | low | open |", f"| {fid} | {fid.split('-')[2][:3]} | finding | low | fixed |"),
            (f"| {fid} | open | Not fixed | Not verified | Original reproduction |", f"| {fid} | fixed | Not committed | Not verified | Remediation addendum |"),
        ]:
            assert text.count(old) == 1, old
            text = text.replace(old, new)
    old_status = "- **Status:** open."
    assert text.count(old_status) == len(FIXES)
    text = text.replace(old_status, "- **Status:** fixed (see the remediation addendum).")
    lines = [
        "",
        HEADING,
        "",
        f"The findings above keep their reviewed text; only their status changes. The fixes were made by the same reviewer on the owner's request, at `{snapshot['commit']}` with uncommitted changes, source fingerprint `{snapshot['fingerprint']}` (diff SHA-256 `{snapshot['uncommittedDiffSha256']}`). {STATUS_NOTE}",
        "",
        "| Finding ID | Files | Change |",
        "| --- | --- | --- |",
    ]
    for fid, fix in FIXES.items():
        lines.append(f"| {fid} | {', '.join(f'`{name}`' for name in fix['files'])} | {fix['change']} |")
    lines += ["", "| Check | Exit | Result | Command |", "| --- | --- | --- | --- |"]
    for row in rows:
        lines.append(f"| {row['label']} | 0 | {row['summary']} | `{row['command']}` |")
    lines += ["", "The AUD-012 link to a source file removed later stays a warning, as recorded among the observations. The logs stay local; their SHA-256 values are in the JSON record."]
    path.write_text(text.rstrip("\n") + "\n" + "\n".join(lines) + "\n")


def update_index():
    path = AUDITS / "README.md"
    text = path.read_text()
    old = "no PDF test files, Docker rebuild, executable or release acceptance. |"
    assert text.count(old) == 1
    path.write_text(text.replace(old, "no PDF test files, Docker rebuild, executable or release acceptance. Remediation addendum: all three fixed and checked at the remediation snapshot, not yet committed. |"))


rows = checks()
update_json(rows)
update_markdown(rows)
update_index()
print("addendum written;", len(rows), "checks")

"""Append source-bound remediation without regenerating the historical baseline."""

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shlex
import sys

import jsonschema

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-021-evidence"
REPORT = AUDITS / "AUD-021-2026-10-13"
MARKER = "## Remediation addendum (2026-10-13 UTC)"

FIXES = {
    "SEC001": "PngAdmission validates the complete chunk stream and rejects duplicate headers before decoding.",
    "SEC002": "Exact channel/depth/Adam7 budgets bound pre-inflation before pixels; odd, packed and 16-bit valid controls decode.",
    "SEC003": "Malformed age identity diagnostics have fixed text and no retained cause; public valid/wrong-key controls pass.",
    "FUN001": "Declared length and record-owned format preserve Color Unicode marks in every supported spelling and phrase length.",
    "FUN002": "Repair uses supported share prefixes and complete valid decoys, retains checks, and refuses incomplete capped readings.",
    "API001": "Entropy fields are read once; intrinsic element kind and storage length reject spoofed prototypes/properties, accept genuine cross-realm bytes, and own/wipe copies before passphrases.",
    "API002": "ReEncoding owns and freezes decoded arrays/dates and retains exactly the phrase confirmed by the person or wallet.",
    "FUN003": "One successful card plan is shared by all destinations in one run; retries, rename and skip preserve it.",
    "DOC001": "Mode-owned advice distinguishes legacy checksum errors and makes no empty-wallet/unique-date guarantee; UR instructions no longer promise unsupported Bytewords cards.",
    "ARC001": "Help reads the recovery owners' constants instead of repeating numeric limits.",
    "DOC002": "The signed tag recipe explicitly uses TZ=UTC; no tag was made.",
    "BLD002": "The package includes numbered reports and all public harness files, including mts and the nested Docker shim; evidence stays excluded.",
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def read(path):
    return json.loads(path.read_text(), object_pairs_hook=unique)


def clean(value):
    # Only published summaries are redacted. Ignored original command logs are never rewritten.
    return re.sub(r"/home/[^/\s\"']+", "/home/user", value)


def command_records():
    records = []
    for path in sorted(EVIDENCE.glob("remediation-*.command.json")):
        row = read(path)
        label = path.name.removesuffix(".command.json")
        log = EVIDENCE / f"{label}.log"
        assert digest(log) == row["logSha256"], label
        text = log.read_text()
        summary = [line.strip() for line in text.splitlines()
                   if re.match(r"\s*(Test Files|Tests|Duration|PASS|No copies|Audit privacy)", line)]
        records.append({key: row[key] for key in (
            "command", "startedAt", "endedAt", "exitCode", "stopReason", "logSha256",
            "sourceBefore", "sourceAfter", "changedFiles", "nodeHeapMiB", "timeoutSeconds",
        )} | {
            "label": label,
            "localEvidence": log.name,
            "minimumAvailableGiB": round(min(x["available"] for x in row["memorySamples"]) / 2**30, 3),
            "summary": summary,
        })
    return sorted(records, key=lambda row: row["startedAt"])


def validate(report, markdown):
    schema = read(ROOT.parent / "multi-chain-wallet-tools/docs/audit-report.schema.json")
    jsonschema.Draft202012Validator(schema).validate(report)
    ids = {row["id"] for row in report["findings"]}
    assert len(ids) == 13
    assert ids == {row["id"] for row in report["remediation"]}
    for row in report["findings"]:
        assert f"| {row['id']} | {row['category']} | finding | {row['severity']} | {row['status']} |" in markdown
        assert f"#### {row['id']} — {row['severity'].capitalize()}" in markdown
    for text in (markdown, json.dumps(report)):
        assert not re.search(r"/home/(?!user(?:/|\b))[^/\s]+", text)
        assert not re.search(r"[\u0400-\u04ff]", text)
        for offset in re.findall(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?([+-]\d{2}:?\d{2}|Z)", text):
            assert offset in {"Z", "+00:00", "+0000"}
    assert "UTC (+00:00)" in markdown


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: remediation-record.py REMEDIATION-SNAPSHOT-LABEL")
    snapshot_path = EVIDENCE / f"{sys.argv[1]}-snapshot.json"
    final = read(snapshot_path)
    for row in final["files"]:
        assert digest(ROOT / row["path"]) == row["sha256"], row["path"]
    baseline = read(EVIDENCE / "initial-snapshot.json")
    before = {row["path"]: row["sha256"] for row in baseline["files"]}
    changed = [row for row in final["files"] if before.get(row["path"]) != row["sha256"]]
    report = read(REPORT.with_suffix(".json"))
    # The original baseline fields and reproduction claims remain intact; statuses are current.
    assert report["snapshot"]["sourceFingerprint"] == baseline["fingerprint"]
    fixes = dict(FIXES)
    joint_path = EVIDENCE / "remediation-joint-parity.json"
    joint = read(joint_path) if joint_path.exists() else None
    if joint is not None:
        assert joint["upstreamSourceFingerprint"] == final["fingerprint"]
        assert joint["sourceIntegrationImplemented"] is True
        assert joint["confirmedSourceOmissionCount"] == 0
        # The separate capability review has one obligation for each P01 through P60.
        assert joint["mappedObligations"] == 60
        for item in joint["boundEvidence"]:
            assert digest(ROOT.parent / item["workspaceRelativePath"]) == item["sha256"]
        fixes["BLD001"] = "Browser ReEncoding uses the shared owner and normal Encode handoff; all 60 obligations are mapped, 175 vendored files match, and selected regressions/default HTML gates passed. Actual-browser acceptance is not asserted."
    fixed_count = len(fixes)
    open_count = len(report["findings"]) - fixed_count
    current_status = (
        "13 findings fixed; joint source and bounded host checks complete; actual-browser and release acceptance remain incomplete."
        if joint is not None else
        "12 local findings fixed; BLD001 browser parity remains open; no release acceptance or commit."
    )
    for row in report["findings"]:
        suffix = row["id"].removeprefix("AUD-021-")
        row["status"] = "fixed" if suffix in fixes else "open"
    for row in report["remediation"]:
        suffix = row["id"].removeprefix("AUD-021-")
        row["status"] = "fixed" if suffix in fixes else "open"
        row["fixCommit"] = row["verificationCommit"] = None
        row["evidence"] = fixes.get(suffix, "Browser integration and complete separate parity acceptance remain with Wallet tools; not closed by local API tests.")
    commands = command_records()
    stamp = datetime.now(timezone.utc).isoformat()
    update = {
        "updatedAt": stamp, "timeZone": "UTC (+00:00)",
        "scope": "Owner-authorized remediation of AUD-021; preserve the original review and ignored raw evidence.",
        "status": current_status,
        "sourceFingerprint": final["fingerprint"], "snapshotSha256": digest(snapshot_path),
        "affectedSourceSha256": changed,
        "fixCommit": None, "verificationCommit": None,
        "checks": commands,
        "privacy": "All published MnemoCode audit records/harness READMEs checked for anonymous home paths and UTC. One synthetic home-path anchor in AUD-012 was normalized to /home/user/Work with a paired provenance note. Its previous JSON SHA-256 has no document-hash consumers. Findings, source/artifact hashes and actual times were preserved. Raw evidence was not redacted.",
        "independentReview": "Fourth-wave source-only reviewer challenged storage-length shadowing, capped repair ambiguity, incomplete package harness extensions and valid multipass PNG controls; coordinator implemented corrections and retained targeted evidence. Model/effort unknown.",
        "jointParityOwnerChanges": "Standalone recovery now delegates to DatesAnswer.assertIncomplete (CLI message unchanged); complete dates remain usable for decode and combined code recovery. Date and candidate-list startup controls include refusal of known-only standalone recovery and a wider typed array with a spoofed byte-array prototype. The inventory at source 5eb0d172 is retained as historical enumeration; subsequent exact module/test deltas bind the current source separately.",
        "limits": [
            "Per-batch test counts overlap and are not summed. The original 2110-test baseline is not claimed rerun on the remediated source.",
            "Startup refusals were extended using public answers; PNG decoding/inflation and large work remain outside startup.",
            "Five one-page card PDFs/PNGs/QR and two A6 heir front/back PDFs only; no complete gallery.",
            "Browser capability enumeration is not runtime acceptance. Wallet tools owns vendoring, UI/worker wiring, both-edition composition and browser regression evidence.",
            "Current-source Windows/macOS, fresh tag-stage Docker/WASM and signed release provenance remain the original documented release gaps.",
            "No commit, push, tag, release publication, Git history rewrite or paid CI dispatch.",
        ],
    }
    for name, path in {
        "representativeArtifacts": ROOT / "output/aud021-remediation-representative/manifest.json",
        "heirArtifacts": ROOT / "output/aud021-remediation-heirs/manifest.json",
        "parityInventory": EVIDENCE / "remediation-parity-inventory.json",
        "packageAcceptance": EVIDENCE / "remediation-package-acceptance.json",
        "representativeByteComparison": EVIDENCE / "remediation-output-comparison.json",
        "lastByteKindDelta": EVIDENCE / "remediation-last-byte-kind-delta.json",
        "finalParityDelta": EVIDENCE / "remediation-final-parity-delta.json",
        "nativeControls": ROOT / "output/aud021-remediation-executable/verification.json",
        "jointSourceBinding": EVIDENCE / "remediation-joint-source-binding.json",
        "jointParity": joint_path,
    }.items():
        if path.exists():
            update[name] = {"localEvidence": str(path.relative_to(ROOT)), "sha256": digest(path)}
    report["remediationUpdates"] = [update]
    markdown = REPORT.with_suffix(".md").read_text().split(MARKER)[0].rstrip()
    for row in report["findings"]:
        finding_id = row["id"]
        markdown = re.sub(rf"(\| {re.escape(finding_id)} \| {row['category']} \| finding \| {row['severity']} \| )open( \|)", rf"\g<1>{row['status']}\2", markdown)
        start = markdown.index(f"#### {finding_id} —")
        end = markdown.find("\n#### ", start + 1)
        if end < 0:
            end = markdown.index("### Remediation and follow-up", start)
        block = markdown[start:end].replace(f"{row['category']} / open.", f"{row['category']} / {row['status']}.")
        markdown = markdown[:start] + block + markdown[end:]
        markdown = markdown.replace(f"| {finding_id} | open | Not fixed | Not run | Original source-bound reproduction |", f"| {finding_id} | {row['status']} | Not committed | See dated addendum | Original reproduction retained; current state below |")
    markdown = markdown.replace("Every finding remains open.", "At the original baseline, every finding remained open; current statuses are in the dated addendum.")
    lines = ["", "", MARKER, "", f"- **Updated (UTC):** {stamp}.", "- **Report time zone:** UTC (+00:00).",
             f"- **Remediated source:** `{final['fingerprint']}`; snapshot SHA-256 `{digest(snapshot_path)}`.",
             f"- **Current status:** {current_status} No fix/verification commit exists.",
             "", "The baseline verdict, experiment outcomes, failed attempts and reviewed-source bindings above are historical. The finding register reflects current fix status. The owner subsequently authorized remediation; this is not a fresh baseline audit or a claim that the full suite was rerun.",
             "", "| Finding | Status | Current change |", "| --- | --- | --- |"]
    lines += [f"| AUD-021-{key} | fixed | {value} |" for key, value in fixes.items()]
    if joint is None:
        lines += ["| AUD-021-BLD001 | open | Wallet tools is integrating every capability and producing separate source-bound parity evidence. |"]
    else:
        lines += ["", joint["summary"], "", "Actual-browser execution was not performed under the owner's existing prohibition in Wallet tools. The separate matrix retains its unexecuted acceptance obligations; source coverage and Node fixtures do not establish complete browser behavior."]
    lines += ["", "### Targeted execution", "",
              "Commands run sequentially under the existing guard (768 MiB Node heap; start above 4 GiB available, stop below 3 GiB). All failed preliminary attempts remain recorded; overlapping successful test batches are not added together.", ""]
    for row in commands:
        lines += [f"- **{row['label']}:** `{shlex.join(row['command'])}`; exit {row['exitCode']}, minimum MemAvailable {row['minimumAvailableGiB']} GiB; UTC {row['startedAt']} to {row['endedAt']}; source `{row['sourceBefore']}` → `{row['sourceAfter']}`; local log `{row['localEvidence']}`, SHA-256 `{row['logSha256']}`."]
        if row["summary"]:
            lines.append("  " + "; ".join(row["summary"]))
    lines += ["", "### Source and remaining acceptance", "", update["privacy"], "", update["independentReview"], "", update["jointParityOwnerChanges"], ""]
    lines += [f"- {value}" for value in update["limits"]]
    lines += ["", "The JSON companion carries exact changed-source bindings and local-only inventory/artifact evidence hashes. Public acceptance tests are in `test/aud-021-*.test.ts`; original defect-presence probes retain their original purpose.", ""]
    markdown = clean(markdown + "\n".join(lines))
    report = json.loads(clean(json.dumps(report)))
    validate(report, markdown)
    REPORT.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    REPORT.with_suffix(".md").write_text(markdown)
    index = AUDITS / "README.md"
    index_text = index.read_text()
    index_text = re.sub(r"(^\| AUD-021 \|.*?) Remediation addendum:.*?( \| \[Report\].*)$", r"\1\2", index_text, flags=re.M)
    index_summary = (
        "13 findings fixed; joint source and bounded host checks complete, actual-browser/release acceptance incomplete."
        if joint is not None else
        "12 local findings fixed with targeted regressions and bounded output checks; browser parity BLD001 remains open."
    )
    index_text = re.sub(r"(^\| AUD-021 \|.*?)( \| \[Report\].*)$", rf"\1 Remediation addendum: {index_summary}\2", index_text, flags=re.M)
    index.write_text(index_text)
    validation = {"schema": "passed", "duplicateKeys": "passed", "pairedFindings": "passed", "privacyEnglishUTC": "passed", "baselinePreserved": True, "sourceFingerprint": final["fingerprint"], "validatedAt": stamp,
                  "reports": {path.name: digest(path) for path in (REPORT.with_suffix(".md"), REPORT.with_suffix(".json"))}}
    (EVIDENCE / "remediation-report-validation.json").write_text(json.dumps(validation, indent=2) + "\n")
    paths = [path for path in EVIDENCE.iterdir() if path.is_file() and path.name != "SHA256SUMS"]
    (EVIDENCE / "SHA256SUMS").write_text("".join(f"{digest(path)}  {path.name}\n" for path in sorted(paths)))
    print(json.dumps({"audit": "AUD-021", "fixed": fixed_count, "open": open_count, "validation": "passed", "sourceFingerprint": final["fingerprint"]}))


if __name__ == "__main__":
    main()

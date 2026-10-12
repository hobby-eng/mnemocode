"""Append owner-authorized AUD-017 fixes while preserving its initial report and failures."""

import copy
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[3]
AUDITS = ROOT / "docs/audits"
EVIDENCE = AUDITS / "AUD-017-evidence"
BASE = "AUD-017-2026-10-12"
HEADER = "## Remediation addendum (2026-10-12)"


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path):
    return json.loads(path.read_text())


def private(value):
    if isinstance(value, str):
        return re.sub(r"/home/[^/\s\"']+", "/home/user", value)
    if isinstance(value, list):
        return [private(item) for item in value]
    if isinstance(value, dict):
        return {key: private(item) for key, item in value.items()}
    return value


if __name__ == "__main__":
    initial = load(EVIDENCE / "initial-report-validation.json")
    report = load(AUDITS / f"{BASE}.json")
    original = copy.deepcopy(report)
    original.pop("remediationAddendum", None)
    for row in original["findings"]:
        row["status"] = "open"
        row.pop("remediationUpdate", None)
    assert hashlib.sha256((json.dumps(original, indent=2) + "\n").encode()).hexdigest() == initial["reportHashes"][f"{BASE}.json"]
    markdown = (AUDITS / f"{BASE}.md").read_text().split("\n" + HEADER)[0].rstrip() + "\n"
    baseline = re.sub(r"^(\| AUD-(?:016-API001|017-DOC001) \| (?:API|DOC) \| finding \| (?:medium|low) \| )fixed( \|)",
                      r"\1open\2", markdown, flags=re.MULTILINE)
    assert hashlib.sha256(baseline.encode()).hexdigest() == initial["reportHashes"][f"{BASE}.md"]
    end = load(EVIDENCE / "aud017-remediation-final-snapshot.json")
    start = load(EVIDENCE / "aud017-remediation-start-snapshot.json")
    before = {row["path"]: row["sha256"] for row in start["files"]}
    after = {row["path"]: row["sha256"] for row in end["files"]}
    changes = [{"path": name, "beforeSha256": before.get(name), "afterSha256": after.get(name)}
               for name in sorted(before.keys() | after.keys()) if before.get(name) != after.get(name)]
    assert {row["path"] for row in changes} == {"src/core/wallet-check.ts", "src/core/missing-codes-search.ts",
                                              "test/aud-016.test.ts", "test/aud-017.test.ts"}
    commands = []
    for path in sorted(EVIDENCE.glob("aud017-remediation-*.command.json")):
        row = load(path)
        assert row["exitCode"] == 0 and not row["changedFiles"]
        assert row["sourceBefore"] == row["sourceAfter"] == end["fingerprint"]
        label = path.name.removesuffix(".command.json")
        assert digest(EVIDENCE / f"{label}.log") == row["logSha256"]
        commands.append({"label": label, **row, "localOnly": True, "log": f"AUD-017-evidence/{label}.log"})
    assert {row["label"] for row in commands} == {f"aud017-remediation-{name}" for name in
        ["unit", "source", "build", "probe", "search", "format", "cli"]}
    fixes = [
        {"id": "AUD-016-API001", "change": "Common fields are immutable one-read snapshots. Extra data remains own data; getters, setters and methods keep the original receiver, including private fields, without eager extra getter evaluation."},
        {"id": "AUD-017-DOC001", "change": "Earlier broad logs are explicitly retained as source-unbound historical outcomes, not reattributed to the new fix. Current necessary checks retain exact source/context identities; new addendum validation removes no assertions, and a separate checksum list covers the earlier remediation pairs."},
    ]
    for row in fixes:
        row.update({"status": "fixed", "fixCommit": None, "verificationCommit": None,
                    "fixSourceFingerprint": end["fingerprint"], "date": "2026-10-12"})
    addendum = private({"date": "2026-10-12", "authorization": "The owner explicitly asked the coordinator to fix all remaining items after review.",
        "fixSourceFingerprint": end["fingerprint"], "fixManifest": end["files"], "changes": changes,
        "initialReportHashes": initial["reportHashes"], "findings": fixes, "checks": commands,
        "statusRule": "fixed, not blanket verified: no fix/verification commit exists; no release-level or PDF execution.",
        "targetedTests": {"newTests": 8, "ordinaryPassed": 91, "ordinaryFiles": 6, "probePassed": 20,
                          "meaning": "66 tests in four files plus 25 in two disjoint search files; probe controls counted separately."},
        "otherImprovements": ["Cancellation now stops before another fingerprint callback runs (one call instead of eight in the probe).",
                              "Cleanup regressions require a positive allocation count, preventing empty observations from passing."],
        "independentReview": {"model": None, "reasoningEffort": None, "scope": "Source-only receiver ownership/cancellation review; no edits or repeated runtime checks.",
                              "outcome": "No actionable issue found in the requested scope."},
        "newHarnessHashes": {f"AUD-017-harnesses/{name}": digest(AUDITS / "AUD-017-harnesses" / name)
                             for name in ["REMEDIATION.md", "remediation.py", "remediation-validate.py"]},
        "artifactHashes": {name: digest(ROOT / name) for name in ["dist/core/wallet-check.js", "dist/core/missing-codes-search.js",
                              "sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"]},
        "earlierChecksumList": {"path": "AUD-016-evidence/remediation/SHA256SUMS-current",
                                "sha256": digest(AUDITS / "AUD-016-evidence/remediation/SHA256SUMS-current"),
                                "basis": "AUD-016-evidence", "entries": 25},
        "browserHandover": {**load(EVIDENCE / "remediation-handover-wallet-tools.json"),
                            "evidenceSha256": digest(EVIDENCE / "remediation-handover-wallet-tools.json")},
        "limitations": ["Earlier missing source/context metadata cannot be reconstructed; the author's broad suite totals are not claimed for this new snapshot.",
                        "Extra data copies are shallow; bound operations retain host state. Exact reflection equivalence is not promised.",
                        "No PDF/card/QR generation, render comparisons, full vectors, full/long suites, Docker, browser, paid CI, commit, push, tag or release."]})
    report = original
    report["remediationAddendum"] = addendum
    for row in report["findings"]:
        row["status"] = "fixed"
        row["remediationUpdate"] = next(fix for fix in fixes if fix["id"] == row["id"])
    (AUDITS / f"{BASE}.json").write_text(json.dumps(report, indent=2) + "\n")
    markdown = re.sub(r"^(\| AUD-(?:016-API001|017-DOC001) \| (?:API|DOC) \| finding \| (?:medium|low) \| )open( \|)",
                      r"\1fixed\2", baseline, flags=re.MULTILINE)
    lines = ["", HEADER, "", f"The owner authorized the coordinator to fix the remaining items. Final source fingerprint: `{end['fingerprint']}`; no commit. Original source, findings, failed probes and command records are preserved. The register now says **fixed**, not blanket verified.", "",
             "| Finding ID | Status | Fix commit | Verification commit | Change |", "| --- | --- | --- | --- | --- |"]
    for row in fixes:
        lines.append(f"| {row['id']} | fixed | Not committed | Not committed | {row['change']} |")
    lines += ["", "Common wallet fields remain immutable; private-field getters/methods/setters work, unrelated getters stay lazy and own data survives JSON. A shared cancellation check after each fingerprint now avoids later callbacks after stopping. Cleanup tests require actual captured arrays.", "",
              "**91 ordinary tests in six files pass**, including eight new receiver/ownership cases; the independent probe now passes **20/20**. Source checks, strict consumers, copy detection, formatting, fresh build and the protected CLI startup command pass. Checks were sequential with the original memory guard. New file hashes and full command/source identities are in the JSON addendum.", "",
              "The previous 12 broad-run logs remain intact but lack per-command source/context binding; this cannot be repaired retroactively. They are not claimed as proof of this new snapshot. A separate checksum list now covers those 12 pairs and their retained validation result, with an explicit parent-directory basis. The old validator and checksum list remain unchanged; the new validator validates this addendum without bypassing any assertion.", "",
              "A source-only independent review found no actionable issue in the requested scope. Extra data capture is shallow, bound operations retain host state, and exact reflection equivalence is not promised.", "",
              "### Remediation checks", "", "| Label | Result | Log SHA-256 |", "| --- | --- | --- |"]
    for row in commands:
        lines.append(f"| {row['label']} | exit {row['exitCode']} | `{row['logSha256']}` (local only) |")
    lines += ["", "The final two runtime files and their exact SHA-256 values were handed to Wallet tools for its normal browser synchronization. Delivery succeeded; recipient integration checks are not claimed here.", "",
              "[Remediation harness notes](AUD-017-harnesses/REMEDIATION.md) describe the records, checksum commands and validation. No PDF/card/QR generation, full vector/full or long suite replay, browser, Docker, paid CI, commit or release was performed.", ""]
    (AUDITS / f"{BASE}.md").write_text(markdown.rstrip() + "\n" + "\n".join(lines))
    index = AUDITS / "README.md"
    text = index.read_text()
    row = next(line for line in text.splitlines() if line.startswith("| AUD-017 |"))
    if "Remediation addendum:" not in row:
        updated = row.replace(" | [Report]", " Remediation addendum: both findings source-fixed, 91 ordinary tests and 20/20 probe checks pass; no commit or release-level acceptance. | [Report]", 1)
        index.write_text(text.replace(row, updated, 1))
    print(json.dumps({"audit": "AUD-017", "fixSource": end["fingerprint"], "ordinaryTests": 91, "probeChecks": 20}))

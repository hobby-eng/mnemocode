"""Read-only independent host source/pin/parity verification; public fixtures only."""
from hashlib import sha256
from pathlib import Path
import json

host = Path("../multi-chain-wallet-tools")
evidence = host / "docs/audits/AUD-032-evidence"
parity = json.loads((evidence / "parity-complete.json").read_text())
manifest = json.loads(
    (host / "packages/recovery-mnemocode/source.json").read_text()
)
for target, digest in manifest["files"].items():
    vendored = host / "packages/recovery-mnemocode/source" / target
    original = Path(target) if Path(target).is_file() else Path("src") / target
    assert sha256(vendored.read_bytes()).hexdigest() == digest, target
    assert sha256(original.read_bytes()).hexdigest() == digest, target
pins = json.loads(Path("sskr-wasm/integrity.json").read_text())
for target, digest in pins.items():
    imported = host / "packages/recovery-sskr-wasm" / target
    assert sha256(imported.read_bytes()).hexdigest() == digest, target
incoming = json.loads(Path(
    "../tmp/mnemocode-aud-026-remediation/source-manifest.json"
).read_text())
assert parity["incomingFingerprint"] == incoming["fingerprint"]
exports = json.loads(Path("package.json").read_text())["exports"]
assert len(parity["exportedParts"]) == len(exports)
assert all(row["editions"]["multi-chain"]["offered"]
           for row in parity["operations"])
for row in parity["operations"]:
    for path, digest in row["bindingSha256"].items():
        assert sha256((host / path).read_bytes()).hexdigest() == digest, path
for artifact in parity["artifacts"]:
    actual = sha256((host / artifact["path"]).read_bytes()).hexdigest()
    assert actual == artifact["sha256"], artifact["path"]
for label in [
    "final-targeted", "final-gates", "final-deriver-multi", "final-deriver-dash",
    "final-scanner-multi", "final-scanner-dash", "final-format", "final-parity",
]:
    command = json.loads((evidence / f"{label}.command.json").read_text())
    assert command["exitCode"] == 0, label
    assert command["sourceBefore"] == command["sourceAfter"], label
print(json.dumps({
    "exactPortableInputs": len(manifest["files"]),
    "exactBridgePins": len(pins),
    "exportedParts": len(parity["exportedParts"]),
    "operationAreas": len(parity["operations"]),
    "fullEditionAllAreasOffered": True,
    "confirmedMissingOperations": parity["missingConfirmedOperations"],
    "parityRecordSha256": sha256(
        (evidence / "parity-complete.json").read_bytes()
    ).hexdigest(),
    "hostChecks": "Read retained host records; not rerun here. Source/artifact "
                  "presence plus selected DOM/worker regressions; no browser "
                  "or release acceptance.",
    "hostSourceFingerprint": command["sourceAfter"],
}))

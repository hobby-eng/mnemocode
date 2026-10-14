"""The source fingerprint of the MnemoCode working tree, by the method of AUD-020 to AUD-022:
SHA-256 of compact JSON of the sorted path/SHA-256 entries of the Git tracked and untracked
non-ignored files, without docs/audits/, absent files left out. Run from the repository root:

    python3 <this file> [output.json]
"""
import hashlib, json, subprocess, sys, datetime
from pathlib import Path

def snapshot():
    names = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                           capture_output=True, check=True).stdout.split(b"\0")
    files = sorted({n.decode() for n in names if n and not n.decode().startswith("docs/audits/")})
    entries = [{"path": p, "sha256": hashlib.sha256(Path(p).read_bytes()).hexdigest()}
               for p in files if Path(p).is_file()]
    fingerprint = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    status = subprocess.run(["git", "status", "--porcelain=v1"], capture_output=True, text=True, check=True).stdout
    return {"capturedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "commit": head,
            "sourceFingerprint": fingerprint, "fileCount": len(entries), "workingTree": status, "files": entries}

if __name__ == "__main__":
    data = snapshot()
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(json.dumps(data, indent=1) + "\n")
    print(data["commit"], data["sourceFingerprint"], data["fileCount"])

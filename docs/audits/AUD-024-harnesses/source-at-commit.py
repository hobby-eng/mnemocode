"""The source fingerprint of a commit's tree, by the method of AUD-020 to AUD-023 (snapshot.py of
AUD-023): SHA-256 of compact JSON of the sorted path/SHA-256 entries of its files, without
docs/audits/. A working tree's untracked non-ignored files count there; a commit holds only what
was committed. Run from the MnemoCode repository root:

    python3 docs/audits/AUD-024-harnesses/source-at-commit.py <commit> [expected fingerprint]

Prints the commit, the fingerprint and the file count; with an expected fingerprint it exits 1
when they differ.
"""
import hashlib, json, subprocess, sys

commit = sys.argv[1]
listing = subprocess.run(["git", "ls-tree", "-r", "-z", "--full-tree", commit],
                         capture_output=True, check=True).stdout.split(b"\0")
entries = []
for line in listing:
    if not line:
        continue
    meta, path = line.split(b"\t", 1)
    mode, kind, blob = meta.split()
    name = path.decode()
    if kind != b"blob" or name.startswith("docs/audits/") or mode == b"120000":
        continue
    data = subprocess.run(["git", "cat-file", "blob", blob], capture_output=True, check=True).stdout
    entries.append({"path": name, "sha256": hashlib.sha256(data).hexdigest()})
entries.sort(key=lambda entry: entry["path"])
fingerprint = hashlib.sha256(json.dumps(entries, separators=(",", ":")).encode()).hexdigest()
print(commit, fingerprint, len(entries))
if len(sys.argv) > 2 and fingerprint != sys.argv[2]:
    print(f"expected {sys.argv[2]}")
    sys.exit(1)

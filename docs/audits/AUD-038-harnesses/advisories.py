"""Check locked public packages through GitHub's official global advisories.

This is supplemental evidence, never a replacement for a failed npm audit.
Only public package names and versions are sent. No credential is read here;
the existing GitHub CLI handles its normal authentication.
"""
import datetime
import hashlib
import json
import subprocess
import sys
import tomllib
import urllib.parse
from pathlib import Path

if not __debug__:
    raise SystemExit("Run this check without Python optimization.")

ROOT = Path(__file__).resolve().parents[3]
EVIDENCE = ROOT / "docs/audits/AUD-038-evidence"
ARGS = sys.argv[1:]
CACHED_ONLY = bool(ARGS) and ARGS[0] == "--cached"
if ARGS and (not CACHED_ONLY or len(ARGS) > 2):
    raise SystemExit("Use advisories.py [--cached [RUN]].")
if CACHED_ONLY:
    OUT = EVIDENCE
    if len(ARGS) == 2:
        label = ARGS[1]
        if not label or not all(c.isascii() and (c.isalnum() or c == "-")
                                for c in label):
            raise SystemExit("RUN must be a local evidence folder name.")
        OUT = EVIDENCE / label
else:
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime(
        "%Y%m%dT%H%M%S%fZ"
    )
    OUT = EVIDENCE / f"advisory-live-{stamp}"


def sha(data):
    """Identify the exact lock or response bytes."""
    return hashlib.sha256(data).hexdigest()


def locked_packages():
    """Include every package section of the multi-document pnpm lockfile."""
    npm = set()
    lock = ROOT / "pnpm-lock.yaml"
    for section in lock.read_text().split("\npackages:\n")[1:]:
        for line in section.split("\nsnapshots:\n", 1)[0].splitlines():
            if (line.startswith("  ") and not line.startswith("   ")
                    and line.endswith(":")):
                package = line.strip()[:-1].strip("'\"")
                name, version = package.rsplit("@", 1)
                assert name and version[0].isdigit(), package
                npm.add(f"{name}@{version}")
    assert npm
    cargo = tomllib.loads((ROOT / "sskr-wasm/rust/Cargo.lock").read_text())
    rust = [f"{row['name']}@{row['version']}" for row in cargo["package"]
            if row.get("source", "").startswith("registry+")]
    return sorted(npm), sorted(rust)


def request(ecosystem, packages, kind, label):
    """Retain every page and verify cached query/response identity."""
    endpoint = "/advisories?" + urllib.parse.urlencode({
        "ecosystem": ecosystem, "affects": ",".join(packages),
        "type": kind, "is_withdrawn": "false", "per_page": 100,
    })
    assert len(endpoint) < 7500
    response = OUT / f"advisories-{label}.json"
    manifest = OUT / f"advisories-{label}.query.json"
    if CACHED_ONLY:
        data = response.read_text()
        recorded = json.loads(manifest.read_text())
        assert recorded["endpoint"] == endpoint
        assert recorded["responseSha256"] == sha(data.encode())
    else:
        if response.exists() or manifest.exists():
            raise SystemExit("A live check requires a fresh evidence folder.")
        data = subprocess.check_output(
            ["gh", "api", "--method", "GET", "--paginate", endpoint],
            text=True, timeout=75,
        )
        response.write_text(data)
        manifest.write_text(json.dumps({
            "endpoint": endpoint, "packages": packages, "type": kind,
            "responseSha256": sha(data.encode()),
            "retrievedAtUtc": datetime.datetime.now(
                datetime.timezone.utc
            ).isoformat(),
        }, indent=2) + "\n")
    pages = []
    decoder = json.JSONDecoder()
    rest = data.strip()
    while rest:
        page, end = decoder.raw_decode(rest)
        assert isinstance(page, list)
        pages.extend(page)
        rest = rest[end:].strip()
    return {
        "ecosystem": ecosystem, "packages": packages, "type": kind,
        "count": len(pages), "responseSha256": sha(data.encode()),
        "advisories": [{"id": row["ghsa_id"], "severity": row["severity"],
                        "url": row["html_url"]} for row in pages],
    }


def main():
    """Use a known vulnerable version to check the filter, then all locks."""
    if CACHED_ONLY:
        if not OUT.is_dir():
            raise SystemExit("No retained run exists in that folder.")
    else:
        EVIDENCE.mkdir(exist_ok=True)
        OUT.mkdir()
    control = request(
        "npm", ["lodash@4.17.19"], "reviewed", "positive-control"
    )
    assert control["count"] > 0, "Known vulnerable version must be detected."
    npm, rust = locked_packages()
    results = []
    for ecosystem, packages in (("npm", npm), ("rust", rust)):
        for offset in range(0, len(packages), 65):
            for kind in ("reviewed", "malware", "unreviewed"):
                results.append(request(
                    ecosystem, packages[offset:offset + 65], kind,
                    f"{ecosystem}-{offset}-{kind}",
                ))
    report = {
        "checkedAtUtc": datetime.datetime.now(
            datetime.timezone.utc
        ).isoformat(),
        "cachedOnly": CACHED_ONLY, "positiveControl": control,
        "npmPackageVersions": len(npm),
        "cargoRegistryPackageVersions": len(rust),
        "lockSha256": sha((ROOT / "pnpm-lock.yaml").read_bytes()),
        "cargoLockSha256": sha(
            (ROOT / "sskr-wasm/rust/Cargo.lock").read_bytes()
        ),
        "queries": results,
        "qualification": (
            "Global advisories, not a passing npm audit. "
            "Cached replay is not a fresh network check."
        ),
    }
    result = OUT / (
        "advisory-replay.json" if CACHED_ONLY else "advisory-live.json"
    )
    result.write_text(json.dumps(report, indent=2) + "\n")
    assert not any(row["count"] for row in results), "Review advisory matches."
    print(f"PASS: {len(npm)} npm versions, {len(rust)} Cargo versions; "
          "no matches.")
    print(f"Local evidence: {OUT}")


if __name__ == "__main__":
    main()

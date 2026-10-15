# Audit-only helper: runs one command, keeps its log and a .command.json companion.
set -euo pipefail
export PATH="$HOME/.local/share/nodejs/node-v26.10.0-linux-x64/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export NO_COLOR=1
ROOT=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
E="$ROOT/docs/audits/AUD-002-evidence"
run() {
  local name="$1"
  shift
  local start t0 cwd code end sha node_version pnpm_version platform
  start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  t0=$(date +%s)
  cwd=$(pwd -P)
  node_version=$(node --version)
  pnpm_version=$(pnpm --version)
  platform=$(uname -srm)
  mkdir -p "$E"
  if "$@" > "$E/$name.log" 2>&1; then code=0; else code=$?; fi
  end=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  sha=$(sha256sum "$E/$name.log" | cut -c1-64)
  python3 - "$name" "$start" "$end" "$code" "$sha" "$E" "$cwd" \
    "$node_version" "$pnpm_version" "$platform" "$@" <<'PY'
import json
import os
import shlex
import sys

name, start, end, code, sha, folder, cwd, node, pnpm, platform, *command = sys.argv[1:]
record = {
    "name": name,
    "command": shlex.join(command),
    "cwd": cwd,
    "startedAtUtc": start,
    "completedAtUtc": end,
    "exitCode": int(code),
    "log": f"{name}.log",
    "logSha256": sha,
    "runtime": {"node": node, "pnpm": pnpm, "platform": platform},
}
with open(os.path.join(folder, f"{name}.command.json"), "w", encoding="utf-8") as output:
    json.dump(record, output, indent=2)
    output.write("\n")
PY
  echo "$name exit=$code ($(($(date +%s) - t0))s)"
  return "$code"
}

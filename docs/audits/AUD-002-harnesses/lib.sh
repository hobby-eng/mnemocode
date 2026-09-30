# Audit-only helper: runs one command, keeps its log and a .command.json companion.
export PATH=${HOME}/.local/share/nodejs/node-v26.10.0-linux-x64/bin:${HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin
export NO_COLOR=1
E=${HOME}/Documents/bip_tools/mnemocode/docs/audits/AUD-002-evidence
run() { local name="$1"; shift; local start=$(date -u +%Y-%m-%dT%H:%M:%SZ); local t0=$(date +%s)
  bash -c "$*" > "$E/$name.log" 2>&1; local code=$?
  local end=$(date -u +%Y-%m-%dT%H:%M:%SZ); local sha=$(sha256sum "$E/$name.log" | cut -c1-64)
  python3 - "$name" "$*" "$start" "$end" "$code" "$sha" "$E" <<'PY'
import json,sys,os
n,cmd,s,e,c,sha,E=sys.argv[1:8]
json.dump({"name":n,"command":cmd,"cwd":"${HOME}/Documents/bip_tools/mnemocode","startedAtUtc":s,"completedAtUtc":e,"exitCode":int(c),"log":f"{n}.log","logSha256":sha,"runtime":{"node":"v26.10.0","pnpm":"10.19.0 via corepack 0.36.0","platform":"Linux x86_64 Ubuntu 26.04.1"}},open(os.path.join(E,f"{n}.command.json"),"w"),indent=2)
PY
  echo "$name exit=$code ($(( $(date +%s)-t0 ))s)"; }

#!/bin/bash
# AUD-001: the build stage of the canonical container again, on the toolchain layers Docker kept
# from a first build, then every file compared with dist/release. For a day when downloads fail
# inside a container; `cargo xtask reproducible` is the gate, with no cache at all.
set -euo pipefail

rm -rf dist/rebuilt
docker buildx build --no-cache-filter build --platform linux/amd64 --target artifacts \
  --output type=local,dest=dist/rebuilt -f packaging/Dockerfile.reproducible .
compared=0
for file in dist/rebuilt/release/*; do
  name="${file##*/}"
  case "$name" in *.sha256) continue ;; esac
  cmp "$file" "dist/release/$name"
  compared="$((compared + 1))"
done
echo "$compared files equal, byte for byte."

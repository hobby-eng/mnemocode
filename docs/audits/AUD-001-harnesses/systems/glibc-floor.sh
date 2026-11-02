#!/bin/bash
# AUD-001: the canonical Linux executable on older and other C libraries. It prints what each system
# says; the expected result is in README.md.
#
# Usage: glibc-floor.sh <absolute-release-folder>
set -euo pipefail

for image in debian:11 ubuntu:22.04 debian:12 ubuntu:24.04 alpine:3.20; do
  echo "=== $image"
  docker run --rm -v "$1:/r:ro" "$image" sh -c \
    'NO_COLOR=1 /r/mnemocode-0.2.0-linux-x64 --version; echo "version exit $?"; NO_COLOR=1 /r/mnemocode-0.2.0-linux-x64 self-test 2>&1 | tail -n 1'
done

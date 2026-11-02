#!/bin/bash
# AUD-001, inside the pinned build image: the Windows executable under Wine and the ARM64 one under
# qemu-user, on the public test phrase. /release holds the canonical files, read only.
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive NO_COLOR=1 WINEDEBUG=-all
apt-get update -qq > /dev/null
apt-get install -y -qq --no-install-recommends wine wine64 qemu-user libc6-arm64-cross libgcc-s1-arm64-cross > /tmp/apt.log 2>&1
wine --version
qemu-aarch64 --version | head -n 1
mkdir -p /work
cd /work
printf 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about\n' > phrase.txt
printf '23-09-2026\n' > dates.txt

failed=0
step() {
  echo "=== $1"
  shift
  if ! "$@" 2>&1 | tail -n 30; then
    failed=1
    echo "FAILED"
  fi
}
steps() {
  label="$1"
  shift
  step "$label: version" "$@" --version
  step "$label: self-test" "$@" self-test
  step "$label: encode" "$@" encode --mnemonic-file phrase.txt --dates-file dates.txt --format 3 --output "$label-record.txt"
  step "$label: decode" "$@" decode --input-file "$label-record.txt" --dates-file dates.txt
  step "$label: split" "$@" sskr-split --mnemonic-file phrase.txt --threshold 2 --shares 3 --output "$label-shares.txt"
  step "$label: combine" "$@" sskr-combine --share-file "$label-shares.txt"
  step "$label: card PDF" "$@" preview --pdf "$label-cards.pdf"
}
steps windows wine /release/mnemocode-0.2.0-win-x64.exe
steps arm64 qemu-aarch64 -L /usr/aarch64-linux-gnu /release/mnemocode-0.2.0-linux-arm64
exit "$failed"

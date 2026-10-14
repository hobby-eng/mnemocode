#!/bin/bash
# Runs a command with an 8 GiB memory cap (no swap) and a 15-minute deadline, so that it cannot
# hang the machine. Usage: bash cap.sh <command> [arguments...]
exec systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 timeout 900 "$@"

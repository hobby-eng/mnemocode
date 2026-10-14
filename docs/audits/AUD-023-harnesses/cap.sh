#!/bin/bash
# Runs one heavy command at a time on this machine: it waits for the heavy-job lock that every
# session of the workspace shares, and that a heat governor holds while the CPU is hot, then runs
# the command with a 6 GiB memory cap (no swap) and a 30-minute deadline, so that it can neither
# hang nor overheat the machine. Usage, from the repository root: bash cap.sh <command> [args...]
# HEAVY_LOCK names another lock file; by default the workspace's, beside the repository.
lock=${HEAVY_LOCK:-../tmp/claude/aud023/heavy.lock}
exec flock -w 3600 "$lock" systemd-run --user --scope -q -p MemoryMax=6G -p MemorySwapMax=0 timeout 1800 "$@"

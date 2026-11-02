#!/bin/bash
# AUD-001: in-container.sh in the pinned build image.
#
# Usage: other-systems.sh <absolute-release-folder>
set -euo pipefail

cd "${0%/*}"
image=buildpack-deps@sha256:27bdb6ab1ca0df6acfe341752ee4d9c08a341d80e3ee75ccc3b34b79af0dfaf1
docker run --rm -v "$1:/release:ro" -v "$PWD/in-container.sh:/in-container.sh:ro" "$image" bash /in-container.sh

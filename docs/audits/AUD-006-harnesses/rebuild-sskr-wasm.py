#!/usr/bin/env python3
"""Rebuild the vendored SSKR bridge in its pinned offline toolchain; never replace vendored files."""

import hashlib
import json
import os
from pathlib import Path
import subprocess


ROOT = Path.cwd()
EVIDENCE = ROOT / "docs/audits/AUD-006-evidence/sskr-wasm-rebuild"
IMAGE = "audit6built:e6a6d6bc5ec6d38a1c6e1a1292c59a84d3f0796f"
CARGO_CACHE = Path(os.environ["CARGO_HOME"]) / "registry"
VENDORED_RUST = ROOT / "vendor/sskr/rust"

EVIDENCE.mkdir(parents=True, exist_ok=True)
identity = subprocess.check_output(
    ["docker", "image", "inspect", IMAGE, "--format", "{{.Id}}"], text=True
).strip()
print(f"Pinned base image: {identity}", flush=True)

build_flags = "\x1f".join(
    [
        "--remap-path-prefix=/root/.cargo=/cargo",
        "--remap-path-prefix=/root/.rustup=/rustup",
        "--remap-path-prefix=/workspace=/workspace",
        "--cfg",
        'getrandom_backend="wasm_js"',
    ]
)

command = [
    "docker",
    "run",
    "--rm",
    "--network",
    "none",
    "--cpus",
    "1",
    "--memory",
    "1536m",
    "--pids-limit",
    "256",
    "--mount",
    f"type=bind,src={VENDORED_RUST},dst=/workspace/packages/recovery-sskr-wasm/rust,readonly",
    "--mount",
    f"type=bind,src={CARGO_CACHE},dst=/root/.cargo/registry,readonly",
    "--mount",
    f"type=bind,src={EVIDENCE},dst=/audit",
    "--env",
    "CARGO_HOME=/root/.cargo",
    "--env",
    "CARGO_BUILD_JOBS=1",
    "--env",
    "CARGO_TARGET_DIR=/audit/toolchain-target",
    "--env",
    f"CARGO_ENCODED_RUSTFLAGS={build_flags}",
    "--env",
    "CFLAGS_wasm32_unknown_unknown=-I/usr/include/wasm32-wasi -include /usr/include/wasm32-wasi/string.h",
    "--entrypoint",
    "sh",
    IMAGE,
    "-c",
    "set -eu\n"
    "rustc --version\n"
    "clang --version\n"
    "cargo install --offline --locked --version 0.2.129 --root /audit/wasm-bindgen-cli wasm-bindgen-cli\n"
    "cargo build --manifest-path /workspace/packages/recovery-sskr-wasm/rust/Cargo.toml "
    "--target-dir /audit/sskr-target --target wasm32-unknown-unknown --release --locked --offline\n"
    "/audit/wasm-bindgen-cli/bin/wasm-bindgen "
    "/audit/sskr-target/wasm32-unknown-unknown/release/recovery_sskr_wasm.wasm "
    "--target web --out-dir /audit/generated",
]
print(json.dumps(command), flush=True)
subprocess.run(command, check=True)

generated_directory = EVIDENCE / "generated"
committed_directory = ROOT / "vendor/sskr/generated"
filenames = [
    "recovery_sskr_wasm.js",
    "recovery_sskr_wasm.d.ts",
    "recovery_sskr_wasm_bg.wasm",
    "recovery_sskr_wasm_bg.wasm.d.ts",
]
results = {}
for filename in filenames:
    generated = (generated_directory / filename).read_bytes()
    committed = (committed_directory / filename).read_bytes()
    results[filename] = {
        "generatedSha256": hashlib.sha256(generated).hexdigest(),
        "committedSha256": hashlib.sha256(committed).hexdigest(),
        "identical": generated == committed,
    }

record = {"image": identity, "wasmBindgen": "0.2.129", "files": results}
(EVIDENCE / "comparison.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps(record, indent=2), flush=True)
if not all(result["identical"] for result in results.values()):
    raise SystemExit("Fresh pinned SSKR outputs differ from the vendored files.")
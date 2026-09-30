"""Rebuild only the mounted SSKR source; never replace vendored outputs."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path.cwd()
out = root / 'docs/audits/AUD-004-evidence/wasm-rebuild'
out.mkdir(exist_ok=True)
image = 'audit6built:e6a6d6bc5ec6d38a1c6e1a1292c59a84d3f0796f'
identity = subprocess.check_output(['docker', 'image', 'inspect', image, '--format', '{{.Id}}'], text=True).strip()
print('Container image:', identity, flush=True)
flags = '\x1f'.join(['--remap-path-prefix=/root/.cargo=/cargo', '--remap-path-prefix=/root/.rustup=/rustup',
                     '--remap-path-prefix=/workspace=/workspace', '--cfg', 'getrandom_backend="wasm_js"'])
command = ['docker', 'run', '--rm', '--network', 'none', '--cpus', '1', '--memory', '1536m', '--pids-limit', '256',
           '--mount', f'type=bind,src={root / "vendor/sskr/rust"},dst=/workspace/packages/recovery-sskr-wasm/rust,readonly',
           '--mount', f'type=bind,src={out},dst=/audit',
           '-e', 'CARGO_BUILD_JOBS=1', '-e', 'CARGO_ENCODED_RUSTFLAGS=' + flags,
           '-e', 'CFLAGS_wasm32_unknown_unknown=-I/usr/include/wasm32-wasi -include /usr/include/wasm32-wasi/string.h',
           '--entrypoint', 'sh', image, '-c',
           'set -eu\nrustc --version\nclang --version\nwasm-bindgen --version\n'
           'cargo build --manifest-path /workspace/packages/recovery-sskr-wasm/rust/Cargo.toml '
           '--target-dir /audit/target --target wasm32-unknown-unknown --release --locked --offline\n'
           'wasm-bindgen /audit/target/wasm32-unknown-unknown/release/recovery_sskr_wasm.wasm --target web --out-dir /audit/generated']
print(json.dumps(command), flush=True)
subprocess.run(command, check=True)
generated = (out / 'generated/recovery_sskr_wasm_bg.wasm').read_bytes()
committed = (root / 'vendor/sskr/generated/recovery_sskr_wasm_bg.wasm').read_bytes()
result = {'image': identity, 'generatedWasmSha256': hashlib.sha256(generated).hexdigest(),
          'committedWasmSha256': hashlib.sha256(committed).hexdigest(), 'identicalWasm': generated == committed}
print(json.dumps(result, indent=2), flush=True)
(out / 'comparison.json').write_text(json.dumps(result, indent=2) + '\n')
assert generated == committed, 'Fresh WASM differs from vendored WASM'

// Resume after the preserved whole-store identity failure; no original receipt is overwritten.
import { spawnSync } from "node:child_process";
function run(label, args, rss = 768, heap = 256) {
  const child = spawnSync(process.execPath, ["docs/audits/AUD-035-harnesses/run.mjs", label, ...args], {
    stdio: "inherit", env: { ...process.env, CARGO_BUILD_JOBS: "1", AUD026_RSS_MIB: String(rss), AUD026_HEAP_MIB: String(heap), AUD026_TIMEOUT_SECONDS: "600" },
  });
  if (child.error) throw child.error;
  if (child.status !== 0) process.exit(child.status ?? 1);
}
// Toolchain paths are supplied by the caller; published harnesses contain no owner path.
delete process.env.RUSTUP_TOOLCHAIN;
run("dependency-links-after", ["node", "docs/audits/AUD-035-harnesses/dependency-links.mjs", "after"], 256, 128);
run("dependency-reconciliation", ["node", "docs/audits/AUD-035-harnesses/dependency-reconcile.mjs"], 384, 128);
run("rust-tests-pinned", ["cargo", "+1.99.0", "test", "--locked", "--offline", "--manifest-path", "sskr-wasm/rust/Cargo.toml", "--workspace", "--all-targets", "--jobs", "1", "--target-dir", "node_modules/.cache/sskr-cargo", "--", "--test-threads=1"], 512, 128);
run("linux-build", ["node", "scripts/build-executable.mjs", "release/aud035"], 1408);
run("linux-acceptance", ["node", "scripts/verify-executable.mjs", "release/aud035/mnemocode-0.1.0-linux-x64"], 896);
run("executable-terminal", ["python3", "scripts/verify-terminal-input.py", "release/aud035/mnemocode-0.1.0-linux-x64"], 896);
run("startup", ["node", "docs/audits/AUD-035-harnesses/startup.mjs"], 384, 128);
run("close-cleanup", ["node", "docs/audits/AUD-034-harnesses/close-error-probe.mjs", "docs/audits/AUD-035-evidence/close-cleanup.json"], 256, 128);

// Sequential release procedure with explicit memory budgets; no product inputs are changed.
import { spawnSync } from "node:child_process";
const run=(label,command,rss=1152,heap=256)=>{
 const result=spawnSync(process.execPath,["docs/audits/AUD-035-harnesses/run.mjs",label,...command],{stdio:"inherit",env:{...process.env,AUD026_RSS_MIB:String(rss),AUD026_HEAP_MIB:String(heap),AUD026_TIMEOUT_SECONDS:"600",CARGO_BUILD_JOBS:"1",GOMAXPROCS:"1"}});
 if(result.error) throw result.error;
 if(result.status!==0) process.exit(result.status??1);
};
run("format-release",["corepack","pnpm","format:check"],768,128);
run("build",["corepack","pnpm","build"],768);
const suite=spawnSync(process.execPath,["docs/audits/AUD-035-harnesses/suite.mjs"],{stdio:"inherit",env:{...process.env,AUD026_RSS_MIB:"1152",AUD026_HEAP_MIB:"256",AUD026_TIMEOUT_SECONDS:"600",GOMAXPROCS:"1"}});
if(suite.error) throw suite.error;
if(suite.status!==0) process.exit(suite.status??1);
run("full-self-test",["node","dist/mnemocode.js","self-test"],896);
run("rust-tests",["cargo","test","--locked","--offline","--manifest-path","sskr-wasm/rust/Cargo.toml","--workspace","--all-targets","--jobs","1","--target-dir","node_modules/.cache/sskr-cargo","--","--test-threads=1"],512,128);
run("independent-sskr",["python3","scripts/verify-sskr-known-answers.py"],256,128);
run("terminal",["python3","scripts/verify-terminal-input.py"],896);
run("card-output",["node","scripts/check-card-output.mjs","output/aud035-card-output"],1024);
run("current-executable",["node","scripts/verify-executable.mjs","release/aud034-fixed/mnemocode-0.1.0-linux-x64"],896);
run("dependency-audit",["corepack","pnpm","audit","--audit-level","high","--json"],512,128);
run("package",["npm","pack","--dry-run","--json","--ignore-scripts"],512,128);

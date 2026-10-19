// Run after checks.mjs fully exits: preserve the original default-toolchain receipt separately.
import{spawnSync}from"node:child_process";
const E="docs/audits/AUD-035-evidence";
function run(label,args,rss=768,heap=256){
 const child=spawnSync(process.execPath,["docs/audits/AUD-035-harnesses/run.mjs",label,...args],{stdio:"inherit",env:{...process.env,CARGO_BUILD_JOBS:"1",AUD026_RSS_MIB:String(rss),AUD026_HEAP_MIB:String(heap),AUD026_TIMEOUT_SECONDS:"600"}});
 if(child.error)throw child.error;if(child.status!==0)process.exit(child.status??1);
}
run("dependency-payload-before",["node","docs/audits/AUD-035-harnesses/dependency-closure.mjs","before"],384,128);
run("dependency-links-before",["node","docs/audits/AUD-035-harnesses/dependency-links.mjs","before"],256,128);
run("frozen-install",["corepack","pnpm","install","--frozen-lockfile","--offline"],896);
run("dependency-payload-after",["node","docs/audits/AUD-035-harnesses/dependency-closure.mjs","after"],384,128);
run("dependency-links-after",["node","docs/audits/AUD-035-harnesses/dependency-links.mjs","after"],256,128);
run("rust-tests-pinned",["cargo","+1.99.0","test","--locked","--offline","--manifest-path","sskr-wasm/rust/Cargo.toml","--workspace","--all-targets","--jobs","1","--target-dir","node_modules/.cache/sskr-cargo","--","--test-threads=1"],512,128);
run("linux-build",["node","scripts/build-executable.mjs","release/aud035"],1408);
run("linux-acceptance",["node","scripts/verify-executable.mjs","release/aud035/mnemocode-0.1.0-linux-x64"],896);
run("executable-terminal",["python3","scripts/verify-terminal-input.py","release/aud035/mnemocode-0.1.0-linux-x64"],896);
run("startup",["node","docs/audits/AUD-035-harnesses/startup.mjs"],384,128);
run("close-cleanup",["node","docs/audits/AUD-034-harnesses/close-error-probe.mjs",`${E}/close-cleanup.json`],256,128);

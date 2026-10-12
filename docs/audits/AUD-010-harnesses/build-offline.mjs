// AUD-010 build reviewer: the offline boundary (CHECK-SEC-002/003 for an offline tool).
//
// 1. Static: every file under src/ and the generated SSKR bridge, comments removed, searched for
//    network APIs (fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, Node's http, https,
//    http2, net, tls, dns, dgram, undici) and for imports of URLs. Any hit fails. Every http(s) URL
//    in code is listed with its file, for review; they are not failures.
// 2. The runtime packages (package.json dependencies) reached by the build: the same network API
//    search over each package's files, listed for review (a hit is not a failure: the permission
//    model below is what stops a request).
// 3. Runtime: the command line's own permission flags (src/cli/protection-flags.json, the same
//    that scripts/build-executable.mjs embeds) must not grant the network: a TCP connection and a
//    fetch to 127.0.0.1 (a closed local port, no traffic leaves the computer) must be refused with
//    ERR_ACCESS_DENIED; the same code without --permission must reach the socket layer. Port 65531:
//    fetch refuses port 9 and the other "bad ports" before any permission check
//    (ECONNREFUSED), so that the probe can tell the two apart.
// Exits 1 when a static hit in src/ or the bridge is found, a flag grants the network, or the
// runtime refusal is not observed.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let failures = 0;
const NETWORK = [
  /\bfetch\s*\(/u,
  /\bXMLHttpRequest\b/u,
  /\bWebSocket\b/u,
  /\bEventSource\b/u,
  /\bsendBeacon\b/u,
  /["'](?:node:)?(?:http|https|http2|net|tls|dns|dgram|undici)["']/u,
  /\bimport\s*\(\s*["']https?:/u,
  /from\s+["']https?:/u,
];
const URL_PATTERN = /https?:\/\/[^\s"'`)<>]+/gu;
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"'`\\])\/\/.*$/gmu, "$1");
}
function files(directory, extensions) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return files(path, extensions);
    return extensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

const scanned = [...files("src", [".ts", ".json"]), ...files("sskr-wasm/generated", [".js"])];
const urls = new Map();
for (const path of scanned) {
  const text = code(readFileSync(path, "utf8"));
  for (const pattern of NETWORK)
    for (const [number, line] of text.split("\n").entries())
      // process.permission.has("net") asks the permission model; it opens nothing.
      if (pattern.test(line) && !/permission\.has\("net"\)/u.test(line)) {
        failures += 1;
        console.log(`FAIL network API in ${path}:${number + 1}: ${line.trim().slice(0, 160)}`);
      }
  if (path === "src/export/world-map-data.ts") continue;
  for (const match of text.matchAll(URL_PATTERN)) urls.set(`${path}: ${match[0]}`, true);
}
console.log(`Static scan: ${scanned.length} files (src/ and sskr-wasm/generated/), network API hits ${failures}`);
console.log(`URLs in code, for review (${urls.size}):`);
for (const url of urls.keys()) console.log(`  ${url}`);

// 2. Runtime packages.
const manifest = JSON.parse(readFileSync("package.json", "utf8"));
for (const name of Object.keys(manifest.dependencies)) {
  const directory = join("node_modules", name);
  const hits = [];
  for (const path of files(directory, [".js", ".mjs", ".cjs"])) {
    if (/[\\/](test|tests|__tests__|bin|scripts)[\\/]/u.test(path.slice(directory.length))) continue;
    const text = code(readFileSync(path, "utf8"));
    for (const pattern of NETWORK.slice(0, 6)) if (pattern.test(text)) hits.push(`${path.slice(directory.length + 1)} ${pattern.source}`);
  }
  console.log(`package ${name}: ${hits.length === 0 ? "no network API" : `${hits.length} hit(s): ${[...new Set(hits)].slice(0, 6).join("; ")}`}`);
}

// 3. Runtime refusal under the program's own flags.
const flags = JSON.parse(readFileSync("src/cli/protection-flags.json", "utf8"));
console.log(`protection-flags.json: ${flags.join(" ")}`);
if (flags.some((flag) => /^--allow-(net|addons|wasi|worker)/u.test(flag))) {
  failures += 1;
  console.log("FAIL a protection flag grants the network, addons, WASI or workers");
}
const probe = `
const net = await import("node:net");
const tcp = await new Promise((resolve) => {
  try {
    const socket = net.connect({ host: "127.0.0.1", port: 65531 });
    socket.on("error", (error) => resolve(error.code ?? error.message));
    socket.on("connect", () => { socket.destroy(); resolve("connected"); });
  } catch (error) { resolve(error.code ?? error.message); }
});
let http;
try { await fetch("http://127.0.0.1:65531/"); http = "answered"; }
catch (error) { http = error.cause?.code ?? error.code ?? error.message; }
console.log(JSON.stringify({ tcp, fetch: http }));
`;
function attempt(extra) {
  const result = spawnSync(process.execPath, [...extra, "--input-type=module", "-e", probe], {
    encoding: "utf8",
    timeout: 30_000,
  });
  return result.stdout.trim().split("\n").at(-1) ?? result.stderr.trim();
}
const protectedRun = JSON.parse(attempt(flags));
const control = JSON.parse(attempt([]));
console.log(`under protection-flags.json: tcp ${protectedRun.tcp}, fetch ${protectedRun.fetch}`);
console.log(`control without --permission: tcp ${control.tcp}, fetch ${control.fetch}`);
if (protectedRun.tcp !== "ERR_ACCESS_DENIED" || protectedRun.fetch !== "ERR_ACCESS_DENIED") {
  failures += 1;
  console.log("FAIL the network was not refused with ERR_ACCESS_DENIED under the program's flags");
}
if (control.tcp !== "ECONNREFUSED") {
  failures += 1;
  console.log("FAIL the control did not reach the socket layer; the probe cannot tell the cases apart");
}
console.log(failures === 0 ? "PASS build-offline" : `FAIL build-offline: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;

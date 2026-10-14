import { readdirSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const nodeVersion = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
// Every job sets up Node.js and pnpm through one local action, which holds their pins.
const setupAction = readFileSync(
  new URL("../.github/actions/setup-node-pnpm/action.yml", import.meta.url),
  "utf8",
);
const workflowFolder = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(workflowFolder)
  .filter((name) => name.endsWith(".yml"))
  .map((name) => ({ name, text: readFileSync(new URL(name, workflowFolder), "utf8") }));
const versionSource = readFileSync(new URL("../src/version.ts", import.meta.url), "utf8");

const expectedEngine = `>=${nodeVersion}`;
if (packageJson.engines?.node !== expectedEngine) {
  throw new Error(`package.json engines.node must be ${expectedEngine}`);
}

if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageJson.packageManager ?? "")) {
  throw new Error("package.json packageManager must pin an exact pnpm version");
}

if (!setupAction.includes("node-version-file: .node-version")) {
  throw new Error("The setup action must read Node.js from .node-version");
}

if (/\n\s+version:\s+\d+\.\d+\.\d+\s*$/mu.test(setupAction)) {
  throw new Error("The setup action must read pnpm from package.json packageManager");
}

/** The jobs of a workflow, each with its name and its lines, as `jobs:` lists them. */
function jobsOf(text) {
  const body = text.slice(text.indexOf("\njobs:\n") + "\njobs:\n".length);
  return body.split(/\n(?=  [a-z][\w-]*:\n)/u).map((block) => ({
    job: block.match(/^  ([a-z][\w-]*):/u)?.[1],
    block,
  }));
}

const checkoutPins = new Set();
for (const { name, text } of workflows) {
  if (/uses:\s*(actions\/setup-node|pnpm\/action-setup)@/u.test(text))
    throw new Error(`${name} must set up Node.js and pnpm through .github/actions/setup-node-pnpm`);
  for (const pin of text.matchAll(/uses:\s*actions\/checkout@(\S+)/gu)) checkoutPins.add(pin[1]);
  for (const { job, block } of jobsOf(text))
    if (/run:.*\bpnpm /u.test(block) && !block.includes("uses: ./.github/actions/setup-node-pnpm"))
      throw new Error(`${name}: job ${job} runs pnpm without .github/actions/setup-node-pnpm`);
}
if (checkoutPins.size !== 1)
  throw new Error(
    `Every workflow must pin actions/checkout to one commit: ${[...checkoutPins].join(", ")}`,
  );

// The SSKR engine's container declares the versions of its tools once; those that other files pin
// too must agree with them.
const dockerfile = readFileSync(new URL("../Dockerfile.sskr", import.meta.url), "utf8");
const cargoManifest = readFileSync(
  new URL("../sskr-wasm/rust/Cargo.toml", import.meta.url),
  "utf8",
);
const dockerArgument = (name) => dockerfile.match(new RegExp(`^ARG ${name}=(\\S+)$`, "mu"))?.[1];
const cargoBindgen = cargoManifest.match(/^wasm-bindgen = "=([^"]+)"$/mu)?.[1];
if (dockerArgument("WASM_BINDGEN_VERSION") !== cargoBindgen) {
  throw new Error(
    "Dockerfile.sskr WASM_BINDGEN_VERSION must equal the wasm-bindgen pin of sskr-wasm/rust/Cargo.toml",
  );
}
// The resolved crate must be the pinned one too: the CLI and the crate meet in one schema.
const cargoLock = readFileSync(new URL("../sskr-wasm/rust/Cargo.lock", import.meta.url), "utf8");
const lockedBindgen = cargoLock.match(/^name = "wasm-bindgen"\nversion = "([^"]+)"$/mu)?.[1];
if (lockedBindgen !== cargoBindgen) {
  throw new Error("sskr-wasm/rust/Cargo.lock must resolve wasm-bindgen to the pin of Cargo.toml");
}
// The checks of the crate run with the Rust that the container builds with, in CI too.
const rustVersion = dockerArgument("RUST_VERSION");
const crateToolchain = readFileSync(
  new URL("../sskr-wasm/rust/rust-toolchain.toml", import.meta.url),
  "utf8",
).match(/^channel = "([^"]+)"$/mu)?.[1];
if (crateToolchain !== rustVersion) {
  throw new Error(
    "sskr-wasm/rust/rust-toolchain.toml channel must equal Dockerfile.sskr RUST_VERSION",
  );
}
const ciRust = workflows
  .find(({ name }) => name === "ci.yml")
  ?.text.match(/rustup toolchain install (\S+)/u)?.[1];
if (ciRust !== rustVersion) {
  throw new Error("ci.yml must install the Rust of Dockerfile.sskr RUST_VERSION for pnpm check");
}
if (dockerArgument("NODE_VERSION") !== nodeVersion) {
  throw new Error("Dockerfile.sskr NODE_VERSION must equal .node-version");
}
if (`pnpm@${dockerArgument("PNPM_VERSION")}` !== packageJson.packageManager) {
  throw new Error("Dockerfile.sskr PNPM_VERSION must equal package.json packageManager");
}

const sourceVersion = versionSource.match(/MNEMOCODE_VERSION = ["']([^"']+)["']/u)?.[1];
if (sourceVersion !== packageJson.version) {
  throw new Error("src/version.ts MNEMOCODE_VERSION must match package.json version");
}

// The documents that a person reads name the versions of their sources: the Node.js and pnpm of
// the toolchain, the packages of package.json and the crates of the SSKR engine's Cargo files.
// Each statement is built from its source and must stand in the document, white space aside.
const lockedVersion = (crate) =>
  cargoLock.match(new RegExp(`^name = "${crate}"\\nversion = "([^"]+)"$`, "mu"))?.[1];
const bridgeVersion = cargoManifest.match(
  /^\[package\]\nname = "[^"]+"\nversion = "([^"]+)"$/mu,
)?.[1];
const pnpmVersion = packageJson.packageManager.replace(/^pnpm@/u, "");
const SSKR_CRATES = ["sskr", "bc-shamir", "bc-rand", "bc-ur", "bc-tags", "dcbor"];
const statements = {
  "README.md": [`Node.js ${nodeVersion} or newer`],
  ".github/ISSUE_TEMPLATE/bug_report.yml": [`Node.js ${nodeVersion}; pnpm ${pnpmVersion}`],
  "THIRD_PARTY_NOTICES.md": [
    `\`pdf-lib\` (${packageJson.dependencies["pdf-lib"]})`,
    `\`@pdf-lib/fontkit\` (${packageJson.dependencies["@pdf-lib/fontkit"]})`,
    `\`sskr ${lockedVersion("sskr")}\` / \`bc-shamir ${lockedVersion("bc-shamir")}\``,
  ],
  "sskr-wasm/NOTICE.md": [
    `\`recovery-sskr-wasm\` ${bridgeVersion}`,
    ...SSKR_CRATES.map((crate) => `\`${crate}\` ${lockedVersion(crate)}`),
  ],
};
const oneSpace = (text) => text.replace(/\s+/gu, " ");
for (const [path, wanted] of Object.entries(statements)) {
  const text = oneSpace(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  for (const statement of wanted)
    if (!text.includes(oneSpace(statement)))
      throw new Error(`${path} must say ${statement}, as its source has it.`);
}

console.log(
  `Version and toolchain pins agree: MnemoCode ${sourceVersion}; Node.js ${nodeVersion}; ${packageJson.packageManager}.`,
);

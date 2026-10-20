import { readdirSync, readFileSync } from "node:fs";
import { ErrorCatalog } from "../src/core/error-catalog.ts";

const ERRORS = new ErrorCatalog("scripts.verify-toolchain", {
  /**
   * @param {string} value0
   */
  "package-json-engines-node": (value0) => `package.json engines.node must be ${value0}`,
  "setup-action-read-node-js-from-node-version": () =>
    "The setup action must read Node.js from .node-version",
  "setup-action-read-pnpm-from-package-json-package": () =>
    "The setup action must read pnpm from package.json packageManager",
  /**
   * @param {string} value0
   */
  "set-up-node-js-pnpm-through-github-actions": (value0) =>
    `${value0} must set up Node.js and pnpm through .github/actions/setup-node-pnpm`,
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "job-runs-pnpm-without-github-actions-setup-node": (value0, value1) =>
    `${value0}: job ${value1} runs pnpm without .github/actions/setup-node-pnpm`,
  /**
   * @param {string} value0
   */
  "every-workflow-pin-actions-checkout-one-commit": (value0) =>
    `Every workflow must pin actions/checkout to one commit: ${value0}`,
  "dockerfile-sskr-wasm-bindgen-version-equal-wasm-bindgen": () =>
    "Dockerfile.sskr WASM_BINDGEN_VERSION must equal the wasm-bindgen pin of sskr-wasm/rust/Cargo.toml",
  "sskr-wasm-rust-cargo-lock-resolve-wasm-bindgen": () =>
    "sskr-wasm/rust/Cargo.lock must resolve wasm-bindgen to the pin of Cargo.toml",
  "sskr-wasm-rust-rust-toolchain-toml-channel-equal": () =>
    "sskr-wasm/rust/rust-toolchain.toml channel must equal Dockerfile.sskr RUST_VERSION",
  "ci-yml-install-rust-dockerfile-sskr-rust-version": () =>
    "ci.yml must install the Rust of Dockerfile.sskr RUST_VERSION for pnpm check",
  "dockerfile-sskr-node-version-equal-node-version": () =>
    "Dockerfile.sskr NODE_VERSION must equal .node-version",
  "dockerfile-sskr-pnpm-version-equal-package-json-package": () =>
    "Dockerfile.sskr PNPM_VERSION must equal package.json packageManager",
  "src-version-ts-mnemocode-version-match-package-json": () =>
    "src/version.ts MNEMOCODE_VERSION must match package.json version",
  /**
   * @param {string} value0
   * @param {string} value1
   */
  "say-as-source": (value0, value1) => `${value0} must say ${value1}, as its source has it.`,
});

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
  throw ERRORS.create("package-json-engines-node", [`${expectedEngine}`]);
}

if (!setupAction.includes("node-version-file: .node-version")) {
  throw ERRORS.create("setup-action-read-node-js-from-node-version", []);
}

if (/\n\s+version:\s+\d+\.\d+\.\d+\s*$/mu.test(setupAction)) {
  throw ERRORS.create("setup-action-read-pnpm-from-package-json-package", []);
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
    throw ERRORS.create("set-up-node-js-pnpm-through-github-actions", [`${name}`]);
  for (const pin of text.matchAll(/uses:\s*actions\/checkout@(\S+)/gu)) checkoutPins.add(pin[1]);
  for (const { job, block } of jobsOf(text))
    if (/run:.*\bpnpm /u.test(block) && !block.includes("uses: ./.github/actions/setup-node-pnpm"))
      throw ERRORS.create("job-runs-pnpm-without-github-actions-setup-node", [`${name}`, `${job}`]);
}
if (checkoutPins.size !== 1)
  throw ERRORS.create("every-workflow-pin-actions-checkout-one-commit", [
    `${[...checkoutPins].join(", ")}`,
  ]);

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
  throw ERRORS.create("dockerfile-sskr-wasm-bindgen-version-equal-wasm-bindgen", []);
}
// The resolved crate must be the pinned one too: the CLI and the crate meet in one schema.
const cargoLock = readFileSync(new URL("../sskr-wasm/rust/Cargo.lock", import.meta.url), "utf8");
const lockedBindgen = cargoLock.match(/^name = "wasm-bindgen"\nversion = "([^"]+)"$/mu)?.[1];
if (lockedBindgen !== cargoBindgen) {
  throw ERRORS.create("sskr-wasm-rust-cargo-lock-resolve-wasm-bindgen", []);
}
// The checks of the crate run with the Rust that the container builds with, in CI too.
const rustVersion = dockerArgument("RUST_VERSION");
const crateToolchain = readFileSync(
  new URL("../sskr-wasm/rust/rust-toolchain.toml", import.meta.url),
  "utf8",
).match(/^channel = "([^"]+)"$/mu)?.[1];
if (crateToolchain !== rustVersion) {
  throw ERRORS.create("sskr-wasm-rust-rust-toolchain-toml-channel-equal", []);
}
const ciRust = workflows
  .find(({ name }) => name === "ci.yml")
  ?.text.match(/rustup toolchain install (\S+)/u)?.[1];
if (ciRust !== rustVersion) {
  throw ERRORS.create("ci-yml-install-rust-dockerfile-sskr-rust-version", []);
}
if (dockerArgument("NODE_VERSION") !== nodeVersion) {
  throw ERRORS.create("dockerfile-sskr-node-version-equal-node-version", []);
}
if (`pnpm@${dockerArgument("PNPM_VERSION")}` !== packageJson.packageManager) {
  throw ERRORS.create("dockerfile-sskr-pnpm-version-equal-package-json-package", []);
}

const sourceVersion = versionSource.match(/MNEMOCODE_VERSION = ["']([^"']+)["']/u)?.[1];
if (sourceVersion !== packageJson.version) {
  throw ERRORS.create("src-version-ts-mnemocode-version-match-package-json", []);
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
      throw ERRORS.create("say-as-source", [`${path}`, `${statement}`]);
}

console.log(
  `Version and toolchain pins agree: MnemoCode ${sourceVersion}; Node.js ${nodeVersion}; ${packageJson.packageManager}.`,
);

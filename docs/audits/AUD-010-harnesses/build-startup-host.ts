// AUD-010 build reviewer: the startup self-test (MnemoCodeSelfTest.core) as another host composes
// it, from the host-neutral modules alone, before and after the render platform is configured.
//
// export/sskr-render-self-test.ts and export/heir-sheet-self-test.ts say that they need the render
// platform (configureRenderPlatform) "for the PDF only", set "before the full check runs". This
// probe runs each feature's startup known answers in a process where no render platform is set,
// as a host that runs the startup checks first would, and then again after the Node.js platform is
// configured. It prints each result. Expected by the module comments: every startup passes
// without the platform.
//
// Exits 1 when a startup check fails without the platform although its module says it needs the
// platform for the PDF only, or when any startup check fails with the platform configured.
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/build-startup-host.ts

import { MnemoCodeSelfTest } from "../../../src/core/self-test.ts";
import { WALLET_EVIDENCE_SELF_TEST } from "../../../src/core/wallet-evidence-self-test.ts";
import { COIN_ADDRESS_SELF_TEST } from "../../../src/core/coins-self-test.ts";
import { HEIR_SHEET_SELF_TEST } from "../../../src/export/heir-sheet-self-test.ts";
import { SHARE_CARDS_SELF_TEST } from "../../../src/export/sskr-render-self-test.ts";
import type { SelfTestFeature } from "../../../src/core/self-test-check.ts";

const FEATURES: readonly (readonly [string, SelfTestFeature])[] = [
  ["Wallet evidence", WALLET_EVIDENCE_SELF_TEST],
  ["Coin addresses", COIN_ADDRESS_SELF_TEST],
  ["Heir sheet", HEIR_SHEET_SELF_TEST],
  ["Share cards", SHARE_CARDS_SELF_TEST],
];
/** The modules whose comments promise that the platform is needed only for the PDF. */
const PDF_ONLY = new Set(["Heir sheet", "Share cards"]);

function attempt(run: () => void): string {
  try {
    run();
    return "passed";
  } catch (error) {
    return `threw: ${error instanceof Error ? error.message : String(error)}`;
  }
}

let failures = 0;
console.log("Without a render platform (no configureRenderPlatform, no platform-node import):");
console.log(`  library core(): ${attempt(() => MnemoCodeSelfTest.core())}`);
for (const [name, feature] of FEATURES) {
  const outcome = attempt(() => MnemoCodeSelfTest.core([feature]));
  console.log(`  core([${name}]): ${outcome}`);
  if (outcome !== "passed" && PDF_ONLY.has(name)) {
    failures += 1;
    console.log(`  FAIL ${name}: its startup needs the render platform, its module says PDF only`);
  }
}

await import("../../../src/export/platform-node.ts");
console.log("With the Node.js render platform configured:");
for (const [name, feature] of FEATURES) {
  const outcome = attempt(() => MnemoCodeSelfTest.core([feature]));
  console.log(`  core([${name}]): ${outcome}`);
  if (outcome !== "passed") failures += 1;
}
const all = attempt(() => MnemoCodeSelfTest.core(FEATURES.map(([, feature]) => feature)));
console.log(`  core(all four features, as the command line): ${all}`);
if (all !== "passed") failures += 1;

console.log(failures === 0 ? "PASS build-startup-host" : `FAIL build-startup-host: ${failures} check(s)`);
process.exitCode = failures === 0 ? 0 : 1;

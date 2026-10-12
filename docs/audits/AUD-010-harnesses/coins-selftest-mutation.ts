// AUD-010 coins reviewer, probe "coins-selftest-mutation": the coin families' self-tests, the
// wallet evidence self-test and the master fingerprint self-test must FAIL when an expected value
// is altered, and the command line's startup gate must stop when a coin check fails.
//
// Source files are never edited. Each module is copied into the scratch folder
// <workspace>/tmp/mnemocode/aud010/coins/mutants/ with its relative imports
// rewritten to the absolute src/ paths (so it shares the production module instances), once
// unchanged (the control, which must pass) and once per mutation (which must throw, for the reason
// named). Then CoinAddress.prototype.isAddressOf is replaced at run time to show that
// COIN_ADDRESS_SELF_TEST and assertCoreSelfTest (src/cli/self-test.ts) refuse to start.
//
// Run: node --import tsx docs/audits/AUD-010-harnesses/coins-selftest-mutation.ts
// Exit code: 0 when every control passes and every mutant fails as expected, 1 otherwise.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(import.meta.dirname, "../../..");
const MUTANTS = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/coins/mutants", import.meta.url),
);
rmSync(MUTANTS, { recursive: true, force: true });
mkdirSync(MUTANTS, { recursive: true });

let failures = 0;
let checks = 0;
function record(ok: boolean, label: string, detail: string): void {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}\n     ${detail}`);
}

interface Feature {
  startup(): void;
  check: { name: string; run(): void | Promise<void> };
}

/** A copy of `source` (relative to src/) with `mutate` applied, imported; its exported feature. */
let serial = 0;
async function load(
  source: string,
  exportName: string,
  mutate: (text: string) => string,
): Promise<Feature | ((...a: unknown[]) => unknown)> {
  const path = join(ROOT, "src", source);
  const original = readFileSync(path, "utf8");
  const absolute = original.replace(
    /from "(\.{1,2}\/[^"]+)"/gu,
    (_m, specifier: string) => `from "${resolve(dirname(path), specifier)}"`,
  );
  const mutated = mutate(absolute);
  serial += 1;
  const target = join(MUTANTS, `${serial}-${source.replaceAll("/", "_")}`);
  writeFileSync(target, mutated);
  const module = (await import(pathToFileURL(target).href)) as Record<string, unknown>;
  return module[exportName] as Feature;
}

async function outcome(feature: Feature): Promise<{ startup: string; full: string }> {
  let startup = "passed";
  let full = "passed";
  try {
    feature.startup();
  } catch (error) {
    startup = `threw: ${(error as Error).message}`;
  }
  try {
    await feature.check.run();
  } catch (error) {
    full = `threw: ${(error as Error).message}`;
  }
  return { startup, full };
}

/** Replaces exactly one occurrence of `from` in `text`; refuses when it is not there exactly once. */
function once(text: string, from: string, to: string): string {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`probe: ${JSON.stringify(from)} occurs ${count} times`);
  return text.replace(from, to);
}

interface Vector {
  readonly block: string;
  readonly coin: string;
  readonly path: string;
  readonly address: string;
}
function vectorsOf(text: string): Vector[] {
  return [
    ...text.matchAll(
      /\{\s*coin: (\w+),\s*passphrase: [^,]+,\s*path: "([^"]+)",\s*address:\s*"([^"]+)",?\s*\}/gu,
    ),
  ].map((m) => ({ block: m[0], coin: m[1]!, path: m[2]!, address: m[3]! }));
}

const FAMILIES = [
  ["core/coins/bitcoin-like-self-test.ts", "BITCOIN_LIKE_ADDRESS_SELF_TEST"],
  ["core/coins/bitcoin-cash-self-test.ts", "BITCOIN_CASH_ADDRESS_SELF_TEST"],
  ["core/coins/cosmos-self-test.ts", "COSMOS_ADDRESS_SELF_TEST"],
  ["core/coins/dash-self-test.ts", "DASH_ADDRESS_SELF_TEST"],
  ["core/coins/evm-self-test.ts", "EVM_ADDRESS_SELF_TEST"],
  ["core/coins/xrp-self-test.ts", "XRP_ADDRESS_SELF_TEST"],
] as const;

for (const [source, name] of FAMILIES) {
  console.log(`\n== ${source} ==`);
  const text = readFileSync(join(ROOT, "src", source), "utf8");
  const vectors = vectorsOf(text);
  const startupPlace = Number(/startup: \[(\d+)\]/u.exec(text)![1]);
  const startupVector = vectors[startupPlace]!;
  // Another address of the same coin, at another path: a valid address the wallet has elsewhere.
  const other = vectors.find(
    (v) =>
      v.coin === startupVector.coin &&
      v.address !== startupVector.address &&
      v.path !== startupVector.path,
  )!;
  // A vector that only the full self-test compares: not the startup one, not the one given at
  // another place, not the scanned one. XRP has none: both of its vectors serve the startup.
  const used = new Set(
    [/startup: \[(\d+)\]/u, /elsewhere: (\d+)/u, /scanned: (\d+)/u].map((pattern) =>
      Number(pattern.exec(text)?.[1] ?? -1),
    ),
  );
  const fullOnly = vectors.findIndex((_v, i) => !used.has(i));
  const fullVector = vectors[fullOnly];

  const control = await outcome((await load(source, name, (t) => t)) as Feature);
  record(
    control.startup === "passed" && control.full === "passed",
    "control copy passes",
    JSON.stringify(control),
  );

  const swapStartup = await outcome(
    (await load(source, name, (t) =>
      once(
        t,
        startupVector.block,
        startupVector.block.replace(startupVector.address, other.address),
      ),
    )) as Feature,
  );
  record(
    /mismatch/u.test(swapStartup.startup) && /mismatch/u.test(swapStartup.full),
    `startup vector ${startupVector.path} expects ${other.address} (another path's address): startup and full fail`,
    JSON.stringify(swapStartup),
  );

  const swapPath = await outcome(
    (await load(source, name, (t) =>
      once(
        t,
        startupVector.block,
        startupVector.block.replace(
          `path: "${startupVector.path}"`,
          `path: "${startupVector.path.replace(/\/(\d+)$/u, (_m, i: string) => `/${Number(i) + 1}`)}"`,
        ),
      ),
    )) as Feature,
  );
  record(
    /mismatch/u.test(swapPath.startup),
    `startup vector's path index + 1: startup fails`,
    JSON.stringify(swapPath),
  );

  if (fullVector === undefined)
    console.log("     (no vector is compared by the full self-test alone)");
  else {
    const movedPath = fullVector.path.replace(/\/(\d+)$/u, (_m, i: string) => `/${Number(i) + 1}`);
    const swapFull = await outcome(
      (await load(source, name, (t) =>
        once(
          t,
          fullVector.block,
          fullVector.block.replace(`path: "${fullVector.path}"`, `path: "${movedPath}"`),
        ),
      )) as Feature,
    );
    record(
      swapFull.startup === "passed" && /mismatch/u.test(swapFull.full),
      `full-only vector ${fullVector.address} expected at ${movedPath} instead of ${fullVector.path}: startup passes, full fails`,
      JSON.stringify(swapFull),
    );
  }

  const elsewhere = await outcome(
    (await load(source, name, (t) => t.replace(/elsewhere: \d+/u, "elsewhere: 0"))) as Feature,
  );
  record(
    /another place mismatch/u.test(elsewhere.startup),
    "elsewhere points at the first address: startup fails",
    JSON.stringify(elsewhere),
  );

  if (/scanned: \d+/u.test(text)) {
    const scanned = await outcome(
      (await load(source, name, (t) => t.replace(/scanned: \d+/u, "scanned: 0"))) as Feature,
    );
    record(
      /first address mismatch/u.test(scanned.startup),
      "scanned points at index 0: startup fails ('first address')",
      JSON.stringify(scanned),
    );
  }

  const refusal = /\{\s*coin: (\w+),\s*address: "([^"]+)",\s*because: [^}]+\}/u.exec(text)!;
  const valid = vectors.find((v) => v.coin === refusal[1])!;
  const accepted = await outcome(
    (await load(source, name, (t) =>
      once(t, refusal[0], refusal[0].replace(refusal[2]!, valid.address)),
    )) as Feature,
  );
  record(
    accepted.startup === "passed" && /was accepted/u.test(accepted.full),
    `refused address replaced by the valid ${valid.address}: full fails`,
    JSON.stringify(accepted),
  );
  const reason = await outcome(
    (await load(source, name, (t) =>
      once(
        t,
        refusal[0],
        refusal[0].replace(/because: \/[^/]+\/u/u, "because: /a reason never given/u"),
      ),
    )) as Feature,
  );
  record(
    /refused for another reason/u.test(reason.full),
    "refusal reason altered: full fails",
    JSON.stringify(reason),
  );
}

console.log("\n== core/wallet-evidence-self-test.ts ==");
{
  const source = "core/wallet-evidence-self-test.ts";
  const name = "WALLET_EVIDENCE_SELF_TEST";
  const control = await outcome((await load(source, name, (t) => t)) as Feature);
  record(
    control.startup === "passed" && control.full === "passed",
    "control copy passes",
    JSON.stringify(control),
  );
  for (const [from, to, label] of [
    [
      'fingerprint: "73c5da0a"',
      'fingerprint: "73c5da0b"',
      "master fingerprint 73c5da0a -> 73c5da0b",
    ],
    [
      'address84: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu"',
      'address84: "bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el"',
      "BIP84 first address -> first change address",
    ],
    [
      'address86: "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr"',
      'address86: "bc1p3qkhfews2uk44qtvauqyr2ttdsw7svhkl9nkm9s9c3x4ax5h60wqwruhk7"',
      "BIP86 first address -> first change address",
    ],
  ] as const) {
    const mutant = await outcome((await load(source, name, (t) => once(t, from, to))) as Feature);
    record(
      mutant.startup !== "passed" || mutant.full !== "passed",
      `${label}: a check fails`,
      JSON.stringify(mutant),
    );
  }
}

console.log("\n== core/master-fingerprint-self-test.ts ==");
{
  const source = "core/master-fingerprint-self-test.ts";
  const control = (await load(source, "checkMasterFingerprintStartup", (t) => t)) as () => void;
  let result = "passed";
  try {
    control();
  } catch (error) {
    result = `threw: ${(error as Error).message}`;
  }
  record(result === "passed", "control copy passes", result);
  const mutant = (await load(source, "checkMasterFingerprintStartup", (t) =>
    once(t, 'TREZOR_FINGERPRINT = "b4e3f5ed"', 'TREZOR_FINGERPRINT = "b4e3f5ee"'),
  )) as () => void;
  result = "passed";
  try {
    mutant();
  } catch (error) {
    result = `threw: ${(error as Error).message}`;
  }
  record(
    /mismatch/u.test(result),
    "TREZOR fingerprint b4e3f5ed -> b4e3f5ee: startup fails",
    result,
  );
}

console.log("\n== The composed coin check and the command line's startup gate ==");
{
  // The command line configures the Node.js render platform before its startup checks, which
  // include the share cards' (src/index.ts, src/cli/heir-sheet.ts import it).
  await import("../../../src/export/platform-node.js");
  const { COIN_ADDRESS_SELF_TEST } = await import("../../../src/core/coins-self-test.js");
  const { assertCoreSelfTest } = await import("../../../src/cli/self-test.js");
  const { CoinAddress } = await import("../../../src/core/coins/coin.js");
  const run = (f: () => void): string => {
    try {
      f();
      return "passed";
    } catch (error) {
      return `threw: ${(error as Error).message.replaceAll("\n", " | ")}`;
    }
  };
  const plainComposed = run(() => COIN_ADDRESS_SELF_TEST.startup());
  record(
    plainComposed === "passed",
    "COIN_ADDRESS_SELF_TEST.startup passes unchanged",
    plainComposed,
  );
  const plainGate = run(() => assertCoreSelfTest());
  record(plainGate === "passed", "assertCoreSelfTest passes unchanged", plainGate);
  const isAddressOf = CoinAddress.prototype.isAddressOf;
  for (const [label, replacement] of [
    ["isAddressOf always false", () => false],
    ["isAddressOf always true", () => true],
  ] as const) {
    CoinAddress.prototype.isAddressOf = replacement;
    const composed = run(() => COIN_ADDRESS_SELF_TEST.startup());
    const gate = run(() => assertCoreSelfTest());
    CoinAddress.prototype.isAddressOf = isAddressOf;
    record(/mismatch/u.test(composed), `${label}: COIN_ADDRESS_SELF_TEST.startup fails`, composed);
    record(
      /CRITICAL: MnemoCode core self-test failed/u.test(gate),
      `${label}: assertCoreSelfTest stops the command`,
      gate,
    );
  }
}

console.log(`\n${checks} checks, ${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;

// AUD-010 "shares": SSKR split and restore at the smallest and largest settings, for every secret
// width, with shares written in each of the six forms. Entries: splitSskrMnemonic
// (src/sskr/shares.ts), Share.write and ShareSet.restore (src/sskr/transport.ts, share-set.ts),
// ShareSplit.validateThreshold (src/sskr/split.ts) and the command line `sskr-split`. Oracle: the
// phrases are made from zero and counting entropy by @scure/bip39, not by MnemoCode; a restore must
// give exactly that phrase back. A set one share short of the threshold must be refused. Public
// data only.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-split-bounds.ts

import { spawnSync } from "node:child_process";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { splitSskrMnemonic } from "../../../src/sskr/shares.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSet } from "../../../src/sskr/share-set.ts";
import { ShareSplit } from "../../../src/sskr/split.ts";
import { Share, shareInfo, urToTransport } from "../../../src/sskr/transport.ts";

const FORMS = ["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const;
const SETTINGS = [
  [2, 2],
  [2, 16],
  [16, 16],
] as const;

let failures = 0;
let checks = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  checks += 1;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"}: ${name}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`,
  );
}
async function restore(records: readonly string[]): Promise<string> {
  try {
    return (await ShareSet.restore(records, nodeSharePlatform)).mnemonic;
  } catch (error) {
    return `refused: ${(error as Error).message}`;
  }
}

for (const bytes of [16, 20, 24, 28, 32]) {
  for (const [name, entropy] of [
    ["zero", new Uint8Array(bytes)],
    ["counting", Uint8Array.from({ length: bytes }, (_, index) => index)],
  ] as const) {
    const phrase = entropyToMnemonic(entropy, wordlist);
    const words = phrase.split(" ").length;
    for (const [threshold, count] of SETTINGS) {
      const shares = await splitSskrMnemonic(phrase, threshold, count);
      const label = `${words} words, ${name} entropy, ${threshold} of ${count}`;
      const infos = shares.map((ur) => shareInfo(urToTransport(ur)));
      check(
        `${label}: metadata of every share (thresholds, groups, members 1..${count})`,
        infos.map((info) => [info.groupThreshold, info.groupCount, info.memberThreshold, info.memberIndex + 1, info.secretLength]),
        Array.from({ length: count }, (_, member) => [1, 1, threshold, member + 1, bytes]),
      );
      // The last `threshold` members, each written in another form and read back.
      const chosen = shares.slice(count - threshold);
      const written = chosen.map((ur, index) => Share.read(ur).write(FORMS[index % FORMS.length]));
      check(`${label}: the last ${threshold} members, in mixed forms, restore the phrase`, await restore(written) === phrase, true);
      // Every form on its own, for the first `threshold` members.
      for (const form of FORMS) {
        const texts = shares.slice(0, threshold).map((ur) => Share.read(ur).write(form));
        check(`${label}: the first ${threshold} members in ${form} restore the phrase`, await restore(texts) === phrase, true);
      }
      const short = await restore(shares.slice(0, threshold - 1));
      check(`${label}: ${threshold - 1} share(s) are refused`, short.startsWith("refused"), true);
    }
  }
}

// The bounds of a split.
for (const [threshold, count, accepted] of [
  [2, 2, true],
  [16, 16, true],
  [1, 1, false],
  [1, 3, false],
  [3, 2, false],
  [2, 17, false],
  [17, 17, false],
  [0, 0, false],
  [2.5, 3, false],
] as const) {
  let outcome: string;
  try {
    ShareSplit.validateThreshold(threshold, count);
    outcome = "accepted";
  } catch (error) {
    outcome = (error as Error).message;
  }
  check(
    `validateThreshold(${threshold}, ${count})`,
    accepted ? outcome : outcome !== "accepted",
    accepted ? "accepted" : true,
  );
}
const PHRASE = `${"abandon ".repeat(11)}about`;
for (const [threshold, count] of [
  ["1", "3"],
  ["2", "17"],
]) {
  const run = spawnSync(
    "node",
    ["--import", "tsx", "src/mnemocode.ts", "sskr-split", "--mnemonic", PHRASE, "--threshold", threshold, "--shares", count],
    { env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"] },
  );
  check(`sskr-split --threshold ${threshold} --shares ${count}: refused before any share is printed`, [run.status, run.stdout.toString().includes("ur:sskr/")], [1, false]);
  console.log(`  stderr: ${JSON.stringify(run.stderr.toString().trim())}`);
}

console.log(`Split bound checks: ${checks - failures} passed, ${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;

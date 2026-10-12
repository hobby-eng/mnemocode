// AUD-010 "shares": SSKR restore through the production entries, against the published
// BCR-2020-011 vector (its entropy turned into the phrase by @scure/bip39, not by MnemoCode):
// thresholds and groups (validQuorums, invalidQuorums), copies and duplicate members, shares of
// two sets mixed, and the surplus check (a synthetic share with a valid checksum but another
// value, given beyond the threshold, must be refused by its place). Entries: ShareSet.restore
// (src/sskr/share-set.ts), ShareInput.restoreComplete (src/sskr/share-input.ts), and the command
// line, `sskr-combine --share ... --share-qr ...` (src/mnemocode.ts), whose QR images are written by
// exportQrPayload. Public data only.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-restore.ts

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { crc32 } from "node:zlib";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { exportQrPayload } from "../../../src/cli/qr-export.ts";
import { ShareInput } from "../../../src/sskr/share-input.ts";
import { nodeSharePlatform } from "../../../src/sskr/share-platform-node.ts";
import { ShareSet } from "../../../src/sskr/share-set.ts";
import { readShare, Share, writeShare } from "../../../src/sskr/transport.ts";
import { BYTEWORDS, urBytes } from "./shares-oracle.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../vectors/sskr-v1.json", import.meta.url), "utf8"),
);
const official = vectors.official as {
  entropy: string;
  shares: string[];
  validQuorums: number[][];
  invalidQuorums: number[][];
};
const EXPECTED = entropyToMnemonic(Buffer.from(official.entropy, "hex"), wordlist);
const OUT = fileURLToPath(
  new URL("../../../../tmp/mnemocode/aud010/shares/restore", import.meta.url),
);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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
async function restored(records: readonly string[]): Promise<string> {
  try {
    const set = await ShareSet.restore(records, nodeSharePlatform);
    return set.mnemonic === EXPECTED ? "the published secret" : "ANOTHER PHRASE";
  } catch (error) {
    return `refused: ${(error as Error).message}`;
  }
}

/**
 * A synthetic share: `ur` with byte `at` of its secret changed, the CRC-32 computed again, so that
 * it reads as a share of the same set and member with another value.
 */
function altered(ur: string, at = 8): string {
  const { cbor } = urBytes(ur);
  const changed = [...cbor];
  changed[changed.length - 1 - at] ^= 0x5a;
  const checksum = crc32(Uint8Array.from(changed)) >>> 0;
  const bytes = [...changed, ...[24, 16, 8, 0].map((shift) => (checksum >>> shift) & 0xff)];
  return `ur:sskr/${bytes.map((byte) => BYTEWORDS[byte]![0]! + BYTEWORDS[byte]![3]!).join("")}`;
}

// Thresholds and groups, as published.
for (const quorum of official.validQuorums)
  check(
    `published valid quorum ${JSON.stringify(quorum)}`,
    await restored(quorum.map((index) => official.shares[index]!)),
    "the published secret",
  );
for (const quorum of official.invalidQuorums) {
  const outcome = await restored(quorum.map((index) => official.shares[index]!));
  check(
    `published invalid quorum ${JSON.stringify(quorum)} is refused`,
    outcome.startsWith("refused"),
    true,
  );
  console.log(`  ${outcome}`);
}
check(
  "all eight published shares (surplus members and groups)",
  await restored(official.shares),
  "the published secret",
);

// Every subset of the eight published shares: restored exactly when group 1 has 2 of its 3
// members and group 2 has 3 of its 5 (BCR-2020-011: group threshold 2, groups 2-of-3 and 3-of-5).
{
  let restoredCount = 0;
  let refusedCount = 0;
  const wrongOutcomes: string[] = [];
  for (let mask = 1; mask < 256; mask++) {
    const indexes = [...Array(8).keys()].filter((index) => (mask >> index) & 1);
    const first = indexes.filter((index) => index < 3).length;
    const second = indexes.filter((index) => index >= 3).length;
    const valid = first >= 2 && second >= 3;
    const outcome = await restored(indexes.map((index) => official.shares[index]!));
    if (valid ? outcome !== "the published secret" : !outcome.startsWith("refused"))
      wrongOutcomes.push(`${JSON.stringify(indexes)}: ${outcome}`);
    if (outcome === "the published secret") restoredCount += 1;
    else refusedCount += 1;
  }
  check(
    "all 255 non-empty subsets of the published shares: restored and refused as the thresholds say",
    wrongOutcomes,
    [],
  );
  check("subsets restored / refused", [restoredCount, refusedCount], [4 * 16, 255 - 64]);
}

// Each secret width: the recorded 2-of-3 fixtures of 16 to 32 bytes restore their entropy, as
// @scure/bip39 turns it into a phrase.
for (const fixture of vectors.deterministic as {
  name: string;
  entropy: string;
  shares: string[];
}[]) {
  const phrase = entropyToMnemonic(Buffer.from(fixture.entropy, "hex"), wordlist);
  for (const pair of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    const set = await ShareSet.restore(
      pair.map((index) => fixture.shares[index]!),
      nodeSharePlatform,
    );
    check(
      `${fixture.name} shares ${JSON.stringify(pair)} restore the fixture entropy`,
      set.mnemonic === phrase,
      true,
    );
  }
}

// Transport: published Bytewords read back as the published URs; the legacy CBOR tag 309 read as
// well; a truncated or altered UR refused.
{
  const words = vectors.official.bytewords as string[];
  const read = words.map((text) => readShare(text).ur);
  check(
    "published Bytewords read as published shares",
    read.every((ur) => official.shares.includes(ur)),
    true,
  );
  const { cbor } = urBytes(official.shares[0]!);
  const legacy = [0xd9, 0x01, 0x35, ...cbor];
  const legacyChecksum = crc32(Uint8Array.from(legacy)) >>> 0;
  const legacyWords = [
    ...legacy,
    ...[24, 16, 8, 0].map((shift) => (legacyChecksum >>> shift) & 0xff),
  ]
    .map((byte) => BYTEWORDS[byte]!)
    .join(" ");
  check(
    "Bytewords with the legacy tag 309 read as the same share",
    readShare(legacyWords).ur,
    official.shares[0],
  );
  const truncated = official.shares[0]!.slice(0, -2);
  check("a UR without its last pair is refused", Share.reads(truncated), false);
  const flipped =
    official.shares[0]!.slice(0, 20) +
    (official.shares[0]![20] === "a" ? "e" : "a") +
    official.shares[0]!.slice(21);
  check("a UR with one letter changed is refused", Share.reads(flipped), false);
}

// The surplus check: a wrong share beyond the threshold, with a valid checksum.
const wrong = altered(official.shares[2]!);
const surplus = [
  official.shares[0]!,
  official.shares[1]!,
  wrong,
  official.shares[3]!,
  official.shares[4]!,
  official.shares[5]!,
];
check(
  "a wrong third member of group 1 (surplus) is named by its place",
  await restored(surplus),
  "refused: Share 3 does not fit with the others: with it they give another secret or none. Leave it out, or check it.",
);
const wrongGroup = altered(official.shares[7]!);
check(
  "a wrong member of a surplus group is refused",
  (
    await restored([
      official.shares[0]!,
      official.shares[1]!,
      official.shares[3]!,
      official.shares[4]!,
      official.shares[5]!,
      official.shares[6]!,
      wrongGroup,
    ])
  ).startsWith("refused"),
  true,
);
// A wrong share placed first, within the threshold, is not trusted: ShareSet refuses the set, and
// ShareInput (the command line's entry) names the share without which the others restore.
const wrongFirst = [
  altered(official.shares[0]!),
  official.shares[1]!,
  official.shares[2]!,
  official.shares[3]!,
  official.shares[4]!,
  official.shares[5]!,
];
const wrongFirstOutcome = await restored(wrongFirst);
check(
  "a wrong first share within the threshold: ShareSet refuses",
  wrongFirstOutcome.startsWith("refused"),
  true,
);
console.log(`  ${wrongFirstOutcome}`);

// Copies, duplicates and mixed sets, through ShareInput as the command line uses it.
async function viaInput(texts: readonly string[]): Promise<unknown> {
  const input = new ShareInput({ decodeEntry: "Decode" });
  input.add(texts);
  const { outcome, copies } = await input.restoreComplete(nodeSharePlatform);
  return {
    outcome:
      outcome.kind === "complete"
        ? outcome.set.mnemonic === EXPECTED
          ? "the published secret"
          : "ANOTHER PHRASE"
        : outcome.trouble,
    copies: copies.map((copy) => copy.message),
    places: input.places(),
  };
}
const [s0, s1, s3, s5, s7] = [0, 1, 3, 5, 7].map((index) => official.shares[index]!);
check(
  "a copy of a share in another form is used once",
  await viaInput([s0!, writeShare(s0!, "indexes"), s1!, s3!, s5!, s7!]),
  {
    outcome: "the published secret",
    copies: ["Share 2 is a copy of share 1: it is used once."],
    places: [1, 3, 4, 5, 6],
  },
);
check(
  "a copy does not make up the threshold",
  await viaInput([s0!, writeShare(s0!, "words"), s3!, s5!, s7!]),
  {
    outcome: {
      kind: "few",
      message:
        "These shares are not enough: this set needs 2 of its 2 groups, each with as many shares as its threshold.",
    },
    copies: ["Share 2 is a copy of share 1: it is used once."],
    places: [1, 3, 4, 5],
  },
);
check(
  "the same member with another value is refused as undecided",
  ((await viaInput([s0!, altered(s0!), s1!, s3!, s5!, s7!])) as { outcome: unknown }).outcome,
  {
    kind: "refused",
    message:
      "Shares 1 and 2 are the same member of the set but differ, and nothing tells which is right.",
  },
);
check(
  "a wrong first share within the threshold: ShareInput names it",
  ((await viaInput(wrongFirst)) as { outcome: unknown }).outcome,
  {
    kind: "odd",
    place: 1,
    message: "Share 1 does not fit with the others: with it they give another phrase or none.",
  },
);
const otherSet = (vectors.deterministic as { shares: string[] }[])[0]!.shares[0]!;
check(
  "a share of another set is named alone",
  ((await viaInput([s0!, s1!, otherSet, s3!, s5!, s7!])) as { outcome: unknown }).outcome,
  { kind: "odd", place: 3, message: "Share 3 is of another set than share 1." },
);

// The command line: --share and --share-qr, the same QR image twice.
const cli = (args: readonly string[]): { status: number; stdout: string; stderr: string } => {
  const run = spawnSync("node", ["--import", "tsx", "src/mnemocode.ts", "sskr-combine", ...args], {
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: run.status ?? -1, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
};
const group1 = [official.shares[0]!, official.shares[1]!];
const group2 = [official.shares[3]!, official.shares[4]!, official.shares[5]!];
const qr = (name: string) => join(OUT, `${name}.png`);
await exportQrPayload(writeShare(group1[0]!, "indexes"), qr("g1m1"));
await exportQrPayload(writeShare(group1[1]!, "unicode"), qr("g1m2"));
const quorum = cli([
  "--share-qr",
  qr("g1m1"),
  "--share-qr",
  qr("g1m2"),
  ...group2.flatMap((share) => ["--share", share]),
]);
check("sskr-combine with two QR images and three shares: exit status", quorum.status, 0);
check(
  "sskr-combine prints the published phrase",
  quorum.stdout.split("\n").includes(EXPECTED),
  true,
);
const twice = cli([
  "--share-qr",
  qr("g1m1"),
  "--share-qr",
  qr("g1m1"),
  ...group2.flatMap((share) => ["--share", share]),
]);
check("the same QR image twice does not make up a group: exit status", twice.status, 1);
check("the phrase is not printed", twice.stdout.split("\n").includes(EXPECTED), false);
console.log(`  stderr: ${JSON.stringify(twice.stderr.trim().split("\n").slice(-3))}`);
const surplusCopy = cli([
  "--share-qr",
  qr("g1m1"),
  "--share-qr",
  qr("g1m1"),
  "--share-qr",
  qr("g1m2"),
  ...group2.flatMap((share) => ["--share", share]),
]);
check("a QR copy beside a quorum: exit status", surplusCopy.status, 0);
check(
  "a QR copy beside a quorum: the phrase",
  surplusCopy.stdout.split("\n").includes(EXPECTED),
  true,
);
check(
  "a QR copy beside a quorum: the copy is named",
  surplusCopy.stderr.split("\n").filter((line) => line.includes("is a copy of share")),
  // --share values come before --share-qr images: places 1-3 are typed, 4-6 the images.
  ["Share 5 is a copy of share 4: it is used once."],
);

console.log(`Restore checks: ${checks - failures} passed, ${failures} failed.`);
process.exitCode = failures === 0 ? 0 : 1;

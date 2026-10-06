/** AUD-008-FUN001/API006 remediation recheck; public vectors and fixed synthetic bytes only. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { combineSskrShares, restoreShareSet } from "../../../dist/sskr/shares.js";
import { planJointRepair } from "../../../dist/sskr/joint-repair.js";
import { readRepairableShare } from "../../../dist/sskr/repair.js";
import { bytewords } from "../../../dist/sskr/bytewords-list.js";
import { normalizeShare, urToTransport, writeShare } from "../../../dist/sskr/transport.js";
import { sskrEngine } from "../../../dist/sskr/runtime.js";
import { checkShareBackup } from "../../../dist/cli/backup-check.js";

const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8"));
const CHECKSUM_BYTES = 4;
const BYTE_BITS = 8;
const SHORT_CBOR_LIMIT = 24;
const SHARE_METADATA_BYTES = 5;
const UR_PREFIX = "ur:sskr/";
const fixture = vectors.deterministic[0];
const phraseOf = (vector) => entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
const expected = phraseOf(fixture);
let passed = 0;
let failed = 0;
const counts = {
  standaloneRepairs: 0,
  jointRepairs: 0,
  rejectedNoncanonicalJointSets: 0,
  alteredCompleteSets: 0,
};

// IEEE CRC32, independent of production checksum.js, followed by the big-endian checksum bytes.
function withCrc(body) {
  let value = 0xffffffff;
  for (const byte of body) {
    value ^= byte;
    for (let bit = 0; bit < BYTE_BITS; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  const bytes = new Uint8Array(body.length + CHECKSUM_BYTES);
  bytes.set(body);
  new DataView(bytes.buffer).setUint32(body.length, (value ^ 0xffffffff) >>> 0);
  return bytes;
}

// Construct the textual UR directly: transportToUr would strip tags and invalidate this probe.
const minimal = (bytes) =>
  UR_PREFIX + Array.from(bytes, (byte) => bytewords[byte][0] + bytewords[byte][3]).join("");
const full = (bytes) => Array.from(bytes, (byte) => bytewords[byte]).join(" ");
function mark(text, format, positions) {
  const units = format === "ur" ? text.slice(UR_PREFIX.length).match(/../gu) : text.split(" ");
  for (const position of positions) units[position] = "?";
  return format === "ur" ? UR_PREFIX + units.join("") : units.join(" ");
}
function altered(share) {
  const body = urToTransport(share).slice(0, -CHECKSUM_BYTES);
  const headerLength = body[0] === 0x58 ? 2 : 1;
  // Alter the fourth share-value byte, preserving metadata and recomputing only the unkeyed CRC.
  body[headerLength + SHARE_METADATA_BYTES + 3] ^= 1;
  return minimal(withCrc(body));
}
async function check(name, work) {
  try {
    await work();
    passed += 1;
    console.log(JSON.stringify({ name, outcome: "passed" }));
  } catch (error) {
    failed += 1;
    console.log(JSON.stringify({ name, outcome: "failed", error: String(error) }));
  }
}
function permutations(items) {
  return items.length === 0
    ? [[]]
    : items.flatMap((item, index) =>
        permutations(items.filter((_, other) => other !== index)).map((rest) => [item, ...rest]),
      );
}

await check("FUN001-altered-each-member-every-order-and-surviving-pairs", async () => {
  for (let wrong = 0; wrong < fixture.shares.length; wrong += 1) {
    const set = fixture.shares.map((share, index) => (index === wrong ? altered(share) : share));
    for (const order of permutations(set)) {
      await assert.rejects(() => combineSskrShares(order), /does not fit|do not restore/u);
      counts.alteredCompleteSets += 1;
    }
    for (const [left, right] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      const pair = [set[left], set[right]];
      if (left === wrong || right === wrong) {
        await assert.rejects(() => combineSskrShares(pair));
        await assert.rejects(() => combineSskrShares(pair.reverse()));
      } else assert.equal(await combineSskrShares(pair), expected);
    }
    assert.equal(await checkShareBackup(expected, set.join(";"), "direct", ""), "unreadable");
  }
  assert.equal(await combineSskrShares(fixture.shares), expected);
});

const engine = await sskrEngine();
const grouped = new Map();
for (const groupThreshold of [1, 2]) {
  const secret = Buffer.from(fixture.entropy, "hex");
  const seed = new Uint8Array(32).fill(7);
  try {
    grouped.set(
      groupThreshold,
      engine
        .create_sskr_shares(secret, groupThreshold, Uint8Array.of(2, 3, 2, 3, 2, 3), seed)
        .trim()
        .split("\n"),
    );
  } finally {
    secret.fill(0);
    seed.fill(0);
  }
}
for (const [groupThreshold, shares] of grouped) {
  await check(`FUN001-surplus-groups-threshold-${groupThreshold}`, async () => {
    assert.equal(await combineSskrShares(shares), expected);
    for (let wrong = 0; wrong < shares.length; wrong += 1) {
      const set = shares.map((share, index) => (index === wrong ? altered(share) : share));
      for (const order of [set, [...set].reverse(), [...set.slice(3), ...set.slice(0, 3)]]) {
        await assert.rejects(
          () => combineSskrShares(order),
          /does not fit|do not fit|do not restore/u,
        );
        counts.alteredCompleteSets += 1;
      }
    }
  });
}

const incompleteShares = grouped.get(1);
const incomplete = [
  incompleteShares[0],
  incompleteShares[1],
  altered(incompleteShares[3]),
  altered(incompleteShares[6]),
];
await check("FUN001-incomplete-groups-have-exact-one-based-unchecked-indexes", async () => {
  for (const [records, unchecked] of [
    [incomplete, [3, 4]],
    [
      [incomplete[2], incomplete[0], incomplete[1], incomplete[3]],
      [1, 4],
    ],
  ]) {
    const restored = await restoreShareSet(records);
    assert.equal(restored.mnemonic, expected);
    assert.deepEqual(restored.unchecked, unchecked);
  }
});
await check("FUN001-complete-cli-warns-about-incomplete-group-members", () => {
  const command = ["dist/mnemocode.js", "sskr-combine"];
  for (const share of incomplete) command.push("--share", share);
  const child = spawnSync(process.execPath, command, {
    encoding: "utf8",
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: "1" },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stderr, /Share 3, 4:.*not checked/u);
});
await check("FUN001-backup-check-must-not-silently-validate-unchecked-members", async () => {
  const result = await checkShareBackup(expected, incomplete.join(";"), "direct", "");
  console.log(
    JSON.stringify({
      observation: "incomplete-group-caller-contract",
      restoreShareSetUnchecked: [3, 4],
      combineReturnsOnlyMnemonic: (await combineSskrShares(incomplete)) === expected,
      backupResult: result,
    }),
  );
  // The original acceptance requires rejected inconsistent sets or disclosure of unchecked shares.
  assert.notEqual(result, "restores", "Backup check gives no unchecked-member disclosure.");
});

const tags = [
  ["untagged", []],
  ["current-tag40309", [0xd9, 0x9d, 0x75]],
  ["legacy-tag309", [0xd9, 0x01, 0x35]],
];
for (const vector of vectors.deterministic) {
  const canonical = urToTransport(vector.shares[0]).slice(0, -CHECKSUM_BYTES);
  const payload = canonical.slice(canonical[0] === 0x58 ? 2 : 1);
  const headers = [["wide", [0x58, payload.length]]];
  if (payload.length < SHORT_CBOR_LIMIT) headers.push(["short", [0x40 + payload.length]]);
  for (const [headerName, header] of headers)
    for (const [tagName, tag] of tags)
      for (const format of ["ur", "words"]) {
        const transport = withCrc(Uint8Array.from([...tag, ...header, ...payload]));
        const text = format === "ur" ? minimal(transport) : full(transport);
        const normalized = normalizeShare(text);
        const unitCount = transport.length;
        const name = `API006-${vector.entropy.length / 2}bytes-${headerName}-${tagName}-${format}`;
        await check(name, async () => {
          // The transport reader accepts a wide header for payload length 21, but the unchanged
          // dCBOR decoder rejects it as noncanonical before both intact and joint recovery.
          const noncanonical = headerName === "wide" && payload.length < SHORT_CBOR_LIMIT;
          if (noncanonical) {
            assert.throws(
              () => engine.recover_sskr_shares([normalized, vector.shares[1]].join("\n")),
              /non-canonical/iu,
            );
            await assert.rejects(() => combineSskrShares([text, vector.shares[1]]));
            console.log(
              JSON.stringify({
                observation: name,
                transportReaderAccepted: true,
                intactEngineRejected: "noncanonical CBOR header",
                classification: "existing decoder limit, outside repair-only finding",
              }),
            );
          } else {
            assert.equal(await combineSskrShares([text, vector.shares[1]]), phraseOf(vector));
          }
          for (const position of [0, Math.floor(unitCount / 2), unitCount - 1]) {
            const repaired = readRepairableShare(mark(text, format, [position]));
            assert.equal(repaired.ur, normalized);
            assert.equal(repaired.format, format);
            assert.equal(repaired.repaired, true);
            assert.equal(repaired.filled[0].position, position + 1);
            counts.standaloneRepairs += 1;
          }
          const markedCompat = mark(text, format, [Math.floor(unitCount / 2)]);
          const markedCurrent = mark(vector.shares[1], "ur", [12]);
          for (const records of [
            [markedCompat, vector.shares[1]],
            [vector.shares[1], markedCompat],
            [text, markedCurrent],
            [markedCurrent, text],
          ]) {
            const plan = await planJointRepair(records);
            assert.equal(plan.assessment.reason, undefined);
            const found = await plan.search();
            if (noncanonical) {
              assert.deepEqual(found, []);
              counts.rejectedNoncanonicalJointSets += 1;
            } else {
              assert.deepEqual(
                found.map((set) => set.mnemonic),
                [phraseOf(vector)],
              );
              counts.jointRepairs += 1;
            }
          }
        });
      }
}

await check("nearby-cancellation-preaborted-assessment-and-short-search", async () => {
  const stop = new AbortController();
  const reason = new Error("public-fixture-recheck-stop");
  stop.abort(reason);
  const records = [fixture.shares[0], mark(fixture.shares[1], "ur", [12])];
  await assert.rejects(
    () => planJointRepair(records, { signal: stop.signal }),
    (error) => error === reason,
  );
  const plan = await planJointRepair(records);
  await assert.rejects(
    () => plan.search({ signal: stop.signal }),
    (error) => error === reason,
  );
});
await check("nearby-cancellation-search-progress-checkpoint", async () => {
  const colors = writeShare(fixture.shares[1], "colors").split(" ");
  colors[5] = "?";
  colors[7] = "?";
  const plan = await planJointRepair([fixture.shares[0], colors.join(" ")]);
  assert.equal(plan.assessment.verdict, "search");
  const stop = new AbortController();
  const reason = new Error("public-fixture-recheck-stop-progress");
  await assert.rejects(
    () => plan.search({ signal: stop.signal, onProgress: () => stop.abort(reason) }),
    (error) => error === reason,
  );
});

console.log(JSON.stringify({ passed, failed, counts, scope: "AUD-008-FUN001/API006 only" }));
process.exitCode = failed === 0 ? 0 : 1;

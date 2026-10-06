/** AUD-008 baseline: literal official transport, all small quorums and bounded repair probes. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";
import {
  combineSskrShares,
  planShareRepair,
  splitSskrMnemonic,
  validateThreshold,
} from "../../../dist/sskr/shares.js";
import {
  readShare,
  writeShare,
  urToTransport,
  shareToColors,
  normalizeShare,
  validateShareSet,
} from "../../../dist/sskr/transport.js";
import { readRepairableShare, ShareVariantsError } from "../../../dist/sskr/repair.js";
import { gfMultiply, gfInverse, lagrangeCoefficients } from "../../../dist/sskr/gf256.js";
import { sskrEngine } from "../../../dist/sskr/runtime.js";

const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8"));
const formats = ["ur", "words", "indexes", "unicode", "colors", "colors-unicode"];
const expected = (vector) => entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
let passed = 0;
let failed = 0;
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
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// Literal CBOR from the published first share; no MnemoCode decoder supplies this input.
const officialTransport = Buffer.from(
  "554bbf1101003e990c1f0435e2b33c721535c74603d041c47e42",
  "hex",
);
function mixed(transport, version) {
  const checksum = transport.subarray(-4);
  const cbor = transport.subarray(0, -4);
  return [
    ...checksum,
    ...[version, cbor.length, ...cbor].map(
      (byte, index) => byte ^ (crc32(Uint8Array.of(...checksum, index >>> 8, index & 255)) & 255),
    ),
  ];
}
function oracleWords(transport) {
  let bits = mixed(transport, 0xa2)
    .map((byte) => byte.toString(2).padStart(8, "0"))
    .join("");
  bits = bits.padEnd(Math.ceil(bits.length / 11) * 11, "0");
  return bits.match(/.{11}/gu).map((word) => parseInt(word, 2));
}
function oracleColors(transport) {
  const bytes = mixed(transport, 0xa1);
  while (bytes.length % 3) bytes.push(0);
  return Buffer.from(bytes)
    .toString("hex")
    .toUpperCase()
    .match(/.{6}/gu)
    .map((code) => "#" + code);
}
function mark(text, format, places) {
  const units =
    format === "ur"
      ? text.slice(8).match(/../gu)
      : format === "colors-unicode"
        ? text.match(/.{8}/gu)
        : text.split(" ");
  for (const place of places) units[place] = "?";
  return format === "ur"
    ? "ur:sskr/" + units.join("")
    : format === "colors-unicode"
      ? units.join("")
      : units.join(" ");
}

await check("official-literal-transport-and-all-custom-forms", () => {
  const ur = vectors.official.shares[0];
  assert.equal(Buffer.from(urToTransport(ur)).toString("hex"), officialTransport.toString("hex"));
  const indexes = oracleWords(officialTransport);
  const colors = oracleColors(officialTransport);
  assert.deepEqual(colors, vectors.official.firstShareColors);
  const colorUnicode = colors
    .map((color) => {
      const value = parseInt(color.slice(1), 16);
      return [0xe000 + Math.floor(value / 0x1900), 0xe000 + (value % 0x1900)]
        .map((point) => point.toString(16).toUpperCase())
        .join("");
    })
    .join("");
  const expectations = {
    indexes: indexes.map((index) => String(index + 1)).join(" "),
    unicode: indexes
      .map((index) => chinese[index].codePointAt(0).toString(16).toUpperCase())
      .join(" "),
    colors: colors.join(" "),
    "colors-unicode": colorUnicode,
  };
  for (const [format, value] of Object.entries(expectations)) {
    assert.equal(writeShare(ur, format), value);
    assert.equal(normalizeShare(value), ur);
  }
  assert.equal(writeShare(ur, "words"), vectors.official.bytewords[0]);
});
await check("all-30-minimal-official-grouped-quorums", async () => {
  const s = vectors.official.shares;
  let count = 0;
  for (let a = 0; a < 3; a += 1)
    for (let b = a + 1; b < 3; b += 1)
      for (let c = 3; c < 8; c += 1)
        for (let d = c + 1; d < 8; d += 1)
          for (let e = d + 1; e < 8; e += 1) {
            assert.equal(
              await combineSskrShares([s[a], s[b], s[c], s[d], s[e]]),
              expected(vectors.official),
            );
            count += 1;
          }
  assert.equal(count, 30);
  assert.equal(await combineSskrShares(vectors.official.bytewords), expected(vectors.official));
  for (const subset of vectors.official.invalidQuorums)
    await assert.rejects(() => combineSskrShares(subset.map((index) => s[index])));
});
await check("all-five-widths-three-pairs-six-forms-and-one-missing-token", async () => {
  for (const vector of vectors.deterministic) {
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      assert.equal(await combineSskrShares([vector.shares[a], vector.shares[b]]), expected(vector));
    for (const format of formats) {
      const text = writeShare(vector.shares[0], format);
      assert.equal(readShare(text).ur, vector.shares[0]);
      const damaged = mark(text, format, [3]);
      assert.equal(readRepairableShare(damaged).ur, vector.shares[0]);
      assert.equal(await combineSskrShares([damaged, vector.shares[1]]), expected(vector));
    }
  }
});
await check("metadata-quorum-and-input-negative-bounds", async () => {
  const s = vectors.deterministic[0].shares;
  for (const args of [
    [1, 3],
    [2, 1],
    [2, 17],
    [2.5, 3],
    [NaN, 3],
    [2, Infinity],
  ])
    assert.throws(() => validateThreshold(...args));
  assert.throws(() => validateShareSet([]));
  assert.throws(() => validateShareSet(Array(257).fill(s[0])));
  await assert.rejects(() => combineSskrShares([s[0]]));
  await assert.rejects(() => combineSskrShares([s[0], s[0]]));
  await assert.rejects(() => combineSskrShares([s[0], vectors.deterministic[1].shares[1]]));
  for (const input of [
    "",
    "ur:sskr/1-2/abcd",
    "ur:sskr/zz",
    "#FFFFFF",
    "1 ".repeat(1025),
    "?".repeat(65),
  ])
    assert.throws(() => readRepairableShare(input));
});
await check("production-secure-split-and-maximal-threshold", async () => {
  const mnemonic = "abandon ".repeat(11) + "about";
  const first = await splitSskrMnemonic(mnemonic, 2, 3);
  const second = await splitSskrMnemonic(mnemonic, 2, 3);
  assert.notDeepEqual(first, second);
  for (const [a, b] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ])
    assert.equal(await combineSskrShares([first[a], first[b]]), mnemonic);
  const engine = await sskrEngine();
  for (const seed of [new Uint8Array(31), new Uint8Array(33)])
    assert.throws(() =>
      engine.create_sskr_shares(new Uint8Array(16), 1, Uint8Array.of(2, 3), seed),
    );
  const all = engine
    .create_sskr_shares(new Uint8Array(32), 1, Uint8Array.of(16, 16), new Uint8Array(32))
    .split("\n");
  assert.equal(all.length, 16);
  assert.equal(await combineSskrShares(all), entropyToMnemonic(new Uint8Array(32), wordlist));
  await assert.rejects(() => combineSskrShares(all.slice(1)));
});
await check("joint-repair-three-shares-mixed-form-and-damaged-duplicate-copy", async () => {
  const v = vectors.deterministic[0];
  const typed = v.shares.map((share, index) =>
    mark(writeShare(share, formats[index + 2]), formats[index + 2], [4, 7]),
  );
  const plan = await planShareRepair(typed);
  const found = await plan.search();
  assert.equal(found.length, 1);
  assert.equal(found[0].mnemonic, expected(v));
  assert.deepEqual(
    found[0].shares.map((share) => share.ur),
    v.shares,
  );
  const copies = [
    mark(writeShare(v.shares[0], "colors"), "colors", [2, 3, 4]),
    mark(writeShare(v.shares[0], "colors"), "colors", [5, 6, 7]),
    mark(writeShare(v.shares[1], "colors"), "colors", [8]),
  ];
  const duplicates = await (await planShareRepair(copies)).search();
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].mnemonic, expected(v));
  assert.equal(duplicates[0].shares[0].ur, duplicates[0].shares[1].ur);
});
await check("single-share-ambiguity-is-listed-and-never-chosen", () => {
  const ur = vectors.deterministic[4].shares[0];
  let foundAmbiguity = false;
  for (const places of [
    [10, 12, 14],
    [13, 15, 17],
    [15, 17, 19],
  ]) {
    try {
      readRepairableShare(mark(writeShare(ur, "indexes"), "indexes", places));
    } catch (error) {
      if (error instanceof ShareVariantsError) {
        assert.ok(error.variants.length > 1);
        assert.ok(error.variants.some((share) => share.ur === ur));
        foundAmbiguity = true;
        break;
      }
      throw error;
    }
  }
  assert.ok(foundAmbiguity);
});
await check("gf256-all-products-match-independent-bit-multiplier", () => {
  function mul(a, b) {
    let out = 0;
    while (b) {
      if (b & 1) out ^= a;
      a <<= 1;
      if (a & 256) a ^= 0x11b;
      b >>>= 1;
    }
    return out;
  }
  for (let a = 0; a < 256; a += 1)
    for (let b = 0; b < 256; b += 1) assert.equal(gfMultiply(a, b), mul(a, b));
  for (let a = 1; a < 256; a += 1) assert.equal(mul(a, gfInverse(a)), 1);
  assert.throws(() => gfInverse(0));
  assert.throws(() => lagrangeCoefficients([0, 0], 255));
});
await check("independent-hmac-check-of-published-first-group", () => {
  const raw = [
    "4bbf1101003e990c1f0435e2b33c721535c74603d0",
    "4bbf1101010c8ba39a7502a325ed07b8d597d1b80f",
  ].map((hex) => Buffer.from(hex, "hex").subarray(5));
  // For x=0 and x=1, interpolation of a byte at t is y0 XOR t*(y1 XOR y0).
  const at = (point) => raw[0].map((byte, index) => byte ^ gfMultiply(point, byte ^ raw[1][index]));
  const secret = at(255);
  const digest = at(254);
  assert.deepEqual(
    createHmac("sha256", digest.subarray(4)).update(secret).digest().subarray(0, 4),
    digest.subarray(0, 4),
  );
});
console.log(
  JSON.stringify({
    passed,
    failed,
    note: "Grouped fixture is independent; five width fixtures are deterministic regression data.",
  }),
);
process.exitCode = failed ? 1 : 0;

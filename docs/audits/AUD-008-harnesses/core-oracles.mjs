// AUD-008, baseline 767ee995a91e98c1f9bde6b7930147e352fc5cff. Public synthetic data only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { wordlist as chinese } from "@scure/bip39/wordlists/traditional-chinese.js";
import * as core from "../../../dist/core.js";
import * as candidates from "../../../dist/core/candidates.js";

// Independent integer packing and Node/OpenSSL SHA-256; only the pinned word lists are shared.
function phrase(entropy) {
  const bits = entropy.length * 8;
  const checksumBits = bits / 32;
  const checksum = createHash("sha256").update(entropy).digest()[0] >>> (8 - checksumBits);
  let value = (BigInt(`0x${entropy.toString("hex")}`) << BigInt(checksumBits)) | BigInt(checksum);
  const words = [];
  for (let i = 0; i < (bits + checksumBits) / 11; i += 1) {
    words.unshift(wordlist[Number(value & 2047n)]);
    value >>= 11n;
  }
  return words.join(" ");
}

function independentlyValid(indexes) {
  const checksumBits = indexes.length / 3;
  let stream = indexes.reduce((value, index) => (value << 11n) | BigInt(index), 0n);
  const checksum = Number(stream & ((1n << BigInt(checksumBits)) - 1n));
  stream >>= BigInt(checksumBits);
  const entropy = Buffer.from(stream.toString(16).padStart((indexes.length * 8) / 3, "0"), "hex");
  return checksum === createHash("sha256").update(entropy).digest()[0] >>> (8 - checksumBits);
}

function translated(entropy, dates) {
  const bits = entropy.length * 8;
  const tailWidth = bits % 11;
  const source = BigInt(`0x${entropy.toString("hex")}`);
  const schedule = [...dates]
    .sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day)
    .flatMap((date) => [date.year, date.month, date.day]);
  const chunks = (bits - tailWidth) / 11;
  let result = 0n;
  for (let i = 0; i < chunks; i += 1) {
    const chunk = (source >> BigInt(bits - (i + 1) * 11)) & 2047n;
    result = (result << 11n) | ((chunk + BigInt(schedule[i % schedule.length])) & 2047n);
  }
  result =
    (result << BigInt(tailWidth)) |
    ((source + BigInt(schedule[chunks % schedule.length])) & ((1n << BigInt(tailWidth)) - 1n));
  return Buffer.from(result.toString(16).padStart(entropy.length * 2, "0"), "hex");
}

const metadata = JSON.parse(readFileSync("vectors/mnemocode-v1.json", "utf8"));
for (const [list, pin] of [
  [wordlist, metadata.wordlist],
  [chinese, metadata.traditionalChineseWordlist],
]) {
  assert.equal(list.length, 2048);
  assert.equal(
    createHash("sha256").update(list.join("\n")).digest("hex"),
    pin.sha256_newline_joined,
  );
}
assert.equal(core.mappingRow(1).english, "abandon");
assert.equal(core.mappingRow(2048).english, "zoo");
assert.equal(new Set(core.allMappingRows().map((row) => row.unicodeHex)).size, 2048);

const formats = ["english", "indexes", "unicode", "colors", "colors-unicode"];
const schedules = [
  [core.parseDate("01-01-0001")],
  [core.parseDate("31-12-9999"), core.parseDate("29-02-2000"), core.parseDate("31-12-2048")],
  [core.parseDate("31-12-9999"), core.parseDate("31-12-9999")],
];
let transforms = 0;
let representations = 0;
let missingFinalCandidates = 0;
for (const length of [16, 20, 24, 28, 32]) {
  const samples = [
    Buffer.alloc(length),
    Buffer.alloc(length, 255),
    Buffer.from(Array.from({ length }, (_, i) => i)),
  ];
  for (const entropy of samples) {
    const source = phrase(entropy);
    const expectedIndexes = source.split(" ").map((word) => wordlist.indexOf(word));
    const direct = core.representMnemonic(source);
    assert.deepEqual(direct.shiftedIndexes, expectedIndexes);
    for (const dates of schedules) {
      const snapshot = JSON.stringify(dates);
      const result = core.encodeMnemonic(source, dates);
      assert.equal(result.shiftedEnglish.join(" "), phrase(translated(entropy, dates)));
      assert.equal(JSON.stringify(dates), snapshot);
      assert.equal(core.decodeIndexes(result.shiftedIndexes, dates).recoveredMnemonic, source);
      transforms += 1;
      for (const format of formats) {
        assert.equal(
          core.decodeInput(core.formatEncoded(result, format), format, dates).recoveredMnemonic,
          source,
        );
        assert.equal(
          core.decodeInputDirect(core.formatEncoded(direct, format), format).recoveredMnemonic,
          source,
        );
        representations += 2;
      }
    }
    const candidateIndexes = candidates.entropyOfWords(expectedIndexes);
    assert.deepEqual(Buffer.from(candidateIndexes), entropy);
    assert.equal(candidates.checksumValid(expectedIndexes), independentlyValid(expectedIndexes));
  }
  const zero = phrase(Buffer.alloc(length));
  const prefix = zero.split(" ").slice(0, -1);
  const expected = [];
  for (let last = 0; last < 2048; last += 1) {
    const indexes = [...prefix.map((word) => wordlist.indexOf(word)), last];
    if (independentlyValid(indexes))
      expected.push(indexes.map((index) => wordlist[index]).join(" "));
  }
  // Consume immediately: the documented search iterator reuses its yielded array.
  const actual = Array.from(
    candidates.searchCandidates(candidates.parseUnknownWords([...prefix, "?"].join(" "))),
    (indexes) => indexes.map((index) => wordlist[index]).join(" "),
  );
  assert.deepEqual(actual, expected);
  assert.deepEqual(
    core.recoverMissingWord([...prefix, "?"].join(" ")).map((candidate) => candidate.mnemonic),
    expected,
  );
  assert.equal(expected.length, 2 ** (11 - length / 4));
  missingFinalCandidates += expected.length;
}

// Missing-place ordering and de-duplication against a separately written enumeration.
const written = Array(11).fill(0);
const expectedMissing = [];
const seen = new Set();
for (let place = 0; place <= written.length; place += 1) {
  for (let word = 0; word < 2048; word += 1) {
    const indexes = [...written.slice(0, place), word, ...written.slice(place)];
    const key = indexes.join(",");
    if (!seen.has(key) && independentlyValid(indexes)) expectedMissing.push(key);
    seen.add(key);
  }
}
const actualMissing = Array.from(
  candidates.searchCandidates(candidates.parseMissingWord("abandon ".repeat(11))),
  (indexes) => indexes.join(","),
);
assert.deepEqual(actualMissing, expectedMissing);
assert.equal(new Set(actualMissing).size, actualMissing.length);

const pattern = core.parseDatePattern("?3-09-2026");
assert.deepEqual(core.expandDatePattern(pattern).map(core.formatDate), [
  "03-09-2026",
  "13-09-2026",
  "23-09-2026",
]);
assert.equal(core.datePatternCombinationCount([pattern, pattern]), 6);
assert.equal([...core.datePatternCombinations([pattern, pattern])].length, 6);
assert.equal(core.datePatternCandidateCount(core.parseDatePattern("??-??-????")), 3652059);
for (const bad of ["29-02-1900", "29-02-2100", "31-04-2026", "01-01-0000"])
  assert.throws(() => core.parseDate(bad));
for (const bad of [-1, 2048, 0.5, NaN, Infinity]) {
  for (const decoder of [
    core.decodeIndexes,
    core.decodeIndexesLegacy,
    core.decodeIndexesLegacyValid,
  ])
    assert.throws(() => decoder([bad, ...Array(11).fill(0)], schedules[0]), /index/u);
}
assert.throws(() => core.parseInput("abandon ".repeat(12), "misspelled"), /Unsupported/u);
assert.throws(
  () => core.formatEncoded(core.representMnemonic(phrase(Buffer.alloc(16))), "misspelled"),
  /Unsupported/u,
);
console.log(
  JSON.stringify(
    {
      status: "passed",
      transforms,
      representationChecks: representations,
      independentFinalCandidates: missingFinalCandidates,
      independentMissingPlaceCandidates: actualMissing.length,
      allWordMappings: 2048,
      calendarChecks: "passed",
      invalidIndexChecks: 15,
      oracle: "integer packing plus Node/OpenSSL SHA-256, pinned shared word lists",
    },
    null,
    2,
  ),
);

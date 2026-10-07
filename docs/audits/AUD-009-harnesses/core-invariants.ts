import assert from "node:assert/strict";
import { pbkdf2Sync } from "node:crypto";
import { DatesAnswer, DateSearch, HARD_MAX_COMBINATIONS } from "../../../src/core/date-search.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
import { Masking } from "../../../src/core/masking.js";
import { WordCandidateSearch } from "../../../src/core/candidates.js";
import { encodeCandidateList, decodeCandidateList } from "../../../src/core/candidate-list.js";
import { WalletEvidenceCheck } from "../../../src/core/wallet-evidence.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { parseRecord } from "../../../src/record.js";

// Only public all-zero BIP39 entropy and synthetic calendar inputs are used.
const publicPhrase = `${"abandon ".repeat(11)}about`;
const date = { year: 2026, month: 9, day: 23 };
let failures = 0;
async function check(name: string, run: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await run();
    console.log(JSON.stringify({ check: name, outcome: "passed" }));
  } catch (error) {
    failures += 1;
    console.log(JSON.stringify({ check: name, outcome: "failed", message: String(error) }));
  }
}

await check("dates-answer owns input dates and getter dates", () => {
  const input = { ...date };
  const answer = DatesAnswer.of([input]);
  input.year = 2025;
  assert.equal(answer.known[0]!.year, 2026, "input mutation changed the answer");
  Reflect.set(answer.known[0]!, "year", 2024);
  assert.equal(answer.known[0]!.year, 2026, "getter mutation changed the answer");
});

await check("date patterns cannot mutate past their checked work bound", () => {
  const answer = DatesAnswer.parse("??-??-2026", { patterns: true, wordCount: 12 });
  const search = new DateSearch({ indexes: [...Array(11).fill(0), 3], dates: answer, mode: "seedshift" });
  const before = search.combinations;
  (answer.patterns[0]!.years as number[]).push(...Array.from({ length: 9998 }, (_, index) => index + 1));
  (answer.patterns[0]!.days as number[]).push(...Array(63).fill(1));
  assert.equal(search.combinations, before, "getter mutation changed the checked search");
  assert.ok(search.combinations <= HARD_MAX_COMBINATIONS);
});

await check("date search refuses mutated work above hard limit before first combination", async () => {
  const answer = DatesAnswer.parse("??-??-2026", { patterns: true, wordCount: 12 });
  const search = new DateSearch({ indexes: [...Array(11).fill(0), 3], dates: answer, mode: "seedshift" });
  (answer.patterns[0]!.years as number[]).push(...Array.from({ length: 9998 }, (_, index) => index + 1));
  (answer.patterns[0]!.days as number[]).push(...Array(63).fill(1));
  assert.ok(search.combinations > HARD_MAX_COMBINATIONS);
  await assert.rejects(search.run({
    progressEvery: 1,
    onProgress(progress) {
      throw new Error(`WORK_STARTED: ${progress.checked} combination of ${progress.combinations}`);
    },
  }), /exceeds the safety limit/u);
});

await check("dates-answer refuses invalid calendar dates", () => {
  assert.throws(() => DatesAnswer.of([{ year: 2026, month: 2, day: 31 }]));
});

await check("dates-answer refuses a pattern with no candidate", () => {
  assert.throws(() => DatesAnswer.of([], [{ key: "empty", years: [], months: [1], days: [1] }]));
});

await check("encoded-backup refuses sparse indexes", () => {
  assert.throws(() => EncodedBackup.of(new Array<number>(12), "indexes", "direct"));
});

await check("every masking variant contains original in its decode", () => {
  for (const mode of Masking.MODES) {
    const masking = Masking.of(mode);
    const dates = masking.masked ? [date] : [];
    const encoded = masking.encode(publicPhrase, dates);
    const backup = EncodedBackup.of(encoded.shiftedIndexes, "indexes", mode);
    assert.ok(backup.candidates(dates).some((candidate) => candidate.recoveredMnemonic === publicPhrase));
    assert.equal(String(backup), "[EncodedBackup: redacted]");
  }
});

await check("unknown last word has exactly 128 checksum-valid 12-word candidates", () => {
  const search = WordCandidateSearch.parse(`${"abandon ".repeat(11)}?`, "unknown-words");
  assert.deepEqual(search.expected, { count: 128, exact: true });
  assert.equal([...search.candidates()].length, 128);
});

await check("five phrase lengths and five forms preserve modes and recovery", () => {
  const formats = ["english", "indexes", "unicode", "colors", "colors-unicode"] as const;
  for (const length of [16, 20, 24, 28, 32]) {
    const phrase = entropyToMnemonic(Uint8Array.from({ length }, (_, index) => index), wordlist);
    for (const mode of Masking.MODES) {
      const dates = Masking.of(mode).masked ? [date] : [];
      const encoded = Masking.of(mode).encode(phrase, dates);
      for (const format of formats) {
        const backup = EncodedBackup.of(encoded.shiftedIndexes, format, mode);
        const record = parseRecord(backup.record())!;
        assert.equal(record.mode, mode);
        assert.equal(record.format, format);
        const read = EncodedBackup.read(record.payload, record.format, record.mode);
        assert.ok(read.candidates(dates).some((candidate) => candidate.recoveredMnemonic === phrase));
      }
    }
  }
});

await check("candidate-list roundtrip and CRC rejection", () => {
  const encoded = encodeCandidateList({ records: [{ entropy: new Uint8Array(16) }], passphrase: "synthetic" });
  const decoded = decodeCandidateList(encoded);
  assert.deepEqual(decoded.records[0]!.entropy, new Uint8Array(16));
  assert.equal(decoded.passphrase, "synthetic");
  encoded[22] ^= 1;
  assert.throws(() => decodeCandidateList(encoded));
  decoded.records[0]!.entropy.fill(0);
  encoded.fill(0);
});

await check("wallet fingerprint public vector and host seed cleanup", () => {
  let retained: Uint8Array | undefined;
  const checker = new WalletEvidenceCheck((phrase, salt, rounds, length) => {
    retained = pbkdf2Sync(phrase, salt, rounds, length, "sha512");
    return retained;
  });
  assert.equal(checker.fingerprint(publicPhrase), "73c5da0a");
  assert.ok(retained!.every((byte) => byte === 0));
});

await check("published BIP84 address matches synchronous and asynchronous hosts", async () => {
  const evidence = {
    kind: "address" as const,
    value: "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu",
    profiles: ["native-segwit" as const],
    location: { network: "mainnet" as const, account: 0, branch: 0, index: 0 },
  };
  const synchronous = new WalletEvidenceCheck((phrase, salt, rounds, length) =>
    pbkdf2Sync(phrase, salt, rounds, length, "sha512"),
  );
  const asynchronous = new WalletEvidenceCheck(async (phrase, salt, rounds, length) =>
    pbkdf2Sync(phrase, salt, rounds, length, "sha512"),
  );
  const match = synchronous.match(publicPhrase, evidence);
  assert.equal(match.matched, true);
  assert.equal(match.path, "m/84'/0'/0'/0/0");
  assert.deepEqual(await asynchronous.matchAsync(publicPhrase, evidence), match);
});

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

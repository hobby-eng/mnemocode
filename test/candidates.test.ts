import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  checksumValid,
  entropyOfWords,
  MAX_SEARCH_COMBINATIONS,
  parseMissingWord,
  parseUnknownWords,
  phraseOfWords,
  searchCandidates,
  searchCombinations,
  type WordSearch,
} from "../src/core/candidates.js";
import {
  decodeCandidateList,
  encodeCandidateList,
  padmeLength,
  type CandidateList,
} from "../src/core/candidate-list.js";
import {
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  parseRecipient,
} from "../src/core/candidate-encryption.js";
import { crc32 } from "../src/sskr/checksum.js";
import { Decrypter } from "age-encryption";

interface Sample {
  readonly number: number;
  readonly phrase: string;
  readonly entropy: string;
}
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/candidates-v1.json", import.meta.url), "utf8"),
) as {
  searches: {
    name: string;
    kind: WordSearch["kind"];
    text: string;
    combinations: number;
    count: number;
    candidates: Sample[];
    contains?: Sample;
    all?: string[];
  }[];
  lists: {
    name: string;
    passphrase?: string;
    records: { entropy: string; passphrase?: string }[];
    bytes: string;
  }[];
  invalidLists: { name: string; refusal: string; bytes: string }[];
  padme: { length: number; padded: number }[];
  age: {
    identity: string;
    hybridIdentity: string;
    recipient: string;
    passphrase: string;
    plaintext: string;
    open: { name: string; file: string }[];
    refuse: { name: string; file: string }[];
  };
};
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const fromHex = (text: string) => Uint8Array.from(Buffer.from(text, "hex"));
const parse = (kind: WordSearch["kind"], text: string) =>
  kind === "unknown-words" ? parseUnknownWords(text) : parseMissingWord(text);

describe("Candidate searches", () => {
  it.each(vectors.searches.map((search) => [search.name, search] as const))(
    "%s: the count and every numbered candidate of the vectors",
    (_, search) => {
      const parsed = parse(search.kind, search.text);
      expect(searchCombinations(parsed)).toBe(search.combinations);
      const phrases: string[] = [];
      for (const words of searchCandidates(parsed)) phrases.push(phraseOfWords(words));
      expect(phrases).toHaveLength(search.count);
      for (const sample of [...search.candidates, ...(search.contains ? [search.contains] : [])]) {
        expect(phrases[sample.number - 1]).toBe(sample.phrase);
        expect(hex(mnemonicToEntropy(sample.phrase, wordlist))).toBe(sample.entropy);
      }
      if (search.all !== undefined) expect(phrases).toEqual(search.all);
      // Every candidate is a valid phrase, and none comes twice.
      expect(new Set(phrases).size).toBe(phrases.length);
      for (const phrase of phrases.slice(0, 300))
        expect(validateMnemonic(phrase, wordlist)).toBe(true);
    },
    60_000,
  );

  it("checks the checksum as @scure/bip39 does, for every length", () => {
    for (const bytes of [16, 20, 24, 28, 32]) {
      const entropy = Uint8Array.from({ length: bytes }, (_, i) => (i * 73 + bytes) & 0xff);
      const words = entropyToMnemonic(entropy, wordlist)
        .split(" ")
        .map((w) => wordlist.indexOf(w));
      expect(checksumValid(words)).toBe(true);
      expect(entropyOfWords(words)).toEqual(entropy);
      const wrong = [...words];
      wrong[wrong.length - 1] = (wrong.at(-1)! + 1) % 2048;
      expect(checksumValid(wrong)).toBe(validateMnemonic(phraseOfWords(wrong), wordlist));
    }
  });

  it("reads places as words, ?, prefixes and choices, and refuses the rest", () => {
    const search = parseUnknownWords(`ABANDON ab* ${"abandon ".repeat(9)}zoo|zone`);
    expect(search.kind === "unknown-words" && search.places[1]!.length).toBe(10);
    expect(() => parseUnknownWords("abandon ".repeat(12))).toThrow(/Mark each/u);
    expect(() => parseUnknownWords("abandon ".repeat(11))).toThrow(/12, 15/u);
    expect(() => parseUnknownWords(`xyz* ${"abandon ".repeat(10)}?`)).toThrow(/place 1/u);
    expect(() => parseUnknownWords(`abandon|abandonx ${"abandon ".repeat(10)}?`)).toThrow(
      /place 1/u,
    );
    expect(() => parseMissingWord("abandon ".repeat(12))).toThrow(/11, 14/u);
    expect(() => parseMissingWord(`? ${"abandon ".repeat(10)}`)).toThrow(/place 1/u);
    // Three forgotten words are more than one search may check.
    const three = parseUnknownWords(`? ? ${"abandon ".repeat(9)}?`);
    expect(searchCombinations(three)).toBeGreaterThan(MAX_SEARCH_COMBINATIONS);
    expect(() => searchCandidates(three).next()).toThrow(/combinations/u);
  });
});

describe("Candidate lists", () => {
  it("compute CRC-32 as zlib does", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it.each(vectors.padme.map((row) => [row.length, row.padded] as const))(
    "pad %i bytes to %i",
    (length, padded) => expect(padmeLength(length)).toBe(padded),
  );

  it.each(vectors.lists.map((list) => [list.name, list] as const))(
    "%s: written byte for byte, and read back",
    (_, vector) => {
      const list: CandidateList = {
        ...(vector.passphrase === undefined ? {} : { passphrase: vector.passphrase }),
        records: vector.records.map((record) => ({
          entropy: fromHex(record.entropy),
          ...(record.passphrase === undefined ? {} : { passphrase: record.passphrase }),
        })),
      };
      expect(hex(encodeCandidateList(list))).toBe(vector.bytes);
      expect(decodeCandidateList(fromHex(vector.bytes))).toEqual(list);
    },
  );

  it.each(vectors.invalidLists.map((list) => [list.name, list] as const))(
    "refuse a list with %s, for that reason",
    (_, list) => expect(() => decodeCandidateList(fromHex(list.bytes))).toThrow(list.refusal),
  );

  it("refuse what no list may hold", () => {
    const entropy = new Uint8Array(16);
    expect(() => encodeCandidateList({ records: [] })).toThrow(/1 to/u);
    expect(() => encodeCandidateList({ records: [{ entropy: new Uint8Array(15) }] })).toThrow();
    expect(() =>
      encodeCandidateList({ records: [{ entropy }, { entropy: new Uint8Array(32) }] }),
    ).toThrow(/one length/u);
    expect(() =>
      encodeCandidateList({ passphrase: "x".repeat(257), records: [{ entropy }] }),
    ).toThrow(/256 bytes/u);
  });
});

describe("Candidate file encryption", () => {
  const plain = fromHex(vectors.age.plaintext);

  it.each(vectors.age.open.map((file) => [file.name, file.file] as const))(
    "opens the file %s",
    async (name, file) => {
      const key = name.includes("passphrase")
        ? { passphrase: vectors.age.passphrase }
        : { identity: vectors.age.identity };
      expect(await decryptCandidates(fromHex(file), key)).toEqual(plain);
    },
    30_000,
  );

  it.each(vectors.age.refuse.map((file) => [file.name, file.file] as const))(
    "refuses a file with %s",
    async (name, file) => {
      const key = name.includes("scrypt")
        ? { passphrase: vectors.age.passphrase }
        : { identity: vectors.age.identity };
      await expect(decryptCandidates(fromHex(file), key)).rejects.toThrow(
        /exactly one|work factor/u,
      );
    },
    30_000,
  );

  it("refuses a post-quantum file even with the key that opens it", async () => {
    const file = fromHex(vectors.age.refuse.find((f) => f.name.includes("post-quantum"))!.file);
    const decrypter = new Decrypter();
    decrypter.addIdentity(vectors.age.hybridIdentity);
    expect(await decrypter.decrypt(file)).toEqual(plain);
    await expect(decryptCandidates(file, { identity: vectors.age.hybridIdentity })).rejects.toThrow(
      /exactly one X25519/u,
    );
  });

  it("makes one-time X25519 keys, and takes a recipient in any case", async () => {
    const session = await createSessionIdentity();
    expect(session.recipient).toMatch(/^age1[02-9ac-hj-np-z]{58}$/u);
    expect(session.identity).toMatch(/^AGE-SECRET-KEY-1/u);
    const file = await encryptCandidates(plain, `  ${session.recipient.toUpperCase()}\n`);
    expect(await decryptCandidates(file, { identity: session.identity })).toEqual(plain);
    expect(() => parseRecipient(`${session.recipient} ${session.recipient}`)).toThrow(/62/u);
    expect(() => parseRecipient("age1pq1qqqq")).toThrow(/62/u);
    // One wrong character breaks the Bech32 checksum.
    const typo = session.recipient.slice(0, -1) + (session.recipient.endsWith("q") ? "p" : "q");
    expect(() => parseRecipient(typo)).toThrow(/62/u);
  });
});

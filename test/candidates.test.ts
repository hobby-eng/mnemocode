import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  checksumValid,
  entropyOfWords,
  MAX_SEARCH_COMBINATIONS,
  NARROW_WORD_SEARCH,
  parseMissingWord,
  parseUnknownWords,
  phraseOfWords,
  searchCandidates,
  searchCombinations,
  WordCandidate,
  WordCandidateSearch,
  type WordSearch,
} from "../src/core/candidates.js";
import {
  decodeCandidateList,
  encodeCandidateList,
  padmeLength,
  TooManyForList,
  type CandidateList,
} from "../src/core/candidate-list.js";
import {
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  NoProtection,
  parseListPassphrase,
  parseRecipient,
  PassphraseProtection,
  ScannerKeyProtection,
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
const ELEVEN = "abandon ".repeat(11);
/** A public passphrase for the tests of list encryption. */
const LIST_PASSPHRASE = "public candidate test passphrase";

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

describe("WordCandidateSearch", () => {
  /**
   * Combinations above which a search is not run again here, only its size checked: the test
   * above runs it, and the class takes its candidates from searchCandidates.
   */
  const LONG_SEARCH = 100_000;

  it.each(vectors.searches.map((search) => [search.name, search] as const))(
    "%s: tells the count before the search, and numbers the candidates of the vectors",
    (_, search) => {
      const parsed = WordCandidateSearch.parse(search.text, search.kind);
      expect(parsed.combinations).toBe(search.combinations);
      // Exact when the last place may hold any word; otherwise one in 2^(words / 3) on average.
      const expected = parsed.expected;
      expect(expected.exact).toBe(search.kind === "unknown-words" && search.text.endsWith(" ?"));
      expect(expected.count).toBe(
        expected.exact
          ? search.count
          : Math.round(search.combinations / 2 ** (parsed.wordCount / 3)),
      );
      if (search.combinations > LONG_SEARCH) return;
      const phrases: string[] = [];
      for (const candidate of parsed.candidates()) {
        expect(candidate.number).toBe(phrases.length + 1);
        phrases.push(candidate.phrase);
      }
      expect(phrases).toHaveLength(search.count);
      for (const sample of [...search.candidates, ...(search.contains ? [search.contains] : [])])
        expect(phrases[sample.number - 1]).toBe(sample.phrase);
      if (search.all !== undefined) expect(phrases).toEqual(search.all);
    },
  );

  it("tells the places it searched, and each candidate's entropy and checksum bits", () => {
    const last = WordCandidateSearch.parse(`${ELEVEN}?`, "unknown-words");
    expect(last.unknownPlaces).toEqual([11]);
    const first = last.candidates().next().value!;
    expect(first.phrase).toBe(`${ELEVEN}about`);
    expect(first.checksumBits).toBe("0011");
    expect(last.placesOf(first)).toEqual([11]);
    expect(hex(first.entropy())).toBe("00".repeat(16));
    const two = WordCandidateSearch.parse(`ab* ${"abandon ".repeat(10)}abo*`, "unknown-words");
    expect(two.unknownPlaces).toEqual([0, 11]);
    // A missing word is at the first place of a run of equal words.
    const missing = WordCandidateSearch.parse(`${"abandon ".repeat(10)}about`, "missing-word");
    expect(missing.wordCount).toBe(12);
    expect(missing.unknownPlaces).toEqual([]);
    const inserted = missing.candidates().next().value!;
    expect(inserted.phrase).toBe(`${ELEVEN}about`);
    expect(missing.placesOf(inserted)).toEqual([0]);
  });

  it("refuses what the parsers refuse, and checks a search made by a host", () => {
    expect(() => WordCandidateSearch.parse(`${ELEVEN}about`, "unknown-words")).toThrow(
      /Mark each/u,
    );
    expect(() =>
      WordCandidateSearch.parse(`? ? ${"abandon ".repeat(9)}?`, "unknown-words"),
    ).toThrow(`This search has more than 16,777,216 combinations: ${NARROW_WORD_SEARCH}.`);
    expect(() => WordCandidateSearch.parse(ELEVEN, "unknown" as WordSearch["kind"])).toThrow(
      /Unknown kind/u,
    );
    // Eleven known words and the first 16 words of the list at the last place.
    const places: number[][] = Array.from({ length: 12 }, () => [0]);
    places[11] = Array.from({ length: 16 }, (_, index) => index);
    // An empty place would never end.
    expect(() =>
      WordCandidateSearch.of({ kind: "unknown-words", places: [...places.slice(1), []] }),
    ).toThrow(/one or more BIP39 indexes/u);
    // The search keeps its own copy: a change to the host's arrays does not reach it.
    const search = WordCandidateSearch.of({ kind: "unknown-words", places });
    places[11]!.push(16, 17, 18, 19);
    expect(search.combinations).toBe(16);
    expect([...search.candidates()].map((candidate) => candidate.phrase)).toEqual([
      `${ELEVEN}about`,
    ]);
  });

  it("never shows its words through toString, toJSON or inspect", () => {
    const search = WordCandidateSearch.parse(
      `legal winner thank year ? sausage worth useful legal winner thank yellow`,
      "unknown-words",
    );
    const candidate = search.candidates().next().value!;
    for (const [value, marker] of [
      [search, "[WordCandidateSearch: redacted]"],
      [candidate, "[WordCandidate: redacted]"],
    ] as const) {
      expect(String(value)).toBe(marker);
      expect(JSON.stringify({ value })).toBe(JSON.stringify({ value: marker }));
      expect(inspect(value, { showHidden: true, getters: true })).toBe(marker);
    }
  });

  it("makes a candidate only of BIP39 indexes, numbered from 1", () => {
    const words = Array.from({ length: 12 }, () => 0);
    expect(new WordCandidate(1, words).phrase).toBe(`${ELEVEN}abandon`);
    expect(() => new WordCandidate(0, words)).toThrow(RangeError);
    expect(() => new WordCandidate(1, words.slice(1))).toThrow(/BIP39 indexes/u);
    expect(() => new WordCandidate(1, [...words.slice(1), 2048])).toThrow(/BIP39 indexes/u);
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

  it("tell a search with more candidates than a list holds by its own type", () => {
    const refusal = new TooManyForList(NARROW_WORD_SEARCH);
    expect(refusal).toBeInstanceOf(Error);
    expect(refusal.message).toBe(
      "More than 524,288 candidates, more than one list holds: give more of the words, or a few letters of them.",
    );
  });

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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("reads a list passphrase without white space at its ends or a byte order mark", () => {
    expect(parseListPassphrase(`\uFEFF  ${LIST_PASSPHRASE} \n`)).toBe(LIST_PASSPHRASE);
    expect(parseListPassphrase(parseListPassphrase(` ${LIST_PASSPHRASE}`))).toBe(LIST_PASSPHRASE);
    expect(() => parseListPassphrase("  eleven char ")).toThrow(
      "Use at least 12 characters for the passphrase: it is all that protects these seed phrases.",
    );
    // Characters as a person counts them: twelve keys are twelve, though 24 UTF-16 units.
    expect(parseListPassphrase("\u{1F511}".repeat(12))).toHaveLength(24);
    expect(() => parseListPassphrase("\u{1F511}".repeat(11))).toThrow(/at least 12/u);
  });

  it("protects a list in the three ways behind one interface", async () => {
    const session = await createSessionIdentity();
    const key = new ScannerKeyProtection(` ${session.recipient.toUpperCase()}\n`);
    expect([key.encrypted, key.description, key.recipient]).toEqual([
      true,
      "encrypted to the Scanner's key",
      session.recipient,
    ]);
    expect(await decryptCandidates(await key.protect(plain), session)).toEqual(plain);
    expect(() => new ScannerKeyProtection("age1xyz")).toThrow(/62 characters/u);
    expect(() => new PassphraseProtection("too short")).toThrow(/at least 12/u);
    const passphrase = new PassphraseProtection(`\uFEFF${LIST_PASSPHRASE}\n`);
    expect([passphrase.encrypted, passphrase.description]).toEqual([
      true,
      "encrypted with the passphrase",
    ]);
    expect(String(passphrase)).toBe("[PassphraseProtection: redacted]");
    expect(JSON.stringify({ passphrase })).toBe(
      '{"passphrase":"[PassphraseProtection: redacted]"}',
    );
    expect(inspect(passphrase, { showHidden: true, getters: true })).toBe(
      "[PassphraseProtection: redacted]",
    );
    const none = new NoProtection();
    expect([none.encrypted, none.description]).toEqual([false, "NOT encrypted"]);
    expect(await none.protect(plain)).toBe(plain);
  });

  it("refuses an age key in one line where WebCrypto is missing; a passphrase still works", async () => {
    const session = await createSessionIdentity();
    const file = await encryptCandidates(plain, session.recipient);
    // A browser page served over plain http has crypto.getRandomValues but no crypto.subtle.
    vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const missing =
      /^An age key \(X25519\) needs WebCrypto \(crypto\.subtle\), which is missing here: [^\n]+$/u;
    await expect(createSessionIdentity()).rejects.toThrow(missing);
    await expect(encryptCandidates(plain, session.recipient)).rejects.toThrow(missing);
    await expect(new ScannerKeyProtection(session.recipient).protect(plain)).rejects.toThrow(
      missing,
    );
    await expect(decryptCandidates(file, session)).rejects.toThrow(missing);
    const locked = await new PassphraseProtection(LIST_PASSPHRASE).protect(plain);
    expect(await decryptCandidates(locked, { passphrase: LIST_PASSPHRASE })).toEqual(plain);
  }, 30_000);
});

// AUD-010 core probe (CHECK-FUN-001, CHECK-FUN-006): Seedshift in all four modes against an
// independent encoder written from README "Seedshift" (own bit packing, @scure/bip39 only):
//   - the documented example of the original Seedshift (mifunetoshiro/Seedshift README);
//   - every vector of vectors/mnemocode-v1.json in every form it lists, encode and decode;
//   - every length with one to the maximum number of dates, years above 2048, 29 February,
//     the same date twice and dates in any order: encode equals the oracle, decode gives back the
//     source, legacy-valid lists 2^(11 - checksum bits) candidates including the source;
//   - invalid sources refused (checksum, unknown word, wrong count, NFKD and case handling).
// Public fixtures only.

import { readFileSync } from "node:fs";
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Masking, type MaskingMode } from "../../../src/core/masking.js";
import { formatEncoded, parseInput } from "../../../src/core/representations.js";
import { parseDate } from "../../../src/core/dates.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
import type { DateShiftDate } from "../../../src/core/types.js";
import { LENGTHS, publicEntropies } from "./core-oracle.ts";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
const mod = (value: number, modulus: number) => ((value % modulus) + modulus) % modulus;
const indexesOf = (phrase: string) => phrase.split(" ").map((word) => wordlist.indexOf(word));

function shiftsOf(dates: readonly DateShiftDate[], words: number): number[] {
  const sorted = [...dates].sort((a, b) => a.year - b.year || a.month - b.month || a.day - b.day);
  const sequence = sorted.flatMap((date) => [date.year, date.month, date.day]);
  return Array.from({ length: words }, (_, index) => sequence[index % sequence.length]!);
}

/** README: the entropy in 11-bit chunks and the last, shorter chunk, each shifted, checksum again. */
function oracleSeedshift(phrase: string, dates: readonly DateShiftDate[]): number[] {
  const words = phrase.split(" ").length;
  const checksum = words / 3;
  const tail = 11 - checksum;
  const shifts = shiftsOf(dates, words);
  const bits = [...mnemonicToEntropy(phrase, wordlist)]
    .map((byte) => byte.toString(2).padStart(8, "0"))
    .join("");
  let shifted = "";
  for (let index = 0; index < words - 1; index += 1)
    shifted += mod(
      Number.parseInt(bits.slice(index * 11, index * 11 + 11), 2) + shifts[index]!,
      2048,
    )
      .toString(2)
      .padStart(11, "0");
  shifted += mod(Number.parseInt(bits.slice(-tail), 2) + shifts[words - 1]!, 2 ** tail)
    .toString(2)
    .padStart(tail, "0");
  const entropy = Uint8Array.from({ length: shifted.length / 8 }, (_, byte) =>
    Number.parseInt(shifted.slice(byte * 8, byte * 8 + 8), 2),
  );
  return indexesOf(entropyToMnemonic(entropy, wordlist));
}

/** The original Seedshift: every word number plus its shift, modulo 2048. */
function oracleLegacy(phrase: string, dates: readonly DateShiftDate[]): number[] {
  const shifts = shiftsOf(dates, phrase.split(" ").length);
  return indexesOf(phrase).map((index, at) => mod(index + shifts[at]!, 2048));
}

/** The original's result with only the checksum bits of its last word written again. */
function oracleLegacyValid(phrase: string, dates: readonly DateShiftDate[]): number[] {
  const legacy = oracleLegacy(phrase, dates);
  const words = legacy.length;
  const bits = legacy
    .map((index) => index.toString(2).padStart(11, "0"))
    .join("")
    .slice(0, words * 11 - words / 3);
  const entropy = Uint8Array.from({ length: bits.length / 8 }, (_, byte) =>
    Number.parseInt(bits.slice(byte * 8, byte * 8 + 8), 2),
  );
  return indexesOf(entropyToMnemonic(entropy, wordlist));
}

const ORACLE: Record<MaskingMode, (phrase: string, dates: readonly DateShiftDate[]) => number[]> = {
  direct: (phrase) => indexesOf(phrase),
  seedshift: oracleSeedshift,
  "seedshift-legacy": oracleLegacy,
  "seedshift-legacy-valid": oracleLegacyValid,
};

// ---- The documented example of the original Seedshift.
{
  const source = "oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog";
  const dates = ["10-07-1963", "27-04-1956", "31-01-1994"].map(parseDate);
  const expected =
    "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";
  const oracle = oracleLegacy(source, dates)
    .map((index) => wordlist[index])
    .join(" ");
  const production = formatEncoded(Masking.of("seedshift-legacy").encode(source, dates), "english");
  check(
    "Seedshift README example: oracle and production",
    oracle === expected && production === expected,
    { oracle, production },
  );
}

// ---- vectors/mnemocode-v1.json.
{
  const file = JSON.parse(readFileSync("vectors/mnemocode-v1.json", "utf8")) as {
    vectors: {
      name: string;
      mode: MaskingMode;
      sourceMnemonic: string;
      dates: string[];
      english: string;
      indexes: string;
      unicode: string;
      colors: string;
      colorsUnicode: string;
    }[];
  };
  for (const vector of file.vectors) {
    const dates = vector.dates.map(parseDate);
    const masking = Masking.of(vector.mode);
    const encoded = masking.encode(vector.sourceMnemonic, dates);
    const forms = {
      english: vector.english,
      indexes: vector.indexes,
      unicode: vector.unicode,
      colors: vector.colors,
      "colors-unicode": vector.colorsUnicode,
    } as const;
    const produced = Object.fromEntries(
      Object.keys(forms).map((format) => [
        format,
        formatEncoded(encoded, format as keyof typeof forms),
      ]),
    );
    const oracle = ORACLE[vector.mode](vector.sourceMnemonic, dates)
      .map((index) => wordlist[index])
      .join(" ");
    const decodedEvery = Object.entries(forms).every(([format, text]) => {
      const backup = EncodedBackup.read(text, format as keyof typeof forms, vector.mode);
      return backup
        .candidates(dates)
        .some((result) => result.recoveredMnemonic === vector.sourceMnemonic);
    });
    check(
      `vector ${vector.name}: every form equals the vector, the oracle agrees, decode gives the source`,
      Object.entries(forms).every(([format, text]) => produced[format] === text) &&
        oracle === vector.english &&
        decodedEvery,
      {
        mismatched: Object.entries(forms)
          .filter(([format, text]) => produced[format] !== text)
          .map(([format]) => format),
        oracleMatches: oracle === vector.english,
        decodedEvery,
      },
    );
  }
}

// ---- Every length, mode and date set.
const DATE_SETS: readonly (readonly string[])[] = [
  ["23-09-2026"],
  ["29-02-2024", "01-01-0001"],
  ["31-12-9999", "15-06-4073", "15-06-2025"],
  ["07-11-1951", "07-11-1951", "08-08-1988", "23-09-2026"],
  ["01-01-2001", "02-02-2002", "03-03-2003", "04-04-2004", "05-05-2005"],
  [
    "01-01-2001",
    "02-02-2002",
    "03-03-2003",
    "04-04-2004",
    "05-05-2005",
    "06-06-2006",
    "07-07-2007",
    "08-08-2048",
  ],
];
for (const words of LENGTHS)
  for (const [name, entropy] of Object.entries(publicEntropies(words))) {
    const phrase = entropyToMnemonic(entropy, wordlist);
    for (const mode of Masking.MODES) {
      const masking = Masking.of(mode);
      const sets = masking.masked ? DATE_SETS.filter((set) => set.length <= words / 3) : [[]];
      for (const set of sets) {
        const dates = set.map(parseDate);
        const reversed = [...dates].reverse();
        const encoded = masking.encode(phrase, dates);
        const again = masking.encode(phrase, reversed);
        const oracle = ORACLE[mode](phrase, dates);
        const results = masking.undo(encoded.shiftedIndexes, reversed);
        const label = `${words} words ${name} ${mode} ${set.length} dates`;
        const tail = 2 ** (11 - words / 3);
        const container = encoded.shiftedIndexes.map((index) => wordlist[index]).join(" ");
        check(
          `${label}: encode equals the oracle, in any date order`,
          JSON.stringify(encoded.shiftedIndexes) === JSON.stringify(oracle) &&
            JSON.stringify(again.shiftedIndexes) === JSON.stringify(oracle),
          {
            dates: set,
          },
        );
        const checksumOk = !masking.keepsChecksum || validateMnemonic(container, wordlist);
        const decoded =
          mode === "seedshift-legacy-valid"
            ? results.length === tail &&
              results.filter((result) => result.recoveredMnemonic === phrase).length === 1 &&
              results.every((result) => result.checksumValid)
            : results.length === 1 &&
              results[0]!.recoveredMnemonic === phrase &&
              results[0]!.checksumValid;
        check(
          `${label}: decode gives back the source; the codes keep the checksum where the mode says`,
          decoded && checksumOk,
          {
            results: results.length,
            checksumOk,
          },
        );
      }
    }
  }

// ---- Sources that are refused, and accepted spellings.
{
  const date = [parseDate("23-09-2026")];
  const encode = (text: string) => {
    try {
      return Masking.of("seedshift").encode(text, date).sourceMnemonic;
    } catch (error) {
      return String(error);
    }
  };
  const about = `${"abandon ".repeat(11)}about`;
  check(
    "source with a wrong checksum is refused",
    /invalid BIP39 checksum/u.test(encode(`${"abandon ".repeat(12)}`.trim())),
  );
  check(
    "source with an unknown word is refused, by place",
    encode(`${"abandon ".repeat(10)}abandom about`) ===
      "Error: Unknown English BIP39 word at position 11.",
  );
  check("source of 13 words is refused", /12, 15, 18, 21, or 24/u.test(encode(`${about} abandon`)));
  check(
    "upper case, extra spaces and NFKD forms are read as the phrase",
    encode(`  ${about.toUpperCase().replaceAll(" ", "   ")}\n`) === about,
  );
  check(
    "a Cyrillic look-alike letter is refused",
    /Unknown English BIP39 word/u.test(
      encode(about.replace("about", `${String.fromCodePoint(0x0430)}bout`)),
    ),
  );
  check(
    "too many dates for 12 words are refused",
    /at most 4 dates/u.test(
      (() => {
        try {
          Masking.of("seedshift").encode(
            about,
            ["01-01-2001", "02-02-2002", "03-03-2003", "04-04-2004", "05-05-2005"].map(parseDate),
          );
          return "";
        } catch (error) {
          return String(error);
        }
      })(),
    ),
  );
  check(
    "decode of codes that are not Seedshift-valid names the mode",
    (() => {
      try {
        Masking.of("seedshift").undo([...Array(11).fill(0), 4], date);
        return false;
      } catch (error) {
        return /checksum-valid Seedshift record has an invalid BIP39 checksum/u.test(String(error));
      }
    })(),
  );
  const parsed = parseInput("1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 4", "indexes");
  check(
    "word numbers separated by commas",
    JSON.stringify(parsed) === JSON.stringify([...Array(11).fill(0), 3]),
  );
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

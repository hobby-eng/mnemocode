// AUD-010 core probe: the five representations against independent packing oracles
// (core-oracle.ts) for all five phrase lengths, through the production entry points:
// formatEncoded(representMnemonic(...)), parseInput, detectInputFormats, EncodedBackup.read/text,
// decodeInputDirect and the MNC1 record round trip. Literal fixtures: Trezor BIP39 vectors
// (12/18/24 words), the first Traditional Chinese BIP39 words, and the twelve-word BIP39Colors
// vector that test/core.test.ts names as documented. Malformed inputs must be refused.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  detectInputFormats,
  formatEncoded,
  parseInput,
} from "../../../src/core/representations.js";
import { decodeInputDirect, representMnemonic } from "../../../src/core/seedshift.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
import { parseRecord } from "../../../src/record.js";
import {
  FORMATS,
  LENGTHS,
  oracleColors,
  oracleElements,
  oracleUnicode,
  publicEntropies,
} from "./core-oracle.ts";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown>): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}

// ---- Literal fixtures.
const TREZOR: Record<string, string> = {
  ["00".repeat(16)]: `${"abandon ".repeat(11)}about`,
  ["7f".repeat(16)]: "legal winner thank year wave sausage worth useful legal winner thank yellow",
  ["80".repeat(16)]:
    "letter advice cage absurd amount doctor acoustic avoid letter advice cage above",
  ["ff".repeat(16)]: `${"zoo ".repeat(11)}wrong`,
  ["00".repeat(24)]: `${"abandon ".repeat(17)}agent`,
  ["ff".repeat(24)]: `${"zoo ".repeat(17)}when`,
  ["00".repeat(32)]: `${"abandon ".repeat(23)}art`,
  ["ff".repeat(32)]: `${"zoo ".repeat(23)}vote`,
};
for (const [hex, phrase] of Object.entries(TREZOR)) {
  const entropy = Uint8Array.from(hex.match(/../gu)!.map((byte) => Number.parseInt(byte, 16)));
  const scure = entropyToMnemonic(entropy, wordlist);
  const production = formatEncoded(representMnemonic(phrase), "english");
  check(
    `Trezor vector ${hex.slice(0, 4)}.. (${hex.length / 2} bytes)`,
    scure === phrase && production === phrase,
    {
      scureMatches: scure === phrase,
      productionMatches: production === phrase,
    },
  );
}
const firstChinese = ["7684", "4E00", "662F", "5728"]; // 的 一 是 在, BIP39 chinese_traditional.txt lines 1-4
check(
  "Traditional Chinese list: first four codes",
  firstChinese.every((code, index) => oracleUnicode(index) === code),
  {
    oracle: [0, 1, 2, 3].map(oracleUnicode),
    expected: firstChinese,
  },
);
const unicodeOfAbout = formatEncoded(representMnemonic(TREZOR["00".repeat(16)]!), "unicode");
check(
  "abandon x11 about in unicode is 7684 x11 then 5728",
  unicodeOfAbout === "7684".repeat(11) + "5728",
  {
    production: unicodeOfAbout,
  },
);
const colorsVector = [
  "#01AB63",
  "#225531",
  "#3E8775",
  "#613911",
  "#7C5809",
  "#98BDC1",
  "#B8E412",
  "#E3AFE8",
];
const colorsPhrase = "master milk advice kid insect siege riot arrive alcohol mutual mask stay";
const colorsIndexes = colorsPhrase.split(" ").map((word) => wordlist.indexOf(word));
check(
  "BIP39Colors twelve-word vector: oracle and production",
  JSON.stringify(oracleColors(colorsIndexes)) === JSON.stringify(colorsVector) &&
    formatEncoded(representMnemonic(colorsPhrase), "colors") === colorsVector.join(" "),
  {
    oracle: oracleColors(colorsIndexes),
    production: formatEncoded(representMnemonic(colorsPhrase), "colors"),
  },
);

// ---- Every length, every format, three public entropies.
for (const words of LENGTHS)
  for (const [name, entropy] of Object.entries(publicEntropies(words))) {
    const phrase = entropyToMnemonic(entropy, wordlist);
    const indexes = phrase.split(" ").map((word) => wordlist.indexOf(word));
    for (const format of FORMATS) {
      const elements = oracleElements(indexes, format);
      const joiner = format === "unicode" || format === "colors-unicode" ? "" : " ";
      const expectedText = elements.join(joiner);
      const produced = formatEncoded(representMnemonic(phrase), format);
      const parsed = parseInput(expectedText, format);
      const detected = detectInputFormats(expectedText);
      const backup = EncodedBackup.read(expectedText, format, "direct");
      const record = backup.record();
      const fromRecord = parseRecord(record)!;
      const direct = decodeInputDirect(expectedText, format);
      const label = `${words} words ${name} ${format}`;
      check(`${label}: production text equals oracle`, produced === expectedText, {
        oracle: expectedText.slice(0, 48),
        production: produced.slice(0, 48),
      });
      check(
        `${label}: parse(oracle) gives the indexes, detection includes the format`,
        JSON.stringify(parsed) === JSON.stringify(indexes) && detected.includes(format),
        {
          detected,
        },
      );
      check(
        `${label}: EncodedBackup text and MNC1 record round trip`,
        backup.text() === expectedText &&
          fromRecord.format === format &&
          fromRecord.mode === "direct" &&
          JSON.stringify(parseInput(fromRecord.payload, format)) === JSON.stringify(indexes) &&
          direct.recoveredMnemonic === phrase &&
          direct.checksumValid,
        {
          record: record.slice(0, 40),
        },
      );
      // Separators: colors separated by commas and newlines, unicode codes by spaces, numbers by commas.
      const alternative =
        format === "colors"
          ? elements.join(",\n")
          : format === "english"
            ? elements.join("  ")
            : elements.join(format === "indexes" ? "," : " ");
      check(
        `${label}: alternative separators read the same`,
        JSON.stringify(parseInput(alternative, format)) === JSON.stringify(indexes),
        {},
      );
      if (format === "colors") {
        // Any order of the colors (README: "They may be kept in any order").
        const reversed = [...elements].reverse().join(" ");
        check(
          `${label}: colors in reverse order read the same`,
          JSON.stringify(parseInput(reversed, "colors")) === JSON.stringify(indexes),
          {},
        );
      }
      if (format === "colors-unicode") {
        // The earlier form: the Private Use symbols themselves.
        const symbols = elements
          .map((code) => String.fromCodePoint(Number.parseInt(code, 16)))
          .join("");
        check(
          `${label}: Private Use symbols read the same`,
          JSON.stringify(parseInput(symbols, "colors-unicode")) === JSON.stringify(indexes),
          {},
        );
      }
    }
  }

// ---- Malformed inputs are refused by EncodedBackup.read, not normalized into another phrase.
const twelve = TREZOR["00".repeat(16)]!.split(" ").map((word) => wordlist.indexOf(word));
const refusals: [string, string, Parameters<typeof parseInput>[1]][] = [
  [
    "11 words",
    twelve
      .slice(0, 11)
      .map((index) => wordlist[index])
      .join(" "),
    "english",
  ],
  ["13 numbers", [...twelve, 0].map((index) => String(index + 1)).join(" "), "indexes"],
  ["number 0", ["0", ...twelve.slice(1).map((index) => String(index + 1))].join(" "), "indexes"],
  [
    "number 2049",
    ["2049", ...twelve.slice(1).map((index) => String(index + 1))].join(" "),
    "indexes",
  ],
  [
    "number 1.5",
    ["1.5", ...twelve.slice(1).map((index) => String(index + 1))].join(" "),
    "indexes",
  ],
  ["unicode code not in list", ["0041", ...twelve.slice(1).map(oracleUnicode)].join(""), "unicode"],
  ["unicode 47 digits", twelve.map(oracleUnicode).join("").slice(0, 47), "unicode"],
  ["7 colors", oracleColors(twelve).slice(0, 7).join(" "), "colors"],
  [
    "color with wrong order tag",
    [...oracleColors(twelve).slice(0, 7), "#000000"].join(" "),
    "colors",
  ],
  ["colors-unicode outside the Private Use Area", "0041".repeat(16), "colors-unicode"],
];
for (const [name, text, format] of refusals) {
  let refused = false;
  let message = "";
  try {
    // EncodedBackup.read is the entry that holds codes to a phrase's count (parseInput alone
    // reads any count; detectInputFormats and the decoders check it).
    EncodedBackup.read(text, format, "direct");
  } catch (error) {
    refused = true;
    message = String(error);
  }
  check(`refuses ${name} (${format})`, refused, { message });
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

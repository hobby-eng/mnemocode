// AUD-010 core probe: the search for codes marked with ? (src/core/missing-codes.ts), as Decode
// runs it, against an independent oracle (core-oracle.ts):
//   - every representation (english, indexes, unicode, colors, colors-unicode), every length and
//     every mode (direct, seedshift, seedshift-legacy, seedshift-legacy-valid);
//   - the places and combinations the marks leave, computed from the oracle's own packing;
//   - the candidates in order: those with a valid BIP39 checksum where the codes keep one
//     (keepsChecksum || !masked), every combination for the Original Seedshift;
//   - run() with a check that knows the true codes finds them once, in their form and mode;
//   - bounds: MAX_SEARCH_COMBINATIONS at the limit and above, no mark, wrong counts, maxFound.
// Public fixtures only: counting entropy, one synthetic date.

import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { MAX_SEARCH_COMBINATIONS } from "../../../src/core/candidates.js";
import { Masking, type MaskingMode } from "../../../src/core/masking.js";
import { MissingCodes } from "../../../src/core/missing-codes.js";
import { parseInput } from "../../../src/core/representations.js";
import {
  FORMATS,
  LENGTHS,
  oracleChecksumValid,
  oracleElements,
  publicEntropies,
  type Format,
} from "./core-oracle.ts";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
/** Element-wise equality of two lists of candidates (number arrays). */
function sameLists(
  left: readonly (readonly number[])[],
  right: readonly (readonly number[])[],
): boolean {
  if (left.length !== right.length) return false;
  for (let at = 0; at < left.length; at += 1) if (!sameCodes(left[at]!, right[at]!)) return false;
  return true;
}
function sameCodes(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, at) => value === right[at]);
}
function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return undefined;
}

const MODES: readonly MaskingMode[] = [
  "direct",
  "seedshift",
  "seedshift-legacy",
  "seedshift-legacy-valid",
];
const DATE = { year: 2026, month: 9, day: 23 };
const EXPECTED_CHECKSUMMED: Record<MaskingMode, boolean> = {
  direct: true,
  seedshift: true,
  "seedshift-legacy": false,
  "seedshift-legacy-valid": true,
};

/** The places of the oracle: each place's possible indexes, ascending. */
function oraclePlaces(codes: readonly number[], format: Format, marked: number): number[][] {
  if (format !== "colors" && format !== "colors-unicode")
    return codes.map((code, place) =>
      place === marked ? Array.from({ length: 2048 }, (_, i) => i) : [code],
    );
  // A color that cannot be read leaves its six decimal digits open.
  const digits = codes
    .map((code) => String(code + 1).padStart(4, "0"))
    .join("")
    .split("");
  for (let at = marked * 6; at < marked * 6 + 6; at += 1) digits[at] = "?";
  return codes.map((_, place) => {
    const pattern = digits.slice(place * 4, place * 4 + 4);
    const fits: number[] = [];
    for (let number = 1; number <= 2048; number += 1) {
      const written = String(number).padStart(4, "0");
      if (pattern.every((digit, at) => digit === "?" || digit === written[at]))
        fits.push(number - 1);
    }
    return fits;
  });
}

/** Every combination of the places, the last place changing fastest. */
function* oracleCombinations(places: readonly number[][]): Generator<number[]> {
  const chosen = places.map(() => 0);
  for (;;) {
    yield chosen.map((choice, place) => places[place]![choice]!);
    let place = places.length - 1;
    while (place >= 0 && chosen[place] === places[place]!.length - 1) {
      chosen[place] = 0;
      place -= 1;
    }
    if (place < 0) return;
    chosen[place]! += 1;
  }
}

/** The text with element `marked` replaced by ?; colors-unicode marks the color's first code. */
function markedText(
  codes: readonly number[],
  format: Format,
  marked: number,
  joined = false,
): string {
  const elements = oracleElements(codes, format);
  if (format === "colors-unicode") elements[marked * 2] = "?";
  else elements[marked] = "?";
  return elements.join(joined ? "" : " ");
}

for (const words of LENGTHS) {
  const phrase = entropyToMnemonic(publicEntropies(words).counting!, wordlist);
  for (const mode of MODES) {
    const masking = Masking.of(mode);
    const codes = masking.masked
      ? masking.encode(phrase, [DATE]).shiftedIndexes
      : phrase.split(" ").map((word) => wordlist.indexOf(word));
    for (const format of FORMATS) {
      const colorForm = format === "colors" || format === "colors-unicode";
      // A word in the middle and the last word; for colors the second color.
      const marks = colorForm ? [1] : [2, words - 1];
      for (const marked of marks) {
        const texts =
          format === "unicode" || format === "colors-unicode"
            ? [markedText(codes, format, marked), markedText(codes, format, marked, true)]
            : [markedText(codes, format, marked)];
        for (const text of texts) {
          const label = `${words} words, ${mode}, ${format}, mark ${marked + 1}${text.includes(" ") ? "" : " (joined)"}`;
          const places = oraclePlaces(codes, format, marked);
          const missing = places.flatMap((place, index) => (place.length > 1 ? [index + 1] : []));
          const combinations = places.reduce((all, place) => all * place.length, 1);
          const checksummed = EXPECTED_CHECKSUMMED[mode];
          const expected = [...oracleCombinations(places)].filter(
            (candidate) => !checksummed || oracleChecksumValid(candidate),
          );
          let search: MissingCodes;
          try {
            search = MissingCodes.read(text, format, mode);
          } catch (error) {
            check(`${label}: read`, false, { error: String(error) });
            continue;
          }
          const produced = [...search.candidates()];
          check(
            `${label}: places, combinations, checksum rule`,
            JSON.stringify(search.missingPlaces) === JSON.stringify(missing) &&
              search.combinations === combinations &&
              search.checksummed === checksummed &&
              search.wordCount === words &&
              MissingCodes.formats(text).includes(format),
            {
              missing: search.missingPlaces,
              oracleMissing: missing,
              combinations: search.combinations,
              oracleCombinations: combinations,
              checksummed: search.checksummed,
              formats: MissingCodes.formats(text),
            },
          );
          check(`${label}: candidates equal the oracle in order`, sameLists(produced, expected), {
            produced: produced.length,
            oracle: expected.length,
            expectedEstimate: search.expected,
          });
          const truth = JSON.stringify(codes);
          const result = await search.run({
            check: (candidate) => sameCodes(candidate, codes),
            turn: async () => {},
          });
          const found = result.found[0];
          check(
            `${label}: run finds the true codes once, in their form and mode`,
            result.passed === 1 &&
              result.count === expected.length &&
              found !== undefined &&
              JSON.stringify(found.indexes) === truth &&
              found.format === format &&
              found.mode === mode &&
              JSON.stringify(parseInput(found.text(), format)) === truth,
            {
              passed: result.passed,
              count: result.count,
            },
          );
        }
      }
    }
  }
}

// ---- Two unknown codes of 12 words: 4,194,304 combinations, compared in lockstep.
{
  const phrase = entropyToMnemonic(publicEntropies(12).counting!, wordlist);
  const codes = Masking.of("seedshift").encode(phrase, [DATE]).shiftedIndexes;
  const elements = oracleElements(codes, "indexes");
  elements[3] = "?";
  elements[7] = "?";
  const search = MissingCodes.read(elements.join(" "), "indexes", "seedshift");
  const places = codes.map((code, place) =>
    place === 3 || place === 7 ? Array.from({ length: 2048 }, (_, i) => i) : [code],
  );
  const oracle = oracleCombinations(places);
  let count = 0;
  let mismatch: number | undefined;
  for (const candidate of search.candidates()) {
    let next = oracle.next();
    while (!next.done && !oracleChecksumValid(next.value)) next = oracle.next();
    if (next.done || !sameCodes(next.value, candidate)) {
      mismatch = count;
      break;
    }
    count += 1;
  }
  let rest = 0;
  for (let next = oracle.next(); !next.done; next = oracle.next())
    if (oracleChecksumValid(next.value)) rest += 1;
  check(
    "12 words, seedshift, indexes, codes 4 and 8 unknown: candidates equal the oracle",
    mismatch === undefined && rest === 0,
    {
      combinations: search.combinations,
      candidates: count,
      expectedEstimate: search.expected,
      mismatchAt: mismatch,
      oracleLeft: rest,
    },
  );
}

// ---- Bounds.
{
  const phrase = entropyToMnemonic(publicEntropies(12).zeros!, wordlist).split(" ");
  const with4 = ["?", "?", "zoo|zone|zero|youth", ...phrase.slice(3)].join(" ");
  const at = MissingCodes.read(with4, "english", "seedshift");
  check(
    "english ? ? and four words joined by |: exactly MAX_SEARCH_COMBINATIONS is accepted",
    at.combinations === MAX_SEARCH_COMBINATIONS,
    { combinations: at.combinations, limit: MAX_SEARCH_COMBINATIONS },
  );
  const with5 = ["?", "?", "zoo|zone|zero|youth|young", ...phrase.slice(3)].join(" ");
  check(
    "one combination class above the limit (five words) is refused",
    refusal(() => MissingCodes.read(with5, "english", "seedshift")) !== undefined,
    {
      message: refusal(() => MissingCodes.read(with5, "english", "seedshift")),
    },
  );
  const three = ["?", "?", "?", ...phrase.slice(3)].join(" ");
  check(
    "three unknown words of 12 are refused",
    refusal(() => MissingCodes.read(three, "english", "direct")) !== undefined,
    {
      message: refusal(() => MissingCodes.read(three, "english", "direct")),
    },
  );
  check(
    "codes with no mark are refused",
    refusal(() => MissingCodes.read(phrase.join(" "), "english", "direct")) !== undefined,
    {
      message: refusal(() => MissingCodes.read(phrase.join(" "), "english", "direct")),
    },
  );
  check(
    "11 codes with a mark are refused",
    refusal(() => MissingCodes.read(["?", ...phrase.slice(2)].join(" "), "english", "direct")) !==
      undefined,
    {
      message: refusal(() =>
        MissingCodes.read(["?", ...phrase.slice(2)].join(" "), "english", "direct"),
      ),
    },
  );
  const one = MissingCodes.read(["?", ...phrase.slice(1)].join(" "), "english", "seedshift-legacy");
  for (const maxFound of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let message: string | undefined;
    try {
      await one.run({ check: () => true, maxFound, turn: async () => {} });
    } catch (error) {
      message = String(error);
    }
    check(
      `run refuses maxFound ${maxFound}`,
      message !== undefined && message.startsWith("RangeError"),
      { message },
    );
  }
  const capped = await one.run({ check: () => true, maxFound: 1, turn: async () => {} });
  check(
    "run with maxFound 1 keeps one and counts every pass",
    capped.found.length === 1 && capped.passed === 2048 && capped.count === 2048,
    {
      found: capped.found.length,
      passed: capped.passed,
      count: capped.count,
    },
  );
  const aborted = new AbortController();
  aborted.abort(new Error("stopped"));
  let abortMessage: string | undefined;
  try {
    await one.run({ check: () => true, signal: aborted.signal });
  } catch (error) {
    abortMessage = String(error);
  }
  check(
    "run with an aborted signal throws its reason before any check",
    abortMessage === "Error: stopped",
    { abortMessage },
  );
  check(
    "String/JSON of MissingCodes are redacted",
    String(one) === "[MissingCodes: redacted]" &&
      JSON.stringify(one) === '"[MissingCodes: redacted]"',
  );
}

// ---- Word numbers with leading zeros: parseInput reads "0001" as word 1; a marked text?
{
  const numbers = oracleElements(
    Array(12)
      .fill(0)
      .map((_, i) => (i === 11 ? 3 : 0)),
    "indexes",
  );
  const padded = numbers.map((number) => number.padStart(4, "0"));
  const complete = JSON.stringify(parseInput(padded.join(" "), "indexes"));
  const markedPadded = ["?", ...padded.slice(1)].join(" ");
  const message = refusal(() => MissingCodes.read(markedPadded, "indexes", "direct"));
  console.log(
    JSON.stringify({
      observation: "zero-padded word numbers",
      completeParsedAs: complete,
      markedRefusal: message ?? "accepted",
    }),
  );
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

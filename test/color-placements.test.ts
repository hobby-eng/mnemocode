import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hexUnits, UNICODE_CODE_DIGITS } from "../src/core/code-text.js";
import {
  colorsToIndexes,
  colorsToUnicode,
  indexesToColors,
  wordPositionPlacements,
} from "../src/core/colors.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { DATE, ZERO_ENTROPY_PHRASES } from "./helpers/test-phrase.js";

// Colors with an unread one whose order tags start later than 0, as older records may
// (AUD-037-FUN004): every placement that the tags read allow is searched, and colors typed in the
// order of their tags tell it. Public data: the phrases of zero entropy, masked with one date.

/** The phrases of zero entropy of every length, the shortest first. */
const PHRASES = Object.values(ZERO_ENTROPY_PHRASES);
const PARSED_DATE = parseDate(DATE);
/** The digits of a color's tag before its six digits of word positions (colors.ts). */
const TAG_DIGITS = 2;

/** `colors` with each order tag raised by `offset`, as a record that starts its tags later. */
function shifted(colors: readonly string[], offset: number): string[] {
  return colors.map((color) => {
    const digits = Number.parseInt(color.slice(1), 16).toString(10).padStart(8, "0");
    const tag = Number(digits.slice(0, TAG_DIGITS)) + offset;
    const value = Number(`${tag}${digits.slice(TAG_DIGITS)}`);
    return `#${value.toString(16).padStart(6, "0").toUpperCase()}`;
  });
}

/** `colors` written in `form` with the color at `unread` marked with ?. */
function marked(
  colors: readonly string[],
  unread: number,
  form: "colors" | "colors-unicode",
): string {
  if (form === "colors")
    return colors.map((color, at) => (at === unread ? "?" : color.slice(1))).join(" ");
  return colors
    .flatMap((color, at) =>
      at === unread
        ? ["????", "????"]
        : (hexUnits(colorsToUnicode([color]), UNICODE_CODE_DIGITS) ?? []),
    )
    .join(" ");
}

/** Whether `indexes` are among the candidates of `codes`, which stop at them. */
function isCandidate(codes: MissingCodes, indexes: readonly number[]): boolean {
  for (const candidate of codes.candidates())
    if (candidate.every((index, at) => index === indexes[at])) return true;
  return false;
}

/** A stand-in for the host's fingerprint. */
const fingerprint = (mnemonic: string): string =>
  createHash("sha256").update(mnemonic).digest("hex").slice(0, 8);

describe("marked colors of a record whose tags start later", () => {
  it.each(PHRASES.map((phrase) => [phrase.split(" ").length, phrase] as const))(
    "are found for %i words, the lowest, a middle or the highest color unread",
    async (_, phrase) => {
      const encoded = encodeMnemonic(phrase, [PARSED_DATE]);
      const indexes = encoded.shiftedIndexes;
      const colors = indexesToColors(indexes);
      const step = colors.length === 8 ? 2 : 1;
      for (const offset of colors.length === 10 ? [step, 3] : [step]) {
        const record = shifted(colors, offset);
        // A record that complete colors decode, as older readers wrote them.
        expect(colorsToIndexes(record)).toEqual(indexes);
        const last = colors.length - 1;
        // Colors and Color Unicode give the same colors: one form for each color unread, both for
        // the highest.
        for (const [unread, form] of [
          [0, "colors"],
          [Math.floor(colors.length / 2), "colors"],
          [last, "colors"],
          [last, "colors-unicode"],
        ] as const) {
          const where = `offset ${offset}, color ${unread + 1}, ${form}`;
          using codes = MissingCodes.read(marked(record, unread, form), form, "seedshift");
          expect(isCandidate(codes, indexes), where).toBe(true);
        }
        if (offset !== step) continue;
        // The fingerprint finds them where the highest color is unread, which a start of 0 also
        // fits, and found nothing before.
        using codes = MissingCodes.read(marked(record, last, "colors"), "colors", "seedshift");
        const found = await new MissingCodesSearch(codes, fingerprint)
          .byEncodedFingerprint(fingerprint(encoded.shiftedEnglish.join(" ")))
          .run();
        expect(found.kind, `offset ${offset}`).toBe("found");
        if (found.kind === "found") expect(found.backup.indexes).toEqual(indexes);
        // And the wallet, with the date known: the same search, so once.
        if (colors.length !== 8) continue;
        const wallet = await new MissingCodesSearch(codes, fingerprint)
          .byWallet(
            async (mnemonic) => ({ matched: mnemonic === phrase }),
            DatesAnswer.of([PARSED_DATE]),
          )
          .run();
        expect(wallet.kind, `offset ${offset}, wallet`).toBe("found");
      }
    },
  );

  it("take the placement that colors typed in order tell, and every one in another order", () => {
    const colors = indexesToColors(encodeMnemonic(PHRASES[0]!, [PARSED_DATE]).shiftedIndexes);
    // Tags from 0 with the first color unread fit a start one step later too: in their order the
    // colors tell 0, in another order both starts are placements, the lowest first.
    const [unread, ...read] = [undefined, ...colors.slice(1)];
    expect(wordPositionPlacements([unread, ...read])).toHaveLength(1);
    const placements = wordPositionPlacements([...[...read].reverse(), unread]);
    expect(placements.map((patterns) => [patterns[0], patterns.at(-1)])).toEqual([
      ["????", expect.stringMatching(/^\d{4}$/u)],
      [expect.stringMatching(/^\d{4}$/u), "????"],
    ]);
    // Where the later start gives no word, as nearly always, the record keeps its one placement.
    const shuffled = marked(colors.slice(1).reverse().concat(colors[0]!), 7, "colors");
    expect(MissingCodes.read(shuffled, "colors", "seedshift").placements).toEqual([[1, 2]]);
  });

  it("search every placement once, and each candidate once", () => {
    // Colors whose words fit both starts: the same six digits under every tag from 2.
    const same = Array.from(
      { length: 8 },
      (_, at) =>
        `#${Number(`${2 + 2 * at}100110`)
          .toString(16)
          .toUpperCase()
          .padStart(6, "0")}`,
    );
    // Typed in order, the highest unread: the start of 2, and the first color unread: 0.
    using last = MissingCodes.read(marked(same, 7, "colors"), "colors", "seedshift");
    expect(last.placements).toEqual([[11, 12]]);
    const typedFirst = ["?", ...same.slice(0, 7).map((color) => color.slice(1))].join(" ");
    using first = MissingCodes.read(typedFirst, "colors", "seedshift");
    expect(first.placements).toEqual([[1, 2]]);
    // In another order, both: counted and bounded together, and named.
    const shuffled = same
      .slice(0, 7)
      .reverse()
      .map((color) => color.slice(1));
    using both = MissingCodes.read([...shuffled, "?"].join(" "), "colors", "seedshift");
    expect(both.placements).toEqual([
      [1, 2],
      [11, 12],
    ]);
    expect(both.combinations).toBe(first.combinations + last.combinations);
    expect(both.expected).toBe(first.expected + last.expected);
    expect(MissingCodesSearch.placesText(both)).toBe("Words 1 and 2 or words 11 and 12");
    // Each placement gives its candidates, and the codes that both give come once.
    const candidates = [...both.candidates()];
    expect(new Set(candidates.map(String)).size).toBe(candidates.length);
    const complete = colorsToIndexes(same);
    const differs = (codes: number[], from: number, to: number): boolean =>
      codes.slice(from, to).some((code, at) => code !== complete[from + at]);
    expect(candidates.some((codes) => differs(codes, 0, 2) && !differs(codes, 2, 12))).toBe(true);
    expect(candidates.some((codes) => differs(codes, 10, 12) && !differs(codes, 0, 10))).toBe(true);
  });
});

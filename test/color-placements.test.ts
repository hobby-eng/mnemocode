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
import { DATE, TEST_INDEXES, ZERO_ENTROPY_PHRASES } from "./helpers/test-phrase.js";

// Colors with an unread one whose order tags start later than 0, as older records may
// (AUD-037-FUN004): every placement that the tags read allow is searched, regardless of typed
// order. Public data: the phrases of zero entropy, masked with one date.

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
  it.each(["colors", "colors-unicode"] as const)(
    "keeps the original phrase when a missing leading color is moved to the end in %s",
    (form) => {
      const colors = indexesToColors(TEST_INDEXES);
      const rotated = [...colors.slice(1), colors[0]!];
      using codes = MissingCodes.read(marked(rotated, rotated.length - 1, form), form, "direct");
      expect(isCandidate(codes, TEST_INDEXES)).toBe(true);
    },
  );

  it.each(PHRASES.map((phrase) => [phrase.split(" ").length, phrase] as const))(
    "preserves every allowed placement through all rotations with each color unread for %i words",
    (_, phrase) => {
      const colors = indexesToColors(encodeMnemonic(phrase, [PARSED_DATE]).shiftedIndexes);
      for (let unread = 0; unread < colors.length; unread += 1) {
        const marked = colors.map((color, at) => (at === unread ? undefined : color));
        const placements = wordPositionPlacements(marked);
        for (let rotation = 1; rotation < marked.length; rotation += 1) {
          const moved = [...marked.slice(rotation), ...marked.slice(0, rotation)];
          expect(wordPositionPlacements(moved), `unread ${unread}, rotation ${rotation}`).toEqual(
            placements,
          );
        }
      }
    },
  );

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

  it("preserve every tag-compatible start regardless of the typed order", () => {
    const colors = indexesToColors(encodeMnemonic(PHRASES[0]!, [PARSED_DATE]).shiftedIndexes);
    // Tags from 0 with the first color unread fit a start one step later too. Both starts remain
    // placements in every typed order, the lowest first.
    const [unread, ...read] = [undefined, ...colors.slice(1)];
    const placements = wordPositionPlacements([...[...read].reverse(), unread]);
    expect(wordPositionPlacements([unread, ...read])).toEqual(placements);
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
    // The same readable tags fit starts of 0 and 2, with the mark first or last alike.
    using last = MissingCodes.read(marked(same, 7, "colors"), "colors", "seedshift");
    expect(last.placements).toEqual([
      [1, 2],
      [11, 12],
    ]);
    const typedFirst = ["?", ...same.slice(0, 7).map((color) => color.slice(1))].join(" ");
    using first = MissingCodes.read(typedFirst, "colors", "seedshift");
    expect(first.placements).toEqual(last.placements);
    // In another order too: counted and bounded together, and named.
    const shuffled = same
      .slice(0, 7)
      .reverse()
      .map((color) => color.slice(1));
    using both = MissingCodes.read([...shuffled, "?"].join(" "), "colors", "seedshift");
    expect(both.placements).toEqual([
      [1, 2],
      [11, 12],
    ]);
    // 2,048 words times 21 numbers ending in 10 for the missing prefix, plus 100 numbers
    // starting with 10 times 2,048 words for the suffix; the 12-word checksum keeps 1/16.
    expect(both.combinations).toBe(247808);
    expect(both.expected).toBe(15488);
    expect(first.combinations).toBe(both.combinations);
    expect(last.combinations).toBe(both.combinations);
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

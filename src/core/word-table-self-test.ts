// Export known answers from the published English and Traditional Chinese BIP39 lists:
// abandon/的 at 1, zoo/歇 at 2048. No host services or private data.
import { BIP39_DICTIONARY_SIZE } from "./bip39-sizes.js";
import { expectRefused, expectSame } from "./self-test-check.js";
import { WordTable, type WordTableFormat } from "./word-table.js";

/** Checks each numbered dictionary's header, boundary words, row count and refused format. */
export function checkWordTableStartup(): void {
  for (const symbol of ["\uD800", "\uDC00"])
    expectRefused(
      () => WordTable.unicodeHex(symbol),
      /not one Unicode scalar value/u,
      "An isolated UTF-16 surrogate",
    );
  const answers: readonly [WordTableFormat | undefined, string, string, string][] = [
    [undefined, "index\tenglish\tunicode_hex", "1\tabandon\t7684", "2048\tzoo\t6B47"],
    ["english", "index\tenglish", "1\tabandon", "2048\tzoo"],
    ["chinese", "index\tchinese", "1\t的", "2048\t歇"],
    ["unicode", "index\tchinese\tunicode_hex", "1\t的\t7684", "2048\t歇\t6B47"],
    [
      "mapping",
      "index\tenglish\tchinese\tunicode_hex",
      "1\tabandon\t的\t7684",
      "2048\tzoo\t歇\t6B47",
    ],
  ];
  for (const [format, header, first, last] of answers) {
    const rows = WordTable.text(format).trimEnd().split("\n");
    expectSame(rows.length, BIP39_DICTIONARY_SIZE + 1, "Numbered dictionary row count");
    expectSame(rows[0], header, "Numbered dictionary header");
    expectSame(rows[1], first, "Numbered dictionary first word");
    expectSame(rows.at(-1), last, "Numbered dictionary last word");
  }
  expectRefused(
    () => WordTable.text("unknown" as never),
    /Word list format/u,
    "An unknown numbered dictionary format",
  );
  for (const selector of ["constructor", "__proto__", "missing"])
    expectRefused(
      () => WordTable.lookup(selector as never, "1"),
      /Word table lookup/u,
      "An invalid word-table selector",
    );
}

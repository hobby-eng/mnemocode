// AUD-010 core probe: trimWhiteSpace (src/core/white-space.ts) removes exactly Unicode's
// White_Space at either end, as Rust's str::trim does. The oracle is the White_Space list of
// Unicode's PropList.txt (Unicode 15/16, unchanged since 6.3): 0009..000D, 0020, 0085, 00A0, 1680,
// 2000..200A, 2028, 2029, 202F, 205F, 3000. Every BMP code point is tried at both ends; inner
// white space stays. U+FEFF and U+200B, which are no White_Space, stay.

import { trimWhiteSpace } from "../../../src/core/white-space.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}

const WHITE_SPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);
const wrong: string[] = [];
for (let point = 0; point <= 0xffff; point += 1) {
  if (point >= 0xd800 && point <= 0xdfff) continue;
  const symbol = String.fromCodePoint(point);
  const trimmed = trimWhiteSpace(`${symbol}a b${symbol}`);
  const expected = WHITE_SPACE.has(point) ? "a b" : `${symbol}a b${symbol}`;
  if (trimmed !== expected) wrong.push(point.toString(16).toUpperCase().padStart(4, "0"));
}
check(
  "every BMP code point: removed at the ends exactly when it is White_Space",
  wrong.length === 0,
  {
    wrong: wrong.slice(0, 20),
  },
);
// Built from code points, so that no formatter turns the escapes into invisible characters.
const at = (...points: number[]) => String.fromCodePoint(...points);
check(
  "runs of white space at both ends, inner white space kept",
  trimWhiteSpace(`${at(0x3000, 0x85, 0x20, 0x09)}a${at(0x20, 0xa0, 0x20)}b${at(0x2029, 0x0a)}`) ===
    `a${at(0x20, 0xa0, 0x20)}b`,
);
check(
  "U+FEFF and U+200B stay",
  trimWhiteSpace(`${at(0xfeff)}a${at(0x200b)}`) === `${at(0xfeff)}a${at(0x200b)}`,
);
check("all white space gives the empty text", trimWhiteSpace(at(0x20, 0x2028, 0x3000)) === "");

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

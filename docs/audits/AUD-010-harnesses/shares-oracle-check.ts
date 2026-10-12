// AUD-010 "shares": checks the independent oracle (shares-oracle.ts) against published data before
// the other probes rely on it. Public data only: vectors/sskr-v1.json (BCR-2020-011 shares and
// their Bytewords, colors computed with Python zlib) and the BIP39-list known answers.
// Run: node --import tsx docs/audits/AUD-010-harnesses/shares-oracle-check.ts

import { readFileSync } from "node:fs";
import { bytewords as projectBytewords } from "../../../src/sskr/bytewords-list.ts";
import { sskrVector } from "../../../src/sskr/known-answers.ts";
import {
  BYTEWORDS,
  oracleColors,
  oracleIndexes,
  oracleUnicode,
  oracleWords,
  reference,
} from "./shares-oracle.ts";

const vectors = JSON.parse(
  readFileSync(new URL("../../../vectors/sskr-v1.json", import.meta.url), "utf8"),
);
let failures = 0;
function same(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}\n  actual:   ${a}\n  expected: ${e}`);
}

same("Bytewords table has 256 distinct words", new Set(BYTEWORDS).size, 256);
same(
  "Bytewords minimal pairs are distinct",
  new Set(BYTEWORDS.map((word) => word[0]! + word[3]!)).size,
  256,
);
// The five published Bytewords are a quorum of the eight shares, not the first five: each must
// equal the oracle's Bytewords of exactly one published share, and all five must be different.
const published = vectors.official.bytewords as string[];
const oracleAll = (vectors.official.shares as string[]).map((ur) => oracleWords(ur).join(" "));
const matched = published.map((words) => oracleAll.indexOf(words));
same(
  "each published BCR-2020-011 Bytewords text equals the oracle's Bytewords of one published share",
  matched.every((index) => index >= 0) && new Set(matched).size === published.length,
  true,
);
console.log(`  matched share indexes: ${JSON.stringify(matched)}`);
same(
  "oracle colors of published share 0 equal the Python-computed colors",
  oracleColors(vectors.official.shares[0]),
  vectors.official.firstShareColors,
);
same(
  "oracle word numbers of published share 0 equal the independently computed known answer",
  oracleIndexes(sskrVector.shares[0]).join(" "),
  sskrVector.firstShareNumbers,
);
same(
  "oracle Unicode codes of published share 0 equal the independently computed known answer",
  oracleUnicode(sskrVector.shares[0]).join(" "),
  sskrVector.firstShareUnicode,
);
same("oracle reference of published share 0", reference(vectors.official.shares[0]), "4BBF-1-1");
for (const set of vectors.deterministic as { name: string; shares: string[]; colors: string[][] }[])
  same(
    `oracle colors of ${set.name} shares equal the recorded fixture colors`,
    set.shares.slice(0, set.colors.length).map(oracleColors),
    set.colors,
  );
// Informative: the oracle's table and the project's table agree word for word.
same("oracle Bytewords table equals src/sskr/bytewords-list.ts", BYTEWORDS, projectBytewords);
console.log(`Oracle checks: ${failures === 0 ? "all passed" : `${failures} failed`}.`);
process.exitCode = failures === 0 ? 0 : 1;

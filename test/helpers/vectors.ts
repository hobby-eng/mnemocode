// The public test vectors of vectors/, typed as the tests read them. Each call reads the file
// anew, so that a test may change what it gets. Public test data only.

import { readFileSync } from "node:fs";

/** A group of an SSKR split: how many of its shares restore it, of how many. */
export interface SskrGroup {
  threshold: number;
  count: number;
}

/** A split of a public entropy with a test-only seed, and the shares it gives. */
export interface SskrVector {
  name: string;
  entropy: string;
  testOnlySeed: string;
  groupThreshold: number;
  groups: SskrGroup[];
  shares: string[];
  colors: string[][];
}

/** vectors/sskr-v1.json: Blockchain Commons' published vector and the deterministic splits. */
export interface SskrVectors {
  version: number;
  official: {
    entropy: string;
    groupThreshold: number;
    groups: SskrGroup[];
    shares: string[];
    bytewords: string[];
    validQuorums: number[][];
    invalidQuorums: number[][];
    firstShareTransportHex: string;
    firstShareColors: string[];
  };
  deterministic: SskrVector[];
}

/** A word list that a vector file names by its length and hash. */
export interface WordlistFacts {
  language: string;
  length: number;
  sha256_newline_joined: string;
}

/** A phrase and what MnemoCode writes for it in each format. */
export interface MnemocodeVector {
  name: string;
  mode: string;
  sourceMnemonic: string;
  dates: string[];
  english: string;
  indexes: string;
  unicode: string;
  colors: string;
  colorsUnicode: string;
  sourceFingerprint: string;
  encodedFingerprint: string;
}

/** vectors/mnemocode-v1.json: the word lists and the vectors of every format. */
export interface MnemocodeVectors {
  version: number;
  wordlist: WordlistFacts;
  traditionalChineseWordlist: WordlistFacts;
  vectors: MnemocodeVector[];
}

/** An age file of vectors/candidates-v1.json, by its name. */
export interface AgeFile {
  name: string;
  file: string;
}

/** vectors/candidates-v1.json: lists of candidates and the age files that hold them. */
export interface CandidateVectors {
  version: number;
  lists: { name: string; records: unknown[]; bytes: string }[];
  invalidLists: { name: string; refusal: string; bytes: string }[];
  age: {
    identity: string;
    recipient: string;
    passphrase: string;
    hybridIdentity: string;
    plaintext: string;
    open: AgeFile[];
    refuse: AgeFile[];
  };
}

/** The vector file `name` of vectors/. */
function vectorFile(name: string): unknown {
  const text = readFileSync(new URL(`../../vectors/${name}`, import.meta.url), "utf8");
  return JSON.parse(text);
}

/** vectors/sskr-v1.json. */
export function sskrVectors(): SskrVectors {
  // The repository's own file: a field it lacks fails the test that reads it.
  return vectorFile("sskr-v1.json") as SskrVectors;
}

/** vectors/mnemocode-v1.json. */
export function mnemocodeVectors(): MnemocodeVectors {
  // The repository's own file: a field it lacks fails the test that reads it.
  return vectorFile("mnemocode-v1.json") as MnemocodeVectors;
}

/** vectors/candidates-v1.json. */
export function candidateVectors(): CandidateVectors {
  // The repository's own file: a field it lacks fails the test that reads it.
  return vectorFile("candidates-v1.json") as CandidateVectors;
}

/** The first share of the first deterministic split: a public share for a test that needs one. */
export function publicShare(): string {
  return sskrVectors().deterministic[0]!.shares[0]!;
}

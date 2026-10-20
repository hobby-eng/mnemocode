// The public test vectors of vectors/, typed as the tests read them. Each call gives a copy of its
// own, so that a test may change what it gets. Public test data only.

import candidatesFile from "../../vectors/candidates-v1.json" with { type: "json" };
import mnemocodeFile from "../../vectors/mnemocode-v1.json" with { type: "json" };
import sskrFile from "../../vectors/sskr-v1.json" with { type: "json" };

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
  /** The fingerprints of the phrase and of its encoded form, which only the direct vector has. */
  sourceFingerprint?: string;
  encodedFingerprint?: string;
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

// The compiler checks each file against its type here: a field that a file lacks, or that has
// another type, is an error of the tests' type check.
const SSKR: SskrVectors = sskrFile;
const MNEMOCODE: MnemocodeVectors = mnemocodeFile;
const CANDIDATES: CandidateVectors = candidatesFile;

/** vectors/sskr-v1.json. */
export function sskrVectors(): SskrVectors {
  return structuredClone(SSKR);
}

/** vectors/mnemocode-v1.json. */
export function mnemocodeVectors(): MnemocodeVectors {
  return structuredClone(MNEMOCODE);
}

/** vectors/candidates-v1.json. */
export function candidateVectors(): CandidateVectors {
  return structuredClone(CANDIDATES);
}

/**
 * The bytes that `hex`, the hexadecimal text of a vector, stands for, decoded by Node.js apart
 * from the program's own decoder.
 */
export function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** The first share of the first deterministic split: a public share for a test that needs one. */
export function publicShare(): string {
  return sskrVectors().deterministic[0]!.shares[0]!;
}

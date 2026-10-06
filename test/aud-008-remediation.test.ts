// Regression tests for the findings of AUD-008 (docs/audits/AUD-008-2026-10-06.md), each named by
// its finding ID. Public test vectors and synthetic data only.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import {
  masterFingerprint,
  matchBitcoinEvidence,
  type BitcoinEvidence,
} from "../src/bitcoin-evidence.js";
import { encodeMnemonic, parseDate, parseDatePattern } from "../src/core.js";
import { dateRecoveryCandidates } from "../src/core/date-recovery.js";
import { searchCandidates, searchCombinations, type WordSearch } from "../src/core/candidates.js";
import { rowsOf } from "../src/cli/terminal-choice.js";
import { checkShareBackup } from "../src/cli/backup-check.js";
import { crc32 } from "../src/sskr/checksum.js";
import { readRepairableShare } from "../src/sskr/repair.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { transportToUr, urToTransport, writeShare } from "../src/sskr/transport.js";
import { bytewords } from "../src/sskr/bytewords-list.js";
import "../src/sskr/share-platform-node.js";

const publicMnemonic = "abandon ".repeat(11) + "about";
const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as {
  deterministic: { entropy: string; shares: string[] }[];
  official: { entropy: string; shares: string[] };
};
const location = { network: "mainnet" as const, account: 0, branch: 0, index: 0 };

/** `body` followed by its CRC32, as a share's transport bytes end. */
function withCrc(body: Uint8Array): Uint8Array {
  const crc = crc32(body);
  return Uint8Array.from([...body, crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255]);
}

/** A share changed by `change`, with its CRC32 written anew so that only the change is wrong. */
function altered(share: string, change: (body: Uint8Array) => void): string {
  const body = urToTransport(share).slice(0, -4);
  change(body);
  return transportToUr(withCrc(body));
}

describe("AUD-008-API002: key evidence that no wallet can match is refused", () => {
  const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest();
  /** A compressed WIF with a valid Base58Check checksum, packed independently. */
  function wifOf(key: Buffer, version = 128): string {
    const payload = Buffer.concat([Buffer.from([version]), key, Buffer.from([1])]);
    const bytes = Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]);
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let value = BigInt(`0x${bytes.toString("hex")}`);
    let text = "";
    while (value > 0n) {
      text = alphabet[Number(value % 58n)] + text;
      value /= 58n;
    }
    for (const byte of bytes) {
      if (byte !== 0) break;
      text = `1${text}`;
    }
    return text;
  }
  const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const scalar = (value: bigint) => Buffer.from(value.toString(16).padStart(64, "0"), "hex");
  const evidence = (kind: "compressed-public-key" | "wif", value: string): BitcoinEvidence =>
    ({ kind, value, profiles: ["native-segwit"], location }) as BitcoinEvidence;

  it("refuses an x at or above p, and a point off the curve", () => {
    expect(() =>
      matchBitcoinEvidence(
        publicMnemonic,
        evidence("compressed-public-key", `02${"ff".repeat(32)}`),
      ),
    ).toThrow(/secp256k1/u);
    // x = 5 gives x^3 + 7 = 132, which has no square root modulo p.
    expect(() =>
      matchBitcoinEvidence(
        publicMnemonic,
        evidence("compressed-public-key", `02${"00".repeat(31)}05`),
      ),
    ).toThrow(/secp256k1/u);
  });

  it("refuses WIF scalars 0 and n and above, and still matches the real key", () => {
    for (const value of [0n, order, order + 1n])
      expect(() =>
        matchBitcoinEvidence(publicMnemonic, evidence("wif", wifOf(scalar(value)))),
      ).toThrow(/secp256k1/u);
    // The public phrase's first native SegWit key, m/84'/0'/0'/0/0.
    const valid = "KyZpNDKnfs94vbrwhJneDi77V6jF64PWPF8x5cdJb8ifgg2DUc9d";
    expect(matchBitcoinEvidence(publicMnemonic, evidence("wif", valid)).matched).toBe(true);
    expect(
      matchBitcoinEvidence(
        publicMnemonic,
        evidence(
          "compressed-public-key",
          "0330d54fd0dd420a6e5f8d3624f5f3482cae350f79d5f0753bf5beef9c2d91af3c",
        ),
      ).matched,
    ).toBe(true);
  });
});

describe("AUD-008-API003: a word search that could not end is refused", () => {
  const known = (count: number) => Array.from({ length: count }, () => [0] as readonly number[]);
  it.each([
    ["an empty place", { kind: "unknown-words", places: [...known(11), []] }],
    ["eleven places", { kind: "unknown-words", places: known(11) }],
    ["an index out of the list", { kind: "unknown-words", places: [...known(11), [2048]] }],
    ["an index that is no integer", { kind: "unknown-words", places: [...known(11), [0.5]] }],
    ["indexes out of order", { kind: "unknown-words", places: [...known(11), [3, 1]] }],
    ["an unknown kind", { kind: "every-word", places: known(12) }],
    ["a missing word of a wrong length", { kind: "missing-word", written: [0, 0, 0] }],
  ])("%s", (_, search) => {
    expect(() => searchCombinations(search as WordSearch)).toThrow();
    expect(() => searchCandidates(search as WordSearch).next()).toThrow();
  });
});

describe("AUD-008-API004: an unknown Seedshift mode is refused", () => {
  const encoded = encodeMnemonic(publicMnemonic, [parseDate("23-09-2026")]);
  const patterns = [parseDatePattern("?3-09-2026")];
  it.each(["seedshift-typo", "direct", undefined, null])("%s", (mode) => {
    expect(() => [
      ...dateRecoveryCandidates(encoded.shiftedIndexes, [], patterns, mode as never),
    ]).toThrow(/Seedshift mode/u);
  });
  it("keeps the three supported modes", () => {
    for (const mode of ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"] as const)
      expect(() => [
        ...dateRecoveryCandidates(encoded.shiftedIndexes, [], patterns, mode),
      ]).not.toThrow();
  });
});

describe("AUD-008-API005: a BIP39 passphrase must be text", () => {
  it.each([null, 123, false, [], {}])("refuses %j", (passphrase) => {
    expect(() => masterFingerprint(publicMnemonic, passphrase as never)).toThrow(TypeError);
  });
  it("keeps the default and string passphrases", () => {
    expect(masterFingerprint(publicMnemonic)).toBe("73c5da0a");
    expect(masterFingerprint(publicMnemonic, undefined)).toBe("73c5da0a");
    expect(masterFingerprint(publicMnemonic, "")).toBe("73c5da0a");
  });
});

describe("AUD-008-FUN001: every share given must agree with the restored secret", () => {
  const vector = vectors.deterministic[0]!;
  const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
  // Byte 8 of the CBOR is in the share value: the share keeps a valid checksum but lies off the
  // polynomial of the others.
  const wrong = altered(vector.shares[2]!, (body) => void (body[8] ^= 1));

  it("refuses a wrong surplus share in every order, and names it", async () => {
    const [a, b] = vector.shares as [string, string];
    for (const order of [
      [a, b, wrong],
      [b, a, wrong],
      [wrong, a, b],
      [a, wrong, b],
    ]) {
      await expect(combineSskrShares(order)).rejects.toThrow(/does not fit|do not restore/u);
    }
    await expect(combineSskrShares([a, b, wrong])).rejects.toThrow(/Share 3 does not fit/u);
    expect(await checkShareBackup(expected, [a, b, wrong].join(";"), "direct", "")).toBe(
      "unreadable",
    );
  });

  it("keeps every valid pair and the whole valid set", async () => {
    const s = vector.shares;
    for (const [i, j] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ])
      expect(await combineSskrShares([s[i]!, s[j]!])).toBe(expected);
    expect(await combineSskrShares([...s].reverse())).toBe(expected);
  });

  it("checks the surplus members and groups of grouped sets", async () => {
    const official = vectors.official;
    const original = entropyToMnemonic(Buffer.from(official.entropy, "hex"), wordlist);
    // All eight shares: group 1 (2 of 3) and group 2 (3 of 5) both with surplus members.
    expect(await combineSskrShares(official.shares)).toBe(original);
    // A wrong surplus member of the second group.
    const bad = altered(official.shares[7]!, (body) => void (body[9] ^= 1));
    await expect(combineSskrShares([...official.shares.slice(0, 7), bad])).rejects.toThrow(
      /Share 8 does not fit/u,
    );
    // One group is enough for a set of two groups with threshold 1: the second is a surplus group.
    const engine = await sskrEngine();
    const secret = Buffer.from(vectors.deterministic[0]!.entropy, "hex");
    const seed = new Uint8Array(32).fill(7);
    const shares = engine
      .create_sskr_shares(secret, 1, Uint8Array.of(2, 3, 2, 3), seed)
      .trim()
      .split("\n");
    const phrase = entropyToMnemonic(secret, wordlist);
    expect(await combineSskrShares(shares)).toBe(phrase);
    const badGroup = altered(shares[3]!, (body) => void (body[9] ^= 1));
    await expect(combineSskrShares([...shares.slice(0, 3), badGroup, shares[4]!])).rejects.toThrow(
      /do not fit/u,
    );
  });
});

describe("AUD-008-API006: every share layout that is read whole is also repaired", () => {
  const vector = vectors.deterministic[0]!;
  const share = vector.shares[0]!;
  // A UR whose CBOR carries the SSKR tag, which transport.ts reads as well.
  const tagged = (tag: readonly number[]) =>
    transportToUr(withCrc(Uint8Array.from([...tag, ...urToTransport(share).slice(0, -4)])));
  // Bytewords of the untagged bytes, as earlier tools wrote them.
  const untaggedWords = [...urToTransport(share)].map((byte) => bytewords[byte]).join(" ");
  const layouts: [string, string][] = [
    ["untagged Bytewords", untaggedWords],
    ["UR with the tag 40309", tagged([0xd9, 0x9d, 0x75])],
    ["UR with the earlier tag 309", tagged([0xd9, 0x01, 0x35])],
  ];

  it.each(layouts)("%s, one element marked at the start, middle and end", (_, text) => {
    const isUr = text.startsWith("ur:");
    const units = isUr ? text.slice("ur:sskr/".length).match(/../gu)! : text.split(" ");
    for (const place of [1, Math.floor(units.length / 2), units.length - 2]) {
      const marked = [...units];
      marked[place] = "?";
      const typed = isUr ? `ur:sskr/${marked.join("")}` : marked.join(" ");
      expect(readRepairableShare(typed).ur).toBe(readRepairableShare(text).ur);
    }
  });

  it("repairs a marked share beside an intact share of another layout, in both orders", async () => {
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    const units = writeShare(vector.shares[1]!, "indexes").split(" ");
    units[12] = "?";
    const marked = units.join(" ");
    for (const typed of [
      [untaggedWords, marked],
      [marked, untaggedWords],
    ]) {
      const found = await (await planJointRepair(typed)).search();
      expect(found.map((set) => set.mnemonic)).toEqual([expected]);
    }
  });
});

describe("AUD-008-UI001: a redraw counts the rows a long line wraps onto", () => {
  it("counts wrapped rows at the terminal's width, without colour codes", () => {
    // Standard error is no terminal under the test runner; it is given a width for the test.
    const before = Object.getOwnPropertyDescriptor(process.stderr, "columns");
    const width = (value: number) =>
      Object.defineProperty(process.stderr, "columns", { value, configurable: true });
    try {
      width(40);
      expect(rowsOf(["x".repeat(40), "x".repeat(41), "", "\x1b[1mbold\x1b[0m"])).toBe(
        1 + 2 + 1 + 1,
      );
      width(120);
      expect(rowsOf(["x".repeat(78)])).toBe(1);
    } finally {
      if (before === undefined) delete (process.stderr as { columns?: number }).columns;
      else Object.defineProperty(process.stderr, "columns", before);
    }
  });
});

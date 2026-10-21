// AUD-011: each rule that the audit found written more than once now has one owner. These tests
// check the places that used to disagree, through every reader that now shares the rule.

import { hexUnits, UNICODE_CODE_DIGITS } from "../src/core/code-text.js";
import { describe, expect, it } from "vitest";
import {
  BIP39_ENTROPY_BYTES,
  checksumBits,
  entropyBytes,
  lastWordEntropyBits,
  wordCountOfEntropy,
} from "../src/core/bip39-sizes.js";
import {
  colorOfUnicodePair,
  colorsToIndexes,
  colorsToUnicode,
  indexesToColors,
  unicodeToColors,
  wordPositionPlacements,
} from "../src/core/colors.js";
import { parseInput } from "../src/core/representations.js";
import { SHARE_LENGTHS } from "../src/sskr/transport.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { cloudServiceOf } from "../src/cli/cloud-folders.js";
import { pathWithin } from "../src/cli/path-within.js";
import { mappingRow, wordIndexOfNumber } from "../src/core/words.js";
import { HDKey, HARDENED_OFFSET as SCURE_HARDENED_OFFSET } from "@scure/bip32";
import { mnemonicToSeedSync } from "@scure/bip39";
import { NETWORK, TEST_NETWORK, p2pkh, p2sh, p2tr, p2wpkh } from "@scure/btc-signer";
import {
  matchWalletEvidence,
  parseBitcoinAddress,
  type BitcoinNetworkName,
  type BitcoinProfile,
} from "../src/bitcoin-evidence.js";
import { HARDENED_OFFSET, LAST_NORMAL_INDEX } from "../src/core/bip32-limits.js";
import {
  addressCount,
  defaultAddressCount,
  parseAddressCount,
  parsePlaceNumber,
} from "../src/core/address-scan.js";
import { assertAddressLocation } from "../src/core/coins/coin.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import {
  FINGERPRINT_WARNING,
  fingerprintMatch,
  MasterFingerprintCheck,
} from "../src/core/master-fingerprint.js";
import { pbkdf2Sync } from "node:crypto";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { encodeMnemonicLegacy, legacyChecksumValidResult } from "../src/core/seedshift.js";
import { formatEncoded } from "../src/core/representations.js";
import { ENCODED_FORMATS, MASKING_MODES } from "../src/core/types.js";
import { Masking } from "../src/core/masking.js";
import { formatConflictOf, modeConflictOf } from "../src/core/backup-reading.js";
import { parseRecord, serializeRecord } from "../src/record.js";
import { formatNumber, inputFormat } from "../src/cli/input.js";
import { typedWholeNumber } from "../src/core/typed-number.js";
import { integerOption } from "../src/cli/arguments.js";
import { scanGapOf } from "../src/cli/bitcoin-options.js";
import { WORD_NUMBER_RANGE } from "../src/core/bip39-sizes.js";
import { BitFields, PivotBasis, solve } from "../src/sskr/gf2.js";
import { shareWordIndex, wordIndexesToBytes } from "../src/sskr/transport.js";
import { SetTopology, surplusWindow } from "../src/sskr/set-topology.js";
import { everyPick } from "../src/sskr/repair.js";
import { rgbBytes, rgbChannels, rgbOfHsv, hsv } from "../src/export/color-math.js";
import { cardText, parseOrientation, parsePageSize } from "../src/export/card-settings.js";
import { pickWith } from "../src/export/platform.js";
import { numberedCode, twoDigits } from "../src/export/card-codes.js";
import { collectionPayload, collectionSeries } from "../src/export/collection-sheet.js";
import type { ShareInfo } from "../src/sskr/transport.js";
import { COLOR_FORMAT_NUMBERS, formatLegend } from "../src/cli/format-numbers.js";
import { HEIR_MENU } from "../src/cli/heir-sheet.js";
import { TOPIC_HELP } from "../src/cli/help-pages.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";

/** The public phrase masked with 23-09-2026 (vectors/mnemocode-v1.json), as word numbers. */
const MASKED_NUMBERS = "2027 10 24 2027 10 24 2027 10 24 2027 10 377";

describe("AUD-011-ARC001: one reader of a known word number", () => {
  it("reads numbers alike in complete codes and beside a ?", () => {
    for (const [token, index] of [
      ["1", 0],
      ["0001", 0],
      ["000000010", 9],
      ["2048", 2047],
    ] as const)
      expect(wordIndexOfNumber(token), token).toBe(index);
    const range = { code: "core.words.indexes-use-seedshift-compatible-numbering-from" };
    const integer = { code: "core.words.indexes-decimal-integers-from" };
    for (const [token, refusal] of [
      ["0", range],
      ["2049", range],
      ["-1", integer],
      ["1.0", integer],
      ["", integer],
      ["x", integer],
    ] as const)
      expect(() => wordIndexOfNumber(token), token).toThrow(expect.objectContaining(refusal));
    // A padded known number beside a ? was refused, though complete codes read it.
    const padded = MASKED_NUMBERS.replace(/^2027 10/u, "2027 0010").replace(/377$/u, "?");
    expect(parseInput(MASKED_NUMBERS.replace(/^2027 10/u, "2027 0010"), "indexes")[1]).toBe(9);
    expect(MissingCodes.read(padded, "indexes", "seedshift").missingPlaces).toEqual([12]);
    expect(() => MissingCodes.read(padded.replace("0010", "2049"), "indexes", "seedshift")).toThrow(
      "Word number 2 is no number from 1 through 2048.",
    );
  });
});

describe("AUD-011-ARC062: one rule of a path inside a folder", () => {
  it("takes a name that starts with two dots as inside, and a parent as outside", () => {
    expect(pathWithin("/home/u/OneDrive", "/home/u/OneDrive")).toBe(true);
    expect(pathWithin("/home/u/OneDrive", "/home/u/OneDrive/a/b.pdf")).toBe(true);
    expect(pathWithin("/home/u/OneDrive", "/home/u/OneDrive/..notes/b.pdf")).toBe(true);
    expect(pathWithin("/home/u/OneDrive", "/home/u/OneDriveCopy/b.pdf")).toBe(false);
    expect(pathWithin("/home/u/OneDrive", "/home/u/OneDrive/../b.pdf")).toBe(false);
    // The cloud warning missed a folder whose name starts with two dots.
    const environment = { OneDrive: "/home/u/Work" };
    expect(cloudServiceOf("/home/u/Work/..notes/cards.pdf", environment, "/home/u")).toBe(
      "OneDrive",
    );
    expect(cloudServiceOf("/home/u/Workshop/cards.pdf", environment, "/home/u")).toBeUndefined();
  });
});

describe("AUD-011-ARC019: the sizes of a BIP39 phrase have one owner", () => {
  it("derives every width from the word count, as BIP39 defines them", () => {
    // BIP39's table: words, entropy bits, checksum bits.
    for (const [words, bytes, checksum, tail] of [
      [12, 16, 4, 7],
      [15, 20, 5, 6],
      [18, 24, 6, 5],
      [21, 28, 7, 4],
      [24, 32, 8, 3],
    ] as const) {
      expect(entropyBytes(words)).toBe(bytes);
      expect(checksumBits(words)).toBe(checksum);
      expect(lastWordEntropyBits(words)).toBe(tail);
      expect(wordCountOfEntropy(bytes)).toBe(words);
    }
    expect(BIP39_ENTROPY_BYTES).toEqual([16, 20, 24, 28, 32]);
    expect(wordCountOfEntropy(17)).toBeUndefined();
    // An SSKR share holds the secret and five bytes of metadata.
    expect([...SHARE_LENGTHS]).toEqual([21, 25, 29, 33, 37]);
  });
});

describe("AUD-011-ARC002, ARC003, ARC020: the color form has one decoder and derived sizes", () => {
  const indexes = parseInput(MASKED_NUMBERS, "indexes");
  const colors = indexesToColors(indexes);

  it("reads colors in any order and with offset tags, complete or marked, alike", () => {
    expect(colors).toHaveLength(8);
    expect(colorsToIndexes([...colors].reverse())).toEqual(indexes);
    // The positions that marked reading gives are those of complete reading.
    const [patterns = []] = wordPositionPlacements(colors);
    expect(patterns.map(Number)).toEqual(indexes.map((index) => index + 1));
    expect(wordPositionPlacements([undefined, ...colors.slice(1)])[0]?.[0]).toBe("????");
  });

  it("refuses a pair of Private Use codes that writes no #RRGGBB color, marked or not", () => {
    // A high part of 0xA3E is in the Private Use range, but 0xA3E x 0x1900 passes 0xFFFFFF.
    expect(() => colorOfUnicodePair(0xe000 + 0xa3e, 0xe000)).toThrow("outside the #RRGGBB range");
    expect(() => colorOfUnicodePair(0xdfff, 0xe000)).toThrow("Private Use Area");
    expect(colorOfUnicodePair(0xe000, 0xe000)).toBe("#000000");
    const text = colorsToUnicode(colors);
    expect(unicodeToColors(text)).toEqual(colors);
    const oversized = "EA3EE000" + text.slice(8);
    expect(() => unicodeToColors(oversized)).toThrow("outside the #RRGGBB range");
    // Marked, the last color unread: its two codes are ? each, apart as marks are written.
    const marked = [...hexUnits(oversized, UNICODE_CODE_DIGITS)!.slice(0, -2), "????", "????"];
    expect(() => MissingCodes.read(marked.join(" "), "colors-unicode", "seedshift")).toThrow(
      "outside the #RRGGBB range",
    );
  });
});

/**
 * The address at m/purpose'/coin'/0'/0/0 of each profile, written by @scure/btc-signer: an
 * implementation independent of Bitcoin's coin, which the evidence now reads addresses with.
 */
function independentAddress(
  profile: BitcoinProfile,
  network: BitcoinNetworkName,
): { readonly address: string; readonly path: string } {
  const purposes = { legacy: 44, "nested-segwit": 49, "native-segwit": 84, taproot: 86 };
  const parameters = network === "mainnet" ? NETWORK : TEST_NETWORK;
  const path = `m/${purposes[profile]}'/${network === "mainnet" ? 0 : 1}'/0'/0/0`;
  const key = HDKey.fromMasterSeed(mnemonicToSeedSync(TEST_PHRASE)).derive(path).publicKey!;
  const address =
    profile === "legacy"
      ? p2pkh(key, parameters).address!
      : profile === "nested-segwit"
        ? p2sh(p2wpkh(key, parameters), parameters).address!
        : profile === "native-segwit"
          ? p2wpkh(key, parameters).address!
          : p2tr(key.slice(1), undefined, parameters).address!;
  return { address, path };
}

const PROFILES: readonly BitcoinProfile[] = ["legacy", "nested-segwit", "native-segwit", "taproot"];
const LOCATION_0 = { account: 0, branch: 0, index: 0 };

describe("AUD-011-ARC014, ARC015, ARC016, ARC022: Bitcoin evidence reads through Bitcoin's coin", () => {
  it("matches the address of every profile on both networks, at the coin's path", () => {
    for (const network of ["mainnet", "testnet"] as const)
      for (const profile of PROFILES) {
        const { address, path } = independentAddress(profile, network);
        const match = matchWalletEvidence(TEST_PHRASE, {
          kind: "address",
          value: address,
          profiles: PROFILES,
          location: { network, ...LOCATION_0 },
        });
        expect(match, `${network} ${profile}`).toEqual({
          matched: true,
          kind: "address",
          derived: address,
          path,
        });
        // In a profile of another kind the same address is never found.
        const others = PROFILES.filter((other) => other !== profile);
        expect(
          matchWalletEvidence(TEST_PHRASE, {
            kind: "address",
            value: address,
            profiles: others,
            location: { network, ...LOCATION_0 },
          }).matched,
        ).toBe(false);
      }
  });

  it("writes Bitcoin's account paths for every profile, network and account", () => {
    for (const [type, purpose] of [
      ["p2pkh", 44],
      ["p2sh-p2wpkh", 49],
      ["p2wpkh", 84],
      ["p2tr", 86],
    ] as const) {
      expect(BITCOIN.accountPathOf(type, 0, 7)).toBe(`m/${purpose}'/0'/7'`);
      expect(BITCOIN.branchPathOf(type, 1, { account: 2, branch: 1, index: 9 })).toBe(
        `m/${purpose}'/1'/2'/1`,
      );
    }
  });

  it("keeps the address messages: capitals, mixed case, damage, scripts and networks", () => {
    const { address } = independentAddress("native-segwit", "mainnet");
    expect(parseBitcoinAddress(address.toUpperCase(), "mainnet")).toBe(address);
    // One letter of the data part in capitals: BIP173 refuses mixed case.
    const letter = address.slice(4).search(/[a-z]/u) + 4;
    const mixed =
      address.slice(0, letter) +
      address.slice(letter, letter + 1).toUpperCase() +
      address.slice(letter + 1);
    expect(() => parseBitcoinAddress(mixed, "mainnet")).toThrow(
      "The address is not valid for Bitcoin mainnet.",
    );
    const damaged = address.slice(0, -1) + (address.endsWith("q") ? "p" : "q");
    expect(() => parseBitcoinAddress(damaged, "mainnet")).toThrow(
      "The address is not valid for Bitcoin mainnet.",
    );
    // A P2WSH address, of a script and not of one key (BIP-0173 test vector).
    expect(() =>
      parseBitcoinAddress(
        "bc1qrp33g0q5c5txsp9arysrx4k6zdkfs4nce4xj0gdcccefvpysxf3qccfmv3",
        "mainnet",
      ),
    ).toThrow("it is not the address of a single key");
    const testnet = independentAddress("legacy", "testnet").address;
    expect(() => parseBitcoinAddress(testnet, "mainnet")).toThrow(
      "The address is not valid for Bitcoin mainnet; it is a testnet address.",
    );
    expect(() => parseBitcoinAddress(address, "testnet")).toThrow(
      "The address is not valid for Bitcoin testnet; it is a mainnet address.",
    );
    // An address of another coin is not Bitcoin's on either network.
    expect(() => parseBitcoinAddress("DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L", "mainnet")).toThrow(
      "The address is not valid for Bitcoin mainnet.",
    );
  });
});

describe("AUD-011-ARC017: one comparison of master fingerprints", () => {
  it("gives the same fields to the fingerprint check and the evidence, which adds its own", () => {
    const check = new MasterFingerprintCheck((password, salt, rounds, bytes) =>
      Uint8Array.from(pbkdf2Sync(password, salt, rounds, bytes, "sha512")),
    );
    for (const expected of [TEST_FINGERPRINT, "00000000"]) {
      const direct = check.match(TEST_PHRASE, expected);
      const evidence = matchWalletEvidence(TEST_PHRASE, {
        kind: "master-fingerprint",
        value: expected,
        network: "mainnet",
      });
      expect(evidence).toEqual({
        ...direct,
        kind: "master-fingerprint",
        derived: TEST_FINGERPRINT,
      });
      expect(direct.warning).toBe(FINGERPRINT_WARNING);
    }
    expect(Object.isFrozen(fingerprintMatch(TEST_FINGERPRINT, TEST_FINGERPRINT))).toBe(true);
  });
});

describe("AUD-011-ARC021: one bound of the indexes that are not hardened", () => {
  it("derives the last normal index from BIP32's hardened offset", () => {
    expect(HARDENED_OFFSET).toBe(SCURE_HARDENED_OFFSET);
    expect(LAST_NORMAL_INDEX).toBe(2 ** 31 - 1);
  });

  it("takes a location and a scan that end at it, and refuses one past it", () => {
    for (const name of ["account", "branch", "index"] as const) {
      expect(() =>
        assertAddressLocation({ ...LOCATION_0, [name]: LAST_NORMAL_INDEX }),
      ).not.toThrow();
      expect(() => assertAddressLocation({ ...LOCATION_0, [name]: HARDENED_OFFSET })).toThrow(
        `${name} must be an integer from 0 through 2147483647.`,
      );
    }
    expect(defaultAddressCount(LAST_NORMAL_INDEX)).toBe(1);
    expect(addressCount(2, LAST_NORMAL_INDEX - 1)).toBe(2);
    expect(() => addressCount(3, LAST_NORMAL_INDEX - 1)).toThrow(
      "The addresses compared would pass index 2147483647.",
    );
  });
});

describe("AUD-011-ARC018, ARC037: one list of forms and modes, and their numbers", () => {
  it("numbers the forms as --format and the menu always have, and reads both", () => {
    expect(ENCODED_FORMATS.map(formatNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(ENCODED_FORMATS.map((format) => inputFormat(String(formatNumber(format))))).toEqual(
      ENCODED_FORMATS,
    );
    expect(inputFormat("colors-unicode")).toBe("colors-unicode");
    for (const wrong of ["0", "6", "01", "json"])
      expect(() => inputFormat(wrong)).toThrow(
        expect.objectContaining({ code: "cli.input.representation-format-one-use-number-name" }),
      );
  });

  it("names each form in the help by the number --format takes", () => {
    const rows = TOPIC_HELP.formats!.sections[0]!.rows!.map(([name]) => name);
    expect(rows).toEqual([
      "1  english",
      "2  indexes",
      "3  unicode",
      "4  colors-unicode",
      "5  colors",
    ]);
    expect(COLOR_FORMAT_NUMBERS).toBe("4 and 5");
    expect(
      formatLegend({
        english: "e",
        indexes: "i",
        unicode: "u",
        "colors-unicode": "cu",
        colors: "c",
      }),
    ).toBe("1 e, 2 i, 3 u, 4 cu, 5 c");
  });

  it("writes and reads a record of every form and mode, and refuses others", () => {
    for (const format of ENCODED_FORMATS)
      for (const mode of MASKING_MODES)
        expect(parseRecord(serializeRecord(mode, format, "x"))).toMatchObject({ mode, format });
    expect(MASKING_MODES).toEqual(Masking.MODES);
    expect(() => parseRecord("MNC1:shifted:english:x")).toThrow(
      "Malformed MnemoCode record header.",
    );
    expect(() => parseRecord("MNC2:shifted:english:x")).toThrow(
      "Malformed MnemoCode record header.",
    );
    expect(() => parseRecord("MNC2:direct:english:x")).toThrow(
      "Unsupported MnemoCode record version",
    );
  });
});

describe("AUD-011-ARC050, ARC051: Masking owns which dates a mode takes", () => {
  it("refuses dates for direct, none for a masking, and lets them be asked later", () => {
    expect(() => Masking.of("direct").assertDateCount(1)).toThrow(
      "Dates cannot be used in direct mode.",
    );
    Masking.of("direct").assertDateCount(0);
    for (const mode of ["seedshift", "seedshift-legacy", "seedshift-legacy-valid"] as const) {
      expect(() => Masking.of(mode).assertDateCount(0)).toThrow(
        `${mode} requires at least one date.`,
      );
      Masking.of(mode).assertDateCount(0, true);
      Masking.of(mode).assertDateCount(2);
    }
  });
});

describe("AUD-011-ARC052, ARC053: one rule of a record that disagrees with an option", () => {
  it("names a conflict only when both are given and differ", () => {
    expect(modeConflictOf("seedshift", undefined)).toBeUndefined();
    expect(modeConflictOf(undefined, "seedshift")).toBeUndefined();
    expect(modeConflictOf("seedshift", "seedshift")).toBeUndefined();
    expect(modeConflictOf("direct", "seedshift")).toBe(
      "The record was made with no Seedshift, not with MnemoCode Seedshift.",
    );
    expect(formatConflictOf("unicode", "colors")).toBe(
      "The record holds unicode codes, not colors.",
    );
    expect(formatConflictOf("unicode", "unicode")).toBeUndefined();
  });
});

describe("AUD-011-ARC045: one reader of a typed whole number", () => {
  it("takes digits with leading zeros within the bounds, and nothing else", () => {
    expect(typedWholeNumber("007", { min: 1, max: 20 }, "no")).toBe(7);
    expect(typedWholeNumber("1", { min: 1, max: 20 }, "no")).toBe(1);
    expect(typedWholeNumber("20", { min: 1, max: 20 }, "no")).toBe(20);
    for (const wrong of ["0", "21", "-1", "+1", "1.0", "1e1", " 1", ""])
      expect(() => typedWholeNumber(wrong, { min: 1, max: 20 }, "no"), wrong).toThrow("no");
  });
});

/** Solves A x = b by trying every x: the independent answer for small systems. */
function bruteForce(columns: readonly bigint[], target: bigint): bigint[] {
  const found: bigint[] = [];
  for (let x = 0n; x < 1n << BigInt(columns.length); x += 1n) {
    let sum = 0n;
    columns.forEach((column, index) => {
      if ((x >> BigInt(index)) & 1n) sum ^= column;
    });
    if (sum === target) found.push(x);
  }
  return found;
}

describe("AUD-011-ARC032, ARC033: one elimination and one packer of bit fields", () => {
  it("solves small systems as trying every value does, with dependent and zero columns", () => {
    const systems: [bigint[], bigint][] = [
      [[0b011n, 0b110n, 0b101n, 0n], 0b011n],
      [[0b1n, 0b1n], 0b1n],
      [[0b10n, 0b100n], 0b1n],
      [[0b1011n, 0b0110n, 0b1101n, 0b0001n, 0b1000n], 0b0111n],
    ];
    for (const [columns, target] of systems) {
      const all = bruteForce(columns, target);
      const solved = solve(columns, target);
      if (all.length === 0) {
        expect(solved).toBeUndefined();
        continue;
      }
      expect(all).toContain(solved!.particular);
      // Every solution is the particular one plus a combination of the free directions.
      expect(2 ** solved!.free.length).toBe(all.length);
      expect(solved!.rank + solved!.free.length).toBe(columns.length);
    }
    const basis = new PivotBasis();
    for (const vector of [0b110n, 0b011n, 0b101n]) basis.add(vector);
    expect(basis.rank).toBe(2);
    expect(basis.reduce(0b101n).vector).toBe(0n);
  });

  it("packs fields low first, a zero field keeping its width, and 32-bit fields whole", () => {
    expect(
      BitFields.of([
        [0b1, 1],
        [0, 3],
        [0b11, 2],
      ]),
    ).toBe(0b110001n);
    expect(
      BitFields.of([
        [0xffffffff, 32],
        [1, 1],
      ]),
    ).toBe((1n << 32n) | 0xffffffffn);
    expect(BitFields.of([[0x1ff, 8]])).toBe(0xffn);
  });
});

describe("AUD-011-ARC025, ARC026: SSKR word numbers and their packing", () => {
  it("reads one to four digits for 1 through 2048", () => {
    expect(shareWordIndex("1")).toBe(0);
    expect(shareWordIndex("0001")).toBe(0);
    expect(shareWordIndex("2048")).toBe(2047);
    for (const wrong of ["0", "2049", "00001", "?", "1a", ""])
      expect(shareWordIndex(wrong)).toBeUndefined();
  });

  it("packs 11-bit words into bytes and says what is left over", () => {
    expect(wordIndexesToBytes([2047])).toEqual({ bytes: [0xff], leftover: 0b111, leftoverBits: 3 });
    // Eight words are 88 bits, eleven whole bytes.
    expect(wordIndexesToBytes(Array.from({ length: 8 }, () => 0))).toEqual({
      bytes: Array.from({ length: 11 }, () => 0),
      leftover: 0,
      leftoverBits: 0,
    });
  });
});

/** The metadata of a share as transport.ts reads it, for the topology. */
function info(fields: Partial<ShareInfo>): ShareInfo {
  return {
    identifier: 1,
    groupThreshold: 1,
    groupCount: 1,
    groupIndex: 0,
    memberThreshold: 2,
    memberIndex: 0,
    secretLength: 16,
    ...fields,
  };
}

describe("AUD-011-ARC028, ARC030: one topology of a set of shares", () => {
  it("names the first conflict: another set, the same member, another threshold", () => {
    expect(SetTopology.firstConflict([info({}), info({ memberIndex: 1 })])).toBeUndefined();
    expect(SetTopology.firstConflict([info({}), info({ identifier: 2 })])).toEqual({
      kind: "set",
      at: 1,
      with: 0,
    });
    expect(SetTopology.firstConflict([info({}), info({ memberIndex: 1 }), info({})])).toEqual({
      kind: "member",
      at: 2,
      with: 0,
    });
    expect(
      SetTopology.firstConflict([info({}), info({ memberIndex: 1, memberThreshold: 3 })]),
    ).toEqual({ kind: "threshold", at: 1, with: 0 });
    // Against the main set of a later share, as a typed answer is judged.
    expect(SetTopology.firstConflict([info({ identifier: 2 }), info({})], 1)).toEqual({
      kind: "set",
      at: 0,
      with: 1,
    });
  });

  it("tells complete groups and the quorum", () => {
    const two = [
      info({ groupThreshold: 2, groupCount: 2 }),
      info({ groupThreshold: 2, groupCount: 2, memberIndex: 1 }),
      info({ groupThreshold: 2, groupCount: 2, groupIndex: 1 }),
    ];
    const topology = new SetTopology(two);
    expect(topology.groups).toEqual([[0, 1], [2]]);
    expect(topology.complete).toEqual([[0, 1]]);
    expect(topology.incomplete).toEqual([2]);
    expect(topology.enough).toBe(false);
    expect(surplusWindow([4, 5, 6], 9)).toEqual([4, 5, 9]);
  });
});

describe("AUD-011-ARC034: one expansion of choices", () => {
  it("picks one item of each list in order, and stops past the cap", () => {
    expect(everyPick([[1, 2], [3], [4, 5]])).toEqual([
      [1, 3, 4],
      [1, 3, 5],
      [2, 3, 4],
      [2, 3, 5],
    ]);
    expect(everyPick([[1], []])).toEqual([]);
    expect(
      everyPick(
        [
          [1, 2],
          [3, 4],
        ],
        4,
      ),
    ).toHaveLength(4);
    expect(
      everyPick(
        [
          [1, 2],
          [3, 4],
        ],
        3,
      ),
    ).toBeUndefined();
  });
});

describe("AUD-011-ARC077, ARC078: one reader of color channels and one HSV conversion", () => {
  it("reads #RRGGBB and RRGGBB alike, and turns HSV back into the same bytes", () => {
    expect(rgbBytes("#1EAB91")).toEqual([0x1e, 0xab, 0x91]);
    expect(rgbBytes("1eab91")).toEqual([0x1e, 0xab, 0x91]);
    expect(rgbChannels("#FF0000")).toEqual([1, 0, 0]);
    for (const color of ["#1EAB91", "#000000", "#FFFFFF", "#7F00FF", "#A3F09C", "#FF8800"])
      expect(rgbOfHsv(...hsv(...rgbChannels(color)))).toEqual(rgbBytes(color));
  });
});

describe("AUD-011-ARC073, ARC074, ARC079, ARC085, ARC086, ARC087: card rules with one owner", () => {
  it("normalizes card text and refuses blank, control characters and overlong text", () => {
    expect(cardText("  Caf\u0065\u0301  ", "name", "blank")).toBe("Café");
    for (const wrong of ["", "  ", "a\nb", "a\u200Bb", 7])
      expect(() => cardText(wrong, "name", "blank")).toThrow("blank");
    expect(() => cardText("x".repeat(101), "name", "blank")).toThrow("maximum 100 characters");
  });

  it("picks with the choice given and refuses a choice out of range", () => {
    expect(pickWith(["a", "b"], () => 1)).toBe("b");
    for (const wrong of [-1, 2, 0.5])
      expect(() => pickWith(["a", "b"], () => wrong)).toThrow(
        expect.objectContaining({ code: "export.platform.checked-choice-refused" }),
      );
  });

  it("numbers elements in two digits and takes the QR code only when asked with true", () => {
    expect(twoDigits(7)).toBe("07");
    expect(numberedCode({ colors: ["#a3f09c"] }, 0)).toBe("01  A3F09C");
    expect(numberedCode({ colors: ["#a3f09c"], labels: ["2048"] }, 0, " ")).toBe("01 2048");
    // No card names the count of its set (owner, 2026-10-13): the cards end with decoys.
    expect(numberedCode({ colors: ["#a3f09c", "#000000"] }, 1)).toBe("02  000000");
    expect(collectionSeries({ kind: "sskr", collectionReference: "SET-1" })).toBe("SET-1");
    expect(collectionSeries({ kind: "colors" })).toBe("01");
    expect(collectionPayload({ kind: "colors", payload: "p", cardQr: true })).toBe("p");
    expect(collectionPayload({ kind: "colors", payload: "p" })).toBeUndefined();
    expect(collectionPayload({ kind: "sskr", payload: "p", qrCard: true })).toBe("p");
    expect(collectionPayload({ kind: "colors", payload: "p", qrCard: true })).toBeUndefined();
  });

  it("reads page sizes and orientations through their parsers", () => {
    expect(parsePageSize(undefined)).toBe("a6");
    expect(parsePageSize("business")).toBe("business");
    expect(() => parsePageSize("letter")).toThrow("Page size must be a6, a5, a4 or business.");
    expect(parseOrientation(undefined)).toBeUndefined();
    expect(parseOrientation("portrait")).toBe("portrait");
    expect(() => parseOrientation("sideways")).toThrow(
      "Orientation must be portrait or landscape.",
    );
  });
});

describe("Encode's rule in the library: the replaced last word of the Original Seedshift", () => {
  const date = [{ year: 2026, month: 9, day: 23 }];

  it("refuses what Encode cannot make, before any secret", () => {
    expect(() => EncodedBackup.assertEncodable("seedshift-legacy-valid")).toThrow(
      "To create a legacy checksum-valid record",
    );
    expect(() => EncodedBackup.assertEncodable("seedshift", { validLastWord: true })).toThrow(
      "available only in legacy Seedshift mode",
    );
    EncodedBackup.assertEncodable("seedshift-legacy", { validLastWord: true });
  });

  it("writes the codes and the record mode as the command line always did", () => {
    for (const format of ENCODED_FORMATS) {
      const masked = EncodedBackup.encode(TEST_PHRASE, date, format, "seedshift");
      expect(masked.backup.mode).toBe("seedshift");
      expect(masked.backup.text()).toBe(formatEncoded(masked.result, format));
      expect(masked.result).toBe(masked.base);
      expect(masked.validLastWord).toBeUndefined();
    }
    const base = encodeMnemonicLegacy(TEST_PHRASE, date);
    const alternative = legacyChecksumValidResult(base);
    const changed = alternative.shiftedIndexes.at(-1) !== base.shiftedIndexes.at(-1);
    const kept = EncodedBackup.encode(TEST_PHRASE, date, "english", "seedshift-legacy");
    expect(kept.backup.mode).toBe("seedshift-legacy");
    expect(kept.result.shiftedIndexes).toEqual(base.shiftedIndexes);
    expect(kept.lastWordChanged).toBe(changed);
    const replaced = EncodedBackup.encode(TEST_PHRASE, date, "english", "seedshift-legacy", {
      validLastWord: true,
    });
    expect(replaced.backup.mode).toBe(changed ? "seedshift-legacy-valid" : "seedshift-legacy");
    expect(replaced.result.shiftedIndexes).toEqual(
      changed ? alternative.shiftedIndexes : base.shiftedIndexes,
    );
    // The phrase comes back from the record, among the candidates where the word was replaced.
    expect(replaced.backup.candidates(date).map((found) => found.recoveredMnemonic)).toContain(
      TEST_PHRASE,
    );
  });
});

describe("A place and a count of addresses as typed, read in core for every host", () => {
  it("reads an account, a branch or an index from 0 through the last normal index", () => {
    expect(parsePlaceNumber("0")).toBe(0);
    expect(parsePlaceNumber("007")).toBe(7);
    expect(parsePlaceNumber(String(LAST_NORMAL_INDEX))).toBe(LAST_NORMAL_INDEX);
    for (const wrong of [String(HARDENED_OFFSET), "-1", "1'", "x", ""])
      expect(() => parsePlaceNumber(wrong), wrong).toThrow(
        "Type a number from 0 through 2147483647.",
      );
  });

  it("reads how many addresses, within the most and below the hardened indexes", () => {
    expect(parseAddressCount("20")).toBe(20);
    expect(parseAddressCount("0020")).toBe(20);
    expect(parseAddressCount("1000")).toBe(1000);
    for (const wrong of ["0", "1001", "2.5"])
      expect(() => parseAddressCount(wrong), wrong).toThrow("Type a number from 1 through 1000.");
    expect(() => parseAddressCount("3", LAST_NORMAL_INDEX - 1)).toThrow("would pass index");
  });
});

describe("AUD-011-ARC038: the Seedshift questions are worded once", () => {
  it("leads the sheet for heirs through the words of the menu", () => {
    expect(HEIR_MENU.decode).toMatchObject({
      question: "Was Seedshift used when it was encoded?",
      answers: {
        direct: "No",
        seedshift: "MnemoCode Seedshift",
        "seedshift-legacy": "Original Seedshift",
      },
    });
    expect(HEIR_MENU.restore).toMatchObject({
      question: "Was Seedshift used before it was split?",
      answers: { direct: "No", seedshift: "Yes" },
    });
  });
});

describe("AUD-011-ARC049, ARC054: one rule for a whole number in a range, whatever reads it", () => {
  const refuse = "Type a number.";

  it("takes word numbers 1 to 2048 in the table, the menu and the library alike", () => {
    for (const [number, accepted] of [
      [0, false],
      [1, true],
      [2048, true],
      [2049, false],
    ] as const) {
      const text = String(number);
      const option = () => integerOption({ index: text }, "index", WORD_NUMBER_RANGE);
      const typed = () => typedWholeNumber(text, WORD_NUMBER_RANGE, refuse);
      const row = () => mappingRow(number);
      for (const [read, code] of [
        [option, "cli.arguments.base-10-integer-from"],
        [typed, "core.typed-number.typed-whole-number-refused"],
        [row, "core.words.wordlist-index-from"],
      ] as const)
        if (accepted) expect(read()).not.toBe(undefined);
        else expect(read).toThrow(expect.objectContaining({ code }));
    }
    expect(mappingRow(2048).english).toBe("zoo");
  });

  it("takes 1 to 1000 addresses as --scan-gap and as an answer", () => {
    for (const [count, accepted] of [
      [0, false],
      [1, true],
      [1000, true],
      [1001, false],
    ] as const) {
      const option = () => scanGapOf({ "scan-gap": String(count) });
      const typed = () => parseAddressCount(String(count), 0);
      for (const [read, code] of [
        [option, "cli.arguments.base-10-integer-from"],
        [typed, "core.typed-number.typed-whole-number-refused"],
      ] as const)
        if (accepted) expect(read()).toBe(count);
        else expect(read).toThrow(expect.objectContaining({ code }));
    }
  });

  it("keeps each syntax: an answer may have leading zeros, an option may not", () => {
    expect(typedWholeNumber("0042", WORD_NUMBER_RANGE, refuse)).toBe(42);
    expect(() => integerOption({ index: "0042" }, "index", WORD_NUMBER_RANGE)).toThrow(
      "must be a base-10 integer from 1 through 2048",
    );
    for (const wrong of ["4e1", "+42", "42.0", " 42", "9".repeat(400)]) {
      expect(() => integerOption({ index: wrong }, "index", WORD_NUMBER_RANGE)).toThrow(
        expect.objectContaining({ code: "cli.arguments.base-10-integer-from" }),
      );
      expect(() => typedWholeNumber(wrong, WORD_NUMBER_RANGE, refuse)).toThrow(refuse);
    }
  });
});

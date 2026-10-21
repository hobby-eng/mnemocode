// AUD-012: the findings of the review after AUD-011, each with the case that showed it. Public
// test data only: the BIP39 test phrase and dates of the vectors.

import { afterEach, describe, expect, it, vi } from "vitest";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { Masking } from "../src/core/masking.js";
import {
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  formatDate,
  parseDate,
} from "../src/core.js";
import { DatesAnswer } from "../src/core/date-search.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as engine from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { BIP39_WORD_COUNTS, entropyBits } from "../src/core/bip39-sizes.js";
import { placeCombinations, WordCandidate, WordCandidateSearch } from "../src/core/candidates.js";
import {
  decodeCandidateList,
  encodeCandidateList,
  MAX_PASSPHRASE_BYTES,
} from "../src/core/candidate-list.js";
import { BITCOIN } from "../src/core/coins/bitcoin-like.js";
import {
  datePatternCombinationCount,
  datePatternCombinations,
  ownedPatterns,
} from "../src/core/dates.js";
import { checkedBitcoinProfiles } from "../src/core/wallet-evidence.js";
import { ENGLISH_INDEX, recoverLegacyValidLastWords } from "../src/core/words.js";
import { pathWithin } from "../src/cli/path-within.js";
import { bitsToBytes, hexOfBytes } from "../src/core/bits.js";
import { failureLine, resultLines, statusLine } from "../src/cli/terminal-style.js";
import { assertColorCardContent } from "../src/export/card-content.js";
import { pageDimensions } from "../src/export/card-settings.js";
import type { DatePattern } from "../src/core/types.js";
import type { CardTemplate } from "../src/export/templates.js";
import { planJointRepair } from "../src/sskr/joint-repair.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { crc32 } from "../src/sskr/checksum.js";
import {
  bytewordsToUr,
  CHECKSUM_BYTES,
  readShare,
  urToBytewords,
  urToTransport,
  writeShare,
} from "../src/sskr/transport.js";
import { indexesToColors } from "../src/core/colors.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { sskrVectors } from "./helpers/vectors.js";
import { holes } from "./helpers/holes.js";
import { refusalOf } from "./helpers/refusals.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";

/**
 * The most the search of two dates over the public phrase may take: it finds the phrase in well
 * under a second, and a search stopped at this limit fails the test with its own result.
 */
const SEARCH_TIME_LIMIT_MS = 10_000;

describe("AUD-012-FUN001: codes and dates found together decode to the wallet that matched", () => {
  const known = parseDate("01-01-2025");
  const guessed = parseDate(DATE);
  for (const [mode, encode] of [
    ["seedshift", encodeMnemonic],
    ["seedshift-legacy", encodeMnemonicLegacy],
  ] as const)
    it(`returns the known dates with the guessed ones (${mode})`, async () => {
      const tokens = formatEncoded(encode(TEST_PHRASE, [known, guessed]), "indexes").split(" ");
      tokens[3] = `${tokens[3]!.slice(0, -1)}?`;
      const codes = MissingCodes.read(tokens.join(" "), "indexes", mode);
      const answer = DatesAnswer.parse("01-01-2025 23-09-202?", { wordCount: 12, patterns: true });
      const check = async (mnemonic: string) => ({
        matched: mnemonic === TEST_PHRASE,
        path: "m",
      });
      const result = await new MissingCodesSearch(codes, () => "00000000")
        .byWallet(check, answer)
        .run({ signal: AbortSignal.timeout(SEARCH_TIME_LIMIT_MS) });
      expect(result.kind).toBe("found");
      if (result.kind !== "found") return;
      expect(result.dates!.map(formatDate)).toEqual(["01-01-2025", DATE]);
      // What the search found, as it is shown: the guessed date alone.
      expect(result.foundDates).toBe(DATE);
      expect(result.backup.decode(result.dates!).recoveredMnemonic).toBe(TEST_PHRASE);
    });
});

describe("AUD-012-FUN002: the plan of codes with complete dates counts the checks of the mode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("gives each mode its wallet checks per decoding", () => {
    expect(Masking.of("direct").checksPerDecoding(12)).toBe(1);
    expect(Masking.of("seedshift").checksPerDecoding(12)).toBe(1);
    expect(Masking.of("seedshift-legacy").checksPerDecoding(12)).toBe(2 ** -4);
    expect(Masking.of("seedshift-legacy-valid").checksPerDecoding(12)).toBe(128);
    expect(Masking.of("seedshift-legacy-valid").checksPerDecoding(24)).toBe(8);
  });

  it("plans 128 checks for each candidate of a 12-word phrase whose last word was replaced", async () => {
    const date = [parseDate(DATE)];
    const { backup } = EncodedBackup.encode(TEST_PHRASE, date, "indexes", "seedshift-legacy", {
      validLastWord: true,
    });
    expect(backup.mode).toBe("seedshift-legacy-valid");
    const tokens = backup.text().split(" ");
    tokens[3] = `${tokens[3]!.slice(0, -1)}?`;
    const codes = MissingCodes.read(tokens.join(" "), "indexes", "seedshift-legacy-valid");
    // A clock that only a wallet check moves, by one second: decoding then takes no time.
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const check = async () => {
      now += 1_000;
      return { matched: false };
    };
    const plan = await new MissingCodesSearch(codes, () => "00000000")
      .byWallet(check, DatesAnswer.of(date))
      .plan();
    expect(plan.seconds).toBe(codes.expected * 128);
  });
});

/** The first share of the first deterministic vector (vectors/sskr-v1.json), as a UR. */
const VECTOR_SHARE: string = sskrVectors().deterministic[0]!.shares[0]!;

/** `share` as a UR whose CBOR carries `tag`, with its checksum written again. */
function taggedUr(share: string, tag: readonly number[]): string {
  const cbor = urToTransport(share).subarray(0, -CHECKSUM_BYTES);
  const tagged = Uint8Array.from([...tag, ...cbor]);
  const bytes = new Uint8Array(tagged.length + CHECKSUM_BYTES);
  bytes.set(tagged);
  new DataView(bytes.buffer).setUint32(tagged.length, crc32(tagged));
  return `ur:sskr/${Array.from(bytes, (byte) => MINIMAL_BYTEWORDS[byte]!).join("")}`;
}

describe("AUD-012-FUN003: a tagged UR becomes Bytewords with one tag", () => {
  it("reads current, earlier and untagged URs back as the same share", () => {
    const canonical = readShare(VECTOR_SHARE).ur;
    for (const tag of [
      [0xd9, 0x9d, 0x75],
      [0xd9, 0x01, 0x35],
    ]) {
      const ur = taggedUr(VECTOR_SHARE, tag);
      expect(readShare(ur).ur).toBe(canonical);
      const words = urToBytewords(ur);
      // The registered tag 40309 alone: "tuna next keep" are 0xd9, 0x9d, 0x75.
      expect(words.split(" ").slice(0, 3)).toEqual(["tuna", "next", "keep"]);
      expect(bytewordsToUr(words)).toBe(canonical);
    }
    expect(bytewordsToUr(urToBytewords(VECTOR_SHARE))).toBe(canonical);
  });
});

describe("AUD-012-API001: the places of a search are checked before they are counted", () => {
  it("refuses an empty, sparse or foreign place, and counts valid ones in order", () => {
    const empty = "core.candidates.every-place-search-at-least-one-word";
    const index = "core.bip39-sizes.assert-word-indexes-refused";
    const refused: [number[][], string][] = [
      [[[]], empty],
      [[[1], []], empty],
      [[holes(1)], index],
      [[[2048]], index],
      [[[-1]], index],
      [[[0.5]], index],
    ];
    for (const [places, code] of refused)
      expect(() => placeCombinations(places)).toThrow(expect.objectContaining({ code }));
    const seen: number[][] = [];
    for (const words of placeCombinations([
      [1, 2],
      [3, 4],
    ]))
      seen.push([...words]);
    expect(seen).toEqual([
      [1, 3],
      [1, 4],
      [2, 3],
      [2, 4],
    ]);
  });
});

describe("AUD-012-API002: a repair bounds its shares before it reads any", () => {
  it("refuses none and more than 256, without reading a record", async () => {
    await expect(planJointRepair([], { platform: nodeSharePlatform })).rejects.toThrow(
      "Provide between 1 and 256 SSKR shares.",
    );
    const read: number[] = [];
    const many = new Proxy(
      Array.from({ length: 257 }, () => VECTOR_SHARE),
      {
        get(target, key, receiver) {
          if (typeof key === "string" && /^\d+$/u.test(key)) read.push(Number(key));
          const value: unknown = Reflect.get(target, key, receiver);
          return value;
        },
      },
    );
    await expect(planJointRepair(many, { platform: nodeSharePlatform })).rejects.toThrow(
      "Provide between 1 and 256 SSKR shares.",
    );
    expect(read).toEqual([]);
  });
});

describe("AUD-012-SEC001: a refused encoding leaves no share in the engine's memory", () => {
  it("refuses the code before any share is made", () => {
    const vector = sskrVectors().deterministic[0]!;
    // A fresh instance of the bundled engine, so that no earlier call left anything in it.
    const wasm = engine.initSync({
      module: readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm"),
    });
    expect(() =>
      engine.create_sskr_shares_formatted(
        Uint8Array.from(Buffer.from(vector.entropy, "hex")),
        1,
        new Uint8Array([2, 3]),
        Uint8Array.from(Buffer.from(vector.testOnlySeed, "hex")),
        2,
      ),
    ).toThrow("Unsupported SSKR share encoding.");
    const memory = Buffer.from(wasm.memory.buffer);
    for (const share of vector.shares) {
      // The share's metadata and secret, after its one-byte CBOR head, without its checksum.
      const payload = Buffer.from(urToTransport(share).subarray(1, -CHECKSUM_BYTES));
      expect(memory.indexOf(payload)).toBe(-1);
    }
  });
});

/** A function of about 60 tokens, copied into two files of a fixture. */
const COPIED_FUNCTION = `export function spread(values: readonly number[], limit: number): number[] {
  const kept: number[] = [];
  for (const value of values) {
    if (value < 0 || value > limit) continue;
    kept.push(value * 2 + limit - value / 3);
  }
  return kept.sort((left, right) => left - right).slice(0, limit);
}`;

/** The tokens of COPIED_FUNCTION, as the copy check counts them: a copy of all of them or none. */
const COPIED_FUNCTION_TOKENS = ["--tokens", "92"];

/**
 * The copy check run over `sources`, each one file of src/, with `args`: its exit code and errors.
 */
function copyRun(
  sources: readonly string[],
  args: readonly string[] = [],
): { status: number; stderr: string } {
  const root = mkdtempSync(join(tmpdir(), "mnemocode-copies-"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "src"));
    for (const script of ["verify-no-copies.mjs", "source-tokens.mjs"])
      copyFileSync(join("scripts", script), join(root, "scripts", script));
    sources.forEach((source, index) => writeFileSync(join(root, "src", `${index}.ts`), source));
    const run = spawnSync(
      process.execPath,
      [join(root, "scripts", "verify-no-copies.mjs"), ...args],
      {
        encoding: "utf8",
      },
    );
    return { status: run.status!, stderr: run.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** The exit code of the copy check over two files, `first` and `second`, with `args`. */
function copyCheck(first: string, second: string, args: readonly string[] = []): number {
  return copyRun([first, second], args).status;
}

describe("AUD-012-ARC013, ARC015: the copy check reads its threshold and its markers strictly", () => {
  it("finds a copy, takes a comment just above it as its marker, and nothing else", () => {
    const marked = (marker: string) => copyCheck(`${marker}\n${COPIED_FUNCTION}`, COPIED_FUNCTION);
    expect(copyCheck(COPIED_FUNCTION, COPIED_FUNCTION)).toBe(1);
    expect(marked("// A deliberate copy: the worker cannot import.")).toBe(0);
    expect(marked("/* A deliberate copy: the worker cannot import. */")).toBe(0);
    expect(marked('const label = "not a deliberate copy";')).toBe(1);
    expect(marked("const label = `not a deliberate copy`;")).toBe(1);
    expect(marked("const pattern = /deliberate copy/u;")).toBe(1);
    // MARKER_LINES_ABOVE: a comment four lines above the copy is not its marker.
    expect(marked("// A deliberate copy: the worker cannot import.\n\n\n")).toBe(1);
  });

  it("leaves out a list of imports or exports, and never the code after it", () => {
    // Without a semicolon, a list ended at the next one took the start of the function after it:
    // with a threshold of the whole function, a token taken hides the copy.
    expect(copyCheck(COPIED_FUNCTION, COPIED_FUNCTION, COPIED_FUNCTION_TOKENS)).toBe(1);
    for (const list of ['import { a } from "./a.js"', "export { a }", 'export * from "./a.js"'])
      expect(
        copyCheck(`${list}\n${COPIED_FUNCTION}`, COPIED_FUNCTION, COPIED_FUNCTION_TOKENS),
      ).toBe(1);
    expect(
      copyCheck('import { a } from "./a.js";\nexport const b = 1;', 'import { a } from "./a.js";'),
    ).toBe(0);
  });

  it("compares every pair: a marked place hides no copy among the others", () => {
    const marked = `// A deliberate copy: the worker cannot import.\n${COPIED_FUNCTION}`;
    expect(copyRun([marked, COPIED_FUNCTION, COPIED_FUNCTION]).status).toBe(1);
    expect(copyRun([marked, marked, COPIED_FUNCTION]).status).toBe(0);
    // Three equal places are two copies, each against the earliest.
    expect(copyRun([COPIED_FUNCTION, COPIED_FUNCTION, COPIED_FUNCTION]).stderr).toContain(
      "2 copies of 50 tokens or more",
    );
  });

  it("refuses a threshold that is no positive whole number", () => {
    const overflow = "9".repeat(400);
    for (const args of [
      ["--tokens", "wrong"],
      ["--tokens"],
      ["--tokens", "0"],
      ["--tokens", "-5"],
      ["--tokens", "2.5"],
      ["--tokens", overflow],
    ])
      expect(copyCheck("export const a = 1;", "export const b = 2;", args)).toBe(2);
  });
});

/** The first share of the public SSKR vectors (vectors/sskr-v1.json). */
const PUBLIC_SHARE: string = sskrVectors().deterministic[0]!.shares[0]!;

describe("AUD-012-FUN004: the labels of color cards are one per color", () => {
  // One Unicode code to a card (owner, 2026-10-13).
  const labels = writeShare(PUBLIC_SHARE, "unicode").split(" ");
  const colorsFor = (count: number): string[] =>
    Array.from({ length: count }, (_, index) => `#${(index + 1).toString(16).padStart(6, "0")}`);

  it("takes a share's labels when each color has one, and refuses other counts", () => {
    const share = { kind: "sskr" as const, labels, payload: PUBLIC_SHARE };
    expect(() =>
      assertColorCardContent({ ...share, colors: colorsFor(labels.length) }),
    ).not.toThrow();
    for (const count of [1, labels.length - 1, labels.length + 1])
      expect(() => assertColorCardContent({ ...share, colors: colorsFor(count) })).toThrow(
        "Cards that print codes print one code for each color, in order.",
      );
  });

  it("takes a phrase's Unicode codes as its labels, and refuses codes that are no phrase", () => {
    const codes = Array.from({ length: 12 }, () => "7684");
    const colors = colorsFor(12);
    expect(() =>
      assertColorCardContent({ kind: "colors", colors, payload: codes.join(""), labels: codes }),
    ).not.toThrow();
    expect(() =>
      assertColorCardContent({ kind: "colors", colors, payload: codes.join(""), labels: ["x"] }),
    ).toThrow("Cards that print codes print one code for each color, in order.");
    // Eleven codes are no phrase; and the QR code must hold the codes printed.
    expect(() =>
      assertColorCardContent({
        kind: "colors",
        colors: colors.slice(1),
        payload: codes.join(""),
        labels: codes.slice(1),
      }),
    ).toThrow("Expected 12, 15, 18, 21 or 24 word indexes.");
    expect(() =>
      assertColorCardContent({
        kind: "colors",
        colors,
        payload: [...codes.slice(1), "5728"].join(""),
        labels: codes,
      }),
    ).toThrow("Collection QR does not match the printed references.");
  });
});

describe("AUD-012-FUN005: a folder that cannot be made private is not published", () => {
  afterEach(() => {
    vi.doUnmock("node:fs/promises");
    vi.resetModules();
  });

  it("leaves no folder when chmod fails", async () => {
    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs/promises")>()),
      chmod: async () => {
        throw Object.assign(new Error("EIO: synthetic failure"), { code: "EIO" });
      },
    }));
    const { publishNewFolder } = await import("../src/export/private-file.js");
    const root = mkdtempSync(join(tmpdir(), "mnemocode-publish-"));
    try {
      const target = join(root, "cards");
      await expect(
        publishNewFolder(target, "cards-", "taken", async (staging) => {
          writeFileSync(join(staging, "marker"), "synthetic");
          return 1;
        }),
      ).rejects.toThrow("EIO: synthetic failure");
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("AUD-012-FUN006, FUN007: card settings refuse what they cannot print", () => {
  it("refuses an orientation that is not one, in every family's layout", () => {
    // Every family lays its pages out through pageDimensions, the material sheets too, since
    // they are drawn as collection studies only.
    expect(pageDimensions("business")).toEqual(pageDimensions("business", "landscape"));
    expect(pageDimensions("a6", "portrait")[1]).toBeGreaterThan(
      pageDimensions("a6", "portrait")[0],
    );
    for (const wrong of ["sideways", null, 90]) {
      // Orientations that no type allows, fed on purpose as a JavaScript host could.
      expect(() => pageDimensions("business", wrong as never)).toThrow(/Orientation must/u);
      expect(() => pageDimensions("a6", wrong as never)).toThrow(/Orientation must/u);
    }
  });

  it("refuses a page setting before any template draws", async () => {
    const { renderCards } = await import("../src/export/render.js");
    const render = vi.fn();
    const template: CardTemplate = {
      id: "synthetic",
      kind: "colors",
      name: "Synthetic",
      description: "A synthetic design.",
      render,
      renderIndividual: render,
    };
    const colors = indexesToColors(Array.from({ length: 12 }, () => 0));
    const content = { kind: "colors", colors, payload: colors.join(" ") } as const;
    for (const settings of [{ orientation: "sideways" }, { pageSize: "a3" }])
      await expect(
        renderCards(nodeCardRenderer, [
          // Settings that no type allows, fed on purpose as a JavaScript host could.
          { template, content: { ...content, ...settings } as never },
        ]),
      ).rejects.toThrow(/must be/u);
    expect(render).not.toHaveBeenCalled();
  });

  it("refuses a share format that is not one", async () => {
    const { ShareCardSet } = await import("../src/export/sskr-render.js");
    const options = {
      style: "it",
      shareFormat: "unsupported",
      profile: { name: "Public fixture" },
    };
    await expect(
      // A share format that no type allows, fed on purpose as a JavaScript host could.
      ShareCardSet.create(nodeCardRenderer, [PUBLIC_SHARE], options as never, () => 0),
    ).rejects.toThrow(/The share format must be one of: /u);
  });
});

describe("AUD-012-API003: a backslash is part of a name on POSIX", () => {
  it.runIf(process.platform !== "win32")("keeps a folder named ..\\notes inside", () => {
    expect(pathWithin("/synthetic/Work", "/synthetic/Work/..\\notes/cards.pdf")).toBe(true);
    expect(pathWithin("/synthetic/Work", "/synthetic/Work/../notes/cards.pdf")).toBe(false);
  });
});

describe("AUD-012-API004, API005: date patterns are checked together and owned", () => {
  const pattern = (key: string, days: number[]): DatePattern => ({
    key,
    years: [2026],
    months: [1],
    days,
  });

  it("refuses two patterns of one key that differ, in every public entry", () => {
    const conflicting = [pattern("same", [2]), pattern("same", [1])];
    expect(() => [...datePatternCombinations(conflicting)]).toThrow(/key of an earlier one/u);
    expect(() => datePatternCombinationCount(conflicting)).toThrow(/key of an earlier one/u);
    expect([...datePatternCombinations([pattern("a", [2]), pattern("b", [1])])]).toHaveLength(1);
  });

  it("keeps its own frozen copies", () => {
    const days = [1, 2];
    const owned = ownedPatterns([pattern("a", days)]);
    days.push(3);
    expect(owned[0]!.days).toEqual([1, 2]);
    expect(Object.isFrozen(owned) && Object.isFrozen(owned[0]!.days)).toBe(true);
  });
});

describe("AUD-012-API006, API007: shared lists cannot be changed or holed", () => {
  it("freezes the BIP39 word counts", () => {
    expect(Object.isFrozen(BIP39_WORD_COUNTS)).toBe(true);
    // A readonly array changed on purpose, as JavaScript can: the frozen array refuses it.
    expect(() => (BIP39_WORD_COUNTS as unknown as number[]).pop()).toThrow(TypeError);
  });

  it("refuses an empty or sparse list of Bitcoin profiles", () => {
    expect(() => checkedBitcoinProfiles([])).toThrow("At least one Bitcoin address profile");
    expect(() => checkedBitcoinProfiles(holes(1))).toThrow("Unknown Bitcoin address profile.");
    const checked = checkedBitcoinProfiles(["taproot", "legacy"]);
    expect(checked).toEqual(["taproot", "legacy"]);
    expect(Object.isFrozen(checked)).toBe(true);
  });
});

describe("AUD-012-ARC014: the script and the command line paint one way", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("writes the same bytes with colour and the plain form without", () => {
    vi.stubEnv("NO_COLOR", "");
    vi.stubEnv("CLICOLOR_FORCE", "1");
    vi.stubEnv("TERM", "xterm");
    const stream = { isTTY: true };
    expect(resultLines(stream, "Signed", [["Tag", "v1"]])).toEqual([
      "\n\x1b[1;36mMnemoCode\x1b[0m \x1b[90m·\x1b[0m \x1b[1mSigned\x1b[0m",
      "  \x1b[90mTag       \x1b[0m v1",
    ]);
    expect(statusLine(stream, "Checked", "SHA256SUMS")).toBe(
      "\x1b[1;32m✓\x1b[0m Checked \x1b[1mSHA256SUMS\x1b[0m",
    );
    expect(failureLine(stream, "sign-release", "bad")).toBe("\x1b[1;31m✗ Error:\x1b[0m bad");
    // Without colour a terminal keeps its form (AUD-037-UI006); a pipe gets the script's.
    vi.stubEnv("NO_COLOR", "1");
    expect(failureLine(stream, "sign-release", "bad")).toBe("✗ Error: bad");
    expect(failureLine({}, "sign-release", "bad")).toBe("sign-release: bad");
    expect(statusLine(stream, "Checked", "x", false)).toBe("! Checked x");
  });
});

describe("AUD-011-ARC007, ARC022: one owner for checksum bits and for a path's purpose", () => {
  it("shows the same checksum bits in every candidate, at every phrase length", () => {
    for (const count of BIP39_WORD_COUNTS) {
      const checksumLength = count / 3;
      // Independent of the code: the first bits of SHA-256 of the all-zero entropy (BIP39).
      const expected = (sha256(new Uint8Array(entropyBits(count) / 8))[0]! >> (8 - checksumLength))
        .toString(2)
        .padStart(checksumLength, "0");
      const zeros = Array.from({ length: count - 1 }, () => "abandon");
      // The last word through the final-word path, then the first through the word search.
      const last = recoverLegacyValidLastWords([...zeros, "abandon"].join(" "))[0]!;
      const first = [
        ...WordCandidateSearch.parse(
          ["?", ...zeros.slice(1), last.word].join(" "),
          "unknown-words",
        ).candidates(),
      ].find((candidate) => candidate.words[0] === 0)!;
      const indexes = [...zeros, last.word].map((word) => ENGLISH_INDEX.get(word)!);
      expect([
        last.checksumBits,
        first.checksumBits,
        new WordCandidate(1, indexes).checksumBits,
      ]).toEqual([expected, expected, expected]);
    }
  });

  it("refuses bits that are no whole bytes", () => {
    expect(Array.from(bitsToBytes("0000000111111111"))).toEqual([1, 255]);
    for (const wrong of ["", "0101", "0000000a", "000000012"])
      expect(() => bitsToBytes(wrong)).toThrow("whole number of bytes");
  });

  it("describes each Bitcoin address type with the purpose of its paths", () => {
    const purposes = [
      ["p2pkh", 44],
      ["p2sh-p2wpkh", 49],
      ["p2wpkh", 84],
      ["p2tr", 86],
    ] as const;
    for (const [type, purpose] of purposes) {
      // The network is the address's to name (CoinAddress.description, S145).
      expect(BITCOIN.describe(type)).toMatch(new RegExp(`^[^,]*\\(BIP${purpose}\\)$`, "u"));
      expect(BITCOIN.accountPathOf(type, 0, 0)).toBe(`m/${purpose}'/0'/0'`);
    }
  });
});

describe("AUD-012-SEC003: a candidate list wipes the copies of secrets that it owns", () => {
  afterEach(() => vi.restoreAllMocks());
  const entropy = new Uint8Array(16);
  /** Whether every array that `spy` returned is all zero. */
  const wiped = (spy: { mock: { results: { value: unknown }[] } }) =>
    spy.mock.results.every(
      ({ value }) => value instanceof Uint8Array && value.every((byte) => byte === 0),
    );

  it("measures a passphrase without a copy, and wipes the copies it writes", () => {
    const encode = vi.spyOn(TextEncoder.prototype, "encode");
    // TREZOR is the passphrase of the BIP39 test vectors.
    const list = { passphrase: "TREZOR", records: [{ entropy, passphrase: "TREZOR" }] };
    const bytes = encodeCandidateList(list);
    expect(encode).toHaveBeenCalledTimes(2);
    expect(wiped(encode)).toBe(true);
    expect(decodeCandidateList(bytes)).toEqual(list);
    encode.mockClear();
    const tooLong = "é".repeat(MAX_PASSPHRASE_BYTES / 2 + 1);
    expect(() =>
      encodeCandidateList({ passphrase: "TREZOR", records: [{ entropy, passphrase: tooLong }] }),
    ).toThrow(`longer than ${MAX_PASSPHRASE_BYTES} bytes`);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(wiped(encode)).toBe(true);
  });

  it("wipes the entropy that it copied from a damaged list", () => {
    const bytes = encodeCandidateList({
      records: [{ entropy: entropy.map((_, index) => index + 1) }],
    });
    // A changed first byte of the record, after the 11 bytes of the header: the CRC-32 fails.
    bytes[11]! ^= 1;
    const from = vi.spyOn(Uint8Array, "from");
    expect(() => decodeCandidateList(bytes)).toThrow("its CRC-32 does not match");
    const copies = from.mock.results.filter(
      ({ value }) => value instanceof Uint8Array && value.length === 16,
    );
    expect(copies.length).toBe(1);
    expect(wiped({ mock: { results: copies } })).toBe(true);
  });
});

describe("AUD-012-ARC004, ARC005: one hexadecimal form, one way to name a refused date", () => {
  it("writes bytes as lower-case hexadecimal, two digits each", () => {
    expect(hexOfBytes([])).toBe("");
    expect(hexOfBytes(Uint8Array.from([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });

  it("names a refused date by its place, typed or structured, and keeps the cause", () => {
    const typed = refusalOf(() =>
      DatesAnswer.parse("01-01-2026 31-02-2026", { wordCount: 12, patterns: false }),
    );
    const structured = refusalOf(() =>
      DatesAnswer.of([parseDate("01-01-2026"), { year: 2026, month: 2, day: 31 }]),
    );
    expect(typed.message).toMatch(/^Date 2: /u);
    expect(structured.message).toBe(typed.message);
    const dayRefused = { code: "core.dates.day-outside-selected-calendar-month" };
    expect(structured.cause).toMatchObject(dayRefused);
    expect(typed.cause).toMatchObject(dayRefused);
    // What is thrown that is no Error passes through unchanged.
    const throwing = new Proxy(
      {},
      {
        get() {
          throw "synthetic";
        },
      },
    );
    let thrown: unknown;
    try {
      // A date that throws what is no Error when read, fed on purpose as a JavaScript host could.
      DatesAnswer.of([throwing as never]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe("synthetic");
  });
});

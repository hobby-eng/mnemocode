// AUD-015 remediation: the public reproductions of the audit's findings, each with its controls,
// and the checks of the consolidated rules. Public test data only: the all-zero-entropy phrase, a
// published BIP39 phrase, a synthetic date and the published SSKR vector.

import { describe, expect, it } from "vitest";
import { allWiped, madeArrays } from "./helpers/made-arrays.js";
import { encodeMnemonic, parseDate } from "../src/core.js";
import { checksumValid, WordCandidateSearch } from "../src/core/candidates.js";
import { DatesAnswer, DateSearch, type WalletCheck } from "../src/core/date-search.js";
import { protectionFor, type ListProtectionChoice } from "../src/core/candidate-encryption.js";
import { zeroEntropyPhrase } from "../src/core/english-words.js";
import { Masking } from "../src/core/masking.js";
import { MissingCodes } from "../src/core/missing-codes.js";
import { MissingCodesSearch } from "../src/core/missing-codes-search.js";
import { textPieces } from "../src/core/pieces.js";
import { duration, TELL_SECONDS } from "../src/core/search-plan.js";
import {
  QUESTION_SECONDS,
  SECONDS_PER_HOUR,
  SECONDS_PER_MINUTE,
} from "../src/core/search-turns.js";
import { ENCODED_FORMATS } from "../src/core/types.js";
import type { WalletMatch } from "../src/core/wallet-check.js";
import { assertAllowedArguments, parseArguments } from "../src/cli/arguments.js";
import { optionLabel } from "../src/cli/option-copy.js";
import { crc32 } from "../src/sskr/checksum.js";
import { PivotBasis } from "../src/sskr/gf2.js";
import { MEMBER_BYTE } from "../src/sskr/share-layout.js";
import { nodeFillRandom, nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SHARE_UNITS } from "../src/sskr/share-units.js";
import { ShareSplit } from "../src/sskr/split.js";
import {
  bytewordsToUr,
  readShare,
  Share,
  shareFormatMirroring,
  urToBytewords,
  urToTransport,
} from "../src/sskr/transport.js";
import { sskrVectors } from "./helpers/vectors.js";

const PHRASE = zeroEntropyPhrase(12);
/** A published BIP39 test phrase (the 0x7f… vector), another phrase than PHRASE. */
const OTHER_PHRASE = "legal winner thank year wave sausage worth useful legal winner thank yellow";
const DATE = parseDate("23-09-2026");
const VECTOR = sskrVectors().deterministic[0]!;
const SHARE: string = VECTOR.shares[0]!;

describe("AUD-015-API001: nothing found after a stop is published", () => {
  /** A wallet check that matches, and stops the search two microtasks after it answered. */
  function lateStop(controller: AbortController): WalletCheck {
    return () => {
      queueMicrotask(() => queueMicrotask(() => controller.abort(new Error("stopped late"))));
      return { matched: true };
    };
  }

  it("the date search ends as stopped and calls onMatch for nothing", async () => {
    const controller = new AbortController();
    const published: string[] = [];
    const search = new DateSearch({
      indexes: encodeMnemonic(PHRASE, [DATE]).shiftedIndexes,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
      keep: 1,
      walletCheck: lateStop(controller),
    });
    // A stop is a result, not an error (CORE-22): stopped, with nothing published or kept.
    const result = await search.run({
      signal: controller.signal,
      onMatch: (match) => published.push(match.mnemonic),
    });
    expect(result).toMatchObject({ stopped: true, matchCount: 0, shown: [], kept: [] });
    expect(published).toEqual([]);
  });

  it("the word search and the search of marked codes return nothing after it either", async () => {
    const words = new AbortController();
    const found = await WordCandidateSearch.parse(`${"abandon ".repeat(11)}?`, "unknown-words").run(
      { walletCheck: lateStop(words), signal: words.signal },
    );
    expect(found).toMatchObject({ stopped: true, count: 0, matched: 0, shown: [], entropies: [] });
    const codes = new AbortController();
    const result = await new MissingCodesSearch(
      MissingCodes.read(`${"abandon ".repeat(11)}?`, "english", "direct"),
      () => "00000000",
    )
      .byWallet(lateStop(codes))
      .run({ signal: codes.signal });
    expect(result).toEqual({ kind: "stopped" });
  });

  it("keeps the matches of a search that nothing stops", async () => {
    const search = new DateSearch({
      indexes: encodeMnemonic(PHRASE, [DATE]).shiftedIndexes,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
      keep: 1,
      walletCheck: () => ({ matched: true }),
    });
    const published: string[] = [];
    const result = await search.run({
      signal: new AbortController().signal,
      onMatch: (match) => published.push(match.mnemonic),
    });
    expect(result.matchCount).toBe(1);
    expect(published).toEqual([PHRASE]);
  });
});

describe("AUD-015-API002: a split is made of one request", () => {
  /** A platform whose SSKR library waits until `gate` opens before it splits. */
  function gatedSplit(gate: Promise<void>): ShareSplit {
    return new ShareSplit(
      {
        ...nodeSharePlatform,
        createShares: async (secret, threshold, count, seed) => {
          await gate;
          return nodeSharePlatform.createShares(secret, threshold, count, seed);
        },
      },
      nodeFillRandom,
    );
  }

  it.each([
    ["direct", []],
    ["seedshift", [DATE]],
  ] as const)(
    "keeps the phrase it was given in %s mode when the host edits it",
    async (mode, dates) => {
      let open!: () => void;
      const gate = new Promise<void>((resolve) => (open = resolve));
      const request = { mnemonic: PHRASE, mode, dates: [...dates], threshold: 2, count: 3 };
      const pending = gatedSplit(gate).splitBackup(request);
      request.mnemonic = OTHER_PHRASE;
      open();
      const split = await pending;
      expect(split.original).toBe(PHRASE);
      expect(split.held).toBe(Masking.of(mode).held(PHRASE, dates));
      expect(split.records).toHaveLength(3);
    },
  );
});

describe("AUD-015-UI001: option labels never resolve inherited fields", () => {
  it.each(["__proto__", "constructor", "toString", "hasOwnProperty"])("labels %s", (key) => {
    expect(optionLabel(key)).toBe("unknown option");
  });

  it("keeps known labels and conceals unknown names", () => {
    expect(optionLabel("word")).toBe("BIP39 word");
    expect(optionLabel("made-up-option")).toBe("unknown option");
    expect(optionLabel("card-name")).toBe("card name");
    expect(optionLabel("studio-name")).toBe("studio name");
  });

  it("refuses --__proto__ and --constructor without resolving them as labels", () => {
    for (const name of ["__proto__", "constructor"])
      expect(() =>
        assertAllowedArguments(parseArguments([`--${name}`, "x"]), "table", ["word"]),
      ).toThrow("The table command does not support the unknown option setting.");
  });
});

describe("AUD-015-SEC001: the share readers wipe the bytes they only borrow", () => {
  it("wipes them in readShare, Share.read and bytewordsToUr", () => {
    const words = urToBytewords(SHARE);
    for (const read of [
      () => readShare(SHARE).ur,
      () => Share.read(SHARE).ur,
      () => bytewordsToUr(words),
    ]) {
      let received: unknown;
      const { arrays, refusal } = madeArrays(() => {
        received = read();
      });
      // A refusal is caught there too, so success is asserted here: an unexpected exception must
      // not pass merely because it wiped a buffer.
      expect(refusal).toBeUndefined();
      expect(received).toBe(SHARE);
      expect(arrays.length).toBeGreaterThan(0);
      expect(allWiped(arrays)).toBe(true);
    }
  });

  it("wipes them when the share's metadata is refused", () => {
    // The published share with a reserved metadata bit set, its CRC-32 written again to match.
    const transport = urToTransport(SHARE);
    const payloadStart = (transport[0] === 0xd9 ? 3 : 0) + 1;
    transport[payloadStart + MEMBER_BYTE]! |= 0x10;
    new DataView(transport.buffer, transport.byteOffset).setUint32(
      transport.length - 4,
      crc32(transport.subarray(0, -4)),
    );
    const refused = SHARE_UNITS.ur.text(Array.from(transport));
    expect(() => readShare(refused)).toThrow("Invalid SSKR share metadata.");
    const { arrays, refusal: why } = madeArrays(() => readShare(refused));
    expect(why).toBe("Invalid SSKR share metadata.");
    expect(arrays.length).toBeGreaterThan(0);
    expect(allWiped(arrays)).toBe(true);
  });

  it("leaves the transport that urToTransport hands its caller as it is", () => {
    expect(urToTransport(SHARE).some((byte) => byte !== 0)).toBe(true);
  });
});

describe("AUD-001-API001: the share form that mirrors a form of codes refuses one that names none", () => {
  it.each(["typo", null, 5])("refuses %s", (form) => {
    // A form that no type allows, fed on purpose as a JavaScript host could.
    expect(() => shareFormatMirroring(form as never)).toThrow("Unsupported encoded format");
  });

  it("maps every form of codes as before", () => {
    expect(ENCODED_FORMATS.map(shareFormatMirroring)).toEqual(
      ENCODED_FORMATS.map((form) => (form === "english" ? "words" : form)),
    );
  });
});

describe("AUD-015 recommendations: one rule for whole counts, one quorum owner, one hour", () => {
  it("refuses widths with their own words through the shared whole-number rule", () => {
    for (const width of [0, -1, 0.5, Number.NaN])
      expect(() => textPieces("abcd", width)).toThrow("A piece needs a whole width of at least 1.");
    expect(textPieces("abcd", 2)).toEqual(["ab", "cd"]);
  });

  it("keeps a split's refusal and its least threshold of two", () => {
    const refusal = "A split needs a threshold from 2";
    for (const [threshold, count] of [
      [1, 3],
      [4, 3],
      [2, 17],
      [2.5, 3],
    ])
      expect(() => ShareSplit.validateThreshold(threshold!, count!)).toThrow(refusal);
    expect(() => ShareSplit.validateThreshold(2, 16)).not.toThrow();
  });

  it("counts every time limit and every length in the same units", () => {
    expect(SECONDS_PER_HOUR).toBe(3_600);
    expect(QUESTION_SECONDS).toBe(12 * SECONDS_PER_HOUR);
    expect(TELL_SECONDS).toBe(SECONDS_PER_MINUTE);
    expect(duration(2 * SECONDS_PER_HOUR)).toBe("about 2 hours");
  });

  it("hands out a pivot that no caller can change", () => {
    const basis = new PivotBasis();
    expect(Object.isFrozen(basis.add(0b1011n))).toBe(true);
  });
});

describe("AUD-015 observations: a host's object is read once, then its copy is used", () => {
  /** `target`, whose `field` answers `first` when read first and `later` every time after. */
  function changing<T extends object, V>(target: T, field: string, first: V, later: V): T {
    let reads = 0;
    return Object.defineProperty(target, field, {
      enumerable: true,
      get: () => (reads++ === 0 ? first : later),
    });
  }

  it("keeps the protection of the kind that was checked", () => {
    const choice = changing<ListProtectionChoice, string>(
      { passphrase: "public test passphrase", kind: "passphrase" },
      "kind",
      "passphrase",
      "none",
    );
    expect(protectionFor(choice).constructor.name).toBe("PassphraseProtection");
  });

  it("counts a wallet answer as the one that was checked", async () => {
    const search = new DateSearch({
      indexes: encodeMnemonic(PHRASE, [DATE]).shiftedIndexes,
      dates: DatesAnswer.of([DATE]),
      mode: "seedshift",
      keep: 1,
      walletCheck: () => changing<WalletMatch, boolean>({ matched: false }, "matched", false, true),
    });
    expect((await search.run()).matchCount).toBe(0);
  });

  it("computes the checksum of the words that were checked", () => {
    const words = [...Array<number>(11).fill(0), 3];
    expect(checksumValid(words)).toBe(true);
    const host = changing([...words], "0", 0, 1);
    expect(checksumValid(host)).toBe(true);
  });
});

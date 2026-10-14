// AUD-014, the share modules: a share read with a longer CBOR head than the shortest restores
// (FUN001); a complete read keeps the places of the set it restored while the host changes the
// input (API004); the generated bridge's narrowed arguments are checked before the glue copies a
// secret (API008); an empty input is a trouble, not a crash (API009); a share writer refuses a
// format that is none (AUD-001-API001); a plan that no caller owns is wiped (AUD-012-SEC004); a
// split is bound to what was asked, every share checked (recommendation 18). Public test data
// only: vectors/sskr-v1.json, whose deterministic shares come from fixed test-only seeds.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import * as rawBridge from "../sskr-wasm/generated/recovery_sskr_wasm.js";
import { MINIMAL_BYTEWORDS } from "../src/sskr/bytewords-list.js";
import { crc32 } from "../src/sskr/checksum.js";
import {
  CheckedSskrBridge,
  UNSUPPORTED_ENCODING,
  UNSUPPORTED_GROUP_THRESHOLD,
} from "../src/sskr/bridge.js";
import { uncheckedField } from "../src/sskr/complete-shares.js";
import { ReadingSpace, unrepairedShare } from "../src/sskr/repair.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SEED_BYTES, type SharePlatform } from "../src/sskr/share-platform.js";
import { releaseRead, ShareRestore } from "../src/sskr/share-restore.js";
import { ShareExport, ShareSet } from "../src/sskr/share-set.js";
import { ShareSplit } from "../src/sskr/split.js";
import {
  CHECKSUM_BYTES,
  readShare,
  Share,
  SHARE_FORMATS,
  shareCountProblem,
  urToTransport,
  writeShare,
  type ShareFormat,
} from "../src/sskr/transport.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/sskr-v1.json", import.meta.url), "utf8"),
) as {
  deterministic: {
    entropy: string;
    testOnlySeed: string;
    shares: string[];
    colors: string[][];
  }[];
};
const VECTOR = vectors.deterministic[0]!;
const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
/** A 2-of-3 set of a 12-word phrase (bip39-128-2-of-3). */
const [FIRST, SECOND, THIRD] = VECTOR.shares as [string, string, string];
const PHRASE = entropyToMnemonic(bytes(VECTOR.entropy), wordlist);
const TEXTS = { decodeEntry: "The Decode tab" };
/** The message of an empty input, from the one rule of the share count (transport.ts). */
const NO_SHARES = shareCountProblem(0)!;

/** `share` as a UR whose byte string has the two-byte head 0x58 and its length (CBOR, RFC 8949). */
function longHeadUr(share: string): string {
  const cbor = urToTransport(share).subarray(0, -CHECKSUM_BYTES);
  // A share of a 12-word phrase is 21 bytes: its head is 0x40 + 21, one byte, when written short.
  const extended = Uint8Array.of(0x58, cbor[0]! - 0x40, ...cbor.subarray(1));
  const transport = new Uint8Array(extended.length + CHECKSUM_BYTES);
  transport.set(extended);
  new DataView(transport.buffer).setUint32(extended.length, crc32(extended));
  return "ur:sskr/" + Array.from(transport, (byte) => MINIMAL_BYTEWORDS[byte]!).join("");
}

/** The Node.js platform, counting the combines asked of it. */
function countingPlatform(): SharePlatform & { combined: number } {
  const platform = {
    ...nodeSharePlatform,
    combined: 0,
    combineShares: (records: readonly string[]) => {
      platform.combined += 1;
      return nodeSharePlatform.combineShares(records);
    },
  };
  return platform;
}

describe("AUD-014-FUN001: a share read with a longer CBOR head restores", () => {
  it("writes the share again with the shortest head, which the SSKR library takes", async () => {
    const long = longHeadUr(FIRST);
    expect(long).not.toBe(FIRST);
    // Read as the same share, in every form it is written in.
    expect(readShare(long)).toEqual({ ur: FIRST, format: "ur" });
    expect(Share.read(long).sameAs(Share.read(FIRST))).toBe(true);
    expect(writeShare(long, "words")).toBe(writeShare(FIRST, "words"));
    // The canonical control, and the long head with the second member: the same phrase.
    expect((await ShareSet.restore([FIRST, SECOND], nodeSharePlatform)).mnemonic).toBe(PHRASE);
    expect((await ShareSet.restore([long, SECOND], nodeSharePlatform)).mnemonic).toBe(PHRASE);
  });

  it("takes a share and its copy with a longer head as one share", async () => {
    const input = new ShareInput(TEXTS);
    input.add([FIRST, longHeadUr(FIRST), SECOND]);
    const { outcome, copies } = await input.restoreComplete(nodeSharePlatform);
    expect(copies.map((copy) => [copy.place, copy.of])).toEqual([[2, 1]]);
    expect(outcome.kind === "complete" && outcome.set.mnemonic).toBe(PHRASE);
    expect(outcome.kind === "complete" && outcome.places).toEqual([1, 3]);
  });
});

describe("AUD-014-API004: a complete read keeps the places of the set it restored", () => {
  it("gives the places of the shares restored when the host changes them meanwhile", async () => {
    let started!: () => void;
    let release!: () => void;
    const begun = new Promise<void>((resolve) => (started = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let gated = false;
    const platform: SharePlatform = {
      ...nodeSharePlatform,
      combineShares: async (records) => {
        if (!gated) {
          gated = true;
          started();
          await gate;
        }
        return nodeSharePlatform.combineShares(records);
      },
    };
    const input = new ShareInput(TEXTS);
    input.add([FIRST, SECOND, THIRD]);
    const reading = new ShareRestore(platform).read(input);
    await begun;
    // The host edits the input while the restore awaits: its places are now 2, 3 and 4.
    input.leaveOut(1);
    input.add([FIRST]);
    release();
    const read = await reading;
    expect(read.kind).toBe("complete");
    expect(read.kind === "complete" && read.places).toEqual([1, 2, 3]);
    expect(input.places()).toEqual([2, 3, 4]);
  });

  it("names a marked share that no reading fits by the place it was assessed at", async () => {
    const units = writeShare(SECOND, "indexes").split(" ");
    units[5] = "?";
    units[6] = String((Number(units[6]) + 1) % 2048);
    const input = new ShareInput(TEXTS);
    input.add([FIRST, units.join(" ")]);
    // The host's watch changes the input once the assessment is made: the share at index 1 is
    // then the one at place 3, not the share assessed at place 2.
    const read = await new ShareRestore(nodeSharePlatform).read(input, async (step) => {
      const plan = await step(undefined);
      input.leaveOut(1);
      input.add([THIRD]);
      return plan;
    });
    expect(read.kind === "trouble" && read.trouble).toMatchObject({ kind: "unreadable", place: 2 });
  });
});

describe("AUD-014-API009: an empty input is a trouble, before anything is restored", () => {
  it("says so for an input that starts empty, and for one whose shares were left out", async () => {
    const platform = countingPlatform();
    const restore = new ShareRestore(platform);
    const empty = new ShareInput(TEXTS);
    const cleared = new ShareInput(TEXTS);
    cleared.add([FIRST, SECOND]);
    cleared.leaveOut(1);
    cleared.leaveOut(2);
    for (const input of [empty, cleared]) {
      expect(await restore.read(input)).toEqual({
        kind: "trouble",
        trouble: { kind: "few", message: NO_SHARES },
        lines: [],
      });
      expect(input.rewritten()).toEqual({
        kind: "trouble",
        trouble: { kind: "few", message: NO_SHARES },
      });
    }
    expect(platform.combined).toBe(0);
  });
});

describe("AUD-014-API008: the bridge's narrowed arguments are checked first", () => {
  /** A secret that records whether the glue began to copy it: it reads the length first. */
  function watchedSecret(): { secret: Uint8Array; read: () => boolean } {
    let touched = false;
    const secret = {
      get length() {
        touched = true;
        return 16;
      },
    } as unknown as Uint8Array;
    return { secret, read: () => touched };
  }

  it("refuses an encoding that the glue would alias, before it copies the secret", async () => {
    const engine = await sskrEngine();
    expect(engine).toBeInstanceOf(CheckedSskrBridge);
    for (const encoding of [2, 256, 257, -1, Number.NaN, 0.5, 1.5, "1", undefined, null]) {
      const { secret, read } = watchedSecret();
      expect(() =>
        engine.create_sskr_shares_formatted(
          secret,
          1,
          Uint8Array.of(2, 3),
          new Uint8Array(SEED_BYTES),
          encoding as number,
        ),
      ).toThrow(UNSUPPORTED_ENCODING);
      expect(read()).toBe(false);
      expect(() => engine.recover_sskr_shares_formatted(FIRST, encoding as number)).toThrow(
        UNSUPPORTED_ENCODING,
      );
    }
    for (const threshold of [256, 257, -1, Number.NaN, 1.5]) {
      const { secret, read } = watchedSecret();
      expect(() =>
        engine.create_sskr_shares(secret, threshold, Uint8Array.of(2, 3), new Uint8Array(32)),
      ).toThrow(UNSUPPORTED_GROUP_THRESHOLD);
      expect(read()).toBe(false);
    }
  });

  it("passes the supported encodings through, and keeps the bridge's own refusal", async () => {
    const engine = await sskrEngine();
    const split = (encoding: number) =>
      engine
        .create_sskr_shares_formatted(
          bytes(VECTOR.entropy),
          1,
          Uint8Array.of(2, 3),
          bytes(VECTOR.testOnlySeed),
          encoding,
        )
        .trim()
        .split("\n");
    const urs = split(engine.ShareEncoding.CompactUr);
    expect(urs).toEqual(VECTOR.shares);
    const words = split(engine.ShareEncoding.Bytewords);
    expect(words[0]).toBe(writeShare(FIRST, "words"));
    const restored = engine.recover_sskr_shares_formatted(
      words.slice(0, 2).join("\n"),
      engine.ShareEncoding.Bytewords,
    );
    expect(Buffer.from(restored).toString("hex")).toBe(VECTOR.entropy);
    // The raw bridge refuses a code it sees with the same text, and wipes what it was given
    // (AUD-012-SEC001, test/aud-012-remediation.test.ts): the copy here stays in step with it.
    rawBridge.initSync({ module: readFileSync("sskr-wasm/generated/recovery_sskr_wasm_bg.wasm") });
    expect(() =>
      rawBridge.create_sskr_shares_formatted(
        bytes(VECTOR.entropy),
        1,
        Uint8Array.of(2, 3),
        bytes(VECTOR.testOnlySeed),
        2,
      ),
    ).toThrow(UNSUPPORTED_ENCODING);
  });
});

describe("AUD-001-API001: a share writer refuses a format that is none", () => {
  /** The first share of the vector in every form, as MnemoCode writes it. */
  const WRITTEN: Readonly<Record<ShareFormat, string>> = {
    ur: FIRST,
    words:
      "tuna next keep gyro exam jazz able acid able judo iron obey veto task wall part sets kiwi soap view back brew join atom slot monk work oboe judo",
    indexes:
      "1113 770 1378 1408 647 993 32 578 1714 1519 405 506 145 1901 1038 1104 1734 71 2023 552 641",
    unicode:
      "79E6 6E56 7AF9 7E2B 7B56 4F0A 5206 671D 9D3B 8DA3 5343 5931 770B 59FB 659C 5678 59C6 5EA6 758A 614B 521D",
    // The vector's own colors.
    colors: VECTOR.colors[0]!.join(" "),
    "colors-unicode":
      "E58FF506E712F2F5E084F400EA02EFD6E23AEECAE143E621E8C3F56CE331EFA1E11EE522E4AEE200",
  };
  const REFUSAL = `The share format must be one of: ${SHARE_FORMATS.join(", ")}.`;

  it("writes every form as before", () => {
    expect(Object.keys(WRITTEN)).toEqual([...SHARE_FORMATS]);
    const share = Share.read(FIRST);
    for (const format of SHARE_FORMATS) {
      expect(share.write(format)).toBe(WRITTEN[format]);
      expect(writeShare(FIRST, format)).toBe(WRITTEN[format]);
    }
  });

  it("refuses a string, null or a number that is no form", () => {
    const share = Share.read(FIRST);
    const set = { shares: [unrepairedShare(FIRST)], unsettled: [] };
    const exported = ShareExport.of(set, [1]);
    for (const format of ["typo", "UR", "", null, 0, 1]) {
      const wrong = format as ShareFormat;
      expect(() => share.write(wrong)).toThrow(REFUSAL);
      expect(() => writeShare(FIRST, wrong)).toThrow(REFUSAL);
      expect(() => ShareExport.of(set, [1], wrong)).toThrow(REFUSAL);
      expect(() => exported.inForm(wrong)).toThrow(REFUSAL);
    }
    // Without a format, a share keeps its own.
    expect(share.write()).toBe(FIRST);
    expect(share.write(undefined)).toBe(FIRST);
  });
});

describe("AUD-012-SEC004: a plan that ShareRestore.read hands out to none is wiped", () => {
  /** Runs `body` with every ReadingSpace that a plan solves recorded, and its arrays. */
  async function withSpaces<T>(body: (arrays: Uint8Array[]) => Promise<T>): Promise<T> {
    const arrays: Uint8Array[] = [];
    // oxlint-disable-next-line typescript/unbound-method -- kept to be called on ReadingSpace and put back
    const solve = ReadingSpace.solve;
    ReadingSpace.solve = (reading) => {
      const space = solve.call(ReadingSpace, reading);
      if (space !== undefined) arrays.push(...space.secretArrays());
      return space;
    };
    try {
      return await body(arrays);
    } finally {
      ReadingSpace.solve = solve;
      for (const array of arrays) array.fill(0);
    }
  }
  const nonzero = (arrays: readonly Uint8Array[]) =>
    arrays.filter((array) => array.some((byte) => byte !== 0)).length;
  /** The first share whole and the second in word numbers with one number marked. */
  function markedInput(): ShareInput {
    const units = writeShare(SECOND, "indexes").split(" ");
    units[5] = "?";
    const input = new ShareInput(TEXTS);
    input.add([FIRST, units.join(" ")]);
    return input;
  }

  it("wipes the plan when the host's HMAC fails as the report is made", async () => {
    await withSpaces(async (arrays) => {
      const failing: SharePlatform = {
        ...nodeSharePlatform,
        hmacSha256: () => {
          throw new Error("Synthetic HMAC unavailable");
        },
      };
      await expect(new ShareRestore(failing).read(markedInput())).rejects.toThrow(
        "Synthetic HMAC unavailable",
      );
      expect(arrays.length).toBeGreaterThan(0);
      expect(nonzero(arrays)).toBe(0);
    });
  });

  it("keeps a plan handed out usable until its search or its release", async () => {
    await withSpaces(async (arrays) => {
      const restore = new ShareRestore(nodeSharePlatform);
      const read = await restore.read(markedInput());
      expect(read.kind).toBe("marked");
      expect(nonzero(arrays)).toBeGreaterThan(0);
      releaseRead(read);
      expect(nonzero(arrays)).toBe(0);
      arrays.length = 0;
      const again = await restore.read(markedInput());
      if (again.kind !== "marked") throw new Error("Expected marked shares.");
      const found = await restore.search(again);
      expect(found.kind === "sets" && found.sets.map((set) => set.mnemonic)).toEqual([PHRASE]);
      expect(nonzero(arrays)).toBe(0);
    });
  });
});

describe("Recommendation 18: a split is bound to what was asked", () => {
  /** A platform whose createShares returns `make`'s shares instead of the engine's own. */
  function platformMaking(
    make: (shares: string[], secret: Uint8Array) => Promise<string[]>,
  ): SharePlatform {
    return {
      ...nodeSharePlatform,
      createShares: async (secret, threshold, count, seed) =>
        make(await nodeSharePlatform.createShares(secret, threshold, count, seed), secret),
    };
  }
  const split = (platform: SharePlatform, threshold = 2, count = 3) =>
    new ShareSplit(platform, (seed) => seed.set(bytes(VECTOR.testOnlySeed))).split(
      PHRASE,
      threshold,
      count,
    );

  it("splits as asked", async () => {
    expect(await split(nodeSharePlatform)).toEqual(VECTOR.shares);
  });

  it("refuses shares of another threshold, or out of member order", async () => {
    const otherThreshold = platformMaking((_, secret) =>
      nodeSharePlatform.createShares(secret, 3, 3, bytes(VECTOR.testOnlySeed)),
    );
    await expect(split(otherThreshold)).rejects.toThrow(
      "SSKR engine returned shares of another split than asked.",
    );
    const reordered = platformMaking(async (shares) => [shares[1]!, shares[0]!, shares[2]!]);
    await expect(split(reordered)).rejects.toThrow(
      "SSKR engine returned shares of another split than asked.",
    );
  });

  it("refuses a surplus share that gives another secret", async () => {
    // The same seed gives the same set identifier for another secret: its third share is of the
    // same set by its metadata, but holds another secret.
    const surplus = platformMaking(async (shares, secret) => {
      const other = Uint8Array.from(secret, (byte) => byte ^ 1);
      const [, , third] = await nodeSharePlatform.createShares(
        other,
        2,
        3,
        bytes(VECTOR.testOnlySeed),
      );
      return [shares[0]!, shares[1]!, third!];
    });
    await expect(split(surplus)).rejects.toThrow(
      "SSKR generated shares did not reconstruct the source entropy.",
    );
  });
});

describe("Recommendation 14: one projection of the shares that took no part", () => {
  it("counts them from 1, and gives no field when every share took part", () => {
    expect(uncheckedField([])).toEqual({});
    expect(uncheckedField([0, 2])).toEqual({ unchecked: [1, 3] });
  });
});

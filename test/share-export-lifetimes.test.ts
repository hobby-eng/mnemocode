import { afterEach, describe, expect, it, vi } from "vitest";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { ShareInput } from "../src/sskr/share-input.js";
import { ShareExport, type WrittenShare } from "../src/sskr/share-set.js";
import { ShareRestore } from "../src/sskr/share-restore.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import type { RepairedShares } from "../src/sskr/joint-results.js";
import { endLifetimeIfPresent } from "./helpers/owner-lifetime.js";
import { sskrVectors } from "./helpers/vectors.js";

// Public bip39-128-2-of-3 vector; expected output is independent of export serialization.
const FIRST_SHARE = "ur:sskr/goemjzaeadaejoinoyvotkwlptsskispvwbkbwjnamstlubnampf";
const WIPED_CODE = "core.secret-value.wiped";

interface ObservedExport {
  readonly owner: ShareExport;
  readonly earlier: readonly WrittenShare[];
}

function observeExports(): ObservedExport[] {
  const observed: ObservedExport[] = [];
  const create = ShareExport.of.bind(ShareExport);
  // Observe actual owners without replacing validation, results or their lifetime methods.
  vi.spyOn(ShareExport, "of").mockImplementation((...args) => {
    const owner = create(...args);
    observed.push({ owner, earlier: owner.shown });
    return owner;
  });
  return observed;
}

function closeObserved(observed: readonly ObservedExport[]): void {
  for (const { owner } of observed) endLifetimeIfPresent(owner);
}

function publicShares(uris: readonly string[]): RepairedShares {
  return {
    shares: uris.map((ur) => ({ ur, format: "ur" as const, repaired: false, filled: [] })),
    unsettled: [],
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Temporary exports and transferred export owners", () => {
  it("disposes its temporary export while returning independent repaired share views", async () => {
    using input = new ShareInput({ decodeEntry: "The Decode tab" });
    input.add([SSKR_SET_VECTOR.shares[0]]);
    const observed = observeExports();
    try {
      const result = await new ShareRestore(nodeSharePlatform).repair({
        input,
        mode: "direct",
        confirmed: true,
        form: "ur",
        fingerprintOf: masterFingerprint,
      });
      expect(result).toEqual({
        kind: "shares",
        shares: [{ number: 1, text: FIRST_SHARE, format: "ur", record: FIRST_SHARE }],
        form: "ur",
        repairs: [],
        lines: [],
        notes: [],
      });
      expect(observed.length).toBeGreaterThan(0);
      for (const { owner, earlier } of observed) {
        expect(earlier).toEqual([{ ur: FIRST_SHARE, format: "ur", number: 1 }]);
        expect(() => owner.shown).toThrow(expect.objectContaining({ code: WIPED_CODE }));
        expect(() => owner.saved).toThrow(expect.objectContaining({ code: WIPED_CODE }));
      }
      expect(input.texts()).toEqual([FIRST_SHARE]);
      expect(result).toHaveProperty("shares.0.record", FIRST_SHARE);
    } finally {
      closeObserved(observed);
    }
  });

  it("disposes an untransferred export when a later share fails transport validation", () => {
    const given = publicShares([FIRST_SHARE, "ur:bytes/aa"]);
    const observed = observeExports();
    try {
      expect(() => ShareInput.checkedExport(given, [1, 2], undefined)).toThrow(
        expect.objectContaining({
          code: "sskr.transport.expected-single-part-ur-sskr-record",
          message: "Expected a single-part ur:sskr record.",
        }),
      );
      // Validation before allocation is safe too; only owners actually created must be closed.
      for (const { owner, earlier } of observed) {
        expect(earlier.map(({ ur }) => ur)).toEqual([FIRST_SHARE, "ur:bytes/aa"]);
        expect(() => owner.shown).toThrow(expect.objectContaining({ code: WIPED_CODE }));
        expect(() => owner.saved).toThrow(expect.objectContaining({ code: WIPED_CODE }));
      }
      expect(given.shares.map(({ ur }) => ur)).toEqual([FIRST_SHARE, "ur:bytes/aa"]);
    } finally {
      closeObserved(observed);
    }
  });

  it.each(["written", "none", "trouble"] as const)(
    "transfers the %s export to its caller without consuming borrowed shares",
    (kind) => {
      const uris =
        kind === "trouble"
          ? [FIRST_SHARE, sskrVectors().deterministic[1]!.shares[0]!]
          : [FIRST_SHARE];
      const given: RepairedShares = {
        ...publicShares(uris),
        unsettled: kind === "none" ? [{ share: 1, position: 1 }] : [],
      };
      const places = uris.map((_, index) => index + 1);
      const result = ShareInput.checkedExport(given, places, undefined);
      using written = result.written;
      expect(result.kind).toBe(kind);
      const expected = kind === "none" ? [] : uris;
      const earlier = written.shown;
      expect(earlier.map(({ ur }) => ur)).toEqual(expected);
      expect(earlier.map(({ number }) => number)).toEqual(kind === "none" ? [] : places);
      using copy = written.inForm("indexes");
      endLifetimeIfPresent(written);
      expect(() => written.shown).toThrow(expect.objectContaining({ code: WIPED_CODE }));
      expect(copy.saved.map(({ ur }) => ur)).toEqual(expected);
      expect(copy.shown.every(({ format }) => format === "indexes")).toBe(true);
      expect(earlier.map(({ ur }) => ur)).toEqual(expected);
      expect(given.shares.map(({ ur }) => ur)).toEqual(uris);
    },
  );
});

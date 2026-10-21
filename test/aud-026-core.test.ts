import { assert, describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { ByteArray } from "../src/core/byte-array.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { coinById } from "../src/core/coins.js";
import { CoinAddressComparison } from "../src/core/coin-address-evidence.js";
import { isPlacedKind, isScannedKind, parseBitcoinAddress } from "../src/core/wallet-evidence.js";
import { encodeCandidateList, OpenedCandidateList } from "../src/core/candidate-list.js";
import { resolveTemplateId } from "../src/export/template-catalog.js";
import { readRenderAsset } from "../src/export/platform.js";
import { TEST_ADDRESS, TEST_PHRASE } from "./helpers/test-phrase.js";

describe("AUD-026 selector privacy and owned address locations", () => {
  it("refuses selectors without repeating or coercing supplied text", async () => {
    // Selectors that no type allows, fed on purpose as a JavaScript host could.
    const refusals: readonly (readonly [() => unknown, string])[] = [
      [() => EncodedForm.of(TEST_PHRASE as never), "core.encoded-form.unsupported-encoded-format"],
      [() => coinById(TEST_PHRASE), "core.coins.coin.unknown-coin-coins"],
      // A network that no type allows, fed on purpose.
      [
        () => parseBitcoinAddress(TEST_ADDRESS, TEST_PHRASE as never),
        "core.wallet-evidence.bitcoin-network",
      ],
      [
        () => resolveTemplateId(TEST_PHRASE),
        "export.template-catalog.card-template-unknown-incompatible-list-available-preview-templates",
      ],
      [
        () =>
          readRenderAsset(
            {
              readAsset: async () => {
                throw Error("host must not run");
              },
            },
            TEST_PHRASE,
          ),
        "export.platform.unknown-card-asset",
      ],
    ];
    for (const [action, code] of refusals) {
      try {
        await action();
        expect.fail("A selector must be refused");
      } catch (error) {
        assert.instanceOf(error, Error);
        // expect.fail's own error has no code, so a selector that is not refused fails here too.
        expect(error, code).toMatchObject({ code });
        expect(error.message).not.toContain(TEST_PHRASE);
      }
    }
    const supplied = {
      toString: () => {
        throw Error("coercion must not run");
      },
    };
    // An object that no type allows, fed on purpose as a JavaScript host could.
    expect(() => EncodedForm.of(supplied as never)).toThrow("Unsupported encoded format.");
    expect(() => coinById(supplied as never)).toThrow("Unknown coin");
    expect(() => resolveTemplateId(supplied as never)).toThrow("unknown or incompatible");
  });

  it("reads each address index once before it writes paths", () => {
    let reads = 0;
    const location = {
      account: 0,
      branch: 0,
      get index() {
        return reads++ === 0 ? 0 : 2 ** 31;
      },
    };
    expect(coinById("bitcoin").parse(TEST_ADDRESS).branchPathsAt(location)).toEqual([
      "m/84'/0'/0'/0",
    ]);
    expect(reads).toBe(1);
  });

  it("retains the validated location for address comparison", () => {
    let reads = 0;
    const location = {
      account: 0,
      branch: 0,
      get index() {
        return reads++ === 0 ? 0 : 2 ** 31;
      },
    };
    expect(
      () =>
        new CoinAddressComparison({
          coin: coinById("bitcoin"),
          value: TEST_ADDRESS,
          location,
          addresses: 2,
        }),
    ).not.toThrow();
    expect(reads).toBe(1);
  });

  it("refuses an invalid first reading of a location", () => {
    expect(() =>
      coinById("bitcoin")
        .parse(TEST_ADDRESS)
        .branchPathsAt({ account: 0, branch: 0, index: 2 ** 31 }),
    ).toThrow("index");
  });

  it.each(["constructor", "toString", "hasOwnProperty", "__proto__"])(
    "rejects the inherited evidence name %s",
    (kind) => {
      expect(isPlacedKind(kind)).toBe(false);
      expect(isScannedKind(kind)).toBe(false);
    },
  );

  it("keeps supported evidence and network hints", () => {
    expect(isPlacedKind("address")).toBe(true);
    expect(isPlacedKind("master-fingerprint")).toBe(false);
    expect(coinById("dash").addressFormsOn(true)).toBe("tdash1k…");
    expect(coinById("dash").addressFormsOn(false)).toBe("X… or dash1k…");
  });
});

describe("AUD-026 attached byte arrays and terminal candidate disposal", () => {
  it("admits intrinsic storage without trusting own getters or a prototype", () => {
    const bytes = new Uint8Array(16);
    Object.defineProperty(bytes, "byteLength", {
      get: () => {
        throw Error("own getter");
      },
    });
    expect(ByteArray.length(bytes)).toBe(16);
    expect(ByteArray.is(Buffer.alloc(16))).toBe(true);
    expect(ByteArray.is(runInNewContext("new Uint8Array(16)"))).toBe(true);
    const wider = new Uint16Array(8);
    Object.setPrototypeOf(wider, Uint8Array.prototype);
    expect(ByteArray.is(wider)).toBe(false);
    const detached = new Uint8Array(16);
    structuredClone(detached.buffer, { transfer: [detached.buffer] });
    expect(ByteArray.is(detached)).toBe(false);
  });

  it.each([false, true])(
    "keeps Unicode passphrases before disposal and refuses its candidates after it (passphrase per record: %s)",
    (perRecord) => {
      const passphrase = "\ufeffpublic é password";
      const list = OpenedCandidateList.fromBytes(
        encodeCandidateList({
          passphrase,
          records: [{ entropy: new Uint8Array(16), ...(perRecord ? { passphrase } : {}) }],
        }),
      );
      expect(list.candidates()).toEqual([{ phrase: TEST_PHRASE, passphrase }]);
      list.wipe();
      expect(() => list.candidates()).toThrow("has been wiped");
      expect(list.count).toBe(1);
      expect(list.passphrases).toBe(perRecord ? "records" : "list");
      list.wipe();
      expect(() => list.candidates()).toThrow("has been wiped");
    },
  );
});

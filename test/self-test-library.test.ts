import { pbkdf2Sync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COIN_ADDRESS_SELF_TEST } from "../src/core/coins-self-test.js";
import { MasterFingerprintCheck, type Pbkdf2HmacSha512 } from "../src/core/master-fingerprint.js";
import { MnemoCodeSelfTest, type SelfTestFeature } from "../src/core/self-test.js";
import { WALLET_EVIDENCE_SELF_TEST } from "../src/core/wallet-evidence-self-test.js";
import { HEIR_SHEET_SELF_TEST } from "../src/export/heir-sheet-self-test.js";
import { SHARE_CARDS_SELF_TEST } from "../src/export/sskr-render-self-test.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";

// The host services a page would give, here from Node.js, and the published vectors file.
const pbkdf2: Pbkdf2HmacSha512 = (password, salt, rounds, bytes) =>
  new Uint8Array(pbkdf2Sync(password, salt, rounds, bytes, "sha512"));
const fingerprints = new MasterFingerprintCheck(pbkdf2);
const publicVectors: unknown = JSON.parse(
  readFileSync(new URL("../vectors/mnemocode-v1.json", import.meta.url), "utf8"),
);
/** The rows of the library's own checks, in order, with a share platform. */
const LIBRARY_ROWS = [
  "Core integrity",
  "SSKR integrity",
  "Public vectors",
  "Representation matrix",
  "Date ordering",
  "BIP39 seed",
  "Dates",
  "Backup reading",
  "Word search",
  "Candidate lists",
  "Backup check",
  "Share repair",
  "Share unmasking",
];
/** The features that the command line builds in, and their rows. */
const FEATURES = [
  WALLET_EVIDENCE_SELF_TEST,
  COIN_ADDRESS_SELF_TEST,
  HEIR_SHEET_SELF_TEST,
  SHARE_CARDS_SELF_TEST,
];
const FEATURE_ROWS = ["Wallet evidence", "Coin addresses", "Heir sheet", "Share cards"];

describe("The self-test as a library (core/self-test.ts)", () => {
  it("runs every library check with a host's services, its own checks around them", async () => {
    const order: string[] = [];
    const report = await new MnemoCodeSelfTest({
      // An answer that comes later, as a page's WebCrypto gives it.
      fingerprint: async (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
      pbkdf2: async (...parameters) => pbkdf2(...parameters),
      sharePlatform: nodeSharePlatform,
      features: FEATURES,
      before: [{ name: "Host first", detail: "", run: () => void order.push("first") }],
      after: [{ name: "Host last", detail: "", run: () => void order.push("last") }],
    }).run();
    expect(report.rows.map((row) => row.name)).toEqual([
      "Host first",
      ...LIBRARY_ROWS,
      ...FEATURE_ROWS,
      "Host last",
    ]);
    const detail = (name: string) => report.rows.find((row) => row.name === name)?.detail;
    expect(detail("BIP39 seed")).toContain("24 BIP39 vectors");
    expect(detail("Share repair")).toContain("shares together");
    expect(order).toEqual(["first", "last"]);
    expect(report.publicVectors).toBeGreaterThanOrEqual(7);
    expect(report.roundTrips).toBe(75);
  }, 60_000);

  it("leaves out what needs a host service it does not get, as its rows say", async () => {
    const report = await new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
    }).run();
    expect(report.rows.map((row) => row.name)).toEqual(
      LIBRARY_ROWS.filter((name) => name !== "SSKR integrity"),
    );
    const detail = (name: string) => report.rows.find((row) => row.name === name)?.detail;
    expect(detail("BIP39 seed")).not.toContain("24 BIP39 vectors");
    expect(detail("Share repair")).not.toContain("shares together");
    expect(detail("Backup check")).not.toContain("shares");
  }, 60_000);

  it("stops at the first check that fails, and refuses a damaged vectors file", async () => {
    const failing = new MnemoCodeSelfTest({
      fingerprint: () => "00000000",
      publicVectors,
    });
    await expect(failing.run()).rejects.toThrow(/fingerprint mismatch/u);
    const empty = new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors: { version: 1, vectors: [] },
    });
    await expect(empty.run()).rejects.toThrow(/missing required vector/u);
    expect(() => new MnemoCodeSelfTest({ publicVectors } as never)).toThrow(TypeError);
  }, 60_000);

  it("fails when the host's PBKDF2 gives another seed than a BIP39 vector's", async () => {
    const wrongSeeds = new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
      // The passphrase left out of the salt: the seed of another wallet.
      pbkdf2: (password, _salt, rounds, bytes) => pbkdf2(password, "mnemonic", rounds, bytes),
    });
    await expect(wrongSeeds.run()).rejects.toThrow(/BIP39 seed vector mismatch/u);
  }, 60_000);

  it("has a quick core check that needs nothing from the host", () => {
    expect(() => MnemoCodeSelfTest.core()).not.toThrow();
    expect(() => MnemoCodeSelfTest.core(FEATURES)).not.toThrow();
  });

  it("runs the quick checks of the features given to core, and stops at one that fails", () => {
    const order: string[] = [];
    const feature = (name: string, fails = false): SelfTestFeature => ({
      startup: () => {
        order.push(name);
        if (fails) throw new Error(`${name} mismatch.`);
      },
      check: { name, detail: "", run: () => undefined },
    });
    MnemoCodeSelfTest.core([feature("first"), feature("second")]);
    expect(order).toEqual(["first", "second"]);
    expect(() => MnemoCodeSelfTest.core([feature("third", true), feature("fourth")])).toThrow(
      /third mismatch/u,
    );
    expect(order).toEqual(["first", "second", "third"]);
  });
});

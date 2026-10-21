import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { nodePbkdf2HmacSha512 } from "../src/bitcoin-evidence.js";
import { COIN_ADDRESS_SELF_TEST } from "../src/core/coins-self-test.js";
import { MasterFingerprintCheck } from "../src/core/master-fingerprint.js";
import { MnemoCodeSelfTest, type SelfTestFeature } from "../src/core/self-test.js";
import { WALLET_EVIDENCE_SELF_TEST } from "../src/core/wallet-evidence-self-test.js";
import { heirSheetSelfTest } from "../src/export/heir-sheet-self-test.js";
import { nodeCardRenderer } from "../src/export/platform-node.js";
import { shareCardsSelfTest } from "../src/export/sskr-render-self-test.js";
import { nodeSharePlatform } from "../src/sskr/share-platform-node.js";
import { mnemocodeVectors } from "./helpers/vectors.js";

// The host services a page would give, here from Node.js, and the published vectors file.
const fingerprints = new MasterFingerprintCheck(nodePbkdf2HmacSha512);
const publicVectors: unknown = mnemocodeVectors();
/** The rows of the library's own checks, in order, with a share platform. */
const LIBRARY_ROWS = [
  "Core integrity",
  "SSKR integrity",
  "Public vectors",
  "Representation matrix",
  "Date ordering",
  "Word lists",
  "BIP39 seed",
  "Dates",
  "Backup reading",
  "Marked codes search",
  "Word search",
  "Candidate lists",
  "Backup check",
  "Share repair",
  "Share unmasking",
  "Share split and restore",
];
/** The rows that need the host's SSKR library throughout, left out without it. */
const SHARE_ONLY_ROWS = new Set(["SSKR integrity", "Share split and restore"]);
/** Four of the features that the command line builds in (cli/self-test.ts), and their rows. */
const FEATURES = [
  WALLET_EVIDENCE_SELF_TEST,
  COIN_ADDRESS_SELF_TEST,
  heirSheetSelfTest(nodeCardRenderer),
  shareCardsSelfTest(nodeCardRenderer),
];
const FEATURE_ROWS = ["Wallet evidence", "Coin addresses", "Heir sheet", "Share cards"];

describe("The self-test as a library (core/self-test.ts)", () => {
  it("runs every library check with a host's services, its own checks around them", async () => {
    const order: string[] = [];
    const report = await new MnemoCodeSelfTest({
      // An answer that comes later, as a page's WebCrypto gives it.
      fingerprint: async (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
      pbkdf2: async (...parameters) => nodePbkdf2HmacSha512(...parameters),
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
  });

  it("leaves out what needs a host service it does not get, as its rows say", async () => {
    const report = await new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
    }).run();
    expect(report.rows.map((row) => row.name)).toEqual(
      LIBRARY_ROWS.filter((name) => !SHARE_ONLY_ROWS.has(name)),
    );
    const detail = (name: string) => report.rows.find((row) => row.name === name)?.detail;
    expect(detail("BIP39 seed")).not.toContain("24 BIP39 vectors");
    expect(detail("Share repair")).not.toContain("shares together");
    expect(detail("Backup check")).not.toContain("shares");
  });

  it("times each check and the whole self-test by the host's clock", async () => {
    // A clock that moves only while the host's own checks run: 1.5 s first, 0.25 s last.
    let time = 0;
    const report = await new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
      now: () => time,
      before: [{ name: "Host first", detail: "", run: () => void (time += 1_500) }],
      after: [{ name: "Host last", detail: "", run: () => void (time += 250) }],
    }).run();
    const library = LIBRARY_ROWS.filter((name) => !SHARE_ONLY_ROWS.has(name));
    expect(report.rows.map((row) => row.milliseconds)).toEqual([
      1_500,
      ...library.map(() => 0),
      250,
    ]);
    expect(report.milliseconds).toBe(1_750);
  });

  it("refuses a mismatched fingerprint, a missing vector and an absent host fingerprint", async () => {
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
    // Options without the host's fingerprint, given on purpose as a JavaScript host could.
    expect(() => new MnemoCodeSelfTest({ publicVectors } as never)).toThrow(TypeError);
  });

  it("fails when the host's PBKDF2 gives another seed than a BIP39 vector's", async () => {
    const wrongSeeds = new MnemoCodeSelfTest({
      fingerprint: (mnemonic) => fingerprints.fingerprint(mnemonic),
      publicVectors,
      // The passphrase left out of the salt: the seed of another wallet.
      pbkdf2: (password, _salt, rounds, bytes) =>
        nodePbkdf2HmacSha512(password, "mnemonic", rounds, bytes),
    });
    await expect(wrongSeeds.run()).rejects.toThrow(/BIP39 seed vector mismatch/u);
  });
});

describe("The self-test as a library (core/self-test.ts)", () => {
  it("has a quick core check that needs nothing from the host", () => {
    expect(() => MnemoCodeSelfTest.core()).not.toThrow();
    expect(() => MnemoCodeSelfTest.core(FEATURES)).not.toThrow();
  });

  it("runs the quick checks of every feature without the render platform (AUD-010-API002)", () => {
    // In a process of its own, which loads no Node.js platform: the card features get a renderer
    // whose every service throws, so a quick check that used one would fail.
    const script = `
      const { MnemoCodeSelfTest } = await import("./src/core/self-test.ts");
      const { CardRenderer } = await import("./src/export/card-renderer.ts");
      const refuse = () => {
        throw new Error("A quick check used the render platform.");
      };
      const renderer = new CardRenderer({
        readAsset: refuse,
        randomInt: refuse,
        decodePng: refuse,
        encodePng: refuse,
        qrModules: refuse,
      });
      const features = [
        (await import("./src/core/wallet-evidence-self-test.ts")).WALLET_EVIDENCE_SELF_TEST,
        (await import("./src/core/coins-self-test.ts")).COIN_ADDRESS_SELF_TEST,
        (await import("./src/export/heir-sheet-self-test.ts")).heirSheetSelfTest(renderer),
        (await import("./src/export/sskr-render-self-test.ts")).shareCardsSelfTest(renderer),
        (await import("./src/export/card-sets-self-test.ts")).cardSetsSelfTest(renderer),
      ];
      MnemoCodeSelfTest.core(features);
      console.log("quick checks passed");
    `;
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), encoding: "utf8" },
    );
    expect(output.trim()).toBe("quick checks passed");
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

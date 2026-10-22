import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { saveShares } from "../src/cli/sskr-output.js";
import { readRepairableShare } from "../src/sskr/repair.js";
import { writeShare } from "../src/sskr/transport.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { runBuiltCliSync as cli } from "./helpers/built-cli.js";
import { DATE, TEST_PHRASE } from "./helpers/test-phrase.js";

let folder: string;
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), "mnemocode-share-qr-"));
});
afterEach(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("standalone share QR images", () => {
  it.each(["ur", "words", "indexes", "unicode", "colors", "colors-unicode"] as const)(
    "exports each %s share as its own readable PNG without cards",
    async (format) => {
      const target = join(folder, "qr");
      const shares = SSKR_SET_VECTOR.shares.slice(0, 2);
      const result = cli([
        "sskr-export",
        ...shares.flatMap((share) => ["--share", share]),
        "--format",
        format,
        "--qr-dir",
        target,
        "--output",
        join(folder, "shares.txt"),
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(writeShare(shares[0]!, format));
      const images = (await readdir(target)).sort();
      expect(images).toEqual(["share-1-qr.png", "share-2-qr.png"]);
      const payloads = await Promise.all(images.map((name) => decodeQrPngFile(join(target, name))));
      expect(payloads).toEqual(shares.map((share) => writeShare(share, format)));
      expect(payloads.map((text) => readRepairableShare(text).ur)).toEqual(shares);
      expect((await readFile(join(folder, "shares.txt"), "utf8")).trimEnd().split("\n")).toEqual(
        payloads,
      );
      if (process.platform !== "win32") {
        expect((await stat(target)).mode & 0o777).toBe(0o700);
        for (const image of images)
          expect((await stat(join(target, image))).mode & 0o777).toBe(0o600);
      }
    },
  );

  it.each(["encode", "sskr-split"] as const)(
    "restores the phrase from two QR images produced by %s",
    async (command) => {
      const target = join(folder, "qr");
      const split = cli([
        command,
        ...(command === "encode" ? ["--sskr", "--share-format", "words"] : ["--format", "words"]),
        "--mnemonic",
        TEST_PHRASE,
        "--mode",
        "seedshift",
        "--date",
        DATE,
        "--threshold",
        "2",
        "--shares",
        "3",
        "--qr-dir",
        target,
      ]);
      expect(split.status, split.stderr).toBe(0);
      expect(await readdir(target)).toHaveLength(3);
      const restored = cli([
        "sskr-combine",
        "--share-qr",
        join(target, "share-1-qr.png"),
        "--share-qr",
        join(target, "share-3-qr.png"),
        "--mode",
        "seedshift",
        "--date",
        DATE,
      ]);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toContain(TEST_PHRASE);
    },
  );

  it("numbers an occupied QR folder without changing its existing contents", async () => {
    const target = join(folder, "qr");
    await writeFile(target, "public sentinel");
    const result = cli(["sskr-export", "--share", SSKR_SET_VECTOR.shares[0]!, "--qr-dir", target]);
    expect(result.status, result.stderr).toBe(0);
    expect(await readFile(target, "utf8")).toBe("public sentinel");
    expect(await readdir(`${target}-1`)).toEqual(["share-1-qr.png"]);
  });

  it("removes the staged images if a later share cannot be written", async () => {
    await expect(
      saveShares(
        [
          { ur: SSKR_SET_VECTOR.shares[0]!, format: "words", number: 1 },
          { ur: "bad", format: "words", number: 2 },
        ],
        { "qr-dir": join(folder, "qr") },
        undefined,
        false,
      ),
    ).rejects.toThrow(/SSKR|share|ur:/iu);
    expect(await readdir(folder)).toEqual([]);
  });
});

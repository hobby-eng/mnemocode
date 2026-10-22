import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { decodeQrPngFile } from "../src/cli/qr-input.js";
import { runBuiltCliSync as cli } from "./helpers/built-cli.js";
import { DATE, TEST_NUMBERS, TEST_PHRASE } from "./helpers/test-phrase.js";

it.each(["seedshift", "seedshift-legacy"] as const)(
  "shows only original words with %s without putting them in the encoded files",
  async (mode) => {
    const folder = await mkdtemp(join(tmpdir(), "mnemocode-original-copy-"));
    try {
      for (const format of ["english", "indexes", "unicode", "colors", "colors-unicode"]) {
        const record = join(folder, `${format}.txt`);
        const qr = join(folder, `${format}.png`);
        const result = cli([
          "encode",
          "--mnemonic",
          TEST_PHRASE,
          "--date",
          DATE,
          "--mode",
          mode,
          "--format",
          format,
          "--show-original",
          "words",
          "--output",
          record,
          "--qr",
          qr,
        ]);
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain(TEST_PHRASE);
        expect(result.stdout).not.toContain(TEST_NUMBERS);
        expect(result.stdout).not.toContain("Original seed phrase in codes");
        const saved = await readFile(record, "utf8");
        expect(saved).not.toContain(TEST_PHRASE);
        expect(saved).not.toContain(TEST_NUMBERS);
        const encoded = await decodeQrPngFile(qr);
        expect(saved.trimEnd()).toBe(`MNC1:${mode}:${format}:${encoded}`);
        expect(encoded).not.toBe(TEST_NUMBERS);
      }
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

it("does not show an original copy unless requested", () => {
  const result = cli([
    "encode",
    "--mnemonic",
    TEST_PHRASE,
    "--date",
    DATE,
    "--mode",
    "seedshift",
    "--format",
    "indexes",
  ]);
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).not.toContain(TEST_PHRASE);
  expect(result.stdout).not.toContain(TEST_NUMBERS);
});

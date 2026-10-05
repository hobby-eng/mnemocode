import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const mnemonic = `${"abandon ".repeat(11)}about`;
function cli(args: string[]) {
  const result = spawnSync(process.execPath, ["dist/mnemocode.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  });
  if (result.error) throw result.error;
  return result;
}
describe("integrated SSKR CLI", () => {
  it("shares transformed entropy once and reverses the dates with a quorum", () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-cli-"));
    try {
      const path = join(dir, "shares.txt");
      const split = cli([
        "encode",
        "--sskr",
        "--mnemonic",
        mnemonic,
        "--dates",
        "23-09-2026",
        "--format",
        "3",
        "--share-format",
        "colors",
        "--threshold",
        "2",
        "--shares",
        "3",
        "--output",
        path,
      ]);
      expect(split.status, split.stderr).toBe(0);
      expect(split.stdout).toContain("Unicode code points:");
      expect(split.stdout).toContain("#");
      expect(split.stdout + split.stderr).not.toContain("\x1b");
      const records = readFileSync(path, "utf8").trim().split("\n");
      expect(records).toHaveLength(3);
      // An SSKR file holds the shares themselves, one per line in the share format chosen, here
      // color codes, with no MNC1 record header; sskr-combine reads them back.
      for (const record of records) expect(record).toMatch(/^#[0-9A-F]{6}( #[0-9A-F]{6})+$/u);
      const restored = cli([
        "sskr-combine",
        "--share",
        records[0]!,
        "--share",
        records[2]!,
        "--dates",
        "23-09-2026",
      ]);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toContain(mnemonic);
      const refused = cli([
        "encode",
        "--sskr",
        "--mnemonic",
        mnemonic,
        "--threshold",
        "2",
        "--shares",
        "3",
        "--output",
        path,
      ]);
      expect(refused.status).toBe(1);
      expect(refused.stderr).toContain("already exists");
      expect(readFileSync(path, "utf8").trim().split("\n")).toEqual(records);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects unsupported and orphan options before secret input", () => {
    for (const extras of [
      ["--threshold", "2"],
      ["--share-format", "colors"],
      ["--card-layout", "qr"],
    ]) {
      const result = cli(["encode", "--ask-secrets", ...extras]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("available only in SSKR mode");
    }
    const result = cli([
      "encode",
      "--sskr",
      "--ask-secrets",
      "--threshold",
      "2",
      "--shares",
      "3",
      "--qr",
      "x.png",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("not available in SSKR mode");
  });
  it("keeps terminal color swatches plain when redirected", () => {
    const result = cli(["encode", "--mnemonic", mnemonic, "--format", "5", "--cards"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout + result.stderr).not.toContain("\x1b");
  });

  it("writes and saves shares in Bytewords, and restores the phrase from them", () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-words-"));
    try {
      const path = join(dir, "shares.txt");
      const split = cli([
        "sskr-split",
        "--mnemonic",
        mnemonic,
        "--threshold",
        "2",
        "--shares",
        "3",
        "--format",
        "words",
        "--output",
        path,
      ]);
      expect(split.status, split.stderr).toBe(0);
      const records = readFileSync(path, "utf8").trim().split("\n");
      expect(records).toHaveLength(3);
      // Standard Bytewords of an SSKR share start with its CBOR tag: tuna next keep.
      for (const record of records) expect(record).toMatch(/^tuna next keep( [a-z]{4})+$/u);
      expect(split.stdout).toContain(records[0]!);
      const restored = cli(["sskr-combine", "--share", records[1]!, "--share", records[2]!]);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toContain(mnemonic);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

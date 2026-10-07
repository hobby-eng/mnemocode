import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encodeMnemonic, formatEncoded, parseDate } from "../src/core.js";
import { readRepairableShare } from "../src/sskr/repair.js";
import { masterFingerprint } from "../src/bitcoin-evidence.js";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { writeShare, type ShareFormat } from "../src/sskr/transport.js";
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
  it("repairs marked shares in every form before CLI recovery, without exposing the damaged text", () => {
    const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
    const formats: ShareFormat[] = [
      "ur",
      "words",
      "indexes",
      "unicode",
      "colors",
      "colors-unicode",
    ];
    for (const format of formats) {
      const written = writeShare(vector.shares[0], format);
      const units =
        format === "ur"
          ? written.slice("ur:sskr/".length).match(/../gu)!
          : format === "colors-unicode"
            ? written.match(/.{4}/gu)!
            : written.split(" ");
      units[3] = "?";
      const damaged =
        format === "ur"
          ? "ur:sskr/" + units.join("")
          : format === "colors-unicode"
            ? units.join("")
            : units.join(" ");
      const result = cli(["sskr-combine", "--share", damaged, "--share", vector.shares[1]]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toMatch(/Share 1: element \d+ is \S+\./u);
      expect(result.stderr).not.toContain(damaged);
      expect(result.stdout).toContain("Original seed phrase, the wallet's:");
    }
  });

  it("exports a repaired share without changing the other shares", () => {
    const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
    const units = writeShare(vector.shares[0], "colors").split(" ");
    units[4] = "?";
    const result = cli(["sskr-export", "--share", units.join(" "), "--format", "indexes"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toMatch(/Share 1: element \d+ is \S+\./u);
    const line = result.stdout.split("\n").find((line) => /^\d+(?: \d+)+$/u.test(line))!;
    expect(readRepairableShare(line).ur).toBe(vector.shares[0]);
  });

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
      expect(split.stdout).toContain("Unicode code points of");
      expect(split.stdout).toContain("#");
      expect(split.stdout + split.stderr).not.toContain("\x1b");
      expect(split.stderr).toContain("the original dates are still required");
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
      // A taken name is numbered, shares-1.txt, without spaces; the old file stays as it was.
      const again = cli([
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
      expect(again.status, again.stderr).toBe(0);
      const numbered = join(dir, "shares-1.txt");
      expect(again.stderr).toContain(`${path} already exists: saved as ${numbered} instead.`);
      expect(readFileSync(path, "utf8").trim().split("\n")).toEqual(records);
      expect(readFileSync(numbered, "utf8").trim().split("\n")).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("saves the QR code of the sheets as images beside the PDF, which restore and decode read", () => {
    const directory = mkdtempSync(join(tmpdir(), "mnemocode-sheet-qr-"));
    try {
      const pdf = join(directory, "cards.pdf");
      const single = cli([
        "encode",
        "--mnemonic",
        mnemonic,
        "--format",
        "colors",
        "--pdf",
        pdf,
        "--card-qr",
      ]);
      expect(single.status, single.stderr).toBe(0);
      expect(single.stderr).toContain(
        `Saved the QR code of the sheet as an image: ${join(directory, "cards-qr.png")}`,
      );
      const decoded = cli([
        "decode",
        "--mode",
        "direct",
        "--qr-file",
        join(directory, "cards-qr.png"),
      ]);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      // The shares: one image for each, named after its reference.
      const shares = join(directory, "shares.pdf");
      const split = cli([
        "encode",
        "--sskr",
        "--mnemonic",
        mnemonic,
        "--threshold",
        "2",
        "--shares",
        "3",
        "--share-format",
        "colors",
        "--pdf",
        shares,
        "--card-qr",
      ]);
      expect(split.status, split.stderr).toBe(0);
      expect(split.stderr).toContain(
        "Saved the QR code of each share's sheets as an image beside them: 3 PNG files.",
      );
      const images = readdirSync(directory)
        .filter((name) => /^shares-.+-qr\.png$/u.test(name))
        .sort();
      expect(images).toHaveLength(3);
      const restored = cli([
        "sskr-combine",
        "--share-qr",
        join(directory, images[0]!),
        "--share-qr",
        join(directory, images[2]!),
      ]);
      // The backup in the form of the shares comes first, then the seed phrase.
      expect(restored.stdout.trim().split("\n").at(-1)).toBe(mnemonic);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 120_000);

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

  it("gives back the form the shares were written in, with the seed phrase from the dates", () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-unicode-"));
    try {
      const path = join(dir, "shares.txt");
      const date = "23-09-2026";
      const split = cli([
        "encode",
        "--sskr",
        "--mnemonic",
        mnemonic,
        "--dates",
        date,
        "--threshold",
        "2",
        "--shares",
        "3",
        "--share-format",
        "unicode",
        "--output",
        path,
      ]);
      expect(split.status, split.stderr).toBe(0);
      // Without --format only the shares are shown, not the whole seed phrase.
      expect(split.stdout).not.toContain("Unicode code points of");
      const records = readFileSync(path, "utf8").trim().split("\n");
      for (const record of records) expect(record).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4})+$/u);
      const masked = formatEncoded(encodeMnemonic(mnemonic, [parseDate(date)]), "unicode");
      const restored = cli([
        "sskr-combine",
        "--share",
        records[0]!,
        "--share",
        records[2]!,
        "--dates",
        date,
      ]);
      expect(restored.status, restored.stderr).toBe(0);
      expect(restored.stdout).toContain(masked);
      expect(restored.stdout).toContain(mnemonic);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("repairs shares that each miss two elements together, and keeps the phrase hidden on export", () => {
    const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0];
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    const typed = vector.shares.map((share: string, index: number) => {
      const units = writeShare(share, "indexes").split(" ");
      units[2 + index] = "?";
      units[9 + index] = "?";
      return units.join(" ");
    });
    const restored = cli(["sskr-combine", ...typed.flatMap((text: string) => ["--share", text])]);
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stderr).toContain("Marked elements: settled by the shares together");
    for (const share of [1, 2, 3]) expect(restored.stderr).toMatch(new RegExp(`Share ${share}: `));
    expect(restored.stdout).toContain(expected);
    const exported = cli(["sskr-export", ...typed.flatMap((text: string) => ["--share", text])]);
    expect(exported.status, exported.stderr).toBe(0);
    expect(exported.stdout + exported.stderr).not.toContain(expected);
    const lines = exported.stdout.split("\n").filter((line) => /^\d+(?: \d+)+$/u.test(line));
    expect(lines.map((line) => readRepairableShare(line).ur)).toEqual(vector.shares);
    // The fingerprint of another wallet matches none of the phrases.
    const other = cli([
      "sskr-export",
      ...typed.flatMap((text: string) => ["--share", text]),
      "--master-fingerprint",
      "00000000",
    ]);
    expect(other.status).toBe(1);
    expect(other.stderr).toContain("does not match the wallet given");
    const same = cli([
      "sskr-export",
      ...typed.flatMap((text: string) => ["--share", text]),
      "--master-fingerprint",
      masterFingerprint(expected),
    ]);
    expect(same.status, same.stderr).toBe(0);
  });

  it("asks for --max-tries before a long search and says what would help", () => {
    const shares = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[0].shares;
    const units = writeShare(shares[1], "colors").split(" ");
    // Two colors of the secret: 48 bits, 32 of them settled by the checksum.
    units[5] = "?";
    units[7] = "?";
    const typed = ["--share", shares[0], "--share", units.join(" ")];
    const refused = cli(["sskr-combine", ...typed, "--max-tries", "1000"]);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toMatch(/Open combinations: 65,536 \(2\^16\)/u);
    expect(refused.stderr).toContain("1 more share without marks would settle everything.");
    expect(refused.stderr).toContain("Allow it with --max-tries 65536.");
    const allowed = cli(["sskr-combine", ...typed]);
    expect(allowed.status, allowed.stderr).toBe(0);
    expect(allowed.stdout).toContain("Original seed phrase, the wallet's:");
  });
});

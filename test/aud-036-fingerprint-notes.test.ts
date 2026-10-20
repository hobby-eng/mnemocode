import { expect, it, vi } from "vitest";
import { serializeRecord } from "../src/record.js";
import { SSKR_SET_VECTOR } from "../src/sskr/known-answers.js";
import { runBuiltCliSync } from "./helpers/built-cli.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";
import { terminalFingerprint } from "../src/cli/terminal.js";

const DIRECT = serializeRecord("direct", "indexes", `${"1 ".repeat(11)}4`);
const LEGACY = serializeRecord(
  "seedshift-legacy-valid",
  "indexes",
  "2027 10 24 2027 10 24 2027 10 24 2027 10 23",
);

it.each([
  ["encoding", ["encode", "--mnemonic", TEST_PHRASE, "--mode", "direct", "--format", "1"]],
  ["decoding", ["decode", "--input", DIRECT]],
  [
    "a shorter-prefix warning",
    ["decode", "--input", serializeRecord("direct", "indexes", `${"1 ".repeat(11)}4 2048 6 10`)],
  ],
  ["legacy decoding", ["decode", "--input", LEGACY, "--date", "23-09-2026"]],
  [
    "share restoration",
    ["sskr-combine", ...SSKR_SET_VECTOR.shares.slice(0, 2).flatMap((share) => ["--share", share])],
  ],
] as const)(
  "explains the fingerprints after %s without adding a column to the result",
  (_, args) => {
    const result = runBuiltCliSync(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain("They do not reveal the phrase.");
    expect(result.stdout).not.toContain("They do not reveal the phrase.");
    if (args[0] === "decode" && args[2] === LEGACY) {
      const rows = result.stdout.trimEnd().split("\n");
      expect(rows).toHaveLength(128);
      expect(rows[0]).toMatch(new RegExp(`^1\\t${TEST_PHRASE}\\t[0-9a-f]{8}$`, "u"));
      expect(rows[127]).toMatch(/^128\tabandon(?: abandon){10} wrap\t[0-9a-f]{8}$/u);
    }
  },
);

it.each(["stdout", "stderr"] as const)(
  "keeps the terminal fingerprint explanation on its selected %s channel",
  (channel) => {
    const writes = { stdout: "", stderr: "" };
    const streams = { log: "stdout", error: "stderr" } as const;
    for (const name of ["log", "error"] as const)
      vi.spyOn(console, name).mockImplementation((...chunks: unknown[]) => {
        writes[streams[name]] += `${chunks.map(String).join(" ")}\n`;
      });
    try {
      terminalFingerprint(
        "Original BIP32 master fingerprint",
        "73c5da0a",
        "empty BIP39 passphrase",
        channel,
      );
      expect(writes[channel]).toContain("They do not reveal the phrase.");
      expect(writes[channel === "stdout" ? "stderr" : "stdout"]).toBe("");
    } finally {
      vi.restoreAllMocks();
    }
  },
);

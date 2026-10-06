import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { combineSskrShares, combineSskrShareSet, restoreShareSet } from "../src/sskr/index.js";
import { sskrEngine } from "../src/sskr/runtime.js";
import { crc32 } from "../src/sskr/checksum.js";
import { transportToUr, urToTransport, writeShare } from "../src/sskr/transport.js";
import { checkShareBackup } from "../src/cli/backup-check.js";

const PHRASE = "abandon ".repeat(11) + "about";

describe("AUD-008-FUN001: incomplete-group disclosure", () => {
  it("exposes unchecked members through the package API and warns when checking the backup", async () => {
    const engine = await sskrEngine();
    const entropy = new Uint8Array(16);
    const randomness = new Uint8Array(32).fill(7);
    let shares: string[];
    try {
      shares = engine
        .create_sskr_shares(entropy, 1, Uint8Array.of(2, 3, 2, 3), randomness)
        .trim()
        .split("\n");
    } finally {
      entropy.fill(0);
      randomness.fill(0);
    }
    // Corrupt an incomplete group's value but keep its unkeyed transport checksum valid.
    const bytes = urToTransport(shares[3]!);
    bytes[10]! ^= 1;
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(
      bytes.length - 4,
      crc32(bytes.slice(0, -4)),
    );
    const given = [shares[0]!, shares[1]!, transportToUr(bytes)];
    expect(await restoreShareSet(given)).toMatchObject({ mnemonic: PHRASE, unchecked: [3] });
    expect(await combineSskrShareSet(given)).toMatchObject({ mnemonic: PHRASE, unchecked: [3] });
    await expect(combineSskrShares(given)).rejects.toThrow("could not be checked");
    expect(await checkShareBackup(PHRASE, given.join(";"), "direct", "")).toBe("unchecked");
    const other = entropyToMnemonic(new Uint8Array(16).fill(1), wordlist);
    expect(await checkShareBackup(other, given.join(";"), "direct", "")).toBe("differs");
    expect(await combineSskrShares(given.slice(0, 2))).toBe(PHRASE);
    expect(await checkShareBackup(PHRASE, given.slice(0, 2).join(";"), "direct", "")).toBe(
      "restores",
    );
  });

  it("keeps ordinary published vectors checked through both package APIs", async () => {
    const vectors = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8"));
    for (const vector of vectors.deterministic) {
      const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
      const result = await combineSskrShareSet(vector.shares);
      expect(result.mnemonic).toBe(expected);
      expect(result.unchecked).toBeUndefined();
      expect(result.unsettled).toEqual([]);
      expect(await combineSskrShares(vector.shares)).toBe(expected);
    }
  });

  it("discloses unsettled repair elements instead of silently confirming a wholly unreadable share", async () => {
    const vector = JSON.parse(readFileSync("vectors/sskr-v1.json", "utf8")).deterministic[1];
    const expected = entropyToMnemonic(Buffer.from(vector.entropy, "hex"), wordlist);
    const missing = writeShare(vector.shares[2], "indexes")
      .split(" ")
      .map(() => "?")
      .join(" ");
    const given = [vector.shares[0], vector.shares[1], missing];
    const restored = await combineSskrShareSet(given);
    expect(restored.mnemonic).toBe(expected);
    expect(restored.unsettled.length).toBeGreaterThan(0);
    expect(restored.unsettled.every((element) => element.share === 3)).toBe(true);
    await expect(combineSskrShares(given)).rejects.toThrow("could not be checked");
    expect(await checkShareBackup(expected, given.join(";"), "direct", "")).toBe("unchecked");
  });
});

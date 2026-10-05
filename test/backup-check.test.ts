import { describe, expect, it } from "vitest";
import { checkEncodedBackup, checkShareBackup } from "../src/cli/backup-check.js";
import { encodeMnemonic, formatEncoded, parseDate, representMnemonic } from "../src/core.js";
import { splitSskrMnemonic } from "../src/sskr/shares.js";
import { urToBytewords } from "../src/sskr/transport.js";

// The public BIP39 test phrase and a public date of the examples.
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const DATE = "23-09-2026";

describe("checking a written-down backup", () => {
  it("accepts the codes as written, with or without dates", () => {
    const direct = formatEncoded(representMnemonic(PHRASE), "indexes");
    expect(checkEncodedBackup(PHRASE, direct, "indexes", "direct", "")).toBe("restores");
    const masked = formatEncoded(encodeMnemonic(PHRASE, [parseDate(DATE)]), "colors");
    expect(checkEncodedBackup(PHRASE, masked, "colors", "seedshift", DATE)).toBe("restores");
  });

  it("tells a wrong date or a wrong code from a backup that cannot be read", () => {
    const masked = formatEncoded(encodeMnemonic(PHRASE, [parseDate(DATE)]), "indexes");
    expect(checkEncodedBackup(PHRASE, masked, "indexes", "seedshift", "24-09-2026")).toBe(
      "differs",
    );
    // A mistyped code breaks the checksum of the written phrase, so it cannot be read at all.
    const numbers = masked.split(" ");
    numbers[0] = numbers[0] === "1" ? "2" : "1";
    expect(checkEncodedBackup(PHRASE, numbers.join(" "), "indexes", "seedshift", DATE)).toBe(
      "unreadable",
    );
    expect(checkEncodedBackup(PHRASE, "not a backup", "indexes", "seedshift", DATE)).toBe(
      "unreadable",
    );
  });

  it("accepts enough shares, in any written form, with the dates", async () => {
    const shares = await splitSskrMnemonic(PHRASE, 2, 3);
    expect(await checkShareBackup(PHRASE, `${shares[0]};${shares[2]}`, "direct", "")).toBe(
      "restores",
    );
    const words = `${urToBytewords(shares[1]!)};${urToBytewords(shares[2]!)}`;
    expect(await checkShareBackup(PHRASE, words, "direct", "")).toBe("restores");
    const masked = encodeMnemonic(PHRASE, [parseDate(DATE)]).shiftedEnglish.join(" ");
    const maskedShares = await splitSskrMnemonic(masked, 2, 3);
    const typed = `${maskedShares[0]};${maskedShares[1]}`;
    expect(await checkShareBackup(PHRASE, typed, "seedshift", DATE)).toBe("restores");
    expect(await checkShareBackup(PHRASE, typed, "seedshift", "24-09-2026")).toBe("differs");
    expect(await checkShareBackup(PHRASE, shares[0]!, "direct", "")).toBe("unreadable");
  });
});

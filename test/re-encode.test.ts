import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { parseDate } from "../src/core.js";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import {
  CHECKSUM_FAILS,
  LAST_WORD_NEEDED,
  LAST_WORD_NOT_TAKEN,
  NOT_CONFIRMED,
  NO_SUCH_LAST_WORD,
  ReEncoding,
} from "../src/core/re-encoding.js";
import { RE_ENCODING_SELF_TEST } from "../src/core/re-encoding-self-test.js";
import { MALFORMED_WALLET_ANSWER } from "../src/core/wallet-check.js";
import { parseArguments } from "../src/cli/arguments.js";
import { COMMAND_OPTIONS } from "../src/cli/command-options.js";
import { comparedPassphrase } from "../src/cli/decode-command.js";
import { OLD_BACKUP_REFUSAL, splitOptions } from "../src/cli/re-encode-command.js";
import {
  asksNewBackup,
  LAST_WORD_OPTION,
  OLD_BACKUP_OPTIONS,
  RECOGNISED_OPTION,
} from "../src/cli/re-encode-options.js";
import { combineSskrShares } from "../src/sskr/shares.js";
import { containing } from "./helpers/matchers.js";
import {
  DATE,
  LEGACY_VALID_MASKED,
  MASKED_WORDS,
  TEST_ADDRESS,
  TEST_FINGERPRINT,
  TEST_PHRASE,
  TEST_UNICODE,
  WRONG_DATE,
} from "./helpers/test-phrase.js";
import { runBuiltCli } from "./helpers/built-cli.js";

// Public test data only: the BIP39 test phrase, masked with MnemoCode Seedshift and DATE
// (vectors/mnemocode-v1.json), and its fingerprint and first native SegWit address.
const RIGHT = parseDate(DATE);
const WRONG = parseDate(WRONG_DATE);

function masked(): EncodedBackup {
  return EncodedBackup.read(MASKED_WORDS, "english", "seedshift");
}

/** Runs the built CLI's `command`, re-encode unless a test names another, with `arguments_`. */
async function run(arguments_: readonly string[], command = "re-encode") {
  return await runBuiltCli([command, ...arguments_]);
}

/** The old backup as typed text, masked with its date, for the command line. */
const OLD = ["--input", MASKED_WORDS, "--old-mode", "seedshift", "--old-dates", DATE];

describe("ReEncoding", () => {
  it("offers a possible replaced-last-word reading only for checksum-valid Legacy input", () => {
    using legacy = EncodedBackup.read(LEGACY_VALID_MASKED, "indexes", "seedshift-legacy");
    using replacement = legacy.lastWordReplacement();
    expect(replacement?.mode).toBe("seedshift-legacy-valid");
    expect(replacement?.givesSeveral).toBe(true);
    expect(legacy.mode).toBe("seedshift-legacy");
    using invalid = EncodedBackup.read("1 ".repeat(12).trim(), "indexes", "seedshift-legacy");
    expect(invalid.lastWordReplacement()).toBeUndefined();
    using direct = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    expect(direct.lastWordReplacement()).toBeUndefined();
    using seedshift = masked();
    expect(seedshift.lastWordReplacement()).toBeUndefined();
    legacy.wipe();
    expect(() => legacy.lastWordReplacement()).toThrow(/wiped/iu);
  });

  it("decodes the old backup and holds its phrase back until it is confirmed", () => {
    const reEncoding = ReEncoding.of(masked(), [RIGHT]);
    expect(reEncoding.phrase).toBe(TEST_PHRASE);
    expect(reEncoding.confirmation).toBeUndefined();
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);
    reEncoding.confirmByPerson();
    expect(reEncoding.confirmation).toEqual({ by: "person" });
    expect(reEncoding.confirmedPhrase()).toBe(TEST_PHRASE);
  });

  it("is confirmed by a wallet that matches, and by nothing else", async () => {
    const reEncoding = ReEncoding.of(masked(), [RIGHT]);
    expect((await reEncoding.confirmByWallet(() => ({ matched: false }))).matched).toBe(false);
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);
    // A host's answer that is no WalletMatch, given on purpose as a JavaScript host could, confirms
    // nothing (AUD-014-API001).
    await expect(reEncoding.confirmByWallet(() => ({ matched: "true" }) as never)).rejects.toThrow(
      MALFORMED_WALLET_ANSWER,
    );
    expect(() => reEncoding.confirmedPhrase()).toThrow(NOT_CONFIRMED);
    const match = await reEncoding.confirmByWallet(async (mnemonic) => ({
      matched: mnemonic === TEST_PHRASE,
      path: "m/84'/0'/0'/0/0",
    }));
    expect(match.matched).toBe(true);
    expect(reEncoding.confirmation).toEqual({ by: "wallet", path: "m/84'/0'/0'/0/0" });
    expect(reEncoding.confirmedPhrase()).toBe(TEST_PHRASE);
  });

  it("gives a wrong date's valid phrase, which only the wallet tells apart", async () => {
    const wrong = ReEncoding.of(masked(), [WRONG]);
    expect(wrong.phrase).not.toBe(TEST_PHRASE);
    const check = (mnemonic: string) => ({ matched: mnemonic === TEST_PHRASE });
    expect((await wrong.confirmByWallet(check)).matched).toBe(false);
  });

  it("refuses a phrase whose checksum fails, and takes the last word of several phrases", () => {
    const legacy = EncodedBackup.read(
      "8F44901950118F44901950118F44901950118F4490194F5C",
      "unicode",
      "seedshift-legacy",
    );
    expect(ReEncoding.of(legacy, [RIGHT]).phrase).toBe(TEST_PHRASE);
    expect(() => ReEncoding.of(legacy, [WRONG])).toThrow(CHECKSUM_FAILS);
    // The Original Seedshift with a valid last word, as Encode makes it: every last word may be it.
    const several = EncodedBackup.encode(TEST_PHRASE, [RIGHT], "indexes", "seedshift-legacy", {
      validLastWord: true,
    }).backup;
    expect(several.mode).toBe("seedshift-legacy-valid");
    expect(() => ReEncoding.of(several, [RIGHT])).toThrow(LAST_WORD_NEEDED);
    // The last word the person remembers picks the phrase, as typed, in any case.
    expect(ReEncoding.of(several, [RIGHT], " About ").phrase).toBe(TEST_PHRASE);
    // One that no candidate ends with, or that is no single word, is refused.
    const lastWords = several
      .candidates([RIGHT])
      .map((candidate) => candidate.recoveredMnemonic.split(" ").at(-1));
    const absent = ["zoo", "zone", "zero", "wrong"].find((word) => !lastWords.includes(word))!;
    expect(() => ReEncoding.of(several, [RIGHT], absent)).toThrow(NO_SUCH_LAST_WORD);
    expect(() => ReEncoding.of(several, [RIGHT], "about about")).toThrow(NO_SUCH_LAST_WORD);
    // A backup of one phrase takes no last word: one given is refused, not ignored
    // (AUD-022-API002).
    expect(() => ReEncoding.of(legacy, [RIGHT], "zoo")).toThrow(LAST_WORD_NOT_TAKEN);
  });

  it("never shows its phrase as text", () => {
    const reEncoding = ReEncoding.of(masked(), [RIGHT]);
    for (const shown of [String(reEncoding), JSON.stringify(reEncoding), inspect(reEncoding)])
      expect(shown).not.toContain("abandon");
  });

  it("passes its self-test", async () => {
    RE_ENCODING_SELF_TEST.startup();
    await RE_ENCODING_SELF_TEST.check.run();
  });
});

describe("re-encode options", () => {
  it("gives the old backup Decode's names and the new one Encode's", () => {
    const args = parseArguments([
      "--ask-secrets",
      "--input-file",
      "old.txt",
      "--old-mode",
      "seedshift",
      "--old-format",
      "5",
      "--words",
      "24",
      "--bitcoin-address",
      TEST_ADDRESS,
      "--mode",
      "direct",
      "--format",
      "3",
      "--output",
      "new.txt",
      "--recognised",
    ]);
    const { old, fresh } = splitOptions(args);
    // Without a prototype, as parseArguments makes them (AUD-014-API010).
    expect([Object.getPrototypeOf(old), Object.getPrototypeOf(fresh)]).toEqual([null, null]);
    expect({ ...old }).toEqual({
      "ask-secrets": true,
      "input-file": "old.txt",
      mode: "seedshift",
      format: "5",
      words: "24",
      "bitcoin-address": TEST_ADDRESS,
    });
    expect({ ...fresh }).toEqual({
      "ask-secrets": true,
      mode: "direct",
      format: "3",
      output: "new.txt",
    });
  });

  it("asks the new backup on the private screen only without options of it", () => {
    const asked = (...items: string[]) => asksNewBackup(parseArguments(items));
    expect(asked("--ask-secrets", "--qr-file", "old.png", "--old-mode", "seedshift")).toBe(true);
    expect(asked("--ask-secrets", "--recognised", "--master-fingerprint", TEST_FINGERPRINT)).toBe(
      true,
    );
    expect(asked("--ask-secrets", "--format", "3")).toBe(false);
    expect(asked("--ask-secrets", "--sskr")).toBe(false);
    // Without --ask-secrets the options give every answer.
    expect(asked("--input-file", "old.txt")).toBe(false);
  });

  it("says which BIP39 passphrase the wallet is compared with, as Decode does", () => {
    expect(comparedPassphrase("Re-encode", false)).toBe(
      "Re-encode compares it without a BIP39 passphrase.",
    );
    expect(comparedPassphrase("Re-encode", true)).toBe(
      "Re-encode compares it with the BIP39 passphrase of --bip39-passphrase-file.",
    );
  });

  it("takes every option of Encode but the phrase's, and those of the old backup", () => {
    const options: readonly string[] = COMMAND_OPTIONS["re-encode"];
    const encodeOptions: readonly string[] = COMMAND_OPTIONS.encode;
    for (const key of encodeOptions)
      expect(options.includes(key), key).toBe(key !== "mnemonic" && key !== "mnemonic-file");
    for (const key of [...Object.keys(OLD_BACKUP_OPTIONS), RECOGNISED_OPTION, LAST_WORD_OPTION])
      expect(options, key).toContain(key);
    // No option of the old backup is also one of the new backup's.
    for (const key of Object.keys(OLD_BACKUP_OPTIONS))
      expect(encodeOptions, key).not.toContain(key);
  });
});

describe("re-encode CLI", () => {
  it("re-encodes a backup confirmed by the wallet's fingerprint", async () => {
    const result = await run([
      ...OLD,
      "--mode",
      "direct",
      "--format",
      "3",
      "--master-fingerprint",
      TEST_FINGERPRINT,
    ]);
    // Standard output carries only the new backup, never the old phrase (AUD-022-SEC001).
    expect(result.stdout).not.toContain("abandon");
    expect(result.stdout).toContain(TEST_UNICODE);
    expect(result.stderr).toContain(
      `Original BIP32 master fingerprint (empty BIP39 passphrase): ${TEST_FINGERPRINT}`,
    );
    expect(result.stderr).toContain(
      "The fingerprint matches: the seed phrase is accepted, not proven.",
    );
    expect(result.stderr).toContain("The old backup still restores the same wallet");
  });

  it("re-encodes a backup confirmed by its first address, with new dates", async () => {
    const result = await run([
      ...OLD,
      "--mode",
      "seedshift",
      "--dates",
      "01-01-2030",
      "--format",
      "2",
      "--bitcoin-address",
      TEST_ADDRESS,
    ]);
    expect(result.stderr).toContain("Address found at m/84'/0'/0'/0/0: the wallet matches");
    // The new backup decodes back to the phrase with its new date.
    const back = await run(
      [
        "--mode",
        "seedshift",
        "--format",
        "2",
        "--input",
        result.stdout.trim().split("\n").at(-1)!,
        "--dates",
        "01-01-2030",
      ],
      "decode",
    );
    expect(back.stdout).toContain(TEST_PHRASE);
  });

  it("re-encodes a record file, confirmed by --recognised, into a new record file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-re-encode-"));
    try {
      const old = join(dir, "old.txt");
      const fresh = join(dir, "new.txt");
      await run(
        ["--mnemonic", TEST_PHRASE, "--dates", DATE, "--format", "5", "--output", old],
        "encode",
      );
      await run([
        "--input-file",
        old,
        "--old-dates",
        DATE,
        "--mode",
        "direct",
        "--format",
        "3",
        "--output",
        fresh,
        "--recognised",
      ]);
      expect(readFileSync(fresh, "utf8").trim()).toBe(`MNC1:direct:unicode:${TEST_UNICODE}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("re-encode CLI", () => {
  it("splits the phrase of a backup into Shamir shares", async () => {
    const result = await run([
      ...OLD,
      "--sskr",
      "--threshold",
      "2",
      "--shares",
      "3",
      "--recognised",
    ]);
    const shares = result.stdout.match(/ur:sskr\/[a-z]+/gu) ?? [];
    expect(shares).toHaveLength(3);
    // Any two of them restore the phrase of the backup.
    expect(await combineSskrShares(shares.slice(1))).toBe(TEST_PHRASE);
  });

  it("stops where the wallet does not match: a wrong date gives another valid phrase", async () => {
    await expect(
      run([
        "--input",
        MASKED_WORDS,
        "--old-mode",
        "seedshift",
        "--old-dates",
        WRONG_DATE,
        "--format",
        "3",
        "--master-fingerprint",
        TEST_FINGERPRINT,
      ]),
    ).rejects.toMatchObject({
      stderr: containing("Nothing was re-encoded."),
    });
  });

  it("needs a confirmation on the command line, one way, and the secrets one way", async () => {
    await expect(run([...OLD, "--format", "3"])).rejects.toMatchObject({
      stderr: containing("its checksum confirms nothing"),
    });
    await expect(
      run([...OLD, "--recognised", "--master-fingerprint", TEST_FINGERPRINT]),
    ).rejects.toMatchObject({ stderr: containing("give one") });
    await expect(run(["--ask-secrets", "--old-dates", DATE])).rejects.toMatchObject({
      stderr: containing(
        "Secret material for --old-dates must not be passed as a command-line value",
      ),
    });
    await expect(
      run(["--mnemonic-file", "must-not-be-read", "--recognised"]),
    ).rejects.toMatchObject({
      stderr: containing("does not support the mnemonic file setting"),
    });
  });

  it("takes the last word of a backup of the Original Seedshift with a valid last word", async () => {
    const several = EncodedBackup.encode(TEST_PHRASE, [RIGHT], "indexes", "seedshift-legacy", {
      validLastWord: true,
    }).backup;
    const old = ["--input", several.record(), "--old-dates", DATE, "--format", "3"];
    await expect(run([...old, "--recognised"])).rejects.toMatchObject({
      stderr: containing("give the last word of the original seed phrase"),
    });
    const result = await run([...old, "--last-word", "about", "--recognised"]);
    expect(result.stdout).toContain(TEST_UNICODE);
  });

  it("refuses a new backup's option before the old backup is read", async () => {
    // A form without cards: refused before the codes are read, which here are no backup at all.
    await expect(
      run(["--input", "not a backup", "--format", "1", "--cards", "--recognised"]),
    ).rejects.toMatchObject({
      stderr: containing("Terminal color cards are available only"),
    });
    // Dates that the new backup's mode takes none of, before the old backup is decoded.
    const refused = await run([
      ...OLD,
      "--mode",
      "direct",
      "--dates",
      "01-01-2020",
      "--format",
      "3",
      "--recognised",
    ]).catch((error: { stderr: string }) => error);
    expect(refused.stderr).toContain("Dates cannot be used in direct mode.");
    expect(refused.stderr).not.toContain(OLD_BACKUP_REFUSAL);
    expect(refused.stderr).not.toContain(TEST_FINGERPRINT);
  });
});

describe("re-encode CLI", () => {
  it("says which refusals are of the old backup's options", async () => {
    const backup = ["--input", MASKED_WORDS, "--format", "3", "--recognised"];
    await expect(
      run([...backup, "--old-mode", "direct", "--old-dates", DATE]),
    ).rejects.toMatchObject({
      stderr: containing(`${OLD_BACKUP_REFUSAL}Dates cannot be used in direct mode.`),
    });
    await expect(run([...backup, "--old-mode", "seedshift"])).rejects.toMatchObject({
      stderr: containing(`${OLD_BACKUP_REFUSAL}seedshift requires at least one date.`),
    });
    await expect(run([...backup, "--old-mode", "bogus"])).rejects.toMatchObject({
      stderr: containing(`${OLD_BACKUP_REFUSAL}The transformation mode must be`),
    });
    // The old backup's options asked on the private screen are checked before its first question.
    await expect(run(["--ask-secrets", "--old-format", "9"])).rejects.toMatchObject({
      stderr: containing(`${OLD_BACKUP_REFUSAL}The representation format must be`),
    });
  });
});

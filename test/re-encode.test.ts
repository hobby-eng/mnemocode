import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect, promisify } from "node:util";
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
import { commandOptions } from "../src/cli/command-options.js";
import { comparedPassphrase } from "../src/cli/decode-command.js";
import { OLD_BACKUP_REFUSAL, splitOptions } from "../src/cli/re-encode-command.js";
import {
  asksNewBackup,
  LAST_WORD_OPTION,
  OLD_BACKUP_OPTIONS,
  RECOGNISED_OPTION,
} from "../src/cli/re-encode-options.js";
import { containing } from "./helpers/matchers.js";
import { TEST_FINGERPRINT, TEST_PHRASE } from "./helpers/test-phrase.js";
import { PublicCliFiles } from "./helpers/public-cli-files.js";

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), "dist", "mnemocode.js");

// Public test data only: the BIP39 test phrase, masked with MnemoCode Seedshift and 23-09-2026
// (vectors/mnemocode-v1.json), and its fingerprint and first native SegWit address.
const MASKED_WORDS = "wool abuse actual wool abuse actual wool abuse actual wool abuse congress";
const ADDRESS = "bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu";
/** The test phrase without Seedshift as Unicode codes, from the BIP39 Chinese list. */
const UNICODE = `${"7684".repeat(11)}5728`;
const RIGHT = parseDate("23-09-2026");
const WRONG = parseDate("24-09-2026");

function masked(): EncodedBackup {
  return EncodedBackup.read(MASKED_WORDS, "english", "seedshift");
}

async function run(arguments_: readonly string[], command = "re-encode") {
  using material = new PublicCliFiles([command, ...arguments_]);
  return await execFileAsync(process.execPath, [cli, ...material.arguments], {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 1024 * 1024,
  });
}

/** The old backup as typed text, masked with its date, for the command line. */
const OLD = ["--input", MASKED_WORDS, "--old-mode", "seedshift", "--old-dates", "23-09-2026"];

describe("ReEncoding", () => {
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
    // A host's answer that is no WalletMatch confirms nothing (AUD-014-API001).
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
      ADDRESS,
      "--mode",
      "direct",
      "--format",
      "3",
      "--output",
      "new.txt",
      "--recognised",
    ]);
    const { old, fresh } = splitOptions(args);
    expect({ ...old }).toEqual({
      "ask-secrets": true,
      "input-file": "old.txt",
      mode: "seedshift",
      format: "5",
      words: "24",
      "bitcoin-address": ADDRESS,
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
    expect(comparedPassphrase("Re-encode", "")).toBe(
      "Re-encode compares it without a BIP39 passphrase.",
    );
    expect(comparedPassphrase("Re-encode", "TREZOR")).toBe(
      "Re-encode compares it with the BIP39 passphrase of --bip39-passphrase-file.",
    );
  });

  it("takes every option of Encode but the phrase's, and those of the old backup", () => {
    const options: readonly string[] = commandOptions["re-encode"];
    for (const key of commandOptions.encode)
      expect(options.includes(key), key).toBe(key !== "mnemonic" && key !== "mnemonic-file");
    for (const key of [...Object.keys(OLD_BACKUP_OPTIONS), RECOGNISED_OPTION, LAST_WORD_OPTION])
      expect(options, key).toContain(key);
    // No option of the old backup is also one of the new backup's.
    for (const key of Object.keys(OLD_BACKUP_OPTIONS))
      expect(commandOptions.encode as readonly string[], key).not.toContain(key);
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
    expect(result.stdout).toContain(UNICODE);
    expect(result.stderr).toContain(
      "Original BIP32 master fingerprint (empty BIP39 passphrase): 73c5da0a",
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
      ADDRESS,
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
        ["--mnemonic", TEST_PHRASE, "--dates", "23-09-2026", "--format", "5", "--output", old],
        "encode",
      );
      await run([
        "--input-file",
        old,
        "--old-dates",
        "23-09-2026",
        "--mode",
        "direct",
        "--format",
        "3",
        "--output",
        fresh,
        "--recognised",
      ]);
      expect(readFileSync(fresh, "utf8").trim()).toBe(`MNC1:direct:unicode:${UNICODE}`);
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
    expect(result.stdout.match(/ur:sskr\//gu)).toHaveLength(3);
  });

  it("stops where the wallet does not match: a wrong date gives another valid phrase", async () => {
    await expect(
      run([
        "--input",
        MASKED_WORDS,
        "--old-mode",
        "seedshift",
        "--old-dates",
        "24-09-2026",
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
    await expect(run(["--ask-secrets", "--old-dates", "23-09-2026"])).rejects.toMatchObject({
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
    const old = ["--input", several.record(), "--old-dates", "23-09-2026", "--format", "3"];
    await expect(run([...old, "--recognised"])).rejects.toMatchObject({
      stderr: containing("give the last word of the original seed phrase"),
    });
    const result = await run([...old, "--last-word", "about", "--recognised"]);
    expect(result.stdout).toContain(UNICODE);
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
      run([...backup, "--old-mode", "direct", "--old-dates", "23-09-2026"]),
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

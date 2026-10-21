import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { entropyToMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { decodeCandidateList } from "../src/core/candidate-list.js";
import { EncodedForm } from "../src/core/encoded-form.js";
import { createSessionIdentity, decryptCandidates } from "../src/core/candidate-encryption.js";
import { containing } from "./helpers/matchers.js";
import {
  LAST_WORD_FORGOTTEN,
  LIST_PASSPHRASE,
  ONE_WORD_MISSING,
  replacedAt,
  TEST_FINGERPRINT,
  TEST_PHRASE,
  TEST_UNICODE,
} from "./helpers/test-phrase.js";
import { runBuiltCli as run } from "./helpers/built-cli.js";

const INVALID_LEGACY_PHRASE =
  "mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital";

describe("recover-word CLI", () => {
  it("points codes typed in place of words to Decode, which reads them with ?", async () => {
    // The public phrase's Unicode codes with its third code unreadable (owner, 2026-10-13).
    const codes = EncodedForm.of("unicode")
      .apartCodes(TEST_UNICODE)!
      .map((code, place) => (place === 2 ? "?" : code));
    await expect(run(["recover-word", "--mnemonic", codes.join(" ")])).rejects.toMatchObject({
      stderr: containing(
        "These are the codes of an encoded seed phrase, not its words: Decode numbers",
      ),
    });
  });

  it("prints every checksum-valid candidate with word and checksum metadata", async () => {
    const result = await run(["recover-word", "--mnemonic", LAST_WORD_FORGOTTEN]);
    const lines = result.stdout.trim().split("\n");

    expect(lines).toHaveLength(129);
    expect(lines[0]).toBe("candidate\tword\tword-index\tchecksum-bits\tmnemonic");
    expect(lines).toContain(`1\tabout\t4\t0011\t${TEST_PHRASE}`);
    expect(result.stderr).toContain("Every combination was checked");
  });

  it("saves every candidate as an encrypted list, record N for candidate N", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-candidates-"));
    try {
      using session = await createSessionIdentity();
      const path = join(dir, "candidates.age");
      const save = (file: string, ...protection: string[]) =>
        run([
          "recover-word",
          "--mnemonic",
          LAST_WORD_FORGOTTEN,
          "--candidates-file",
          file,
          ...protection,
        ]);
      const result = await save(path, "--candidates-key", session.recipient);
      const rows = result.stdout.trim().split("\n").slice(1);
      const list = decodeCandidateList(
        await decryptCandidates(readFileSync(path), { identity: session }),
      );
      expect(list.records.map((record) => entropyToMnemonic(record.entropy, wordlist))).toEqual(
        rows.map((row) => row.split("\t").at(-1)),
      );
      expect(list.records).toHaveLength(128);
      if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(result.stderr).toContain(
        "Saved 128 candidate phrases, encrypted to the Scanner's key",
      );
      // Without a protection the list is refused, and a list in the open needs its own flag.
      await expect(save(join(dir, "open.mncl"))).rejects.toMatchObject({
        stderr: containing("--candidates-key"),
      });
      const open = await save(join(dir, "open.mncl"), "--plaintext-candidates");
      expect(open.stderr).toContain("NOT encrypted");
      expect(decodeCandidateList(readFileSync(join(dir, "open.mncl"))).records).toHaveLength(128);
      // A taken name is numbered, never replaced.
      const again = await save(path, "--candidates-key", session.recipient);
      expect(again.stderr).toContain("saved as");
      expect(statSync(join(dir, "candidates-1.age")).size).toBe(statSync(path).size);
      // The file holds seed phrases, so a synchronised folder is warned about as for any output.
      mkdirSync(join(dir, "Dropbox"));
      const synced = await save(
        join(dir, "Dropbox", "c.age"),
        "--candidates-key",
        session.recipient,
      );
      expect(synced.stderr).toContain("Dropbox keeps a copy");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("recover-word CLI", () => {
  it("keeps record N as candidate N with a wallet check, and reads a passphrase file as typed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mnc-candidates-"));
    try {
      const path = join(dir, "checked.age");
      const passphraseFile = join(dir, "passphrase.txt");
      // A byte order mark and spaces at the ends are not part of the passphrase.
      writeFileSync(passphraseFile, `\uFEFF  ${LIST_PASSPHRASE} \n`);
      const result = await run([
        "recover-word",
        "--mnemonic",
        LAST_WORD_FORGOTTEN,
        "--master-fingerprint",
        TEST_FINGERPRINT,
        "--candidates-file",
        path,
        "--candidates-passphrase-file",
        passphraseFile,
      ]);
      const matchedRow = result.stdout.split("\n").find((row) => row.includes("\tmatched at"))!;
      const number = Number(matchedRow.split("\t")[0]);
      const list = decodeCandidateList(
        await decryptCandidates(readFileSync(path), { passphrase: LIST_PASSPHRASE }),
      );
      expect(list.records).toHaveLength(128);
      expect(entropyToMnemonic(list.records[number - 1]!.entropy, wordlist)).toBe(TEST_PHRASE);
      // Replacements of a legacy phrase are no wallets: they are not saved as candidates.
      await expect(
        run([
          "recover-word",
          "--legacy-valid-last-word",
          "--mnemonic",
          INVALID_LEGACY_PHRASE,
          "--candidates-file",
          join(dir, "legacy.age"),
          "--plaintext-candidates",
        ]),
      ).rejects.toMatchObject({ stderr: containing("no candidate list") });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("finds several forgotten words, and a missing word at an unknown place", async () => {
    const two = await run([
      "recover-word",
      "--mnemonic",
      replacedAt(TEST_PHRASE, { 1: "ab*", 12: "abo*" }),
    ]);
    const lines = two.stdout.trim().split("\n");
    expect(lines[0]).toBe("candidate\twords\tmnemonic");
    expect(lines).toContain(`1\t1:abandon 12:about\t${TEST_PHRASE}`);
    const missing = await run(["recover-word", "--missing-word", "--mnemonic", ONE_WORD_MISSING]);
    const rows = missing.stdout.trim().split("\n");
    expect(rows[0]).toBe("candidate\tposition\tword\tword-index\tmnemonic");
    expect(rows[1]).toBe(`1\t1\tabandon\t1\t${TEST_PHRASE}`);
    // Two forgotten words in 12: 262,144 candidates, too many to show without a list or a wallet.
    const many = await run([
      "recover-word",
      "--mnemonic",
      replacedAt(TEST_PHRASE, { 1: "?", 12: "?" }),
    ]);
    expect(many.stdout.trim()).toBe("");
    expect(many.stderr).toContain("262,144 candidates are too many to show");
  });

  it("marks evidence matches without removing non-matching candidates", async () => {
    const result = await run([
      "recover-word",
      "--mnemonic",
      LAST_WORD_FORGOTTEN,
      "--master-fingerprint",
      TEST_FINGERPRINT,
    ]);
    const lines = result.stdout.trim().split("\n");

    expect(lines).toHaveLength(129);
    expect(lines[0]).toContain("\tevidence\t");
    expect(lines.some((line) => line.includes("\tmatched at m\t"))).toBe(true);
    expect(lines.some((line) => line.includes("\tnot matched\t"))).toBe(true);
  });

  it("recovers every checksum-valid final word from an exact legacy phrase", async () => {
    const result = await run([
      "recover-word",
      "--legacy-valid-last-word",
      "--mnemonic",
      INVALID_LEGACY_PHRASE,
    ]);
    const lines = result.stdout.trim().split("\n");
    expect(lines).toHaveLength(129);
    expect(lines[0]).toBe("candidate\tword\tword-index\tchecksum-bits\tlegacy-tail\tmnemonic");
    expect(lines.filter((line) => line.includes("\tpreserved\t"))).toHaveLength(1);
    expect(result.stderr).toContain("All checksum-valid last words");
  });
});

describe("recover-word CLI", () => {
  it("rejects input without a placeholder, and searches that are too large", async () => {
    await expect(run(["recover-word", "--mnemonic", TEST_PHRASE])).rejects.toMatchObject({
      stderr: containing("Mark each forgotten word"),
    });
    await expect(
      run(["recover-word", "--mnemonic", replacedAt(TEST_PHRASE, { 1: "?", 2: "?", 12: "?" })]),
    ).rejects.toMatchObject({ stderr: containing("combinations") });
  });
});

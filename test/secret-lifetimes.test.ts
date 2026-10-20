import { afterEach, describe, expect, it, vi } from "vitest";
import { EncodedBackup } from "../src/core/encoded-backup.js";
import { ReEncoding } from "../src/core/re-encoding.js";
import { PassphraseProtection } from "../src/core/candidate-encryption.js";
import { Share } from "../src/sskr/transport.js";
import { sskrSetVector } from "../src/sskr/known-answers.js";
import { SecretValue } from "../src/core/secret-value.js";
import { CandidateListWriter } from "../src/core/candidate-list-writer.js";
import { NoProtection } from "../src/core/candidate-encryption.js";
import { decodeCandidateList } from "../src/core/candidate-list.js";
import { TEST_PHRASE } from "./helpers/test-phrase.js";

afterEach(() => vi.restoreAllMocks());

describe("Exact retained UTF-16 keys", () => {
  it("preserves every code unit, list boundaries and independent copies", () => {
    const everyUnit = Array.from({ length: 65536 }, (_, unit) => String.fromCharCode(unit)).join(
      "",
    );
    const values = ["", "\uFEFF", "\uD800", "\uD801", "\uDC00", "\uD83D\uDE00", everyUnit];
    const owner = SecretValue.utf16Texts(values);
    expect(owner.value).toEqual(values);
    using copy = owner.copy();
    values[0] = "changed by caller";
    owner.wipe();
    expect(copy.value).toEqual(["", ...values.slice(1)]);
    expect(() => owner.value).toThrow("has been wiped");
    expect(() => SecretValue.utf16Texts([undefined] as never)).toThrow("needs text");
  });
});

describe("Exact retained UTF-8 text", () => {
  it("preserves a leading U+FEFF in a text value and in each text-list item", () => {
    using text = SecretValue.text("\uFEFFpublic");
    using texts = SecretValue.texts(["", "\uFEFFpublic", "\uFEFF\uFEFFpublic"]);
    expect(text.value).toBe("\uFEFFpublic");
    expect(texts.value).toEqual(["", "\uFEFFpublic", "\uFEFF\uFEFFpublic"]);
  });

  it.each(["\uFEFFpublic", "\uFEFF\uFEFFpublic", "public\uFEFFtest"])(
    "stores the exact admitted BIP39 passphrase (%j)",
    async (passphrase) => {
      using protection = new NoProtection();
      using writer = new CandidateListWriter(protection, passphrase);
      const outcome = await writer.writePhrases([TEST_PHRASE]);
      expect(outcome.kind).toBe("list");
      if (outcome.kind !== "list") return;
      try {
        expect(decodeCandidateList(outcome.list.bytes).passphrase).toBe(passphrase);
      } finally {
        outcome.list.bytes.fill(0);
      }
    },
  );
});

describe("Retained secret lifetimes", () => {
  it("overwrites the retained UTF-8 byte allocation without claiming to erase returned strings", () => {
    const encode = new TextEncoder().encode.bind(new TextEncoder());
    const allocations: Uint8Array[] = [];
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation((text) => {
      const bytes = encode(text);
      allocations.push(bytes);
      return bytes;
    });
    const secret = SecretValue.text("public test text");
    expect(secret.value).toBe("public test text");
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.some((byte) => byte !== 0)).toBe(true);
    secret.wipe();
    expect(allocations[0]!.every((byte) => byte === 0)).toBe(true);
  });

  it("preserves numeric and text list boundaries and refuses malformed numeric storage", () => {
    using numbers = SecretValue.numberLists([[0, 2047], [], [9999, 0.125]]);
    using texts = SecretValue.texts(["public", "", "test text"]);
    expect(numbers.value).toEqual([[0, 2047], [], [9999, 0.125]]);
    expect(texts.value).toEqual(["public", "", "test text"]);
    expect(() => SecretValue.numbers([NaN])).toThrow("finite numbers");
    expect(() => SecretValue.numberLists([undefined] as never)).toThrow("finite numbers");
    expect(() => SecretValue.texts("test" as never)).toThrow("needs text");
  });
  it("owns independent mutable bytes and refuses reads after idempotent disposal", () => {
    const source = [1, 2, 3];
    const secret = SecretValue.numbers(source);
    source[0] = 9;
    expect(secret.value).toEqual([1, 2, 3]);
    const copy = secret.copy();
    secret.wipe();
    secret[Symbol.dispose]();
    expect(() => secret.value).toThrow("has been wiped");
    expect(copy.value).toEqual([1, 2, 3]);
    copy.wipe();
  });

  it("refuses to decode an encoded backup after its lifetime ends", () => {
    const backup = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    expect(backup.decode([]).recoveredMnemonic).toBe(TEST_PHRASE);
    backup.wipe();
    backup[Symbol.dispose]();
    expect(() => backup.text()).toThrow("has been wiped");
    expect(() => backup.decode([])).toThrow("has been wiped");
  });

  it("forgets a confirmed re-encoding without wiping the caller's backup", () => {
    const backup = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    const reencoding = ReEncoding.of(backup, []);
    reencoding.confirmByPerson();
    expect(reencoding.confirmedPhrase()).toBe(TEST_PHRASE);
    reencoding[Symbol.dispose]();
    reencoding.wipe();
    expect(() => reencoding.phrase).toThrow("has been wiped");
    expect(() => reencoding.confirmedPhrase()).toThrow("has been wiped");
    expect(backup.text()).toBe(TEST_PHRASE);
    backup.wipe();
  });

  it("refuses to use a wiped passphrase without beginning encryption", async () => {
    const protection = new PassphraseProtection("public test list passphrase");
    protection[Symbol.dispose]();
    protection.wipe();
    await expect(async () => protection.protect(new Uint8Array())).rejects.toThrow(
      "has been wiped",
    );
  });

  it("cannot confirm a re-encoding after its owner was disposed during a wallet check", async () => {
    using backup = EncodedBackup.read(TEST_PHRASE, "english", "direct");
    using reencoding = ReEncoding.of(backup, []);
    let finish: ((match: { matched: boolean }) => void) | undefined;
    const pending = reencoding.confirmByWallet(
      () =>
        new Promise<{ matched: boolean }>((resolve) => {
          finish = resolve;
        }),
    );
    reencoding.wipe();
    finish!({ matched: true });
    await expect(pending).rejects.toHaveProperty("code", "core.secret-value.wiped");
    expect(reencoding.confirmation).toBeUndefined();
  });

  it("drops a share's retained text when disposed", () => {
    const share = Share.read(sskrSetVector.shares[0]);
    expect(share.ur).toBe(sskrSetVector.shares[0]);
    share[Symbol.dispose]();
    share.wipe();
    expect(() => share.ur).toThrow("has been wiped");
    expect(() => share.write()).toThrow("has been wiped");
  });

  it("wipes an admitted share when a later share makes the set fail", () => {
    const encode = new TextEncoder().encode.bind(new TextEncoder());
    const allocations: Uint8Array[] = [];
    vi.spyOn(TextEncoder.prototype, "encode").mockImplementation((text) => {
      const bytes = encode(text);
      if (text === sskrSetVector.shares[0]) allocations.push(bytes);
      return bytes;
    });
    expect(() => Share.readSet([sskrSetVector.shares[0], "invalid public fixture"])).toThrow(
      expect.objectContaining({ code: "sskr.transport.decoded-bytes-refused" }),
    );
    expect(allocations).toHaveLength(1);
    expect(allocations[0]!.every((byte) => byte === 0)).toBe(true);
  });

  it("does not dispose the protection borrowed by a candidate writer", async () => {
    using protection = new NoProtection();
    const wipe = vi.spyOn(protection, "wipe");
    const writer = new CandidateListWriter(protection, "public BIP39 passphrase");
    writer[Symbol.dispose]();
    expect(wipe).not.toHaveBeenCalled();
    expect(writer.usesPassphrase.bind(writer, "public BIP39 passphrase")).toThrow("has been wiped");
    await expect(writer.write([])).rejects.toThrow("has been wiped");
  });

  it("wipes returned protection bytes and publishes no list after the writer was disposed", async () => {
    let returned: Uint8Array | undefined;
    using writer = new CandidateListWriter({
      encrypted: false,
      description: "public test adapter",
      protect: async (plain) => {
        returned = Uint8Array.from(plain);
        writer.wipe();
        return returned;
      },
    });
    await expect(writer.writePhrases([TEST_PHRASE])).rejects.toHaveProperty(
      "code",
      "core.secret-value.wiped",
    );
    expect(returned!.every((byte) => byte === 0)).toBe(true);
  });
});

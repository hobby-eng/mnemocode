import { afterEach, describe, expect, it, vi } from "vitest";
import { Decrypter, Encrypter } from "age-encryption";
import {
  assertCandidateEncryptionReady,
  checkCandidateEncryptionQuick,
  createSessionIdentity,
  encryptCandidates,
  PassphraseProtection,
} from "../src/core/candidate-encryption.js";
import { WIPED_CODE } from "./helpers/owner-lifetime.js";
import { ENCRYPTION_SELF_TEST_FAILED } from "./helpers/refusals.js";
import { candidateVectors } from "./helpers/vectors.js";
import { MnemoCodeSelfTest } from "../src/core/self-test.js";

afterEach(() => vi.restoreAllMocks());

describe("the first candidate encryption operation", () => {
  it("fails closed on a fast known-answer failure before encrypting caller material", async () => {
    vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementationOnce(() => {
      throw new Error("Synthetic known-answer failure of the age library.");
    });
    const writes = vi.spyOn(Encrypter.prototype, "encrypt");
    const plain = Uint8Array.of(1, 2, 3);
    const pending = encryptCandidates(plain, candidateVectors().age.recipient);
    try {
      await expect(pending).rejects.toHaveProperty("code", ENCRYPTION_SELF_TEST_FAILED);
      expect(writes).not.toHaveBeenCalled();
      expect([...plain]).toEqual([1, 2, 3]);
    } finally {
      await pending.then(
        (bytes) => bytes.fill(0),
        () => undefined,
      );
      plain.fill(0);
    }
  });

  it("retries a failed first check and shares the passing result across concurrent operations", async () => {
    const reads = vi.spyOn(Decrypter.prototype, "addIdentity");
    // Fault: the cipher fails its first known answer, which no input can cause.
    reads.mockImplementationOnce(() => {
      throw new Error("Synthetic known-answer failure of the age library.");
    });
    await expect(createSessionIdentity()).rejects.toHaveProperty(
      "code",
      ENCRYPTION_SELF_TEST_FAILED,
    );
    reads.mockClear();
    const results = await Promise.all([
      createSessionIdentity(),
      createSessionIdentity(),
      createSessionIdentity(),
    ]);
    expect(results.every((pair) => pair.recipient.startsWith("age1"))).toBe(true);
    const checked = reads.mock.calls.length;
    await createSessionIdentity();
    expect(reads).toHaveBeenCalledTimes(checked);
    // The three operations together read as many identities as one forced run of the checks.
    reads.mockClear();
    await checkCandidateEncryptionQuick();
    expect(checked).toBe(reads.mock.calls.length);
    expect(checked).toBeGreaterThan(0);
  });

  it("refuses a missing protection kind instead of silently enabling a different feature", async () => {
    const invalid: unknown = Reflect.apply(assertCandidateEncryptionReady, undefined, ["none"]);
    await expect(invalid).rejects.toHaveProperty(
      "code",
      "core.candidate-encryption.unsupported-lock",
    );
  });

  it("does not start asynchronous cipher checks during ordinary synchronous core startup", () => {
    const identities = vi.spyOn(Decrypter.prototype, "addIdentity");
    MnemoCodeSelfTest.core();
    expect(identities).not.toHaveBeenCalled();
  });

  it("refuses protection disposed while its first-use await is pending before user encryption", async () => {
    const encryption = vi.spyOn(Encrypter.prototype, "encrypt");
    const protection = new PassphraseProtection("public synthetic test passphrase");
    const input = Uint8Array.of(1, 2, 3);
    const pending = protection.protect(input);
    protection.wipe();
    await expect(pending).rejects.toHaveProperty("code", WIPED_CODE);
    expect(encryption).not.toHaveBeenCalled();
    expect([...input]).toEqual([1, 2, 3]);
    input.fill(0);
  });
});

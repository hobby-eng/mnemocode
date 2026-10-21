// The gate of candidate encryption as a host holds it (CandidateEncryption): its checks and their
// failures are its own, apart from the gate that the module's functions share.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Decrypter } from "age-encryption";
import {
  CandidateEncryption,
  checkCandidateEncryptionQuick,
  createSessionIdentity,
  decryptCandidates,
  encryptCandidates,
  protectionFor,
} from "../src/core/candidate-encryption.js";

const FAILED = "core.candidate-encryption.self-test-failed";
const FAILURE = "Synthetic X25519 known-answer failure.";

/** Makes every X25519 known answer fail from now on, as a broken engine would. */
function failX25519Answers(): void {
  vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementation(() => {
    throw new Error(FAILURE);
  });
}

afterEach(() => vi.restoreAllMocks());

describe("a host's own gate of candidate encryption", () => {
  it("keeps its passed checks when the shared gate's recheck fails", async () => {
    const own = new CandidateEncryption();
    using session = await own.createSessionIdentity();
    const plain = Uint8Array.of(61, 62, 63);
    failX25519Answers();
    await expect(checkCandidateEncryptionQuick()).rejects.toThrow(FAILURE);
    await expect(encryptCandidates(plain, session.recipient)).rejects.toHaveProperty(
      "code",
      FAILED,
    );
    using protection = protectionFor({ kind: "key", recipient: session.recipient }, own);
    const file = await protection.protect(plain);
    vi.restoreAllMocks();
    const opened = await own.decrypt(file, { identity: session });
    try {
      expect(opened).toEqual(plain);
    } finally {
      opened.fill(0);
      file.fill(0);
    }
  });

  it("refuses its own work after its own failed recheck and leaves the shared gate open", async () => {
    const own = new CandidateEncryption();
    await own.ready("key");
    using session = await createSessionIdentity();
    const plain = Uint8Array.of(71, 72, 73);
    failX25519Answers();
    await expect(own.recheck()).rejects.toThrow(FAILURE);
    await expect(own.encrypt(plain, session.recipient)).rejects.toHaveProperty("code", FAILED);
    await expect(own.ready("key")).rejects.toHaveProperty("code", FAILED);
    const file = await encryptCandidates(plain, session.recipient);
    vi.restoreAllMocks();
    const opened = await decryptCandidates(file, { identity: session });
    try {
      expect(opened).toEqual(plain);
    } finally {
      opened.fill(0);
      file.fill(0);
    }
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { assertCandidateEncryptionReady } from "../src/core/candidate-encryption.js";

afterEach(() => vi.unstubAllGlobals());

it("keeps fast symmetric checks usable without WebCrypto while refusing key operations clearly", async () => {
  const random = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal("crypto", { getRandomValues: random });
  await expect(assertCandidateEncryptionReady("passphrase")).resolves.toBeUndefined();
  await expect(assertCandidateEncryptionReady("key")).rejects.toHaveProperty(
    "code",
    "core.candidate-encryption.no-webcrypto",
  );
});

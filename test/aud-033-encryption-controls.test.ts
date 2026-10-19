import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { Decrypter } from "age-encryption";
import { CandidatesFile } from "../src/cli/candidates-file.js";

it("closes candidate-file controls before reading a private passphrase file if its check fails", async () => {
  const folder = await mkdtemp(join(tmpdir(), "mnemocode-public-cipher-gate-"));
  vi.spyOn(Decrypter.prototype, "addIdentity").mockImplementationOnce(() => {
    throw new Error("Synthetic fast cipher check failure.");
  });
  try {
    await expect(
      CandidatesFile.of({
        "candidates-file": join(folder, "public-candidates.age"),
        "candidates-passphrase-file": join(folder, "must-not-be-read"),
      }),
    ).rejects.toHaveProperty("code", "core.candidate-encryption.self-test-failed");
  } finally {
    vi.restoreAllMocks();
    await rm(folder, { recursive: true, force: true });
  }
});

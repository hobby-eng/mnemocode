// Public self-test entry retained; the slow scrypt known answer is requested-only.
import { checkCandidateEncryptionQuick, decryptCandidates } from "./candidate-encryption.js";
import { TEST_PASSPHRASE, WITH_THE_PASSPHRASE } from "./candidate-encryption-checks.js";
import { THREE_PHRASES_LIST } from "./candidate-list-answers.js";
import { bytesOfHex, expectSame, hexOfBytes } from "./self-test-check.js";
import { wipedAfterAsync } from "./bits.js";

/** Fast symmetric/X25519 known answers, preserved under their original public entry. */
export { checkCandidateEncryptionQuick };

/** Every fast check plus the published file opened with the fixed-cost scrypt passphrase. */
export async function checkCandidateEncryption(): Promise<void> {
  await checkCandidateEncryptionQuick();
  await wipedAfterAsync(bytesOfHex(WITH_THE_PASSPHRASE), async (file) =>
    wipedAfterAsync(await decryptCandidates(file, { passphrase: TEST_PASSPHRASE }), async (plain) =>
      expectSame(hexOfBytes(plain), THREE_PHRASES_LIST, "Candidate file with the passphrase"),
    ),
  );
}

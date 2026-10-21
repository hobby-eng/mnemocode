// Public self-test entry retained; the slow scrypt known answer is requested-only. It checks the gate
// that the functions of candidate-encryption.ts share, which the command line uses; a host that
// holds a CandidateEncryption of its own rechecks it with its recheck, and the scrypt answer is the
// cipher's, the same through every gate.
import { checkCandidateEncryptionQuick, decryptCandidates } from "./candidate-encryption.js";
import { TEST_PASSPHRASE, WITH_THE_PASSPHRASE } from "./candidate-encryption-checks.js";
import { THREE_PHRASES_LIST } from "./candidate-list-answers.js";
import { bytesOfHex, expectSame, hexOfBytes } from "./self-test-check.js";
import { wipedAfterAsync } from "./bits.js";

/** Fast symmetric/X25519 known answers, preserved under their original public entry. */
export { checkCandidateEncryptionQuick };

/**
 * Every fast check of the shared gate plus the published file opened with the fixed-cost scrypt
 * passphrase. Fails as checkCandidateEncryptionQuick fails (core.self-test-check.mismatch and the
 * others it names), as decryptCandidates refuses the file
 * (core.candidate-encryption.self-test-failed and the others it names), and where the list it holds
 * differs (core.self-test-check.mismatch).
 */
export async function checkCandidateEncryption(): Promise<void> {
  await checkCandidateEncryptionQuick();
  await wipedAfterAsync(bytesOfHex(WITH_THE_PASSPHRASE), async (file) =>
    wipedAfterAsync(await decryptCandidates(file, { passphrase: TEST_PASSPHRASE }), async (plain) =>
      expectSame(hexOfBytes(plain), THREE_PHRASES_LIST, "Candidate file with the passphrase"),
    ),
  );
}

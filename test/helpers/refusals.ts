// The refusal of an action, for a test that looks at more of it than toThrow does: its code, its
// cause, and what its message leaves out; and the codes of refusals that several tests look for,
// written out rather than taken from src, so that a test sees a changed code.

/**
 * The code of the refusal of candidate-list encryption whose self-test failed
 * (core/candidate-encryption.ts): it neither encrypts nor decrypts.
 */
export const ENCRYPTION_SELF_TEST_FAILED = "core.candidate-encryption.self-test-failed";

/**
 * The Error that `action` throws. A thrown value that is no Error is thrown again, so that it fails
 * the test, and an action that throws nothing fails it too.
 */
export function refusalOf(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("The action was not refused.");
}

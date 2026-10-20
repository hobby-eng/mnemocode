// The refusal of an action, for a test that looks at more of it than toThrow does: its code, its
// cause, and what its message leaves out.

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

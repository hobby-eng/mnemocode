// The end of an owner's lifetime as the tests of stale reads reach it, and the code of the refusal
// that a wiped secret gives (core/secret-value.ts), written out so that a test sees a changed code.

/** The code of the error that a secret value refuses with once it is wiped. */
export const WIPED_CODE = "core.secret-value.wiped";

/** Reaches stale-read regressions even when the old implementation has no lifetime method. */
export function endLifetimeIfPresent(owner: object, method: "wipe" | "dispose" = "wipe"): boolean {
  const close: unknown = Reflect.get(owner, method === "wipe" ? "wipe" : Symbol.dispose);
  if (typeof close !== "function") return false;
  Reflect.apply(close, owner, []);
  return true;
}

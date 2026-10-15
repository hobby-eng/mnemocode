/** Reaches stale-read regressions even when the old implementation has no lifetime method. */
export function endLifetimeIfPresent(owner: object, method: "wipe" | "dispose" = "wipe"): boolean {
  const close: unknown = Reflect.get(owner, method === "wipe" ? "wipe" : Symbol.dispose);
  if (typeof close !== "function") return false;
  Reflect.apply(close, owner, []);
  return true;
}

// The exports of a script of scripts/, which has no types, for the test that uses them: the test
// names the kind of each export it uses, and a script that no longer exports one of that kind
// fails the test at once instead of as an error somewhere in it.

/** The kind that typeof gives each export of `T` that a test uses. */
type ExportKinds<T> = { readonly [Name in keyof T]: "string" | "object" | "function" };

/** Whether `loaded` exports each name of `kinds` as a value of the kind that typeof gives it. */
function exportsOfKinds<T>(loaded: unknown, kinds: ExportKinds<T>): loaded is T {
  return (
    typeof loaded === "object" &&
    loaded !== null &&
    Object.entries(kinds).every(([name, kind]) => typeof Reflect.get(loaded, name) === kind)
  );
}

/**
 * The exports of the script at `path`, relative to the checkout, such as
 * "scripts/release-key.mjs", checked to be of `kinds`; it fails when one is missing or of another
 * kind.
 */
export async function scriptExports<T>(path: string, kinds: ExportKinds<T>): Promise<T> {
  const loaded: unknown = await import(new URL(`../../${path}`, import.meta.url).href);
  if (!exportsOfKinds<T>(loaded, kinds))
    throw new Error(`${path} no longer exports what this test uses.`);
  return loaded;
}

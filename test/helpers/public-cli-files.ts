import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { flagOf, parseArguments, values } from "../../src/cli/arguments.js";

const MATERIAL_FILES = [
  ["mnemonic", "mnemonic-file"],
  ["input", "input-file"],
  ["share", "share-file"],
  ["date", "dates-file"],
  ["old-date", "old-dates-file"],
  ["last-word", "last-word-file"],
] as const;

/** Extracts material fixture tokens only; malformed non-material options must reach the CLI. */
function fixtureParts(argv: readonly string[]) {
  const remaining: string[] = [];
  const material: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index];
    const source = MATERIAL_FILES.find(([key]) => flag === flagOf(key) || flag === `--${key}`);
    if (source === undefined) {
      if (flag !== undefined) remaining.push(flag);
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) return undefined;
    material.push(flagOf(source[0]) === flag ? flag : `--${source[0]}`, next);
    index += 1;
    if ((source[0] === "date" || source[0] === "old-date") && flag === flagOf(source[0])) {
      for (;;) {
        const item = argv[index + 1];
        if (item === undefined || item.startsWith("--")) break;
        material.push(item);
        index += 1;
      }
    }
  }
  return { remaining, material };
}

/**
 * Public test-fixture text translated to file arguments, never a production raw-material escape.
 * Raw/privacy-conflict tests must invoke the CLI directly; this owner serves existing operation
 * fixtures and removes its files only after the caller's process has settled.
 */
export class PublicCliFiles implements Disposable {
  readonly #arguments: readonly string[];
  #folder: string | undefined;

  /** All material must be published or synthetic test data. Private/help conflicts stay raw. */
  constructor(argv: readonly string[]) {
    this.#arguments = [...argv];
    const rawFlags = MATERIAL_FILES.flatMap(([key]) => [flagOf(key), `--${key}`]);
    if (
      !argv.some((item) => rawFlags.includes(item)) ||
      argv.includes("--ask-secrets") ||
      argv.includes("--help") ||
      argv.includes("-h")
    )
      return;
    const command = argv[0];
    if (command === undefined) throw new Error("A public CLI fixture needs a command.");
    const parts = fixtureParts(argv);
    if (parts === undefined) return;
    const parsed = parseArguments(parts.material);
    if (
      MATERIAL_FILES.some(
        ([key, file]) =>
          (key !== "share" && parsed[key] !== undefined && parts.remaining.includes(`--${file}`)) ||
          (!["share", "date", "old-date"].includes(key) && Array.isArray(parsed[key])),
      )
    )
      return;
    this.#folder = mkdtempSync(join(tmpdir(), "mnemocode-public-cli-files-"));
    try {
      for (const [key, file] of MATERIAL_FILES) {
        if (parsed[key] === undefined) continue;
        const material = values(parsed, key);
        const path = join(this.#folder, `public-${key}.txt`);
        writeFileSync(path, `${material.join("\n")}\n`, { mode: 0o600 });
        Reflect.deleteProperty(parsed, key);
        parsed[file] = path;
      }
      const translated = [command];
      for (const [key, value] of Object.entries(parsed)) {
        if (value === true) translated.push(flagOf(key));
        else if (typeof value === "string") translated.push(flagOf(key), value);
        else if (Array.isArray(value)) for (const item of value) translated.push(flagOf(key), item);
        else throw new Error("A public CLI fixture has an unsupported flag value.");
      }
      translated.push(...parts.remaining);
      this.#arguments = Object.freeze(translated);
    } catch (error) {
      try {
        this.close();
      } catch (cleanup) {
        throw new AggregateError([error, cleanup], "Public CLI fixture setup and cleanup failed.");
      }
      throw error;
    }
  }

  /** Safe operation arguments; deliberate privacy/help conflicts retain their original argv. */
  get arguments(): readonly string[] {
    return this.#arguments;
  }

  /** Removes only this owner's uniquely created public-data directory; cleanup errors propagate. */
  close(): void {
    if (this.#folder === undefined) return;
    rmSync(this.#folder, { recursive: true, force: true });
    this.#folder = undefined;
  }

  /** End this scope after any asynchronous CLI operation has settled. */
  [Symbol.dispose](): void {
    this.close();
  }
}

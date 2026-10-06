import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The modules that another host, such as the Wallet Deriver of the multi-chain wallet tools,
// compiles unchanged (docs/ARCHITECTURE.md, "Modules for other hosts"). Everything they import,
// directly or through each other, must be one of these files or one of the packages below.
const ENTRY_MODULES = [
  "src/core.ts",
  "src/record.ts",
  "src/core/date-recovery.ts",
  "src/core/candidates.ts",
  "src/core/candidate-list.ts",
  "src/core/candidate-encryption.ts",
  "src/sskr/transport.ts",
  "src/sskr/repair.ts",
  "src/sskr/joint-repair.ts",
  "src/sskr/share-platform.ts",
];
const ALLOWED_PACKAGES = new Set([
  "@scure/bip39",
  "@scure/bip39/wordlists/english.js",
  "@scure/bip39/wordlists/traditional-chinese.js",
  // The checksum test of the candidate search, many times faster than validating whole phrases.
  "@noble/hashes/sha2.js",
  // Only the encryption of candidate lists.
  "age-encryption",
]);
/** Globals that exist in Node.js but not in a browser page. */
const NODE_ONLY_GLOBALS = /\b(?:process|Buffer|setImmediate|require|__dirname|__filename)\b/u;
const IMPORT =
  /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)"|import\s*\(\s*"([^"]+)"\s*\)/gsu;

/** The source without its comments, so that a comment may name what the code must not use. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"])\/\/.*$/gmu, "$1");
}

/** Every module that the entry modules reach through relative imports, with its imports. */
function reachable(): Map<string, string[]> {
  const modules = new Map<string, string[]>();
  const pending = ENTRY_MODULES.map((path) => resolve(path));
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (modules.has(path)) continue;
    const imports = [...code(readFileSync(path, "utf8")).matchAll(IMPORT)].map(
      (match) => (match[1] ?? match[2])!,
    );
    modules.set(path, imports);
    for (const specifier of imports)
      if (specifier.startsWith("."))
        pending.push(resolve(dirname(path), specifier.replace(/\.js$/u, ".ts")));
  }
  return modules;
}

describe("Modules for other hosts", () => {
  it("import nothing but each other and the packages allowed", () => {
    const modules = reachable();
    for (const [path, imports] of modules)
      for (const specifier of imports)
        if (!specifier.startsWith("."))
          expect(ALLOWED_PACKAGES, `${relative(".", path)} imports ${specifier}`).toContain(
            specifier,
          );
    // The search for damaged shares is among them, and the Node.js host is not.
    const names = [...modules.keys()].map((path) => relative(".", path));
    expect(names).toContain(join("src", "sskr", "joint-repair.ts"));
    expect(names).not.toContain(join("src", "sskr", "share-platform-node.ts"));
    expect(names).not.toContain(join("src", "sskr", "runtime.ts"));
  });

  it("use no Node.js globals", () => {
    for (const path of reachable().keys())
      expect(code(readFileSync(path, "utf8")), relative(".", path)).not.toMatch(NODE_ONLY_GLOBALS);
  });
});

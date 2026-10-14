import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

// The modules that another host, such as the Wallet Deriver of the multi-chain wallet tools,
// compiles unchanged (docs/ARCHITECTURE.md, "Modules for other hosts"). Each is checked imported
// alone, so that a program can take one part without the rest: everything it reaches, directly or
// through other modules, contains no Node.js code and imports only the packages allowed for it.

/** BIP39 and its two word lists, which every module may import. */
const BIP39_PACKAGES = [
  "@scure/bip39",
  "@scure/bip39/wordlists/english.js",
  "@scure/bip39/wordlists/traditional-chinese.js",
];

/** Packages for PDF documents: pdf-lib draws them, and fontkit embeds the bundled font. */
const PDF_PACKAGES = ["pdf-lib", "@pdf-lib/fontkit"];

/**
 * The hashes and the curve that the coin families reach together: coin.ts the SHA-256 and the
 * RIPEMD-160 of HASH160, keccak-account.ts Keccak-256, and taproot.ts and keccak-account.ts the
 * curve.
 */
const COIN_PACKAGES = [
  // Base58Check checksums and HASH160 (with RIPEMD-160).
  "@noble/hashes/sha2.js",
  "@noble/hashes/legacy.js",
  // Keccak-256 for Ethereum-style accounts.
  "@noble/hashes/sha3.js",
  // Taproot output keys, and the uncompressed keys that Keccak accounts hash.
  "@noble/curves/secp256k1.js",
];
/**
 * Every package the coin families reach together, with Base58, Bech32, Bech32m and hexadecimal:
 * each family module is held to this shared ceiling.
 */
const COIN_FAMILY_PACKAGES = ["@scure/base", ...COIN_PACKAGES];
/** The coin families' self-tests, which derive their keys with BIP32 too. */
const COIN_SELF_TEST_PACKAGES = [...COIN_FAMILY_PACKAGES, "@scure/bip32"];
/**
 * The parts that the renderers of share cards are built on: the render platform, the texts of a
 * design, and the forms of a share (transport.ts), which they write the cards in.
 */
const CARD_RENDERER_PARTS = [
  "src/export/platform.ts",
  "src/export/card-copy.ts",
  "src/sskr/transport.ts",
];

interface Part {
  /** The other parts it is built on, through their entry modules: the dependency direction. */
  readonly uses: readonly string[];
  /** Packages beyond BIP39 that the part's own modules import; the parts it uses add theirs. */
  readonly packages?: readonly string[];
}

/**
 * The parts of the library, each one entry module, with its main class where it has one, and each
 * exported on its own: package.json "exports" names it by its path in src/ without the extension,
 * such as "./core/date-search". A part reaches another part only through an entry that it uses,
 * and no part uses itself back through the others.
 */
const PARTS: Readonly<Record<string, Part>> = {
  // Host services: the parts take them as parameters; none reads one configured beforehand.
  "src/sskr/share-platform.ts": { uses: [] },
  "src/export/platform.ts": { uses: [] },
  // The card renderer that a host builds with its render platform and passes to every render.
  "src/export/card-renderer.ts": {
    uses: CARD_RENDERER_PARTS,
    packages: PDF_PACKAGES,
  },
  // The master fingerprint alone, with the host's PBKDF2: what a host for one coin takes without
  // the evidence of another, such as the Deriver's Dash edition.
  "src/core/master-fingerprint.ts": {
    uses: [],
    packages: [
      // The master key from the seed, whose fingerprint it gives.
      "@scure/bip32",
    ],
  },
  // The coins whose receiving addresses are compared with a phrase, and their address forms.
  "src/core/coins.ts": {
    uses: [],
    packages: COIN_FAMILY_PACKAGES,
  },
  // Wallet evidence, with the host's PBKDF2.
  // An address of one coin given itself: what a host of one coin family takes, such as the
  // Deriver's Dash edition, without the evidence of Bitcoin or the list of every coin.
  "src/core/coin-address-evidence.ts": {
    uses: ["src/core/master-fingerprint.ts"],
    // The types of core/coins/coin.ts, whose module computes addresses with the hashes and curve
    // and tells other coins' forms of address with @scure/base.
    packages: ["@scure/base", "@scure/bip32", ...COIN_PACKAGES],
  },
  "src/core/wallet-evidence.ts": {
    // The coins come from the host; of the coin families it takes Bitcoin's alone.
    uses: ["src/core/master-fingerprint.ts", "src/core/coin-address-evidence.ts"],
    packages: [
      // The master key from the seed, its account keys, and extended keys in every form.
      "@scure/bip32",
      // WIF private keys; Bitcoin's addresses are read and compared by its coin.
      "@scure/btc-signer",
      // Whether a public key or the key of a WIF is a valid secp256k1 key.
      "@noble/curves/secp256k1.js",
    ],
  },
  // Seedshift masking and its variants; an encoded seed phrase in every form, with its record; how
  // a backup as given is read; and forgotten digits of the dates.
  "src/core/masking.ts": { uses: [] },
  "src/core/encoded-backup.ts": { uses: ["src/core/masking.ts"] },
  // Codes marked with ?, and the search for them.
  "src/core/missing-codes.ts": {
    uses: ["src/core/candidates.ts", "src/core/encoded-backup.ts", "src/core/masking.ts"],
  },
  "src/core/missing-codes-search.ts": {
    uses: [
      "src/core/date-search.ts",
      "src/core/encoded-backup.ts",
      "src/core/masking.ts",
      "src/core/missing-codes.ts",
    ],
  },
  "src/core/backup-reading.ts": {
    uses: [
      "src/core/encoded-backup.ts",
      "src/core/masking.ts",
      "src/core/missing-codes.ts",
      "src/sskr/transport.ts",
    ],
  },
  "src/core/date-search.ts": { uses: ["src/core/masking.ts"] },
  // A backup's phrase held back until it is confirmed, to be encoded again.
  "src/core/re-encoding.ts": { uses: ["src/core/encoded-backup.ts"] },
  // Structural PNG admission and exact inflation budgets, without loading any image decoder.
  "src/core/png-admission.ts": { uses: [] },
  // Forgotten words, and the candidate list with its encryption.
  "src/core/candidates.ts": {
    uses: [],
    // The checksum test of the word search, many times faster than validating whole phrases.
    packages: ["@noble/hashes/sha2.js"],
  },
  "src/core/candidate-list.ts": { uses: [] },
  // Only the encryption of candidate lists imports age.
  "src/core/candidate-file-admission.ts": {
    uses: ["src/core/candidate-list.ts"],
    packages: ["@scure/base"],
  },
  "src/core/candidate-encryption.ts": {
    uses: ["src/core/candidate-file-admission.ts"],
    packages: ["age-encryption"],
  },
  // The writing of a list: its phrases as entropy, encoded and protected, every copy wiped.
  "src/core/candidate-list-writer.ts": {
    uses: ["src/core/candidate-list.ts", "src/core/candidate-encryption.ts"],
  },
  // Shamir shares: their forms, the repair of marked ones and what it tells, the split, a share
  // set, the shares as typed, and the phrases that restored sets give with their dates.
  "src/sskr/transport.ts": { uses: [] },
  "src/sskr/joint-repair.ts": { uses: ["src/sskr/share-platform.ts", "src/sskr/transport.ts"] },
  "src/sskr/repair-report.ts": { uses: ["src/sskr/transport.ts"] },
  "src/sskr/split.ts": {
    uses: ["src/core/masking.ts", "src/sskr/share-platform.ts", "src/sskr/transport.ts"],
  },
  "src/sskr/share-set.ts": {
    uses: ["src/sskr/joint-repair.ts", "src/sskr/repair-report.ts", "src/sskr/transport.ts"],
  },
  "src/sskr/share-input.ts": { uses: ["src/sskr/share-set.ts"] },
  "src/sskr/share-unmasking.ts": {
    uses: [
      "src/core/date-search.ts",
      "src/core/encoded-backup.ts",
      "src/sskr/repair-report.ts",
      "src/sskr/transport.ts",
    ],
  },
  // What a backup can be made of, and the check of a backup written down.
  "src/core/backup-options.ts": { uses: ["src/core/masking.ts", "src/sskr/split.ts"] },
  "src/core/backup-check.ts": {
    uses: [
      "src/core/backup-reading.ts",
      "src/core/date-search.ts",
      "src/core/encoded-backup.ts",
      "src/sskr/share-set.ts",
      "src/sskr/share-input.ts",
    ],
  },
  // The restore of a phrase from shares and the repair of shares, in the steps of every host.
  "src/sskr/share-restore.ts": {
    uses: [
      "src/core/date-search.ts",
      "src/core/encoded-backup.ts",
      "src/core/masking.ts",
      "src/sskr/joint-repair.ts",
      "src/sskr/repair-report.ts",
      "src/sskr/share-input.ts",
      "src/sskr/share-set.ts",
      "src/sskr/share-unmasking.ts",
      "src/sskr/transport.ts",
    ],
  },
  // The known answers of SSKR, checked through the host's library.
  "src/sskr/known-answers.ts": { uses: ["src/sskr/share-platform.ts", "src/sskr/transport.ts"] },
  // The checks of each feature, beside it: known answers for every start, and its row in the full
  // self-test. Those of the library are composed by core/self-test.ts; those of the features a host
  // builds in or leaves out (wallet evidence, coins, the sheet for heirs, share cards) by the host.
  "src/core/master-fingerprint-self-test.ts": { uses: ["src/core/master-fingerprint.ts"] },
  "src/core/date-search-self-test.ts": { uses: ["src/core/date-search.ts"] },
  "src/core/re-encoding-self-test.ts": {
    uses: ["src/core/encoded-backup.ts", "src/core/re-encoding.ts"],
  },
  "src/core/png-admission-self-test.ts": { uses: ["src/core/png-admission.ts"] },
  "src/core/backup-reading-self-test.ts": {
    uses: [
      "src/core/backup-reading.ts",
      "src/core/encoded-backup.ts",
      "src/core/missing-codes.ts",
      "src/sskr/known-answers.ts",
    ],
  },
  "src/core/candidates-self-test.ts": { uses: ["src/core/candidates.ts"] },
  "src/core/candidate-list-self-test.ts": { uses: ["src/core/candidate-list.ts"] },
  "src/core/candidate-encryption-self-test.ts": {
    uses: ["src/core/candidate-encryption.ts", "src/core/candidate-list-self-test.ts"],
  },
  "src/core/backup-check-self-test.ts": {
    uses: ["src/core/backup-check.ts", "src/sskr/known-answers.ts", "src/sskr/share-platform.ts"],
  },
  "src/sskr/repair-self-test.ts": {
    uses: [
      "src/sskr/joint-repair.ts",
      "src/sskr/known-answers.ts",
      "src/sskr/share-platform.ts",
      "src/sskr/share-set.ts",
    ],
  },
  "src/sskr/share-unmasking-self-test.ts": {
    uses: [
      "src/core/date-search.ts",
      "src/sskr/joint-repair.ts",
      "src/sskr/share-platform.ts",
      "src/sskr/share-unmasking.ts",
      "src/sskr/transport.ts",
    ],
  },
  "src/core/wallet-evidence-self-test.ts": {
    uses: ["src/core/master-fingerprint-self-test.ts", "src/core/wallet-evidence.ts"],
  },
  // Every coin family's self-test as one row.
  "src/core/coins-self-test.ts": {
    uses: ["src/core/coin-address-evidence.ts", "src/core/master-fingerprint-self-test.ts"],
    packages: COIN_FAMILY_PACKAGES,
  },
  // The self-test of the rules, which a host runs on the person's request.
  "src/core/self-test.ts": {
    uses: [
      "src/core/backup-check-self-test.ts",
      "src/core/backup-reading-self-test.ts",
      "src/core/candidate-encryption-self-test.ts",
      "src/core/candidate-list-self-test.ts",
      "src/core/candidates-self-test.ts",
      "src/core/date-search-self-test.ts",
      "src/core/master-fingerprint-self-test.ts",
      "src/sskr/known-answers.ts",
      "src/sskr/repair-self-test.ts",
      "src/sskr/share-platform.ts",
      "src/sskr/share-unmasking-self-test.ts",
    ],
    // The SHA-256 of the word lists.
    packages: ["@noble/hashes/sha2.js"],
  },
  // Cards of shares, the texts of a card design, and the sheet for heirs.
  "src/export/card-copy.ts": { uses: ["src/export/platform.ts"] },
  "src/export/sskr-render.ts": {
    // The longest public share set, which assertPrintable draws before any secret is asked.
    uses: [...CARD_RENDERER_PARTS, "src/sskr/known-answers.ts"],
    packages: PDF_PACKAGES,
  },
  "src/export/heir-sheet.ts": { uses: ["src/export/platform.ts"], packages: PDF_PACKAGES },
  // The formats of the files of cards and the rules that draw a page as an image.
  "src/export/document-formats.ts": { uses: [] },
  // A card PDF read back as drawing steps, which a host without Poppler paints as an image.
  "src/export/card-drawing.ts": { uses: [], packages: PDF_PACKAGES },
  // How saved share cards are kept, without PDF: what the shares restore and where each one is.
  "src/export/sskr-keeping-text.ts": { uses: ["src/core/masking.ts", "src/sskr/transport.ts"] },
  // Sample cards drawn with the public test phrase.
  "src/export/card-preview.ts": {
    uses: CARD_RENDERER_PARTS,
    packages: PDF_PACKAGES,
  },
  // The self-test check of the card renderers, which a host adds to its self-test.
  "src/export/cards-self-test.ts": {
    uses: CARD_RENDERER_PARTS,
    packages: PDF_PACKAGES,
  },
  // The words of the sheet name the share forms (ShareFormat) by their looks; the modes it takes
  // are Masking's.
  "src/export/heir-sheet-text.ts": {
    uses: ["src/core/masking.ts", "src/export/heir-sheet.ts", "src/sskr/transport.ts"],
  },
  // The checks of the sheet for heirs and of share cards, which a host adds when it offers them.
  "src/export/heir-sheet-self-test.ts": {
    uses: ["src/export/heir-sheet.ts", "src/export/heir-sheet-text.ts"],
    packages: PDF_PACKAGES,
  },
  "src/export/sskr-render-self-test.ts": {
    uses: ["src/export/sskr-render.ts", "src/sskr/known-answers.ts", "src/sskr/transport.ts"],
    packages: PDF_PACKAGES,
  },
};

/**
 * Modules that hosts compile unchanged besides the parts, each with the packages beyond BIP39 that
 * it reaches: the transformations as one module (core.ts, which re-exports core/), the record
 * format, and modules the parts are built on that the Deriver vendors as they are. They have no
 * export of their own.
 */
const SHARED_MODULES: Readonly<Record<string, readonly string[]>> = {
  "src/core.ts": [],
  "src/record.ts": [],
  "src/core/date-recovery.ts": [],
  "src/core/wallet-check.ts": [],
  "src/core/search-turns.ts": [],
  "src/core/search-plan.ts": [],
  "src/core/places.ts": [],
  // The sizes of a BIP39 phrase, which every module takes without a word list, and the English
  // words alone, which the share modules take without the Traditional Chinese list.
  "src/core/bip39-sizes.ts": [],
  "src/core/english-words.ts": [],
  "src/core/white-space.ts": [],
  // Text and lists cut into pieces of one width, which the readers of codes and bits share.
  "src/core/pieces.ts": [],
  "src/core/address-scan.ts": ["@scure/bip32"],
  "src/core/bip32-limits.ts": [],
  "src/core/typed-number.ts": [],
  // The hints below a word being typed, which every front end that takes typed words shows.
  "src/core/word-hints.ts": [],
  // Its checks, which a host that shows the hints adds.
  "src/core/word-hints-self-test.ts": [],
  // How codes are written as text, which every reader of codes and shares lexes through.
  "src/core/code-text.ts": [],
  "src/core/prose.ts": [],
  "src/core/redacted.ts": [],
  // What a thrown value says, which readers of input and the self-tests share.
  "src/core/refusal.ts": [],
  "src/core/candidate-file-refusal.ts": [],
  // What every self-test check is made of, which the checks beside each feature share.
  "src/core/self-test-check.ts": [],
  "src/sskr/repair.ts": [],
  "src/export/study-backdrops.ts": ["pdf-lib"],
  "src/export/card-codes.ts": [],
  // The units of a page, which every renderer and the file formats share.
  "src/export/page-units.ts": [],
  // The installed designs and their styles, which the card texts, the share cards and a page read
  // without the renderers.
  "src/export/template-catalog.ts": [],
  // The coin families of core/coins.ts, each of which a host can take without the others.
  "src/core/coins/address-sizes.ts": [],
  "src/core/coins/address-types.ts": ["@noble/hashes/sha2.js", "@noble/hashes/legacy.js"],
  "src/core/coins/taproot.ts": COIN_PACKAGES,
  "src/core/coins/keccak-account.ts": COIN_PACKAGES,
  "src/core/coins/coin.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/base58-check.ts": ["@scure/base", "@noble/hashes/sha2.js"],
  "src/core/coins/other-forms.ts": ["@scure/base", "@noble/hashes/sha2.js"],
  "src/core/coins/base58.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/bech32.ts": ["@scure/base"],
  "src/core/coins/bitcoin-like.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/bitcoin-cash.ts": COIN_FAMILY_PACKAGES,
  // Bitcoin's version bytes, which Bitcoin Cash takes without Bitcoin's coin.
  "src/core/coins/bitcoin-versions.ts": [],
  "src/core/coins/dash.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/ethereum.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/evm.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/cosmos.ts": COIN_FAMILY_PACKAGES,
  "src/core/coins/xrp.ts": COIN_FAMILY_PACKAGES,
  // The self-test of each coin family, which a host of that family alone takes.
  "src/core/coins/coin-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/bitcoin-like-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/bitcoin-cash-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/cosmos-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/dash-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/ethereum-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/evm-self-test.ts": COIN_SELF_TEST_PACKAGES,
  "src/core/coins/xrp-self-test.ts": COIN_SELF_TEST_PACKAGES,
};

/**
 * What no module for another host reaches: the package's own entries, which stay for
 * compatibility and gather everything, and the command line. Node.js hosts are refused anyway,
 * since their node: imports are no allowed package.
 */
const NEVER_REACHED = ["src/index.ts", "src/cards.ts", "src/sskr/index.ts", "src/cli/"];

/** The transformations as one module, which a part never imports: it reaches the core/ it needs. */
const BARREL = "src/core.ts";

/** The package's entries from before the parts, which stay for compatibility. */
const COMPATIBILITY_EXPORTS = [".", "./cards", "./sskr"];

/** Globals that exist in Node.js but not in a browser page. */
const NODE_ONLY_GLOBALS = [
  "process",
  "Buffer",
  "setImmediate",
  "require",
  "__dirname",
  "__filename",
];
/**
 * What esbuild writes in place of each of them where the code itself uses it, not a string, a
 * comment or a local name: a message may say "require", and a parameter may be called process.
 */
const NODE_GLOBAL_MARK = "NODE_ONLY_GLOBAL_";
const NODE_GLOBAL_MARKED = new RegExp(`${NODE_GLOBAL_MARK}(\\w+)`, "gu");
/** Node.js's own types, which only @types/node declares. */
const NODE_TYPES = /\bNodeJS\./u;
/** Imports and re-exports with `from`, dynamic imports, and imports for their effect alone. */
const IMPORT =
  /(?:^|\s)(?:import|export)\s[^;]*?\sfrom\s+"([^"]+)"|import\s*\(\s*"([^"]+)"\s*\)|(?:^|\s)import\s+"([^"]+)"/gsu;

/** The source without its comments, so that a comment may name what the code must not use. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/(^|[^:"])\/\/.*$/gmu, "$1");
}

/** The Node.js globals that the code of a module uses. */
function nodeGlobalsIn(source: string): string[] {
  const { code: compiled } = transformSync(source, {
    loader: "ts",
    define: Object.fromEntries(NODE_ONLY_GLOBALS.map((name) => [name, NODE_GLOBAL_MARK + name])),
  });
  return [...new Set([...compiled.matchAll(NODE_GLOBAL_MARKED)].map((match) => match[1]!))];
}

/** A module's path from the repository root, as the lists above write it. */
function named(path: string): string {
  return relative(".", path).split("\\").join("/");
}

/** What the checks need of one module: the specifiers it imports, and what of Node.js it uses. */
interface Module {
  readonly imports: readonly string[];
  readonly nodeGlobals: readonly string[];
  readonly nodeTypes: boolean;
}

/** Each module read once for all the entries that reach it, by its path. */
const readModules = new Map<string, Module>();

function readModule(path: string): Module {
  let module = readModules.get(path);
  if (module === undefined) {
    const source = readFileSync(path, "utf8");
    const withoutComments = code(source);
    module = {
      imports: [...withoutComments.matchAll(IMPORT)].map((match) => (match[1] ?? match[2])!),
      nodeGlobals: nodeGlobalsIn(source),
      nodeTypes: NODE_TYPES.test(withoutComments),
    };
    readModules.set(path, module);
  }
  return module;
}

/**
 * Every module that `entry` reaches through relative imports, itself included, by its path from
 * the repository root.
 */
function reachable(entry: string): Map<string, Module> {
  const modules = new Map<string, Module>();
  const pending = [resolve(entry)];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (modules.has(named(path))) continue;
    const module = readModule(path);
    modules.set(named(path), module);
    for (const specifier of module.imports)
      if (specifier.startsWith("."))
        pending.push(resolve(dirname(path), specifier.replace(/\.js$/u, ".ts")));
  }
  return modules;
}

/** The packages that the modules import. */
function packagesOf(modules: Map<string, Module>): Map<string, string> {
  const packages = new Map<string, string>();
  for (const [name, { imports }] of modules)
    for (const specifier of imports)
      if (!specifier.startsWith(".")) packages.set(specifier, `${name} imports ${specifier}`);
  return packages;
}

/** The parts that `part` uses, directly or through the parts it uses, without itself. */
function partsUnder(part: string, seen = new Set<string>()): Set<string> {
  for (const used of PARTS[part]!.uses)
    if (!seen.has(used)) {
      seen.add(used);
      partsUnder(used, seen);
    }
  return seen;
}

/** The packages that `part` may reach: BIP39, its own, and those of every part under it. */
function packagesAllowed(part: string): Set<string> {
  const parts = [part, ...partsUnder(part)];
  return new Set([...BIP39_PACKAGES, ...parts.flatMap((name) => PARTS[name]!.packages ?? [])]);
}

/**
 * Refuses a module that no other host could compile: Node.js globals, or a module never reached.
 */
function expectHostNeutral(entry: string, modules: Map<string, Module>): void {
  for (const [name, module] of modules) {
    expect(module.nodeGlobals, `${entry} reaches ${name}, which uses Node.js`).toEqual([]);
    expect(module.nodeTypes, `${entry} reaches ${name}, which uses Node.js types`).toBe(false);
    for (const never of NEVER_REACHED)
      expect(name.startsWith(never), `${entry} reaches ${name}`).toBe(false);
  }
}

describe("Parts for other hosts, each imported alone", () => {
  for (const [part, { uses }] of Object.entries(PARTS))
    it(part, () => {
      const modules = reachable(part);
      expectHostNeutral(part, modules);
      const allowed = packagesAllowed(part);
      for (const [specifier, where] of packagesOf(modules))
        expect(allowed.has(specifier), where).toBe(true);
      // Of the other parts, it reaches those it uses and theirs, and every part it names.
      const under = partsUnder(part);
      for (const name of modules.keys())
        if (name !== part && name in PARTS)
          expect(under.has(name), `${part} reaches the part ${name}`).toBe(true);
      for (const used of uses)
        expect(modules.has(used), `${part} names ${used} but does not reach it`).toBe(true);
      expect(modules.has(BARREL), `${part} reaches ${BARREL}`).toBe(false);
    });

  it("use each other in one direction only", () => {
    for (const part of Object.keys(PARTS)) {
      for (const used of PARTS[part]!.uses)
        expect(PARTS, `${part} uses ${used}`).toHaveProperty([used]);
      expect(partsUnder(part).has(part), `${part} uses itself through others`).toBe(false);
    }
  });

  it("use exactly the parts that docs/ARCHITECTURE.md names for each", () => {
    const name = (path: string): string => path.replace(/^src\//u, "").replace(/\.ts$/u, "");
    // The self-tests are described there by the rule they follow, not one by one.
    const isSelfTest = (path: string): boolean =>
      path.endsWith("-self-test.ts") || path === "src/core/self-test.ts";
    const expected = Object.fromEntries(
      Object.entries(PARTS)
        .filter(([path]) => !isSelfTest(path))
        .map(([path, part]) => [name(path), part.uses.map(name).sort()]),
    );
    const documented = Object.fromEntries(
      [
        ...readFileSync("docs/ARCHITECTURE.md", "utf8").matchAll(/^- `([^`]+)` uses (.+)\.$/gmu),
      ].map(([, part, uses]) => [
        part,
        uses === "no other part"
          ? []
          : [...uses!.matchAll(/`([^`]+)`/gu)].map((match) => match[1]!).sort(),
      ]),
    );
    expect(documented).toEqual(expected);
  });

  it("each have a package export of their own, and the package exports no other module", () => {
    const { exports } = JSON.parse(readFileSync("package.json", "utf8")) as {
      exports: Record<string, { types: string; import: string }>;
    };
    const expected = Object.fromEntries(
      Object.keys(PARTS).map((part) => {
        const path = part.replace(/^src\//u, "").replace(/\.ts$/u, "");
        return [`./${path}`, { types: `./dist/${path}.d.ts`, import: `./dist/${path}.js` }];
      }),
    );
    const parts = Object.fromEntries(
      Object.entries(exports).filter(([subpath]) => !COMPATIBILITY_EXPORTS.includes(subpath)),
    );
    expect(parts).toEqual(expected);
    expect(Object.keys(exports)).toEqual(expect.arrayContaining(COMPATIBILITY_EXPORTS));
  });
});

describe("Ethereum for a host of Ethereum alone", () => {
  it("reaches neither the module of Ethereum Classic and Tron nor their names", () => {
    for (const entry of ["src/core/coins/ethereum.ts", "src/core/coins/ethereum-self-test.ts"]) {
      const modules = reachable(entry);
      expect([...modules.keys()], entry).not.toContain("src/core/coins/evm.ts");
      expect([...modules.keys()], entry).not.toContain("src/core/coins/evm-self-test.ts");
      for (const name of modules.keys()) {
        // Code only: a comment that names them is not built in.
        const source = code(readFileSync(name, "utf8"));
        for (const other of ["Ethereum Classic", "Tron", "0xFA22515E", "TUEZSdKs", "TTD7MudE"])
          expect([name, source.includes(other)]).toEqual([name, false]);
      }
    }
  });
});

describe("Shared modules for other hosts, each imported alone", () => {
  for (const [module, packages] of Object.entries(SHARED_MODULES))
    it(module, () => {
      const modules = reachable(module);
      expectHostNeutral(module, modules);
      const allowed = new Set([...BIP39_PACKAGES, ...packages]);
      for (const [specifier, where] of packagesOf(modules))
        expect(allowed.has(specifier), where).toBe(true);
    });

  it("include the search for damaged shares, without the Node.js host", () => {
    const modules = reachable("src/sskr/joint-repair.ts");
    expect(modules.has("src/sskr/share-platform.ts")).toBe(true);
    expect(modules.has("src/sskr/share-platform-node.ts")).toBe(false);
    expect(modules.has("src/sskr/runtime.ts")).toBe(false);
  });
});

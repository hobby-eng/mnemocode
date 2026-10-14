// AUD-021 evidence only. Run after the coordinator's fresh build; never runs a command or test.
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transform, version as esbuildVersion } from "esbuild";

const HARNESS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HARNESS_DIRECTORY, "../../..");
const DEFAULT_EVIDENCE_NAME = "remediation-parity-inventory";

// Module locations are audit scope, not copies of the modules' format or limit lists.
const FACT_MODULES = [
  "core/types",
  "core/bip39-sizes",
  "core/colors",
  "core/code-text",
  "core/dates",
  "core/date-search",
  "core/candidates",
  "core/missing-codes",
  "core/missing-codes-search",
  "core/candidate-list",
  "core/candidate-encryption",
  "core/candidate-file-admission",
  "core/png-admission",
  "core/search-turns",
  "core/address-scan",
  "core/bip32-limits",
  "core/wallet-evidence",
  "export/template-catalog",
  "export/card-settings",
  "export/document-formats",
  "export/sskr-content",
  "sskr/share-units",
  "sskr/share-layout",
  "sskr/share-platform",
  "sskr/transport",
  "sskr/split",
  "sskr/repair",
  "sskr/joint-repair",
  "record",
];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sorted = (values) => [...values].sort();
const anonymous = (text) => text.replace(/\/home\/[^/\s]+\//gu, "/home/user/");
const SOURCE_INPUTS = ["package.json", "pnpm-lock.yaml", "tsconfig.json", ".node-version", ".gitignore"];

function constantEntries(module) {
  return Object.entries(module).filter(
    ([name, value]) => /^[A-Z][A-Z0-9_]*$/u.test(name) && typeof value !== "function",
  );
}

function json(value) {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === "function") return undefined;
    if (typeof item === "bigint") return item.toString();
    if (item instanceof Set) return [...item];
    if (item instanceof Map) return [...item.entries()];
    if (item instanceof RegExp) return item.toString();
    return typeof item === "string" ? anonymous(item) : item;
  });
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
    else throw new Error(`Inventory refuses a non-regular source entry: ${path}`);
  }
  return sorted(files);
}

async function manifest(paths) {
  const hashes = {};
  for (const path of sorted(paths)) hashes[path] = sha256(await readFile(join(ROOT, path)));
  return hashes;
}

async function validateSyntax(path, text) {
  await transform(text, { loader: "ts", sourcefile: path, format: "esm", logLevel: "silent" });
}

// Preserve offsets while excluding comments and quoted text from keyword matching. esbuild
// validates syntax first; this small lexer is only for the restricted declaration forms below.
function lexicalViews(text) {
  const tokens = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`/gu;
  // Replace UTF-16 code units individually so astral characters cannot shift source offsets.
  const blank = (value) => value.replace(/[^\r\n]/g, " ");
  return {
    commentsRemoved: text.replace(tokens, (value) => value.startsWith("/") ? blank(value) : value),
    codeOnly: text.replace(tokens, blank),
  };
}

// A variable export must have exactly one plain binding. Ignore commas inside its type's
// delimiters (including generics); an arrow's > does not close a generic parameter list.
function assertSingleBinding(path, code, start) {
  const stack = [];
  const pairs = { ")": "(", "]": "[", "}": "{", ">": "<" };
  for (let index = start; index < code.length; index += 1) {
    const character = code[index];
    if ("([{<".includes(character)) stack.push(character);
    else if (Object.hasOwn(pairs, character) && !(character === ">" && code[index - 1] === "=")) {
      if (stack.pop() !== pairs[character])
        throw new Error(`Unsupported variable declaration delimiters: ${path}`);
    } else if (stack.length === 0) {
      if (character === ",") throw new Error(`Unsupported multiple export bindings: ${path}`);
      if (character === ";") return;
    }
  }
  throw new Error(`Unterminated variable export: ${path}`);
}

// esbuild erases types, so collect names from the original declarations, never its output.
// Accept local stars, namespace/named re-exports and named declarations; everything else fails
// closed. Follow stars to retain type-only names as well as runtime exports.
async function declarationExports(path, visiting = new Set()) {
  if (visiting.has(path)) throw new Error(`Cyclic declaration export: ${path}`);
  const next = new Set([...visiting, path]);
  const text = await readFile(join(ROOT, path), "utf8");
  await validateSyntax(path, text);
  const { commentsRemoved, codeOnly } = lexicalViews(text);
  const exports = new Map();
  let coveredThrough = 0;
  let scannedThrough = 0;
  let braceDepth = 0;
  for (const token of codeOnly.matchAll(/\bexport\b/gu)) {
    if (token.index < coveredThrough) continue;
    for (; scannedThrough < token.index; scannedThrough += 1) {
      if (codeOnly[scannedThrough] === "{") braceDepth += 1;
      else if (codeOnly[scannedThrough] === "}") braceDepth -= 1;
    }
    if (braceDepth !== 0) throw new Error(`Unsupported nested export declaration: ${path}`);
    // Embedded exports in namespaces or declaration bodies are outside this parser's contract.
    const line = codeOnly.slice(codeOnly.lastIndexOf("\n", token.index - 1) + 1, token.index);
    if (line.trim() !== "") throw new Error(`Unsupported inline export declaration: ${path}`);
    const tail = commentsRemoved.slice(token.index);
    const reexport = /^export\s+(type\s+)?(\*(?:\s+as\s+[$\w]+)?|\{[^{}]*\})(?:\s+from\s+(["'])([^"'\\\r\n]+)\3)?\s*;/u.exec(tail);
    if (reexport !== null) {
      coveredThrough = token.index + reexport[0].length;
      const [, typeModifier, clause, , from] = reexport;
      const typeOnly = typeModifier !== undefined;
      const origin = { declaration: path, ...(from === undefined ? {} : { from }) };
      if (clause === "*") {
        if (from === undefined || !from.startsWith(".") || !from.endsWith(".js"))
          throw new Error(`Unsupported export star target: ${path}`);
        const target = relative(
          ROOT,
          resolve(ROOT, dirname(path), from.replace(/\.js$/u, ".d.ts")),
        );
        if (!target.startsWith("dist/")) throw new Error(`Export star leaves dist: ${path}`);
        for (const item of await declarationExports(target, next)) {
          if (item.name !== "default" && !exports.has(item.name))
            exports.set(item.name, { ...item, declaredTypeOnly: typeOnly || item.declaredTypeOnly });
        }
      } else if (clause.startsWith("{")) {
        const entries = clause.slice(1, -1).trim().replace(/,\s*$/u, "");
        for (const entry of entries === "" ? [] : entries.split(",")) {
          const named = /^\s*(type\s+)?([$A-Z_a-z][$\w]*)(?:\s+as\s+([$A-Z_a-z][$\w]*))?\s*$/u.exec(entry);
          if (named === null) throw new Error(`Unsupported named export: ${path}`);
          const [, itemType, originalName, alias] = named;
          const name = alias ?? originalName;
          exports.set(name, {
            name,
            ...origin,
            originalName,
            declaredTypeOnly: typeOnly || itemType !== undefined,
          });
        }
      } else {
        if (from === undefined) throw new Error(`Namespace export needs a target: ${path}`);
        const name = clause.replace(/^\*\s+as\s+/u, "");
        exports.set(name, {
          name,
          ...origin,
          declaredTypeOnly: typeOnly,
        });
      }
      continue;
    }
    const declaration = /^export\s+(?:declare\s+)?(?:abstract\s+)?(const|let|var|function|class|interface|type|enum)\s+([$A-Z_a-z][$\w]*)(?![$\w])/u.exec(tail);
    if (declaration === null) throw new Error(`Unsupported export declaration: ${path}`);
    const [, kind, name] = declaration;
    if (["const", "let", "var"].includes(kind))
      assertSingleBinding(path, codeOnly, token.index + declaration[0].length);
    exports.set(name, {
      name,
      declaration: path,
      declarationKind: kind,
      declaredTypeOnly: kind === "interface" || kind === "type",
    });
  }
  return [...exports.values()].sort((left, right) => left.name.localeCompare(right.name, "en"));
}

async function auxiliaryCommands() {
  const path = "src/cli/command-line.ts";
  const text = await readFile(join(ROOT, path), "utf8");
  await validateSyntax(path, text);
  const { commentsRemoved, codeOnly } = lexicalViews(text);
  const names = new Set();
  for (const match of commentsRemoved.matchAll(/\bcommand\s*===\s*(["'])([a-z][a-z0-9-]*)\1/gu)) {
    if (codeOnly.slice(match.index, match.index + "command".length) === "command")
      names.add(match[2]);
  }
  if (names.size === 0) throw new Error("No dispatcher command literals found; update the matcher.");
  return sorted(names);
}

class ParityInventory {
  async run() {
    const extra = process.argv.slice(2);
    const outputOption = extra.indexOf("--evidence-name");
    let evidenceName = DEFAULT_EVIDENCE_NAME;
    if (outputOption !== -1) {
      evidenceName = extra[outputOption + 1];
      if (typeof evidenceName !== "string" || !/^[a-z0-9][a-z0-9-]*$/u.test(evidenceName))
        throw new Error("Choose a fresh alphanumeric/hyphen evidence name.");
      extra.splice(outputOption, 2);
    }
    const output = `docs/audits/AUD-021-evidence/${evidenceName}.json`;
    // A SHA-256 is 64 hexadecimal digits. The coordinator's wider fingerprint uses its own scope.
    if (
      extra.length !== 0 &&
      !(
        extra.length === 2 &&
        extra[0] === "--source-fingerprint" &&
        /^[a-f0-9]{64}$/iu.test(extra[1])
      )
    )
      throw new Error("Usage: parity-inventory.mjs [--source-fingerprint SHA256] [--evidence-name NAME]");
    const sourcePaths = [...(await filesUnder("src")), ...SOURCE_INPUTS];
    const builtPaths = await filesUnder("dist");
    const sourceHashes = await manifest(sourcePaths);
    const builtHashes = await manifest(builtPaths);
    // This rejects an obviously stale build. Hashes bind the actual bytes; timestamps alone do
    // not establish compiler provenance, which remains the coordinator's recorded build evidence.
    for (const path of sourcePaths.filter((item) => item.endsWith(".ts"))) {
      const stem = path.replace(/^src\//u, "dist/").replace(/\.ts$/u, "");
      for (const ending of [".js", ".d.ts"]) {
        if ((await stat(join(ROOT, stem + ending))).mtimeMs < (await stat(join(ROOT, path))).mtimeMs)
          throw new Error(`Fresh build required for: ${path}`);
      }
    }
    const ignore = await readFile(join(ROOT, ".gitignore"), "utf8");
    if (!ignore.split(/\r?\n/u).includes("docs/audits/*-evidence/"))
      throw new Error("The audit evidence ignore rule is missing; no inventory written.");
    const load = (path) => import(pathToFileURL(join(ROOT, `dist/${path}.js`)).href);
    const { commandOptions, COMMAND_FACTS, HELP_FLAGS, VERSION_FLAGS } = await load(
      "cli/command-options",
    );
    const { flagOf } = await load("cli/arguments");
    const { formatNumber } = await load("cli/format-numbers");
    const { Masking } = await load("core/masking");
    const { EncodedForm } = await load("core/encoded-form");
    const { maximumDates } = await load("core/dates");
    const { ShareSetChoice } = await load("core/backup-options");
    const { COINS } = await load("core/coins");
    const modules = {};
    const facts = {};
    const staticFacts = {};
    for (const path of FACT_MODULES) {
      modules[path] = await load(path);
      facts[`src/${path}.ts`] = Object.fromEntries(constantEntries(modules[path]));
      for (const [name, value] of Object.entries(modules[path])) {
        if (typeof value !== "function") continue;
        const constants = constantEntries(value);
        if (constants.length !== 0)
          staticFacts[`src/${path}.ts#${name}`] = Object.fromEntries(constants);
      }
    }
    const types = modules["core/types"];
    const catalog = modules["export/template-catalog"];
    const settings = modules["export/card-settings"];
    const transport = modules["sskr/transport"];
    const auxiliary = await auxiliaryCommands();
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
    const publicExports = {};
    for (const [entry, targets] of Object.entries(packageJson.exports)) {
      const runtime = await import(pathToFileURL(resolve(ROOT, targets.import)).href);
      publicExports[entry] = {
        targets,
        source: targets.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts"),
        runtime: Object.keys(runtime).sort().map((name) => ({ name, kind: typeof runtime[name] })),
        declarations: await declarationExports(targets.types.replace(/^\.\//u, "")),
      };
    }
    const inventory = {
      audit: "AUD-021",
      purpose: "ALL-capabilities parity inventory; enumeration is not proof of browser support",
      generatedAt: new Date().toISOString(),
      package: { name: packageJson.name, version: packageJson.version },
      runtime: { node: process.version, declarationSyntaxParser: `esbuild ${esbuildVersion}` },
      coordinatorSourceFingerprint: {
        sha256: extra[1] ?? null,
        scope: "Externally supplied wider non-audit handover snapshot",
        status: extra.length === 0 ? "pending" : "supplied; not recomputed by this harness",
      },
      commands: Object.fromEntries(Object.entries(commandOptions).map(([name, keys]) => [name, {
        facts: { ...COMMAND_FACTS[name], asksOutputs: typeof COMMAND_FACTS[name].asksOutputs === "function" },
        options: [...new Set(keys)].map((key) => ({
          key, flag: flagOf(key), acceptedFlags: [...new Set([flagOf(key), `--${key}`])],
        })),
        helpFlags: Object.values(HELP_FLAGS),
      }])),
      auxiliaryCommands: auxiliary,
      globalFlags: { help: HELP_FLAGS, version: VERSION_FLAGS },
      modes: types.MASKING_MODES.map((mode) => {
        const value = Masking.of(mode);
        return {
          mode, name: value.name, masked: value.masked, encodable: value.encodable,
          keepsChecksum: value.keepsChecksum, givesSeveral: value.givesSeveral,
          withValidLastWord: value.withValidLastWord?.mode ?? null,
          capabilities: value.capabilities, wrongDateWarning: value.wrongDateWarning ?? null,
        };
      }),
      phraseLengths: types.BIP39_WORD_COUNTS.map((words) => ({ words, maximumDates: maximumDates(words) })),
      formats: types.ENCODED_FORMATS.map((format) => {
        const value = EncodedForm.of(format);
        return {
          format, cliNumber: formatNumber(format), unit: value.unit,
          cardKind: value.cardKind ?? null, colors: value.colors, alwaysMasked: value.alwaysMasked,
          elementCounts: types.BIP39_WORD_COUNTS.map((words) => ({ words, elements: value.elementCount(words) })),
        };
      }),
      transportFormats: modules["sskr/share-units"].SHARE_FORMATS.map((format) => ({
        format, restoredForm: transport.MIRRORED_FORM[format], cards: transport.shareFormatHasCards(format),
      })),
      templates: catalog.TEMPLATE_CATALOG.map((entry, index) => ({
        ...entry, cliNumber: index + 1, separateCards: catalog.drawsSeparateCards(entry),
      })),
      pageSizes: settings.CARD_PAGE_SIZES.map((size) => ({
        size, label: settings.pageSizeLabel(size), dimensions: settings.pageDimensions(size),
        separateCards: settings.isCardPageSize(size),
      })),
      orientations: settings.CARD_ORIENTATIONS,
      profileFields: settings.profileFields,
      copyFields: settings.COPY_FIELDS,
      documentFormats: modules["export/document-formats"].DOCUMENT_FORMAT_FACTS,
      documentAliases: modules["export/document-formats"].DOCUMENT_EXTENSIONS.map((name) => ({
        name, format: modules["export/document-formats"].parseDocumentFormat(name),
      })),
      sharePresets: ShareSetChoice.PRESETS.map(({ threshold, count }) => ({ threshold, count })),
      wallet: {
        profiles: modules["core/wallet-evidence"].bitcoinProfiles,
        coins: COINS.map(({ id, name, addressForms, coinTypes }) => ({ id, name, addressForms, coinTypes })),
      },
      publicExports,
      facts,
      staticFacts,
      candidateAdmissionParameters: modules["core/candidate-file-admission"].CandidateFileAdmission.parameters(),
      shareCountRange: ShareSetChoice.RANGE,
      sourceHashes,
      sourceManifestSha256: sha256(json(sourceHashes)),
      sourceManifestScope: {
        directories: ["src"],
        additionalInputs: SOURCE_INPUTS,
        excludes: "Other non-audit files; not the coordinator's wider snapshot fingerprint",
      },
      builtHashes,
      auditArtifactHashes: await manifest([
        "docs/audits/AUD-021-harnesses/parity-inventory.mjs",
        "docs/audits/AUD-021-harnesses/parity-notes.md",
      ]),
      limits: "Exported facts only; private restrictions and workflow semantics are documented in parity-notes.md",
    };
    if (
      json(sourceHashes) !== json(await manifest([...(await filesUnder("src")), ...SOURCE_INPUTS])) ||
      json(builtHashes) !== json(await manifest(await filesUnder("dist")))
    )
      throw new Error("Source or dist changed during inventory; rerun after the coordinator settles edits.");
    await mkdir(dirname(join(ROOT, output)), { recursive: true });
    // Preserve prior evidence: the coordinator must retain or relocate it before a repeated run.
    await writeFile(join(ROOT, output), JSON.stringify(JSON.parse(json(inventory)), null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log(
      `${output}: ${Object.keys(commandOptions).length} registered commands; ` +
        `${Object.keys(publicExports).length} package entry points.`,
    );
  }
}

try {
  await new ParityInventory().run();
} catch (error) {
  console.error(anonymous(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
}

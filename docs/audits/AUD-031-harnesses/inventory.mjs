// Inventory preparation is not semantic review. Never overwrite a retained audit snapshot.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ErrorCatalog } from "../../../src/core/error-catalog.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-031-evidence");
const workspace = resolve(root, "..");
const OWN_AUDIT_PREFIX = "docs/audits/AUD-031";
const ERRORS = new ErrorCatalog("audits.aud031.inventory", {
  retained: () => "The AUD-031 snapshot already exists; use its retained evidence.",
  parser: () => "The existing workspace TypeScript parser is unavailable; inventory is incomplete.",
  parse: (path) => `The inventory could not parse ${path}.`,
});
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const save = (name, value) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2) + "\n");

function scopeOf(path, text) {
  if (path.startsWith("docs/audits/")) return "history";
  if (path.startsWith("src/cli/") || path.startsWith("src/export/")) return "interface";
  if (path.startsWith("test/"))
    return /src\/(?:cli|export)\//u.test(text) ? "interface" : "protocol";
  if (/^(?:src|sskr-wasm|vectors)\//u.test(path)) return "protocol";
  return "coordinator";
}

function dependencyOf(path, specifier) {
  if (!specifier.startsWith(".")) return { specifier, external: true };
  const base = resolve(root, dirname(path), specifier);
  const found = [base, base.replace(/\.js$/u, ".ts")].find(existsSync);
  return { specifier, path: found === undefined ? null : relative(root, found), external: false };
}

function memberName(ts, member, source) {
  if (member.name !== undefined) return member.name.getText(source);
  if (ts.isConstructorDeclaration(member)) return "constructor";
  if (ts.isCallSignatureDeclaration(member)) return "()";
  if (ts.isConstructSignatureDeclaration(member)) return "new()";
  if (ts.isIndexSignatureDeclaration(member)) return "[index]";
  return undefined;
}

function contractsOf(ts, path, text) {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (source.parseDiagnostics.length !== 0) throw ERRORS.create("parse", [path]);
  const lineOf = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const description = (node) =>
    ts.getJSDocCommentsAndTags(node).map((comment) => comment.getText(source)).join("\n");
  const has = (node, kind) => node.modifiers?.some((modifier) => modifier.kind === kind) === true;
  const contracts = [];
  const dependencies = [];
  for (const node of source.statements) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      dependencies.push(dependencyOf(path, node.moduleSpecifier.text));
    if (!has(node, ts.SyntaxKind.ExportKeyword) && !ts.isExportDeclaration(node)) continue;
    const name = node.name?.getText(source) ?? node.getText(source).split("\n")[0];
    const contract = { path, line: lineOf(node), name, kind: ts.SyntaxKind[node.kind],
      contract: description(node), review: "unreviewed", members: [] };
    if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
      for (const member of node.members) {
        if (has(member, ts.SyntaxKind.PrivateKeyword) || has(member, ts.SyntaxKind.ProtectedKeyword))
          continue;
        if (member.name !== undefined && ts.isPrivateIdentifier(member.name)) continue;
        const memberLabel = memberName(ts, member, source);
        if (memberLabel === undefined) continue;
        contract.members.push({ name: memberLabel,
          kind: ts.SyntaxKind[member.kind], line: lineOf(member), contract: description(member),
          review: "unreviewed" });
      }
    }
    contracts.push(contract);
  }
  function dynamicImports(node) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && ts.isStringLiteral(argument))
        dependencies.push(dependencyOf(path, argument.text));
      else dependencies.push({ specifier: null, path: null, unresolved: true,
        expression: argument?.getText(source) ?? "", line: lineOf(node),
        review: "manual-review-required" });
    }
    ts.forEachChild(node, dynamicImports);
  }
  dynamicImports(source);
  return { contracts, dependencies };
}

mkdirSync(evidence, { recursive: true });
if (existsSync(resolve(evidence, "snapshot.json"))) throw ERRORS.create("retained", []);
const parser = resolve(workspace, "tmp/cancel-check/node_modules/typescript");
if (!existsSync(parser)) throw ERRORS.create("parser", []);
const ts = createRequire(import.meta.url)(parser);
const previous = JSON.parse(readFileSync(resolve(root, "docs/audits/AUD-030-evidence/snapshot.json"), "utf8"));
const priorFiles = new Map(previous.files.map((file) => [file.path, file]));
const names = [...new Set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))]
  .filter((path) => path && !path.startsWith(OWN_AUDIT_PREFIX) && existsSync(resolve(root, path)))
  .sort();
const operations = [];
const files = names.map((path) => {
  const bytes = readFileSync(resolve(root, path));
  const binary = bytes.subarray(0, 8192).includes(0);
  const text = binary ? "" : bytes.toString("utf8");
  const parsed = /^(?:src|scripts)\/.*\.(?:ts|mjs)$/u.test(path)
    ? contractsOf(ts, path, text) : { contracts: [], dependencies: [] };
  operations.push(...parsed.contracts);
  const sha256 = digest(bytes);
  return { path, sha256, bytes: bytes.length, binary, lines: binary ? null : text.split("\n").length,
    primaryScope: scopeOf(path, text), review: "unreviewed", dependencies: parsed.dependencies,
    priorAudit: { auditId: "AUD-030", sha256: priorFiles.get(path)?.sha256 ?? null,
      bytesIdentical: priorFiles.get(path)?.sha256 === sha256,
      contextAdmission: "A reviewer must check dependency/caller/procedure identity before reuse." } };
});
const identities = files.map(({ path, sha256 }) => ({ path, sha256 }));
const source = identities.filter(({ path }) => !path.startsWith("docs/audits/"));
const captured = { capturedAtUtc: new Date().toISOString(), commit: git("rev-parse", "HEAD").trim(),
  branch: git("branch", "--show-current").trim(), remote: git("rev-parse", "origin/main").trim(),
  workingTree: git("status", "--short"), commitComplete: false,
  sourceFingerprint: digest(JSON.stringify(source)), allFilesFingerprint: digest(JSON.stringify(identities)),
  files, excluded: ["Ignored dependencies, build output and local evidence", "This audit's own records and harnesses avoid a self-reference"],
  priorSnapshotSha256: digest(readFileSync(resolve(root, "docs/audits/AUD-030-evidence/snapshot.json"))) };
// A git refusal precedes all publication. Incomplete companion files are not an admitted capture.
const patch = git("diff", "--binary", "HEAD", "--", ".", `:(exclude)${OWN_AUDIT_PREFIX}*`);
save("public-contracts.json", { parserVersion: ts.version, contracts: operations,
  qualification: "Declarations and callable/constructor/interface members are distinct inventory kinds, not a count of semantically reviewed operations. Type aliases are inventoried as declarations; callable/intersection expansion, inherited members, Rust, generated binary interfaces and runtime-only members need an explicit supplement. Computed imports remain explicit manual-review edges and are never executed." });
for (const scope of new Set(files.map((file) => file.primaryScope)))
  save(scope + "-files.json", files.filter((file) => file.primaryScope === scope));
writeFileSync(resolve(evidence, "tracked-baseline.patch"), patch);
// Publish the complete marker last. A partial write is private; link refuses to replace a
// retained snapshot, unlike rename. Failed pending files remain local evidence for diagnosis.
const pending = resolve(evidence, `.snapshot-${process.pid}-${Date.now()}.pending.json`);
writeFileSync(pending, JSON.stringify(captured, null, 2) + "\n", { flag: "wx" });
linkSync(pending, resolve(evidence, "snapshot.json"));
unlinkSync(pending);
console.log(JSON.stringify({ files: files.length, sourceFiles: source.length, declarations: operations.length,
  publicMembers: operations.reduce((count, operation) => count + operation.members.length, 0),
  changedOrNewSinceAUD030: files.filter((file) => !file.priorAudit.bytesIdentical).length,
  sourceFingerprint: digest(JSON.stringify(source)) }));

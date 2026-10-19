// Capture identity and planned coverage, not semantic review or execution credit.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const workspace = resolve(root, "..");
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const ownPrefix = "docs/audits/AUD-032";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const save = (name, value) =>
  writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
mkdirSync(evidence, { recursive: true });
if (existsSync(resolve(evidence, "snapshot.json"))) throw new Error("Snapshot already captured.");
const auditNumbers = git("ls-files", "-co", "--exclude-standard").matchAll(
  /^docs\/audits\/AUD-(\d+)(?!\d)/gmu,
);
const previous = [...auditNumbers].map((match) => Number(match[1])).filter((number) => number !== 32);
if (Math.max(...previous) !== 31) throw new Error("Recheck audit number reservation.");

const names = [...new Set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))]
  .filter((path) => path && !path.startsWith(ownPrefix))
  .sort();
const files = names.map((path) => {
  const bytes = readFileSync(resolve(root, path));
  return { path, sha256: sha(bytes), bytes: bytes.length,
    binary: bytes.subarray(0, 8192).includes(0) };
});
const rows = files.map(({ path, sha256 }) => ({ path, sha256 }));
const source = rows.filter(({ path }) => !path.startsWith("docs/audits/"));
const instructions = [
  resolve(process.env.HOME, ".copilot/copilot-instructions.md"),
  resolve(workspace, "AGENTS.md"), resolve(root, "AGENTS.md"),
  resolve(workspace, ".github/agents/wallet-tools-maintainer.agent.md"),
  ...["code-core", "code-typescript", "code-rust", "code-tooling", "code-browser", "docs", "ci", "audits"]
    .map((name) => resolve(workspace, `.github/instructions/${name}.instructions.md`)),
  ...["wallet-full-audit", "wallet-release-verification", "wallet-security-review",
    "javascript-testing-expert", "property-based-testing", "zeroize-audit",
    "audit-context-building", "spec-to-code-compliance"]
    .map((name) => resolve(workspace, `.github/skills/${name}/SKILL.md`)),
  resolve(workspace, ".github/skills/README-trailofbits-skills.md"),
  resolve(workspace, "GLOSSARY.md"), resolve(workspace, "GLOSSARY-MAP.md"),
];
const procedure = ["docs/FULL_AUDIT_GUIDE.md", "docs/audits/AUDIT_STANDARD.md",
  "docs/audits/AUDIT_TEMPLATE.md", "docs/audit-report.schema.json"]
  .map((path) => resolve(workspace, "multi-chain-wallet-tools", path));
const hashInputs = (paths) => paths.map((path) => ({
  path: relative(workspace, path), sha256: sha(readFileSync(path)),
}));
save("procedure-hashes.json", hashInputs(procedure));
save("instruction-hashes.json", hashInputs(instructions));
const sourceFingerprint = sha(JSON.stringify(source));
const snapshot = { auditId: "AUD-032", capturedAtUtc: new Date().toISOString(),
  commit: git("rev-parse", "HEAD").trim(), branch: git("branch", "--show-current").trim(),
  remoteBaseline: git("rev-parse", "origin/main").trim(), workingTree: git("status", "--short"),
  sourceFingerprint, allFilesFingerprint: sha(JSON.stringify(rows)), files,
  exclusions: ["This audit's own report/harness/evidence files",
    "Ignored dependencies, caches and private/generated exports; inspected release artifacts are separate"] };
save("snapshot.json", snapshot);
writeFileSync(resolve(evidence, "baseline.patch"),
  git("diff", "--binary", "HEAD", "--", ".", `:(exclude)${ownPrefix}*`), { flag: "wx" });

const guide = readFileSync(procedure[0], "utf8");
const checks = [...guide.matchAll(/^### (CHECK-([A-Z]+)-\d{3}) — (.+)$/gmu)]
  .map(([, checkId, category, title]) => ({
    checkId, category, title,
    primaryOwner: category === "FUN" || (category === "SEC" && ["001", "004", "005"].some(
      (suffix) => checkId.endsWith(suffix))) ? "protocol-reviewer" : "coordinator",
    scope: "Standalone MnemoCode only; unsupported disciplines receive individual reasons",
    expectedEvidence: category === "FUN" ? "Body/caller review, literal public vectors, full tests and independent probes"
      : category === "SEC" ? "Threat/ownership/source trace, refusals, cleanup and isolation controls"
      : category === "API" ? "Public-operation inventory, dependency/caller contracts and runtime controls"
      : category === "BLD" ? "Pinned inputs, serial local gates/builds, package/artifact/provenance evidence"
      : category === "UI" ? "Native PTY and actual export/QR evidence; external browser acceptance separated"
      : category === "ARC" ? "Imports, CORE/language-rule dispositions and actual consumers/tests"
      : "Source-to-document claims, legal materials, historical final dispositions and report validation",
    outcome: "not-run", skepticalOwner: "independent-skeptic",
  }));
if (checks.length !== 32) throw new Error("Canonical check count changed.");
save("check-plan.json", checks);
save("resource-plan.json", { reserveBytes: 3 * 1024 ** 3,
  heavyCheckRssMiB: 1536, heavyCheckNodeHeapMiB: 768, cargoJobs: 1, testWorkers: 1,
  maxConcurrentReviewers: 2, reviewerPolicy: "Read-only; no product tests/builds/scanner installs; bounded small evidence writes only",
  memoryMethod: "Retained AUD-026 sampled process-tree RSS/host MemAvailable; not a hard OS cap; Docker daemon is outside process tree",
  heavyCommandsSerial: true });

const parserPath = resolve(workspace, "tmp/cancel-check/node_modules/typescript");
const ts = createRequire(import.meta.url)(parserPath);
const contracts = [];
const imports = [];
for (const { path } of files.filter(({ path }) => /^(src|scripts)\/.*\.(ts|mjs)$/u.test(path))) {
  const text = readFileSync(resolve(root, path), "utf8");
  const ast = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse ${path}`);
  const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const modifier = (node, kind) => node.modifiers?.some((item) => item.kind === kind);
  for (const node of ast.statements) {
    if (modifier(node, ts.SyntaxKind.ExportKeyword) || ts.isExportDeclaration(node)) {
      const members = [];
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node))
        for (const member of node.members) {
          if (modifier(member, ts.SyntaxKind.PrivateKeyword) || modifier(member, ts.SyntaxKind.ProtectedKeyword)
            || (member.name && ts.isPrivateIdentifier(member.name))) continue;
          members.push({ name: member.name?.getText(ast) ?? (ts.isConstructorDeclaration(member) ? "constructor" : ts.SyntaxKind[member.kind]),
            line: line(member), kind: ts.SyntaxKind[member.kind], depth: "inventory-only" });
        }
      contracts.push({ path, line: line(node), name: node.name?.getText(ast) ?? node.getText(ast).split("\n")[0],
        kind: ts.SyntaxKind[node.kind], members, depth: "inventory-only" });
    }
  }
  const visit = (node) => {
    const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
      : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null;
    if (specifier) {
      const literal = ts.isStringLiteral(specifier) ? specifier.text : null;
      const target = literal?.startsWith(".") ? resolve(root, dirname(path), literal.replace(/\.js$/u, ".ts")) : null;
      imports.push({ path, line: line(node), specifier: literal, expression: literal ? null : specifier.getText(ast),
        target: target && existsSync(target) ? relative(root, target) : null });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
save("public-operations.json", { parserVersion: ts.version, contracts, imports,
  limitations: "Declarations are not executed operations. Callable aliases, inherited/runtime members, Rust and generated ABI require explicit review supplements." });
save("file-coverage-plan.json", files.map(({ path, sha256, binary }) => ({
  path, sha256, primaryOwner: /^(src\/(?:core|sskr)\/|sskr-wasm\/|vectors\/)/u.test(path) ? "protocol-reviewer" : "coordinator",
  expectedMethod: path.startsWith("docs/audits/") ? "Historical structure, index and final-disposition/context admission; not historical re-execution"
    : binary ? "Identity/provenance/consumer and actual-output sampling; not every pixel/glyph"
    : path.startsWith("test/") ? "Suite execution plus assertion/production-path review at explicitly recorded depth"
    : "Source/document/config review with caller/contract checks at explicitly recorded depth",
  depth: "not-yet-reviewed",
})));
for (const directory of ["dist", "release"]) {
  if (!existsSync(resolve(root, directory))) continue;
  const artifacts = readdirSync(resolve(root, directory), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => {
      const path = relative(root, resolve(entry.parentPath, entry.name));
      const bytes = readFileSync(resolve(root, path));
      return { path, bytes: bytes.length, sha256: sha(bytes) };
    }).sort((a, b) => a.path.localeCompare(b.path));
  save(`${directory}-before.json`, { capturedAtUtc: new Date().toISOString(), artifacts,
    provenance: "Existing ignored output; not accepted as a current release candidate" });
}
console.log(JSON.stringify({ files: files.length, sourceFiles: source.length, sourceFingerprint,
  checks: checks.length, declarations: contracts.length,
  members: contracts.reduce((count, contract) => count + contract.members.length, 0) }));

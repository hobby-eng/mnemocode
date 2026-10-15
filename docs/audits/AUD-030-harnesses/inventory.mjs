// Audit-only inventory: no implementation changes or external requests.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-030-evidence");
const workspace = resolve(root, "..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const save = (name, value) => writeFileSync(resolve(evidence, name), JSON.stringify(value, null, 2) + "\n");
mkdirSync(evidence, { recursive: true });
if (existsSync(resolve(evidence, "snapshot.json")))
  throw new Error("The retained AUD-030 snapshot already exists; do not overwrite original evidence.");

function owner(path, text) {
  if (path.startsWith("docs/audits/")) return "history";
  if (path.startsWith("src/cli/") || path.startsWith("src/export/")) return "interface";
  if (path.startsWith("test/"))
    return /src\/(?:cli|export)\//u.test(text) ? "interface" : "protocol";
  if (path.startsWith("src/") || path.startsWith("sskr-wasm/") || path.startsWith("vectors/"))
    return "protocol";
  return "coordinator";
}

const names = [...new Set(git("ls-files", "-co", "--exclude-standard", "-z").split("\0"))]
  .filter((path) => path && !path.startsWith("docs/audits/AUD-030"))
  .sort();
const files = names.map((path) => {
  const bytes = readFileSync(resolve(root, path));
  const binary = bytes.subarray(0, 8192).includes(0);
  const text = binary ? "" : bytes.toString("utf8");
  return { path, sha256: sha(bytes), size: bytes.length, binary, lines: binary ? null : text.split("\n").length,
    owner: owner(path, text), coverage: "assigned" };
});
const sourceRows = files.filter((row) => !row.path.startsWith("docs/audits/"))
  .map(({ path, sha256 }) => ({ path, sha256 }));
save("snapshot.json", {
  capturedAtUtc: new Date().toISOString(), commit: git("rev-parse", "HEAD").trim(),
  branch: git("branch", "--show-current").trim(), remote: git("rev-parse", "origin/main").trim(),
  workingTree: git("status", "--short"), sourceFingerprint: sha(JSON.stringify(sourceRows)),
  allFilesFingerprint: sha(JSON.stringify(files.map(({ path, sha256 }) => ({ path, sha256 })))),
  files, excluded: ["Ignored build outputs, dependency installations and local evidence", "AUD-030's own records and harnesses avoid a self-referential snapshot"],
});
for (const role of ["protocol", "interface", "history", "coordinator"])
  save(role + "-files.json", files.filter((row) => row.owner === role));

const instructions = ["AGENTS.md", ...["code-core", "code-rust", "code-typescript", "code-browser", "code-tooling", "docs", "ci", "audits"].map((name) => ".github/instructions/" + name + ".instructions.md"),
  "multi-chain-wallet-tools/docs/FULL_AUDIT_GUIDE.md", "multi-chain-wallet-tools/docs/audits/AUDIT_STANDARD.md",
  "multi-chain-wallet-tools/docs/audits/AUDIT_TEMPLATE.md", "multi-chain-wallet-tools/docs/audit-report.schema.json",
  ".github/skills/README-trailofbits-skills.md"];
save("procedure-hashes.json", Object.fromEntries(instructions.map((path) => [path, sha(readFileSync(resolve(workspace, path)))])));
writeFileSync(resolve(evidence, "baseline.patch"), git("diff", "--binary", "HEAD"));

const parser = resolve(workspace, "tmp/cancel-check/node_modules/typescript");
const operations = [];
if (existsSync(parser)) {
  const ts = createRequire(import.meta.url)(parser);
  for (const { path } of files.filter((row) => /^(?:src|scripts)\/.*\.(?:ts|mjs)$/u.test(row.path))) {
    const text = readFileSync(resolve(root, path), "utf8");
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) throw new Error("Parse diagnostics in " + path);
    const line = (node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const exported = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    for (const node of source.statements) {
      if (!exported(node) && !ts.isExportDeclaration(node)) continue;
      operations.push({ path, line: line(node), kind: ts.SyntaxKind[node.kind],
        name: node.name?.getText(source) ?? node.getText(source).split("\n")[0],
        contract: ts.getJSDocCommentsAndTags(node).map((doc) => doc.getText(source)).join("\n"),
        members: ts.isClassDeclaration(node) ? node.members.filter((member) => member.name && !ts.isPrivateIdentifier(member.name) &&
          !member.modifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)).map((member) => ({ name: member.name.getText(source), line: line(member), contract: ts.getJSDocCommentsAndTags(member).map((doc) => doc.getText(source)).join("\n") })) : [],
        coverage: "assigned" });
    }
  }
  save("public-operations.json", { parserVersion: ts.version, parserPath: "Existing workspace scratch TypeScript parser; no dependency installed", operations });
} else save("public-operations.json", { operations, limitation: "Existing AST parser unavailable; manual operation inventory required" });
console.log(JSON.stringify({ files: files.length, sourceFiles: sourceRows.length,
  sourceFingerprint: sha(JSON.stringify(sourceRows)), operations: operations.length,
  scopes: Object.fromEntries(["protocol", "interface", "history", "coordinator"].map((role) => [role, files.filter((f) => f.owner === role).length])) }));

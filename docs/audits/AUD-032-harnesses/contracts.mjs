// Supplement declaration inventory with callable shapes, inheritance, native ABI and CLI options.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandOptions, COMMAND_FACTS } from "../../../dist/cli/command-options.js";
import { flagOf } from "../../../dist/cli/arguments.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const evidence = resolve(root, "docs/audits/AUD-032-evidence");
const snapshot = JSON.parse(readFileSync(resolve(evidence, "snapshot.json"), "utf8"));
const retained = JSON.parse(readFileSync(resolve(evidence, "retained-context-admission.json"), "utf8"));
const ts = createRequire(import.meta.url)(resolve(root, "../tmp/cancel-check/node_modules/typescript"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const supplements = [];
for (const file of snapshot.files.filter((file) =>
  /^src\/.*\.ts$/u.test(file.path) || /^sskr-wasm\/generated\/.*\.d\.ts$/u.test(file.path))) {
  const text = readFileSync(resolve(root, file.path), "utf8");
  const ast = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
  const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
  const exported = (node) => node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword);
  for (const node of ast.statements) {
    if (!exported(node)) continue;
    if (ts.isTypeAliasDeclaration(node) || node.heritageClauses?.length
      || file.path.startsWith("sskr-wasm/generated/")) {
      const shapes = [];
      const visit = (child) => {
        if (ts.isCallSignatureDeclaration(child) || ts.isConstructSignatureDeclaration(child)
          || ts.isFunctionTypeNode(child) || ts.isPropertySignature(child)
          || ts.isMethodSignature(child) || ts.isIndexSignatureDeclaration(child))
          shapes.push({ line: line(child), kind: ts.SyntaxKind[child.kind],
            name: child.name?.getText(ast) ?? "<callable-or-index>", signature: child.getText(ast) });
        ts.forEachChild(child, visit);
      };
      visit(node);
      supplements.push({ path: file.path, sha256: file.sha256, line: line(node),
        name: node.name?.getText(ast) ?? node.getText(ast).split("\n")[0],
        kind: ts.SyntaxKind[node.kind], declaration: node.getText(ast), shapes,
        inheritance: node.heritageClauses?.map((clause) => clause.getText(ast)) ?? [],
        depth: file.path.startsWith("sskr-wasm/generated/")
          ? "Generated ABI/type contract and integrity comparison, not handwritten algorithm review"
          : "Shape/contract supplement with admitted containing-file body depth; not a runtime validator",
      });
    }
  }
}
for (const file of snapshot.files.filter((file) => /^sskr-wasm\/rust\/src\/.*\.rs$/u.test(file.path))) {
  const text = readFileSync(resolve(root, file.path), "utf8");
  for (const match of text.matchAll(/^(?:pub\s+)?fn\s+([A-Za-z_]\w*)\s*\(/gmu)) {
    if (!match[0].startsWith("pub ")) continue;
    supplements.push({ path: file.path, sha256: file.sha256,
      line: text.slice(0, match.index).split("\n").length, name: match[1], kind: "Rust public function",
      depth: "Native ABI/caller contract, admitted source review and current native/actual-WASM checks where executed; no optimized-erasure proof" });
  }
}
const inventory = JSON.parse(readFileSync(resolve(evidence, "public-operations.json"), "utf8"));
const rows = new Map(retained.fileRows.map((row) => [row.path, row]));
const operations = inventory.contracts.map((contract) => ({
  ...contract, sha256: rows.get(contract.path)?.sha256 ?? null,
  assessment: "Source/API contract assessment at the explicitly admitted file depth; current executions are separately identified.",
  fileAdmission: rows.get(contract.path)?.admission.decision ?? "unresolved",
  members: contract.members.map((member) => ({ ...member,
    depth: "Containing-file retained/targeted contract review, not independent execution of every member domain" })),
}));
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const entries = Object.entries(packageJson.exports).map(([name, entry]) => ({
  name, ...entry, method: "Pinned manifest and strict compilation/import-composition tests; runtime domains covered by separate suites",
}));
const cli = Object.entries(commandOptions).map(([command, options]) => ({
  command, flags: [...new Set(options.map(flagOf))], facts: COMMAND_FACTS[command],
  method: "Actual production command registry; help/allowed-option tests and real PTY separately executed",
}));
const result = {
  auditId: "AUD-032", capturedAtUtc: new Date().toISOString(),
  sourceFingerprint: snapshot.sourceFingerprint,
  inventorySha256: sha(readFileSync(resolve(evidence, "public-operations.json"))),
  admissionSha256: sha(readFileSync(resolve(evidence, "retained-context-admission.json"))),
  declarations: operations.length, publicMembers: operations.reduce((count, row) => count + row.members.length, 0),
  operations, supplements, packageEntries: entries, cli,
  extraCommands: ["help", "version", "-h", "--help", "-V", "--version"],
  limitations: [
    "Declaration/member counts include type-only declarations and re-exports; they are not independent callable-operation or executed-case counts.",
    "Inheritance expressions and callable/intersection shapes are explicitly recorded; no universal expansion of arbitrary host subclasses or computed future members is claimed.",
    "Generated ABI and Rust entries supplement TypeScript inventory. Every vendor private function is not a public program operation.",
  ],
};
writeFileSync(resolve(evidence, "operation-coverage.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ declarations: result.declarations, publicMembers: result.publicMembers,
  supplements: supplements.length, packageEntries: entries.length, commands: cli.length }));

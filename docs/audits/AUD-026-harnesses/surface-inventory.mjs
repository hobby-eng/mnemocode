/** Source-only inventories: declarations, imports, test cases and public operation contracts. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(resolve("../tmp/cancel-check/package.json"));
const ts = require("typescript");
const evidence = "docs/audits/AUD-026-evidence";
const inventory = JSON.parse(readFileSync(`${evidence}/file-inventory.json`, "utf8"));
const exported = (node) => node.modifiers?.some((part) => part.kind === ts.SyntaxKind.ExportKeyword);
const contracts = [];
const tests = [];
const graph = [];
for (const row of inventory.filter((row) => /\.(ts|mts|mjs|js)$/u.test(row.path) && !row.path.startsWith("docs/audits/"))) {
  const text = readFileSync(row.path, "utf8");
  const file = ts.createSourceFile(row.path, text, ts.ScriptTarget.Latest, true);
  const imports = [];
  const add = (node, kind, owner) => {
    contracts.push({ path: row.path, sha256: row.sha256, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      kind, owner, name: node.name?.getText(file) ?? "anonymous", signature: node.getText(file).split("{")[0].slice(0, 1200),
      documentation: node.jsDoc?.map((doc) => doc.getText(file)).join("\n") ?? "" });
  };
  function walk(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    }
    if (exported(node) && (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node))) {
      add(node, ts.isClassDeclaration(node) ? "class" : "function");
      if (ts.isClassDeclaration(node)) for (const member of node.members) {
        const hidden = member.name && ts.isPrivateIdentifier(member.name);
        if (!hidden && (ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isConstructorDeclaration(member)))
          add(member, "class-operation", node.name?.getText(file));
      }
    }
    if (row.path.startsWith("test/") && ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      if (/^(?:it|test|describe)(?:\.|\()/u.test(callee) || ["it", "test", "describe"].includes(callee)) {
        const first = node.arguments[0];
        tests.push({path: row.path, line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          callee, title: first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : first?.getText(file).slice(0, 300),
          parameterized: callee.includes("each"), skipped: callee.includes("skip")});
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(file);
  graph.push({ path: row.path, sha256: row.sha256, imports });
}
for (const [name, rows] of [["public-operations", contracts], ["test-declarations", tests], ["import-graph", graph]])
  writeFileSync(`${evidence}/${name}.json`, JSON.stringify(rows, null, 2) + "\n", {flag: "wx"});
console.log(JSON.stringify({typescriptApi: ts.version, publicContracts: contracts.length, testDeclarations: tests.length, sourceGraphs: graph.length}));

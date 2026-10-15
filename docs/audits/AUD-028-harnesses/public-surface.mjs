/** Static syntax inventory; no project module is imported or evaluated. */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const base = dirname(fileURLToPath(import.meta.url));
const root = resolve(base, "../../..");
const evidence = resolve(root, "docs/audits/AUD-028-evidence");
const ts = createRequire(resolve(root, "../tmp/cancel-check/package.json"))("typescript");
const inputs = JSON.parse(readFileSync(resolve(evidence, "snapshot.json"), "utf8")).files;
const modules = {};
const tests = [];
const inputMismatches = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const localTarget = (path, spec) => spec.startsWith(".")
  ? relative(root, resolve(root, dirname(path), spec)).replace(/\.js$/u, ".ts")
  : null;
const modifier = (node, kind) => node.modifiers?.some((item) => item.kind === kind) ?? false;
const listed = (node) => modifier(node, ts.SyntaxKind.ExportKeyword);
const hidden = (node) => (node.name && ts.isPrivateIdentifier(node.name)) || modifier(node, ts.SyntaxKind.PrivateKeyword) || modifier(node, ts.SyntaxKind.ProtectedKeyword);

for (const row of inputs) {
  if (!/\.(?:ts|mjs|js)$/u.test(row.path) || row.path.startsWith("docs/audits/")) continue;
  const text = readFileSync(resolve(root, row.path), "utf8");
  if (hash(text) !== row.sha256) inputMismatches.push(row.path);
  const file = ts.createSourceFile(row.path, text, ts.ScriptTarget.Latest, true);
  const line = (node) => file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const declarations = {};
  const imports = [];
  const exports = [];
  const calls = [];
  const add = (node, name, kind) => {
    const item = { name, kind, line: line(node), exportedDirectly: listed(node), signature: text.slice(node.getStart(file), node.body?.getStart(file) ?? node.end).slice(0, 1200) };
    if (node.heritageClauses) item.heritage = node.heritageClauses.map((clause) => clause.getText(file));
    if (ts.isInterfaceDeclaration(node)) item.interfaceMembers = node.members.map((member) => ({
      name: member.name?.getText(file) ?? "call/index signature", kind: ts.SyntaxKind[member.kind],
      line: line(member), signature: member.getText(file),
    }));
    if (ts.isClassDeclaration(node)) item.publicMembers = node.members.filter((member) => !hidden(member)).map((member) => ({
      name: ts.isConstructorDeclaration(member) ? "constructor" : member.name?.getText(file),
      kind: ts.SyntaxKind[member.kind], line: line(member),
      static: modifier(member, ts.SyntaxKind.StaticKeyword),
      signature: text.slice(member.getStart(file), member.body?.getStart(file) ?? member.end).slice(0, 1200),
    }));
    declarations[name] = item;
    if (listed(node)) exports.push({ name, local: name });
  };
  for (const statement of file.statements) {
    if (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (statement.name) add(statement, statement.name.getText(file), ts.SyntaxKind[statement.kind]);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const name = declaration.name.getText(file);
        declarations[name] = { name, kind: "VariableDeclaration", line: line(declaration), exportedDirectly: listed(statement), signature: declaration.getText(file).slice(0, 1200) };
        if (listed(statement)) exports.push({ name, local: name });
      }
    } else if (ts.isExportDeclaration(statement)) {
      const spec = statement.moduleSpecifier?.text;
      const target = spec ? localTarget(row.path, spec) : null;
      if (!statement.exportClause) exports.push({ star: true, target, spec, line: line(statement) });
      else if (ts.isNamedExports(statement.exportClause)) for (const entry of statement.exportClause.elements)
        exports.push({ name: entry.name.text, local: entry.propertyName?.text ?? entry.name.text, target, spec, typeOnly: statement.isTypeOnly || entry.isTypeOnly, line: line(entry) });
    } else if (ts.isImportDeclaration(statement)) {
      const names = [];
      if (statement.importClause?.name) names.push({ imported: "default", local: statement.importClause.name.text });
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const name of bindings.elements)
        names.push({ imported: name.propertyName?.text ?? name.name.text, local: name.name.text, typeOnly: name.isTypeOnly || statement.importClause.isTypeOnly });
      else if (bindings) names.push({ imported: "*", local: bindings.name.text });
      imports.push({ spec: statement.moduleSpecifier.text, target: localTarget(row.path, statement.moduleSpecifier.text), names, line: line(statement) });
    }
  }
  const walk = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(file);
      const args = node.arguments.map((argument) => argument.getText(file).slice(0, 240));
      calls.push({ line: line(node), callee: callee.slice(0, 280), arguments: args.slice(0, 4) });
      if (row.path.startsWith("test/") && /^(?:it|test|describe)(?:\.|$)/u.test(callee)) {
        const first = node.arguments[0];
        tests.push({ path: row.path, line: line(node), callee: callee.slice(0, 400), title: first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : first?.getText(file).slice(0, 400) });
      }
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]))
        imports.push({ spec: node.arguments[0].text, target: localTarget(row.path, node.arguments[0].text), dynamic: true, names: [], line: line(node) });
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  modules[row.path] = { sha256: hash(text), parseDiagnostics: file.parseDiagnostics.map((item) => ts.flattenDiagnosticMessageText(item.messageText, " ")), declarations, exports, imports, calls: row.path.startsWith("test/") ? calls : undefined };
}

const exportCache = new Map();
const resolveExports = (path, active = new Set()) => {
  if (exportCache.has(path)) return exportCache.get(path);
  if (active.has(path) || !modules[path]) return {};
  active = new Set([...active, path]);
  const output = {};
  const module = modules[path];
  for (const entry of module.exports) {
    if (entry.star) Object.assign(output, resolveExports(entry.target, active));
    else if (entry.target) {
      const found = resolveExports(entry.target, active)[entry.local];
      output[entry.name] = found ?? { unresolved: true, target: entry.target, symbol: entry.local };
    } else if (module.declarations[entry.local]) output[entry.name] = { path, symbol: entry.local };
    else {
      const imported = module.imports.flatMap((item) => item.names.map((name) => ({ ...name, target: item.target }))).find((name) => name.local === entry.local);
      output[entry.name] = imported ? resolveExports(imported.target, active)[imported.imported] ?? { unresolved: true, ...imported } : { unresolved: true, path, symbol: entry.local };
    }
  }
  exportCache.set(path, output);
  return output;
};
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const entrypoints = Object.fromEntries(Object.entries(manifest.exports).map(([name, entry]) => {
  const path = entry.import.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts");
  return [name, { path, exports: resolveExports(path) }];
}));
const operations = [];
for (const [specifier, entry] of Object.entries(entrypoints)) for (const [name, found] of Object.entries(entry.exports)) {
  const declaration = modules[found.path]?.declarations[found.symbol];
  const consumers = [];
  for (const [path, module] of Object.entries(modules)) for (const imported of module.imports) {
    if (!imported.target) continue;
    const exportMap = resolveExports(imported.target);
    for (const symbol of imported.names) {
      const candidate = exportMap[symbol.imported];
      if (candidate?.path === found.path && candidate?.symbol === found.symbol)
        consumers.push({ path, line: imported.line, importedAs: symbol.local, typeOnly: symbol.typeOnly ?? false });
    }
  }
  operations.push({ packageSpecifier: specifier, exportedName: name, ...found, declaration, consumers, coverage: "Syntax/import evidence only; consumer import does not establish execution or assertion coverage. Namespace/dynamic consumers are recorded in modules, not symbol-resolved here." });
}
const previous = { inputCount: inputs.length, files: inputs };
previous.lexicalModulesSuperseded = true;
delete previous.modules;
previous.checker = { type: "TypeScript syntax API", version: ts.version, retainedChecker: "tmp/cancel-check/node_modules/typescript", heapMiB: 64, noProjectImports: true };
previous.astModules = modules;
previous.publicOperations = operations;
previous.exactPackageEntrypoints = entrypoints;
previous.testDeclarations = tests;
previous.astSnapshotMismatches = inputMismatches;
writeFileSync(resolve(evidence, "public-surface.json"), JSON.stringify(previous, null, 2) + "\n");
const danger = /render|pdf|png|image|qr|self.?test|gallery|oracle|docker|build|toBuffer|toFile|\.run\b/iu;
writeFileSync(resolve(evidence, "test-call-inventory.txt"), Object.entries(modules).filter(([path]) => path.startsWith("test/") && path.endsWith(".test.ts")).map(([path, module]) => {
  const marked = module.calls.filter((call) => danger.test(call.callee + " " + call.arguments.join(" ")) && !/^(?:expect|it|test|describe)(?:\.|$)/u.test(call.callee));
  return path + "\n" + marked.map((call) => `  ${call.line}: ${call.callee}(${call.arguments.join(", ")})`).join("\n");
}).join("\n") + "\n");
console.log(JSON.stringify({typescript: ts.version, parsedModules: Object.keys(modules).length, parseDiagnostics: Object.entries(modules).filter(([, module]) => module.parseDiagnostics.length).map(([path, module]) => ({path, diagnostics: module.parseDiagnostics})), snapshotMismatches: inputMismatches, publicExportRows: operations.length, uniqueExportDefinitions: new Set(operations.map((item) => `${item.path}:${item.symbol}`)).size, unresolvedExports: operations.filter((item) => item.unresolved).map((item) => [item.packageSpecifier, item.exportedName]), testDeclarations: tests.length}));

if (inputMismatches.length || Object.values(modules).some((item) => item.parseDiagnostics.length) || operations.some((item) => item.unresolved)) process.exitCode = 1;

// Declaration and evidence inventory only; no AST or hash is treated as semantic proof.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const folder = "docs/audits/AUD-035-evidence";
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const save = (name, value) => writeFileSync(`${folder}/${name}`, JSON.stringify(value, null, 2) + "\n");
const snapshot = read(`${folder}/snapshot.json`);
const ts = createRequire(import.meta.url)(resolve("../tmp/cancel-check/node_modules/typescript"));
const declarations = [];
for (const file of snapshot.files.filter(({ path }) => /^(src|scripts)\/.*\.(ts|mjs)$/u.test(path))) {
  const text = readFileSync(file.path, "utf8");
  const ast = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true);
  if (ast.parseDiagnostics.length) throw new Error(`Metadata parser refused ${file.path}.`);
  for (const node of ast.statements) {
    if (!node.modifiers?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
      && !ts.isExportDeclaration(node)) continue;
    declarations.push({
      path: file.path, sha256: file.sha256,
      line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
      name: node.name?.getText(ast) ?? node.getText(ast).split("\n")[0],
      kind: ts.SyntaxKind[node.kind],
      members: ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
        ? node.members.filter((member) => !member.name || !ts.isPrivateIdentifier(member.name))
          .map((member) => ({
            name: member.name?.getText(ast) ?? "constructor",
            line: ast.getLineAndCharacterOfPosition(member.getStart(ast)).line + 1,
            directComment: Boolean(member.jsDoc?.length),
          })) : [],
      depth: "inventory-only; contracts are assessed at the separately recorded file/reviewer depth",
    });
  }
}
save("public-operations.json", {
  parserVersion: ts.version, purpose: "Metadata only; the pinned native TypeScript7 compiler supplies actual type checking.",
  declarationCount: declarations.length, declarations,
});
const before = read("docs/audits/AUD-033-evidence/remediation/initial-snapshot.json");
const old = new Map(before.files.map((file) => [file.path, file.sha256]));
const oldSource = new Map(snapshot.source.map((file) => [file.path, file.sha256]));
const priorDossiers = [];
for (const name of readdirSync("docs/audits/AUD-033-evidence/remediation"))
  if (/review.*\.json$/u.test(name)) {
    const path = `docs/audits/AUD-033-evidence/remediation/${name}`;
    priorDossiers.push({ path, sha256: sha(path), record: read(path) });
  }
const boundFiles = (value, found = []) => {
  if (value === null || typeof value !== "object") return found;
  if (typeof value.path === "string" && typeof value.sha256 === "string")
    found.push({ path: value.path, sha256: value.sha256 });
  for (const item of Object.values(value)) boundFiles(item, found);
  return found;
};
const admission = snapshot.source.map((file) => ({
  ...file,
  unchangedFromOriginalCoreScan: old.get(file.path) === file.sha256,
  exactScopedReviewBindings: priorDossiers.filter((dossier) =>
    boundFiles(dossier.record).some((item) => item.path === file.path && item.sha256 === file.sha256))
    .map(({ path, sha256 }) => ({ path, sha256 })),
  inheritedDepthOnly: true,
  context: "Current dependency manifests/lockfiles and original method/procedure identities are compared separately. A dossier binding is not automatically complete-body review; its actual acceptance scope and superseding reviews control admission.",
}));
save("semantic-admission.json", {
  sourceFingerprint: snapshot.sourceFingerprint,
  originalCoreScanSourceFingerprint: before.fingerprint,
  originalUnchangedFiles: admission.filter((item) => item.unchangedFromOriginalCoreScan).length,
  changedFiles: admission.filter((item) => !item.unchangedFromOriginalCoreScan),
  priorDossiers: priorDossiers.map(({ path, sha256 }) => ({ path, sha256 })),
  dependenciesUnchanged: ["package.json", "pnpm-lock.yaml", "sskr-wasm/rust/Cargo.toml", "sskr-wasm/rust/Cargo.lock"]
    .every((path) => old.get(path) === oldSource.get(path)),
  files: admission,
});
const canonicalPath = "docs/audits/AUD-033-evidence/arc002-2026-10-18/ARC002-CLOSURE-2026-10-18.json";
const canonical=read(canonicalPath);
const baseline=read("docs/audits/AUD-034-evidence/snapshot.json");
const oldHashes=new Map(baseline.source.map(row=>[row.path,row.sha256]));
const currentPins=read("sskr-wasm/integrity.json");
const rows=Object.entries(currentPins).map(([name,hash])=>({path:`sskr-wasm/${name}`,sha256:sha(`sskr-wasm/${name}`),expected:hash}));
if(rows.some(row=>row.sha256!==row.expected)) throw new Error("Canonical pin mismatch");
for(const row of canonical.canonical.generated) if(sha(row.path)!==row.sha256) throw new Error("Generated output mismatch");
const producer=snapshot.source.filter(row=>row.path.startsWith("sskr-wasm/") || ["Dockerfile.sskr","scripts/build-sskr-wasm.mjs","scripts/sskr-integrity.mjs"].includes(row.path));
if(producer.some(row=>oldHashes.get(row.path)!==row.sha256)) throw new Error("Producer differs from retained canonical context");
const receipts=canonical.checks.filter(row=>row.label.includes("canonical"));
for(const row of receipts){
 if(sha(row.evidence.receipt)!==row.evidence.receiptSha256 || sha(row.evidence.log)!==row.evidence.logSha256) throw new Error("Retained canonical evidence mismatch");
}
save("canonical-admission.json",{record:canonicalPath,sha256:sha(canonicalPath),kind:"Retained approved Oct18 canonical write and separate fresh-final-stage comparison; not newly executed by AUD035",producer,inputsAndPins:rows,generated:canonical.canonical.generated,receipts,qualification:canonical.canonical.qualification,resourceQualification:canonical.canonical.resources});
console.log(JSON.stringify({declarations:declarations.length,canonicalPins:rows.length,producerFiles:producer.length,changedFromInitialScan:admission.filter(row=>!row.unchangedFromOriginalCoreScan).length}));

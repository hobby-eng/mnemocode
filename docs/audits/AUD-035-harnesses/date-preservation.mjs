// Compare syntax tokens rather than formatting, test names or removed skip registration.
import {readFileSync,writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve} from "node:path";
import {strict as assert} from "node:assert";
const ts=createRequire(import.meta.url)(resolve("../tmp/cancel-check/node_modules/typescript"));
const old=JSON.parse(readFileSync("docs/audits/AUD-034-evidence/date-gap-2026-10-18/before.json","utf8"));
const current=readFileSync("test/date-recovery-dedupe.test.ts","utf8");
function bodies(text){
 const ast=ts.createSourceFile("source.ts",text,ts.ScriptTarget.Latest,true),result=[];
 const token=(node)=>{const tokens=[];const collect=item=>{const children=item.getChildren(ast);if(children.length)children.forEach(collect);else if(item.kind!==ts.SyntaxKind.EndOfFileToken)tokens.push([item.kind,item.getText(ast)]);};collect(node);return tokens;};
 function visit(node){
  const registration=ts.isArrowFunction(node)&&ts.isCallExpression(node.parent)&&node.parent.expression.getText(ast)==="describe";
  if((ts.isFunctionDeclaration(node)||ts.isArrowFunction(node))&&node.body&&!registration) result.push({kind:ts.SyntaxKind[node.kind],body:token(node.body)});
  if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==="CASES")result.push({fixtures:token(node.initializer)});
  ts.forEachChild(node,visit);
 }visit(ast);return result;
}
const before=bodies(old.testBefore),after=bodies(current);
assert.ok(JSON.stringify(after)===JSON.stringify(before), "Function/test callback bodies or fixture tokens changed");
assert.ok(!/it\.skip|it\.skipIf/u.test(current));
const result={file:"test/date-recovery-dedupe.test.ts",parserVersion:ts.version,unchangedFunctionAndCallbackBodies:true,unchangedFixtureTable:true,comparedItems:before.length,skipRegistrationAbsent:true,normalTimeout:"vitest.config.ts remains60000ms; no timeout override",qualification:"Test-registration titles/skip call removed; production/oracle/assertion callback bodies and fixture tokens are exact. Fresh execution remains a separate evidence record."};
writeFileSync("docs/audits/AUD-035-evidence/date-preservation.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));

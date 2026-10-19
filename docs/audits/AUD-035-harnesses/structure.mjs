// Structural inventory is a lead for semantic review, not a finding by itself.
import {readFileSync,writeFileSync} from "node:fs";
import {createRequire} from "node:module";
import {resolve,dirname,relative} from "node:path";
const root=process.cwd(), folder="docs/audits/AUD-035-evidence";
const snapshot=JSON.parse(readFileSync(`${folder}/snapshot.json`,"utf8"));
const ts=createRequire(import.meta.url)(resolve("../tmp/cancel-check/node_modules/typescript"));
const paths=snapshot.source.map(row=>row.path).filter(path=>/^src\/.*\.ts$/u.test(path));
const pathSet=new Set(paths), edges=[],functions=[], network=[];
for(const path of paths){
 const text=readFileSync(path,"utf8"),ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true);
 function visit(node){
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
   const spec=node.moduleSpecifier.text;
   if(spec.startsWith(".")){
    const target=relative(root,resolve(dirname(path),spec.replace(/\.js$/u,".ts")));
    if(pathSet.has(target)) edges.push({from:path,to:target,typeOnly:Boolean(node.importClause?.isTypeOnly||node.isTypeOnly),text:node.getText(ast).slice(0,200)});
   }
  }
  if((ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isArrowFunction(node))&&node.body){
   const start=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,end=ast.getLineAndCharacterOfPosition(node.end).line+1;
   if(end-start>=100)functions.push({path,start,end,name:node.name?.getText(ast)??"anonymous",lines:end-start+1});
  }
  if(ts.isCallExpression(node)&& /^(fetch|eval|Function|WebSocket|Worker|Math\.random|console\.(debug|trace))$/u.test(node.expression.getText(ast)))network.push({path,line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,call:node.expression.getText(ast)});
  ts.forEachChild(node,visit);
 }
 visit(ast);
}
const adjacency=new Map(paths.map(path=>[path,[]]));for(const edge of edges.filter(row=>!row.typeOnly))adjacency.get(edge.from).push(edge.to);
let next=0;const indices=new Map(),low=new Map(),stack=[],active=new Set(),cycles=[];
function connect(path){indices.set(path,next);low.set(path,next++);stack.push(path);active.add(path);for(const target of adjacency.get(path)){
 if(!indices.has(target)){connect(target);low.set(path,Math.min(low.get(path),low.get(target)));}else if(active.has(target))low.set(path,Math.min(low.get(path),indices.get(target)));}
 if(low.get(path)===indices.get(path)){const group=[];let item;do{item=stack.pop();active.delete(item);group.push(item);}while(item!==path);if(group.length>1)cycles.push(group);}
}
for(const path of paths)if(!indices.has(path))connect(path);
const result={sourceFingerprint:snapshot.sourceFingerprint,parserVersion:ts.version,moduleCount:paths.length,edgeCount:edges.length,edges,staticImportCycles:cycles,functionsOver100: functions,securityCallLeads:network,qualification:"Static first-party imports/re-exports only. Named type-only specifiers/dynamic imports/conditional reachability and external packages require semantic review. No dead-code or defect verdict follows automatically."};
writeFileSync(`${folder}/structure.json`,JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({modules:paths.length,edges:edges.length,cycles,functionsOver100:functions,securityCallLeads:network}));

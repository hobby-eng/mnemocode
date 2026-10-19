// Root resolution/bin links complement the separately hashed package payloads.
import{readdirSync,lstatSync,readFileSync,readlinkSync,writeFileSync}from"node:fs";
import{createHash}from"node:crypto";
import{strict as assert}from"node:assert";
const mode=process.argv[2];assert.ok(["before","after"].includes(mode));const rows=[];
function walk(folder){for(const name of readdirSync(folder).sort()){
 if([".pnpm",".cache",".vite",".modules.yaml",".pnpm-workspace-state-v1.json"].includes(name))continue;
 const path=`${folder}/${name}`,info=lstatSync(path);
 if(info.isSymbolicLink())rows.push({path,link:readlinkSync(path)});
 else if(info.isDirectory())walk(path);
 else if(info.isFile())rows.push({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex")});
}}
walk("node_modules");
writeFileSync(`docs/audits/AUD-035-evidence/dependency-links-${mode}.json`,JSON.stringify({rows},null,2)+"\n",{flag:"wx"});
if(mode==="after")assert.deepEqual(rows,JSON.parse(readFileSync("docs/audits/AUD-035-evidence/dependency-links-before.json","utf8")).rows);
console.log(JSON.stringify({mode,linksAndWrappers:rows.length,unchanged:mode==="after"}));

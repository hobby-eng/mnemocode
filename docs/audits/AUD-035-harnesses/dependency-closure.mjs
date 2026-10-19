// Local installed-package payload identity before/after a frozen offline install.
import {readdirSync,lstatSync,readFileSync,readlinkSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {strict as assert} from "node:assert";
const mode=process.argv[2];assert.ok(["before","after"].includes(mode));
const root="node_modules/.pnpm",rows=[];
function walk(folder){for(const name of readdirSync(folder).sort()){
 const path=join(folder,name),info=lstatSync(path);
 if(info.isSymbolicLink())rows.push({path,link:readlinkSync(path)});
 else if(info.isDirectory())walk(path);
 else if(info.isFile())rows.push({path,sha256:createHash("sha256").update(readFileSync(path)).digest("hex"),bytes:info.size});
}}
for(const name of readdirSync(root).sort())if(lstatSync(join(root,name)).isDirectory()&&name!=="node_modules")walk(join(root,name));
const fingerprint=createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const destination=`docs/audits/AUD-035-evidence/dependencies-${mode}.json`;
writeFileSync(destination,JSON.stringify({scope:"Installed content-addressed package payloads and symlinks; manager metadata/cache excluded",fingerprint,entries:rows.length,rows},null,2)+"\n",{flag:"wx"});
if(mode==="after"){
 const before=JSON.parse(readFileSync("docs/audits/AUD-035-evidence/dependencies-before.json","utf8"));
 assert.equal(fingerprint,before.fingerprint,"Installed package payload changed; prior test results require context reconciliation");
}
console.log(JSON.stringify({mode,fingerprint,entries:rows.length}));

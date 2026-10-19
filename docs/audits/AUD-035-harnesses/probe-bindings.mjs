// Hash exact harness/source/dist/native context around a tiny read-only public-data probe.
import {createHash} from "node:crypto";
import {readFileSync,readdirSync,lstatSync,writeFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {strict as assert} from "node:assert";
const [label,...command]=process.argv.slice(2);assert.ok(/^[a-z0-9-]+$/u.test(label??"")&&command.length>0);
const digest=path=>createHash("sha256").update(readFileSync(path)).digest("hex");
function context(){
 const names=JSON.parse(readFileSync("docs/audits/AUD-035-evidence/snapshot.json","utf8")).source.map(row=>row.path);
 function walk(folder){for(const name of readdirSync(folder).sort()){const path=`${folder}/${name}`;if(lstatSync(path).isDirectory())walk(path);else names.push(path);}}
 walk("dist");walk("docs/audits/AUD-035-harnesses");
 return [...new Set(names)].sort().map(path=>({path,sha256:digest(path)}));
}
const before=context(),result=spawnSync(command[0],command.slice(1),{stdio:"inherit"}),after=context();
if(result.error)throw result.error;assert.deepEqual(after,before,"Probe context changed");
writeFileSync(`docs/audits/AUD-035-evidence/${label}.artifact-context.json`,JSON.stringify({label,command,exitCode:result.status,sourceDistHarnessNativeInputs:before,beforeAfterIdentical:true,fingerprint:createHash("sha256").update(JSON.stringify(before)).digest("hex"),node:process.version,qualification:"Execution-time first-party source, compiled dist, audit harnesses and native inputs/outputs; installed external-package payloads separately captured for frozen-install admission."},null,2)+"\n",{flag:"wx"});
process.exitCode=result.status??1;

// Public operation timing includes process launch, protection relaunch and startup checks.
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
const milliseconds=[];
for(let i=0;i<5;i++){
 const start=performance.now();
 const result=execFileSync(process.execPath,["dist/mnemocode.js","table","--index","1"],{encoding:"utf8",env:{...process.env,NO_COLOR:"1"}});
 if(!result.includes("abandon")) throw new Error("The public lookup failed");
 milliseconds.push(performance.now()-start);
}
const result={samples:5,command:["node","dist/mnemocode.js","table","--index","1"],milliseconds,maximum:Math.max(...milliseconds),median:[...milliseconds].sort((a,b)=>a-b)[2],qualification:"Five fresh processes on this running Linux machine with warm filesystem cache; includes launch/protection and KATs, not a cross-platform timing guarantee or isolated check duration."};
writeFileSync("docs/audits/AUD-035-evidence/startup.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(result));

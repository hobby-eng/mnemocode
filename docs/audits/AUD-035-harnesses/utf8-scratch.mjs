// Observe real validation allocations on valid and refused public UTF-8 sequences.
import { strict as assert } from "node:assert";
import { writeFileSync } from "node:fs";
const { validCharacters } = await import("../../../src/cli/utf8.ts");
const original=Uint8Array.from;
const observations=[];
for(const input of [[0xE6,0xB8,0xAC],[0xED,0xA0,0x80]]) {
 const allocations=[];
 Uint8Array.from=function(...args){const bytes=Reflect.apply(original,this,args);allocations.push(bytes);return bytes;};
 try{
  let index=0;
  const reader=validCharacters(async()=>input[index++]);
  const output=[];
  for(let byte=await reader.next();byte!==undefined;byte=await reader.next()) output.push(byte);
  assert.equal(allocations.length,1);
  observations.push({input,output,leftOut:reader.leftOut(),scratch:Array.from(allocations[0]),allZero:allocations[0].every(byte=>byte===0)});
 } finally {Uint8Array.from=original; for(const bytes of allocations)bytes.fill(0);}
}
assert.deepEqual(observations[0].output,observations[0].input);
assert.deepEqual(observations[1].output,[]);
writeFileSync(process.argv[2]??"docs/audits/AUD-035-evidence/utf8-scratch.json",JSON.stringify(observations,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(observations));

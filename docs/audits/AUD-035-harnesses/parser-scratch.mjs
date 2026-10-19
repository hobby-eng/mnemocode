// Transparent observer of actual parser results: original behavior is invoked unchanged.
import {strict as assert} from "node:assert";
import {writeFileSync} from "node:fs";
import {EncodedForm} from "../../../dist/core/encoded-form.js";
import {EncodedBackup} from "../../../dist/core/encoded-backup.js";
import {detectInputFormats} from "../../../dist/core/representations.js";
const original=EncodedForm.prototype.read,allocations=[];
EncodedForm.prototype.read=function(...args){const result=Reflect.apply(original,this,args);allocations.push(result);return result;};
const result={};
try{
 const text="1 ".repeat(11)+"4",expected="abandon ".repeat(11)+"about";
 const owner=EncodedBackup.read(text,"indexes","direct");
 assert.equal(owner.decode([]).recoveredMnemonic,expected);
 const captured=allocations.at(-1);assert.equal(captured.at(-1),3);
 result.read={correctResult:true,parserArrayAfterReturn:[...captured]};owner.wipe();
 result.read.parserArrayAfterOwnerWipe=[...captured];
 const start=allocations.length,formats=detectInputFormats(text);
 result.detection={formats,parserArrays:allocations.slice(start).map(array=>[...array])};
 assert.ok(formats.includes("indexes"));assert.ok(result.detection.parserArrays.some(array=>array.at(-1)===3));
 const borrowed=Array(12).fill(0);borrowed[11]=3;using independent=EncodedBackup.of(borrowed,"indexes","direct");independent.wipe();
 assert.equal(borrowed[11],3);result.borrowedOfControl="Caller input remains live and must not be wiped by of()";borrowed.fill(0);
 result.qualification="Actual fresh parser number arrays remain nonzero after their private work ends; observer restores method and clears public fixtures. No heap exploit or universal erasure claim.";
}finally{EncodedForm.prototype.read=original;for(const array of allocations)array.fill(0);}
writeFileSync(process.argv[2]??"docs/audits/AUD-035-evidence/parser-scratch.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));

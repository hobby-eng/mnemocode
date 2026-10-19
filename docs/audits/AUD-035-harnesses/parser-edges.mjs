// Deliberate copy of the transparent observer in parser-scratch: this frozen edge reproduction
// stays independently runnable, preserving that probe's original reviewed bytes and results.
import {strict as assert} from "node:assert";
import {writeFileSync} from "node:fs";
import {EncodedForm} from "../../../dist/core/encoded-form.js";
import {EncodedBackup} from "../../../dist/core/encoded-backup.js";
import {detectInputFormats} from "../../../dist/core/representations.js";
const original=EncodedForm.prototype.read,arrays=[],result={};
EncodedForm.prototype.read=function(...args){const value=Reflect.apply(original,this,args);arrays.push(value);return value;};
try{
 const wrongCount="1 ".repeat(10)+"4";
 try{using owner=EncodedBackup.read(wrongCount,"indexes","direct");throw new Error("Wrong count was accepted");}
 catch(error){assert.equal(error.code,"core.encoded-backup.encoded-seed-phrase");result.constructorRefusal={code:error.code,ownedParserArray:[...arrays.at(-1)]};}
 const start=arrays.length,formats=detectInputFormats(wrongCount);assert.deepEqual(formats,[]);
 result.wrongCountDetection={formats,ownedParserArrays:arrays.slice(start).map(value=>[...value])};
 assert.equal(result.constructorRefusal.ownedParserArray.at(-1),3);
 assert.ok(result.wrongCountDetection.ownedParserArrays.some(value=>value.at(-1)===3));
}finally{EncodedForm.prototype.read=original;for(const value of arrays)value.fill(0);}
writeFileSync(process.argv[2]??"docs/audits/AUD-035-evidence/parser-edges.json",JSON.stringify(result,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(result));

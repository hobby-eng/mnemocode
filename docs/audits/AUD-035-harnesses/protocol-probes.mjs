// Public vectors through actual production boundaries; only the external host error is faulted.
import { strict as assert } from "node:assert";
import {writeFileSync} from "node:fs";
import {sskrEngine} from "../../../dist/sskr/runtime.js";
import {ShareInput} from "../../../dist/sskr/share-input.js";
import {ShareCombineRefusalError} from "../../../dist/sskr/share-platform.js";
import {nodeSharePlatform} from "../../../dist/sskr/share-platform-node.js";
import {sskrSetVector} from "../../../dist/sskr/known-answers.js";
import {planShareRepair} from "../../../dist/sskr/shares.js";
import {SHARE_UNITS} from "../../../dist/sskr/share-units.js";
import {crc32} from "../../../dist/sskr/checksum.js";
import {urToTransport,transportToUr,shareInfo} from "../../../dist/sskr/transport.js";
const engine=await sskrEngine(),results={};
const fault=Object.assign(new Error("Synthetic host unavailable"),{code:"sskr.runtime.unavailable"});
for(const mode of ["selective-operational","all-operational","subset-operational"]){
 using input=new ShareInput({decodeEntry:"The Decode tab"});input.add(sskrSetVector.shares);
 let calls=0;
 const host={combineShares:async(records)=>{calls++;
  if(mode==="all-operational" || (mode==="selective-operational"&&records.includes(sskrSetVector.shares[0])) || (mode==="subset-operational"&&calls>1))throw fault;
  if(mode==="subset-operational")throw new ShareCombineRefusalError();
  return nodeSharePlatform.combineShares(records);
 }};
 let outcome;try{outcome=await input.restoreComplete(host);results[mode]={resolved:true,outcome,calls};}catch(error){results[mode]={resolved:false,sameFault:error===fault,code:error.code,calls};}
}
assert.equal(results["selective-operational"].outcome.outcome.trouble.kind,"odd");
assert.equal(results["selective-operational"].outcome.outcome.trouble.place,1);
const recalc=bytes=>{new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).setUint32(bytes.length-4,crc32(bytes.subarray(0,-4)));return bytes;};
const broken=urToTransport(sskrSetVector.shares[0]);
try{
 broken[6]^=1;recalc(broken);
 using input=new ShareInput({decodeEntry:"The Decode tab"});input.add([transportToUr(broken),...sskrSetVector.shares.slice(1)]);
 const diagnosed=await input.restoreComplete(nodeSharePlatform);assert.equal(diagnosed.outcome.trouble.kind,"odd");assert.equal(diagnosed.outcome.trouble.place,1);results.badShareControl=diagnosed;
}finally{broken.fill(0);}
for(const groupIndex of [0,1]){
 const payload=Uint8Array.from([0,0,0,groupIndex<<4,0,...Array(16).fill(0x24)]);
 const transport=new Uint8Array(1+payload.length+4);transport[0]=0x40+payload.length;transport.set(payload,1);recalc(transport);
 const record=SHARE_UNITS.ur.text(Array.from(transport));
 let highLevelCode;try{shareInfo(transport);}catch(error){highLevelCode=error.code;}
 const restored=engine.recover_sskr_shares(record);
 try{assert.deepEqual(Array.from(restored),Array(16).fill(0x24));results[`group-${groupIndex}`]={rawAccepted:true,checkedAccepted:true,highLevelCode,secretIsExpectedPublicFixture:true};}
 finally{payload.fill(0);transport.fill(0);restored.fill(0);}
}
const healthy=engine.recover_sskr_shares(sskrSetVector.shares.slice(0,2).join("\n"));
try{assert.equal(Buffer.from(healthy).toString("hex"),sskrSetVector.entropy);}finally{healthy.fill(0);}
const modified=sskrSetVector.shares.slice(0,2).map(record=>{
 const bytes=urToTransport(record);try{
  // Definite short CBOR byte string: one head byte, five metadata bytes, then secret values.
  assert.equal(bytes[0],0x55);const x=bytes[5]&15;bytes[6]^=x^0xff;recalc(bytes);return transportToUr(bytes);
 }finally{bytes.fill(0);}
});
try{const unexpected=engine.recover_sskr_shares(modified.join("\n"));unexpected.fill(0);throw new Error("The forced digest mismatch was accepted");}
catch(error){assert.equal(error.code,"sskr.engine.combine");results.digestFailure={refused:true,code:error.code,healthyPublicEntropyMatched:true,construction:"Add g(X)=X XOR255 to first byte at ordinary member indexes0,1. Secret at255 unchanged; digest byte at254 flips1. Source proves abandoned innerVec; no physical freed-memory observation claimed."};}
const abort=new AbortController();abort.abort(new Error("Synthetic stop"));
using plan=await planShareRepair(sskrSetVector.shares,{signal:abort.signal});
assert.equal(plan.assessment.verdict,"stopped");results.wrapperCancellation={resolved:true,verdict:plan.assessment.verdict};
writeFileSync(process.argv[2]??"docs/audits/AUD-035-evidence/protocol-probes.json",JSON.stringify(results,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify(results));

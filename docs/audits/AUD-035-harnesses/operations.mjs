// Supported capability/entry inventory joined to actual contracts, review depth and test evidence.
import{readFileSync,writeFileSync,existsSync}from"node:fs";
const E="docs/audits/AUD-035-evidence",read=p=>JSON.parse(readFileSync(p,"utf8"));
const pkg=read("package.json"),files=read(`${E}/file-coverage.json`).files;
const groups=[
 ["composition","Node compatibility compositions; individual parts remain directly importable","index|cards|core.ts"],
 ["word-table","English/Traditional Chinese tables, indexes, Unicode codes and checked word lookup","word-table|words|encoded-form"],
 ["backup","Direct/Seedshift/legacy modes, MNC1 read/check/re-encode, borrowed versus owned lifetime","backup|masking|re-encoding|encoded-form"],
 ["dates","Known/pattern dates, complete and stopped date searches, bounded deduplication","(?:^|/)date[^/]*|search-turns"],
 ["candidates","Missing words/codes, limits, wallet selection and owned candidate results","candidates|missing-codes|word-hints"],
 ["candidate-file","Bounded candidate-list schema, admission and file ownership","candidate-list|candidate-file"],
 ["candidate-cipher","Age recipient/password/identity encryption, authentication and lazy gate/retry","candidate-encryption"],
 ["wallet","BIP39 seed/passphrase, fingerprints, selected public wallet evidence and bounded derivation","master-fingerprint|wallet-evidence|coin-address-evidence"],
 ["coins","All supported families/networks/address profiles and isolated-family builds","coins|bitcoin-evidence"],
 ["png","PNG size/bit-depth/inflation admission and QR read/write","png|qr-input|qr-export"],
 ["share-transport","Six share forms, metadata/count/checksum/encoding admission","transport|share-input|share-platform"],
 ["share-complete","Creation, threshold/group/surplus consistency, exact host refusal classification","split|share-set|complete-shares|sskr-share"],
 ["share-repair","Single/joint repair, marked forms/free bits, search budgets/cancellation and ownership","repair|joint|share-restore|share-unmasking"],
 ["render","Business/material layouts, decoys, QR consistency, separate cards and output images","card|business|material|palette|render|image-export"],
 ["drawing","PDF-to-drawing operations, finite operator set, image ownership and transfer","card-drawing"],
 ["heirs","Recovery/keeping instructions and host route descriptions","heir|keeping"],
 ["self-tests","Feature-local KATs, refused controls, startup versus requested full suite","self-test|known-answers"],
 ["files","Exclusive private output, nonoverlap, retries, cleanup and redirected streams","private-file|output-path|save-retry|output-saving"],
 ["process","CLI dispatch/permissions, local OS hardening and terminal/input mechanics","protection|sandbox|terminal|input|menu|arguments"]
].map(([id,contract,pattern])=>({id,contract,pattern}));
const groupFor=path=>{
 if(/(?:^|\/)(?:self-test|known-answers|[^/]+-self-test)\.ts$/u.test(path))return"self-tests";
 if(path.startsWith("src/core/coins/"))return"coins";
 const entries={
  composition:["src/index.ts","src/sskr/index.ts"],
  render:["src/cards.ts","src/export/card-preview.ts","src/export/platform.ts","src/export/card-renderer.ts","src/export/card-copy.ts","src/export/sskr-render.ts","src/export/document-formats.ts"],
  wallet:["src/core/master-fingerprint.ts","src/core/coin-address-evidence.ts","src/core/wallet-evidence.ts"],
  coins:["src/core/coins.ts"],
  backup:["src/core/masking.ts","src/core/encoded-backup.ts","src/core/backup-reading.ts","src/core/re-encoding.ts","src/core/backup-options.ts","src/core/backup-check.ts"],
  png:["src/core/png-admission.ts"],
  candidates:["src/core/missing-codes.ts","src/core/missing-codes-search.ts","src/core/candidates.ts"],
  dates:["src/core/date-search.ts"],
  "candidate-file":["src/core/candidate-list.ts","src/core/candidate-list-writer.ts","src/core/candidate-file-admission.ts"],
  "candidate-cipher":["src/core/candidate-encryption.ts"],
  "share-transport":["src/sskr/share-platform.ts","src/sskr/transport.ts"],
  "share-complete":["src/sskr/split.ts","src/sskr/share-set.ts","src/sskr/share-input.ts"],
  "share-repair":["src/sskr/joint-repair.ts","src/sskr/repair-report.ts","src/sskr/share-unmasking.ts","src/sskr/share-restore.ts"],
  heirs:["src/export/heir-sheet.ts","src/export/sskr-keeping-text.ts","src/export/heir-sheet-text.ts"],
  drawing:["src/export/card-drawing.ts"],
  "word-table":["src/core/word-table.ts","src/core/encoded-form.ts"]
 };
 const found=Object.entries(entries).filter(([,paths])=>paths.includes(path));
 if(found.length!==1)throw new Error(`Unreviewed/ambiguous package contract: ${path}`);
 return found[0][0];
};
const universe=read(`${E}/test-universe.json`).map(row=>row.file.replace(`${process.cwd()}/`,""));
const packages=Object.entries(pkg.exports).map(([entry,targets])=>{
 const source=targets.import.replace(/^\.\/dist\//u,"src/").replace(/\.js$/u,".ts");
 if(!existsSync(targets.import)||!existsSync(targets.types))throw new Error(`Missing built entry ${entry}`);
 const group=groupFor(source),definition=groups.find(row=>row.id===group),ledger=files.find(row=>row.path===source);
 return{entry,targets,source,group,contract:definition.contract,bodyAndCallerEvidence:ledger?.currentAssessments??[],retained:ledger?.retained??null,nearestTestFiles:universe.filter(path=>new RegExp(definition.pattern,"u").test(path)),status:"contract/source and local regression scope recorded; not every parameter combination or external host executed"};
});
const commandFiles={encode:"encode-command",decode:"decode-command","re-encode":"re-encode-command","recover-date":"recover-date-command","recover-word":"recover-word-command","sskr-split":"sskr-split-command","sskr-combine":"sskr-restore-command","sskr-export":"sskr-export-command",preview:"preview-command",table:"table-command","self-test":"self-test"};
const commands=Object.entries(commandFiles).map(([name,file])=>({name,source:`src/cli/${file}.ts`,contract:"Same dispatcher for menu/options; all valid nonsecret selectors advertised, raw material argv refused, bounded file/private input, cancellation result and cleanup preserved",dimensions:"Modes/forms/word lengths, dates/patterns/quorum, input source, evidence and output choices where supported; no claim of their full Cartesian product",runtime:"Actual default tests, source CLI PTY and standalone executable checks; external Windows/macOS not executed"}));
const native=["create_sskr_shares","create_sskr_shares_formatted","recover_sskr_shares","recover_sskr_shares_formatted"].map(name=>({name,source:"sskr-wasm/rust/src/lib.rs",contract:"Checked numeric/byte/text boundary, native safe errors and owned results; formatted entries cover supported encoding codes",evidence:"Current source/review, native tests, known answers and actual raw/checked runtime probes",openFindings:name.startsWith("recover")?["AUD-035-API002","AUD-035-SEC001"]:[],qualification:"Both default/formatted APIs are represented; malformed-group/digest probes execute the default recovery path and common native combine body, not every raw encoding combination"}));
const result={auditId:"AUD-035",groups,packageEntries:packages,commands,native,counts:{packageEntries:packages.length,commands:commands.length,nativeFunctions:native.length},limitations:["1978 declarations include types/constants/reexports and are not1978 executed operations.","Grouped operation contracts supplement that exact declaration/member inventory; per-file ranges and full test universe remain separately bound.","Successful local checks do not close the specific findings, every theoretical recovery geometry, browser host intake or portable acceptance."]};
writeFileSync(`${E}/operation-coverage.json`,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result.counts));

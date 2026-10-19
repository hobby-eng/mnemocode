// Every canonical CHECK and rule receives an explicit scoped disposition.
import{readFileSync,writeFileSync,existsSync}from"node:fs";
const E="docs/audits/AUD-035-evidence",read=p=>JSON.parse(readFileSync(p,"utf8"));
const required=["frozen-install","rust-tests-pinned","linux-build","linux-acceptance","executable-terminal","startup-retry","card-output","dependency-audit"];
const complete=required.every(label=>existsSync(`${E}/${label}.command.json`)&&read(`${E}/${label}.command.json`).exitCode===0);
const decisions={
"CHECK-SEC-001":["failed","Owned secret types/caller roles are source-reviewed; four remaining scratch lifetimes are reproduced under AUD029SEC001. No spending/key correctness break is established."],
"CHECK-SEC-002":["blocked","Actual Linux permissions/kernel hardening passes local self-test/PTY. Current external host/browser and Windows/macOS enforcement acceptance is not available."],
"CHECK-SEC-003":["passed","First-party runtime uses no network; dependency/host seams, CLI permission drops and actual Linux sandbox checks reviewed. Audit-only network advisory/CI reads are separate."],
"CHECK-SEC-004":["passed","OS/host cryptographic randomness, established BIP39/HD/age/SSKR primitives, authentication/known answers and refusal controls checked at recorded source/runtime scope."],
"CHECK-SEC-005":["failed","First-party scratch and the pinned bc-shamir failed-digest allocation have missing explicit cleanup. Corrected Copilot file-close path remains verified; immutable/runtime copies are qualified."],
"CHECK-SEC-006":["not-applicable","Standalone checkout has no browser page, DOM persistence, storage or CSP to execute. Library host acceptance is separately blocked; no browser assurance is inferred."],
"CHECK-SEC-007":["passed","Input/PNG/word/share/search bounds, nonoverlap/nonreplacement and finite private pages reviewed/tested. Raw-engine metadata exception is reported under API004, not concealed by upper guards."],
"CHECK-FUN-001":["passed","All five BIP39 lengths, English/Traditional Chinese mapping, entropy/checksum/tail cases, Unicode representations and standard seed semantics covered by source, independent public vectors and fresh suite."],
"CHECK-FUN-002":["passed","Every authored coin family/profile and isolated feature self-test read; selected deterministic public derivation/address/network/path checks pass. No live wallet/fund operation used."],
"CHECK-FUN-003":["not-applicable","MnemoCode exposes no BIP85/BIP38/message-signing/Silent-Payment operations; no such guarantee is claimed."],
"CHECK-FUN-004":["not-applicable","No general descriptor/Miniscript/multisig operation is exposed. Address script construction within wallet evidence is covered under FUN002."],
"CHECK-FUN-005":["not-applicable","No transaction construction/signing/broadcast or PSBT import/export exists in the actual operation inventory."],
"CHECK-FUN-006":["passed","Direct/masked/legacy backup and six share transports, grouped/quorum/surplus/missing-code recovery, cancellation and candidate bounds receive fresh tests and scoped source review. Specific native/API failures remain findings; hidden-direction completeness is an unconfirmed hypothesis."],
"CHECK-FUN-007":["not-applicable","No connected provider/discovery/history/proof/accounting feature exists; selected offline wallet checks do not query a chain."],
"CHECK-API-001":["failed","Actual host/dependency contracts were traced. ShareInput still converts operational combiner failures to share trouble (original AUD033API003), despite the corrected direct/joint seam."],
"CHECK-API-002":["passed","Live/disposed owners, concurrent awaited handoff, stopped search/cancel outcomes and raw terminal state have source/regression coverage at local scope; no complete external-browser lifecycle acceptance is claimed."],
"CHECK-API-003":["not-applicable","No monetary/accounting public export exists. Mnemonic/share/candidate schemas and exact values belong to API004."],
"CHECK-API-004":["failed","Real interoperability/QR/card checks run, but raw and checked native recovery accept an invalid group index rejected by high-level JS. Documented wrapper cancellation also needs correction."],
"CHECK-BLD-001":["passed","Pinned manifest/lock/toolchains, 78 built package entry pairs, static imports and CLI/SEA protection flags checked; no source dependency on sibling projects."],
"CHECK-BLD-002":["blocked","Full Linux204-file suite and representative native/CLI operations executed. Current Windows/macOS matrix and complete current browser-host intake are not executed."],
"CHECK-BLD-003":["passed","Frozen offline install preserves active package payload/root-link identity while pruning only obsolete unreachable virtual-store groups (original whole-store comparison retained); exact pins/lock/license/provenance reviewed. npm and fresh RustSec known-vulnerability scans are recorded; paste unmaintained warning remains informational."],
"CHECK-BLD-004":["passed","All26 current producer inputs,22pins and4generated files match qualified retained Oct18 canonical write/separate final-stage comparison. No new Docker build, cold/offline whole-build or independent-machine claim."],
"CHECK-BLD-005":["blocked","Fresh Linux build/empty-folder/PTY and package acceptance are local evidence. Dirty source has no current committed cross-platform CI/attestation/signature/release acceptance; no tag/dispatch/publication performed."],
"CHECK-UI-001":["passed","Actual PDF/PNG/QR output round trips and selected raster visual review recorded; no physical-print, every-pixel/glyph or all-platform claim."],
"CHECK-UI-002":["passed","Actual Linux terminal tests cover navigation/retry/private pages/short screens/cancellation and independent input/output channels; default test assertions retained."],
"CHECK-UI-003":["passed","Help/secret visibility/plain output/control-character handling and QR consistency checked at recorded scope. External accessibility/screenshots/malicious terminal are not controlled."],
"CHECK-ARC-001":["passed","Source/caller ownership, independent feature modules, host adapters and composition inspected; no new structural defect beyond the specific lifetime/error/input findings is established."],
"CHECK-ARC-002":["passed","Copy gate passes;287source modules/2016static edges have no import cycles. Compatibility exports are actual contracts, not automatically dead code. No universal optimality/minimality proof."],
"CHECK-ARC-003":["passed","Fresh full default suite, actual-allocation/host/engine probes and public known-answer controls have production-path fidelity; 29 uncovered changed paths receive explicit source supplements. Not every historic assertion body is freshly reread."],
"CHECK-DOC-001":["failed","Most capability/security claims match source, but planShareRepair wrongly documents cancellation rejection and broad host-error wording is contradicted by ShareInput. Both are reported under their root findings."],
"CHECK-DOC-002":["passed","Current help/options/examples, release metadata/key fingerprint, legal notices and package allowlist checked; actual release operations remain untouched."],
"CHECK-DOC-003":["passed","All32 existing published report JSONs validate; original snapshots/failures remain historical. New report is schema/privacy/hash/coverage checked and independently reviewed; pending acceptance limits are explicit."]
};
const checks=read(`${E}/check-plan.json`).map(row=>{
 const decision=decisions[row.checkId];if(!decision)throw new Error(`Missing ${row.checkId}`);
 return{...row,ledgerState:complete?"final-local-checks-closed":"provisional-do-not-publish",outcome:decision[0],assessment:decision[1],evidence:{localOnly:true,source:`${E}/file-coverage.json`,operations:`${E}/operation-coverage.json`,runtime:`${E}/suite-summary.json`,findings:`${E}/adjudication.json`}};
});
const previous=read("docs/audits/AUD-034-evidence/rule-coverage.json");
const exceptions={
"CORE-10":["confirmed-nonconformance","Native group metadata admission differs from the existing JS rule; API002 demonstrates actual drift. Other named rule/copy gates pass."],
"CORE-20":["confirmed-nonconformance","planShareRepair's public cancellation JSDoc promises rejection while its correct result is a stopped plan."],
"CORE-22":["confirmed-nonconformance","ShareInput still catches operational Error failures and resolves share trouble/false odd-share diagnosis; original AUD033API003 remains open at this caller."],
"CORE-24":["confirmed-nonconformance","Four concrete first-party scratch variants and a failed-digest dependency allocation lack explicit retirement. Corrected prior owners/close-error variant remain intact; G1-001 is still separately deferred."],
"TS-07":["confirmed-nonconformance","Parser/detection/RGB/UTF8 scratch is not recalled by later owner disposal. Explicit controlled mutable arrays, not inevitable text/JIT copies, establish the findings."],
"RUST-13":["confirmed-nonconformance","Pinned bc-shamir stores reconstructed secret in an ordinary Vec and returns digest failure without wiping it. Wrapper Zeroizing covers only successful returned allocations."],
"CORE-48":["confirmed-nonconformance","Malformed native groupIndex>=groupCount is accepted at raw/checked engine level. Normal high-level JS admission still refuses it."],
"DOC-06":["confirmed-nonconformance","Public planShareRepair cancellation text disagrees with the actual stopped-result contract."],
"CORE-15":["supported-at-recorded-scope","Canonical lint/clippy/code-rules pass; three source functions101..150lines were reviewed as cohesive state machines. Test/script long-body interpretation is separately scoped in source supplements; no count-only architectural finding."],
"CORE-17":["supported-at-recorded-scope","Workspace glossary/map and changed public terms/claim context inspected. No new settled product glossary term or all-identifier vocabulary proof is inferred from a filename count."],
"CORE-27":["supported-at-recorded-scope","Feature-local known answers and negative gates precede material use; full self-test and mutation/refusal regressions execute. New cleanup counterexamples are recorded as missing regressions for future fixes."],
"CORE-29":["supported-at-recorded-scope","Slow cipher/PDF work stays in requested checks; current core self-test and five fresh process timings are recorded separately. No cross-platform/cold-machine performance promise."],
"CORE-33":["not-fully-verified-across-external-hosts","Local full regressions and real CLI/standalone PTY pass. Complete current external browser/Windows/macOS regression acceptance remains blocked."],
"CORE-43":["supported-for-current-local-audit-scope","Fresh local release checks and exact outcomes retained; known findings prevent a universal done/conformance claim."],
"CORE-44":["not-applicable-to-baseline-remediation","This requested audit preserves production/test baseline. The report contains actionable fix plans; no silent baseline repair or claim of closure."],
"CORE-45":["not-applicable-to-commit-action","No commit/push requested by this audit or created; dirty source/delta and release identity are still reviewed."],
"CORE-53":["supported-at-recorded-scope","Distinct crypto/protocol reviewers, a separate skeptic/completeness review, max2concurrentstaticreviewers,3GiBreserve and recorded source snapshots; reviewers do not implement fixes."]
};
const rules=read(`${E}/rule-plan.json`).map(row=>{
 const old=previous.find(item=>item.ruleId===row.ruleId),change=exceptions[row.ruleId];
 return{ruleId:row.ruleId,title:row.title,disposition:change?.[0]??old?.disposition??"not-fully-assessed",assessment:change?.[1]??`${old?.assessment??"No inherited semantic disposition available."} Admitted at that explicit prior scope with matching rule identity and current context, supplemented by current gates, A/B source review and changed CLI/test supplements; not a new whole-repository semantic pass.`,evidence:{localOnly:true,current:`${E}/file-coverage.json`,prior:"docs/audits/AUD-034-evidence/rule-coverage.json"}};
});
writeFileSync(`${E}/check-coverage.json`,JSON.stringify(checks,null,2)+"\n");writeFileSync(`${E}/rule-coverage.json`,JSON.stringify(rules,null,2)+"\n");console.log(JSON.stringify({checks:checks.length,rules:rules.length,core:rules.filter(row=>row.ruleId.startsWith("CORE-")).length}));

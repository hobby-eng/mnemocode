/** Bind the AUD-008 SSKR review to exact production, fixture, harness and command bytes. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const paths = [
  "src/sskr/runtime.ts",
  "src/sskr/shares.ts",
  "src/sskr/transport.ts",
  "src/sskr/repair.ts",
  "src/sskr/joint-repair.ts",
  "src/sskr/checksum.ts",
  "src/sskr/gf2.ts",
  "src/sskr/gf256.ts",
  "src/sskr/share-platform.ts",
  "src/sskr/share-platform-node.ts",
  "src/sskr/self-test.ts",
  "src/cli/sskr-command.ts",
  "src/cli/share-repair.ts",
  "src/cli/backup-check.ts",
  "sskr-wasm/rust/src/lib.rs",
  "sskr-wasm/rust/Cargo.lock",
  "sskr-wasm/rust/Cargo.toml",
  "sskr-wasm/generated/recovery_sskr_wasm.js",
  "sskr-wasm/generated/recovery_sskr_wasm_bg.wasm",
  "sskr-wasm/integrity.json",
  "vectors/sskr-v1.json",
  "docs/SSKR.md",
  "SECURITY.md",
  "dist/sskr/shares.js",
  "dist/sskr/repair.js",
  "dist/sskr/joint-repair.js",
  "dist/sskr/transport.js",
  "docs/audits/AUD-008-harnesses/sskr-defects.mjs",
  "docs/audits/AUD-008-harnesses/sskr-coverage.mjs",
  "docs/audits/AUD-008-evidence/sskr-defects.log",
  "docs/audits/AUD-008-evidence/sskr-defects.command.json",
  "docs/audits/AUD-008-evidence/sskr-coverage.log",
  "docs/audits/AUD-008-evidence/sskr-coverage.command.json",
];
const upstream =
  (decodeURIComponent(new URL("../../../../", import.meta.url).pathname).replace(/\/$/, "") + "/workingspace/cargo/registry/src/index.crates.io-1949cf8c6b5b557f/");
const upstreamPaths = [
  "sskr-0.12.0/src/encoding.rs",
  "sskr-0.12.0/src/secret.rs",
  "bc-shamir-0.13.0/src/shamir.rs",
];
const review = {
  auditId: "AUD-008",
  reviewer: "SSKR reviewer 3",
  model: null,
  reasoningEffort: null,
  baseline: "767ee995a91e98c1f9bde6b7930147e352fc5cff",
  sourceFingerprintFromCoordinator:
    "6a7c9b2a7c9f53592d27698ce670e2eea226215d8e6b3ae972c58d66af873817",
  artifactRelationship:
    "Fresh TypeScript dist from coordinator; committed WASM runtime bytes verified by production loader. No Rust/WASM/Docker rebuild performed by this reviewer.",
  methods: [
    "Production source and CLI path review, including installed upstream sskr 0.12.0 and bc-shamir 0.13.0 integration internals.",
    "Bounded public-fixture runtime probes through freshly built combineSskrShares, planShareRepair, readRepairableShare, splitSskrMnemonic and checkShareBackup.",
    "Literal published transport bytes and independent custom-form bit/CRC oracle, all 30 official minimal grouped quorums, all 15 deterministic width-specific pairs, six format readers and one-token repairs across five BIP39 entropy widths.",
    "All 65,536 GF(256) products compared with independent bit multiplication; inverse and duplicate-point negatives; published raw group shares checked against HMAC-SHA256.",
  ],
  references: [
    {
      url: "https://github.com/BlockchainCommons/Research/blob/master/papers/bcr-2020-011-sskr.md",
      accessedDate: "2026-10-06",
      factsUsed:
        "Published entropy and raw share bytes, group and member threshold meanings, current tag 40309 and legacy type distinction.",
      limit:
        "Live master document inspected; runtime vectors are bound to the local hashed fixture rather than an unrecorded remote commit.",
    },
  ],
  checks: [
    {
      checkId: "CHECK-FUN-006",
      scope: "SSKR splitting, grouped recovery, transports and repair",
      outcome: "failed",
      evidence: ["sskr-coverage.log", "sskr-defects.log"],
      summary:
        "Ordinary thresholds, official grouped quorums, all supported widths and formats, repair duplicates and bounded ambiguity pass. Complete recovery ignores an inconsistent surplus member; marked legacy transports reject.",
    },
    {
      checkId: "CHECK-API-004",
      scope: "SSKR encoding and import/export interoperability",
      outcome: "failed",
      evidence: ["sskr-coverage.log", "sskr-defects.log"],
      summary:
        "Literal official transport and independent custom-form oracle pass. Accepted intact legacy untagged Bytewords and tagged UR layouts are absent from the repair reader; intact legacy transport rejects when another share is marked.",
    },
    {
      checkId: "CHECK-SEC-004",
      scope: "SSKR production randomness and digest integration only",
      outcome: "passed",
      evidence: ["sskr-coverage.log"],
      summary:
        "Production split uses node:crypto randomBytes(32), a 32-byte ChaCha20 seed, and reconstructs its newly generated shares. Invalid 31/33-byte seeds reject. Public group digest follows bc-shamir HMAC rule. No injected RNG failure experiment or cryptographic proof.",
    },
    {
      checkId: "CHECK-SEC-005",
      scope: "SSKR cleanup and exceptional paths only",
      outcome: "passed",
      evidence: ["sskr-source-hashes.json"],
      summary:
        "Source trace confirms TypeScript finally clearing owned entropy/random/restored byte arrays, Rust input zeroization, decoded Zeroizing vectors, and retry on failed lazy initialization. Upstream Secret copies, WASM return buffers, immutable strings and joint plan matrices have practical erasure limitations. No full fault-injection or memory-forensics campaign.",
    },
    {
      checkId: "CHECK-SEC-007",
      scope: "SSKR parsing and repair availability only",
      outcome: "passed",
      evidence: ["sskr-coverage.log", "sskr-source-hashes.json"],
      summary:
        "Share count 1..256, 128-byte transport, 2048-character repair input, 64 joint marks, 4096 branch cap, 40-bit aggregate search cap and 16-bit public convenience search cap traced. Bounded malformed/count inputs reject. CLI asks before searches exceeding measured one-minute bound; no large search or host exhaustion attempted.",
    },
  ],
  candidates: [
    {
      localId: "SSKR-surplus-member",
      category: "FUN",
      severity: "medium",
      status: "open",
      releaseBlocking: false,
      releaseBlockingReason:
        "A valid quorum still recovers correct entropy; no secret compromise demonstrated. Surplus-member integrity and reliability guidance should be corrected before claiming every supplied share is checked.",
      title: "Complete recovery silently ignores inconsistent surplus members",
      locations: [
        { path: "src/sskr/shares.ts", start: 68, end: 71 },
        { path: "src/sskr/transport.ts", start: 409, end: 434 },
        { path: "sskr-wasm/rust/src/lib.rs", start: 194, end: 195 },
        { path: "src/cli/backup-check.ts", start: 77, end: 89 },
      ],
      upstreamCause:
        "sskr 0.12.0 encoding.rs combine_shares retains only the first member_threshold shares per group and stops after group_threshold successfully restored groups.",
      reproduction:
        "Use vectors.deterministic[0] shares 0 and 1, modify byte 8 of share 2 CBOR and independently recompute CRC32. Supply all three to combineSskrShares and checkShareBackup; also supply [share0, modifiedShare2].",
      expected:
        "Reject the supplied inconsistent set, or explicitly report which supplied shares were unchecked rather than representing the entire set as valid.",
      observed:
        "Three-share combine returns original mnemonic, backup check returns restores, but the pair containing altered member rejects. Modified share: ur:sskr/goemjzaeadaockjsrpamsebalrbysbjngeeysnplutlyktgresnd.",
      impact:
        "A checksum-valid wrong surplus member survives a complete-set recovery/check. The nominal any-2-of-3 redundancy can fail after the valid pair is separated or one correct share is lost. Prerequisite is a structurally valid incorrect surplus share, such as manual alteration plus recalculated CRC or same-identifier collision; ordinary mistyping with invalid CRC still rejects. This is not an authenticity guarantee against arbitrary malicious shares.",
      recommendedFix:
        "Check all supplied complete members against each group's recovered threshold polynomial, as joint repair already does; account separately for incomplete groups. Alternatively accurately expose ignored shares and constrain reliability claims.",
      verification:
        "Test altered first and surplus members in different orders, all possible surviving pairs, surplus groups and incomplete groups; preserve successful valid grouped quorums.",
      evidence:
        "sskr-defects.log, test inconsistent-surplus-share-must-be-rejected; command exit 1 retains production failures.",
    },
    {
      localId: "SSKR-legacy-repair",
      category: "API",
      severity: "medium",
      status: "open",
      releaseBlocking: false,
      releaseBlockingReason:
        "Limited to compatibility layouts; current canonical transport repair passes. Documented existing-backup acceptance should extend consistently to repair.",
      title: "Repair rejects transport layouts accepted by complete-share recovery",
      locations: [
        { path: "src/sskr/repair.ts", start: 255, end: 257 },
        { path: "src/sskr/repair.ts", start: 315, end: 320 },
        { path: "src/sskr/repair.ts", start: 348, end: 352 },
        { path: "src/sskr/joint-repair.ts", start: 546, end: 553 },
      ],
      reproduction:
        "Encode public deterministic first share transport as untagged full Bytewords, or prefix its CBOR with current tag 40309/legacy tag 309 and independently recompute CRC to create tagged UR. Intact normalizeShare/combine succeed. Replace token 13 with ? and call readRepairableShare/combine; also mix intact legacy Bytewords with a marked canonical second share.",
      expected:
        "Repair one missing transport unit for every accepted layout, and accept the unchanged legacy member when another share is damaged.",
      observed:
        "All three marked compatibility layouts yield No valid share fits the marked elements; joint plan yields no-fit, Share 1 is no share. The untouched legacy member likewise causes no-fit when only the other member is marked.",
      impact:
        "Users restoring supported older backups can be blocked by one unreadable token despite a recoverable CRC system. A fully legible legacy member can block repair of a different member. Canonical current untagged UR and tagged full Bytewords are unaffected.",
      recommendedFix:
        "Let standardStructures enumerate all tagged/untagged layouts accepted by transport.ts for both standard textual forms. Keep CBOR, metadata, CRC and digest validation unchanged; normalize intact members before constructing repair spaces where appropriate.",
      verification:
        "One-token first/middle/last repair of legacy untagged Bytewords, current/legacy tagged UR and supported long CBOR length layout; joint repair with intact legacy and marked current members in both orders.",
      evidence:
        "sskr-defects.log, four compatibility checks failed; intact acceptance and no-fit assessments printed for each.",
    },
  ],
  observations: [
    "No confirmed critical/high issue, threshold bypass, wrong valid-quorum entropy or outbound network behavior found in assigned scope.",
    "Practical zeroization: upstream sskr Secret has no Drop/Zeroize, wasm-bindgen recover frees the returned entropy allocation without wiping after its JS copy, and joint plans retain matrices/byte copies until released. Owned TypeScript buffers do clear; this observation does not demonstrate unintended exposure to another process.",
    "The repair search checks AbortSignal only at a turn boundary every 16,384 tries; short searches may complete without checking an already-aborted signal. This is an optional API improvement, not a demonstrated long-running availability defect.",
  ],
  limitations: [
    "No Rust/WASM rebuild, Docker, full test suite, native executable, PDF/QR export or manual private-screen interaction run by this reviewer; coordinator owns other evidence.",
    "Only single-group sets with member threshold >=2 are repaired by design; externally grouped complete fixtures tested exhaustively at their 30 minimal quorums.",
    "No search beyond 65,536 convenience combinations, RNG-failure injection, exhaustive memory erasure, panic/OOM injection, arbitrary secret authentication proof or host resource exhaustion.",
    "Five entropy-width fixtures derive from this engine and are regression checks; only published grouped shares and independently calculated transport expectations provide independent known-answer evidence.",
    "Finding IDs reserved by coordinator; local candidate identifiers above are not final AUD-008 finding IDs.",
  ],
  sourceHashes: Object.fromEntries(paths.map((path) => [path, sha256(path)])),
  inspectedUpstreamSourceHashes: Object.fromEntries(
    upstreamPaths.map((path) => [upstream + path, sha256(upstream + path)]),
  ),
};
const manifest = "docs/audits/AUD-008-evidence/sskr-source-hashes.json";
writeFileSync(
  manifest,
  JSON.stringify(
    {
      sourceHashes: review.sourceHashes,
      inspectedUpstreamSourceHashes: review.inspectedUpstreamSourceHashes,
    },
    null,
    2,
  ) + "\n",
);
const path = "docs/audits/AUD-008-evidence/sskr-review.json";
writeFileSync(path, JSON.stringify(review, null, 2) + "\n");
console.log(
  JSON.stringify({
    review: path,
    reviewSha256: sha256(path),
    manifest,
    manifestSha256: sha256(manifest),
    checkCount: review.checks.length,
    candidateCount: review.candidates.length,
  }),
);

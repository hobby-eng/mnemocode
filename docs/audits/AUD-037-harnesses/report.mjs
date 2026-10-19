// AUD-037: writes the published report pair, docs/audits/AUD-037-<date>.md and .json, from one data
// file, docs/audits/AUD-037-harnesses/report-data.json, so that the two records cannot disagree.
// Before writing, it checks the data against the shared audit record envelope
// (multi-chain-wallet-tools/docs/audit-report.schema.json: required fields, ID patterns, enums),
// refuses duplicate JSON keys, finding IDs that are not unique or not numbered in order within their
// category, and any home-directory path or local time that would break the report privacy rules
// (workspace .github/instructions/audits.instructions.md). It exits non-zero on the first problem.
//
// Usage, from the repository root: node docs/audits/AUD-037-harnesses/report.mjs [--check]
// --check validates the data and the written pair without writing anything.

import { readFileSync, writeFileSync } from "node:fs";

const DATA = "docs/audits/AUD-037-harnesses/report-data.json";
const CATEGORIES = ["SEC", "FUN", "API", "BLD", "DOC", "UI", "ARC"];
const SEVERITIES = ["critical", "high", "medium", "low", "info"];
const STATUSES = ["open", "fixed", "verified", "deferred", "accepted", "not-reproduced", "withdrawn", "duplicate"];
const OUTCOMES = ["passed", "failed", "blocked", "skipped", "not-run", "not-applicable", "partly"];
const RECORD_FIELDS = ["id", "category", "kind", "title", "severity", "status", "releaseBlocking", "evidence", "reproduction", "expected", "observed", "impact", "recommendedFix", "requiredVerification"];

const problems = [];
const fail = (text) => problems.push(text);

/** Parses JSON and refuses a duplicate key anywhere, which JSON.parse would silently keep last. */
function parseStrict(text, name) {
  const value = JSON.parse(text);
  const keyPattern = /"((?:[^"\\]|\\.)*)"\s*:/gu;
  const stack = [];
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      keyPattern.lastIndex = i;
      const match = keyPattern.exec(text);
      if (match !== null && match.index === i && stack.length > 0 && stack.at(-1).object) {
        const key = JSON.parse(`"${match[1]}"`);
        const keys = stack.at(-1).keys;
        if (keys.has(key)) fail(`${name}: duplicate key "${key}" near offset ${i}`);
        keys.add(key);
        i = match.index + match[0].length - 1;
        continue;
      }
      inString = true;
    } else if (c === "{") stack.push({ object: true, keys: new Set() });
    else if (c === "[") stack.push({ object: false });
    else if (c === "}" || c === "]") stack.pop();
  }
  return value;
}

function checkData(data) {
  for (const key of ["auditNumber", "date", "title", "reviewer", "snapshot", "scope", "coverage", "checks", "findings", "limitations", "assessment"]) {
    if (data[key] === undefined) fail(`data: missing ${key}`);
  }
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u.test(data.date ?? "")) fail("data: date is not YYYY-MM-DD");
  const counters = new Map();
  const ids = new Set();
  for (const finding of data.findings ?? []) {
    for (const field of RECORD_FIELDS.filter((f) => f !== "kind")) {
      if (finding[field] === undefined) fail(`${finding.id}: missing ${field}`);
    }
    const match = /^AUD-037-(SEC|FUN|API|BLD|DOC|UI|ARC)([0-9]{3})$/u.exec(finding.id ?? "");
    if (match === null) {
      fail(`${finding.id}: not an AUD-037 finding ID`);
      continue;
    }
    if (match[1] !== finding.category) fail(`${finding.id}: category ${finding.category} differs from its ID`);
    const next = (counters.get(match[1]) ?? 0) + 1;
    if (Number(match[2]) !== next) fail(`${finding.id}: expected number ${String(next).padStart(3, "0")} in ${match[1]}`);
    counters.set(match[1], next);
    if (ids.has(finding.id)) fail(`${finding.id}: duplicate ID`);
    ids.add(finding.id);
    if (!SEVERITIES.includes(finding.severity)) fail(`${finding.id}: severity ${finding.severity}`);
    if (!STATUSES.includes(finding.status)) fail(`${finding.id}: status ${finding.status}`);
    if (typeof finding.releaseBlocking !== "boolean") fail(`${finding.id}: releaseBlocking is not a boolean`);
    if (finding.releaseBlocking && !finding.releaseBlockingReason) fail(`${finding.id}: release blocking without a reason`);
  }
  const checkIds = new Set();
  for (const row of data.coverage ?? []) {
    if (!/^CHECK-(SEC|FUN|API|BLD|UI|ARC|DOC)-[0-9]{3}$/u.test(row.checkId)) fail(`coverage: ${row.checkId}`);
    if (!OUTCOMES.includes(row.outcome)) fail(`coverage ${row.checkId}: outcome ${row.outcome}`);
    checkIds.add(row.checkId);
  }
  if (checkIds.size !== 32) fail(`coverage: ${checkIds.size} distinct CHECK IDs, expected the guide's 32`);
  for (const row of data.remediation ?? []) {
    if (!ids.has(row.id)) fail(`remediation: ${row.id} is no finding of this report`);
  }
}

/** The report privacy rules: no home directory of a real user, and no local time zone. */
function checkPrivacy(text, name) {
  for (const match of text.matchAll(/\/home\/(?!user\b)[a-z_][a-z0-9_-]*/gu)) fail(`${name}: home path ${match[0]}`);
  for (const match of text.matchAll(/[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?([+-][0-9]{2}:?[0-9]{2})(?![0-9])/gu)) {
    if (!/^[+-]00:?00$/u.test(match[1])) fail(`${name}: local time offset ${match[0]}`);
  }
}

const cell = (value) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (header, rows) =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function markdown(data) {
  const lines = [];
  lines.push(`# AUD-037 — ${data.title}`, "");
  lines.push("## Record metadata", "");
  for (const [label, value] of data.metadata) lines.push(`- **${label}:** ${value}`);
  lines.push("", "## Finding register", "");
  lines.push(
    table(
      ["ID", "Category", "Kind", "Severity", "Status", "Release blocking", "Title"],
      data.findings.map((f) => [f.id, f.category, "finding", f.severity, f.status, String(f.releaseBlocking), f.title]),
    ),
  );
  lines.push("", "## Review evidence", "", "### Scope and methodology", "");
  for (const paragraph of data.scope.paragraphs) lines.push(paragraph, "");
  lines.push("Procedure files, read and hash-bound:", "");
  lines.push(table(["Procedure", "SHA-256"], Object.entries(data.scope.procedureHashes).map(([file, hash]) => [`\`${file}\``, `\`${hash}\``])));
  lines.push("", "### Coverage ledger", "");
  lines.push(table(["Check ID", "Group", "Outcome", "Method and evidence / gap"], data.coverage.map((r) => [r.checkId, r.group, r.outcome, r.evidence])));
  lines.push("", "### Coding-guide and agent-instruction conformance", "");
  for (const paragraph of data.conformance.paragraphs) lines.push(paragraph, "");
  lines.push(table(["Rule", "Outcome", "Evidence"], data.conformance.rules.map((r) => [r.rule, r.outcome, r.evidence])));
  lines.push("", "### Checks", "");
  lines.push(table(["Check / command", "Outcome", "Counts / environment", "Evidence"], data.checks.map((c) => [c.command, c.outcome, c.counts, c.evidence])));
  lines.push("", "### Findings", "");
  for (const category of CATEGORIES) {
    const group = data.findings.filter((f) => f.category === category);
    if (group.length === 0) continue;
    lines.push(`#### ${category}`, "");
    for (const f of group) {
      lines.push(`##### ${f.id} — ${capital(f.severity)} — ${f.title}`, "");
      const fields = [
        ["Category", f.category],
        ["Severity", f.severity],
        ["Status", f.status],
        ["Release blocking", f.releaseBlocking ? `true: ${f.releaseBlockingReason}` : `false${f.releaseBlockingReason ? `: ${f.releaseBlockingReason}` : ""}`],
        ["Rules", f.rules?.join(", ")],
        ["Related", f.relatedFindings?.join(", ")],
        ["Affected files and builds", f.affected],
        ["Reproduction", f.reproduction],
        ["Expected behaviour", f.expected],
        ["Observed behaviour", f.observed],
        ["Impact", f.impact],
        ["Evidence", f.evidence],
        ["Recommended fix", f.recommendedFix],
        ["Required verification", f.requiredVerification],
      ];
      for (const [label, value] of fields) if (value !== undefined && value !== "") lines.push(`- **${label}:** ${value}`);
      lines.push("");
    }
  }
  lines.push("### Remediation and follow-up", "");
  lines.push(table(["Finding ID", "Status", "Fix commit", "Verification commit", "Evidence"], data.remediation.map((r) => [r.id, r.status, r.fixCommit ?? "Not fixed", r.verificationCommit ?? "Not run", r.evidence])));
  lines.push("", "### Informational observations and recommendations", "");
  for (const item of data.recommendations) lines.push(`- ${item}`);
  lines.push("", "### Assessment and limitations", "");
  for (const paragraph of data.assessment) lines.push(paragraph, "");
  for (const item of data.limitations) lines.push(`- ${item}`);
  lines.push("");
  return lines.join("\n");
}

function record(data) {
  return {
    schemaVersion: 1,
    auditId: "AUD-037",
    auditNumber: data.auditNumber,
    date: data.date,
    title: data.title,
    reviewer: data.reviewer,
    snapshot: data.snapshot,
    scope: { paragraphs: data.scope.paragraphs, procedureHashes: data.scope.procedureHashes, coverage: data.coverage, conformance: data.conformance },
    checks: data.checks,
    findings: data.findings.map((f) => ({ ...f, kind: "finding" })),
    observations: [],
    remediation: data.remediation,
    limitations: data.limitations,
    assessment: data.assessment,
    recommendations: data.recommendations,
    reviewerPhases: data.reviewerPhases,
  };
}

const data = parseStrict(readFileSync(DATA, "utf8"), DATA);
checkData(data);
const md = markdown(data);
const json = `${JSON.stringify(record(data), null, 2)}\n`;
checkPrivacy(md, "Markdown");
checkPrivacy(json, "JSON");
parseStrict(json, "JSON record");
const base = `docs/audits/AUD-037-${data.date}`;
if (process.argv.includes("--check")) {
  for (const [file, text] of [[`${base}.md`, md], [`${base}.json`, json]]) {
    let written = "";
    try {
      written = readFileSync(file, "utf8");
    } catch {
      fail(`${file} is missing`);
    }
    if (written !== "" && written !== text) fail(`${file} differs from what the data gives`);
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
if (!process.argv.includes("--check")) {
  writeFileSync(`${base}.md`, md);
  writeFileSync(`${base}.json`, json);
}
console.log(`AUD-037: ${data.findings.length} findings, ${data.coverage.length} coverage rows; ${base}.md and .json ${process.argv.includes("--check") ? "agree with the data" : "written"}.`);

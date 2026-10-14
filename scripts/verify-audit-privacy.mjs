// The published audit records and harness files name no machine owner and give every time in UTC
// (workspace .github/instructions/audits.instructions.md, Report privacy). The owner's names are
// read from the account that runs the check, so that the check itself holds none of them; any
// other home path, such as synthetic test data or a CI runner's, is not an owner's. Local command evidence (*-evidence/) is never published and
// never checked (audit-files.mjs). Run by pnpm check.
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { publishedAuditFiles } from "./audit-files.mjs";

/** A date with a time of day, then an offset or a zone name if any is written after it. */
const DATE_TIME =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?(Z|[+-]\d{2}:?\d{2}|[A-Z]{2,5}\b))?/gu;
/**
 * The other layouts of a date with its time that tools write, each with its offset or zone name:
 * git's default (Tue Oct 13 21:00:00 2026 +0500), RFC 2822 (Tue, 13 Oct 2026 21:00:00 +0500)
 * and date(1) (Tue Oct 13 21:00:00 MSK 2026).
 */
const OTHER_DATE_TIMES = [
  /\b[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4} ([+-]\d{4})/gu,
  /\b\d{1,2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} ([+-]\d{4}|[A-Z]{2,5}\b)/gu,
  /\b\d{2}:\d{2}:\d{2} ([A-Z]{2,5}) \d{4}\b/gu,
];
const UTC_ZONES = new Set(["Z", "+00:00", "+0000", "UTC", "GMT"]);
/** Account names that name no person, such as a CI runner's or the anonymous one of the records. */
const IMPERSONAL = new Set(["user", "root", "runner", "home", "ubuntu", "node"]);
/** Shorter names would match ordinary words. */
const MIN_NAME_LENGTH = 3;

/**
 * The names of the owner of the account that runs the check, which no published record may hold:
 * its user name and the name of its home folder, from the system unless `account` gives them.
 */
export function ownerNames(account = { username: userInfo().username, home: homedir() }) {
  const names = [account.username, basename(account.home)].map((name) => name.toLowerCase());
  return [...new Set(names)].filter(
    (name) => name.length >= MIN_NAME_LENGTH && !IMPERSONAL.has(name),
  );
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** What `text`, the published file at `path`, must not hold: the problems, one line each. */
export function auditTextProblems(text, path, owners) {
  const problems = [];
  for (const name of owners)
    if (new RegExp(`(?<![\\p{L}\\p{N}])${escaped(name)}(?![\\p{L}\\p{N}])`, "iu").test(text))
      problems.push(`${path}: names the machine owner.`);
  for (const match of [DATE_TIME, ...OTHER_DATE_TIMES].flatMap((layout) => [
    ...text.matchAll(layout),
  ]))
    // A time must say that it is UTC: an offset other than zero, a zone name or none at all
    // would give the local time of the machine that wrote it.
    if (!UTC_ZONES.has(match[1] ?? ""))
      problems.push(`${path}: the time ${match[0]} is not given in UTC.`);
  if (/AUD-\d+-\d{4}-\d{2}-\d{2}\.md$/u.test(path) && !text.includes("UTC"))
    problems.push(`${path}: the report does not say that its times are UTC.`);
  return problems;
}

async function main() {
  const owners = ownerNames();
  const files = publishedAuditFiles();
  const problems = [];
  for (const path of files)
    problems.push(...auditTextProblems(await readFile(path, "utf8"), path, owners));
  if (problems.length > 0) throw new Error(`Audit privacy:\n${problems.join("\n")}`);
  console.log(`Audit privacy: ${files.length} published files; no owner name, times in UTC.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();

// AUD-010 core probe: how a typed backup is read before its dates (src/core/backup-reading.ts):
// the MNC1 header, a record without Seedshift where only Seedshift will do, a Shamir share typed
// where codes are asked (complete, with marks, under a record header), the mode and the form from
// the record or the host with their conflict lines, every form that raw codes fit, and marked
// codes. Public fixtures only: abandon x11 about masked with one synthetic date; a share of it
// made with the system random source, which is not printed.

import { BackupReading } from "../../../src/core/backup-reading.js";
import { EncodedBackup } from "../../../src/core/encoded-backup.js";
import { Masking } from "../../../src/core/masking.js";
import { formatEncoded } from "../../../src/core/representations.js";
import "../../../src/sskr/share-platform-node.js";
import { splitSskrMnemonic } from "../../../src/sskr/shares.js";
import { writeShare } from "../../../src/sskr/transport.js";

let failures = 0;
function check(label: string, ok: boolean, values: Record<string, unknown> = {}): void {
  if (!ok) failures += 1;
  console.log(JSON.stringify({ check: label, outcome: ok ? "passed" : "failed", ...values }));
}
function refusal(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return String(error);
  }
  return undefined;
}

const PHRASE = `${"abandon ".repeat(11)}about`;
const DATE = { year: 2026, month: 9, day: 23 };
const RULES = { seedshiftOnly: false, shareReader: "the share reader" };
const encoded = Masking.of("seedshift").encode(PHRASE, [DATE]);
const numbers = formatEncoded(encoded, "indexes");
const record = EncodedBackup.of(encoded.shiftedIndexes, "indexes", "seedshift").record();

// Records.
{
  const reading = BackupReading.of(record, RULES);
  check(
    "record: mode and form from the header",
    reading.hasRecord &&
      reading.mode() === "seedshift" &&
      reading.mode("direct") === "seedshift" &&
      JSON.stringify(reading.formats("unicode")) === '["indexes"]',
    { formats: reading.formats() },
  );
  check(
    "record: conflict lines name modes and forms, never codes",
    reading.modeConflict("seedshift-legacy") ===
      "The record was made with MnemoCode Seedshift, not with the Original Seedshift." &&
      reading.formatConflict("unicode") === "The record holds indexes codes, not unicode." &&
      reading.modeConflict("seedshift") === undefined,
    {
      mode: reading.modeConflict("seedshift-legacy"),
      format: reading.formatConflict("unicode"),
    },
  );
  const direct = EncodedBackup.of(encoded.shiftedIndexes, "indexes", "direct").record();
  check(
    "record without Seedshift refused where only Seedshift will do",
    /only for records created with Seedshift/u.test(
      refusal(() => BackupReading.of(direct, { ...RULES, seedshiftOnly: true })) ?? "",
    ),
  );
  check(
    "malformed header refused",
    /Malformed MnemoCode record header/u.test(
      refusal(() => BackupReading.of("MNC1:seedshift:indexes", RULES)) ?? "",
    ),
  );
  check(
    "String/JSON redacted",
    String(reading) === "[BackupReading: redacted]" &&
      JSON.stringify(reading) === '"[BackupReading: redacted]"',
  );
}

// Raw codes and marks.
{
  const raw = BackupReading.of(numbers, RULES);
  check(
    "raw word numbers: one form fits; codes read as direct until the mode is given",
    JSON.stringify(raw.formats()) === '["indexes"]' &&
      raw.codes("indexes").mode === "direct" &&
      raw.codes("indexes").withMode("seedshift").decode([DATE]).recoveredMnemonic === PHRASE,
    { formats: raw.formats() },
  );
  const marked = numbers.split(" ");
  marked[4] = "?";
  const reading = BackupReading.of(marked.join(" "), RULES);
  check(
    "marked word numbers: marked, form, places",
    reading.marked &&
      JSON.stringify(reading.markedFormats()) === '["indexes"]' &&
      JSON.stringify(reading.missingCodes("indexes").missingPlaces) === "[5]",
    { formats: reading.markedFormats() },
  );
  check(
    "unreadable text: reason names no code",
    /^Error: /u.test(refusal(() => BackupReading.of("hello there", RULES).formats()) ?? ""),
    {
      message: refusal(() => BackupReading.of("hello there", RULES).formats()),
    },
  );
}

// A Shamir share typed where codes are asked.
{
  const shares = await splitSskrMnemonic(PHRASE, 2, 3);
  const share = writeShare(shares[0]!, "indexes");
  const message = refusal(() => BackupReading.of(share, RULES));
  check(
    "a complete share is refused and sent to the host's share reader",
    message ===
      "Error: This is a Shamir share, not an encoded seed phrase: the share reader reads it.",
    { message },
  );
  check("shareKind: complete share", BackupReading.shareKind(share) === "share");
  const one = share.split(" ");
  one[6] = "?";
  check("shareKind: share with one mark", BackupReading.shareKind(one.join(" ")) === "share");
  check(
    "shareKind: codes, complete and marked, are no share",
    BackupReading.shareKind(numbers) === undefined &&
      BackupReading.shareKind(marked(numbers)) === undefined,
  );
  check(
    "shareKind: text under a record header is no share",
    BackupReading.shareKind(`MNC1:seedshift:indexes:${share}`) === undefined,
  );
  const ur = writeShare(shares[1]!, "ur");
  check(
    "a share as ur:sskr is refused too",
    /This is a Shamir share/u.test(refusal(() => BackupReading.of(ur, RULES)) ?? ""),
  );
}

function marked(text: string): string {
  const parts = text.split(" ");
  parts[2] = "?";
  return parts.join(" ");
}

console.log(JSON.stringify({ failures }));
process.exitCode = failures === 0 ? 0 : 1;

// AUD-014: bounded actual-library probes. Public phrase only; no scrypt, PDF or image generation.
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { protectionFor } from "../../../dist/core/candidate-encryption.js";
import { CandidateListWriter } from "../../../dist/core/candidate-list-writer.js";
import { DatesAnswer, DateSearch } from "../../../dist/core/date-search.js";
import { Masking } from "../../../dist/core/masking.js";
import { EncodedBackup } from "../../../dist/core/encoded-backup.js";
import { MissingCodes } from "../../../dist/core/missing-codes.js";
import { checksumValid } from "../../../dist/core/candidates.js";
import {
  representMnemonic,
  encodeMnemonic,
  formatEncoded,
  indexesToColors,
} from "../../../dist/core.js";
import { bip39Passphrase } from "../../../dist/cli/bitcoin-options.js";
import { firstFreeName } from "../../../dist/cli/output-paths.js";
import { renderIndividualCards } from "../../../dist/export/render.js";
import { HeirInstructions } from "../../../dist/export/heir-sheet-text.js";

const phrase = `${"abandon ".repeat(11)}about`;
const date = { year: 2026, month: 9, day: 23 };
const raw = representMnemonic(phrase);
const checks = [];
async function refused(name, body) {
  try {
    const details = await body();
    checks.push({ name, passed: false, details });
  } catch (error) {
    checks.push({ name, passed: true, refusal: error.message });
  }
}

for (const kind of ["passpharse", "unknown", undefined]) {
  await refused(`protection chooser refuses ${String(kind)}`, async () => {
    const protection = protectionFor({ kind, passphrase: "synthetic public password" });
    const outcome = await new CandidateListWriter(protection).writePhrases([phrase]);
    const details = {
      encrypted: protection.encrypted,
      magic: new TextDecoder().decode(outcome.list.bytes.subarray(0, 4)),
    };
    outcome.list.bytes.fill(0);
    return details;
  });
}

function search(walletCheck) {
  return new DateSearch({
    indexes: encodeMnemonic(phrase, [date]).shiftedIndexes,
    dates: DatesAnswer.of([date]),
    mode: "seedshift",
    keep: 1,
    ...(walletCheck === undefined ? {} : { walletCheck }),
  });
}
for (const [label, answer] of [
  ["undefined", undefined],
  ["string false", { matched: "false" }],
]) {
  await refused(`wallet callback rejects ${label}`, async () => {
    const result = await search(() => answer).run();
    return { matchCount: result.matchCount, shown: result.shown.length };
  });
}
const controls = {};
for (const matched of [false, true])
  controls[String(matched)] = (await search(() => ({ matched })).run()).matchCount;
checks.push({
  name: "well-formed wallet controls",
  passed: controls.false === 0 && controls.true === 1,
  details: controls,
});

const controller = new AbortController();
let published = 0;
await refused("final async wallet answer checks abort before publishing", async () => {
  const result = await search(async () => {
    controller.abort(new Error("synthetic abort during wallet check"));
    return { matched: true };
  }).run({ signal: controller.signal, onMatch: () => published++ });
  return {
    aborted: controller.signal.aborted,
    published,
    matchCount: result.matchCount,
    contractCaveat:
      "SearchRun promises stopping at the next turns check; classification requires review",
  };
});

await refused("direct Masking.encode refuses dates", () => ({
  dates: Masking.of("direct").encode(phrase, [date]).dates.length,
}));
await refused("direct EncodedBackup.decode refuses dates", () => ({
  phraseUnchanged:
    EncodedBackup.read(phrase, "english", "direct").decode([date]).recoveredMnemonic === phrase,
}));
await refused("MissingCodes.read refuses unknown mode", () => ({
  mode: MissingCodes.read(`${"abandon ".repeat(11)}?`, "english", "unknown").mode,
}));
const words = [...Array(11).fill(0), 3];
const invalid = [...words];
invalid[0] = 2048;
let rejected = false;
try {
  rejected = checksumValid(invalid) === false;
} catch {
  rejected = true;
}
checks.push({
  name: "public checksum helper does not validate index 2048",
  passed: rejected,
  details: { validControl: checksumValid(words), invalidAccepted: !rejected },
});

const stale = { ...raw, shiftedEnglish: ["zoo"], unicodeCodePoints: ["0000"] };
const json = JSON.parse(formatEncoded(stale, "json"));
checks.push({
  name: "JSON fields use the same canonical indexes as text",
  passed:
    json.english.join(" ") === formatEncoded(stale, "english") &&
    json.unicodeCodePoints === formatEncoded(stale, "unicode"),
  details: {
    words: json.english.length,
    unicode: json.unicodeCodePoints,
    canonicalWordCount: formatEncoded(stale, "english").split(" ").length,
  },
});

const root = await mkdtemp(join(tmpdir(), "mnemocode-aud014-text-"));
try {
  const path = join(root, "synthetic-passphrase.txt");
  await writeFile(
    path,
    Buffer.concat([Buffer.from("synthetic-passphrase-"), Buffer.from([0xff, 10])]),
  );
  await refused("passphrase file refuses malformed UTF-8", () => ({
    hasReplacement: bip39Passphrase({ "bip39-passphrase-file": path }).includes("\ufffd"),
  }));
  if (process.platform !== "win32") {
    const named = join(root, "public-record\\");
    await writeFile(named, "public fixture");
    const found = await firstFreeName(named);
    checks.push({
      name: "POSIX numbering preserves a literal backslash",
      passed: found === `${named}-1`,
      details: {
        expectedBasename: "public-record\\-1",
        actualBasename: found.slice(root.length + 1),
      },
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

const colors = indexesToColors(words);
const content = { kind: "colors", colors, payload: colors.join(" "), pageSize: "business" };
for (const referencesPerCard of [-1, Infinity, Number.NaN]) {
  await refused(`individual template refuses capacity ${String(referencesPerCard)}`, async () => {
    let calls = 0;
    const template = {
      id: "synthetic",
      label: "Synthetic",
      kind: "colors",
      style: "business-it",
      referencesPerCard,
      render: async () => {
        throw new Error("no PDF operation permitted");
      },
      renderIndividual: async () => {
        calls++;
        throw new Error("no PDF operation permitted");
      },
    };
    const cards = await renderIndividualCards({ randomInt: () => 0 }, template, content);
    return { cards: cards.length, renderCalls: calls };
  });
}

const instructions = new HeirInstructions({
  subtitle: "Synthetic",
  address: "",
  start: [],
  decode: () => [],
  restore: () => [],
  dateDigitHelp: undefined,
});
for (const backup of [
  { kind: "shares", format: "ur", threshold: 4, count: 3 },
  { kind: "encoded", format: "unknown" },
]) {
  await refused(`heir facts reject ${backup.kind}/${backup.format}`, () => ({
    needs: instructions.text({ backup, mode: "direct", dates: 0 }).needs,
  }));
}

console.log(JSON.stringify({ checks }, null, 2));
if (checks.some((check) => !check.passed)) process.exitCode = 1;

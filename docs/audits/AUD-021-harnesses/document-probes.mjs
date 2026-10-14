// Text-only public fixture checks; no heir-sheet PDF is rendered and no tag is created.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { HeirInstructions } from "../../../dist/export/heir-sheet-text.js";
import { EncodedBackup } from "../../../dist/core/encoded-backup.js";
import { parseDate } from "../../../dist/core/dates.js";
import { MAX_SEARCH_COMBINATIONS, MAX_SHOWN_CANDIDATES } from "../../../dist/core/candidates.js";

const route = {
  subtitle: "Public audit fixture", address: "", start: [],
  decode: () => ["Decode the public fixture"], restore: () => [], dateDigitHelp: undefined,
};
const text = new HeirInstructions(route).text({
  backup: { kind: "encoded", format: "unicode", words: 12 },
  mode: "seedshift-legacy", dates: 1,
});
assert.ok(JSON.stringify(text).includes("a wrong date gives no error"));
const backup = EncodedBackup.read("8F44901950118F44901950118F44901950118F4490194F5C", "unicode", "seedshift-legacy");
assert.equal(backup.decode([parseDate("24-09-2026")]).checksumValid, false);
const help = await readFile(new URL("../../../src/cli/help-pages.ts", import.meta.url), "utf8");
assert.ok(help.includes(MAX_SEARCH_COMBINATIONS.toLocaleString("en-US")));
assert.ok(help.includes(MAX_SHOWN_CANDIDATES.toLocaleString("en-US")));
const release = await readFile(new URL("../../../docs/RELEASING.md", import.meta.url), "utf8");
assert.ok(release.includes("git tag -s v0.1.0"));
assert.ok(!release.includes("TZ=UTC git tag -s v0.1.0"));
console.log(JSON.stringify({
  legacyGuidancePromisesNoError: true,
  legacyWrongDateChecksumFails: true,
  helpRepeatsExportedLimitLiterals: true,
  utcPrefixMissingFromTagRecipe: true,
  renderedOrTagged: false,
}));

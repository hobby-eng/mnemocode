// Targeted remediation contracts only. Build the current checkout first; public test data only.
import assert from "node:assert/strict";
import { ErrorCatalog } from "../../../dist/core/error-catalog.js";
import { serializeRecord } from "../../../dist/record.js";
import { daysInMonth } from "../../../dist/core/dates.js";
import { runCommandLine } from "../../../dist/cli/command-line.js";
import { optionLabel } from "../../../dist/cli/option-copy.js";
import { parseArguments, assertAllowedArguments } from "../../../dist/cli/arguments.js";

const phrase = "abandon ".repeat(11) + "about";
const catalog = new ErrorCatalog("fixture", {
  range: { kind: "range", text: () => "Synthetic range refusal." },
});
const cause = new Error("Synthetic cause.");
const range = catalog.create("range", [], { cause });
assert.ok(range instanceof RangeError);
assert.equal(range.code, "fixture.range");
assert.equal(range.cause, cause);
assert.deepEqual(Object.keys(range), ["code"]);
assert.throws(() => Object.defineProperty(range, "code", { value: "changed" }), TypeError);

function concealed(error) {
  return error instanceof Error && !error.message.includes(phrase);
}
assert.throws(() => serializeRecord(phrase, "indexes", "synthetic"), concealed);
assert.throws(() => serializeRecord("direct", phrase, "synthetic"), concealed);
assert.throws(() => daysInMonth(2026, phrase), concealed);
assert.equal(optionLabel(phrase), "unknown option");
assert.throws(() => parseArguments([`--${phrase}`]), concealed);
assert.throws(() => assertAllowedArguments(parseArguments([`--${phrase}`, "x"]), "table", ["word"]), concealed);
await assert.rejects(runCommandLine([phrase]), concealed);
await assert.rejects(runCommandLine(["help", phrase]), concealed);
console.log("Coded error and concealed-selector contracts passed.");

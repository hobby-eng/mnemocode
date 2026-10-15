// AUD-028: text/path/default contracts only, without a shell or document generation.
import assert from "node:assert/strict";
import { droppedPath } from "../../../dist/cli/text-file.js";
import { typedLine } from "../../../dist/cli/shell-command.js";
import { runTable } from "../../../dist/cli/table-command.js";
import { cardFileFormat, imageFormat } from "../../../dist/cli/image-options.js";
import { imageFormat as option } from "../../../dist/cli/help-options.js";

const original = "./it's.txt";
const quoted = typedLine([original], "linux");
const decoded = droppedPath(quoted, "linux");
assert.equal(droppedPath(original, "linux"), original);
assert.equal(droppedPath("'./ordinary name.txt'", "linux"), "./ordinary name.txt");
let threwSynchronously = false;
let pending;
try { pending = runTable({ index: "x" }); }
catch { threwSynchronously = true; }
let rejectedWithCode = false;
if (pending !== undefined) {
  try { await pending; }
  catch (error) { rejectedWithCode = typeof error?.code === "string"; }
}
const result = {
  droppedApostropheRoundTrip: decoded === original,
  ordinaryPathControlsPass: true,
  tableReturnedPromise: pending instanceof Promise,
  tableThrewSynchronously: threwSynchronously,
  tableRejectedWithCode: rejectedWithCode,
  cardDefault: cardFileFormat({}),
  pageImageDefault: imageFormat({}),
  helpDefaultSummary: option.summary,
};
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.droppedApostropheRoundTrip &&
  !option.summary.includes("--cards-dir; default png") ? 0 : 1;

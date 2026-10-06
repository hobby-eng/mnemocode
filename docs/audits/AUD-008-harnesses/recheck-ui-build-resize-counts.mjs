// AUD-008-UI001: execute exact terminal-choice function bodies with synthetic terminal I/O.
// The next Down arrives after a 120 -> 40 resize. This is a row-count/reflow model, NOT a capture
// of an actual host terminal emulator or a replacement for real protected PTY acceptance.
// Run: node docs/audits/AUD-008-harnesses/recheck-ui-build-resize-counts.mjs
// Exits nonzero if the first redraw after the modeled reflow uses the stale physical row count.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import vm from "node:vm";

const choicePath = "src/cli/terminal-choice.ts";
const menuPath = "src/cli/menu.ts";
const choiceSource = readFileSync(choicePath, "utf8");
const menuSource = readFileSync(menuPath, "utf8");
const entries = menuSource.slice(
  menuSource.indexOf("export const MENU_ENTRIES:"),
  menuSource.indexOf("/** Arguments that no shell changes"),
);
const choices = [...entries.matchAll(/label: "([^"]+)"[\s\S]*?digit: (\d+)/gu)].map(
  ([, label, digit], index) => ({ label, digit: Number(digit), value: index }),
);
assert.equal(choices.length, 10, "Expected the reviewed ten literal top-level menu entries");
assert.ok(choices.every((choice) => /^[\x20-\x7e]+$/u.test(choice.label)));
const writes = [];
const stderr = { columns: 120, write: (text) => writes.push(text) };
let keyIndex = 0;
const context = {
  process: { stderr },
  STYLE: {},
  terminalPaint: (_channel, _code, text) => text,
  // Current choices/hint contain ASCII plus the single-cell selection marker only.
  displayWidth: (text) => [...text].length,
  withRawTerminal: (operation) =>
    operation(
      () => undefined,
      () => false,
    ),
  readKey: async () => {
    if (keyIndex++ === 0) {
      stderr.columns = 40;
      return { kind: "down" };
    }
    return { kind: "back" };
  },
};
const functions = stripTypeScriptTypes(choiceSource)
  .replace(/^import .*\n/gmu, "")
  .replace(/^export /gmu, "");
const { choose, rowsOf } = vm.runInNewContext(`${functions}\n({ choose, rowsOf });`, context);
await choose("What do you want to do?", choices, { label: "Task", quit: "quits" });
const initialLines = writes[1].split("\n").slice(0, -1);
stderr.columns = 120;
const initialRows = rowsOf(initialLines);
stderr.columns = 40;
const rowsAfterModeledReflow = rowsOf(initialLines);
const cursorUps = writes
  .flatMap((text) => [...text.matchAll(/\x1b\[(\d+)A/gu)])
  .map(([, count]) => Number(count));
assert.equal(cursorUps.length, 2, "Expected first Down redraw and final Escape cleanup");
const firstRedrawRows = cursorUps[0];
console.log(
  JSON.stringify(
    {
      sourceHashes: Object.fromEntries(
        [
          [choicePath, choiceSource],
          [menuPath, menuSource],
        ].map(([path, source]) => [path, createHash("sha256").update(source).digest("hex")]),
      ),
      method: "Exact stripped terminal-choice bodies; synthetic I/O and ASCII display width",
      terminalEmulatorReflowActuallyCaptured: false,
      modelAssumption: "Existing logical menu rows reflow to the new column width before next Down",
      originalColumns: 120,
      resizedColumns: 40,
      initialRows,
      rowsAfterModeledReflow,
      firstRedrawRows,
      rowsLeftByStaleCountInThisModel: rowsAfterModeledReflow - firstRedrawRows,
      cursorUps,
    },
    null,
    2,
  ),
);
if (firstRedrawRows !== rowsAfterModeledReflow) process.exitCode = 1;

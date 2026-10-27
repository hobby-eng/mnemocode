// Removes the network loader and the asynchronous start from the glue that wasm-bindgen 0.2.129
// writes for `--target web`, keeping initSync: a page checks the WebAssembly bytes against
// modules.json and passes them in, so nothing may fetch a file by URL (MnemoCode TS
// scripts/build-sskr-wasm.mjs, offlineGlue; mhfe scripts/remove-network-code.mjs). Every removed
// part must be found exactly once, so a wasm-bindgen update that changes the glue stops the build
// instead of leaving a loader behind.
//
//   node scripts/offline-glue.mjs <folder> <stem>   rewrites <stem>.js and <stem>.d.ts in place
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { networkCodeIn } from "./network-code.mjs";

/** `text` without the part from `start` up to, not including, `end`; each found exactly once. */
function removeSection(text, start, end, file) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || text.indexOf(start, from + 1) >= 0)
    throw new Error(`${file}: "${start.trim()}" up to "${end.trim()}" not found exactly once`);
  return text.slice(0, from) + text.slice(to);
}

/** `text` with `find` replaced by `replacement`; `find` must occur exactly once. */
function replaceOnce(text, find, replacement, file) {
  if (text.split(find).length !== 2)
    throw new Error(`${file}: "${find.trim()}" not found exactly once`);
  return text.replace(find, () => replacement);
}

function offlineGlue(glue, file) {
  const asyncExport = "\nexport { initSync, __wbg_init as default };";
  let text = removeSection(glue, "\nasync function __wbg_load", "\nfunction initSync", file);
  text = removeSection(text, "\nasync function __wbg_init", asyncExport, file);
  text = replaceOnce(text, asyncExport, "\nexport { initSync };", file);
  // Older glue of the same wasm-bindgen kept the module on __wbg_init; keep it on initSync then.
  if (text.includes("__wbg_init.__wbindgen_wasm_module = module;"))
    text = replaceOnce(
      text,
      "__wbg_init.__wbindgen_wasm_module = module;",
      "initSync.__wbindgen_wasm_module = module;",
      file,
    );
  const left = networkCodeIn(text);
  if (left !== undefined) throw new Error(`${file}: network code left: ${left}`);
  if (/\b__wbg_init\b|\b__wbg_load\b/u.test(text))
    throw new Error(`${file}: the asynchronous start is still referenced`);
  return text;
}

/** The declarations without the documented asynchronous start, which ends the file. */
function offlineDeclarations(declarations, file) {
  const start = declarations.lastIndexOf("export default function __wbg_init");
  const documentation = declarations.lastIndexOf("\n/**", start);
  if (start < 0 || documentation < 0)
    throw new Error(`${file}: the documented asynchronous start was not found`);
  if (!/^export default function __wbg_init[^\n]*;\s*$/u.test(declarations.slice(start)))
    throw new Error(`${file}: more follows the asynchronous start`);
  return `${declarations.slice(0, documentation).trimEnd()}\n`;
}

const [folder, stem] = process.argv.slice(2);
if (folder === undefined || stem === undefined || process.argv.length !== 4) {
  process.stderr.write("usage: node scripts/offline-glue.mjs <folder> <stem>\n");
  process.exit(2);
}
const glueFile = join(folder, `${stem}.js`);
const declarationsFile = join(folder, `${stem}.d.ts`);
writeFileSync(glueFile, offlineGlue(readFileSync(glueFile, "utf8"), glueFile));
writeFileSync(
  declarationsFile,
  offlineDeclarations(readFileSync(declarationsFile, "utf8"), declarationsFile),
);

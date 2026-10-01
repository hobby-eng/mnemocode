import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { format } from "prettier";

const generated = "docs/audits/AUD-006-evidence/sskr-wasm-rebuild/generated/";
const committed = "vendor/sskr/generated/";
const stem = "recovery_sskr_wasm";

function removeSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `Expected generated glue markers: ${startMarker}`);
  return source.slice(0, start) + source.slice(end);
}

let glue = await readFile(`${generated}${stem}.js`, "utf8");
const asyncInitTail = "\nexport { initSync, __wbg_init as default };";
glue = removeSection(glue, "\nasync function __wbg_load", "\nfunction initSync");
glue = removeSection(glue, "\nasync function __wbg_init", asyncInitTail).replace(
  asyncInitTail,
  "\nexport { initSync };",
);
glue = glue.replace("__wbg_init.__wbindgen_wasm_module = module;", "initSync.__wbindgen_wasm_module = module;");

const prettierOptions = {
  parser: "typescript",
  singleQuote: true,
  semi: true,
  trailingComma: "all",
  printWidth: 120,
};
let declarations = await readFile(`${generated}${stem}.d.ts`, "utf8");
const asyncInit = declarations.lastIndexOf("export default function __wbg_init");
const asyncInitDoc = declarations.lastIndexOf("\n/**", asyncInit);
assert.ok(asyncInit > 0 && asyncInitDoc > 0, "Expected generated async init declaration");
declarations = `${declarations.slice(0, asyncInitDoc).trimEnd()}\n`;

const files = {
  [`${stem}.js`]: Buffer.from(glue),
  [`${stem}.d.ts`]: Buffer.from(await format(declarations, prettierOptions)),
  [`${stem}_bg.wasm.d.ts`]: Buffer.from(
    await format(await readFile(`${generated}${stem}_bg.wasm.d.ts`, "utf8"), prettierOptions),
  ),
  [`${stem}_bg.wasm`]: await readFile(`${generated}${stem}_bg.wasm`),
};

for (const [name, bytes] of Object.entries(files)) {
  assert.deepEqual(bytes, await readFile(`${committed}${name}`), name);
  console.log(
    JSON.stringify({ name, identical: true, sha256: createHash("sha256").update(bytes).digest("hex") }),
  );
}
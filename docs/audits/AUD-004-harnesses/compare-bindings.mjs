// Apply the documented synchronous offline wrapper reduction to freshly generated bindings.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { format } from 'prettier';
const fresh = 'docs/audits/AUD-004-evidence/wasm-rebuild/generated/';
const pinned = 'vendor/sskr/generated/';
const stem = 'recovery_sskr_wasm';
function remove(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start);
  return source.slice(0, start) + source.slice(end);
}
let glue = await readFile(fresh + stem + '.js', 'utf8');
const tail = '\nexport { initSync, __wbg_init as default };';
glue = remove(glue, '\nasync function __wbg_load', '\nfunction initSync');
glue = remove(glue, '\nasync function __wbg_init', tail).replace(tail, '\nexport { initSync };');
glue = glue.replace('__wbg_init.__wbindgen_wasm_module = module;', 'initSync.__wbindgen_wasm_module = module;');
const opts = { parser: 'typescript', singleQuote: true, semi: true, trailingComma: 'all', printWidth: 120 };
let declarations = await readFile(fresh + stem + '.d.ts', 'utf8');
const init = declarations.lastIndexOf('export default function __wbg_init');
const doc = declarations.lastIndexOf('\n/**', init);
assert.ok(init > 0 && doc > 0);
declarations = declarations.slice(0, doc).trimEnd() + '\n';
const values = {
  [stem + '.js']: Buffer.from(glue),
  [stem + '.d.ts']: Buffer.from(await format(declarations, opts)),
  [stem + '_bg.wasm.d.ts']: Buffer.from(await format(await readFile(fresh + stem + '_bg.wasm.d.ts', 'utf8'), opts)),
  [stem + '_bg.wasm']: await readFile(fresh + stem + '_bg.wasm'),
};
for (const [name, bytes] of Object.entries(values)) {
  assert.deepEqual(bytes, await readFile(pinned + name), name);
  console.log(JSON.stringify({ name, identical: true, sha256: createHash('sha256').update(bytes).digest('hex') }));
}

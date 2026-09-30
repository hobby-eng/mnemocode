// Simulate a partial write using published shares. No real wallet data or production edit.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const destination = resolve('docs/audits/AUD-004-evidence/simulated-partial.pdf');
const original = fs.promises.writeFile;
fs.promises.writeFile = async function(path, data, options) {
  if (path !== destination) return original.call(this, path, data, options);
  await original.call(this, path, data.subarray(0, 16), options);
  throw Object.assign(new Error('Synthetic partial-write failure'), { code: 'ENOSPC' });
};
syncBuiltinESMExports();
try {
  const { exportSskrPdf } = await import(pathToFileURL(resolve('dist/export/sskr-cards.js')).href);
  const { official } = JSON.parse(fs.readFileSync('vectors/sskr-v1.json', 'utf8'));
  await assert.rejects(exportSskrPdf([official.shares[0]], { style: 'it', layout: 'qr', pageSize: 'business' }, destination), /Synthetic partial-write failure/);
  const stat = fs.statSync(destination);
  assert.equal(stat.size, 16);
  console.log(JSON.stringify({ injectedFailure: 'ENOSPC after 16 bytes', partialFinalPathRemains: true, bytes: stat.size, mode: (stat.mode & 0o777).toString(8) }));
} finally {
  fs.promises.writeFile = original;
  syncBuiltinESMExports();
  fs.rmSync(destination, { force: true });
}

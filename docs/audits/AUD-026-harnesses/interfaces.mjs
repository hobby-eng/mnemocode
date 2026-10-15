// Public interface/selector controls, no rendering and no large search.
import { readFile, access } from 'node:fs/promises';
import { nodeSharePlatform } from '../../../dist/sskr/share-platform-node.js';
import { parseArguments } from '../../../dist/cli/arguments.js';
import { transformMode } from '../../../dist/cli/input.js';
import { runTable } from '../../../dist/cli/table-command.js';

const results = [];
const record = (name, holds, actual) => { results.push({ name, holds, actual }); console.log(JSON.stringify(results.at(-1))); };
const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
let refusal;
try { await nodeSharePlatform.createShares(secret, 2, 3, new Uint8Array(31)); } catch (error) { refusal = error; }
record('owned-rust-refusal-code', refusal instanceof Error && typeof refusal.code === 'string', { type: typeof refusal, isError: refusal instanceof Error, hasCode: typeof refusal?.code === 'string', containsOwnedSeedLengthMessage: String(refusal).includes('exactly 32 bytes') });
const shares = await nodeSharePlatform.createShares(secret, 2, 3, new Uint8Array(32));
record('public-platform-valid-control', shares.length === 3, { shares: shares.length });
secret.fill(0);
record('help-example-effective-mode', transformMode(parseArguments(['--ask-secrets', '--format', '5'])) === 'direct', { actualMode: transformMode(parseArguments(['--ask-secrets', '--format', '5'])), meaning: 'Prose promises date prompts; the example selects direct. This control establishes current behavior, not prose correctness.' });

for (const options of [{ all: true, word: 'abandon' }, { all: true, index: '0' }, { word: 'abandon', index: '1' }]) {
  let bytes = 0, rejected = false;
  const writer = process.stdout.write;
  try {
    process.stdout.write = (chunk) => { bytes += Buffer.byteLength(chunk); return true; };
    runTable(options);
  } catch { rejected = true; }
  finally { process.stdout.write = writer; }
  record('exclusive-table-selectors-' + Object.keys(options).join('-'), rejected, { rejected, writtenBytes: bytes });
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const missing = [];
for (const [entry, files] of Object.entries(pkg.exports)) {
  for (const target of Object.values(files)) try { await access(target); } catch { missing.push({ entry, target }); }
}
record('package-export-targets', missing.length === 0, { entries: Object.keys(pkg.exports).length, missing });
console.log(JSON.stringify({ cases: results.length, failedContracts: results.filter(row => !row.holds).length }));
process.exitCode = results.some(row => !row.holds) ? 1 : 0;

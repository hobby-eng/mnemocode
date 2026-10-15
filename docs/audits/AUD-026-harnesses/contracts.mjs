// Public, bounded contract probes. No card painting or private wallet input.
import { readFile, mkdir, mkdtemp, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { EncodedForm } from '../../../dist/core/encoded-form.js';
import { coinById } from '../../../dist/core/coins.js';
import { parseBitcoinAddress, isPlacedKind } from '../../../dist/core/wallet-evidence.js';
import { encodeCandidateList, OpenedCandidateList } from '../../../dist/core/candidate-list.js';
import { resolveTemplateId } from '../../../dist/export/template-catalog.js';
import { readRenderAsset } from '../../../dist/export/platform.js';
import { validateProfile } from '../../../dist/export/card-settings.js';
import { nodeCardRenderer } from '../../../dist/export/platform-node.js';
import { SELF_TEST_CARD_DETAILS } from '../../../dist/export/self-test-cards.js';
import { renderIndividualCards } from '../../../dist/export/render.js';
import { exportIndividualCards } from '../../../dist/export/individual-cards.js';
import { ShareCardSet } from '../../../dist/export/sskr-render.js';
import { CheckedSskrBridge } from '../../../dist/sskr/bridge.js';
import { sskrVector, sskrSetVector } from '../../../dist/sskr/known-answers.js';
import { writeShare, parseShareFormat } from '../../../dist/sskr/transport.js';
import { nodeSharePlatform } from '../../../dist/sskr/share-platform-node.js';
import { ShareInput } from '../../../dist/sskr/share-input.js';
import { ShareRestore } from '../../../dist/sskr/share-restore.js';
import { JointRepair } from '../../../dist/sskr/joint-repair.js';
import { evidenceLabel, optionLabel } from '../../../dist/cli/option-copy.js';

const phrase = 'abandon '.repeat(11) + 'about';
const address = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const results = [];
const result = (name, holds, actual) => {
  results.push({ name, holds, actual });
  console.log(JSON.stringify({ name, holds, actual }));
};
const refusal = (action) => {
  try { action(); return undefined; } catch (error) { return error; }
};

if (['broad-color-digits', 'narrow-color-digits'].includes(process.argv[2])) {
  const codes = writeShare(sskrSetVector.shares[0], 'colors-unicode').trim().split(/\s+/u);
  const joined = codes.join('');
  const points = joined.match(/.{4}/gu);
  const broad = process.argv[2] === 'broad-color-digits';
  points[8] = broad ? 'E???' : 'E2?A'; points[9] = broad ? 'E???' : 'EECA';
  console.log(JSON.stringify({ phase: 'before-production-plan', codes: points.length, markedDigits: broad ? 6 : 1 }));
  const plan = await new JointRepair(nodeSharePlatform).plan([points.join(' '), sskrSetVector.shares[1]]);
  console.log(JSON.stringify({ phase: 'after-production-plan', verdict: plan.assessment.verdict }));
  plan.wipe();
  process.exit(0);
}

for (const [name, action] of [
  ['format-selector', () => EncodedForm.of(phrase)],
  ['coin-selector', () => coinById(phrase)],
  ['network-selector', () => parseBitcoinAddress(address, phrase)],
  ['template-selector', () => resolveTemplateId(phrase, 'colors')],
]) {
  const error = refusal(action);
  result(name, error !== undefined && !error.message.includes(phrase), {
    refused: error !== undefined, repeatsFixture: error?.message.includes(phrase), code: error?.code,
  });
}
try { await readRenderAsset({ readAsset: async () => { throw Error('host must not be called'); } }, phrase); }
catch (error) { result('asset-selector', !error.message.includes(phrase), { repeatsFixture: error.message.includes(phrase), code: error.code }); }
let coercions = 0;
const selector = { toString() { coercions++; return phrase; } };
refusal(() => EncodedForm.of(selector));
result('format-selector-no-coercion', coercions === 0, { coercions });

let reads = 0;
const paths = coinById('bitcoin').parse(address).pathsAt({ account: 0, branch: 0, get index() { return reads++ === 0 ? 0 : 2 ** 31; } });
result('validated-location-snapshot', paths.every(path => path.endsWith('/0')), { reads, paths });
for (const kind of ['constructor', 'toString', 'hasOwnProperty', '__proto__'])
  result('placed-kind-' + kind, !isPlacedKind(kind), { accepted: isPlacedKind(kind) });
result('placed-kind-controls', isPlacedKind('address') && !isPlacedKind('master-fingerprint') && !isPlacedKind('unknown'), {});
result('dash-testnet-hint', coinById('dash').addressFormsOn(true).includes('tdash'), { hint: coinById('dash').addressFormsOn(true), recognizedTestnet: coinById('dash').parse('tdash1kr0xt5wj85ht5u464rfysjrq75rewz9mysjwf59p').testnet });

for (const scope of ['global', 'record']) {
  const text = 'public synthetic passphrase';
  const bytes = encodeCandidateList({ passphrase: text, records: [{ entropy: new Uint8Array(16).fill(0x7f), ...(scope === 'record' ? { passphrase: text } : {}) }] });
  const list = OpenedCandidateList.fromBytes(bytes);
  bytes.fill(0);
  list.wipe();
  let retained = false;
  try { retained = list.candidates().some(candidate => candidate.passphrase === text); } catch { /* Terminal disposal may refuse. */ }
  result('wiped-candidate-list-' + scope, !retained, { retainsOriginalPassphrase: retained });
}

const font = fontkit.create(await readFile('assets/fonts/DejaVuSans-UI.ttf'));
for (const name of ['Jos\u00e9 Silva', 'Jean-Luc D\u2019Angelo', 'Jean\u2010Luc']) {
  const accepted = validateProfile({ name }).name;
  const missing = Array.from(accepted).filter(character => !font.characterSet.includes(character.codePointAt(0))).map(character => character.codePointAt(0));
  result('accepted-profile-font-' + name, missing.length === 0, { accepted: true, missingCodePoints: missing });
}

const content = { kind: 'colors', colors: new Array(12).fill('#468080'), labels: [...new Array(11).fill('7684'), '5728'], payload: [...new Array(11).fill('7684'), '5728'].join(' '), ...SELF_TEST_CARD_DETAILS };
const template = { id: 'audit-opaque', kind: 'colors', name: 'Public opaque fixture', description: 'No PDF renderer', render: async () => { throw Error('unexpected sheet'); }, renderIndividual: async () => Uint8Array.of(1, 2, 3) };
let captured;
const failing = { ...template, renderIndividual: async (_drawing, _content, index) => { if (index === 1) throw Error('synthetic second-card failure'); return captured = Uint8Array.of(1, 2, 3); } };
try { await renderIndividualCards(nodeCardRenderer, failing, content); } catch { /* Expected synthetic fault. */ }
result('failed-render-owned-buffer', captured !== undefined && captured.every(byte => byte === 0), { captured: captured !== undefined, wiped: captured?.every(byte => byte === 0) });
const successful = await renderIndividualCards(nodeCardRenderer, template, content);
result('successful-render-ownership-control', successful.every(card => card.bytes[0] === 1), { cards: successful.length });
successful.forEach(card => card.bytes.fill(0));
const unsafe = { ...content, colors: [...content.colors, '#468080'], labels: [...content.labels, 'x/../../escaped'], decoys: 1 };
const scratchRoot = resolve('../tmp/mnemocode-aud-026/filename-probe');
await mkdir(scratchRoot, { recursive: true });
const scratch = await mkdtemp(scratchRoot + '/run-');
let exportError;
try { await exportIndividualCards(template, unsafe, scratch + '/cards', 'pdf'); } catch (error) { exportError = error; }
const escaped = await stat(scratch + '/escaped.pdf').then(() => true, () => false);
result('decoy-filename-confined', !escaped, { escapedNewSiblingFile: escaped, rejected: exportError !== undefined, errorCode: exportError?.code });

const nullCards = await ShareCardSet.create(nodeCardRenderer, [sskrVector.shares[0]], { style: 'it', shareFormat: null, ...SELF_TEST_CARD_DETAILS }, () => 0);
result('null-share-format-refused', false, { accepted: true, printedCards: nullCards.printedCodes(0).length, directParserRefuses: refusal(() => parseShareFormat(null)) !== undefined });

for (const kind of ['address', 'master-xpub', 'account-xpub'])
  result('evidence-label-' + kind, evidenceLabel({ kind }) !== 'unknown option', { label: evidenceLabel({ kind }) });
result('supported-account-option-label', optionLabel('account') !== 'unknown option', { label: optionLabel('account') });

async function freshBridge(name) {
  const raw = await import('../../../sskr-wasm/generated/recovery_sskr_wasm.js?audit026=' + name);
  const initialized = raw.initSync({ module: await readFile('sskr-wasm/generated/recovery_sskr_wasm_bg.wasm') });
  return { bridge: new CheckedSskrBridge(raw), memory: initialized.memory };
}
function occurrences(memory, pattern) {
  const bytes = new Uint8Array(memory.buffer);
  let count = 0;
  for (let index = 0; index <= bytes.length - pattern.length; index++) {
    if (pattern.every((value, offset) => value === bytes[index + offset])) count++;
  }
  return count;
}
for (const shape of ['null-group', 'null-seed', 'seed-31', 'seed-33', 'valid']) {
  const { bridge, memory } = await freshBridge(shape);
  const secret = Uint8Array.from({ length: 32 }, (_, index) => 0x71 + index);
  const before = occurrences(memory, secret);
  let thrown;
  try { bridge.create_sskr_shares(secret, 1, shape === 'null-group' ? null : Uint8Array.of(2, 3), shape === 'null-seed' ? null : new Uint8Array(shape === 'seed-31' ? 31 : shape === 'seed-33' ? 33 : 32)); }
  catch (error) { thrown = error; }
  const after = occurrences(memory, secret);
  result('wasm-ended-owner-' + shape, after <= before, { beforeOccurrences: before, afterOccurrences: after, refused: thrown !== undefined, refusalMessage: thrown?.message, borrowedSecretUnchanged: secret.every((value, index) => value === 0x71 + index), wasmMemoryBytes: memory.buffer.byteLength });
  secret.fill(0);
}

for (const abort of [false, true]) {
  const colors = writeShare(sskrSetVector.shares[1], 'colors').trim().split(/\s+/u);
  colors[5] = '?';
  const input = new ShareInput({ decodeEntry: 'Decode' });
  input.add([sskrSetVector.shares[0], colors.join(' ')]);
  const restore = new ShareRestore(nodeSharePlatform);
  const read = await restore.read(input);
  if (read.kind !== 'marked') throw Error('Unexpected public marked fixture: ' + read.kind);
  const controller = new AbortController();
  let finalCalls = 0;
  const searched = await restore.search(read, { signal: controller.signal, onProgress(progress) { if (progress.checked === progress.total) { finalCalls++; if (abort) controller.abort(); } } });
  result('sskr-final-progress-' + (abort ? 'abort' : 'live'), searched.kind === (abort ? 'stopped' : 'sets'), { kind: searched.kind, aborted: controller.signal.aborted, finalCalls });
}

console.log(JSON.stringify({ total: results.length, failedContracts: results.filter(row => !row.holds).length }));
process.exitCode = results.some(row => !row.holds) ? 1 : 0;

import { masterFingerprint } from '../bitcoin-evidence.js';
import { STYLE, terminalColor, terminalPaint } from './terminal.js';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist as traditionalChineseWordlist } from '@scure/bip39/wordlists/traditional-chinese.js';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import {
  decodeInput,
  decodeInputDirect,
  decodeInputLegacy,
  encodeMnemonic,
  encodeMnemonicLegacy,
  formatEncoded,
  parseDate,
  recoverLegacyValidLastWords,
  recoverMissingWord,
  representMnemonic,
  type OutputFormat,
} from '../core.js';
import { decodeQrPngFile } from './qr-input.js';
import { exportQrPayload } from './qr-export.js';
import { PDFDocument } from 'pdf-lib';
import { cardTemplates } from '../export/templates.js';
import { indexesToColors } from '../core.js';
import { assertSskrSelfTest } from '../sskr/self-test.js';
import { MNEMOCODE_VERSION } from '../version.js';

const PUBLIC_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const CHECKSUM_VALID_DATE = [parseDate('23-09-2026')];
const CHECKSUM_VALID_ENGLISH =
  'wool abuse actual wool abuse actual wool abuse actual wool abuse congress';
const LEGACY_SOURCE =
  'oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog';
const LEGACY_DATES = ['10-07-1963', '27-04-1956', '31-01-1994'].map(parseDate);
const LEGACY_ENGLISH =
  'mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital';
const CHINESE_WORDLIST_SHA256 = '407312f9014543242bd157c255125a753ac60128fc15883a33b8685a9328b0cc';
const WORDLIST_SHA256 = '187db04a869dd9bc7be80d21a86497d692c0db6abd3aa8cb6be5d618ff757fae';
const FORMATS = [
  'english',
  'indexes',
  'unicode',
  'colors',
  'colors-unicode',
] as const satisfies readonly Exclude<OutputFormat, 'json'>[];

interface PublicVector {
  readonly name: string;
  readonly mode: 'direct' | 'seedshift' | 'seedshift-legacy';
  readonly sourceMnemonic: string;
  readonly dates: readonly string[];
  readonly english: string;
  readonly indexes: string;
  readonly unicode: string;
  readonly colors: string;
  readonly colorsUnicode: string;
  readonly sourceFingerprint?: string;
  readonly encodedFingerprint?: string;
}

const REQUIRED_VECTOR_NAMES = new Set([
  'direct-12',
  'checksum-valid-seedshift-12',
  'checksum-valid-seedshift-15',
  'checksum-valid-seedshift-18',
  'checksum-valid-seedshift-21',
  'checksum-valid-seedshift-24',
  'legacy-seedshift-12',
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0)
    throw new Error(`${label}.${key} must be a non-empty string.`);
  return value;
}

function requiredStrings(record: Record<string, unknown>, key: string, label: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`${label}.${key} must be an array of strings.`);
  return value;
}

function validateVector(value: unknown, index: number): PublicVector {
  const label = `vectors[${index}]`;
  if (!isObject(value)) throw new Error(`${label} must be an object.`);
  const mode = requiredString(value, 'mode', label);
  if (mode !== 'direct' && mode !== 'seedshift' && mode !== 'seedshift-legacy')
    throw new Error(`${label}.mode is unsupported.`);
  const sourceMnemonic = requiredString(value, 'sourceMnemonic', label);
  if (!validateMnemonic(sourceMnemonic, englishWordlist))
    throw new Error(`${label}.sourceMnemonic must be a valid English BIP39 mnemonic.`);
  const dates = requiredStrings(value, 'dates', label);
  if ((mode === 'direct' && dates.length !== 0) || (mode !== 'direct' && dates.length === 0))
    throw new Error(`${label}.dates does not match its mode.`);
  dates.forEach(parseDate);
  const fingerprint = (key: 'sourceFingerprint' | 'encodedFingerprint') => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== 'string' || !/^[0-9a-f]{8}$/u.test(candidate))
      throw new Error(`${label}.${key} must be eight lowercase hexadecimal characters.`);
    return candidate;
  };
  return {
    name: requiredString(value, 'name', label),
    mode,
    sourceMnemonic,
    dates,
    english: requiredString(value, 'english', label),
    indexes: requiredString(value, 'indexes', label),
    unicode: requiredString(value, 'unicode', label),
    colors: requiredString(value, 'colors', label),
    colorsUnicode: requiredString(value, 'colorsUnicode', label),
    sourceFingerprint: fingerprint('sourceFingerprint'),
    encodedFingerprint: fingerprint('encodedFingerprint'),
  };
}

function equal(actual: unknown, expected: unknown, name: string): void {
  if (actual !== expected) throw new Error(`${name} mismatch.`);
}

function wordlistDigest(): string {
  return createHash('sha256').update(englishWordlist.join('\n')).digest('hex');
}

function runCoreChecks(): void {
  equal(englishWordlist.length, 2048, 'English BIP39 word-list length');
  equal(wordlistDigest(), WORDLIST_SHA256, 'English BIP39 word-list SHA-256');
  equal(traditionalChineseWordlist.length, 2048, 'Traditional Chinese BIP39 word-list length');
  equal(
    createHash('sha256').update(traditionalChineseWordlist.join('\n')).digest('hex'),
    CHINESE_WORDLIST_SHA256,
    'Traditional Chinese BIP39 word-list SHA-256',
  );

  const direct = representMnemonic(PUBLIC_MNEMONIC);
  equal(
    decodeInputDirect(formatEncoded(direct, 'unicode'), 'unicode').recoveredMnemonic,
    PUBLIC_MNEMONIC,
    'Direct Unicode round trip',
  );
  const recoveredWords = recoverMissingWord(PUBLIC_MNEMONIC.replace(/about$/u, '?'));
  equal(recoveredWords.length, 128, 'Forgotten final-word candidate count');
  const recoveredAbout = recoveredWords.find((candidate) => candidate.word === 'about');
  equal(recoveredAbout?.wordIndex, 4, 'Forgotten-word BIP39 index');
  equal(recoveredAbout?.checksumBits, '0011', 'Forgotten-word checksum bits');
  equal(recoveredAbout?.mnemonic, PUBLIC_MNEMONIC, 'Forgotten-word public vector');

  const legacyLastWords = recoverLegacyValidLastWords(LEGACY_ENGLISH);
  equal(legacyLastWords.length, 128, 'Legacy final-word candidate count');
  equal(
    legacyLastWords.filter((candidate) => candidate.preservesLegacyEntropy).length,
    1,
    'Legacy entropy-preserving final-word count',
  );

  const shifted = encodeMnemonic(PUBLIC_MNEMONIC, CHECKSUM_VALID_DATE);
  equal(
    shifted.shiftedEnglish.join(' '),
    CHECKSUM_VALID_ENGLISH,
    'Checksum-valid Seedshift vector',
  );
  if (!validateMnemonic(shifted.shiftedEnglish.join(' '), englishWordlist))
    throw new Error('Checksum-valid Seedshift produced an invalid BIP39 checksum.');
  equal(
    decodeInput(CHECKSUM_VALID_ENGLISH, 'english', CHECKSUM_VALID_DATE).recoveredMnemonic,
    PUBLIC_MNEMONIC,
    'Checksum-valid Seedshift reverse vector',
  );

  const legacy = encodeMnemonicLegacy(LEGACY_SOURCE, LEGACY_DATES);
  equal(legacy.shiftedEnglish.join(' '), LEGACY_ENGLISH, 'Legacy Seedshift vector');
  equal(
    decodeInputLegacy(LEGACY_ENGLISH, 'english', LEGACY_DATES).recoveredMnemonic,
    LEGACY_SOURCE,
    'Legacy Seedshift reverse vector',
  );
}

export function assertCoreSelfTest(): void {
  try {
    runCoreChecks();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `CRITICAL: MnemoCode core self-test failed.\nNo mnemonic data was processed.\n${detail}`,
    );
  }
}

async function loadPublicVectors(): Promise<readonly PublicVector[]> {
  const path = new URL('../../vectors/mnemocode-v1.json', import.meta.url);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.vectors))
    throw new Error('Public vector file has an unsupported structure.');
  const vectors = parsed.vectors.map(validateVector);
  const names = new Set(vectors.map((vector) => vector.name));
  if (names.size !== vectors.length) throw new Error('Public vector names must be unique.');
  for (const name of REQUIRED_VECTOR_NAMES) {
    if (!names.has(name))
      throw new Error(`Public vector file is missing required vector: ${name}.`);
  }
  return vectors;
}

function resultForVector(vector: PublicVector) {
  const parsedDates = vector.dates.map(parseDate);
  if (vector.mode === 'direct') return representMnemonic(vector.sourceMnemonic);
  if (vector.mode === 'seedshift') return encodeMnemonic(vector.sourceMnemonic, parsedDates);
  return encodeMnemonicLegacy(vector.sourceMnemonic, parsedDates);
}

async function checkPublicVectors(): Promise<number> {
  const vectors = await loadPublicVectors();
  for (const vector of vectors) {
    const result = resultForVector(vector);
    equal(formatEncoded(result, 'english'), vector.english, `${vector.name} English`);
    equal(formatEncoded(result, 'indexes'), vector.indexes, `${vector.name} indexes`);
    equal(formatEncoded(result, 'unicode'), vector.unicode, `${vector.name} Unicode`);
    equal(formatEncoded(result, 'colors'), vector.colors, `${vector.name} colors`);
    equal(
      formatEncoded(result, 'colors-unicode'),
      vector.colorsUnicode,
      `${vector.name} colors-unicode`,
    );
    if (vector.sourceFingerprint !== undefined)
      equal(
        masterFingerprint(result.sourceMnemonic),
        vector.sourceFingerprint,
        `${vector.name} source fingerprint`,
      );
    if (vector.encodedFingerprint !== undefined)
      equal(
        masterFingerprint(result.shiftedEnglish.join(' ')),
        vector.encodedFingerprint,
        `${vector.name} encoded fingerprint`,
      );
  }
  return vectors.length;
}

function checkAllLengthsAndFormats(): number {
  const entropySizes = [16, 20, 24, 28, 32] as const;
  const dates = [parseDate('23-09-2026'), parseDate('08-08-1988'), parseDate('07-11-1951')];
  let count = 0;
  for (const entropySize of entropySizes) {
    const mnemonic = entropyToMnemonic(
      Uint8Array.from({ length: entropySize }, (_, index) => index),
      englishWordlist,
    );
    for (const format of FORMATS) {
      const direct = representMnemonic(mnemonic);
      equal(
        decodeInputDirect(formatEncoded(direct, format), format).recoveredMnemonic,
        mnemonic,
        `${entropySize}-byte direct ${format}`,
      );
      const shifted = encodeMnemonic(mnemonic, dates);
      equal(
        decodeInput(formatEncoded(shifted, format), format, dates).recoveredMnemonic,
        mnemonic,
        `${entropySize}-byte Seedshift ${format}`,
      );
      const legacy = encodeMnemonicLegacy(mnemonic, dates);
      equal(
        decodeInputLegacy(formatEncoded(legacy, format), format, dates).recoveredMnemonic,
        mnemonic,
        `${entropySize}-byte legacy ${format}`,
      );
      count += 3;
    }
  }
  return count;
}

function checkDateOrdering(): void {
  const first = [parseDate('23-09-2026'), parseDate('08-08-1988'), parseDate('07-11-1951')];
  const reversed = [...first].reverse();
  equal(
    formatEncoded(encodeMnemonic(PUBLIC_MNEMONIC, first), 'indexes'),
    formatEncoded(encodeMnemonic(PUBLIC_MNEMONIC, reversed), 'indexes'),
    'Date-order independence',
  );
}

async function checkQrRoundTrip(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'mnemocode-self-test-'));
  const path = join(directory, 'vector.png');
  const payload = formatEncoded(encodeMnemonic(PUBLIC_MNEMONIC, CHECKSUM_VALID_DATE), 'unicode');
  try {
    await exportQrPayload(payload, path);
    equal(await decodeQrPngFile(path), payload, 'QR write/read round trip');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function checkCardExports(): Promise<void> {
  const colors = indexesToColors(representMnemonic(PUBLIC_MNEMONIC).shiftedIndexes);
  // Mixed covers the seven business artworks. Material families and glass 4/6/8
  // each have independent artwork paths; exercise each without repeating business styles.
  for (const template of cardTemplates.filter(
    (item) =>
      item.id === 'business-mixed' ||
      item.id.startsWith('material-') ||
      item.id.startsWith('business-glass-'),
  )) {
    // Exercises local images, embedded font, individual-card QR suppression,
    // and the production PDF renderer.
    const bytes = await template.render({
      kind: 'colors',
      colors,
      payload: colors.join(' '),
      pageSize: 'a6',
      orientation: 'landscape',
      cardQr: true,
      profile: {
        name: 'Alex Morgan',
        role: 'Design Director',
        company: 'VECTOR STUDIO',
        email: 'alex@vector.example',
        phone: '+44 20 7946 0281',
        website: 'vector.example',
        location: 'London',
      },
      presentation: {
        studioName: 'VECTOR STUDIO',
        slogan: 'Design with purpose.',
        subtitle: 'Selected finishes',
        footer: 'Crafted with care.',
        referenceLabel: 'Ref.',
      },
    });
    const pdf = await PDFDocument.load(bytes);
    equal(pdf.getPageCount(), 1, `${template.id} A6 page count`);
    if (Math.abs(pdf.getPage(0).getWidth() - (148 * 72) / 25.4) > 0.01)
      throw new Error(`${template.id} A6 dimensions mismatch.`);
  }
}

export async function runSelfTest(): Promise<void> {
  const started = performance.now();
  const rows: Array<readonly [string, string]> = [];
  const step = async (
    name: string,
    check: () => void | Promise<void>,
    detail: string,
  ): Promise<void> => {
    const stepStarted = performance.now();
    await check();
    rows.push([name, `${detail} (${(performance.now() - stepStarted).toFixed(1)} ms)`]);
  };

  await step('Core integrity', runCoreChecks, 'word list and fixed forward/reverse vectors');
  await step(
    'SSKR integrity',
    assertSskrSelfTest,
    'pinned WASM, official grouped vector and color transport',
  );
  let publicVectorCount = 0;
  await step(
    'Public vectors',
    async () => {
      publicVectorCount = await checkPublicVectors();
    },
    'versioned JSON file',
  );
  let roundTripCount = 0;
  await step(
    'Representation matrix',
    () => {
      roundTripCount = checkAllLengthsAndFormats();
    },
    'all lengths, formats, and modes',
  );
  await step('Date ordering', checkDateOrdering, 'deterministic sorting');
  await step('QR adapter', checkQrRoundTrip, 'PNG write and local read');
  await step(
    'Card export assets',
    checkCardExports,
    'approved templates, fonts, artwork and single-page A6 PDF',
  );

  const summary = `${publicVectorCount} public vectors; ${roundTripCount} representation round trips; ${(performance.now() - started).toFixed(1)} ms total.`;
  if (terminalColor('stdout')) {
    // The terminal look of the bip_tools tools: a title line, a ✓ per check, grey details.
    const paint = (code: string, text: string): string => terminalPaint('stdout', code, text);
    console.log(
      `\n${paint(STYLE.heading, 'MnemoCode')} ${paint(STYLE.muted, '·')} ${paint(STYLE.strong, `Self-test ${MNEMOCODE_VERSION}`)}`,
    );
    for (const [name, detail] of rows)
      console.log(`${paint(STYLE.good, '✓')} ${name.padEnd(24)} ${paint(STYLE.muted, detail)}`);
    console.log(`${paint(STYLE.good, '✓ Passed:')} ${summary}`);
    return;
  }
  console.log(`MnemoCode ${MNEMOCODE_VERSION} self-test`);
  console.log('────────────────────────────────────────────────────────────────────────');
  for (const [name, detail] of rows) console.log(`✓ ${name.padEnd(24)} ${detail}`);
  console.log('────────────────────────────────────────────────────────────────────────');
  console.log(`PASS  ${summary}`);
}

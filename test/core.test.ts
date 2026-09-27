import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import QRCode from 'qrcode';
import {
  decodeInput,
  decodeInputLegacy,
  detectInputFormats,
  decodeIndexesLegacyValid,
  decodeInputDirect,
  encodeMnemonic,
  encodeMnemonicLegacy,
  expandDatePattern,
  formatEncoded,
  indexesToColors,
  legacyChecksumValidResult,
  parseDate,
  parseDatePattern,
  parseInput,
  representMnemonic,
  colorsToIndexes,
  colorsToUnicode,
  unicodeToColors,
} from '../src/core.js';
import { matchBitcoinEvidence } from '../src/bitcoin-evidence.js';
import { decodeQrPngFile } from '../src/cli/qr-input.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist as englishWordlist } from '@scure/bip39/wordlists/english.js';
import { parseRecord, serializeRecord } from '../src/record.js';
import { assertCoreSelfTest } from '../src/cli/self-test.js';

const source = 'oppose duck hello neglect reveal key humor mosquito road evoke flock hedgehog';
const dates = ['10-07-1963', '27-04-1956', '31-01-1994'].map(parseDate);
const expected = 'mosquito dust hotel maximum rich kitten hair mother salute dream flush hospital';

describe('startup core self-test', () => {
  it('accepts the bundled word list and fixed forward/reverse vectors', () => {
    expect(() => assertCoreSelfTest()).not.toThrow();
  });
});

describe('original Seedshift compatibility mode', () => {
  it('rejects a source phrase whose words exist but whose BIP39 checksum is invalid', () => {
    expect(() =>
      encodeMnemonic(
        'table dial lion ginger smile science impact certain melody life limit silver',
        dates,
      ),
    ).toThrow('invalid BIP39 checksum');
  });

  it('rejects a source word outside the English BIP39 list', () => {
    expect(() =>
      encodeMnemonic(
        'table dial notaword ginger smile science impact certain melody life limit silver',
        dates,
      ),
    ).toThrow('Unknown English BIP39 word at position 3.');
  });

  it('rejects a non-English lookalike character inside a BIP39 word', () => {
    expect(() =>
      encodeMnemonic(
        'tablе dial predict ginger smile science impact certain melody life limit silver',
        dates,
      ),
    ).toThrow('Unknown English BIP39 word');
  });

  it('reproduces the documented Seedshift example', () => {
    const result = encodeMnemonicLegacy(source, dates);
    expect(formatEncoded(result, 'english')).toBe(expected);
    expect(formatEncoded(result, 'indexes')).toBe(
      '1153 547 882 1100 1483 987 835 1154 1527 533 719 880',
    );
    expect(formatEncoded(result, 'unicode')).toBe(
      '5BF65B57616272386C2E6FC34E4E534895CA52E2932F4E95',
    );
  });

  it('recovers the original words from the documented Seedshift example', () => {
    const result = decodeInputLegacy(expected, 'english', dates);
    expect(result.recoveredMnemonic).toBe(source);
    expect(result.checksumValid).toBe(true);
  });

  it('round-trips the continuous Unicode code-point representation', () => {
    const encoded = encodeMnemonicLegacy(source, dates);
    const decoded = decodeInputLegacy(formatEncoded(encoded, 'unicode'), 'unicode', dates);
    expect(decoded.recoveredMnemonic).toBe(source);
  });

  it('keeps a date’s order independent of command-line order', () => {
    const ordered = encodeMnemonicLegacy(
      source,
      [...dates].sort((left, right) => left.year - right.year),
    );
    expect(formatEncoded(encodeMnemonicLegacy(source, dates), 'unicode')).toBe(
      formatEncoded(ordered, 'unicode'),
    );
  });
});

describe('legacy checksum-word replacement', () => {
  const entropySizes = [16, 20, 24, 28, 32] as const;
  const expectedCandidates = [128, 64, 32, 16, 8] as const;

  for (const [position, entropySize] of entropySizes.entries()) {
    it(`offers a valid replacement and enumerates ${expectedCandidates[position]} candidates for ${(entropySize * 3) / 4} words`, () => {
      const mnemonic = entropyToMnemonic(
        Uint8Array.from({ length: entropySize }, (_, index) => index),
        englishWordlist,
      );
      const legacy = encodeMnemonicLegacy(mnemonic, [parseDate('23-09-2026')]);
      const corrected = legacyChecksumValidResult(legacy);
      expect(representMnemonic(corrected.shiftedEnglish.join(' ')).sourceMnemonic).toBe(
        corrected.shiftedEnglish.join(' '),
      );
      const candidates = decodeIndexesLegacyValid(corrected.shiftedIndexes, [
        parseDate('23-09-2026'),
      ]);
      expect(candidates).toHaveLength(expectedCandidates[position]);
      expect(candidates.some((candidate) => candidate.recoveredMnemonic === mnemonic)).toBe(true);
    });
  }
});

describe('checksum-valid Seedshift mode', () => {
  const publicMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const oneDate = [parseDate('23-09-2026')];

  it('reproduces the explained twelve-word checksum-valid example', () => {
    const encoded = encodeMnemonic(publicMnemonic, oneDate);
    expect(encoded.shiftedEnglish.join(' ')).toBe(
      'wool abuse actual wool abuse actual wool abuse actual wool abuse congress',
    );
    expect(
      decodeInput(encoded.shiftedEnglish.join(' '), 'english', oneDate).recoveredMnemonic,
    ).toBe(publicMnemonic);
  });

  it('always emits a valid BIP39 phrase and wrong dates yield a different valid phrase', () => {
    const encoded = encodeMnemonic(publicMnemonic, oneDate);
    expect(representMnemonic(encoded.shiftedEnglish.join(' ')).sourceMnemonic).toBe(
      encoded.shiftedEnglish.join(' '),
    );
    const wrong = decodeInput(encoded.shiftedEnglish.join(' '), 'english', [
      parseDate('24-09-2026'),
    ]);
    expect(wrong.checksumValid).toBe(true);
    expect(wrong.recoveredMnemonic).not.toBe(publicMnemonic);
  });
});

describe('direct representation mode', () => {
  it('round-trips a mnemonic through the Unicode code-point representation without dates', () => {
    const encoded = representMnemonic(source);
    expect(encoded.dates).toEqual([]);
    expect(encoded.shifts).toEqual(Array.from({ length: 12 }, () => 0));
    const continuous = formatEncoded(encoded, 'unicode');
    const decoded = decodeInputDirect(continuous, 'unicode');
    expect(decoded.recoveredMnemonic).toBe(source);
    expect(decoded.checksumValid).toBe(true);
    const spaced = continuous.match(/.{4}/gu)!.join(' ');
    expect(decodeInputDirect(spaced, 'unicode').recoveredMnemonic).toBe(source);
  });

  it('round-trips a mnemonic through the color representation without dates', () => {
    const encoded = representMnemonic(source);
    const decoded = decodeInputDirect(formatEncoded(encoded, 'colors'), 'colors');
    expect(decoded.recoveredMnemonic).toBe(source);
    expect(decoded.checksumValid).toBe(true);
  });
});

describe('all standard BIP39 lengths and representations', () => {
  const formats = ['english', 'indexes', 'unicode', 'colors', 'colors-unicode'] as const;
  const entropySizes = [16, 20, 24, 28, 32] as const;

  for (const entropySize of entropySizes) {
    const mnemonic = entropyToMnemonic(
      Uint8Array.from({ length: entropySize }, (_, index) => index),
      englishWordlist,
    );
    const wordCount = (entropySize * 3) / 4;
    for (const format of formats) {
      it(`round-trips ${wordCount} words in ${format} for direct and seedshift modes`, () => {
        const direct = representMnemonic(mnemonic);
        expect(decodeInputDirect(formatEncoded(direct, format), format).recoveredMnemonic).toBe(
          mnemonic,
        );
        const shifted = encodeMnemonic(mnemonic, [parseDate('23-09-2026')]);
        expect(
          decodeInput(formatEncoded(shifted, format), format, [parseDate('23-09-2026')])
            .recoveredMnemonic,
        ).toBe(mnemonic);
      });
    }
  }
});

describe('raw input format detection', () => {
  const formats = ['english', 'indexes', 'unicode', 'colors', 'colors-unicode'] as const;
  for (const format of formats) {
    it(`recognizes ${format} without a format flag`, () => {
      const encoded = formatEncoded(representMnemonic(source), format);
      expect(detectInputFormats(encoded)).toEqual([format]);
    });

    it(`ignores surrounding whitespace while recognizing ${format}`, () => {
      const encoded = formatEncoded(representMnemonic(source), format);
      expect(detectInputFormats(` \n${encoded}\t `)).toEqual([format]);
    });
  }

  it('returns no candidate for empty, truncated, or malformed data', () => {
    expect(detectInputFormats('')).toEqual([]);
    expect(detectInputFormats('abandon abandon')).toEqual([]);
    expect(detectInputFormats('#000000 #000001')).toEqual([]);
    expect(detectInputFormats('not-a-representation')).toEqual([]);
  });

  it('reports every strict match instead of guessing an ambiguous numeric input', () => {
    const ambiguous = '76 84 57 28 90 19 59 27 62 11 89 81 66 42 75 28 50 11 52 30 57 30 62 10';
    expect(detectInputFormats(ambiguous)).toEqual(['indexes', 'unicode']);
  });

  it('does not treat alternate JavaScript number syntax as recorded indexes', () => {
    const valid = Array.from({ length: 12 }, (_, index) => String(index + 1));
    for (const invalid of ['1e3', '+1', '1.0', '0x10', 'Infinity', 'NaN']) {
      expect(() => parseInput([invalid, ...valid.slice(1)].join(' '), 'indexes')).toThrow(
        'decimal integers',
      );
    }
  });
});

describe('versioned records', () => {
  it('carries mode and format while preserving the raw payload', () => {
    const raw = formatEncoded(encodeMnemonic(source, dates), 'unicode');
    const record = serializeRecord('seedshift', 'unicode', raw);
    expect(parseRecord(record)).toEqual({
      version: 1,
      mode: 'seedshift',
      format: 'unicode',
      payload: raw,
    });
    expect(parseRecord(raw)).toBeUndefined();
  });

  it('rejects unsupported and malformed record headers', () => {
    expect(() => parseRecord('MNC2:direct:unicode:5BF6')).toThrow(
      'Unsupported MnemoCode record version',
    );
    expect(() => parseRecord('MNC1:direct:unknown:abc')).toThrow(
      'Unsupported MnemoCode record format',
    );
    expect(() => parseRecord('MNC1 broken')).toThrow('Malformed MnemoCode record header');
  });

  it('accepts file whitespace around a record but preserves its payload exactly', () => {
    const raw = formatEncoded(representMnemonic(source), 'colors-unicode');
    expect(
      parseRecord(`\ufeff  ${serializeRecord('direct', 'colors-unicode', raw)}\n`)?.payload,
    ).toBe(raw);
  });
});

describe('date patterns', () => {
  it('expands a forgotten day only across that calendar month', () => {
    const datesInLeapFebruary = expandDatePattern(parseDatePattern('??-02-2024'));
    expect(datesInLeapFebruary).toHaveLength(29);
    expect(datesInLeapFebruary[28]).toEqual({ year: 2024, month: 2, day: 29 });
  });
});

describe('BIP39Colors-compatible representation', () => {
  const colors = [
    '#01AB63',
    '#225531',
    '#3E8775',
    '#613911',
    '#7C5809',
    '#98BDC1',
    '#B8E412',
    '#E3AFE8',
  ];
  const sourceWords = 'master milk advice kid insect siege riot arrive alcohol mutual mask stay';

  it('reproduces the documented twelve-word color vector', () => {
    const indexes = parseInput(sourceWords, 'english');
    expect(indexesToColors(indexes)).toEqual(colors);
    expect(colorsToIndexes(colors)).toEqual(indexes);
  });

  it('accepts RGB codes separated, concatenated, or as one fixed-width stream', () => {
    const indexes = parseInput(sourceWords, 'english');
    expect(parseInput(colors.join(' '), 'colors')).toEqual(indexes);
    expect(parseInput(colors.join(''), 'colors')).toEqual(indexes);
    expect(parseInput(colors.map((color) => color.slice(1)).join(''), 'colors')).toEqual(indexes);
    expect(parseInput(colors.join(',\n'), 'colors')).toEqual(indexes);
  });

  it('rejects incomplete continuous RGB values', () => {
    expect(() => parseInput('01AB631', 'colors')).toThrow('complete six-digit');
    expect(() => parseInput('#01AB63#22553', 'colors')).toThrow('separated or concatenated');
  });

  it('round-trips the MnemoCode Unicode representation without depending on a font', () => {
    expect(unicodeToColors(colorsToUnicode(colors))).toEqual(colors);
  });

  it('extends the reversible color packing to intermediate BIP39 word counts', () => {
    const indexes = Array.from({ length: 15 }, (_, index) => index * 13);
    expect(colorsToIndexes(indexesToColors(indexes))).toEqual(indexes);
  });
});

describe('palette QR input adapter', () => {
  it('recovers the complete color payload from a locally generated PNG', async () => {
    const payload = '#01AB63 #225531 #3E8775 #613911 #7C5809 #98BDC1 #B8E412 #E3AFE8';
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-qr-'));
    const path = join(directory, 'palette.png');
    try {
      await writeFile(
        path,
        await QRCode.toBuffer(payload, { errorCorrectionLevel: 'M', type: 'png' }),
      );
      expect(await decodeQrPngFile(path)).toBe(payload);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('local Bitcoin recovery evidence', () => {
  const vectorMnemonic =
    'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const location = { network: 'mainnet' as const, account: 0, branch: 0, index: 0 };

  it('matches a documented BIP84 receiving address and rejects a different address', () => {
    expect(
      matchBitcoinEvidence(vectorMnemonic, {
        kind: 'address',
        value: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu',
        profiles: ['native-segwit'],
        location,
      }).matched,
    ).toBe(true);
    expect(
      matchBitcoinEvidence(vectorMnemonic, {
        kind: 'address',
        value: 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyq',
        profiles: ['native-segwit'],
        location,
      }).matched,
    ).toBe(false);
  });

  it('treats the known BIP39 master fingerprint as a matchable but weak filter', () => {
    const result = matchBitcoinEvidence(vectorMnemonic, {
      kind: 'master-fingerprint',
      value: '73c5da0a',
      network: 'mainnet',
    });
    expect(result.matched).toBe(true);
    expect(result.warning).toContain('32 bits');
  });
});

// Public fixtures only; emit capabilities and storage properties, never secret text or bytes.
import { EncodedBackup } from '../../../dist/core/encoded-backup.js';
import { ReEncoding } from '../../../dist/core/re-encoding.js';
import { DatesAnswer } from '../../../dist/core/date-search.js';
import { PassphraseProtection } from '../../../dist/core/candidate-encryption.js';
import { Share } from '../../../dist/sskr/transport.js';
import { sskrSetVector } from '../../../dist/sskr/known-answers.js';
import { parseDate } from '../../../dist/core/dates.js';

const backup = EncodedBackup.read(sskrSetVector.phrase, 'english', 'direct');
const instances = [backup, ReEncoding.of(backup, []),
  DatesAnswer.of([parseDate('23-09-2026')]),
  new PassphraseProtection('public synthetic test passphrase'),
  Share.read(sskrSetVector.shares[0])];
const observations = instances.map(instance => ({
  type: instance.constructor.name,
  hasWipe: typeof instance.wipe === 'function',
  hasDispose: typeof instance[Symbol.dispose] === 'function',
  redacted: String(instance).endsWith(': redacted]'),
}));
console.log(JSON.stringify({ observations, backupCodesFrozen: Object.isFrozen(backup.indexes),
  scope: 'lifetime-contract evidence only; no external disclosure or whole-heap-erasure assertion' }, null, 2));
// A compliance probe deliberately fails while owners have no explicit lifetime end.
if (observations.some(row => !row.hasWipe || !row.hasDispose)) process.exitCode = 1;

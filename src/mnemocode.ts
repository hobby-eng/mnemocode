#!/usr/bin/env node
import { imageOptionNames } from './cli/image-options.js';

import { businessOptionNames } from './cli/business-options.js';
import { assertAllowedArguments, assertFlag, parseArguments } from './cli/arguments.js';
import { runDecode } from './cli/decode-command.js';
import { runEncode } from './cli/encode-command.js';
import { runRecoverDate } from './cli/recover-date-command.js';
import { assertCoreSelfTest, runSelfTest } from './cli/self-test.js';
import { runTable } from './cli/table-command.js';
import { terminalFailure } from './cli/terminal.js';
import { runPreview } from './cli/preview-command.js';
import { printUsage } from './cli/usage.js';
import { MNEMOCODE_VERSION } from './version.js';
import {
  runSskrSplit,
  runSskrCombine,
  runSskrExport,
  sskrExportOptions,
  sskrInputOptions,
} from './cli/sskr-command.js';

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === '--help' || command === 'help') {
    printUsage();
    return;
  }
  if (command === '--version' || command === 'version') {
    if (rest.length > 0) throw new Error(`${command} does not accept arguments.`);
    console.log(`mnemocode ${MNEMOCODE_VERSION}`);
    return;
  }
  const arguments_ = parseArguments(rest);
  assertFlag(arguments_, 'card-qr');
  switch (command) {
    case 'sskr-split':
      assertAllowedArguments(arguments_, command, [
        'mode',
        'mnemonic',
        'mnemonic-file',
        'ask-secrets',
        'date',
        'threshold',
        'shares',
        'format',
        'output',
        'pdf',
        ...imageOptionNames,
        ...sskrExportOptions,
      ]);
      assertFlag(arguments_, 'ask-secrets');
      assertCoreSelfTest();
      return runSskrSplit(arguments_);
    case 'sskr-combine':
      assertAllowedArguments(arguments_, command, ['mode', 'date', ...sskrInputOptions]);
      assertFlag(arguments_, 'ask-secrets');
      assertCoreSelfTest();
      return runSskrCombine(arguments_);
    case 'sskr-export':
      assertAllowedArguments(arguments_, command, [
        'format',
        'output',
        'pdf',
        ...imageOptionNames,
        ...sskrInputOptions,
        ...sskrExportOptions,
      ]);
      assertFlag(arguments_, 'ask-secrets');
      assertCoreSelfTest();
      return runSskrExport(arguments_);
    case 'encode':
      assertAllowedArguments(arguments_, command, [
        'mode',
        'mnemonic',
        'mnemonic-file',
        'ask-secrets',
        'legacy-valid-last-word',
        'date',
        'format',
        'output',
        'cards',
        'qr',
        'pdf',
        'cards-dir',
        'sskr',
        'threshold',
        'shares',
        'share-format',
        'card-layout',
        'template',
        'title',
        'event',
        ...imageOptionNames,
        ...businessOptionNames,
      ]);
      assertFlag(arguments_, 'sskr');
      assertFlag(arguments_, 'cards');
      assertFlag(arguments_, 'ask-secrets');
      assertFlag(arguments_, 'legacy-valid-last-word');
      assertCoreSelfTest();
      return runEncode(arguments_);
    case 'decode':
      assertAllowedArguments(arguments_, command, [
        'mode',
        'input',
        'input-file',
        'qr-file',
        'ask-secrets',
        'date',
        'format',
      ]);
      assertFlag(arguments_, 'ask-secrets');
      assertCoreSelfTest();
      return runDecode(arguments_);
    case 'recover-date':
      assertAllowedArguments(arguments_, command, [
        'mode',
        'input',
        'input-file',
        'qr-file',
        'ask-secrets',
        'date',
        'format',
        'bitcoin-address',
        'master-xpub',
        'account-xpub',
        'compressed-public-key',
        'master-fingerprint',
        'wif-file',
        'network',
        'bitcoin-profile',
        'account',
        'branch',
        'index',
        'bip39-passphrase-file',
        'max-results',
        'progress-every',
      ]);
      assertFlag(arguments_, 'ask-secrets');
      assertCoreSelfTest();
      return runRecoverDate(arguments_);
    case 'preview':
      assertAllowedArguments(arguments_, command, [
        'list',
        'all',
        'pdf',
        'cards-dir',
        'template',
        'title',
        'words',
        ...imageOptionNames,
        ...businessOptionNames,
      ]);
      assertFlag(arguments_, 'list');
      assertFlag(arguments_, 'all');
      assertCoreSelfTest();
      return runPreview(arguments_);
    case 'table':
      assertAllowedArguments(arguments_, command, ['index', 'word', 'unicode', 'all']);
      assertFlag(arguments_, 'all');
      assertCoreSelfTest();
      return runTable(arguments_);
    case 'self-test':
      assertAllowedArguments(arguments_, command, []);
      return runSelfTest();
    default:
      printUsage();
      process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  terminalFailure(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

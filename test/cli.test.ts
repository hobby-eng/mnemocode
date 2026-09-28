import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { decodeQrPngFile } from '../src/cli/qr-input.js';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'dist', 'mnemocode.js');
const mnemonic =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

async function run(arguments_: readonly string[], environment?: NodeJS.ProcessEnv) {
  return execFileAsync(process.execPath, [cli, ...arguments_], {
    cwd: process.cwd(),
    env: environment ?? process.env,
    maxBuffer: 1024 * 1024,
  });
}

describe('CLI records', () => {
  it('documents every transformation and recovery profile with runnable examples', async () => {
    const help = await run(['--help']);
    expect(help.stdout).toContain('MnemoCode 0.1.0');
    expect(help.stdout).toContain('seedshift-legacy-valid');
    expect(help.stdout).toContain('--legacy-valid-last-word');
    expect(help.stdout).toContain('wool abuse actual');
    expect(help.stdout).toContain('recover-date --mode seedshift');
    expect(help.stdout).toContain('--ask-secrets');
    expect(help.stdout).toContain('supports 15, 18, and 21');
    expect(help.stdout).toContain(
      'Private Use Unicode code points per RGB value; all five lengths',
    );
    expect(help.stdout).toContain('mnemocode self-test');
    expect(help.stdout).toContain('preview --all --pdf all-previews.pdf');
    for (const flag of ['--pdf PATH', '--template ID', '--events', '--title TEXT'])
      expect(help.stdout).toContain(flag);
  });

  it('reports the package version through both CLI forms', async () => {
    for (const argument of ['--version', 'version']) {
      const result = await run([argument]);
      expect(result.stdout).toBe('mnemocode 0.1.0\n');
      expect(result.stderr).toBe('');
    }
    await expect(run(['--version', 'extra'])).rejects.toMatchObject({
      stderr: expect.stringContaining('The version command does not accept additional arguments.'),
    });
  });

  it('runs the extended self-test and reports its coverage', async () => {
    const result = await run(['self-test']);
    expect(result.stdout).toContain('MnemoCode 0.1.0 self-test');
    expect(result.stdout).toContain('Public vectors');
    expect(result.stdout).toContain('Representation matrix');
    expect(result.stdout).toContain('QR adapter');
    expect(result.stdout).toContain('PASS');
    expect(result.stdout).toContain('Card export assets');
  }, 15_000);

  it('writes a self-describing record and decodes it without mode or format flags', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-cli-'));
    const path = join(directory, 'record.txt');
    try {
      await run([
        'encode',
        '--mode',
        'direct',
        '--mnemonic',
        mnemonic,
        '--format',
        '3',
        '--output',
        path,
      ]);
      expect(await readFile(path, 'utf8')).toMatch(/^MNC1:direct:unicode:/u);
      const decoded = await run(['decode', '--input-file', path]);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      expect(decoded.stderr).toContain('BIP39 checksum: valid');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('always prints encode output and rejects a bare --output option', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-output-'));
    const path = join(directory, 'record.txt');
    try {
      const encoded = await run([
        'encode',
        '--mnemonic',
        mnemonic,
        '--format',
        '1',
        '--output',
        path,
      ]);
      expect(encoded.stdout).toContain('English BIP39 words:');
      expect(encoded.stdout).toContain(mnemonic);
      expect(await readFile(path, 'utf8')).toMatch(/^MNC1:direct:english:/u);
      await expect(
        run(['encode', '--mnemonic', mnemonic, '--format', '1', '--output']),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('output record file setting requires a value'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('lists approved collections and validates preview arguments', async () => {
    const listed = await run(['preview', '--list']);
    expect(listed.stdout).toContain('business-architect');
    expect(listed.stdout).toContain('business-it');
    const rows = listed.stdout.trimEnd().split('\n');
    expect(rows).toHaveLength(16);
    expect(rows.every((row) => /^(\S+) {3,}(\S+) {3,}(.+?) {3,}(.+)$/u.test(row))).toBe(true);
    expect(new Set(rows.map((row) => row.indexOf('colors'))).size).toBe(1);
    await expect(
      run(['preview', '--all', '--template', '1', '--pdf', 'unused.pdf']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('either all templates or one specific template'),
    });
    await expect(run(['preview', '--template', '1'])).rejects.toMatchObject({
      stderr: expect.stringContaining('To save a preview, provide'),
    });
  });

  it('rejects unknown or unavailable templates before prompting or creating files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-pending-design-'));
    const path = join(directory, 'keep.pdf');
    const record = join(directory, 'keep.txt');
    try {
      await writeFile(path, 'existing PDF');
      await writeFile(record, 'existing record');
      for (const args of [
        ['preview', '--template', 'not-installed', '--pdf', path],
        ['preview', '--template', 'new-design', '--title', 'Title', '--pdf', path],
        [
          'encode',
          '--ask-secrets',
          '--format',
          '5',
          '--template',
          'not-installed',
          '--pdf',
          path,
          '--output',
          record,
        ],
        [
          'encode',
          '--mode',
          'seedshift',
          '--mnemonic',
          mnemonic,
          '--dates',
          '23-09-2026',
          '--events',
          'Birthday',
          '--format',
          '3',
          '--template',
          'new-design',
          '--title',
          'Notes',
          '--pdf',
          path,
        ],
      ]) {
        await expect(run(args)).rejects.toMatchObject({
          stderr: expect.stringMatching(/No approved card templates|unknown or incompatible/iu),
        });
      }
      expect(await readFile(path, 'utf8')).toBe('existing PDF');
      expect(await readFile(record, 'utf8')).toBe('existing record');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('stores only the raw encoded representation in a generated QR', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-raw-qr-'));
    const path = join(directory, 'palette.png');
    try {
      const encoded = await run([
        'encode',
        '--mode',
        'seedshift',
        '--mnemonic',
        mnemonic,
        '--dates',
        '23-09-2026',
        '--format',
        '5',
        '--qr',
        path,
      ]);
      const raw = encoded.stdout.trim().split('\n').at(-1)!;
      const qr = await decodeQrPngFile(path);
      expect(qr).toBe(raw);
      expect(qr).not.toContain('MNC1');
      expect(qr).not.toContain('seedshift');
      const decoded = await run(['decode', '--qr-file', path, '--dates', '23-09-2026']);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      expect(decoded.stderr).toContain('Detected input format: colors.');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps legacy raw records readable with explicit mode and format', async () => {
    const encoded = await run([
      'encode',
      '--mode',
      'seedshift',
      '--mnemonic',
      mnemonic,
      '--dates',
      '10-07-1963',
      '--format',
      '2',
    ]);
    const raw = encoded.stdout.trim().split('\n').at(-1)!;
    const decoded = await run([
      'decode',
      '--mode',
      'seedshift',
      '--input',
      raw,
      '--dates',
      '10-07-1963',
      '--format',
      '2',
    ]);
    expect(decoded.stdout.trim()).toBe(mnemonic);
  });

  it('auto-detects every representation that encode can produce', async () => {
    const formats = [
      ['english', '1'],
      ['indexes', '2'],
      ['unicode', '3'],
      ['colors', '5'],
      ['colors-unicode', '6'],
    ] as const;
    for (const [format, number] of formats) {
      const encoded = await run([
        'encode',
        '--mode',
        'direct',
        '--mnemonic',
        mnemonic,
        '--format',
        number,
      ]);
      const raw = encoded.stdout.trim().split('\n').at(-1)!;
      const decoded = await run(['decode', '--mode', 'direct', '--input', raw]);
      expect(decoded.stdout.trim()).toBe(mnemonic);
      expect(decoded.stderr).toContain(`Detected input format: ${format}.`);
      const explicit = await run([
        'decode',
        '--mode',
        'direct',
        '--input',
        raw,
        '--format',
        format,
      ]);
      expect(explicit.stdout.trim()).toBe(mnemonic);
    }
  }, 30_000);

  it('keeps an explicit raw format authoritative', async () => {
    const encoded = await run([
      'encode',
      '--mode',
      'direct',
      '--mnemonic',
      mnemonic,
      '--format',
      '2',
    ]);
    const raw = encoded.stdout.trim().split('\n').at(-1)!;
    const decoded = await run([
      'decode',
      '--mode',
      'direct',
      '--input',
      raw,
      '--format',
      'indexes',
    ]);
    expect(decoded.stdout.trim()).toBe(mnemonic);
    expect(decoded.stderr).not.toContain('Detected input format:');
  });

  it('does not guess an unknown representation in a non-interactive process', async () => {
    await expect(
      run(['decode', '--mode', 'direct', '--input', 'not a recorded representation']),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Choose the recorded format explicitly'),
    });
  });

  it('does not guess between multiple valid raw representations in a non-interactive process', async () => {
    const ambiguous = '76 84 57 28 90 19 59 27 62 11 89 81 66 42 75 28 50 11 52 30 57 30 62 10';
    await expect(run(['decode', '--mode', 'direct', '--input', ambiguous])).rejects.toMatchObject({
      stderr: expect.stringContaining('matches several formats (indexes, unicode)'),
    });
  });

  it('rejects explicit mode and format values that conflict with an MNC1 header', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-conflict-'));
    const path = join(directory, 'record.txt');
    try {
      await run([
        'encode',
        '--mode',
        'direct',
        '--mnemonic',
        mnemonic,
        '--format',
        '3',
        '--output',
        path,
      ]);
      await expect(
        run(['decode', '--input-file', path, '--format', 'colors']),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('conflicts with the format stored in the record (unicode)'),
      });
      await expect(
        run(['decode', '--input-file', path, '--mode', 'seedshift', '--dates', '23-09-2026']),
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('conflicts with the mode stored in the record (direct)'),
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('trusts an MNC1 format header only after the declared payload parser validates it', async () => {
    await expect(
      run(['decode', '--input', `MNC1:direct:unicode:${mnemonic}`]),
    ).rejects.toMatchObject({ stderr: expect.stringContaining('Unicode input must be') });
    await expect(run(['decode', '--input', 'MNC1:direct:unicode:'])).rejects.toMatchObject({
      stderr: expect.stringContaining('Malformed MnemoCode record header'),
    });
  });

  it('auto-detects the raw representation in recover-date as well as decode', async () => {
    const encoded = await run([
      'encode',
      '--mode',
      'seedshift-legacy',
      '--mnemonic',
      mnemonic,
      '--dates',
      '10-07-1963',
      '--format',
      'colors',
    ]);
    const raw = encoded.stdout.trim().split('\n').at(-1)!;
    const recovered = await run([
      'recover-date',
      '--mode',
      'seedshift-legacy',
      '--input',
      raw,
      '--dates',
      '??-07-1963',
      '--max-results',
      '100',
      '--progress-every',
      '1000',
    ]);
    expect(recovered.stderr).toContain('Detected input format: colors.');
    expect(recovered.stdout).toContain(`10-07-1963\t${mnemonic}`);
  });

  it('shows a legacy checksum-word suggestion and self-describes an applied replacement', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-legacy-valid-'));
    const path = join(directory, 'record.txt');
    try {
      const suggestion = await run([
        'encode',
        '--mode',
        'seedshift-legacy',
        '--mnemonic',
        mnemonic,
        '--dates',
        '23-09-2026',
        '--format',
        '1',
      ]);
      expect(suggestion.stderr).toContain('Optional checksum-valid final word:');
      await run([
        'encode',
        '--mode',
        'seedshift-legacy',
        '--legacy-valid-last-word',
        '--mnemonic',
        mnemonic,
        '--dates',
        '23-09-2026',
        '--format',
        '1',
        '--output',
        path,
      ]);
      expect(await readFile(path, 'utf8')).toMatch(/^MNC1:seedshift-legacy-valid:english:/u);
      const recovered = await run(['decode', '--input-file', path, '--dates', '23-09-2026']);
      expect(recovered.stdout).toContain(mnemonic);
      expect(recovered.stderr).toContain('128 checksum-valid candidates');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});

describe('hidden CLI input', () => {
  it('uses systemd-ask-password for encode and recover-date', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mnemocode-secret-'));
    const helper = join(directory, 'systemd-ask-password');
    const recordPath = join(directory, 'record.txt');
    const script = `#!/bin/sh\ntest -t 0 || exit 3\nprintf '%s\\n' "$3" >&2\ncase "$3" in\n  "BIP39 mnemonic:") printf '%s\\n' '${mnemonic}' ;;\n  "Date list (DD-MM-YYYY, separated by spaces):") printf '%s\\n' '10-07-1963' ;;\n  "Encoded record:") cat '${recordPath}' ;;\n  "Date list with ? for each forgotten digit (one to three incomplete dates):") printf '%s\\n' '??-07-1963' ;;\n  *) exit 2 ;;\nesac\n`;
    try {
      await writeFile(helper, script, 'utf8');
      await chmod(helper, 0o700);
      const environment = { ...process.env, PATH: `${directory}:${process.env.PATH ?? ''}` };
      const runInTerminal = (args: string[]) => {
        const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
        return execFileAsync(
          'script',
          ['-qefc', [process.execPath, cli, ...args].map(quote).join(' '), '/dev/null'],
          { env: environment },
        );
      };
      const encoded = await runInTerminal([
        'encode',
        '--mode',
        'seedshift-legacy',
        '--ask-secrets',
        '--format',
        '3',
        '--output',
        recordPath,
      ]);
      expect(encoded.stdout).toContain('BIP39 mnemonic:');
      expect(encoded.stdout).toContain('Date list (DD-MM-YYYY, separated by spaces):');
      const recovered = await runInTerminal([
        'recover-date',
        '--ask-secrets',
        '--max-results',
        '100',
        '--progress-every',
        '1000',
      ]);
      expect(recovered.stdout).toContain(`10-07-1963\t${mnemonic}`);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

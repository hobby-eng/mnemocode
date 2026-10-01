import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { commandOptions, type CommandName } from '../src/cli/command-options.js';
import { commandHelp, topicHelp } from '../src/cli/help-pages.js';

const execFileAsync = promisify(execFile);
const cli = join(process.cwd(), 'dist', 'mnemocode.js');

async function run(arguments_: readonly string[]) {
  return execFileAsync(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, NO_COLOR: '1' },
  });
}

/** The parser key of a documented option: "--dates" is stored as "date", "--events" as "event". */
function parserKey(flag: string): string {
  const name = flag.slice(2);
  return name === 'dates' ? 'date' : name === 'events' ? 'event' : name;
}

describe('help', () => {
  it('documents exactly the options each command accepts', () => {
    for (const name of Object.keys(commandOptions) as CommandName[]) {
      const documented = commandHelp[name].groups.flatMap((group) =>
        group.options.map((option) => parserKey(option.flag)),
      );
      expect([...new Set(documented)].sort(), name).toEqual([...commandOptions[name]].sort());
    }
  });

  it('lists every command and topic in the overview', async () => {
    for (const argument of [[], ['--help'], ['-h'], ['help']]) {
      const { stdout } = await run(argument);
      expect(stdout).toContain('MnemoCode 0.1.0');
      for (const name of Object.keys(commandOptions).filter((item) => item !== 'sskr-split'))
        expect(stdout).toContain(`  ${name}`);
      for (const topic of Object.keys(topicHelp)) expect(stdout).toContain(`help ${topic}`);
      expect(stdout).toContain('Recovery material:');
      // AUD-005-UI002: the overview, including its safety line, fits the 80-column help width.
      for (const line of stdout.split('\n')) expect(line.length, line).toBeLessThanOrEqual(80);
    }
  });

  it('gives a summary with -h and the full explanation with --help', async () => {
    const short = await run(['encode', '-h']);
    const long = await run(['encode', '--help']);
    const named = await run(['help', 'encode']);
    expect(named.stdout).toBe(long.stdout);
    expect(short.stdout).toContain('--legacy-valid-last-word');
    expect(short.stdout).not.toContain('systemd-ask-password');
    expect(long.stdout).toContain('systemd-ask-password');
    expect(long.stdout).toContain("TEST_PHRASE='abandon abandon");
    expect(long.stdout).toContain('mnemocode encode --sskr --ask-secrets --threshold 2 --shares 3');
  });

  it('answers a help request on a half-typed command without running it', async () => {
    const { stdout } = await run(['decode', '--input', 'unfinished', '--help']);
    expect(stdout).toContain('Usage: mnemocode decode');
  });

  it('prints a topic', async () => {
    const { stdout } = await run(['help', 'formats']);
    expect(stdout).toContain('colors-unicode');
  });

  it('refuses an unknown command or topic and names it', async () => {
    await expect(run(['frobnicate'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('There is no command “frobnicate”'),
    });
    await expect(run(['help', 'frobnicate'])).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('There is no command or topic “frobnicate”'),
    });
  });
});

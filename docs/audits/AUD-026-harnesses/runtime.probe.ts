// Real dispatch/publication with small public seams; no PDF drawing.
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { questionsOnPrivateScreen, terminal } from '../../../test/helpers/question-terminal.js';

const harness = await vi.hoisted(async () => import('../../../test/helpers/question-terminal.js'));
const faults = vi.hoisted(() => ({ qrFailures: 0, race: '', nonempty: false, oldInode: 0 }));
vi.mock('node:tty', async (original) => harness.replacedTty(await original()));
vi.mock('../../../src/cli/private-screen.js', async (original) => harness.replacedPrivateScreen(await original()));
vi.mock('../../../src/cli/terminal-input.js', async (original) => harness.replacedTerminalInput(await original()));
vi.mock('../../../src/cli/terminal-choice.js', async (original) => harness.replacedTerminalChoice(await original()));
vi.mock('../../../src/export/qr-image.js', async (original) => ({
  ...await original<typeof import('../../../src/export/qr-image.js')>(),
  exportQrPayload: async () => {
    if (faults.qrFailures-- > 0) throw Object.assign(Error('synthetic publication failure'), { code: 'ENOSPC' });
  },
}));
vi.mock('../../../src/cli/encode-export.js', async (original) => {
  const actual = await original<typeof import('../../../src/cli/encode-export.js')>();
  return { ...actual, saveEncodeResult: async (...args: Parameters<typeof actual.saveEncodeResult>) => {
    if (typeof args[0].pdf === 'string') {
      const { publishNewPrivateFile } = await import('../../../src/export/private-file.js');
      await publishNewPrivateFile(args[0].pdf, Uint8Array.of(1, 2, 3));
    } else await actual.saveEncodeResult(...args);
  } };
});
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: async (...args: Parameters<typeof actual.rename>) => {
    if (args[1] === faults.race) {
      await actual.mkdir(faults.race, { mode: 0o700 });
      faults.oldInode = (await actual.stat(faults.race)).ino;
      if (faults.nonempty) await actual.writeFile(faults.race + '/existing', 'public marker');
    }
    return actual.rename(...args);
  } };
});

import { runEncode } from '../../../src/cli/encode-command.js';
import { publishNewFolder } from '../../../src/export/private-file.js';

questionsOnPrivateScreen();
afterEach(() => { Object.assign(faults, { qrFailures: 0, race: '', nonempty: false, oldInode: 0 }); });
async function scratch() {
  const base = resolve('../tmp/mnemocode-aud-026/runtime');
  await mkdir(base, { recursive: true });
  return mkdtemp(base + '/run-');
}
const publicPhrase = 'abandon '.repeat(11) + 'about';

it('refuses a private-looking template without echoing it on the real CLI', async () => {
  const folder = await scratch();
  const child = spawnSync(process.execPath, ['dist/mnemocode.js', 'preview', '--template', publicPhrase, '--pdf', folder + '/cards.pdf'], { encoding: 'utf8' });
  expect(child.status).toBe(1);
  expect(child.stderr.includes(publicPhrase)).toBe(false);
});

it('offers retry for an automatic sheet QR after successful primary output', async () => {
  const folder = await scratch();
  terminal.answers = [publicPhrase + '\r'];
  terminal.choices = ['again'];
  faults.qrFailures = 1;
  let failed = false;
  try { await runEncode({ 'ask-secrets': true, mode: 'direct', format: '5', pdf: folder + '/sheet.pdf', 'card-qr': true }); }
  catch (error) { failed = (error as NodeJS.ErrnoException).code === 'ENOSPC'; }
  expect((await stat(folder + '/sheet.pdf')).size).toBe(3);
  expect({ failed, retryAsked: terminal.questions.includes('What now?') }).toEqual({ failed: false, retryAsked: true });
});

it('explicit QR output retries the same publication failure as a control', async () => {
  const folder = await scratch();
  terminal.answers = [publicPhrase + '\r'];
  terminal.choices = ['again'];
  faults.qrFailures = 1;
  await runEncode({ 'ask-secrets': true, mode: 'direct', format: '1', qr: folder + '/qr.png' });
  expect(terminal.questions).toContain('What now?');
});

it('does not replace an empty directory created after the absence check', async () => {
  const folder = await scratch();
  const target = faults.race = folder + '/cards';
  let rejected = false;
  try { await publishNewFolder(target, '.staging-', 'taken', async staging => writeFile(staging + '/new', 'public marker')); }
  catch { rejected = true; }
  const changed = (await stat(target)).ino !== faults.oldInode;
  expect({ rejected, changed }).toEqual({ rejected: true, changed: false });
});

it('refuses a nonempty directory created after the absence check as a control', async () => {
  const folder = await scratch();
  const target = faults.race = folder + '/cards';
  faults.nonempty = true;
  await expect(publishNewFolder(target, '.staging-', 'taken', async staging => writeFile(staging + '/new', 'public marker'))).rejects.toThrow();
  expect((await stat(target)).ino).toBe(faults.oldInode);
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const terminal = vi.hoisted(() => ({ open: vi.fn(), close: vi.fn(), spawn: vi.fn() }));
vi.mock('node:fs', async () => ({
  ...(await vi.importActual('node:fs')),
  openSync: terminal.open,
  closeSync: terminal.close,
}));
vi.mock('node:child_process', async () => ({
  ...(await vi.importActual('node:child_process')),
  spawnSync: terminal.spawn,
}));
import { askSecret } from '../src/cli/input.js';

const realPlatform = process.platform;
function reportPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

describe('hidden input controlling terminal', () => {
  afterEach(() => reportPlatform(realPlatform));
  beforeEach(() => {
    vi.resetAllMocks();
    // The prompt program exists only on Linux; these cases test the Linux path on every system.
    reportPlatform('linux');
    terminal.open.mockReturnValue(42);
    terminal.spawn.mockReturnValue({ status: 0, stdout: 'test-only\n' });
  });
  it('keeps prompts on a real TTY and secrets in a private pipe', () => {
    expect(askSecret('Mnemonic:')).toBe('test-only');
    expect(terminal.open).toHaveBeenCalledWith('/dev/tty', 'r+');
    expect(terminal.spawn).toHaveBeenCalledWith(
      'systemd-ask-password',
      ['--echo=no', '--', 'Mnemonic:'],
      { encoding: 'utf8', stdio: [42, 'pipe', 42] },
    );
    expect(terminal.close).toHaveBeenCalledWith(42);
  });
  it('fails immediately without a controlling terminal instead of invoking an agent', () => {
    terminal.open.mockImplementation(() => {
      throw new Error('ENXIO');
    });
    expect(() => askSecret('Mnemonic:')).toThrow('requires an interactive terminal');
    expect(terminal.spawn).not.toHaveBeenCalled();
  });
  it.each([
    [{ status: 1, stdout: '' }, 'cancelled or failed'],
    [{ status: null, signal: 'SIGINT', stdout: '' }, 'cancelled or failed'],
    [{ status: 0, stdout: '\n' }, 'must not be empty'],
    [{ error: new Error('ENOENT') }, 'could not be started'],
  ])('closes the terminal on input failure', (result, message) => {
    terminal.spawn.mockReturnValue(result);
    expect(() => askSecret('Mnemonic:')).toThrow(message);
    expect(terminal.close).toHaveBeenCalledWith(42);
  });
  it.each(['win32', 'darwin'] as const)(
    'AUD-005-UI001: says on %s that hidden input is Linux-only, before opening a terminal',
    (platform) => {
      reportPlatform(platform);
      expect(() => askSecret('Mnemonic:')).toThrow(
        'Hidden input (--ask-secrets) works on Linux only',
      );
      expect(terminal.open).not.toHaveBeenCalled();
      expect(terminal.spawn).not.toHaveBeenCalled();
    },
  );
});

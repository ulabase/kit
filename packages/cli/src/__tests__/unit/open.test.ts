import { describe, expect, it } from 'vitest';
import { canOpenBrowser, openCommand, openPage, type OpenContext } from '../../open.js';

const laptop: OpenContext = { platform: 'darwin', env: {}, stdoutIsTTY: true };

describe('canOpenBrowser', () => {
  it('opens on a laptop with a terminal', () => {
    expect(canOpenBrowser(laptop)).toBe(true);
    expect(canOpenBrowser({ platform: 'win32', env: {}, stdoutIsTTY: true })).toBe(true);
    expect(canOpenBrowser({ platform: 'linux', env: { DISPLAY: ':0' }, stdoutIsTTY: true })).toBe(true);
    expect(canOpenBrowser({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' }, stdoutIsTTY: true })).toBe(true);
  });

  it('does not open over ssh', () => {
    expect(canOpenBrowser({ ...laptop, env: { SSH_CONNECTION: '10.0.0.1 22 10.0.0.2 22' } })).toBe(false);
    expect(canOpenBrowser({ ...laptop, env: { SSH_TTY: '/dev/pts/0' } })).toBe(false);
  });

  it('does not open on Linux with no display', () => {
    expect(canOpenBrowser({ platform: 'linux', env: {}, stdoutIsTTY: true })).toBe(false);
  });

  it('does not open when the output is redirected, or in a pipeline', () => {
    expect(canOpenBrowser({ ...laptop, stdoutIsTTY: false })).toBe(false);
    expect(canOpenBrowser({ ...laptop, env: { CI: 'true' } })).toBe(false);
  });
});

describe('openCommand', () => {
  it('keeps the address as one argument, query string included', () => {
    const url = 'https://ulabase.com/orgs/active/new-service?tier=launch&x=1';
    expect(openCommand('darwin', url)).toEqual({ command: 'open', args: [url] });
    expect(openCommand('linux', url)).toEqual({ command: 'xdg-open', args: [url] });
    expect(openCommand('win32', url).args.at(-1)).toBe(url);
  });
});

describe('openPage', () => {
  const url = 'https://ulabase.com/signup';

  it('always prints the address, and starts the browser where there is one', () => {
    const lines: string[] = [];
    const launched: string[][] = [];
    const opened = openPage(url, {
      context: laptop,
      write: l => lines.push(l),
      launch: (command, args) => launched.push([command, ...args]),
    });

    expect(opened).toBe(true);
    expect(lines.join('\n')).toContain(url);
    expect(launched).toEqual([['open', url]]);
  });

  it('prints the address and starts nothing over ssh', () => {
    const lines: string[] = [];
    const launched: string[][] = [];
    const opened = openPage(url, {
      context: { ...laptop, env: { SSH_CONNECTION: 'x' } },
      write: l => lines.push(l),
      launch: (command, args) => launched.push([command, ...args]),
    });

    expect(opened).toBe(false);
    expect(lines.join('\n')).toContain(url);
    expect(lines[0]).toBe('Open this page in a browser:');
    expect(launched).toEqual([]);
  });

  it('starts nothing with --no-open', () => {
    const launched: string[][] = [];
    openPage(url, { context: laptop, noOpen: true, write: () => {}, launch: (c, a) => launched.push([c, ...a]) });
    expect(launched).toEqual([]);
  });

  it('is not an error when the browser cannot start', () => {
    const opened = openPage(url, {
      context: laptop,
      write: () => {},
      launch: () => {
        throw new Error('spawn open ENOENT');
      },
    });
    expect(opened).toBe(false);
  });
});

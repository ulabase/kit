import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TOKEN_VAR,
  clearSession,
  readSession,
  resolveToken,
  sessionPath,
  writeSession,
} from '../../session.js';

// Every test drives a throwaway XDG_CONFIG_HOME, so nothing here can read or
// write the session of whoever is running the suite.
let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ulabase-session-'));
  env = { XDG_CONFIG_HOME: home };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('sessionPath', () => {
  it('lives under XDG_CONFIG_HOME when it is set', () => {
    expect(sessionPath(env)).toBe(join(home, 'ulabase', 'session.json'));
  });

  it('falls back to ~/.config', () => {
    expect(sessionPath({})).toMatch(/[/\\]\.config[/\\]ulabase[/\\]session\.json$/);
  });
});

describe('writeSession', () => {
  it('round-trips', () => {
    writeSession({ token: 'ula_live_abc', api: 'https://cloud-api.restheart.com' }, env);
    expect(readSession(env)).toEqual({
      token: 'ula_live_abc',
      api: 'https://cloud-api.restheart.com',
    });
  });

  it('is readable only by its owner', () => {
    const path = writeSession({ token: 'ula_live_abc', api: 'https://x.restheart.com' }, env);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('tightens the mode of a file that already existed', () => {
    // writeFileSync's `mode` applies only when it creates the file, so a
    // session written before this rule existed would keep its old permissions.
    const path = sessionPath(env);
    mkdirSync(join(home, 'ulabase'), { recursive: true });
    writeFileSync(path, '{}', { mode: 0o644 });

    writeSession({ token: 't', api: 'https://x.restheart.com' }, env);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});

describe('readSession', () => {
  it('reads a missing file as absent', () => {
    expect(readSession(env)).toBeNull();
  });

  it('reads a corrupt file as absent rather than throwing', () => {
    // The cure is `ulabase login`; refusing to run until the user finds a file they
    // have never heard of helps nobody.
    mkdirSync(join(home, 'ulabase'), { recursive: true });
    writeFileSync(sessionPath(env), 'not json at all');
    expect(readSession(env)).toBeNull();
  });

  it('reads a file missing either field as absent', () => {
    mkdirSync(join(home, 'ulabase'), { recursive: true });
    writeFileSync(sessionPath(env), JSON.stringify({ token: 'ula_live_abc' }));
    expect(readSession(env)).toBeNull();
  });
});

describe('resolveToken', () => {
  it('is null when there is neither a variable nor a file', () => {
    expect(resolveToken(env)).toBeNull();
  });

  it('reads the stored session', () => {
    writeSession({ token: 'ula_live_stored', api: 'https://cloud-api.restheart.com' }, env);
    expect(resolveToken(env)).toEqual({
      token: 'ula_live_stored',
      source: 'file',
      api: 'https://cloud-api.restheart.com',
    });
  });

  it('lets the environment win over the stored session, always', () => {
    // The property that matters: a CI run must never silently fall back to a
    // session left on a shared runner, nor the reverse.
    writeSession({ token: 'ula_live_stored', api: 'https://cloud-api.restheart.com' }, env);
    const resolved = resolveToken({ ...env, [TOKEN_VAR]: 'ula_live_from_ci' });

    expect(resolved).toEqual({ token: 'ula_live_from_ci', source: 'env' });
  });

  it('ignores an empty variable, which is how an unset CI secret arrives', () => {
    writeSession({ token: 'ula_live_stored', api: 'https://cloud-api.restheart.com' }, env);
    expect(resolveToken({ ...env, [TOKEN_VAR]: '  ' })?.source).toBe('file');
  });

  it('trims the variable, because a secret store pastes a trailing newline', () => {
    expect(resolveToken({ ...env, [TOKEN_VAR]: 'ula_live_x\n' })?.token).toBe('ula_live_x');
  });
});

describe('clearSession', () => {
  it('removes the file and says it did', () => {
    const path = writeSession({ token: 't', api: 'https://x.restheart.com' }, env);
    expect(clearSession(env)).toBe(true);
    expect(() => readFileSync(path)).toThrow();
    expect(readSession(env)).toBeNull();
  });

  it('says so when there was nothing to remove', () => {
    expect(clearSession(env)).toBe(false);
  });
});

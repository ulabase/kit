import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The stored session: a personal access token and the admin node it was
 * verified against.
 *
 * The admin node is stored with the token because they belong together. A token
 * issued by `cloud-api.restheart.com` means nothing to any other node, so a
 * session that remembered only the token would happily send a production
 * credential at whatever `--api` came next.
 */
export interface Session {
  token: string;
  api: string;
}

/** Where a token came from. The two are never mixed — see {@link resolveToken}. */
export type TokenSource = 'env' | 'file';

export interface ResolvedToken {
  token: string;
  source: TokenSource;
  /** The admin node the stored token was verified against; absent for `env`. */
  api?: string;
}

export const TOKEN_VAR = 'ULABASE_TOKEN';

/**
 * `~/.config/ulabase/session.json`, or under `XDG_CONFIG_HOME` when set.
 *
 * Not in the project directory, and deliberately: a credential in a working
 * tree is a credential one `git add -A` away from a public repository.
 */
export function sessionPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
  return join(base, 'ulabase', 'session.json');
}

/**
 * The stored session, or `null` when there is none.
 *
 * A file that cannot be parsed reads as absent rather than as an error: the
 * cure for a corrupt session is `ulabase login`, and refusing to run until the
 * user finds and deletes a file they have never heard of helps nobody.
 */
export function readSession(env: NodeJS.ProcessEnv = process.env): Session | null {
  const path = sessionPath(env);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<Session>;
    if (typeof parsed.token !== 'string' || typeof parsed.api !== 'string') return null;
    return { token: parsed.token, api: parsed.api };
  } catch {
    return null;
  }
}

/**
 * Store the session, readable only by its owner.
 *
 * The mode is set on the directory as well as on the file, and `chmod` runs
 * even when the file already existed — `writeFileSync`'s mode applies only when
 * it creates the file, so a session written before this rule existed would keep
 * whatever permissions it had.
 *
 * @returns the path written, for the message that says where it went
 */
export function writeSession(session: Session, env: NodeJS.ProcessEnv = process.env): string {
  const path = sessionPath(env);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

/** Remove the stored session. Returns whether there was one to remove. */
export function clearSession(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = sessionPath(env);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

/**
 * The token to authenticate with, and where it came from.
 *
 * **The environment wins over the stored file, always.** A pipeline has no
 * `ulabase login` step, so a CI run must never quietly fall back to a session left
 * behind on a shared runner; and on a developer's machine, an environment
 * variable set on purpose must not be shadowed by a login from last month.
 * Precedence in one direction, with no condition attached to it, is the only
 * version of this that is predictable.
 */
export function resolveToken(env: NodeJS.ProcessEnv = process.env): ResolvedToken | null {
  const fromEnv = env[TOKEN_VAR];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return { token: fromEnv.trim(), source: 'env' };
  }

  const stored = readSession(env);
  if (stored) {
    return { token: stored.token, source: 'file', api: stored.api };
  }

  return null;
}

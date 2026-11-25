import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `ulabase app new`: a starter app, downloaded into a new folder.
 *
 * A starter is named by a rule and by no list: `--starter x` is the repository
 * `github.com/ulabase/starter-x`. A starter published tomorrow works with the command of today.
 * The option takes a name and never an address, so the code `npm install` then runs comes from
 * the `ulabase` organization only.
 */

/** The GitHub organization the starters live in. */
export const STARTERS_OWNER = 'ulabase';

/** What a starter's repository name begins with. */
export const STARTER_PREFIX = 'starter-';

/** A starter's name: what follows `starter-` in the name of its repository. */
export function isStarterName(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(name);
}

/** The name of an app: a folder and an npm package name at once. */
export function isAppName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,99}$/.test(name);
}

/** Where a starter is cloned from. */
export function starterRepoUrl(starter: string): string {
  if (!isStarterName(starter)) {
    throw new Error(`not a starter name: ${starter}`);
  }
  return `https://github.com/${STARTERS_OWNER}/${STARTER_PREFIX}${starter}.git`;
}

/** The page of a starter's repository, for who wants to download it by hand. */
export function starterRepoPage(starter: string): string {
  return `https://github.com/${STARTERS_OWNER}/${STARTER_PREFIX}${starter}`;
}

/**
 * The starters that exist now: the public repositories of the organization whose name begins
 * with `starter-`. Read from GitHub when asked, so the list is never written in this package.
 *
 * @returns the names, sorted, or `null` when GitHub could not be asked
 */
export async function listStarters(
  transport: (url: string, init?: RequestInit) => Promise<Response> = fetch
): Promise<string[] | null> {
  try {
    const res = await transport(
      `https://api.github.com/orgs/${STARTERS_OWNER}/repos?type=public&per_page=100`,
      { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ulabase-cli' } }
    );
    if (!res.ok) return null;
    const repos = (await res.json()) as Array<{ name?: string; archived?: boolean }>;
    return repos
      .filter(r => typeof r.name === 'string' && r.name.startsWith(STARTER_PREFIX) && !r.archived)
      .map(r => r.name!.slice(STARTER_PREFIX.length))
      .filter(isStarterName)
      .sort();
  } catch {
    return null;
  }
}

/** Whether a folder can receive a new app: it does not exist, or it is empty. */
export function folderIsFree(dir: string): boolean {
  return !existsSync(dir) || readdirSync(dir).length === 0;
}

/** Whether git is on this machine. `app new` clones, so it needs it. */
export function hasGit(): boolean {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Clone a starter's default branch into a folder, without its history.
 *
 * `git clone` and not the archive of the repository, by decision: GitHub counts clones in the
 * traffic of a repository and does not count downloads of the archive, so each new app shows in
 * the statistics of its starter.
 *
 * @returns whether the clone succeeded
 */
export function cloneStarter(starter: string, dir: string): boolean {
  const res = spawnSync('git', ['clone', '--depth', '1', '--quiet', starterRepoUrl(starter), dir], {
    stdio: ['ignore', 'ignore', 'pipe'],
    // never stop to ask for a GitHub user: a starter that does not exist must fail, not prompt
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  if (res.status !== 0) {
    // a failed clone may leave the folder behind, and it was free when we started
    if (existsSync(dir) && readdirSync(dir).every(f => f === '.git')) {
      rmSync(dir, { recursive: true, force: true });
    }
    return false;
  }
  rmSync(join(dir, '.git'), { recursive: true, force: true });
  return true;
}

/**
 * Write the app's name into the `package.json` the starter came with.
 *
 * Only the `name` value is replaced, in the text: the rest of the file keeps its order and its
 * spacing, so the first commit of the new project is not a reformatting of it.
 *
 * @returns whether there was a `package.json` with a name to replace
 */
export function nameThePackage(dir: string, name: string): boolean {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return false;

  const text = readFileSync(file, 'utf8');
  const named = /^(\s*"name"\s*:\s*)"[^"]*"/m;
  if (!named.test(text)) return false;

  writeFileSync(file, text.replace(named, `$1${JSON.stringify(name)}`));
  return true;
}

/** `npm install` in the new folder, with its output on the terminal. */
export function installPackages(dir: string): boolean {
  const res = spawnSync('npm', ['install'], {
    cwd: dir,
    stdio: 'inherit',
    // npm is npm.cmd on Windows, which only a shell resolves
    shell: process.platform === 'win32',
  });
  return res.status === 0;
}

/** The script that starts the app, read from its `package.json`: `dev`, else `start`. */
export function startCommand(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    if (pkg.scripts?.['dev']) return 'npm run dev';
    if (pkg.scripts?.['start']) return 'npm start';
  } catch {
    // no package.json, or not JSON: fall through to the usual name
  }
  return 'npm run dev';
}

#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAdminClient, type AdminClient } from './admin.js';
import { isApiError } from './http.js';
import { DEFAULT_ENV, isEnvName, runSetup, type Setup, type SetupReport, type ProgressEvent } from './setup.js';
import {
  TOKEN_VAR,
  clearSession,
  readSession,
  resolveToken,
  sessionPath,
  writeSession,
  type ResolvedToken,
} from './session.js';
import { openPage } from './open.js';
import { maskEcho } from './mask.js';
import { PLAN_TIERS, formatServices, planLabel, sortServices, type ListedService } from './services.js';
import {
  cloneStarter,
  folderIsFree,
  hasGit,
  installPackages,
  isAppName,
  isStarterName,
  listStarters,
  nameThePackage,
  startCommand,
  starterRepoPage,
} from './apps.js';

/** The admin node of Ulabase. */
const DEFAULT_API = 'https://api.ulabase.com';

/** The environment variable that names the admin node, instead of --api. */
const API_VAR = 'ULABASE_API';

/** The admin node when --api is not given: ULABASE_API, or the default. */
function defaultApi(): string {
  return process.env[API_VAR]?.trim() || DEFAULT_API;
}

/**
 * This package's version, read from its own `package.json`.
 *
 * Read at run time rather than baked in at build: the release workflow sets the
 * version with `npm pkg set` just before publishing, so anything captured when
 * `tsc` ran would be the placeholder `0.0.0` for ever. Which is also what it
 * reports from a checkout, correctly — a linked build is not a release.
 *
 * Resolved from this module rather than the working directory, or `ulabase` run
 * inside any other project would report that project's version.
 */
function version(): string {
  try {
    const pkg = new URL('../package.json', import.meta.url);
    return (JSON.parse(readFileSync(pkg, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Looked for in the working directory when `--file` is not given.
 *
 * Conventional rather than configurable on purpose: `ulabase setup --srv c0ffee`
 * is the command people type dozens of times, and a flag that is always the
 * same value is a flag worth not typing. `.ts` first because that is what a
 * setup is normally written in — it wants the types.
 */
const DEFAULT_FILES = ['ulabase.setup.ts', 'ulabase.setup.mts', 'ulabase.setup.js', 'ulabase.setup.mjs'];

/**
 * What a personal access token starts with.
 *
 * Advisory only — it is server configuration, and this copy of it is used to
 * warn, never to refuse. See {@link warnIfNotAPat}.
 */
const PAT_PREFIX = 'ula_live_';

const USAGE = `
ulabase — the Ulabase CLI, also installed as \`ula\`

  ulabase signup
  ulabase srv new
  ulabase login --new-token
  ulabase app new --name my-app --starter react
  ulabase setup --srv c0ffee

  npm i -g ulabase        for a terminal
  npx ulabase setup       for a pipeline

Commands
  signup          Open the page where you create your account.
  login           Store a personal access token for later commands.
                  --new-token opens the page where you create one first.
  logout          Forget the stored token.
  srv new         Open the page where you create a service.
  srv ls          List your services: id, name, plan, region, tags.
  app new         Download a starter app into a new folder, install its
                  packages and connect it to one of your services.
  setup           Bring a service to the state your setup file describes.
                  Every step is a check and an apply, so running it against a
                  service already set up writes nothing.

  signup, srv new and login --new-token create nothing themselves: they open a
  page of the console, and you finish there. Where no browser can be opened,
  over ssh for instance, they print the address to open on another device.

Options
  --no-open       Print the address of the page and open no browser.
  --new-token     With login: open the page that creates a token, then ask for it.
  --plan <plan>   With srv new: free, launch or pro, selected on the page.
  --name <name>   With app new: the name of the app, and of its folder.
  --starter <s>   With app new: the starter to download. \`--starter react\` is
                  github.com/ulabase/starter-react; any starter there works.
  --no-install    With app new: do not run npm install.
  --no-setup      With app new: do not connect the app to a service.
  --srv <id>      The service to set up, or to connect a new app to.
  --env <name>    The environment the setup is for (default: development).
                  The step that writes the service's address into the app
                  chooses the file from it: --env production for production.
  --file <path>   A module exporting a setup (default export, or \`setup\`).
                  A function export is called with no arguments.
                  Defaults to ./${DEFAULT_FILES[0]}.
  --dry-run       Run every check, apply nothing, write nothing.
  --force <name>  Apply the steps whose name contains <name> without asking
                  their check first — for a change the check cannot see, such as
                  an edited permission under the id it already had. Repeatable.
                  Bare --force takes every step, which is usually wrong: an
                  apply written to run once may not survive running twice.
  --api <url>     Admin node (default: ${API_VAR}, else ${DEFAULT_API}).
  --json          Emit the report, or the list of services, as JSON.
  --version, -v   Print the version and exit.
  --help

Credentials
  A personal access token, and never a password — the CLI has no way to accept
  one. A token carries the \`cli\` role rather than yours: it configures services
  and cannot buy one, and it is revoked by itself, without touching anything
  else the account is used for. It can be limited to some services when you
  create it.

  ${TOKEN_VAR}       in a pipeline. Always wins over a stored session.
  ulabase login       in a terminal. Stored 0600 under ~/.config/ulabase.

  Never a flag: a credential in a flag is a credential in the shell history,
  and in the process list of every other user on the machine.

Exit codes
  0  every step satisfied or applied
  1  a step failed
  2  a dry run found work outstanding — configuration drift, not an error
`;

/**
 * The commands this version answers to.
 *
 * The thing first, then the action, as `docker` and `gh` do: `srv new`, `srv ls`, `app new`. A
 * thing gathers its actions. The commands with no thing stay at the first level.
 */
const COMMANDS = ['signup', 'login', 'logout', 'setup', 'srv', 'app'] as const;
type Command = (typeof COMMANDS)[number];

/** The actions of the commands that name a thing. */
const ACTIONS: Partial<Record<Command, readonly string[]>> = { srv: ['new', 'ls'], app: ['new'] };

interface Args {
  command?: Command;
  /** The action of `srv` or `app`. */
  action?: string;
  file?: string;
  srv?: string;
  api: string;
  /** Whether `--api` was on the line, as against the default. */
  apiGiven: boolean;
  noOpen: boolean;
  newToken: boolean;
  plan?: string;
  name?: string;
  starter?: string;
  noInstall: boolean;
  noSetup: boolean;
  env?: string;
  dryRun: boolean;
  force: boolean | string[];
  json: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    api: defaultApi(),
    apiGiven: false,
    noOpen: false,
    newToken: false,
    noInstall: false,
    noSetup: false,
    dryRun: false,
    force: false,
    json: false,
    help: false,
    version: false,
  };

  // The first bare word is the command. Taken before the option loop so an
  // unknown one is rejected as a command rather than as a stray option.
  const first = argv[0];
  if (first !== undefined && !first.startsWith('-')) {
    if (!(COMMANDS as readonly string[]).includes(first)) {
      throw new Error(`unknown command: ${first}\nAvailable: ${COMMANDS.join(', ')}`);
    }
    args.command = first as Command;
    argv = argv.slice(1);

    // `srv` and `app` name a thing: the next bare word is what to do with it.
    const actions = ACTIONS[args.command];
    if (actions) {
      const action = argv[0];
      if (action === undefined || action.startsWith('-')) {
        if (!argv.includes('--help') && !argv.includes('-h')) {
          throw new Error(`ulabase ${first} needs an action: ${actions.map(a => `ulabase ${first} ${a}`).join(', ')}`);
        }
      } else if (!actions.includes(action)) {
        throw new Error(`unknown action: ulabase ${first} ${action}\nAvailable: ${actions.map(a => `ulabase ${first} ${a}`).join(', ')}`);
      } else {
        args.action = action;
        argv = argv.slice(1);
      }
    }
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--file': args.file = argv[++i]; break;
      case '--srv': args.srv = argv[++i]; break;
      case '--api': args.api = argv[++i] ?? defaultApi(); args.apiGiven = true; break;
      case '--no-open': args.noOpen = true; break;
      case '--new-token': args.newToken = true; break;
      case '--plan': args.plan = argv[++i]; break;
      case '--name': args.name = argv[++i]; break;
      case '--starter': args.starter = argv[++i]; break;
      case '--no-install': args.noInstall = true; break;
      case '--no-setup': args.noSetup = true; break;
      case '--env': args.env = argv[++i]; break;
      case '--dry-run': args.dryRun = true; break;
      case '--force': {
        // A value only if the next argument is not another option. `--force`
        // last on the line, or before `--srv`, means all of them.
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          i++;
          args.force = Array.isArray(args.force) ? [...args.force, next] : [next];
        } else {
          args.force = true;
        }
        break;
      }
      case '--json': args.json = true; break;
      case '--help':
      case '-h': args.help = true; break;
      case '--version':
      case '-v': args.version = true; break;
      default:
        // A bare word after `app new` is a name written the way `ng new` takes it. The name
        // is an option here, so say which, rather than answer "unknown option".
        if (a !== undefined && !a.startsWith('-') && args.command === 'app') {
          throw new Error(`The name of the app is an option: ulabase app new --name ${a}`);
        }
        // Rather than ignore it: a misspelled --dry-run that silently applied
        // the setup is the worst failure this tool could have.
        throw new Error(`unknown option: ${a}`);
    }
  }
  return args;
}

/**
 * The setup file to load: what `--file` named, or the first conventional name
 * present in the working directory.
 */
function resolveFile(explicit?: string): string {
  if (explicit !== undefined) return explicit;
  const found = DEFAULT_FILES.find(f => existsSync(resolve(process.cwd(), f)));
  if (found === undefined) {
    throw new Error(
      `no setup file found. Expected ./${DEFAULT_FILES[0]} in the working directory, ` +
        'or a path in --file.'
    );
  }
  return found;
}

/**
 * Load a setup from a module path.
 *
 * Two failures here have a cure the reader cannot guess from Node's own words,
 * and both are more likely with `--file`, which points at a project that is not
 * the working directory:
 *
 * - **the setup file's own imports do not resolve.** A setup imports
 *   `defineSetup` and `step` from this package, and a bare specifier resolves
 *   from the *importing file's* directory — not from where `ulabase` lives. A global
 *   install is not on that path, so the project needs its own copy. That is the
 *   documented shape (global for the command, local for the file), which makes
 *   it a setup instruction rather than a bug — but only if it is said.
 * - **the runtime cannot load TypeScript.** Node 22.18 and later strip types on
 *   their own; anything earlier wants `tsx`.
 */
async function loadSetup(file: string): Promise<Setup> {
  const url = pathToFileURL(resolve(process.cwd(), file)).href;
  let mod: Record<string, unknown>;
  try {
    mod = (await import(url)) as Record<string, unknown>;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // `Cannot find package 'x' imported from y` — Node's wording for a bare
    // specifier it could not resolve. Distinct from `Cannot find module`, which
    // is the file itself, so it is matched separately and answered differently.
    const missing = /Cannot find package '([^']+)' imported from/.exec(message);
    if (missing) {
      const pkg = missing[1];
      throw new Error(
        `${file} imports ${pkg}, which is not installed in that project.\n\n` +
          'A setup file resolves its imports from its own directory, so a global `ulabase` does not\n' +
          `satisfy them. In ${dirname(resolve(process.cwd(), file))}:\n\n` +
          `  npm i -D ${pkg}\n`
      );
    }

    // `imported from` means the setup file loaded and one of *its* imports did
    // not resolve. Answering that with "install tsx" is a wrong diagnosis that
    // sends the reader to fix a runtime that was working — the runtime got far
    // enough to read the file and follow its imports.
    const relative = /Cannot find module '([^']+)' imported from/.exec(message);
    if (relative) {
      throw new Error(
        `${file} imports ${relative[1]}, which does not resolve.\n\n` +
          'A relative import needs its extension here — `./config.ts`, not `./config`.\n' +
          'Node resolves the setup file as a real ES module, and does not guess extensions.\n'
      );
    }

    if (/Unknown file extension|Cannot find module/.test(message) && /\.tsx?$/.test(file)) {
      throw new Error(
        `${message}\n\nA TypeScript setup needs a runtime that can load one: Node 22.18+, or \`npx tsx\`.`
      );
    }
    throw err;
  }

  const exported = mod['default'] ?? mod['setup'];
  const setup = typeof exported === 'function' ? (exported as () => Setup)() : exported;

  if (!setup || typeof setup !== 'object' || !Array.isArray((setup as Setup).steps)) {
    throw new Error(`${file} does not export a setup (default export, or \`setup\`)`);
  }
  return setup as Setup;
}

/**
 * Ask a question, optionally without echoing the answer.
 *
 * A hidden prompt is the convention for a credential — `gh`, `npm` and `docker`
 * all do it — but a terminal that shows nothing at all is indistinguishable
 * from a terminal that has hung. **So a hidden prompt must say that it is
 * hidden**, in the question itself; a caller passing `silent` without saying so
 * is handing the reader a puzzle.
 */
/** The console that issues tokens for an admin node: `api.ulabase.com` → `ulabase.com`, `cloud-api.restheart.com` → `cloud.restheart.com`. */
function consoleOf(api: string): string {
  try {
    return new URL(api).hostname.replace(/^cloud-api\./, 'cloud.').replace(/^api\./, '');
  } catch {
    return 'ulabase.com';
  }
}

async function prompt(question: string, silent = false): Promise<string> {
  // Written here rather than passed to `rl.question`, and that is the whole
  // trick: `_writeToOutput` below silences *everything* readline emits, the
  // prompt included. Leaving readline to draw it produced a blank line with a
  // cursor parked where the text should have been — a prompt you cannot read,
  // asking for input that does not echo, which looks exactly like a hung
  // terminal. Drawing it ourselves and handing readline an empty question keeps
  // the two concerns apart: we own the prompt, readline owns the echo.
  if (silent) process.stdout.write(question);

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  if (silent) {
    // A dot for each character, and never the character. A terminal that shows nothing after a
    // paste is indistinguishable from one where the paste did not arrive: the dots say it did,
    // and how much. They give away the length, which for a token is public anyway: its shape is
    // fixed.
    //
    // readline writes two kinds of thing here: the characters typed or pasted, and the escape
    // sequences that move the cursor and clear the line when it redraws, after a backspace for
    // instance. The sequences go through as they are, so the redraw works; everything else that
    // prints becomes a dot.
    const out = rl as unknown as { _writeToOutput?: (s: string) => void };
    out._writeToOutput = (s: string) => {
      process.stdout.write(maskEcho(s));
    };
  }

  try {
    const answer = await new Promise<string>(res => rl.question(silent ? '' : question, res));
    if (silent) process.stdout.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

/**
 * What to say when the credential is not accepted.
 *
 * A bare `401` is true and useless. There are only two reasons a token that was
 * good is refused — it was revoked, or it expired — and neither is a thing the
 * user can debug from a status code. The cure differs by where the token came
 * from: a pipeline has no `ulabase login` to run.
 */
function credentialError(source: ResolvedToken['source'], api: string): string {
  return source === 'env'
    ? `The token in ${TOKEN_VAR} was revoked or has expired. Issue a new one at ` +
        `${consoleOf(api)} and update it in your secret store.`
    : 'Your session was revoked or has expired. Run `ulabase login`.';
}

/** Turn anything thrown into one line worth printing. */
function describe(err: unknown): string {
  if (isApiError(err)) {
    return err.message ? `${err.message} (HTTP ${err.status})` : `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function warnIfNotAPat(token: string): void {
  if (!token.startsWith(PAT_PREFIX)) {
    process.stderr.write(
      `Warning: this does not look like a personal access token (they start with ${PAT_PREFIX}).\n` +
        'It authenticated, so something accepted it — but a service admin token, for instance,\n' +
        'lives fifteen minutes, and storing one here means it stops working before you use it.\n'
    );
  }
}

/**
 * The token every command but `login` runs on.
 *
 * Refuses rather than guesses: there is no interactive fallback here, because a
 * `setup` that stops to ask for a credential is a `setup` that hangs a pipeline
 * until it times out.
 */
function requireToken(): ResolvedToken {
  const resolved = resolveToken();
  if (resolved) return resolved;

  throw new Error(
    process.stdin.isTTY
      ? 'Not logged in. Run `ulabase login`.'
      : `${TOKEN_VAR} is not set, and there is no terminal to ask.\n` +
          "In a pipeline, set it from your platform's secret store."
  );
}

// ── commands ────────────────────────────────────────────────────────────────

/**
 * Store a token, having first checked that it works.
 *
 * The verification is the point. Writing an unchecked credential to disk moves
 * the failure to the next command, where it arrives as a `401` in the middle of
 * something the user cared about instead of at the moment they could still
 * paste the right thing.
 */
async function cmdLogin(args: Args): Promise<number> {
  const fromEnv = process.env[TOKEN_VAR]?.trim();

  if (!fromEnv && !process.stdin.isTTY) {
    process.stderr.write(
      `${TOKEN_VAR} is not set, and there is no terminal to ask.\n` +
        'In a pipeline, set it from your secret store — there is no need to run `ulabase login` at all.\n'
    );
    return 1;
  }

  if (!fromEnv && args.newToken) {
    // The page creates the token; the terminal then asks for it, as it does without the option.
    // So this works over ssh too: the page is opened on another device, the token pasted here.
    process.stdout.write('Create a personal access token on this page, and copy it.\n');
    openPage(`https://${consoleOf(args.api)}/me/tokens?new=1`, { noOpen: args.noOpen });
  } else if (!fromEnv) {
    // Where to get one, then what to do, each on its own line: written on the line readline then
    // takes over, the instruction was erased, and the user was left in front of a silent cursor.
    process.stdout.write(
      `Issue a personal access token at https://${consoleOf(args.api)}/me/tokens\n` +
        'No token yet? Run `ulabase login --new-token`: it opens that page for you.\n'
    );
  }

  const token =
    fromEnv || (await prompt('Paste it here and press Enter (it shows as dots):\n', true)).trim();

  if (!token) {
    process.stderr.write('No token given.\n');
    return 1;
  }

  const admin = createAdminClient({ apiBaseUrl: args.api });
  admin.useToken(token);

  try {
    await admin.verifyToken();
  } catch (err) {
    if (isApiError(err) && (err.status === 401 || err.status === 403)) {
      process.stderr.write(
        'That token was not accepted. It may have been revoked, it may have expired, ' +
          'or it may be a token for a different Ulabase installation.\n'
      );
    } else {
      process.stderr.write(`Could not reach ${args.api}: ${describe(err)}\n`);
    }
    return 1;
  }

  warnIfNotAPat(token);

  const path = writeSession({ token, api: args.api });
  process.stdout.write(`Logged in to ${args.api}.\nToken stored in ${path} (mode 0600).\n`);
  return 0;
}

function cmdLogout(): number {
  const removed = clearSession();
  process.stdout.write(
    removed ? `Logged out. Removed ${sessionPath()}.\n` : 'Not logged in; nothing to remove.\n'
  );
  // Revoking is a separate act, and this command cannot do it: the token is
  // gone from this machine, not from the account.
  if (removed) {
    process.stdout.write(
      `The token still exists — revoke it at ${consoleOf(defaultApi())} if it should stop working.\n`
    );
  }
  return 0;
}

const GLYPH: Record<string, string> = {
  satisfied: '·',
  applied: '+',
  missing: '?',
  failed: '✗',
  skipped: '—',
};

function render(e: ProgressEvent): void {
  if (e.state === 'running') return;
  const counter = `[${String(e.index).padStart(String(e.total).length)}/${e.total}]`;
  const suffix = e.error ? ` — ${e.error}` : '';
  process.stdout.write(`${counter} ${GLYPH[e.state] ?? ' '} ${e.step}${suffix}\n`);
}

function summarise(report: SetupReport): void {
  const counts = new Map<string, number>();
  for (const s of report.steps) counts.set(s.state, (counts.get(s.state) ?? 0) + 1);
  const parts = [...counts].map(([state, n]) => `${n} ${state}`);
  process.stdout.write(`\n${report.name} on ${report.srvId}: ${parts.join(', ')}\n`);

  if (report.dryRun && report.steps.some(s => s.state === 'missing')) {
    process.stdout.write('Dry run — nothing was written. Re-run without --dry-run to apply.\n');
  }

  // Repeated at the end because that is where it will be read. A run of twenty
  // steps scrolls, and the one line naming the variables is the line that tells
  // you what to do — it should not be the one that went past.
  //
  // `fromEnv` resolves inside `apply`, so this cannot be checked before the run
  // starts: whether a variable is needed at all depends on what the service
  // already holds. Which is also why earlier steps may have applied by the time
  // this appears, and why it says so.
  const missing = new Set<string>();
  for (const step of report.steps) {
    const m = /^missing (.+)$/.exec(step.error ?? '');
    if (m) m[1].split(', ').forEach(name => missing.add(name));
  }

  if (missing.size > 0) {
    const applied = report.steps.filter(s => s.state === 'applied').length;
    process.stdout.write(
      `\nMissing environment variable${missing.size > 1 ? 's' : ''}: ${[...missing].join(', ')}\n` +
        'Set them and run again — in a pipeline, from your secret store.\n' +
        (applied > 0
          ? `${applied} step${applied > 1 ? 's' : ''} had already been applied; re-running is safe.\n`
          : '')
    );
  }
}

/**
 * An admin client on the stored or environment token, checked before anything is done with it.
 *
 * What `setup`, `srv ls` and `app new` have in common: a credential, a refusal to send a stored
 * one to another admin node, and one cheap call that turns a revoked token into a sentence.
 */
async function signedInAdmin(args: Args): Promise<AdminClient> {
  const credential = requireToken();

  // A stored token was verified against one admin node and means nothing to
  // another. Sending it anyway would be a production credential offered to
  // whatever host --api happened to name.
  if (credential.source === 'file' && credential.api !== undefined && credential.api !== args.api) {
    throw new Error(
      `Your stored session is for ${credential.api}, not ${args.api}.\n` +
        `Run \`ulabase login --api ${args.api}\`, or set ${TOKEN_VAR}.`
    );
  }

  const admin: AdminClient = createAdminClient({ apiBaseUrl: args.api });
  admin.useToken(credential.token);

  try {
    await admin.verifyToken();
  } catch (err) {
    if (isApiError(err) && (err.status === 401 || err.status === 403)) {
      throw new Error(credentialError(credential.source, args.api));
    }
    throw err;
  }
  return admin;
}

/** Run a loaded setup and print it, as `setup` does. Returns the exit code of the run. */
async function runAndReport(setup: Setup, admin: AdminClient, args: Args, srvId: string, env: string): Promise<number> {
  const report = await runSetup(setup, {
    admin,
    srvId,
    env,
    dryRun: args.dryRun,
    force: args.force,
    ...(args.json ? {} : { onProgress: render }),
  });

  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else summarise(report);

  if (report.steps.some(s => s.state === 'failed')) return 1;
  if (report.steps.some(s => s.state === 'missing')) return 2;
  return 0;
}

// ── the pages of the console ────────────────────────────────────────────────

/** `ulabase signup`: the page where an account is created. The command creates nothing. */
function cmdSignup(args: Args): number {
  openPage(`https://${consoleOf(args.api)}/signup`, { noOpen: args.noOpen });
  process.stdout.write(
    'After you sign up, the console creates your first service with one button.\n' +
      'Then, here:\n\n' +
      '  ulabase login --new-token\n' +
      '  ulabase app new --name <name> --starter react\n'
  );
  return 0;
}

/**
 * `ulabase srv new`: the page where a service is created.
 *
 * It opens a page and creates nothing, so it is safe wherever it runs: a pipeline that calls it
 * gets a printed address. Services are created, and paid for, in the console only.
 */
function cmdSrvNew(args: Args): number {
  let query = '';
  if (args.plan !== undefined) {
    const tier = PLAN_TIERS[args.plan.toLowerCase()];
    if (!tier) {
      throw new Error(`--plan takes ${Object.keys(PLAN_TIERS).join(', ')}, not "${args.plan}".`);
    }
    query = `?tier=${tier}`;
  }

  // `/orgs/active/...`: the console waits for the account, then puts the active team in the address.
  // The shorter `/new-service` reads the team before the account is loaded and lands on the list of teams.
  openPage(`https://${consoleOf(args.api)}/orgs/active/new-service${query}`, { noOpen: args.noOpen });
  process.stdout.write(
    'The page gives you the id of the new service. Then, here:\n\n' +
      '  ulabase srv ls                  to see it in the list\n' +
      '  ulabase setup --srv <id>        in the folder of your app\n'
  );
  return 0;
}

/** `ulabase srv ls`: the services the stored token may act on. */
async function cmdSrvLs(args: Args): Promise<number> {
  const admin = await signedInAdmin(args);
  const services = await admin.listServices();

  if (args.json) {
    process.stdout.write(`${JSON.stringify(sortServices(services), null, 2)}\n`);
    return 0;
  }

  if (services.length === 0) {
    process.stdout.write('No services yet. Create one with `ulabase srv new`.\n');
    return 0;
  }

  process.stdout.write(`${formatServices(services)}\n`);
  return 0;
}

// ── a new app ───────────────────────────────────────────────────────────────

/** Ask to pick one of a list, by number. Returns the index, or -1 for an answer that picks none. */
async function choose(question: string, options: string[]): Promise<number> {
  options.forEach((o, i) => process.stdout.write(`  ${String(i + 1).padStart(2)}. ${o}\n`));
  const answer = (await prompt(`${question} `)).trim();
  const n = Number(answer);
  return Number.isInteger(n) && n >= 1 && n <= options.length ? n - 1 : -1;
}

/**
 * The service a new app is connected to: `--srv`, or the one picked from the list.
 *
 * @returns the id, or `null` with the reason already printed
 */
async function serviceForApp(args: Args, admin: AdminClient): Promise<string | null> {
  if (args.srv) return args.srv;

  if (!process.stdin.isTTY) {
    process.stdout.write('No --srv, and no terminal to ask which service: the app is not connected yet.\n');
    return null;
  }

  const services: ListedService[] = sortServices(await admin.listServices());

  if (services.length === 0) {
    process.stdout.write('You have no service yet. Create one with `ulabase srv new`.\n');
    return null;
  }

  process.stdout.write('\nWhich service does this app use?\n\n');
  const labels = services.map(s => `${s.name || s._id} (${s._id}, ${planLabel(s.plan)})`);
  const picked = await choose(
    services.length === 1 ? 'Press 1 to use it, or Enter to connect the app later:' : 'A number, or Enter to connect the app later:',
    labels
  );
  return picked < 0 ? null : services[picked]!._id;
}

/**
 * `ulabase app new`: a starter app in a new folder, its packages installed, connected to a
 * service.
 *
 * It creates no service and needs no token to download: with no session it leaves a working
 * tree and says what is missing. Connecting is the starter's own setup, run as `ulabase setup`
 * would in that folder: it configures the service and writes its address into the app.
 */
async function cmdAppNew(args: Args): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY);

  // the name: an option, asked for on a terminal
  let name = args.name;
  if (name === undefined) {
    if (!interactive) throw new Error('--name is required: ulabase app new --name <name> --starter <starter>');
    name = (await prompt('The name of the app, and of its folder: ')).trim();
  }
  if (!isAppName(name)) {
    throw new Error(
      `"${name}" cannot be the name of an app. Use lower-case letters, digits, "-", "_" and ".", starting with a letter or a digit.`
    );
  }

  // the starter: an option, asked for from the list of the ones that exist
  let starter = args.starter;
  if (starter === undefined) {
    if (!interactive) throw new Error('--starter is required: ulabase app new --name <name> --starter <starter>');
    const starters = await listStarters();
    if (!starters || starters.length === 0) {
      throw new Error('Could not read the list of starters. Pass one with --starter: see https://github.com/ulabase');
    }
    process.stdout.write('\nWhich starter?\n\n');
    const picked = await choose('A number:', starters);
    if (picked < 0) throw new Error('No starter chosen.');
    starter = starters[picked]!;
  }
  if (!isStarterName(starter)) {
    throw new Error(`--starter takes the name of a starter, such as react, not "${starter}".`);
  }

  const dir = resolve(process.cwd(), name);
  if (!folderIsFree(dir)) {
    throw new Error(`The folder ${name} exists and is not empty. Nothing was changed.`);
  }

  if (!hasGit()) {
    throw new Error(
      `git is required to download a starter, and it was not found.\nInstall git, or download the starter by hand: ${starterRepoPage(starter)}`
    );
  }

  process.stdout.write(`Downloading the ${starter} starter into ${name}...\n`);
  if (!cloneStarter(starter, dir)) {
    const starters = await listStarters();
    if (starters && !starters.includes(starter)) {
      throw new Error(`There is no starter called "${starter}". The starters are: ${starters.join(', ')}.`);
    }
    throw new Error(
      starters
        ? `Could not download the ${starter} starter. Check your connection and try again.`
        : `Could not download the ${starter} starter. The starters are at https://github.com/ulabase`
    );
  }

  nameThePackage(dir, name);

  let installed = false;
  if (args.noInstall) {
    process.stdout.write('Skipping npm install (--no-install).\n');
  } else {
    process.stdout.write('Installing its packages...\n');
    installed = installPackages(dir);
    if (!installed) process.stderr.write('npm install failed. Run it again in the folder of the app.\n');
  }

  // Connecting: the starter's setup, on the service chosen. Each reason not to is said.
  let connected: string | null = null;
  const missing: string[] = [];

  if (args.noSetup) {
    missing.push('ulabase setup --srv <id>');
  } else if (!installed) {
    // the setup file imports this package from the app's own node_modules
    missing.push(...(args.noInstall ? ['npm install'] : []), 'ulabase setup --srv <id>');
  } else if (!resolveToken()) {
    missing.push('ulabase login --new-token', 'ulabase setup --srv <id>');
  } else {
    const admin = await signedInAdmin(args);
    const srvId = await serviceForApp(args, admin);
    if (srvId === null) {
      missing.push('ulabase setup --srv <id>');
    } else {
      const file = DEFAULT_FILES.map(f => resolve(dir, f)).find(f => existsSync(f));
      if (!file) {
        process.stdout.write('This starter has no setup file: there is nothing to connect.\n');
      } else {
        process.stdout.write(`\nConnecting ${name} to the service ${srvId}:\n\n`);
        const code = await runAndReport(await loadSetup(file), admin, args, srvId, DEFAULT_ENV);
        if (code === 0) connected = srvId;
        else missing.push(`ulabase setup --srv ${srvId}`);
      }
    }
  }

  process.stdout.write(`\n${name} is ready in ./${name}\n`);
  if (connected) {
    process.stdout.write(`It is connected to the service ${connected}. Start it:\n\n`);
  } else if (missing.length > 0) {
    process.stdout.write('It is not connected to a service yet, and it will not work until it is. Next:\n\n');
  } else {
    process.stdout.write('Start it:\n\n');
  }
  process.stdout.write(`  cd ${name}\n`);
  missing.forEach(m => process.stdout.write(`  ${m}\n`));
  process.stdout.write(`  ${startCommand(dir)}\n`);
  return 0;
}

async function cmdSetup(args: Args): Promise<number> {
  if (!args.srv) {
    process.stderr.write(`--srv is required.\n${USAGE}`);
    return 1;
  }

  const env = args.env ?? DEFAULT_ENV;
  if (!isEnvName(env)) {
    throw new Error(`--env takes a name such as development or production, not "${env}".`);
  }

  const setup = await loadSetup(resolveFile(args.file));
  const admin = await signedInAdmin(args);

  if (args.force && args.dryRun) {
    // Not an error worth failing on, but they pull opposite ways: a dry run
    // asks what is missing, and forcing declares everything missing.
    process.stderr.write('--force has no effect with --dry-run; every step is reported missing.\n');
  }

  return runAndReport(setup, admin, args, args.srv, env);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  // With no --api and no ULABASE_API, the admin node is the one of the stored session: who logged
  // in to another installation keeps working on it, and the pages opened are of its console.
  if (!args.apiGiven && !process.env[API_VAR]?.trim()) {
    const session = readSession();
    if (session) args.api = session.api;
  }

  // Before everything else, including the command check: `ulabase -v` has to answer
  // on a machine where nothing is set up yet, which is most of when it is asked.
  if (args.version) {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  if (args.help || args.command === undefined) {
    // No command is not an error worth a non-zero exit only when it was asked
    // for: `ulabase` alone should show what it can do, `ulabase --srv x` should not
    // silently guess that `setup` was meant.
    const asked = args.help || process.argv.length <= 2;
    (asked ? process.stdout : process.stderr).write(USAGE);
    return asked ? 0 : 1;
  }

  switch (args.command) {
    case 'signup': return cmdSignup(args);
    case 'login': return cmdLogin(args);
    case 'logout': return cmdLogout();
    case 'setup': return cmdSetup(args);
    case 'srv': return args.action === 'ls' ? cmdSrvLs(args) : cmdSrvNew(args);
    case 'app': return cmdAppNew(args);
  }
}

main().then(
  code => process.exit(code),
  err => {
    process.stderr.write(`${describe(err)}\n`);
    process.exit(1);
  }
);

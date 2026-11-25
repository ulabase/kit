import { spawn } from 'node:child_process';

/**
 * Opening a page of the console from the terminal.
 *
 * `signup`, `srv new` and `login --new-token` create nothing themselves: they take the person to
 * the page where the thing is done, and the browser completes it. So the one job here is to get
 * an address in front of someone, whatever the machine: opened in the default browser where there
 * is one, and always printed, so it can be opened on another device.
 */

/** What decides whether a browser can be opened: the platform, the environment, the terminal. */
export interface OpenContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  /** Whether standard output is a terminal. A redirected run is a script, and opens nothing. */
  stdoutIsTTY: boolean;
}

/**
 * Whether trying to open a browser makes sense here.
 *
 * No over ssh, where the browser would open on a machine nobody is looking at, or nowhere. No on
 * Linux with no display. No when the output is redirected: that is a script or a pipeline.
 */
export function canOpenBrowser(ctx: OpenContext): boolean {
  if (!ctx.stdoutIsTTY) return false;
  if (ctx.env['SSH_CONNECTION'] || ctx.env['SSH_TTY'] || ctx.env['SSH_CLIENT']) return false;
  if (ctx.env['CI']) return false;
  if (ctx.platform === 'linux' && !ctx.env['DISPLAY'] && !ctx.env['WAYLAND_DISPLAY']) return false;
  return ctx.platform === 'darwin' || ctx.platform === 'linux' || ctx.platform === 'win32';
}

/** The command that opens an address in the default browser, by platform. */
export function openCommand(platform: NodeJS.Platform, url: string): { command: string; args: string[] } {
  switch (platform) {
    case 'darwin':
      return { command: 'open', args: [url] };
    case 'win32':
      // Not `start`: it is a builtin of cmd, and cmd reads the `&` of a query string as its own.
      return { command: 'rundll32', args: ['url.dll,FileProtocolHandler', url] };
    default:
      return { command: 'xdg-open', args: [url] };
  }
}

export interface OpenOptions {
  /** `--no-open`: print the address and open nothing. */
  noOpen?: boolean;
  /** Where the lines go. Defaults to standard output. */
  write?: (line: string) => void;
  /** The machine, for a test. Defaults to this process. */
  context?: OpenContext;
  /** Starts the browser, for a test. Defaults to a detached child process. */
  launch?: (command: string, args: string[]) => void;
}

/**
 * Print an address and, where there is a browser, open it.
 *
 * The address is printed on its own line in every case. A browser that fails to start is not an
 * error: the address is on the screen.
 *
 * @returns whether a browser was started
 */
export function openPage(url: string, options: OpenOptions = {}): boolean {
  const write = options.write ?? ((line: string) => void process.stdout.write(`${line}\n`));
  const context = options.context ?? {
    platform: process.platform,
    env: process.env,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  };

  const open = !options.noOpen && canOpenBrowser(context);

  write(open ? 'Opening this page in your browser:' : 'Open this page in a browser:');
  write('');
  write(`  ${url}`);
  write('');

  if (!open) return false;

  const { command, args } = openCommand(context.platform, url);
  try {
    if (options.launch) {
      options.launch(command, args);
    } else {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      // a missing xdg-open arrives here, asynchronously: the address is already printed
      child.on('error', () => {});
      child.unref();
    }
    return true;
  } catch {
    return false;
  }
}

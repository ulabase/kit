/**
 * Secrets in a setup that lives in git.
 *
 * A setup file is committed alongside the code it configures, and a step that
 * configures the `stripe` feature needs a live secret key. `fromEnv` is how the
 * setup names one without holding it: the setup carries a marker, and the marker
 * becomes a value in exactly one place — while the admin client serialises the
 * request body that carries it.
 *
 * ```ts
 * apply: ({ admin, srvId }) => admin.updateFeatureConfig(srvId, 'stripe', {
 *   'secret-key': fromEnv('STRIPE_SECRET_KEY'),
 *   'success-url': 'https://shop.example.com/checkout/done',
 * }),
 * ```
 *
 * The value is never returned to the setup, never reaches the run report, and a
 * dry run never resolves one at all, because a dry run runs no `apply`.
 */

const MARKER = Symbol.for('@ulabase/cli:fromEnv');

export interface EnvRef {
  readonly [MARKER]: true;
  /** The environment variable this stands for. A name, never a value. */
  readonly name: string;
  toString(): string;
  toJSON(): never;
}

/**
 * A reference to an environment variable, resolved at apply time.
 *
 * Typed as `string` on purpose. A config value is a string as far as the caller
 * is concerned, and threading `string | EnvRef` through every feature config
 * shape would push the marker into the type of every field it could ever be
 * used for — for a substitution that has already happened by the time the
 * server sees it.
 */
export function fromEnv(name: string): string {
  const ref: EnvRef = {
    [MARKER]: true,
    name,
    // A marker that escapes into a log through some path we did not anticipate
    // prints the variable's name, which is not a secret. It never prints a
    // value, because it never holds one.
    toString: () => `fromEnv(${name})`,
    // The backstop, and the reason it is worth having: `JSON.stringify` on an
    // unresolved marker would otherwise succeed and quietly emit
    // `{"name":"STRIPE_SECRET_KEY"}` — an object where the secret should be,
    // written to the service without a word. Every request body in this package
    // is resolved before it is serialised, so this should never fire; it exists
    // because "should never" is not a guarantee, and a loud failure beats a
    // config that looks configured.
    toJSON: () => {
      throw new Error(
        `fromEnv(${name}) reached JSON serialisation unresolved — ` +
          'this is a bug in @ulabase/cli, not in your setup'
      );
    },
  };
  return ref as unknown as string;
}

/** True when `value` is a `fromEnv` marker. */
export function isEnvRef(value: unknown): value is EnvRef {
  return typeof value === 'object' && value !== null && MARKER in value;
}

/** Where `resolveEnvRefs` reads from. A plain record, so a test can supply one. */
export type EnvSource = Record<string, string | undefined>;

/**
 * The ambient environment, or an empty one where there is none.
 *
 * Read through `globalThis` rather than imported, so this module stays free of
 * a Node built-in and the client layer remains unit-testable without one.
 */
export function defaultEnv(): EnvSource {
  return (globalThis as { process?: { env?: EnvSource } }).process?.env ?? {};
}

/**
 * Thrown when a setup references a variable the environment does not have.
 *
 * Names the variable — which is not a secret — rather than sending `undefined`
 * and collecting a rejection from the provider three steps later, which reads
 * like a bad key rather than a missing one.
 */
export class MissingEnvError extends Error {
  readonly names: string[];
  constructor(names: string[]) {
    super(
      names.length === 1
        ? `missing ${names[0]}`
        : `missing ${names.join(', ')}`
    );
    this.name = 'MissingEnvError';
    this.names = names;
  }
}

/**
 * Replace every `fromEnv` marker in `value` with what the environment holds,
 * returning a copy. Collects *every* missing variable before throwing, so a
 * pipeline that is short three secrets learns all three from one run.
 */
export function resolveEnvRefs<T>(value: T, env: EnvSource = defaultEnv()): T {
  const missing: string[] = [];
  const out = walk(value, env, missing);
  if (missing.length > 0) throw new MissingEnvError(missing);
  return out as T;
}

function walk(value: unknown, env: EnvSource, missing: string[]): unknown {
  if (isEnvRef(value)) {
    const resolved = env[value.name];
    // An empty string is as unusable as an absent one for a secret, and far
    // more confusing to debug — a CI variable declared but never populated
    // arrives exactly this way.
    if (resolved === undefined || resolved === '') {
      missing.push(value.name);
      return undefined;
    }
    return resolved;
  }
  if (Array.isArray(value)) return value.map(v => walk(v, env, missing));
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = walk(v, env, missing);
    return out;
  }
  return value;
}

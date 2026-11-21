import { describe, it, expect, vi } from 'vitest';
import { defineSetup, runSetup, step, type ProgressEvent } from '../../setup.js';
import type { AdminClient } from '../../admin.js';
import type { ServiceClient } from '../../service.js';
import { fromEnv, MissingEnvError } from '../../env.js';

const admin = {} as AdminClient;
const service = {} as ServiceClient;

interface RunOpts {
  dryRun?: boolean;
  force?: boolean;
  onProgress?: (e: ProgressEvent) => void;
}

const run = (steps: Parameters<typeof defineSetup>[1], opts: RunOpts = {}) =>
  runSetup(defineSetup('Test', steps), {
    admin,
    srvId: 'ea820b',
    service,
    dryRun: opts.dryRun ?? false,
    force: opts.force ?? false,
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });

const states = (report: Awaited<ReturnType<typeof runSetup>>) => report.steps.map(s => s.state);

describe('runSetup', () => {
  it('leaves a satisfied step alone', async () => {
    const apply = vi.fn();
    const report = await run([step('already there', { check: () => true, apply })]);

    expect(states(report)).toEqual(['satisfied']);
    expect(apply).not.toHaveBeenCalled();
    expect(report.ok).toBe(true);
  });

  it('applies an unsatisfied step and re-checks it', async () => {
    let done = false;
    const report = await run([
      step('catalog collection', {
        check: () => done,
        apply: () => {
          done = true;
        },
      }),
    ]);

    expect(states(report)).toEqual(['applied']);
    expect(report.ok).toBe(true);
  });

  it('reports an apply that silently did nothing as failed, not green', async () => {
    // Slow on purpose: the re-check retries for about fifteen seconds before
    // giving up. An apply that did nothing does not start working at second
    // fourteen, so the verdict is the same — it just takes the full window to
    // reach it.
    const report = await run([
      step('does nothing', { check: () => false, apply: () => undefined }),
    ]);

    expect(states(report)).toEqual(['failed']);
    expect(report.steps[0]!.error).toBe('applied, but the check still fails');
    expect(report.ok).toBe(false);
  }, 30_000);

  it('waits for an apply whose effect the check cannot see yet', async () => {
    // The apply and the check do not always speak to the same process. Plugin
    // install and init run on the admin node, which writes to the tenant's
    // database; the check then asks the service node, which caches collection
    // metadata for a second. A step that genuinely worked was reported failed,
    // and the run halted on a service that was in fact correct.
    let visible = false;
    let checks = 0;

    const report = await run([
      step('collections the service node has not noticed yet', {
        check: () => {
          checks += 1;
          return visible;
        },
        apply: () => {
          // Late, as the cache expiring is late.
          setTimeout(() => {
            visible = true;
          }, 400);
        },
      }),
    ]);

    expect(states(report)).toEqual(['applied']);
    // The first check, the immediate re-check, and at least one retry.
    expect(checks).toBeGreaterThanOrEqual(3);
  });

  it('waits out an init that takes seconds, not milliseconds', async () => {
    // The case that made the window too short. `initPlugin` returns once the
    // admin node has triggered the work, and the service node then creates
    // collections, builds indexes and installs a schema — which took longer
    // than the three seconds the retries allowed, so a service that had been
    // set up correctly was reported as failed and the run halted.
    let visible = false;

    const report = await run([
      step('stripe collections and indexes initialised', {
        check: () => visible,
        apply: () => {
          setTimeout(() => {
            visible = true;
          }, 5000);
        },
      }),
    ]);

    expect(states(report)).toEqual(['applied']);
  }, 30_000);

  it('applies a satisfied step when forced, and still verifies it', async () => {
    // The escape hatch for a change the check cannot see: an edited permission
    // under the id it already had, a schema rewritten under the same name.
    const applied = vi.fn();
    const report = await run(
      [step('already so', { check: () => true, apply: applied })],
      { force: true }
    );

    expect(applied).toHaveBeenCalledTimes(1);
    expect(states(report)).toEqual(['applied']);
  });

  it('forcing does not turn a broken step green', async () => {
    // Skipping the question is not skipping the answer: the re-check still runs.
    const report = await run(
      [step('does nothing', { check: () => false, apply: () => undefined })],
      { force: true }
    );

    expect(states(report)).toEqual(['failed']);
  }, 30_000);

  it('stops the rest when a step fails, because configuration has dependencies', async () => {
    const third = vi.fn(() => true);
    const report = await run([
      step('collection', { check: () => true, apply: () => undefined }),
      step('plugin install', {
        check: () => false,
        apply: () => {
          throw { status: 409, message: 'Plugin already installed' };
        },
      }),
      step('plugin config', { check: third, apply: () => undefined }),
    ]);

    expect(states(report)).toEqual(['satisfied', 'failed', 'skipped']);
    expect(report.steps[1]!.error).toBe('409 Plugin already installed');
    // Not merely unattempted — never even asked, so its failure cannot be
    // mistaken for a second, independent problem.
    expect(third).not.toHaveBeenCalled();
  });

  it('an optional step that fails does not take the rest of the setup with it', async () => {
    // The CORS origin a browser needs was configured after a social sign-in provider whose
    // credentials nobody had set. The provider step failed, everything after it was skipped,
    // and the missing origin surfaced much later as a browser error with nothing to connect it
    // to. A step the rest does not depend on says so, and the run carries on.
    let corsConfigured = false;
    const later = vi.fn(() => corsConfigured);
    const report = await run([
      step('social provider', {
        check: () => false,
        apply: () => {
          throw new Error('missing GOOGLE_CLIENT_SECRET');
        },
        optional: true,
      }),
      step('cors origin', {
        check: later,
        apply: () => {
          corsConfigured = true;
        },
      }),
    ]);

    expect(states(report)).toEqual(['failed', 'applied']);
    expect(later).toHaveBeenCalled();
    // still not a green run: optional is about what follows, not about pretending
    expect(report.ok).toBe(false);
  });

  it('a required step still stops the rest', async () => {
    const later = vi.fn(() => true);
    const report = await run([
      step('collection', {
        check: () => false,
        apply: () => {
          throw new Error('nope');
        },
      }),
      step('index over it', { check: later, apply: () => undefined }),
    ]);

    expect(states(report)).toEqual(['failed', 'skipped']);
    expect(later).not.toHaveBeenCalled();
  });

  it('a dry run answers what is missing, all of it, and writes nothing', async () => {
    const applies = [vi.fn(), vi.fn(), vi.fn()];
    const report = await run(
      [
        step('collection', { check: () => true, apply: applies[0]! }),
        step('index', { check: () => false, apply: applies[1]! }),
        step('permission', { check: () => false, apply: applies[2]! }),
      ],
      { dryRun: true }
    );

    expect(states(report)).toEqual(['satisfied', 'missing', 'missing']);
    expect(applies.every(a => !a.mock.calls.length)).toBe(true);
    // A dry run with work outstanding is not a pass.
    expect(report.ok).toBe(false);
    expect(report.dryRun).toBe(true);
  });

  it('a dry run never resolves a fromEnv marker', async () => {
    const env = { STRIPE_SECRET_KEY: 'sk_live_real' };
    const seen: unknown[] = [];
    const report = await run(
      [
        step('stripe configured', {
          check: () => false,
          apply: () => {
            seen.push(fromEnv('STRIPE_SECRET_KEY'));
          },
        }),
      ],
      { dryRun: true }
    );

    expect(states(report)).toEqual(['missing']);
    expect(seen).toHaveLength(0);
    expect(env.STRIPE_SECRET_KEY).toBe('sk_live_real'); // untouched, unread
  });

  it('emits a step name and state, and nothing that could carry a secret', async () => {
    const events: ProgressEvent[] = [];
    await run(
      [
        step('stripe configured', { check: () => true, apply: () => undefined }),
        step('never runs', { check: () => false, apply: () => { throw new Error('boom'); } }),
      ],
      { onProgress: e => events.push(e) }
    );

    expect(events).toEqual([
      { step: 'stripe configured', state: 'running', index: 1, total: 2 },
      { step: 'stripe configured', state: 'satisfied', index: 1, total: 2 },
      { step: 'never runs', state: 'running', index: 2, total: 2 },
      { step: 'never runs', state: 'failed', error: 'boom', index: 2, total: 2 },
    ]);
  });

  it('reports a missing environment variable by name', async () => {
    const report = await run([
      step('stripe configured', {
        check: () => false,
        apply: () => {
          throw new MissingEnvError(['STRIPE_SECRET_KEY']);
        },
      }),
    ]);

    expect(report.steps[0]!.error).toBe('missing STRIPE_SECRET_KEY');
  });

  it('hands each step both clients and the service id', async () => {
    const seen: unknown[] = [];
    await run([
      step('sees its context', {
        check: ctx => {
          seen.push(ctx);
          return true;
        },
        apply: () => undefined,
      }),
    ]);

    expect(seen[0]).toEqual({ admin, service, srvId: 'ea820b' });
  });
});

/**
 * The properties a real setup is written to have, against a target that
 * remembers what was done to it.
 *
 * Deliberately synthetic. A concrete setup — the ecommerce one — belongs to the
 * application it configures and lives in that starter's repo; what has to hold
 * *here* is that the runner gives any such setup idempotence and an honest dry
 * run, and a fake target shows that without tying this suite to one app's
 * collection names.
 */
describe('a multi-step setup against a stateful target', () => {
  /** Six things that must exist, none of which do yet. */
  function target() {
    const done = new Set<string>();
    const writes: string[] = [];
    const steps = ['collection', 'index', 'plugin', 'plugin config', 'read rule', 'write rule'].map(
      name =>
        step(name, {
          check: () => done.has(name),
          apply: () => {
            writes.push(name);
            done.add(name);
          },
        })
    );
    return { steps, writes, done };
  }

  it('configures an empty target, then does nothing at all the second time', async () => {
    const t = target();
    const setup = defineSetup('Six', t.steps);
    const opts = { admin, service, srvId: 'ea820b' };

    const first = await runSetup(setup, opts);
    expect(first.steps.map(s => s.state)).toEqual(Array(6).fill('applied'));
    expect(first.ok).toBe(true);
    expect(t.writes).toHaveLength(6);

    const second = await runSetup(setup, opts);
    expect(second.steps.map(s => s.state)).toEqual(Array(6).fill('satisfied'));
    expect(second.ok).toBe(true);
    // The point of the whole exercise: a re-run is not a cheaper run, it is no
    // run at all.
    expect(t.writes).toHaveLength(6);
  });

  it('a dry run reports every outstanding step, not just the first', async () => {
    const t = target();
    t.done.add('collection');

    const report = await runSetup(defineSetup('Six', t.steps), {
      admin,
      service,
      srvId: 'ea820b',
      dryRun: true,
    });

    expect(report.steps.map(s => s.state)).toEqual([
      'satisfied', 'missing', 'missing', 'missing', 'missing', 'missing',
    ]);
    expect(t.writes).toHaveLength(0);
    expect(report.ok).toBe(false);
  });

  it('a partially configured target applies only what is left', async () => {
    const t = target();
    t.done.add('collection');
    t.done.add('plugin');

    const report = await runSetup(defineSetup('Six', t.steps), { admin, service, srvId: 'ea820b' });

    expect(report.steps.map(s => s.state)).toEqual([
      'satisfied', 'applied', 'satisfied', 'applied', 'applied', 'applied',
    ]);
    expect(t.writes).toEqual(['index', 'plugin config', 'read rule', 'write rule']);
  });
});

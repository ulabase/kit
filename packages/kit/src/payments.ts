import type { AuthConfig, GrantLicenseResult, Licenses, Plan, Subscription } from './types.js';
import { apiFetch } from './client.js';

/**
 * Payments have a different relationship to the session than everything else
 * in this module.
 *
 * **No token renewal, ever.** Every other write in the kit that changes what a
 * Guards rule sees (`acceptConsents`, `switchTeam`, `updateProfile`) renews the
 * token afterwards, because the guard reads the JWT. `@subscription` does not:
 * it is resolved server-side from the database on every request, cached only
 * for the life of that request (`SubscriptionVarResolver`). An upgrade is
 * therefore effective immediately, with no re-login and no `renewToken` call —
 * copying the consents pattern here would add a needless round trip on every
 * checkout.
 *
 * **The redirect back from Checkout races the webhook.** Stripe sends the
 * buyer back to `successUrl` over the browser; it reports the payment over a
 * separate server-to-server webhook, with no ordering guarantee between the
 * two. A page that calls {@link getSubscription} the moment it mounts can read
 * the *old* plan — not a bug, just too early. Use {@link waitForSubscription}
 * on that page instead of a bare `getSubscription`.
 */

// ── Plans & subscription ────────────────────────────────────────────────────

/**
 * The service's subscription plan catalog.
 *
 * No session required — `StripePlansService` does not check authentication,
 * so this is safe to call from a public pricing page. (A deployment that
 * wants the catalog itself private would need its own ACL rule; the kit does
 * not add one.)
 */
export async function getPlans(config: AuthConfig): Promise<{ default_plan: string; plans: Plan[] }> {
  const res = await apiFetch(config, '/stripe/plans');
  return res.json() as Promise<{ default_plan: string; plans: Plan[] }>;
}

/**
 * The caller's team's subscription.
 *
 * Any team member may call this — unlike {@link createCheckoutSession},
 * {@link openBillingPortal} and the licence functions, it is **not** gated on
 * `canManageBilling`. A member who cannot change the plan can still see it.
 */
export async function getSubscription(config: AuthConfig): Promise<Subscription> {
  const res = await apiFetch(config, '/stripe/subscription');
  return res.json() as Promise<Subscription>;
}

/**
 * Starts a Stripe Checkout session for `plan`/`interval` and returns the URL
 * to send the buyer to — `window.location.href = url`, nothing embedded.
 *
 * Requires `canManageBilling` (see {@link Subscription} and the module
 * doc) — a plain member gets a `403`, distinguishable on `ApiError.status`
 * like any other.
 *
 * **Rejects with `status: 409`** when the team already has an active
 * subscription — Checkout does not do upgrades/downgrades, only new
 * subscriptions. Send an already-subscribed team to {@link openBillingPortal}
 * instead, where Stripe's own UI handles the plan change.
 *
 * @param interval `'month'` or `'year'` — must match a price the plan
 *                 declares, or this rejects with `status: 400`.
 * @param locale   Optional. The language of the Checkout page, a code of 2 to 5
 *                 letters such as `'it'`: pass the language of the page the buyer
 *                 is on. Without it the page is in the language of the team's
 *                 billing contact, else Stripe follows the browser. Needs
 *                 RESTHeart 9.17.1.
 */
export async function createCheckoutSession(
  config: AuthConfig,
  plan: string,
  interval: 'month' | 'year',
  locale?: string
): Promise<{ url: string }> {
  const res = await apiFetch(config, '/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify(locale ? { plan, interval, locale } : { plan, interval }),
  });
  return res.json() as Promise<{ url: string }>;
}

/**
 * Opens a Stripe Customer Portal session — the buyer's self-service page for
 * payment method, invoices, plan change and cancellation. Returns the URL to
 * redirect to, same as {@link createCheckoutSession}.
 *
 * Requires `canManageBilling`, same as checkout.
 *
 * **Rejects with `status: 402`** for a team that has never checked out: the
 * Portal has nothing to manage without a Stripe Customer behind it. Route a
 * `402` to {@link createCheckoutSession} instead of retrying the Portal.
 *
 * @param locale Optional. The language of the Portal, with the same rule as
 *               {@link createCheckoutSession}. Needs RESTHeart 9.17.1.
 */
export async function openBillingPortal(config: AuthConfig, locale?: string): Promise<{ url: string }> {
  // no body without a locale, as before: an older service is sent nothing new
  const res = await apiFetch(
    config,
    '/stripe/portal',
    locale ? { method: 'POST', body: JSON.stringify({ locale }) } : { method: 'POST' }
  );
  return res.json() as Promise<{ url: string }>;
}

// ── Seat licences ────────────────────────────────────────────────────────────

/** The caller's team's seat licences. Requires `canManageBilling`. */
export async function getLicenses(config: AuthConfig): Promise<Licenses> {
  const res = await apiFetch(config, '/stripe/licenses');
  return res.json() as Promise<Licenses>;
}

/**
 * Grants `userId` a seat licence. Requires `canManageBilling`.
 *
 * Returns which of the two non-error outcomes happened — `apiFetch` already
 * turns the other two (`404` no such member, `409` no seat available) into a
 * rejected `ApiError`, so this only ever resolves to one of:
 * - `'granted'` (`201`) — a seat was taken
 * - `'already-licensed'` (`200`) — `userId` already had one, nothing changed
 */
export async function grantLicense(config: AuthConfig, userId: string): Promise<GrantLicenseResult> {
  const res = await apiFetch(config, '/stripe/licenses', {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  return res.status === 201 ? 'granted' : 'already-licensed';
}

/** Revokes `userId`'s seat licence. Requires `canManageBilling`. */
export async function revokeLicense(config: AuthConfig, userId: string): Promise<void> {
  await apiFetch(config, '/stripe/licenses', {
    method: 'DELETE',
    body: JSON.stringify({ userId }),
  });
}

// ── Waiting for the webhook ─────────────────────────────────────────────────

export interface WaitOptions {
  /** @default 30_000 */
  timeoutMs?: number;
  /** @default 1_000 */
  intervalMs?: number;
  signal?: AbortSignal;
}

/** Thrown by {@link waitForSubscription}/{@link waitForOrder} when the condition never became true in time. */
export class WaitTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaitTimeoutError';
  }
}

/**
 * Polls {@link getSubscription} until `predicate` is satisfied — the fix for
 * the webhook race described in the module doc.
 *
 * The first check runs immediately, before any wait: the common case is that
 * the webhook already landed by the time the buyer's browser finishes the
 * redirect, and a page that always waited a full `intervalMs` before its
 * first look would turn an instant confirmation into a visibly slow one.
 *
 * There is no single "the plan changed" condition — an upgrade, a downgrade
 * and a cancellation are all "the plan changed" but the caller knows which one
 * it is waiting for, so `predicate` is explicit rather than guessed:
 *
 * ```ts
 * // on the Checkout success page, after starting a checkout for 'gold'
 * const sub = await waitForSubscription(config, s => s.plan === 'gold' && s.active);
 * ```
 *
 * **Timing out is not a failure of the payment** — Stripe already has the
 * money; only the webhook that would reflect it here is late. This rejects
 * with a {@link WaitTimeoutError} distinguishable by `instanceof`/`.name`, on
 * purpose distinct from `ApiError`, so a caller does not lump "you're not
 * subscribed" (an `ApiError`) together with "you are, we just haven't heard
 * yet" (a `WaitTimeoutError`) under the same error screen.
 *
 * @param predicate Called with each fetched {@link Subscription}; resolves on the first `true`.
 */
export async function waitForSubscription(
  config: AuthConfig,
  predicate: (subscription: Subscription) => boolean,
  opts: WaitOptions = {}
): Promise<Subscription> {
  const { timeoutMs = 30_000, intervalMs = 1_000, signal } = opts;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    signal?.throwIfAborted();
    const subscription = await getSubscription(config);
    if (predicate(subscription)) return subscription;

    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(
        `waitForSubscription: condition not met within ${timeoutMs}ms — the payment may have succeeded; the webhook may just be late`
      );
    }
    await sleep(intervalMs, signal);
  }
}

/** `setTimeout` as a `Promise`, abortable — shared by {@link waitForSubscription} and `waitForOrder`. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Login mode.
 * - 'bearer' (default): token managed client-side (localStorage)
 * - 'cookie': JWT cookie managed by the backend (HttpOnly)
 */
export type LoginMode = 'bearer' | 'cookie';

export interface AuthConfig {
  apiBaseUrl: string;
  /**
   * Where the bearer token comes from.
   *
   * Defaults to the browser `localStorage` store used by SPA adapters. Server
   * runtimes (Next.js middleware/route handlers, Nuxt server middleware) have no
   * `localStorage`; they pass a source that reads the token from the request
   * cookie instead. May be async so the source can await a cookie store.
   */
  getToken?: () => string | null | Promise<string | null>;
  /**
   * Where a freshly obtained bearer token is persisted, after `login` and the
   * auto-login endpoints (`activate`, `resetPassword`, `switchTeam`).
   *
   * Defaults to the browser `localStorage` store plus a proactive refresh timer.
   * Server runtimes pass a sink that simply captures the token — so a server
   * action can write it into a response cookie — instead of touching
   * `localStorage` (which on a server would leak into a shared module global) or
   * scheduling a `setTimeout` refresh (which a server has nothing to refresh).
   *
   * When set, the localStorage store and the refresh timer are both bypassed.
   */
  setToken?: (token: string) => void;
  /**
   * How a request actually goes out. Defaults to the global `fetch`.
   *
   * The core is framework-agnostic and speaks `fetch`, which means its calls
   * bypass whatever HTTP stack the host framework has — and with it every
   * cross-cutting concern wired into that stack. In Angular that is literal:
   * an interceptor sees `HttpClient` traffic and nothing else, so a tracing
   * header, a retry policy or a global error handler would silently cover the
   * application's own requests and not the kit's.
   *
   * An adapter can close that gap by passing its framework's client here.
   * `kit-ng` does exactly this, routing every call through `HttpClient` so the
   * interceptor chain applies to all of it.
   *
   * The contract is `fetch`'s, and deliberately so — the core uses only `ok`,
   * `status`, `statusText`, `json()`, `clone()` and `headers.get()`. Two things
   * an implementation must get right: **resolve** on a non-2xx response rather
   * than rejecting (clients like `HttpClient` throw, and the core reads the
   * status itself), and reject only when the request never produced a response
   * at all.
   */
  transport?: (url: string, init?: RequestInit) => Promise<Response>;
  /**
   * Called whenever a call to the service fails, just before the error is
   * thrown to whoever made the call.
   *
   * Session restoration happens on its own schedule — on mount, on navigation,
   * on a token refresh — with no call site of yours to wrap in a `try`. When it
   * fails, adapters have to keep the application usable, which means the
   * failure is absorbed: a rejected `checkSession` ends up as "no user", and
   * "no user" looks exactly like "signed out". A dropped connection and an
   * expired session become the same screen.
   *
   * This is the seam for telling them apart. It sees every failure, including
   * the ones no caller is waiting on:
   *
   * ```ts
   * onError: err => {
   *   if (err.status === 451) showConsentsGate();
   *   if (err.status === 0) showOfflineBanner();
   * }
   * ```
   *
   * It observes; it cannot swallow. The error is thrown either way, so this is
   * not a place to handle failures a caller is already handling — it is a place
   * to notice the ones nobody is.
   */
  onError?: (error: ApiError) => void;

  /**
   * Opt-in to subscription and payment features.
   *
   * When `true`, adapters load the team's subscription on `checkSession`,
   * `login` and `switchTeam`, and expose `subscription`, `plan`,
   * `isSubscribed`, `canManageBilling` and `seatsAvailable` as reactive state.
   *
   * When `false` or absent (the default), no call to `/stripe/*` is ever made
   * — a service without the `stripe` plugin would respond `404` on those
   * paths, and this flag prevents that from happening on every app startup.
   */
  payments?: boolean;

  /**
   * The role that grants billing management rights.
   *
   * Used to derive `canManageBilling`: `true` when the current user's team
   * role matches this value. Defaults to `'owner'`.
   *
   * **Must match the service's `accountsConfig.ownership-role`** — if the
   * deployment overrides it (via `override-accounts-ownership-role`), hardcoding
   * `'owner'` here would show the billing button to the wrong people and hide
   * it from the right ones. The default is correct for most deployments.
   */
  ownershipRole?: string;
}

/**
 * Base user document returned by `/users/me`.
 *
 * Applications whose users collection has a JSON Schema can extend this
 * with their own fields via the generic parameter:
 *
 * ```ts
 * type MyUser = UserInfo<{
 *   latestConsents?: { tos: string; pp: string; acceptedAt?: { $date: number } };
 * }>;
 *
 * const user = await checkSession<{ latestConsents?: … }>(config);
 * const accepted = user?.latestConsents?.tos === CURRENT_TOS_VERSION;
 * ```
 *
 * The fields are optional because the user document does not carry them until
 * the user accepts — which is the state a Guards rule blocks on.
 *
 * The extra properties are populated only when the server's JSON Schema
 * declares them. When no schema is configured the server silently drops
 * any properties beyond the base set — the request still succeeds with
 * `201` on registration.
 */
export type UserInfo<E extends object = Record<never, never>> = {
  _id: string;
  roles: string[];
  team?: { _id: { $oid: string }; role: string };
  profile?: {
    name?: string;
    surname?: string;
    avatarUrl?: string;
  };
} & E;

export interface TokenInfo {
  username: string;
  roles: string[];
  /**
   * @deprecated No token carries the team since RESTHeart 9.12.0: always undefined.
   * Read the active team from `user.team` (`GET /users/me`). Removed in the next major.
   */
  team?: { _id: { $oid: string }; role: string };
  expires_in: number;
  access_token: string;
  token_type: string;
}

export interface TeamMembership {
  id: { $oid: string };
  name?: string;
  description?: string;
  role: 'owner' | 'member';
  active?: boolean;
}

/** A member of a team, as returned by `listTeamMembers`. */
export interface TeamMember {
  email: string;
  name?: string;
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface Invitation {
  email: string;
  teamName: string;
  role: 'owner' | 'member';
  isNewUser: boolean;
  expiresAt: string;
}

/** A pending invitation as returned by `listInvitations`. */
export interface PendingInvitation {
  email: string;
  role: 'owner' | 'member';
  isNewUser: boolean;
  createdAt?: string;
  expiresAt?: string;
  expired?: boolean;
}

export interface ApiError {
  status: number;
  message: string;
  /** Seconds to wait before trying again, from a 429's Retry-After when the browser can read it. */
  retryAfter?: number;
}

// ── Payments — subscriptions ────────────────────────────────────────────────

/** A Stripe Price attached to a plan for one billing interval. */
export interface PlanPrice {
  price_id: string;
  /** In the currency's minor unit (cents for EUR/USD) — pass to {@link formatPrice}, not straight to the page. */
  amount: number | null;
  currency: string | null;
}

/**
 * A plan from the service's own catalog, as `GET /stripe/plans` returns it —
 * `name`/`description`/`prices` come from Stripe (`Product`/`Price`), everything
 * else from the service's own `stripeConfig.subscriptions.plans`.
 */
export interface Plan {
  id: string;
  name: string;
  description?: string;
  seats?: {
    mode: 'capped' | 'per_seat' | 'unlimited';
    /** Seat cap for `capped`, or an optional ceiling for `per_seat`. Absent means no cap. */
    max?: number;
  };
  /** Arbitrary limits the deployment declared on the plan (e.g. `max-projects`), opaque to the kit. */
  limits?: Record<string, number | boolean | string>;
  /** Keyed by interval — `'month'` and/or `'year'`, whichever the plan configures a price for. */
  prices?: Record<string, PlanPrice>;
}

/**
 * The caller's team's subscription, as `GET /stripe/subscription` returns it —
 * the same computation the `@subscription` ACL variable resolves server-side,
 * so this is never stale relative to what a Guards rule just allowed or denied.
 *
 * `plan` is `''` for a team with no subscription at all, not `null` — the
 * server always includes the field.
 */
export interface Subscription {
  plan: string;
  active: boolean;
  /** Whether the *caller* (not just the team) holds a seat licence. */
  licensed: boolean;
  cancel_at_period_end: boolean;
  status?: string;
  trial_end?: { $date: number };
  current_period_end?: { $date: number };
  seats: {
    /** `null` means unlimited. */
    limit: number | null;
    licensed: number;
    /** `null` means unlimited. */
    available: number | null;
    over_limit: boolean;
    over_limit_since?: { $date: number };
    over_limit_days?: number;
  };
}

/** The caller's team's seat licences, as `GET /stripe/licenses` returns them. */
export interface Licenses {
  /** User ids (emails) currently holding a seat. */
  licensed: string[];
  seats: {
    limit: number | null;
    licensed: number;
    available: number | null;
  };
}

/** What `grantLicense` actually did — the `200` vs `201` distinction `apiFetch` alone would discard. */
export type GrantLicenseResult = 'granted' | 'already-licensed';

// ── Payments — products & orders ────────────────────────────────────────────

/**
 * A product from the service's catalog collection, as `getCatalog` returns
 * it — a raw document read, not a dedicated endpoint, so the field names are
 * exactly what `CatalogReader` validates on disk (`snake_case`), not the
 * `camelCase` the upstream `CatalogItem` Java record happens to use for the
 * same fields once parsed.
 */
export interface CatalogItem {
  _id: string;
  type: 'physical' | 'digital';
  name: string;
  description?: string;
  image_url?: string;
  /** In the currency's minor unit (cents for EUR/USD) — pass to {@link formatPrice}, not straight to the page. */
  unit_amount: number;
  currency?: string;
  purchasable: boolean;
  tax_code?: string;
  /** Present when the item has its own Stripe Price instead of using the service's default currency/pricing. */
  stripe_price_id?: string;
}

/** A line item as it was priced at checkout — not the live catalog price. */
export interface OrderLineItem {
  product_id: string;
  type: 'physical' | 'digital';
  name: string;
  unit_amount: number;
  quantity: number;
  subtotal: number;
  tax_code?: string;
}

export type OrderStatus = 'pending_payment' | 'paid' | 'failed' | 'expired';

/**
 * An order, as `GET /orders/{id}` returns it. `status` starts at
 * `'pending_payment'` and is moved forward by Stripe's webhook — never by the
 * client's own redirect back from Checkout. See {@link waitForOrder}.
 */
export interface Order {
  _id: { $oid: string };
  stripe_session_id: string;
  stripe_payment_intent?: string | null;
  /**
   * Generated for every order, guest or authenticated — it is what lets a
   * guest, who has no session, look their own order back up. Whether a `GET`
   * echoes it back to an authenticated buyer depends on the deployment's own
   * ACL projection; the kit does not assume either way. Treat it like a
   * password: pass it in the URL to read the order, never log it or display
   * it beyond the guest checkout flow.
   */
  secret?: string;
  checkout_url: string;
  buyer_id?: string | null;
  buyer_email?: string | null;
  payer: {
    type: 'team' | 'guest';
    id?: { $oid: string } | null;
    stripe_customer_id?: string | null;
  };
  status: OrderStatus;
  requires_shipping?: boolean;
  line_items: OrderLineItem[];
  currency: string;
  amount_subtotal: number;
  amount_tax?: number;
  amount_shipping?: number;
  amount_total: number;
  amount_refunded: number;
  shipping_address?: {
    /** The recipient. Stripe collects it with the address, and a parcel needs somebody to hand it to. */
    name?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  } | null;
  created_at: { $date: number };
  paid_at?: { $date: number } | null;
  expires_at: { $date: number };
}

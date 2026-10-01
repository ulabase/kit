# @ulabase/kit

Adds signup, login and payments to your frontend — zero dependencies, works with Angular, React, Vue, or vanilla JS.

Covers every [`restheart-accounts`](https://restheart.org/docs/accounts) flow: signup, login, email verification, password reset — plus team management for apps that need it: invitations, member roles, multi-team switching.

For apps that sell something, it also covers [`restheart-stripe`](#payments): subscription plans, Stripe Checkout and Customer Portal, seat licences, and a product/order flow with guest checkout. No Stripe.js, no publishable key — the whole flow is hosted pages, so the kit hands you a URL and you navigate to it.

Pairs with [Ulabase](https://ulabase.com), which gives you a production-ready backend — MongoDB, REST API, authentication, signup/signin, all managed.

## Installation

```bash
npm install @ulabase/kit
```

> **v0.3.0+ requires RESTHeart 9.6.0 or later.** Bearer-mode `activate()`, `resetPassword()`, and `switchTeam()` rely on the `delivery=body` query parameter, introduced in RESTHeart 9.6.0. Against an older server the request still succeeds, but the kit won't be able to capture the bearer token from the response (the extra param is silently ignored) — you'll need to log in again to get a token. Cookie mode is unaffected.

## Usage

```typescript
import { checkSession, login, logout } from '@ulabase/kit';

const config = { apiBaseUrl: 'https://api.example.com' };

const user = await checkSession(config);  // UserInfo | null
await login(config, 'user@example.com', 'secret');
await logout(config);
```

If the users collection has a JSON Schema with additional fields, pass them in the register payload:

```typescript
import { register } from '@ulabase/kit';

await register(config, {
  email: 'user@example.com',
  password: 'secret',
  teamName: 'acme',
  latestConsents: { tos: '2026-07-01', pp: '2026-07-01' },
  consents: [{ tos: '2026-07-01', pp: '2026-07-01' }]
});
```

> **Note:** When no JSON Schema is configured on the users collection the server silently drops any extra properties — the request still succeeds with `201`.

See [Consents](#consents) for the whole pattern, including the users who cannot accept at sign-up.

Authentication is handled via a Bearer token stored in `localStorage` — every authenticated request sends `Authorization: Bearer <token>`. This is the default (`mode: 'bearer'`) and works cross-origin.

Cookie authentication (`mode: 'cookie'`) is also supported, but **only for same-origin setups**: the backend manages an HttpOnly JWT cookie and no token ever touches `localStorage` or JavaScript.

Because a Ulabase service lives on `*.ulabase.app` while your app lives on your own domain, that cookie is *third-party* on every request your page makes — blocked by default in Safari and Firefox, and left to the user in Chrome. A permissive CORS configuration does not change this: the browser drops the cookie before CORS is even consulted. **Use bearer mode unless the app is served from the same origin as the service.**

If you are building on Next.js or Nuxt, note that this is a different cookie from the one those frameworks use — theirs is a first-party cookie set by your own server, holding the same bearer token, and it needs no cookie support from RESTHeart at all. See [docs/ADAPTERS.md](../../docs/ADAPTERS.md#2-token-delivery--the-cookie-story).

The token is stored in `localStorage` and expires within 15 minutes. Sessions survive page reloads but don't persist across browser sessions if the token has expired.

Token refresh is fully transparent: the kit schedules a proactive renewal at 80% of the token's TTL (~12 minutes). As long as the tab stays open, the session stays alive without the app or user noticing.

### Bearer vs cookie — same functions, one `mode` parameter

`login`, `activate`, and `resetPassword` accept a `mode: 'bearer' | 'cookie'` parameter (default `'bearer'`), and `switchTeam` does too. Under the hood, this sets the `delivery` query parameter the backend understands (`body` for bearer, `cookie` for cookie mode) on every auto-login endpoint — `POST /token` / `POST /token/cookie`, `PATCH /auth/activate`, `PATCH /auth/reset-password`, `POST /auth/switch-team`. In bearer mode, the fresh token always comes back in the same response (no extra round-trip); in cookie mode, the backend sets the cookie and the response body carries no token.

Pick one mode per app — mixing modes for the same user session isn't supported.

### Email verification flow

After signup, the user receives a verification email. The `verify()` function returns a URL that the app must navigate to:

```typescript
// Fragment delivery (default) — cross-origin SPAs
const url = await verify(config, email, token);
window.location.href = url; // backend 302 redirects to frontend-app-url#access_token=...
```

The backend verifies the token, promotes the user, and redirects to your `frontend-app-url` with the JWT as a URL fragment. Your app reads the token from `window.location.hash` and calls `setToken()` to store it.

For same-origin setups where cookies work, pass `'cookie'`:

```typescript
// Cookie delivery — same-origin setups
const url = await verify(config, email, token, 'cookie');
window.location.href = url; // backend sets JWT cookie and redirects
```

Errors are thrown as `{ status: number; message: string }`.

## API

### Auth

| Function | Description |
|---|---|
| `checkSession(config)` | Returns `UserInfo` if a valid token is held in memory, `null` otherwise |
| `register(config, payload)` | Sign up — creates user and team. Accepts additional properties for app-specific JSON Schema fields (e.g. consents) |
| `verify(config, email, token, delivery?)` | Verify email after signup — returns a URL for browser redirect (`delivery`: `'fragment'` (default) or `'cookie'`) |
| `login(config, email, password, mode?)` | Email/password login (`mode`: `'bearer'` (default) or `'cookie'`) |
| `logout(config)` | Clears the token and cancels pending refresh |
| `getUserInfo(config)` | Read the stored user document (`GET /users/me`) without the session bookkeeping of `checkSession` |
| `updateUser(config, email, updates)` | Update a user document via `PATCH /users/{email}` — ACL-scoped, distinct from `updateProfile` |
| `acceptConsents(config, userId, body?, mode?)` | Record the acceptance, renew the token, return the updated user |
| `apiFetch(config, path, init?)` | A `fetch` against the service with the session applied — for the app's own collections. Rejects with an `ApiError` on any non-2xx |

### Token management

| Function | Description |
|---|---|
| `setToken(token)` | Store a token manually (e.g. after OAuth redirect) |
| `getToken()` | Read the current token, or `null` |
| `clearToken()` | Clear the token and cancel any pending refresh |
| `renewToken(config, mode?)` | Force a new token, rebuilt from the user document as it is now |
| `scheduleRefresh(config)` | Schedule proactive token renewal (called automatically by `login`) |
| `cancelRefresh()` | Cancel a pending refresh timer |

### Invitations

| Function | Description |
|---|---|
| `invite(config, email, role)` | Invite a user to the current team |
| `getInvitation(config, email, token)` | Invitation metadata (org name, role, isNewUser) |
| `activate(config, payload, mode?)` | Activate account for a newly invited user (`mode`: `'bearer'` (default) or `'cookie'`) |
| `acceptInvite(config, token)` | Accept invitation for an already registered user |
| `resendInvite(config, email)` | Resend an expired invitation |

### Password

| Function | Description |
|---|---|
| `forgotPassword(config, email)` | Request a reset link (always returns 202) |
| `resetPassword(config, payload, mode?)` | Apply the reset token (`mode`: `'bearer'` (default) or `'cookie'`) |

### Multi-team

| Function | Description |
|---|---|
| `getTeams(config)` | List teams the authenticated user belongs to |
| `switchTeam(config, teamId, mode?)` | Switch active team (`mode`: `'bearer'` (default) or `'cookie'`) — in bearer mode, the stored token is replaced with the freshly issued one carrying the new team claim |

### Subscriptions

Requires the [`stripe` plugin](#payments) on the service. See [Payments](#payments) for the three things that are easy to get wrong.

| Function | Description |
|---|---|
| `getPlans(config)` | The service's plan catalog — no session required, safe from a public pricing page |
| `getSubscription(config)` | The caller's team's subscription. Any member may call it, not just the billing owner |
| `createCheckoutSession(config, plan, interval)` | Start Checkout, returns `{url}` to navigate to. **Rejects `409`** when already subscribed — send those to the Portal instead |
| `openBillingPortal(config)` | Start a Customer Portal session, returns `{url}`. **Rejects `402`** for a team that never checked out |
| `getLicenses(config)` | The team's seat licences |
| `grantLicense(config, userId)` | Grant a seat — resolves `'granted'` (201) or `'already-licensed'` (200), rejects `409` when no seat is free |
| `revokeLicense(config, userId)` | Revoke a seat |
| `waitForSubscription(config, predicate, opts?)` | Poll until `predicate` holds — for the Checkout return page. See [the webhook race](#the-redirect-beats-the-webhook) |

### Products and orders

| Function | Description |
|---|---|
| `getCatalog(config, opts?)` | Read the catalog collection (`opts.collection` defaults to `'catalog'`, `pagesize`, `page`) |
| `createOrder(config, items, email?, collection?)` | Create an order and start Checkout — returns `{_id, checkout_url, secret}`. Pass `email` for guest checkout |
| `getOrder(config, id, secret?, collection?)` | Read an order back. `secret` is the guest path — no session needed |
| `waitForOrder(config, id, secret?, opts?)` | Poll until the order leaves `'pending_payment'` — for the order return page |
| `readOrderRef(url?)` | Read `{id, secret}` out of the Checkout return URL — see [below](#knowing-which-order-came-back) |
| `clearOrderRef()` | Strip them from the address bar once read |

### Money

| Function | Description |
|---|---|
| `formatPrice(amountMinorUnits, currency, locale?)` | Format a Stripe amount. **Not** `amount / 100` — JPY has 0 decimals, BHD has 3 |

## Consents

Blocking users who have not accepted the current terms is a server-side rule — a [Guards](https://ulabase.com/docs/guards#_example_gating_on_consents) condition that refuses every request from a user whose document does not carry the current versions, plus an ACL permission that exempts the one request recording the acceptance. What the client contributes is small, and easy to get wrong in exactly one way.

**At sign-up**, when your form shows the terms, send them with the credentials. The user is then never in the blocked state:

```typescript
await register(config, {
  email, password, teamName,
  latestConsents: { tos: TOS_VERSION, pp: PP_VERSION },
  consents: [{ tos: TOS_VERSION, pp: PP_VERSION }]
});
```

This works only when a JSON Schema is configured on the users collection — otherwise the server drops the extra properties and the user is registered without them.

**Afterwards** — someone who signed in with OAuth, where there was no form of yours to tick, or anyone who already had an account when the terms changed:

```typescript
const user = await acceptConsents(config, session.user._id);
```

That one call does three things: `PATCH /users/{_id}`, which the permission's `mergeRequest` turns into the versions and the timestamp *the server* chose; a token renewal; and a re-read of the user document, returned to you.

**The renewal is the part that is easy to miss.** The guard reads the token, and the token the user is holding was issued before they accepted. Write the acceptance without renewing and the rule keeps blocking them until that token expires — with the acceptance sitting in the database the whole time. `renewToken(config)` is exported separately for the same reason: whenever something the token carries changes underneath it.

**Reading the state.** `checkSession` and `getUserInfo` return the stored document, not the token's claims, so the extra fields are there whether or not you expose them as JWT claims:

```typescript
type AppUser = { latestConsents?: { tos: string; pp: string } };

const user = await checkSession<AppUser>(config);
const mustAccept = user !== null && user.latestConsents?.tos !== TOS_VERSION;
```

The guard, on the other hand, reads the claims — so the fields it tests must be in the service's JWT claim list.

## Payments

Requires the `stripe` plugin on the service. A service without it answers `404` on every
`/stripe/*` path, so the adapters only touch them when you opt in:

```typescript
const config = { apiBaseUrl: 'https://my-service.ulabase.app', payments: true };
```

The whole flow is hosted pages — Checkout and the Customer Portal both hand back a URL:

```typescript
import { createCheckoutSession, openBillingPortal } from '@ulabase/kit';

const { url } = await createCheckoutSession(config, 'gold', 'month');
window.location.href = url;
```

Three things are easy to get wrong. All three are the reason this layer exists.

### The redirect beats the webhook

After Checkout, Stripe sends the buyer back to your success URL over the browser, and reports
the payment over a *separate* server-to-server webhook. There is no ordering guarantee between
the two. A page that reads `getSubscription()` the moment it mounts will often show the **old**
plan — so the user who just paid is told they haven't.

Poll instead, with an explicit exit condition:

```typescript
import { waitForSubscription, WaitTimeoutError } from '@ulabase/kit';

try {
  const sub = await waitForSubscription(config, s => s.plan === 'gold' && s.active);
  showConfirmation(sub);
} catch (err) {
  if (err instanceof WaitTimeoutError) {
    // NOT a failed payment — Stripe already has the money, the webhook is just late.
    showPleaseCheckBackShortly();
  } else {
    throw err;
  }
}
```

The first check runs immediately, before any wait, so the common case (webhook already landed)
stays instant. `WaitTimeoutError` is deliberately a different type from `ApiError`, so
"you are not subscribed" and "you are, we just haven't heard yet" never collapse into the same
error screen. `waitForOrder(config, id, secret)` is the products counterpart, same shape.

### Knowing which order came back

The return page has a second problem, one step before the webhook race: it does not know
*which* order it is showing. Stripe substitutes only `{CHECKOUT_SESSION_ID}` in the success
URL, and a guest has no session for the server to recognise them by.

RESTHeart's `stripe` plugin closes that gap. Put the placeholders in the configured success
URL and it interpolates them when it creates the Checkout session:

```
# stripe.conf
/stripeConfig/products/success-url ->
  "https://shop.example.com/order#order={ORDER_ID}&secret={ORDER_SECRET}"
```

Then, on the return page:

```typescript
import { readOrderRef, clearOrderRef, waitForOrder } from '@ulabase/kit';

const ref = readOrderRef();          // reads window.location
if (ref) {
  clearOrderRef();                   // out of the address bar, immediately
  const order = await waitForOrder(config, ref.id, ref.secret);
}
```

**Put `{ORDER_SECRET}` in the fragment (`#`), not the query string.** The secret is a bearer
credential — it is the only thing standing between a stranger and a guest's order, email and
shipping address included. A fragment is never sent to the server, so it stays out of access
logs, proxy logs and `Referer` headers. `readOrderRef` reads the fragment first for that
reason, but accepts either.

Both the placeholders and this pair of functions are optional. `readOrderRef` returns `null`
on a service that has not configured them, which is the normal answer on a deployment that
predates them — keep whatever fallback you had (stashing the reference in `localStorage`
before redirecting is the usual one, and it is what the ecommerce starter still does as a
backstop).

### The token is never renewed

Unlike `acceptConsents`, nothing in the payments path renews the token — and it must not.
The `@subscription` ACL variable is resolved server-side from the database on every request,
so an upgrade is effective **immediately, without a re-login**. Adding a `renewToken()` after a
plan change buys nothing and costs a round trip on every purchase.

### Not everyone may manage billing

`createCheckoutSession`, `openBillingPortal` and the licence functions all answer `403` to a
plain member. `getSubscription` does not — any member can see their team's plan.

The server compares against the deployment's *configured* ownership role, not the literal
string `"owner"`. If yours overrides it, tell the kit, or the adapters' `canManageBilling` will
show the billing button to people who get a `403` and hide it from the people entitled to it:

```typescript
const config = { apiBaseUrl: '…', payments: true, ownershipRole: 'admin' };
```

### Amounts are in the currency's minor unit

`amount / 100` is wrong for JPY (0 decimals) and BHD (3). `Intl.NumberFormat` already knows
each currency's digits, so `formatPrice` delegates to it:

```typescript
import { formatPrice } from '@ulabase/kit';

formatPrice(1990, 'eur', 'en-IE');   // "€19.90"
formatPrice(500, 'jpy', 'ja-JP');    // "¥500"
formatPrice(19900, 'bhd', 'en-BH');  // "BHD 19.900"
```

Pass a `locale` explicitly on the server, where there is no browser locale to inherit.

## Types

```typescript
interface AuthConfig {
  apiBaseUrl: string;
  /** Opt in to payments. Without it, no /stripe/* call is ever made. */
  payments?: boolean;
  /** The role that may manage billing. Defaults to 'owner'. */
  ownershipRole?: string;
}

type UserInfo<E extends object = Record<never, never>> = {
  _id: string;
  roles: string[];
  team?: { _id: { $oid: string }; role: string };
  profile?: { name?: string; surname?: string; avatarUrl?: string };
} & E

interface TeamMembership {
  id: { $oid: string };
  name?: string;
  role: 'owner' | 'member';
  active?: boolean;
}

interface Invitation {
  email: string;
  teamName: string;
  role: 'owner' | 'member';
  isNewUser: boolean;
  expiresAt: string;
}

interface Subscription {
  plan: string;              // '' when the team has no subscription at all
  active: boolean;
  licensed: boolean;         // whether the *caller* holds a seat
  cancel_at_period_end: boolean;
  seats: {
    limit: number | null;    // null means unlimited
    licensed: number;
    available: number | null;
    over_limit: boolean;
  };
}

type OrderStatus = 'pending_payment' | 'paid' | 'failed' | 'expired';
```

`Plan`, `PlanPrice`, `Licenses`, `GrantLicenseResult`, `CatalogItem`, `Order`, `OrderLineItem`
and `WaitOptions` are exported too.

## Framework adapters

- **Angular** → [`@ulabase/kit-ng`](https://www.npmjs.com/package/@ulabase/kit-ng) — signals, guards, interceptor
- **React** → [`@ulabase/kit-react`](https://www.npmjs.com/package/@ulabase/kit-react) — context, hooks, guards, plus a `/next` subpath
- **Vue** → [`@ulabase/kit-vue`](https://www.npmjs.com/package/@ulabase/kit-vue) — composables, navigation guards, plus a `/nuxt` subpath

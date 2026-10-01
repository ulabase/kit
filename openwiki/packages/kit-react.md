---
type: Package
title: "@ulabase/kit-react"
description: React adapter for Ulabase Kit. Provides context, hooks, and route guards for authentication, payments, and cart, plus a /next subpath for Next.js SSR support.
tags: [package, react, adapter, hooks, nextjs, payments, cart]
sources:
  - id: openwiki-source-54f8315d21086325777bcf77
    resource: repo://packages/kit-react/package.json
  - id: openwiki-source-627a62714caeaf0818b017ca
    resource: repo://packages/kit-react/src/cart.tsx
  - id: openwiki-source-0edf9c48025b350dd4dc49de
    resource: repo://packages/kit-react/src/context.tsx
  - id: openwiki-source-1ffd6dbbbd5dbf3d4a0fd215
    resource: repo://packages/kit-react/src/guards.tsx
  - id: openwiki-source-e8909520a0f757ab53473101
    resource: repo://packages/kit-react/src/index.ts
  - id: openwiki-source-bc22523d3c783f09f2affd17
    resource: repo://packages/kit-react/src/next/actions.ts
  - id: openwiki-source-ab0e16d9c69fdb6b401a994c
    resource: repo://packages/kit-react/src/next/cookies.ts
  - id: openwiki-source-44195c1f7c6fbcc439227a7a
    resource: repo://packages/kit-react/src/next/index.ts
  - id: openwiki-source-5321394b8ed758b691213eb5
    resource: repo://packages/kit-react/src/next/middleware.ts
  - id: openwiki-source-95a5e3152fdcea16ca8b4feb
    resource: repo://packages/kit-react/src/next/route.ts
  - id: openwiki-source-ead1481a6bb944d947c0c7dc
    resource: repo://packages/kit-react/src/next/session.ts
  - id: openwiki-source-b3642fbb09acb4042ba72b5a
    resource: repo://packages/kit-react/src/next/sync.tsx
  - id: openwiki-source-cb4e00ba25df046ed879c14f
    resource: repo://packages/kit-react/src/payments.tsx
generated: { by: "openwiki/0.6.1", at: "2026-10-01T10:51:10.399Z" }
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T10:51:10.399Z
---

# @ulabase/kit-react

React adapter for `@ulabase/kit`. Wraps core authentication, payments, and cart logic in React context with hooks and route guards. A `/next` subpath adds Next.js SSR support.

## Installation

```bash
npm install @ulabase/kit-react
```

The core `@ulabase/kit` is a regular dependency — pulled in automatically.

`react-router-dom` (for guards) and `next` (for `/next` subpath) are **optional peer dependencies**.

## Quick Start

### 1. Wrap App with Provider

```tsx
import { RhAuthProvider } from '@ulabase/kit-react';

createRoot(document.getElementById('root')!).render(
  <RhAuthProvider config={{ apiBaseUrl: import.meta.env.VITE_API_URL }}>
    <App />
  </RhAuthProvider>
);
```

On mount the provider runs `checkSession()` once, restoring the session before the first guard evaluates. Until it settles, `initializing` is `true`.

### 2. Use `useAuth` Hook

```tsx
import { useAuth } from '@ulabase/kit-react';

function Header() {
  const auth = useAuth();
  if (!auth.isAuthenticated) return null;
  return (
    <>
      <span>{auth.user?.profile?.name}</span>
      {auth.hasMultipleTeams && <TeamSwitcher teams={auth.teams} />}
    </>
  );
}
```

### 3. Protect Routes

```tsx
import { AuthGuard, PublicGuard } from '@ulabase/kit-react';

<Route path="/dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
<Route path="/login" element={<PublicGuard><Login /></PublicGuard>} />
```

## Hooks and Components

| Export | Type | Description |
|--------|------|-------------|
| `useAuth()` | Hook | Access all auth state and methods (see below) |
| `RhAuthProvider` | Component | Context provider, runs `checkSession` on mount |
| `usePayments()` | Hook | Access payments state and methods (see below) |
| `RhPaymentsProvider` | Component | Payments context provider, loads subscription on auth |
| `useCart()` | Hook | Access cart state and methods (see below) |
| `RhCartProvider` | Component | Cart context provider, persists to `localStorage` |
| `AuthGuard` | Component | Redirects unauthenticated users to `/auth/login` |
| `PublicGuard` | Component | Redirects authenticated users into the app |

## Auth Methods

All methods are available on the `useAuth()` return value. These wrap `@ulabase/kit` functions and update reactive state (`user`, `teams`) where applicable:

```ts
const auth = useAuth();

// Session
await auth.checkSession();              // → UserInfo | null
auth.clearSession();                    // clear token, cancel refresh, reset state

// Registration & verification
await auth.register({ email, password, teamName, firstName, lastName });
await auth.verify(email, token, delivery?);  // delivery: 'cookie' | 'fragment'

// Login / logout
await auth.login(email, password, mode?);   // mode: 'bearer' (default) | 'cookie'
await auth.logout();

// Password
await auth.forgotPassword(email);
await auth.resetPassword({ email, token, password }, mode?);
await auth.changePassword(currentPassword, newPassword);

// Profile
await auth.updateProfile({ firstName?, lastName? });
await auth.updateUser(email, updates);     // update any user field

// Consents & token renewal
await auth.acceptConsents(body?, mode?);   // record consent acceptance, renew token
await auth.renewToken(mode?);              // force a new token

// Teams
await auth.loadTeams();                 // → TeamMembership[]
await auth.switchTeam({ $oid }, mode?);
await auth.createTeam(teamName);        // → TeamMembership
await auth.updateTeam({ name?, description? });
await auth.deleteTeam();
await auth.listTeamMembers();           // → TeamMember[]
await auth.removeMember(email);
await auth.updateMemberRole(email, role);

// Invitations
await auth.invite(email, role);         // role: 'owner' | 'member'
await auth.getInvitation(email, token); // → Invitation
await auth.activate({ email, token, password }, mode?);
await auth.acceptInvite(token);
await auth.resendInvite(email);
await auth.listInvitations();           // → PendingInvitation[]
```

#### Authenticated Fetch

```typescript
// Authenticated GET — bearer token attached automatically
auth.api(path: string, init?: RequestInit): Promise<Response>
```

`auth.api()` is the React counterpart of Angular's `rhAuthInterceptor`. React has no interceptor slot, so an app querying its own RESTHeart collections would otherwise attach the bearer token by hand at every call site.

```tsx
const res = await auth.api('/my-collection?pagesize=10');
const docs = await res.json();

// POST
const res = await auth.api('/my-collection', {
  method: 'POST',
  body: JSON.stringify({ name: 'hello' }),
});
```

Rejects with an `ApiError` (`{ status, message }`) on any non-2xx response. See [Core Kit — Authenticated Fetch](kit.md#authenticated-fetch-apifetch) for the underlying behavior.

**When to use**: Use `auth.api()` for any RESTHeart API call from React components that is not already covered by a dedicated method (e.g., querying custom collections).

Methods that perform auto-login (`login`, `activate`, `resetPassword`, `switchTeam`) accept an optional `mode` parameter (`'bearer'` | `'cookie'`) that maps to the backend's `delivery` query parameter.

## Payments

The `RhPaymentsProvider` and `usePayments()` hook provide a complete payments surface for Stripe-based subscriptions, licenses, and orders.

### Setup

```tsx
import { RhAuthProvider, RhPaymentsProvider } from '@ulabase/kit-react';

<RhAuthProvider config={config}>
  <RhPaymentsProvider config={config}>
    <App />
  </RhPaymentsProvider>
</RhAuthProvider>
```

**Important**: `RhPaymentsProvider` must be placed inside `RhAuthProvider` — it reads the current user from `useAuth()` to derive `canManageBilling`.

### Reactive State

```tsx
const payments = usePayments();

payments.subscription;      // Subscription | null
payments.plan;              // string | null (plan id from subscription)
payments.isSubscribed;      // boolean (has active subscription)
payments.canManageBilling;  // boolean (user.team.role === ownershipRole)
payments.seatsAvailable;    // number | null (available seats)
```

### Methods

```tsx
// Subscription management
await payments.loadSubscription();                          // reload subscription
await payments.getPlans();                                  // get plan catalog
await payments.createCheckoutSession(plan, interval);       // start Stripe Checkout
await payments.openBillingPortal();                         // open Stripe Customer Portal

// Seat licenses
await payments.getLicenses();                               // get team's licenses
await payments.grantLicense(userId);                        // grant seat (returns 'granted' | 'already-licensed')
await payments.revokeLicense(userId);                       // revoke seat

// Catalog & orders
await payments.getCatalog(opts?);                           // read product catalog
await payments.createOrder(items, email?, collection?);     // create order & start Checkout
await payments.getOrder(id, secret?, collection?);          // read order

// Polling helpers (for success pages)
await payments.waitForSubscription(predicate, opts?);       // poll until subscription matches
await payments.waitForOrder(id, secret?, opts?);            // poll until order leaves 'pending_payment'
```

### Automatic Behavior

- **On sign-in/team switch**: loads the subscription automatically
- **On sign-out**: clears subscription state
- **`waitForSubscription`** and **`waitForOrder`** poll until the predicate is satisfied or timeout (useful for Checkout success pages where the redirect races the webhook)

## Cart

The `RhCartProvider` and `useCart()` hook provide a client-side shopping cart that persists to `localStorage`.

### Setup

```tsx
import { RhCartProvider } from '@ulabase/kit-react';

<RhCartProvider>
  <App />
</RhCartProvider>
```

**Important**: `RhCartProvider` is independent of `RhAuthProvider` — a cart belongs to the browser, not to a session. A shop that requires sign-in before adding items loses most users there. The cart becomes an order when `orderItems` is handed to `createOrder`.

### State

```tsx
const cart = useCart();

cart.lines;         // CartLine[] (in order added)
cart.totalItems;    // number (units, not lines)
cart.subtotal;      // number (minor units, meaningful when all lines share currency)
cart.currency;      // string (first line's currency, or 'eur' when empty)
cart.orderItems;    // OrderItem[] (ready for createOrder)
```

### Methods

```tsx
cart.add(item, quantity?);                 // add item or increase existing line
cart.setQuantity(productId, quantity);     // set line quantity (0 removes)
cart.remove(productId);                    // remove line
cart.clear();                              // empty cart
```

### Persistence

Cart state is persisted to `localStorage` under the key `'rh-cart'` by default. Use the `storageKey` prop to change this when two apps share an origin:

```tsx
<RhCartProvider storageKey="my-app-cart">
  <App />
</RhCartProvider>
```

State and storage move together in one place: every operation writes the array it just produced rather than reacting to a change afterwards, which prevents a reload from resurrecting a removed line.

## Next.js Subpath (`/next`)

```ts
import {
  // Middleware
  rhAuthMiddleware,              // Next.js middleware: refresh at 80% TTL, protected/public redirects
  type RhMiddlewareOptions,

  // Route handler
  createSessionRoute,            // POST/DELETE session cookie management
  type SessionRouteOptions,

  // Server actions
  rhLogin,                       // server-side login (sets cookie)
  rhSwitchTeam,                  // server-side team switch
  rhActivate,                    // activate invitation account
  rhResetPassword,               // reset password with token
  rhLogout,                      // server-side logout (clears cookie)

  // Fragment→cookie bridge (client component)
  SessionSync,                   // React component: reads #access_token, POSTs to session route
  syncServerSession,             // programmatic: POST token to session endpoint
  clearServerSession,            // programmatic: DELETE session endpoint
  DEFAULT_SESSION_ENDPOINT,      // '/api/rh/session'

  // Session reading (server)
  getServerSession,              // read session from request cookie → UserInfo | null
  getServerSessionWithTeams,     // read session + load teams

  // Cookie utilities
  RH_SESSION_COOKIE,
  DEFAULT_COOKIE_OPTIONS,
  rhServerConfig,
  cookieMaxAge,
  resolveCookieOptions,
  type SessionCookieOptions,
  type ServerActionOptions,
} from '@ulabase/kit-react/next';
```

The `/next` subpath provides:
- **Middleware** (`rhAuthMiddleware`): token refresh at 80% TTL, protected/public path redirects
- **Route handler** (`createSessionRoute`): session cookie management (POST writes cookie, DELETE clears)
- **Server actions** (`rhLogin`, `rhSwitchTeam`, `rhActivate`, `rhResetPassword`, `rhLogout`): server-side auth operations that set or clear the session cookie
- **Fragment→cookie bridge** (`SessionSync` client component): reads `#access_token` from URL and POSTs to the session route so the server can set a first-party cookie
- **Session readers** (`getServerSession`, `getServerSessionWithTeams`): read the current user from the request cookie in server components or middleware
- **Cookie utilities**: `RH_SESSION_COOKIE`, `DEFAULT_COOKIE_OPTIONS`, `rhServerConfig`, `cookieMaxAge`, `resolveCookieOptions`

Uses the core's [pluggable token source and sink](../architecture/overview.md#pluggable-token-source-and-sink) to read tokens from request cookies and capture tokens for cookie writes — no `localStorage` on the server.

### Source Map

| Source file | Responsibility |
|-------------|---------------|
| `src/context.tsx` | `RhAuthProvider`, `useAuth`, full `RhAuth` interface |
| `src/guards.tsx` | `AuthGuard`, `PublicGuard` components |
| `src/payments.tsx` | `RhPaymentsProvider`, `usePayments`, full `RhPayments` interface |
| `src/cart.tsx` | `RhCartProvider`, `useCart`, full `RhCart` interface |
| `src/index.ts` | SPA barrel export |
| `src/next/middleware.ts` | `rhAuthMiddleware` |
| `src/next/route.ts` | `createSessionRoute` |
| `src/next/actions.ts` | `rhLogin`, `rhSwitchTeam`, `rhActivate`, `rhResetPassword`, `rhLogout` |
| `src/next/session.ts` | `getServerSession`, `getServerSessionWithTeams` |
| `src/next/sync.tsx` | `SessionSync`, `syncServerSession`, `clearServerSession` |
| `src/next/cookies.ts` | Cookie constants and resolution |
| `src/next/index.ts` | `/next` subpath barrel export |

## See Also

- [Core Kit](kit.md) — API reference for `@ulabase/kit`
- [Payments](../concepts/payments.md) — Payments subsystem overview
- [Adapter Contract](../testing/guide.md#adapter-unit-tests) — Shared test checklist
- [Token Delivery](../architecture/token-delivery.md) — Bearer vs cookie modes

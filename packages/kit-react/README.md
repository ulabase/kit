# @ulabase/kit-react

Wraps [`@ulabase/kit`](https://www.npmjs.com/package/@ulabase/kit) in a React context with hooks and route guards — `useAuth()` for authentication, [`usePayments()`](#usepayments) for subscriptions and orders. A [`/next`](#nextjs-subpath) subpath adds server-side rendering support for Next.js.

Pairs with [Ulabase](https://ulabase.com), which gives you a production-ready backend — MongoDB, REST API, authentication, signup/signin, all managed.

## Installation

```bash
npm install @ulabase/kit-react
```

The core `@ulabase/kit` is a regular dependency, so it is pulled in automatically — you don't install it separately.

`react-router-dom` (for the guards) and `next` (for the `/next` subpath) are **optional peer dependencies** — install them only if you use those parts.

## Setup

Wrap your app once, near the root:

```tsx
import { RhAuthProvider } from '@ulabase/kit-react';

createRoot(document.getElementById('root')!).render(
  <RhAuthProvider config={{ apiBaseUrl: import.meta.env.VITE_API_URL }}>
    <App />
  </RhAuthProvider>
);
```

On mount the provider runs `checkSession()` once, so a page reload restores the session before the first guard evaluates. Until it settles, `initializing` is `true`.

## How sessions work

Same two modes as the core kit:

- **Bearer token** (default) — stored in `localStorage`, sent as `Authorization: Bearer <token>`.
- **Cookie** — JWT managed by the backend as an HttpOnly cookie, **same-origin only**.

Pass `mode: 'cookie'` to `login()`, `activate()`, `resetPassword()`, or `switchTeam()` only when the app is served from the same origin as the service. A Ulabase service lives on `*.ulabase.app` while your app lives on your own domain, so that cookie is third-party and blocked by default in Safari and Firefox. **Cross-origin apps, the normal case, should stay on the default `'bearer'` mode.**

`login()` stores the token and schedules a proactive refresh at 80% of its TTL. Every authenticated request sends the Bearer token automatically. If the token expires, the next API call gets a 401 and the session is cleared.

## `useAuth`

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

### State

| Field | Type | Description |
|---|---|---|
| `user` | `UserInfo \| null` | Authenticated user, or `null` (`user._id` is the email) |
| `teams` | `TeamMembership[]` | Teams the user belongs to |
| `isAuthenticated` | `boolean` | Derived from `user` |
| `hasMultipleTeams` | `boolean` | `true` when the user has more than one team |
| `initializing` | `boolean` | `true` until the initial session check settles |

### Methods

All methods return Promises and update the shared state:

```ts
auth.checkSession()               // Promise<UserInfo | null> — no HTTP if no token
auth.login(email, password, mode?)    // 'bearer' (default) | 'cookie' — also loads teams
auth.logout()
auth.register(payload)
auth.verify(email, token, delivery?)  // 'fragment' (default) | 'cookie'
auth.forgotPassword(email)
auth.resetPassword(payload, mode?)
auth.updateProfile(updates)           // re-checks session
auth.changePassword(current, next)
auth.invite(email, role)
auth.getInvitation(email, token)
auth.activate(payload, mode?)
auth.acceptInvite(token)              // loads teams
auth.resendInvite(email)
auth.listInvitations()
auth.loadTeams()
auth.switchTeam(teamId, mode?)        // re-checks session
auth.listTeamMembers()
auth.removeMember(email)
auth.updateMemberRole(email, role)
auth.createTeam(teamName)
auth.updateTeam(updates)
auth.deleteTeam()
auth.clearSession()
auth.api(path, init?)                 // Promise<Response> — your own collections, session applied
```

### Your own collections

Everything above talks to `/auth/*`, `/token` and `/users/me`. For your application's own
data, use `auth.api` — it applies the session on the way out, so you never attach the bearer
token by hand:

```tsx
const auth = useAuth();

useEffect(() => {
  auth.api('/my-collection?pagesize=10')
    .then(res => res.json())
    .then(setDocs)
    .catch((err: ApiError) => setError(err.message));
}, [auth.api]);
```

Pass a path, not a URL. Any non-2xx rejects with an `ApiError` (`{ status, message }`), so a
`451` from a Guards rule or a `403` from an ACL is something you branch on rather than parse.

## Guards

Guard components for `react-router-dom`:

```tsx
import { AuthGuard, PublicGuard } from '@ulabase/kit-react';

<Routes>
  <Route path="/app" element={<AuthGuard><Shell /></AuthGuard>} />
  <Route path="/auth/login" element={<PublicGuard><Login /></PublicGuard>} />
  {/* /invitations/accept stays unguarded — it must work signed out, signed in, or with no account */}
</Routes>
```

`AuthGuard` redirects to `/auth/login` when unauthenticated; `PublicGuard` redirects to `/` when already authenticated. While the initial session check runs, both render their `fallback` prop (default `null`) instead of redirecting, so a reload doesn't flash the wrong screen.

## `usePayments`

Payments have their own provider and hook, because a subscription is not a session. They need
the `stripe` plugin on the service, and an explicit opt-in — without `payments: true` no
`/stripe/*` call is ever made:

```tsx
const config = {
  apiBaseUrl: 'https://my-service.ulabase.app',
  payments: true,
  ownershipRole: 'owner',   // default; set it if your deployment overrides the role
};

<RhAuthProvider config={config}>
  <RhPaymentsProvider config={config}>
    <App />
  </RhPaymentsProvider>
</RhAuthProvider>
```

`RhPaymentsProvider` goes *inside* `RhAuthProvider` — it reads the user from it to derive
`canManageBilling`. The subscription loads on sign-in and reloads on `switchTeam`:

```tsx
function Billing() {
  const payments = usePayments();

  async function upgrade() {
    try {
      const { url } = await payments.createCheckoutSession('gold', 'month');
      window.location.href = url;
    } catch (err) {
      // 409 means "already subscribed" — Stripe's Portal handles plan changes
      if (err.status === 409) {
        const { url } = await payments.openBillingPortal();
        window.location.href = url;
      }
    }
  }

  if (!payments.subscription) return <p>No subscription</p>;
  return (
    <>
      <p>Plan: <strong>{payments.plan}</strong></p>
      {payments.canManageBilling && <button onClick={upgrade}>Change plan</button>}
    </>
  );
}
```

**State:** `subscription`, `plan`, `isSubscribed`, `canManageBilling`, `seatsAvailable`.

**Methods:** `loadSubscription`, `getPlans`, `createCheckoutSession`, `openBillingPortal`,
`getLicenses`, `grantLicense`, `revokeLicense`, `getCatalog`, `createOrder`, `getOrder`,
`waitForSubscription`, `waitForOrder`.

### The Checkout return page

The redirect back from Stripe races the webhook, so reading `subscription` as the page mounts
can still show the old plan. Poll instead — and treat a timeout as "not yet", not as a failed
payment:

```tsx
useEffect(() => {
  payments.waitForSubscription(s => s.plan === 'gold' && s.active)
    .then(() => setStatus('success'))
    .catch(err => setStatus(err.name === 'WaitTimeoutError' ? 'pending' : 'error'));
}, []);
```

`waitForSubscription` updates the provider's `subscription` itself when it resolves. See the
[core's payments guide](https://www.npmjs.com/package/@ulabase/kit#payments) for the
full reasoning.

## Next.js subpath

For Next.js App Router apps, `@ulabase/kit-react/next` adds the server pieces the SPA adapter can't cover — see [docs/ADAPTERS.md](../../docs/ADAPTERS.md) for the full rationale.

> **Payments are client-side only.** The `/next` subpath has no payments counterpart yet:
> there is no `getServerSubscription` to gate a server component or middleware on the
> subscription before render. Read it from `usePayments()` in a client component.

```ts
// middleware.ts — proactive refresh + guards before render
import { rhAuthMiddleware } from '@ulabase/kit-react/next';
export const middleware = rhAuthMiddleware(config, {
  isProtected: (p) => p.startsWith('/app'),
  isPublicOnly: (p) => p.startsWith('/auth'),
});
export const config = { matcher: ['/((?!_next|.*\\..*).*)'] };
```

```ts
// app/api/rh/session/route.ts — writes/clears the first-party session cookie
import { createSessionRoute } from '@ulabase/kit-react/next';
export const { POST, DELETE } = createSessionRoute();
```

```tsx
// A Server Component reads the session with no client waterfall
import { getServerSession } from '@ulabase/kit-react/next';
const user = await getServerSession(config);
```

```tsx
// The redirect landing page bridges the #access_token fragment into the cookie
'use client';
import { SessionSync } from '@ulabase/kit-react/next';
<SessionSync onSynced={() => router.replace('/app')} />
```

| Export | Purpose |
|---|---|
| `rhAuthMiddleware(config, opts)` | Refresh the cookie past 80% TTL; guards as redirects |
| `getServerSession(config)` / `getServerSessionWithTeams` | Read the session in a Server Component |
| `rhServerConfig(config)` | An `AuthConfig` whose token source is the request cookie |
| `createSessionRoute(opts)` | `POST`/`DELETE` handlers that set/clear the cookie |
| `rhLogin` / `rhSwitchTeam` / `rhActivate` / `rhResetPassword` / `rhLogout` | Server actions: run the core call and rewrite the session cookie server-side |
| `SessionSync` | Client component: fragment → cookie bridge |
| `syncServerSession(token)` / `clearServerSession()` | Sync/clear the cookie after client-side `login`/`switchTeam`/`logout` |

Server actions keep the token out of the browser entirely — the credentials never leave the server:

```ts
// app/actions.ts
'use server';
import { rhLogin, rhSwitchTeam } from '@ulabase/kit-react/next';
import { revalidatePath } from 'next/cache';

export async function login(formData: FormData) {
  await rhLogin(config, String(formData.get('email')), String(formData.get('password')));
  revalidatePath('/');
}

export async function switchTeam(teamId: { $oid: string }) {
  await rhSwitchTeam(config, teamId);
  revalidatePath('/');
}
```

> The cookie is a first-party container for the same JWT a SPA keeps in `localStorage` — not a security upgrade (a 15-minute token with no refresh token means XSS can still call the API). The gains are architectural: server components render authenticated data with no waterfall, and guards run in middleware so there's no unauthenticated flash.

## Quickstart

1. Create a service on [Ulabase](https://ulabase.com)
2. Set `apiBaseUrl` to your service URL
3. Wrap your app in `<RhAuthProvider>` and use `useAuth()`

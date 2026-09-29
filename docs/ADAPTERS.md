# Framework adapters and token delivery

How the kit is layered across frameworks, and how the access token reaches the API in
each of them. Read this before starting a new adapter or a new starter app.

**Status:** `kit`, `kit-ng`, `kit-react` (+ `/next`) and `kit-vue` (+ `/nuxt`) are implemented
and unit-tested against the [adapter contract](./ADAPTER_CONTRACT.md). The starters and the
roadmap ordering in §5 are still the plan.

---

## 1. Layering

```
@ulabase/kit          pure TypeScript, no framework, Promise API
        │
        ├── @ulabase/kit-ng          Angular   — signals, guards, interceptor
        ├── @ulabase/kit-react       React     — hooks, context, guard component
        │       └── /next  subpath           Next.js   — middleware, route handlers
        └── @ulabase/kit-vue         Vue       — composables, navigation guards
                └── /nuxt  subpath           Nuxt      — server middleware, route rules
```

The core holds every network call, every token operation and all the business rules.
An adapter is a **reactive wrapper**: shared state, the framework's routing guards, and its
HTTP integration. An adapter that reimplements an API call or a token computation is a bug.

### Why a subpath and not a separate `kit-next` package

A developer working in Next.js identifies as a Next.js developer, not as a React developer
who happens to use Next. Finding only `kit-react` reads as "probably works, not supported",
and the usual reaction is to write a private wrapper instead.

The subpath answers that without a fourth package to version and release:

```ts
import { useAuth }        from '@ulabase/kit-react';
import { rhAuthMiddleware } from '@ulabase/kit-react/next';
```

One version, one changelog, one release. Code importing `next/headers` and `next/server`
lives behind the subpath, so a React app on Vite never resolves it; `next` is an **optional
peer dependency**. The same arrangement applies to `kit-vue` and `/nuxt` — whatever is
decided for Next must be decided identically for Nuxt, or the product line stops being
explainable.

Discovery is handled where it actually happens — npm keywords, the README, and a dedicated
starter repository — not by the package name. Nobody searches npm for `kit-next`; they
search for "restheart next.js auth" and land on a starter.

---

## 2. Token delivery — the cookie story

This is the part that most often gets designed wrong, in both directions.

### 2.1 The cookie RESTHeart cannot set

Ulabase can set an `HttpOnly` JWT cookie — `POST /token/cookie`, and
`delivery=cookie` on the verification redirect. Both are usable **only when the app and the
service share an origin.**

```
myservice.restheart.com ──Set-Cookie──▶ browser     cookie domain: .restheart.com
app.cliente.com         ── the page it must authenticate
```

Different registrable domains, so on every request from that page the cookie is
**third-party**: blocked by default in Safari and Firefox, left to the user in Chrome. Since
a Ulabase service always lives on `*.restheart.com` while the app lives on the
customer's own domain, **cookie mode is not available to normal deployments** and the kit
defaults to bearer everywhere.

### 2.2 The cookie an SSR framework does want

It is a different cookie, on a different domain, set by a different server:

```
app.cliente.com (Next server) ──Set-Cookie: rh_session=eyJhbG…──▶ browser
                                            cookie domain: app.cliente.com
```

Same domain as the page, so it is **first-party** and no browser ever blocks it. The app is
exchanging a cookie with itself.

Its contents are the same JWT that a SPA keeps in `localStorage`. It is not a "RESTHeart
authentication cookie" — it is a different container for the token you already have.
**RESTHeart requires no cookie support for any of this**, and is not aware the cookie exists.

The server then calls the API exactly as a browser SPA does today:

```
SPA (Angular, React+Vite, Vue+Vite)
  browser ──localStorage──▶ Bearer ──▶ myservice.restheart.com     cross-origin, CORS

SSR / BFF (Next.js, Nuxt)
  browser ──cookie──▶ app server ──Bearer──▶ myservice.restheart.com
          first-party            server-to-server, no CORS, no browser
```

### 2.3 Why cover it at all

The server-side rendering pass of an App Router application is **not optional**. Declining
to support it does not remove it — it forces every component to be a client component,
which is a Next.js app wearing a SPA costume. That is a legitimate product choice, but it
should be chosen deliberately, not arrived at by accident.

Note also that the adapter keeps RESTHeart at the centre rather than displacing it. The
developer will write a route handler regardless, because the framework asks for one; an
adapter whose server code does nothing but bridge to RESTHeart is what keeps `/app/api/`
from growing a data layer of its own.

### 2.4 What it is not

Do not sell the cookie as a security upgrade. With a 15-minute token and no refresh token,
an XSS can call the API straight from the page and `HttpOnly` does not stop it. The real
gains are architectural: server components render authenticated data with no waterfall,
guards run in middleware so there is no unauthenticated flash, and the API URL can stay a
server-only environment variable.

---

## 3. What the core kit needs

Two symmetric changes, and every SSR adapter is unblocked. **Both are implemented.**

**Pluggable token source.** `apiFetch` (and `checkSession`) read the token through
`getToken()`, which is wired to `localStorage`. On a server there is no `localStorage` — the
token is in the request cookie. `AuthConfig` accepts an optional source, defaulting to the
current behaviour.

**Pluggable token sink, and token-returning auto-login.** The mirror image: `login` and the
auto-login endpoints (`activate`, `resetPassword`, `switchTeam`) *store* the fresh token via
the localStorage `setToken` plus a `setTimeout` refresh. On a server that write leaks into a
shared module global and the timer refreshes nothing. So those functions now **return** the
fresh bearer token, and `AuthConfig` accepts an optional `setToken` sink. When the sink is
set, the localStorage store and the refresh timer are both bypassed — a server action passes
a sink that merely captures the token, then writes it into a response cookie.

```ts
export interface AuthConfig {
  apiBaseUrl: string;
  /** Where the bearer token comes from. Defaults to the localStorage store. */
  getToken?: () => string | null | Promise<string | null>;
  /** Where a freshly obtained token is persisted. Defaults to localStorage + refresh timer. */
  setToken?: (token: string) => void;
}

// login / activate / resetPassword / switchTeam now resolve to the fresh token
// (or null in cookie mode), so a server action can rewrite the session cookie.
```

Worth reviewing at the same time: `apiFetch` sends `credentials: 'include'`, which achieves
nothing cross-origin without cookies and tightens the CORS preflight.

---

## 4. Adapter contract

Every adapter exposes the same surface, so one starter specification serves all of them.

**Reactive state** — one shared source, app-wide: `user` (`UserInfo | null`; `user._id`
*is* the email), `teams` (`TeamMembership[]`), `isAuthenticated`, `hasMultipleTeams`.

**Methods** — thin wrappers over the core, each updating that state: `checkSession`,
`register`, `verify`, `login`, `logout`, `forgotPassword`, `resetPassword`, `updateProfile`,
`changePassword`, `updateUser`, `api`, `acceptConsents`, `renewToken`, `invite`, `getInvitation`,
`activate`, `acceptInvite`, `resendInvite`,
`listInvitations`, `loadTeams`, `switchTeam`, `listTeamMembers`, `removeMember`,
`updateMemberRole`, `createTeam`, `updateTeam`, `deleteTeam`, `clearSession`.

**Two behaviours that are easy to miss:** `checkSession()` also loads teams (short-circuiting
to `null` with no HTTP call when there is no stored token), and `login()` also loads teams in
the same round trip. Get these wrong and team-dependent UI is intermittently empty.

**Payments are a separate surface.** A subscription is not a session, so it does not live on
the auth store: `RhPaymentsService` (Angular), `usePayments()` under `RhPaymentsProvider`
(React), `usePayments()` under `createRhPayments(config, rhAuth)` (Vue). Each owns `subscription`, `plan`,
`isSubscribed`, `canManageBilling`, `seatsAvailable` and the methods that go with them, and
reads the user from the auth surface only to derive `canManageBilling`.

Three rules the adapters must share, all three easy to get wrong:

- **Opt-in.** Nothing touches `/stripe/*` unless `config.payments === true`. A service without
  the plugin answers `404` on those paths, so a payments-unaware app would log one on every
  startup.
- **Reload on the team, not on the user.** The subscription belongs to the team, so it loads on
  sign-in and reloads on `switchTeam`. It must *not* reload on `updateProfile` or
  `acceptConsents` — both re-run `checkSession` and hand back a freshly parsed user document,
  so an adapter that keys its effect on the user object's identity re-reads the subscription on
  every profile edit. Key it on the team id (`ADAPTER_CONTRACT.md`, E10).
- **`canManageBilling` is configurable.** It compares the user's team role against
  `config.ownershipRole` (default `'owner'`), because the server compares against the
  deployment's configured ownership role, not the literal string.

**Extensible user document.** `UserInfo` and `register()` accept a generic type parameter for
application-specific fields declared in the users collection JSON Schema (e.g. `consents`).
When no schema is configured the server silently drops extra properties — the request still
succeeds with `201`. Adapters expose the same extensibility via an index signature on the
register payload.

**User document updates.** `updateUser(config, email, updates)` targets `PATCH /users/{email}`,
where the application's ACL permission decides what fields are writable. This is distinct from
`updateProfile` (which goes through `/auth/profile` and is limited to `firstName` / `lastName`).

**The application's own requests.** Everything above talks to `/auth/*`, `/token` and
`/users/me`. An application also reads its own collections, and those requests need the same
session applied — the bearer token, the challenge suppression, the cookie credentials.
Getting it wrong is quiet: the service answers `401`, which reads as "logged out" rather than
"you forgot the header".

Adapters expose this in whatever shape the framework already has. Angular has an interceptor
slot, so `rhAuthInterceptor` applies the session to every `HttpClient` request bound for
`apiBaseUrl` — and to no other host, because the token is a credential and must not leak to
third parties. React and Vue have no such slot, so both expose `api(path, init?)` on the
store, a thin binding of the core's `apiFetch(config, path, init)`. An adapter for a
framework with interceptors should prefer the interceptor; one without should expose `api`.

**The transport runs the other way too.** The core speaks `fetch`, so by default *its* calls
bypass the host framework's HTTP stack — and every cross-cutting concern wired into it. An
adapter closes that by passing `AuthConfig.transport`, a `fetch`-shaped callback the core
sends everything through. `kit-ng` supplies one backed by `HttpClient` (`httpClientTransport`),
so a login or a session check goes through the interceptor chain like any other request.

An implementation owes the core two things `fetch` guarantees and framework clients often do
not: **resolve** on a non-2xx rather than rejecting, since the core reads the status itself;
and reject only when no response existed at all. It must also mark its requests so
`rhAuthInterceptor` skips its 401 handling (`RH_KIT_REQUEST`) — the kit owns the meaning of a
401 on its own endpoints, where it can mean "wrong current password" rather than "session
over".

**Consents.** `acceptConsents(body?, mode?)` is the adapter form of the acceptance: it takes the
user id from the reactive state, sends the whitelisted `PATCH`, renews the token, and writes the
returned document back into `user`. The renewal is not an optimisation — a Guards rule reads the
token, and the token predates the acceptance, so skipping it leaves the user blocked with their
consent already recorded. Adapters that add their own acceptance flow must keep that order:
write, renew, then refresh the state.

**Guards** — `authGuard` (no user → `/auth/login`) and `publicGuard` (user → into the app).
`/invitations/accept` stays unguarded: it must work for signed-out invitees, signed-in
users, and people without an account.

**Token lifecycle** — attach the bearer, clear the session on 401, and keep the proactive
refresh at 80% of the 15-minute TTL.

### 4.1 Extra requirements for the SSR subpaths

These have no equivalent in the SPA adapters and are the bulk of the work.

| Requirement | Why |
|---|---|
| **Refresh in middleware** | Cookies cannot be written while a server component renders — only in middleware, route handlers and server actions. The browser `setTimeout` refresh has nothing to refresh, since it holds no token. Middleware decodes `exp`, calls `/token?renew` past 80%, rewrites `Set-Cookie`. |
| **Fragment → cookie bridge** | Verification and OAuth redirect back with `#access_token=…`, and fragments are never sent to the server. A small client component reads `location.hash` and POSTs to a route handler that writes the cookie. One extra round trip. |
| **Guards as middleware** | Redirect before render, so no flash of unauthenticated content. |
| **Auto-login via server action** | `switchTeam`, `activate` and `resetPassword` return a fresh token with `delivery=body`; a server action runs the core call with a capturing `setToken` sink, rewrites the cookie from the returned token, then revalidates. Exposed as `rhSwitchTeam` / `rhActivate` / `rhResetPassword` (plus `rhLogin` / `rhLogout`) on the subpath. |

A rejected alternative for the fragment bridge: a `delivery=query` mode landing directly on
a route handler. It is cleaner but needs a backend change, and query parameters leak into
access logs and `Referer` headers — which is precisely why the fragment is used.

---

## 5. Roadmap

Adoption is heavily skewed — React alone outweighs Angular and Vue combined, roughly 3× in
npm downloads — and meta-frameworks are growing faster than the frameworks under them. So
these are not symmetric tasks:

1. `kit-react` + `ulabase/starter-react` (Vite + React Router) — proves the core
   ports cleanly, at parity with the Angular original.
2. Pluggable token source in the core.
3. `kit-react/next` + `ulabase/starter-next` — separate starter, because
   middleware guards and server components are structurally different, not a variant.
4. `kit-vue` + starter, then `/nuxt` on the same pattern.

Svelte does not justify an adapter until the above are done.

**Payments on the SSR subpaths.** Section E of the adapter contract is reactive client state,
which `*/next` and `*/nuxt` do not have — so it does not port to them as written. What does
apply is a server-side read: a `getServerSubscription` alongside `getServerSession`, so a
server component or a middleware can gate a route on the subscription *before* render, the
same way `rhAuthMiddleware` gates on the session today. Not implemented; the SPA adapters
carry payments on their own for now.

### Keeping the starters from drifting

Each starter is a full feature-parity application, so every fix has to be replayed across
all of them. [`PORTING.md`](https://github.com/ulabase/starter-ng/blob/main/PORTING.md)
and `TEMPLATE_API.md` in the Angular starter are the specification that makes a port
possible; they do not stop divergence. Either the ports are declared reference
implementations pinned to a kit version, or the ongoing maintenance is budgeted for.

---

## 6. What the CLI is not

`@ulabase/cli` sits in this monorepo and depends on the core, so it looks like a
fourth adapter in the tree listing. It is not one, and the difference is worth stating once so
nobody re-litigates it in six months.

**It has no section-E contract, and cannot have one.** Section E is reactive client state:
a user to track, a session to restore, a signal to update. Configuration has none of those. There
is no `RhConfigService` alongside `RhAuthService` and `RhPaymentsService`, because a parity that
does not exist should not be suggested by the shape of the API.

**It does not run in a browser.** The admin node's `originVetoer` whitelists
`cloud.restheart.com` and allows a *missing* `Origin` header:

```yaml
# etc/prod-admin.yml
/originVetoer:
  enabled: true
  whitelist: [https://cloud.restheart.com, cloud.restheart.com]
  allow-missing-origin: true
```

A page served from a developer's own origin sends `Origin` and is vetoed. Node, curl, anything
that is not a browser, passes. A browser-facing configuration surface is therefore not a thing
that can be built, whatever API is put in front of it.

That constraint happens to agree with the security reading. The credential the adapters handle is
a **tenant** token, scoped to one service. The credential the CLI handles is the **RESTHeart
Cloud account**, which governs every service on it and its billing. Those do not belong in the
same layer, and one of them does not belong in a deployed page at all.

The layering, then:

```
@ulabase/kit             the core — login, apiFetch, the error type
        │
        ├── kit-ng / kit-react / kit-vue     browser, tenant token, reactive state
        └── @ulabase/cli            Node, SaaS account, no state at all
```

`@ulabase/cli` reuses `login` and `apiFetch` for the admin node — supplying its own
`getToken`/`setToken`, because `AuthConfig`'s default store is `localStorage` and Node has none.
It does *not* use `apiFetch` for the service node: `apiFetch` validates that the base URL is a
`*.restheart.com` service, which is a real guard on a browser-facing kit, and a service node's URL
is server-issued rather than caller-chosen (`http://…​.cloud.local:8081` in a local integration
environment). See [`packages/cli/README.md`](../packages/cli/README.md).

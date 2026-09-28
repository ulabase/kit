# Adapter test contract

The five adapter surfaces — `kit-ng`, `kit-react`, `kit-react/next`, `kit-vue`, `kit-vue/nuxt`
— expose the **same** behaviour over the core. That is exactly what lets one starter spec
serve all of them, and exactly what silently drifts. This file is the checklist each
adapter's unit tests must implement, so drift shows up as a red test instead of a support
ticket.

## Testing principle

The core (`@ulabase/kit`) is integration-tested against a live Ulabase
instance — it owns the network and the business rules. **Adapter tests must not re-test that.**
They mock the core and assert only the *wiring*: which core call fires, and how the reactive
state (signals / context / refs) and the framework glue (guards, middleware, cookies) react.

- Fast, deterministic, **no backend and no secrets** → runs on every push.
- Mock `@ulabase/kit` wholesale; drive return values per case.

`kit-react` is the reference implementation of this file (`packages/kit-react/src/**/*.test.*`).

## A. Reactive contract — every SPA adapter

| # | Scenario | Expected |
|---|---|---|
| A1 | bootstrap, no token | `user=null`, `isAuthenticated=false`, **no HTTP call** (`checkSession`/`getTeams` never invoked) |
| A2 | bootstrap, valid token | loads `user` **and** `teams` |
| A3 | `login` | sets `user` **and** loads `teams` in the same flow |
| A4 | `logout` | clears `user` and `teams` |
| A5 | `switchTeam` | re-runs `checkSession` (fresh team claim) |
| A6 | `updateProfile` | re-runs `checkSession` |
| A7 | `acceptInvite` | reloads `teams` |
| A8 | `clearSession` | wipes state, calls `clearToken` + `cancelRefresh` |
| A9 | `hasMultipleTeams` | `true` iff `teams.length > 1` |

## B. Guards — every SPA adapter

| # | Scenario | Expected |
|---|---|---|
| B1 | `authGuard`, unauthenticated | redirect to `/auth/login` |
| B2 | `authGuard`, authenticated | allow |
| B3 | `publicGuard`, authenticated | redirect into the app |
| B4 | `publicGuard`, unauthenticated | allow |
| B5 | `/invitations/accept` | reachable under **neither** guard (checked at the starter level) |

## C. Token lifecycle

| # | Scenario | Expected |
|---|---|---|
| C1 | a 401 from an app request | session cleared (ng interceptor; other adapters as applicable) |

## D. SSR extras — `*/next` and `*/nuxt` only

| # | Scenario | Expected |
|---|---|---|
| D1 | middleware, token past 80% TTL | calls `/token?renew`, rewrites `Set-Cookie` |
| D2 | middleware, fresh token | no renew, cookie untouched |
| D3 | middleware, protected path, no session | redirect to login (before render) |
| D4 | middleware, public-only path, has session | redirect into the app |
| D5 | session route `POST { accessToken }` | writes the first-party cookie (maxAge from `exp`) |
| D6 | session route `POST` missing token | `400` |
| D7 | session route `DELETE` | clears the cookie |
| D8 | `rhLogin` / `rhSwitchTeam` / `rhActivate` / `rhResetPassword` | token captured via the `setToken` sink is written to the cookie |
| D9 | `rhLogout` | clears the cookie |
| D10 | fragment bridge | reads `#access_token`, POSTs it, strips the hash |

## E. Payments — every SPA adapter

| # | Scenario | Expected |
|---|---|---|
| E1 | bootstrap without `payments` in config | no call to `/stripe/*`; `subscription=null`, `plan=null`, `isSubscribed=false`, `seatsAvailable=null` |
| E2 | bootstrap with `payments`, session valid | loads `subscription` after user and teams |
| E3 | `login` with `payments` | loads `subscription` in the same flow |
| E4 | `switchTeam` | reloads `subscription` (the subscription belongs to the team) |
| E5 | `logout` | clears `subscription` along with user and teams |
| E6 | `clearSession` | clears `subscription` along with user and teams |
| E7 | `canManageBilling` | `true` iff `user.team.role` equals the configured `ownershipRole` (default `'owner'`); a case with a custom `ownershipRole` must be covered |
| E8 | `checkout` returning `409` | the error reaches the caller with `status: 409`, state does not change |
| E9 | `waitForSubscription` resolves | updates `subscription` with the new value |
| E10 | `updateProfile` / `acceptConsents` | **no** reload — both re-run `checkSession` and hand back a fresh user document, but the team has not changed. Key the reload on the team id, not on the user object's identity, or every profile edit re-reads the subscription |

## Rollout status

| Adapter | A | B | C | D | E |
|---|---|---|---|---|---|
| `kit-react` | ✅ | ✅ | n/a | — | ✅ |
| `kit-react/next` | — | — | — | D1–D9 ✅, D10 pending | not applicable — see below |
| `kit-vue` | ✅ | ✅ | n/a | — | ✅ |
| `kit-vue/nuxt` | — | — | — | D1–D9 ✅, D10 pending | not applicable — see below |
| `kit-ng` | ✅ | ✅ | C1 ✅ | n/a | ✅ |

### Payments and the SSR surfaces

Section E is reactive client state, which `*/next` and `*/nuxt` do not have — they are
session, cookie and middleware helpers that run before render. Nothing in E1–E10 has a
server-side counterpart, so those two rows are `not applicable` rather than `pending`.

What *would* apply there — a `getServerSubscription` alongside `getServerSession`, so a
server component or middleware can gate a route on the subscription before render — is not
implemented. It is a real gap, tracked in `specs/todo/payments.md`, not an oversight in this
table.

## CI

Adapter unit tests need no secrets, so they run on every push — separate from the
core's gated live integration tests:

```yaml
# unit tests job
- run: npm ci
- run: npm run build                    # adapters compile against kit/dist
- run: npm test --workspaces --if-present
```

(Scope the workspace test run to the adapters, or keep the core's `test` script gated behind
its `.env`, so this job never needs the live instance.)

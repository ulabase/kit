# @ulabase/kit-ng

Wraps [`@ulabase/kit`](https://www.npmjs.com/package/@ulabase/kit) in Angular services with signals, route guards, and an HTTP interceptor — authentication in `RhAuthService`, and [payments](#rhpaymentsservice) in `RhPaymentsService`.

Pairs with [Ulabase](https://cloud.restheart.com), which gives you a production-ready backend — MongoDB, REST API, authentication, signup/signin, all managed.

## Installation

```bash
npm install @ulabase/kit-ng @ulabase/kit
```

> **v0.3.0+ requires RESTHeart 9.6.0 or later.** Bearer-mode `activate()`, `resetPassword()`, and `switchTeam()` rely on the `delivery=body` query parameter, introduced in RESTHeart 9.6.0. Against an older server the request still succeeds, but the kit won't be able to capture the bearer token from the response — you'll need to log in again to get a token. Cookie mode is unaffected.

## Setup

In `app.config.ts`:

```typescript
import { provideRhAuth } from '@ulabase/kit-ng';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRhAuth({ apiBaseUrl: environment.apiUrl }),
  ],
};
```

That one call registers `RhAuthService`, adds the HTTP interceptor (attaches the Bearer token, clears session on 401), and sets up the DI config.

## How sessions work

The kit supports **two authentication modes**:

- **Bearer token** (default) — stored in `localStorage`, sent as `Authorization: Bearer <token>`
- **Cookie** — JWT managed by the backend as an HttpOnly cookie, **same-origin only**

Pass `mode: 'cookie'` to `login()`, `activate()`, `resetPassword()`, or `switchTeam()` only when the app is served from the same origin as the service. Since a Ulabase service lives on `*.restheart.com` while your app lives on your own domain, that cookie is third-party and is blocked by default in Safari and Firefox — regardless of the server's CORS configuration. **Cross-origin apps, which is the normal case, should stay on the default `'bearer'` mode.**

Each of these calls a matching auto-login endpoint with `delivery=body` (bearer) or `delivery=cookie`, and in bearer mode gets the fresh token back in the same response — no extra login round-trip.

For email verification, pass `delivery: 'fragment'` (default, cross-origin) or `delivery: 'cookie'` (same-origin) to `verify()`.

- `login()` stores the token in `localStorage` and schedules a proactive refresh at 80% of the token's TTL (~12 minutes for a 15-minute token).
- Every authenticated request sends `Authorization: Bearer <token>` automatically.
- Sessions survive page reloads as long as the token hasn't expired.
- If the token expires (laptop asleep, tab backgrounded too long, or the user hasn't interacted for 15+ minutes), the next API call gets a 401 and the session is cleared — the user sees "logged out," not a silent failure.

## `RhAuthService`

Inject it anywhere and use signals directly in templates:

```typescript
@Component({
  template: `
    @if (auth.isAuthenticated()) {
      <span>{{ auth.user()?.profile?.firstName }}</span>
      @if (auth.hasMultipleTeams()) {
        <team-switcher [teams]="auth.teams()" />
      }
    }
  `
})
export class AppComponent {
  auth = inject(RhAuthService);
}
```

### Signals

| Signal | Type | Description |
|---|---|---|
| `user` | `Signal<UserInfo \| null>` | Authenticated user, or `null` |
| `isAuthenticated` | `Signal<boolean>` | Derived from `user` |
| `teams` | `Signal<TeamMembership[]>` | Teams the user belongs to |
| `hasMultipleTeams` | `Signal<boolean>` | `true` when user has more than one team |

### Methods

All methods return `Observable`:

```typescript
auth.checkSession()                // Observable<UserInfo | null> — reads localStorage, no HTTP if no token
auth.login(email, password, mode?)     // Observable<UserInfo> — mode: 'bearer' (default) | 'cookie'
auth.logout()                      // Observable<void>
auth.register(payload)             // Observable<void>
auth.verify(email, token, delivery?)  // Observable<string> — delivery: 'fragment' (default) | 'cookie'
auth.invite(email, role)           // Observable<void>
auth.getInvitation(email, token)   // Observable<Invitation>
auth.activate(payload, mode?)        // Observable<void> — mode: 'bearer' (default) | 'cookie'
auth.acceptInvite(token)           // Observable<void>
auth.switchTeam(teamId, mode?)       // Observable<void> — mode: 'bearer' (default) | 'cookie'; re-fetches session
auth.forgotPassword(email)         // Observable<void>
auth.resetPassword(payload, mode?)   // Observable<void> — mode: 'bearer' (default) | 'cookie'
```

## Your own collections

`provideRhAuth()` registers `rhAuthInterceptor`, which applies the session to every
`HttpClient` request bound for `apiBaseUrl`: the bearer token, the challenge suppression that
keeps the browser's Basic Auth popup away on a `401`, and the cookie credentials. So your own
data requests need no header of their own:

```typescript
private readonly http = inject(HttpClient);

load() {
  return this.http.get(`${environment.apiUrl}/my-collection?pagesize=10`);
}
```

Requests to any other host pass through untouched — the token is a credential, and attaching
it everywhere would hand it to whatever third party the app happens to call. An
`Authorization` header you set yourself is left alone. The `401` handling applies to every
request either way, because that is about the session and not the target.

Adding your own interceptor alongside it takes a second `provideHttpClient` call, *after*
`provideRhAuth`; `withInterceptors` registers each function as a `multi` provider, so the two
add up rather than replacing one another. Do not name `rhAuthInterceptor` again there — it is
already registered, and repeating it just runs it twice.

### The kit's own calls go through `HttpClient` too

`provideRhAuth()` also hands the kit an `HttpClient`-backed transport, so a login, a session
check or a token renewal travels the same interceptor chain as everything else. Your tracing
header, retry policy or error handler covers all of it, not just the requests you wrote.

One asymmetry is deliberate: `rhAuthInterceptor` does **not** clear the session on a 401 to a
kit endpoint. A 401 there does not always mean the session is over —
`PATCH /auth/change-password` answers 401 for a wrong *current* password, `GET /token` for
wrong credentials — and signing a user out for mistyping their old password would be a poor
trade. The kit handles those itself; the interceptor's 401 handling is for your requests.

To route the kit somewhere else entirely, pass your own `transport` in the config: an explicit
one is left alone.

```typescript
provideRhAuth({ apiBaseUrl: environment.apiUrl, transport: myTransport }),
```

## Guards

```typescript
import { authGuard, publicGuard } from '@ulabase/kit-ng';

export const routes: Routes = [
  {
    path: 'app',
    canActivate: [authGuard],     // redirects to /auth/login if not authenticated
    loadComponent: () => import('./shell/shell.component'),
  },
  {
    path: 'auth/login',
    canActivate: [publicGuard],   // redirects to /app if already authenticated
    loadComponent: () => import('./pages/login/login.component'),
  },
];
```

`authGuard` checks the in-memory token first — no HTTP call if the user is already authenticated in the current session.

## `RhPaymentsService`

Payments live in their own service, because a subscription is not a session. It needs the
`stripe` plugin on the service, and an explicit opt-in — without `payments: true` no
`/stripe/*` call is ever made:

```typescript
provideRhAuth({
  apiBaseUrl: 'https://my-service.restheart.com',
  payments: true,
  ownershipRole: 'owner',   // default; set it if your deployment overrides the role
})
```

`subscription` loads on sign-in and reloads on `switchTeam` — nothing to wire up:

```typescript
@Component({
  template: `
    @if (payments.subscription(); as sub) {
      <p>Plan: <strong>{{ sub.plan }}</strong> — {{ sub.active ? 'active' : 'inactive' }}</p>
      @if (payments.canManageBilling()) {
        <button (click)="upgrade()">Change plan</button>
      }
    }
  `,
})
export class BillingComponent {
  payments = inject(RhPaymentsService);

  upgrade() {
    this.payments.createCheckoutSession('gold', 'month').subscribe({
      next: ({ url }) => (window.location.href = url),
      // 409 means "already subscribed" — Stripe's Portal handles plan changes
      error: (err) => err.status === 409 && this.openPortal(),
    });
  }

  openPortal() {
    this.payments.openBillingPortal().subscribe(({ url }) => (window.location.href = url));
  }
}
```

**Signals:** `subscription`, `plan`, `isSubscribed`, `canManageBilling`, `seatsAvailable`.

**Methods:** `loadSubscription`, `getPlans`, `createCheckoutSession`, `openBillingPortal`,
`getLicenses`, `grantLicense`, `revokeLicense`, `getCatalog`, `createOrder`, `getOrder`,
`waitForSubscription`, `waitForOrder` — each returning an `Observable`.

### The Checkout return page

The redirect back from Stripe races the webhook, so reading `subscription()` as the page
mounts can still show the old plan. Poll instead — and treat a timeout as "not yet", not as a
failed payment:

```typescript
this.payments.waitForSubscription(s => s.plan === 'gold' && s.active).subscribe({
  next: () => this.status.set('success'),
  error: (err) => this.status.set(err.name === 'WaitTimeoutError' ? 'pending' : 'error'),
});
```

`waitForSubscription` updates the `subscription` signal itself when it resolves. See the
[core's payments guide](https://www.npmjs.com/package/@ulabase/kit#payments) for the
full reasoning.

## Quickstart

The fastest path to a working app:

1. Create a service on [Ulabase](https://cloud.restheart.com)
2. Fork [`restheart-cloud-starter-ng`](https://github.com/SoftInstigate/restheart-cloud-starter-ng)
3. Set `apiBaseUrl` in `environment.ts`
4. `ng serve`

You get login, signup, email verification, invitations, password reset, and multi-team switching — all wired up.

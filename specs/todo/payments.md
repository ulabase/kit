# Extending the kit to payments

**Status:** Tasks 1–4 and 7 done; Task 5 done for the three SPA adapters; Task 6 done except the
live integration tests. See [Where this stands](#where-this-stands) at the bottom for what
remains and why.
**Repo:** `ulabase/kit` (core + 5 adapter surfaces).
**Depends on:** a service with the `stripe` plugin configured — see "Rollout blocker" at the bottom.

## Why

Today the kit only covers `restheart-accounts`: signup, login, email verification, invites, teams,
password, consents. An application that sells something falls out of the kit at the exact point
where the work gets delicate — hand-rolled `fetch`, hand-rolled token handling, and above all a
handful of payment-flow pitfalls that aren't obvious until you're already in production with
orders stuck.

`restheart-stripe` already exposes everything needed. What's missing is the layer that makes it
usable without reading the plugin's source.

## What the server exposes (verified against the code)

All paths are on the customer's service, the same ones `apiFetch` already talks to.

**Subscriptions** mode:

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /stripe/plans` | **none** on the service side | `StripePlansService` doesn't check authentication (only `isGet`) — whether an anonymous caller can reach it is decided by the deployment's ACL. Responds `{default_plan, plans:[{id,name,description?,seats,limits?,prices}]}` |
| `GET /stripe/subscription` | authenticated | does **not** require `canManageBilling`: any team member can see their team's plan |
| `POST /stripe/checkout` | authenticated + `canManageBilling` | body `{plan, interval}` with `interval` ∈ `month`\|`year` → `201 {url}`. `400` if the plan isn't purchasable for that interval, **`409` if there's already an active subscription** |
| `POST /stripe/portal` | authenticated + `canManageBilling` | → `{url}` |
| `GET/POST/DELETE /stripe/licenses` | authenticated + `canManageBilling` | `GET` → `{licensed:[userId], seats:{limit,licensed,available}}`; `POST`/`DELETE` body `{userId}`. `POST` responds `201` granted, `200` already licensed, `404` not a member, **`409` no seat available** |

**Products** mode:

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /orders` | authenticated, or anonymous with `email` in the body if the ACL allows it | body `{items:[{productId,quantity}], email?}` → `{_id, checkout_url, secret}` |
| `GET /orders/{id}?secret=…` | anonymous with the secret | the order document: `status` ∈ `pending_payment`\|`paid`\|`failed`\|`expired`, `line_items`, `amount_total`, `amount_refunded`, `currency` |
| `GET /{catalog-collection}` | per the ACL | a normal Mongo collection: `{_id, type, name, description, imageUrl, unitAmount, currency, purchasable, …}` |

## The three facts that must shape the API

**1. No token renewal after a plan change.** This is the opposite of consents, where
`acceptConsents` *must* call `renewToken` because the guard reads the JWT. Here the `@subscription`
ACL resolver (`SubscriptionVarResolver`) reads the state from the database on every request, with a
cache that lives only as long as the exchange. An upgrade is therefore effective **immediately and
without a re-login**. The kit must not touch the token anywhere in the payments path, and the docs
must say so — otherwise someone will copy the consents pattern "to be safe" and introduce a
needless renewal on every purchase.

**2. The return redirect arrives before the webhook.** After Checkout, Stripe sends the buyer back
to the `success-url`, but the state in Mongo only changes when the webhook arrives — a separate
connection from Stripe's servers, usually within a few seconds, **with no ordering guarantee
relative to the redirect**. A billing page that reads `GET /stripe/subscription` right as it lands
will therefore show the *old* plan, and the user who just paid sees a message saying they haven't.
The same applies to orders: `status` is still `pending_payment`.

This is the piece every integration gets wrong, and it alone justifies this layer's existence. It's
not a `sleep`: it needs a poll with an exit condition, a timeout, and a "not yet, try again" outcome
that's distinguishable from an error.

**3. Checkout, Portal and licenses are reserved to whoever manages billing.** They respond `403` to
a plain member; `GET /stripe/subscription` doesn't. The adapters already know `user.team.role`, so
the derived boolean costs nothing and avoids drawing a button that responds `403` — which, to the
user, is indistinguishable from a bug.

One detail to watch: `DefaultSubscriptionOwnerProvider.canManageBilling()` does **not** compare
against the literal string `"owner"`, but against the effective ownership role —
`accountsConfig.ownership-role`, default `owner`, overridable per tenant via
`override-accounts-ownership-role`. A client-side boolean that hardcodes `'owner'` is therefore
correct for the default configuration and **silently wrong** for anyone who changed it: it would
show the button to someone who gets `403`, and hide it from someone entitled to it. The value must
be made configurable in the kit, with `'owner'` as the default.

## Dominant constraint

**Zero dependencies in the core, and no Stripe.js.** The core is "pure TypeScript, zero
dependencies" (README) and the whole flow is hosted-page: you receive a `url` and go there. Pulling
in `@stripe/stripe-js` would add a dependency, a second integration model, and a publishable key to
configure, for zero gain over `window.location.href = url`.

**Parity across the five surfaces.** `docs/ADAPTER_CONTRACT.md` exists because drift between
adapters is silent. Whatever gets added here must be added to all five, or to none.

---

## Task 1 — core: subscriptions

**Files:** `packages/kit/src/payments.ts` (new), `packages/kit/src/types.ts`, `packages/kit/src/index.ts`

Types: `Plan`, `PlanPrice`, `Subscription`, `SeatsInfo`, `Licenses` — modeled on the actual
responses above, not invented. `Subscription.seats.limit` and `.available` are `number | null`
(`null` = unlimited, and the server actually sends `null`, not a sentinel value).

Functions: `getPlans`, `getSubscription`, `createCheckoutSession`, `openBillingPortal`,
`getLicenses`, `grantLicense`, `revokeLicense`.

Two details that must not get lost in the wrapping:

- `createCheckoutSession` must distinguish the `409` "you already have an active subscription"
  from other errors. `apiFetch` already rejects with `ApiError {status,message}`, so the case is
  already distinguishable — but it must be **documented in the function's jsdoc**, because it's
  the difference between "show an error message" and "send them to the Portal to upgrade".
- `grantLicense` has four outcomes across three statuses (`201`/`200`/`404`/`409`), and `apiFetch`
  only rejects the last two. Returning `'granted' | 'already-licensed'` instead of `void` makes the
  `200` readable without inspecting the network.

**Acceptance:** the types compile against the real responses; a `createCheckoutSession` on a team
that's already subscribed produces an `ApiError` with `status: 409`; `getPlans` works without a
session.

## Task 2 — core: products and orders

**Files:** `packages/kit/src/orders.ts` (new)

Types: `CatalogItem`, `Order`, `OrderStatus`, `OrderLineItem`.
Functions: `getCatalog(config, opts?)`, `createOrder(config, items, email?)`, `getOrder(config, id, secret?)`.

`getCatalog` is a plain collection read: the collection name is configurable on the service side
(default `catalog`), so it must be parameterized — not hardcoded — and the default must be
documented as "what the service uses if it hasn't been changed", not as a kit constant.

`getOrder` with a `secret` is the guest path: no session, the secret in the query string. With an
active session the secret isn't needed, but passing it does no harm — `apiFetch` still attaches the
token if there is one.

**Acceptance:** an order created as a guest can be read back with `_id` + `secret`, without a session.

## Task 3 — core: waiting for the webhook

**Files:** `packages/kit/src/payments.ts`, `packages/kit/src/orders.ts`

Two functions, same shape:

```ts
waitForSubscription(config, predicate, opts?): Promise<Subscription>
waitForOrder(config, id, secret?, opts?): Promise<Order>
```

- `opts`: `{ timeoutMs = 30_000, intervalMs = 1_000, signal? }`.
- Backoff: a fixed interval is fine, but the first attempt must fire **immediately**, not after the
  first interval — in most cases the webhook has already arrived by the time the user lands, and an
  artificial one-second delay on a wait that would otherwise be zero is the difference between
  "instant" and "slow".
- Timeout exit: **not** a generic `throw`. A timeout here means "the webhook hasn't arrived yet",
  which is a normal, temporary state, not a payment failure — the payment on Stripe went through
  regardless. Either return the last state read and leave the decision to the caller, or reject with
  a recognizable error (`status: 0` + a dedicated `message`, consistent with how `apiFetch` signals
  "never reached the service"). Pick one and document it: what must not happen is the user seeing
  "payment failed" because a poll timed out.
- `signal` to cancel when the component unmounts.

For orders the predicate is implicit (`status !== 'pending_payment'`); for subscriptions it isn't:
an upgrade from `free` to `pro` and a downgrade are both "the plan changed", but only the caller
knows which one it expects. `predicate: (s: Subscription) => boolean` covers both without guessing.

**Acceptance:** unit test with a fake transport — resolves on the first try if the condition is
already true (no waiting), resolves after N attempts, honors the timeout, cancels via `signal`.

## Task 4 — core: formatting amounts

**Files:** `packages/kit/src/money.ts` (new)

`formatPrice(amount, currency, locale?)`. Stripe amounts are in the currency's **smallest unit**:
`1990` is `€19.90`, but `500` in JPY is `¥500`, and in BHD (3 decimals) `19900` is `19.900`.
`Intl.NumberFormat` already knows each currency's decimal places and isn't a dependency — it's part
of the platform. A hand-rolled division by 100 in the component is the bug this function exists to
prevent, and it's the same one we just fixed server-side in `OrderEventHandler.formatAmount()`.

**Acceptance:** EUR/USD at 2 decimals, JPY at 0, BHD at 3; no dependency added.

## Task 5 — adapter: reactive state

**Files:** `packages/kit-ng/src/*`, `packages/kit-react/src/context.tsx`, `packages/kit-vue/src/store.ts`
(+ the two SSR surfaces)

State, parallel to `user`/`teams`:

| Field | Type | Derived from |
|---|---|---|
| `subscription` | `Subscription \| null` | `getSubscription` |
| `plan` | `string \| null` | `subscription.plan` |
| `isSubscribed` | `boolean` | `subscription.active` |
| `canManageBilling` | `boolean` | `user.team.role === ownershipRole` (default `'owner'`, configurable — see fact 3) |
| `seatsAvailable` | `number \| null` | `subscription.seats.available` |

Methods: the same as the core, plus `loadSubscription()`.

**When it reloads** is the part that matters and must be decided here, not left to the app:

- after `checkSession` and after `login` — only if the service has payments enabled (see below)
- after `switchTeam` — **mandatory**: the subscription belongs to the team, switching teams changes
  the plan; forgetting this leaves the previous team's plan on screen, which is worse than not
  showing it at all
- after `waitForSubscription` resolves
- **not** after `updateProfile` or `acceptConsents` — they're unrelated

**A service without payments.** A service without the `stripe` plugin responds `404` on
`/stripe/*` (that's how the per-tenant kill switch shows up). Loading the subscription on login in
an app that doesn't sell anything would produce a `404` on every startup, which ends up in
`onError` and in whoever's watching the logs. It needs an explicit opt-in in the config
(`payments?: boolean`, or the mere presence of a `payments` block) — absence is the default, and in
that case no call ever fires.

**Acceptance:** on an app without `payments` enabled, no request to `/stripe/*` across the whole
lifecycle; with `payments` enabled, `switchTeam` reloads the subscription.

## Task 6 — adapter contract and tests

**Files:** `docs/ADAPTER_CONTRACT.md`, unit tests of the four adapters

A new `E. Payments` section, following the pattern of the existing ones:

| # | Scenario | Expected |
|---|---|---|
| E1 | bootstrap without `payments` in config | no call to `/stripe/*` |
| E2 | bootstrap with `payments`, valid session | loads `subscription` |
| E3 | `login` | loads `subscription` in the same flow |
| E4 | `switchTeam` | reloads `subscription` |
| E5 | `logout` | clears `subscription` |
| E6 | `canManageBilling` | `true` iff `user.team.role` is the configured ownership role; a case with an `ownershipRole` other than `'owner'` must be covered, or a regression to a hardcoded comparison won't be caught |
| E7 | `checkout` responding `409` | the error reaches the caller with `status: 409`, state doesn't change |

`kit-react` remains the reference implementation, as the document states. The "Rollout status"
table must be extended with the E column.

The core's (live, gated) integration tests need a service with `stripe` configured and test Stripe
keys: they belong in the same `RH_TEST_*` scheme as the others, and must be **skipped** when the
variable is absent, not failed — the pattern `helpers.ts` already uses.

## Task 7 — documentation

**Files:** `packages/kit/README.md`, `README.md`, `docs/ADAPTERS.md`

Both the package description (`package.json`) and the README's opening say the kit is "signup and
login" — they must be rewritten, otherwise whoever's looking for payments won't look here.

A page covering, in order: the two modes, the fact that the token doesn't get renewed (fact 1), the
webhook gap with the `waitForSubscription` example on the return page (fact 2), who can do what
(fact 3), and the `403` from a resource protected by `@subscription` — which shows up in the kit as
a plain `ApiError`, because a `403` is exactly that: if a deployment wants to distinguish it, it
does so with a Guards rule that responds with a dedicated status, the same way `451` is already
used for consents.

---

## Order

`Task 1` → `Task 3` → `Task 4` → `Task 2` → `Task 5` → `Task 6` → `Task 7`.

Task 3 comes right after the first because it decides the shape of the return pages, and therefore
what the adapters must expose. Task 2 (products) is independent and can slip without blocking
subscriptions.

## Out of scope

- **Stripe.js / Elements / embedded payments.** See the dominant constraint.
- **Cart management.** Cart state belongs to the application; the kit takes a list of items and
  creates the order.
- **Webhooks.** They're server-side, handled by `restheart-stripe`.
- **Ready-made pages.** The starters (`restheart-cloud-starter-*`) are separate repos: a pricing
  page and a billing page are a separate piece of work, once this layer exists.
- **Invoicing, taxes, accounting.** Those live on Stripe.

## Rollout blocker

The live integration tests can't run until the `stripe` plugin is enabled on a reachable service.
Today it's only enabled in IT, and the IT environment runs on Docker snapshot images that need to
be rebuilt by `restheart`'s CI — see
`restheart-cloud-server/specs/todo/stripe-plugin-service-nodes.md`, Phase 5. The kit's code and the
adapters' unit tests don't depend on this and can proceed beforehand.

### Service configuration for integration tests

The core's integration tests (`packages/kit/src/__tests__/integration/`) run against a real
Ulabase service. Testing payments requires a service with the `stripe` plugin enabled and
configured. The environment variables are the same as the other tests (`RH_TEST_API_URL`,
`RH_TEST_ADMIN_PASSWORD`), plus a new one to enable the payment tests.

#### Environment variables

| Variable | Required | Description |
|---|---|---|
| `RH_TEST_API_URL` | yes | Base URL of the service (e.g. `https://xxx.restheart.com`) |
| `RH_TEST_ADMIN_PASSWORD` | yes | Password of the `root` user for admin calls |
| `RH_TEST_STRIPE` | no | If absent or empty, the payment tests are **skipped** (not failed). Set to `true` only when the service has the `stripe` plugin active. |

The pattern is the same one `helpers.ts` already uses: gated tests silently skip when the variable
is absent, so the same code runs in CI (where the service has stripe) and locally (where it often
doesn't).

#### Service-side configuration (`stripe.conf`)

The test service must have the `stripe` plugin enabled with at least one purchasable plan.
Example override file:

```bash
# Master switch
/stripeConfig/enabled -> true
/stripeConfig/secret-key -> "${STRIPE_SECRET_KEY}"
/stripeConfig/webhook-secret -> "${STRIPE_WEBHOOK_SECRET}"

# Subscriptions
/stripeConfig/subscriptions/enabled -> true
/stripeConfig/subscriptions/default-plan -> free
/stripeConfig/subscriptions/success-url -> "https://test-app.example.com/billing?success=true"
/stripeConfig/subscriptions/cancel-url -> "https://test-app.example.com/billing?canceled=true"
/stripeConfig/subscriptions/portal-return-url -> "https://test-app.example.com/billing"

# A free plan (not purchasable) and a gold plan (purchasable)
/stripeConfig/subscriptions/plans -> {
  "free": {
    "seats": { "mode": "capped", "max": 1 },
    "limits": { "max-projects": 3 }
  },
  "gold": {
    "price-id-monthly": "price_...",
    "price-id-annual": "price_...",
    "seats": { "mode": "capped", "max": 10 },
    "limits": { "max-projects": 50 }
  }
}

# Products (optional, for order tests)
/stripeConfig/products/enabled -> true
/stripeConfig/products/default-currency -> eur
# {ORDER_ID}/{ORDER_SECRET} are interpolated by the plugin, and belong in the
# fragment: a fragment never reaches a server, so the secret — a bearer
# credential — stays out of access logs and Referer headers. Read back with
# the core's readOrderRef()/clearOrderRef().
/stripeConfig/products/success-url -> "https://test-app.example.com/order#order={ORDER_ID}&secret={ORDER_SECRET}"
/stripeConfig/products/cancel-url -> "https://test-app.example.com/cart"

# Plugins
/stripeService/enabled -> true
/stripeInitializer/enabled -> true
/stripeWebhookService/enabled -> true
/stripeCheckoutService/enabled -> true
/stripePortalService/enabled -> true
/stripeSubscriptionService/enabled -> true
/stripePlansService/enabled -> true
/stripeCatalogCache/enabled -> true
/stripeLicensesService/enabled -> true
/ordersCheckoutInterceptor/enabled -> true
/ordersCheckoutResponseInterceptor/enabled -> true
```

The Stripe keys must be **test keys** (`sk_test_...`, `whsec_...`), never live ones.
The `price-id-*` values are real Price IDs from the Stripe test dashboard — at least a monthly
and/or an annual one are needed for the `gold` plan.

#### ACL for the tests

The test service must allow:

1. **Registration and login** — already configured for the other tests
2. **`GET /stripe/plans`** — anonymous access (or authenticated, depending on the deployment's ACL)
3. **`GET /stripe/subscription`** — access for any team member
4. **`POST /stripe/checkout`**, **`POST /stripe/portal`**, **`GET/POST/DELETE /stripe/licenses`** — access only for the ownership role (default `owner`)

If the test service's ACL uses Ulabase's default rules, these are already covered. If it
uses custom rules, verify that the `/stripe/*` paths aren't blocked.

#### What the payment integration tests cover

The tests verify the **client-side flow**, not Stripe itself:

1. `getPlans()` — reads the plan catalog from the service
2. `getSubscription()` — reads the current team's subscription state
3. `createCheckoutSession()` — creates a checkout session (receives the URL, doesn't follow it)
4. `openBillingPortal()` — creates a portal session (receives the URL)
5. `getLicenses()` / `grantLicense()` / `revokeLicense()` — license management
6. `createOrder()` / `getOrder()` — order flow (if products is enabled)

They don't test the actual payment on Stripe — that's handled server-side by the webhook.
Gated tests should be skipped with `it.skip` or with a guard at the top of the file when
`RH_TEST_STRIPE` isn't set.

---

## Tutorial: using payments with Angular (`kit-ng`)

### 1. Configuration

Enable payments in the provider config. Without `payments: true`, no call to `/stripe/*` ever
fires — a service without the `stripe` plugin would respond `404` on every startup.

```ts
// app.config.ts
import { provideRhAuth } from '@ulabase/kit-ng';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRhAuth({
      apiBaseUrl: 'https://my-service.restheart.com',
      payments: true,                // explicit opt-in
      ownershipRole: 'owner',        // default, overridable if the tenant has a different role
    }),
  ],
};
```

### 2. Reading subscription state

The state is reactive — the signals update automatically after `checkSession`, `login` and
`switchTeam`.

```ts
import { Component, inject } from '@angular/core';
import { RhPaymentsService } from '@ulabase/kit-ng';

@Component({
  selector: 'app-pricing',
  template: `
    @if (payments.subscription(); as sub) {
      <p>Current plan: <strong>{{ sub.plan }}</strong></p>
      <p>Status: {{ sub.active ? 'Active' : 'Not active' }}</p>
      <p>Seats: {{ sub.seats.licensed }} / {{ sub.seats.limit ?? 'unlimited' }}</p>
    } @else {
      <p>No subscription</p>
    }
  `,
})
export class PricingComponent {
  payments = inject(RhPaymentsService);
}
```

### 3. Showing the plan catalog

`getPlans()` doesn't require a session — it's safe to call from a public page.

```ts
@Component({ /* ... */ })
export class PlansComponent {
  private payments = inject(RhPaymentsService);
  plans = signal<Plan[]>([]);

  ngOnInit() {
    this.payments.getPlans().subscribe(res => this.plans.set(res.plans));
  }
}
```

### 4. Starting Checkout

`createCheckoutSession` returns a URL — redirect the user with `window.location.href`.

```ts
checkout(planId: string, interval: 'month' | 'year') {
  this.payments.createCheckoutSession(planId, interval).subscribe({
    next: ({ url }) => window.location.href = url,
    error: (err: ApiError) => {
      if (err.status === 409) {
        // Already subscribed — send them to the Portal instead
        this.openPortal();
      }
    },
  });
}
```

### 5. Checkout return page (the webhook gap)

After the redirect from Stripe, the webhook might not have arrived yet. **Don't** use
`getSubscription()` directly — use `waitForSubscription` with a predicate.

```ts
@Component({ /* ... */ })
export class CheckoutSuccessComponent {
  private payments = inject(RhPaymentsService);
  private route = inject(ActivatedRoute);
  status = signal<'loading' | 'success' | 'timeout'>('loading');
  subscription = signal<Subscription | null>(null);

  ngOnInit() {
    const plan = this.route.snapshot.queryParamMap.get('plan') ?? '';

    this.payments.waitForSubscription(
      sub => sub.plan === plan && sub.active,
      { timeoutMs: 30_000, intervalMs: 1_000 }
    ).subscribe({
      next: sub => {
        this.subscription.set(sub);
        this.status.set('success');
      },
      error: err => {
        if (err.name === 'WaitTimeoutError') {
          this.status.set('timeout');
          // The payment went through on Stripe,
          // the webhook will arrive shortly. Show a
          // "check back in a few seconds" message instead of an error.
        }
      },
    });
  }
}
```

**Note:** `waitForSubscription` automatically updates the adapter's `subscription` signal when it
resolves — no need to call `loadSubscription()` afterwards.

### 6. Who can do what

```ts
@Component({ /* ... */ })
export class BillingComponent {
  payments = inject(RhPaymentsService);

  // true only for whoever has the ownership role (default: 'owner')
  get showBillingButtons(): boolean {
    return this.payments.canManageBilling();
  }
}
```

- `getSubscription()` — anyone on the team can call it
- `createCheckoutSession()`, `openBillingPortal()`, `getLicenses()`, `grantLicense()`,
  `revokeLicense()` — only when `canManageBilling === true`

### 7. Opening the Portal

```ts
openPortal() {
  this.payments.openBillingPortal().subscribe({
    next: ({ url }) => window.location.href = url,
    error: (err: ApiError) => {
      if (err.status === 402) {
        // Never checked out — redirect to checkout instead
        this.router.navigate(['/pricing']);
      }
    },
  });
}
```

### 8. Managing licenses (seats)

```ts
@Component({ /* ... */ })
export class TeamBillingComponent {
  payments = inject(RhPaymentsService);
  licenses = signal<Licenses | null>(null);

  loadLicenses() {
    this.payments.getLicenses().subscribe(l => this.licenses.set(l));
  }

  grantSeat(email: string) {
    this.payments.grantLicense(email).subscribe({
      next: result => {
        // result is 'granted' or 'already-licensed'
        this.loadLicenses(); // reload
      },
      error: (err: ApiError) => {
        if (err.status === 409) alert('No seat available');
        if (err.status === 404) alert('User is not a team member');
      },
    });
  }

  revokeSeat(email: string) {
    this.payments.revokeLicense(email).subscribe(() => this.loadLicenses());
  }
}
```

### 9. Products and orders (products mode)

```ts
// Catalog — a normal read, nothing special
this.payments.getCatalog().subscribe(items => /* ... */);

// Create an order (authenticated)
this.payments.createOrder(
  [{ productId: 'SKU-1', quantity: 1 }]
).subscribe(order => {
  window.location.href = order.checkout_url;
});

// Guest checkout — pass the email, no session required
this.payments.createOrder(
  [{ productId: 'SKU-1', quantity: 1 }],
  'buyer@example.com'
).subscribe(order => {
  // Save order._id and order.secret for the return page
  window.location.href = order.checkout_url;
});

// Order return page — same pattern as waitForSubscription
this.payments.waitForOrder(orderId, secret).subscribe({
  next: order => {
    if (order.status === 'paid') /* show confirmation */;
  },
  error: err => {
    if (err.name === 'WaitTimeoutError') /* "check back shortly" */;
  },
});
```

### 10. Formatting amounts

Stripe amounts are in the smallest unit (cents for EUR/USD, whole units for JPY).

```ts
import { formatPrice } from '@ulabase/kit';

formatPrice(1990, 'eur');          // "€19.90"
formatPrice(500, 'jpy', 'it-IT');  // "¥500"
formatPrice(19900, 'bhd');         // "BHD 19.900"
```

### Important note: no token renewal

Unlike `acceptConsents`, payments do **not** renew the token. The `@subscription` ACL resolver
reads the state from the database on every request, not from the JWT. An upgrade is therefore
effective immediately, without a re-login. Don't add a `renewToken()` after a plan change — it
would be a needless round trip.

---

## Where this stands

| Task | State |
|---|---|
| 1 — core: subscriptions | done |
| 2 — core: products and orders | done |
| 3 — core: waiting for the webhook | done |
| 4 — core: formatting amounts | done |
| 5 — adapter: reactive state | done for `kit-ng`, `kit-react`, `kit-vue`; **not** for the two SSR subpaths |
| 6 — adapter contract and tests | contract and adapter unit tests (E1–E10) done; **live integration tests not written** |
| 7 — documentation | done |

The core ships `payments.ts`, `orders.ts` and `money.ts` with 28 unit tests. Each SPA adapter
exposes payments as its own surface, separate from auth: `RhPaymentsService` (Angular),
`RhPaymentsProvider` + `usePayments()` (React), `createRhPayments` + `usePayments()` (Vue).
`docs/ADAPTER_CONTRACT.md` section E is the authoritative list of required behaviours.

Two things remain.

### Live integration tests (Task 6)

Everything for them is specified above — the `RH_TEST_STRIPE` gate, the service configuration,
the ACL, and what they should cover. They are not written because the rollout blocker still
holds: no reachable service has the `stripe` plugin enabled. Write them when one does; the
gating pattern means they will skip, not fail, everywhere else.

### Payments on the SSR subpaths (Task 5)

`*/next` and `*/nuxt` have no payments support, and the adapter contract's section E does not
port to them as written: E1–E10 are about reactive client state, which those surfaces do not
have. They are session, cookie and middleware helpers that run *before* render.

What would genuinely apply is a **server-side read** — a `getServerSubscription` alongside the
existing `getServerSession`, so a Next.js server component or a Nuxt route middleware can gate
on the subscription before rendering, the way `rhAuthMiddleware` gates on the session today.
That is a real gap: today an SSR app has to render the page and let a client component
discover the subscription.

It is deliberately deferred rather than dropped. The dominant constraint above ("added to all
five, or to none") was written about the *client* state contract, and stretching it to cover a
server API that has no client counterpart would have meant inventing the shape under time
pressure. Doing it properly means answering: does it read the subscription through the request
cookie's token, does middleware get a redirect helper for "subscribed-only" routes, and does it
share the `payments` opt-in flag or take its own.

### One rule worth not losing

E10 in the adapter contract exists because all three adapters originally got it wrong: they
keyed the subscription reload on the *user object's identity*. Since `updateProfile` and
`acceptConsents` both re-run `checkSession` and hand back a freshly parsed user document, every
profile edit re-read the subscription. The reload must key on the **team id** — the subscription
belongs to the team, not to the profile.

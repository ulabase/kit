---
type: Package
title: "@ulabase/kit"
description: Core framework-agnostic package with zero dependencies. Provides authentication, token management, team operations, consents gating, password reset, payments, orders, cart, and money formatting.
tags: [package, core, authentication, payments, orders, cart, typescript]
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T10:51:10.399Z
sources:
  - id: openwiki-source-d846911884642122d8dd6179
    resource: repo://packages/kit/src/auth.ts
  - id: openwiki-source-7dbc4364bd37edb52c104a4d
    resource: repo://packages/kit/src/cart.ts
  - id: openwiki-source-e7bfea41ff94b3acb0b72ff3
    resource: repo://packages/kit/src/client.ts
  - id: openwiki-source-58f1051310aebc9b339b995d
    resource: repo://packages/kit/src/consents.ts
  - id: openwiki-source-dc6fb97d2a3901aa8aa09a70
    resource: repo://packages/kit/src/index.ts
  - id: openwiki-source-77978ac75e6e04d6df6d024a
    resource: repo://packages/kit/src/invite.ts
  - id: openwiki-source-fa0d4a25d3019b33ad2d58a3
    resource: repo://packages/kit/src/money.ts
  - id: openwiki-source-346f417d59a26ce09dba770f
    resource: repo://packages/kit/src/orders.ts
  - id: openwiki-source-814dd157639abb9facf8f99b
    resource: repo://packages/kit/src/password.ts
  - id: openwiki-source-9aeb2b476e021464e50a1e8f
    resource: repo://packages/kit/src/payments.ts
  - id: openwiki-source-42dfd0defa8189243ef19509
    resource: repo://packages/kit/src/types.ts
generated: { by: "openwiki/0.6.1", at: "2026-10-01T10:51:10.399Z" }
---

# @ulabase/kit

The core framework-agnostic package for Ulabase. Zero dependencies, Promise-based API. Provides authentication, token management, team operations, consents gating, password reset, payments, orders, cart, and money formatting.

## Installation

```bash
npm install @ulabase/kit
```

**Requirements**: Ulabase service 9.6.0+ (for `delivery=body` support in bearer mode)

## Quick Start

```typescript
import { checkSession, login, logout, getUserInfo, renewToken, applyBearerDelivery } from '@ulabase/kit';

const config = { apiBaseUrl: 'https://api.example.com' };

// Check existing session
const user = await checkSession(config);  // UserInfo | null

// Login
await login(config, 'user@example.com', 'secret');

// Get user info (requires valid session)
const userInfo = await getUserInfo(config);

// Renew token (e.g., after consents acceptance)
const newToken = await renewToken(config);

// Logout
await logout(config);
```

## Configuration

All functions accept an `AuthConfig` object:

```typescript
interface AuthConfig {
  apiBaseUrl: string;                              // Must be a valid https:// URL
  getToken?: () => string | null | Promise<string | null>;  // SSR token source
  setToken?: (token: string) => void;              // SSR token sink
  transport?: (url: string, init?: RequestInit) => Promise<Response>;  // Custom fetch (e.g., Angular HttpClient)
  onError?: (error: ApiError) => void;             // Global error observer
  payments?: boolean;                              // Opt-in to subscription and payment features (default: false)
  ownershipRole?: string;                          // Role that grants billing management rights (default: 'owner')
}
```

The optional `getToken`/`setToken` callbacks support SSR runtimes (Next.js, Nuxt) where `localStorage` is unavailable. See [Architecture — Pluggable Token Source and Sink](../architecture/overview.md#pluggable-token-source-and-sink) for details.

**`transport`**: Replaces `fetch` with a framework's HTTP client. `kit-ng` uses [`httpClientTransport`](kit-ng.md#httpclienttransport) to route calls through Angular's `HttpClient` so the interceptor chain applies to kit-originated requests.

**`onError`**: Observes every failure, including session-restoration calls no caller is waiting on. It cannot swallow errors — the error is thrown either way. Use it for cross-cutting concerns like offline banners or consent gates.

**Validation**: `apiBaseUrl` must be a valid `https://` URL. The `http://` protocol is only allowed on local host names (`localhost`, `.localhost`, `.local`, `.test`). Invalid URLs throw an `ApiError`.

**`payments`**: When `true`, adapters load the team's subscription on `checkSession`, `login` and `switchTeam`, and expose subscription-related reactive state. When `false` or absent (the default), no call to `/stripe/*` is ever made — a service without the `stripe` plugin would respond `404` on those paths, and this flag prevents that from happening on every app startup.

**`ownershipRole`**: The role that grants billing management rights. Used to derive `canManageBilling`: `true` when the current user's team role matches this value. Defaults to `'owner'`. Must match the service's `accountsConfig.ownership-role` — if the deployment overrides it, hardcoding `'owner'` here would show the billing button to the wrong people and hide it from the right ones.

## Authentication Flows

### Registration

```typescript
import { register, verify, buildVerifyUrl } from '@ulabase/kit';

// Step 1: Register
await register(config, {
  email: 'user@example.com',
  password: 'secure-password',
  teamName: 'My Team',
  firstName: 'John',  // optional
  lastName: 'Doe'     // optional
});

// Step 2: Build verification URL (sent via email)
const verifyUrl = buildVerifyUrl(config, email, token, 'fragment');

// Step 3: User clicks link, app handles redirect
// For fragment delivery: read token from URL hash
// For cookie delivery: token is set automatically
```

### Email Verification

```typescript
import { verify, buildVerifyUrl } from '@ulabase/kit';

// Build URL for browser redirect
const url = await verify(config, email, token, 'fragment');

// Navigate to URL
window.location.href = url;
// Backend 302 redirects to frontend-app-url#access_token=...

// After redirect, read token from location.hash
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const accessToken = hashParams.get('access_token');
if (accessToken) {
  setToken(accessToken);
}
```

### Login

```typescript
import { login } from '@ulabase/kit';

// Bearer mode (default)
const user = await login(config, email, password);
// Token stored in localStorage, proactive refresh scheduled

// Cookie mode (same-origin only)
const user = await login(config, email, password, 'cookie');
// Backend sets HttpOnly JWT cookie
```

**Unverified account rejection**: After a successful login, the kit fetches user info and checks for the `$unauthenticated` role. If the account has not yet been email-verified, `login()` clears the stored token and throws `{ status: 403, message: 'Account not verified' }`. This applies to both bearer and cookie modes. Catch this error to prompt the user to verify their email before retrying.

### Session Check

```typescript
import { checkSession } from '@ulabase/kit';

// Returns UserInfo if valid token exists, null otherwise
const user = await checkSession(config);
if (user) {
  console.log(user._id, user.roles, user.team);
}
```

**Unverified accounts**: If the server returns a user whose roles include `$unauthenticated` (i.e., the account was registered but never email-verified), `checkSession()` clears the token and returns `null` rather than returning an unusable user object.

### Get User Info

```typescript
import { getUserInfo } from '@ulabase/kit';

// Read the authenticated user from GET /users/me
const user = await getUserInfo(config);
// Returns the full user document (including application-level fields)
```

**Note**: Unlike `checkSession`, `getUserInfo` makes no local expiry check and does not clear the session on failure. Use this when you need the full user document after a write operation.

### Logout

```typescript
import { logout } from '@ulabase/kit';

// Clears token, cancels pending refresh
await logout(config);
```

## Token Management

### Manual Token Operations

```typescript
import { setToken, getToken, clearToken, getTokenExpiry, getTokenClaims, isValidApiBaseUrl } from '@ulabase/kit';

// Store token (e.g., after OAuth redirect)
setToken(token);

// Read current token (null if expired or missing)
const token = getToken();

// Clear token and cancel refresh
clearToken();

// Get token expiration in milliseconds
const expMs = getTokenExpiry(token);

// Get token claims (unverified - for client-side decisions only)
const claims = getTokenClaims();
if (claims) {
  console.log(claims.sub); // User id
}

// Validate API base URL (any https:// URL; http:// only on localhost/.localhost/.local/.test)
const isValid = isValidApiBaseUrl('https://api.example.com');
```

### Proactive Refresh

```typescript
import { scheduleRefresh, cancelRefresh, renewToken } from '@ulabase/kit';

// Schedule refresh at 80% of TTL (called automatically by login)
scheduleRefresh(config);

// Cancel pending refresh
cancelRefresh();

// Force token renewal (e.g., after consents acceptance)
const newToken = await renewToken(config);
```

**Refresh Strategy**:
- Tokens expire after 15 minutes
- Refresh scheduled at 80% of TTL (~12 minutes)
- Automatic rescheduling after successful refresh
- Graceful degradation on failure (token expires naturally)

### Token Renewal

```typescript
import { renewToken, applyBearerDelivery } from '@ulabase/kit';

// Renew token (bearer mode - default)
const token = await renewToken(config);
// Returns the new token string

// Renew token (cookie mode)
const nullResult = await renewToken(config, 'cookie');
// Returns null - backend updates cookie

// Extract token from auto-login response
const extractedToken = await applyBearerDelivery(config, response);
// Used internally by activate, resetPassword, switchTeam
```

**Token Claims**: `getTokenClaims()` returns the stored token's claims without signature verification. These are **not verified** — a JWT payload is base64, and anyone holding the token can change it. Read them for what the client does next, never for an access decision — the server re-checks the signature on every request.

## Team Operations

### List Teams

```typescript
import { getTeams } from '@ulabase/kit';

const teams = await getTeams(config);
// Returns: TeamMembership[]
// Each team has: id, name, description, role, active
```

### Switch Team

```typescript
import { switchTeam } from '@ulabase/kit';

// Bearer mode (default)
await switchTeam(config, { $oid: teamId });
// New token with updated team claim stored in localStorage

// Cookie mode
await switchTeam(config, { $oid: teamId }, 'cookie');
// Backend updates cookie with new team claim
```

### Team Management

```typescript
import {
  listTeamMembers,
  removeMember,
  updateMemberRole,
  createTeam,
  updateTeam,
  deleteTeam
} from '@ulabase/kit';

// List members of active team
const members = await listTeamMembers(config);

// Remove member (owner/admin only)
await removeMember(config, 'member@example.com');

// Update member role (owner/admin only)
await updateMemberRole(config, 'member@example.com', 'owner');

// Create new team
const newTeam = await createTeam(config, 'New Team Name');

// Update team (owner/admin only)
await updateTeam(config, { name: 'Updated Name', description: 'New description' });

// Delete team (owner only, must have no other members)
await deleteTeam(config);
```

## Invitation Flows

### Send Invitation

```typescript
import { invite } from '@ulabase/kit';

await invite(config, 'newuser@example.com', 'member');
// Sends invitation email with token
```

### Get Invitation Details

```typescript
import { getInvitation } from '@ulabase/kit';

const invitation = await getInvitation(config, email, token);
// Returns: { email, teamName, role, isNewUser, expiresAt }
```

### Activate Account (New User)

```typescript
import { activate } from '@ulabase/kit';

// Bearer mode (default)
const token = await activate(config, {
  email: 'newuser@example.com',
  token: 'invitation-token',
  password: 'new-password'
});
// Sets password, logs in, stores token, returns the fresh bearer token

// Cookie mode
const nullResult = await activate(config, {
  email: 'newuser@example.com',
  token: 'invitation-token',
  password: 'new-password'
}, 'cookie');
// Backend sets cookie, no token in response, returns null
```

### Accept Invitation (Existing User)

```typescript
import { acceptInvite } from '@ulabase/kit';

await acceptInvite(config, invitationToken);
// Adds user to team
```

### Resend Invitation

```typescript
import { resendInvite } from '@ulabase/kit';

await resendInvite(config, 'user@example.com');
```

### List Pending Invitations

```typescript
import { listInvitations } from '@ulabase/kit';

const invitations = await listInvitations(config);
// Returns: PendingInvitation[]
// Each has: email, role, isNewUser, createdAt, expiresAt, expired
// Owner/admin only
```

## Password Management

### Forgot Password

```typescript
import { forgotPassword } from '@ulabase/kit';

await forgotPassword(config, 'user@example.com');
// Sends password reset email
```

### Reset Password

```typescript
import { resetPassword } from '@ulabase/kit';

// Bearer mode (default)
const token = await resetPassword(config, {
  email: 'user@example.com',
  token: 'reset-token',
  password: 'new-password'
});
// Resets password, logs in, stores token, returns the fresh bearer token

// Cookie mode
const nullResult = await resetPassword(config, {
  email: 'user@example.com',
  token: 'reset-token',
  password: 'new-password'
}, 'cookie');
// Backend sets cookie, no token in response, returns null
```

## Profile Management

```typescript
import { updateProfile, updateUser, changePassword } from '@ulabase/kit';

// Update profile fields (firstName, lastName only — goes through /auth/profile)
await updateProfile(config, {
  firstName: 'John',
  lastName: 'Doe'
});

// Update any user document field (goes through PATCH /users/{email})
// Requires an ACL permission granting write access to the target fields.
await updateUser(config, 'user@example.com', { preferences: { theme: 'dark' } });

// Change password (requires current password)
await changePassword(config, 'current-password', 'new-password');
```

## Consents Gating

```typescript
import { acceptConsents } from '@ulabase/kit';

// Record acceptance and get updated token
const user = await acceptConsents(config, session.user._id);
// user.latestConsents now carries the accepted versions
```

The consents pattern uses Guards rules to block requests from users who haven't accepted current consents. The server decides what is written — the permission's `mergeRequest` stamps the versions being accepted and the timestamp.

## Payments & Subscriptions

The payments module handles Stripe subscriptions, checkout sessions, billing portal, and seat licences. Enable it by setting `payments: true` in `AuthConfig`.

**Important**: Payments have a different relationship to the session than other kit modules. There is no token renewal — the `@subscription` ACL variable is resolved server-side from the database on every request. An upgrade is effective immediately with no re-login.

**The redirect back from Checkout races the webhook.** Stripe sends the buyer back to `successUrl` over the browser; it reports the payment over a separate server-to-server webhook, with no ordering guarantee between the two. Use `waitForSubscription` on the success page instead of a bare `getSubscription`.

### Plans & Subscription

```typescript
import { getPlans, getSubscription } from '@ulabase/kit';

// Get available plans (no session required - safe for public pricing pages)
const { default_plan, plans } = await getPlans(config);

// Get current team's subscription
const subscription = await getSubscription(config);
console.log(subscription.plan, subscription.active, subscription.seats);
```

### Checkout & Billing Portal

```typescript
import { createCheckoutSession, openBillingPortal } from '@ulabase/kit';

// Start Stripe Checkout (requires canManageBilling)
const { url } = await createCheckoutSession(config, 'gold', 'month');
window.location.href = url;

// Open Stripe Customer Portal (requires canManageBilling)
const { url: portalUrl } = await openBillingPortal(config);
window.location.href = portalUrl;
```

**Error handling**:
- `createCheckoutSession` rejects with `status: 409` when the team already has an active subscription
- `openBillingPortal` rejects with `status: 402` for a team that has never checked out

### Seat Licences

```typescript
import { getLicenses, grantLicense, revokeLicense } from '@ulabase/kit';

// Get current licences (requires canManageBilling)
const licenses = await getLicenses(config);

// Grant a seat licence (requires canManageBilling)
const result = await grantLicense(config, 'user@example.com');
// Returns: 'granted' | 'already-licensed'

// Revoke a seat licence (requires canManageBilling)
await revokeLicense(config, 'user@example.com');
```

### Waiting for Webhook

```typescript
import { waitForSubscription, WaitTimeoutError } from '@ulabase/kit';

try {
  // Poll until condition is met (e.g., on Checkout success page)
  const subscription = await waitForSubscription(
    config,
    s => s.plan === 'gold' && s.active,
    { timeoutMs: 30000, intervalMs: 1000 }
  );
  // Subscription is active
} catch (error) {
  if (error instanceof WaitTimeoutError) {
    // Payment may have succeeded; webhook may just be late
    // Show a "please wait" message, not an error
  }
}
```

**Test**: `packages/kit/src/__tests__/integration/payments.test.ts`

## Orders & Products

The orders module handles product catalogs, order creation, checkout, and order tracking. Prices come from the service's own catalog at checkout time — a tampered line changes what the buyer *sees* and nothing about what they are charged.

### Catalog

```typescript
import { getCatalog } from '@ulabase/kit';

// Get product catalog (access controlled by deployment's ACL)
const products = await getCatalog(config);

// With pagination and filtering
const filtered = await getCatalog(config, {
  pagesize: 10,
  page: 1,
  filter: { category: 'desk' },
  sort: '-_id'
});
```

### Orders

```typescript
import { createOrder, getOrder } from '@ulabase/kit';

// Create order and start checkout
const { _id, checkout_url, secret } = await createOrder(config, [
  { productId: 'tee-classic', quantity: 2 },
  { productId: 'mug-logo', quantity: 1 }
]);
window.location.href = checkout_url;

// Get order (authenticated or with secret for guest checkout)
const order = await getOrder(config, orderId, secret);
```

### Order Reference (Guest Checkout)

```typescript
import { readOrderRef, clearOrderRef, waitForOrder } from '@ulabase/kit';

// Read order reference from URL (after Checkout redirect)
const ref = readOrderRef();
if (ref) {
  clearOrderRef(); // Strip secret from address bar
  const order = await waitForOrder(config, ref.id, ref.secret);
  if (order.status === 'paid') {
    // Show confirmation
  }
}
```

**Test**: `packages/kit/src/__tests__/integration/orders.test.ts`

## Cart

The cart module provides pure functions for managing a shopping cart. Nothing here talks to a server — a cart is a list the buyer is building, and it becomes an order in one call via `toOrderItems` → `createOrder`.

```typescript
import { addToCart, setCartQuantity, removeFromCart, cartTotals, toOrderItems } from '@ulabase/kit';

// Add item to cart
const cart = addToCart([], { productId: 'tee-classic', name: 'Classic T-shirt', unitAmount: 2500 });

// Update quantity
const updated = setCartQuantity(cart, 'tee-classic', 3);

// Remove item
const reduced = removeFromCart(updated, 'tee-classic');

// Calculate totals
const totals = cartTotals(cart);
console.log(totals.totalItems, totals.subtotal, totals.currency);

// Convert to order items for createOrder
const orderItems = toOrderItems(cart);
await createOrder(config, orderItems);
```

### Cart Persistence

```typescript
import { loadCart, saveCart, clearStoredCart, DEFAULT_CART_STORAGE_KEY } from '@ulabase/kit';

// Save cart to localStorage
saveCart(cart);

// Load cart from localStorage
const savedCart = loadCart();

// Clear saved cart
clearStoredCart();
```

**Test**: `packages/kit/src/__tests__/integration/cart.test.ts`

## Money Formatting

```typescript
import { formatPrice } from '@ulabase/kit';

// Format amount in minor units (cents for EUR/USD)
formatPrice(1990, 'eur');        // "19,90 €" (browser default locale)
formatPrice(500, 'jpy', 'ja-JP'); // "¥500"
formatPrice(19900, 'bhd', 'en-BH'); // "BHD 19.900"
```

**Note**: Stripe amounts are always in the currency's *minor* unit. `amount / 100` is a bug for currencies like JPY (0 decimals) or BHD (3 decimals). This function uses `Intl.NumberFormat` to handle all currencies correctly.

## Authenticated Fetch (`apiFetch`)

The kit exports `apiFetch`, an authenticated `fetch` against the service. Every internal call the kit makes goes through it. It is exported because an application querying its own Ulabase collections needs exactly the same thing.

```typescript
import { apiFetch } from '@ulabase/kit';

// GET — pass a path, not a full URL
const res = await apiFetch(config, '/my-collection?pagesize=10');
const docs = await res.json();

// POST
const res = await apiFetch(config, '/my-collection', {
  method: 'POST',
  body: JSON.stringify({ name: 'hello' }),
});
```

**What it does**:
- Attaches the Bearer token (from `localStorage` or the configured `getToken` source)
- Sets `Content-Type: application/json` when a body is present and no header is set
- Sets `No-Auth-Challenge: true` to suppress the browser's native Basic Auth popup on 401
- Uses `credentials: 'include'` for cookie-mode compatibility
- Throws `ApiError` (`{ status, message }`) on any non-2xx response
- Uses `status: 0` for network failures (DNS, offline, CORS, aborted)

**When to use it directly**: Use `apiFetch` in framework-agnostic code or when writing custom services. Framework adapter users should prefer `auth.api()` which wraps this call — see the [Angular](kit-ng.md#authenticated-fetch), [React](kit-react.md#authenticated-fetch), and [Vue](kit-vue.md#authenticated-fetch) adapter pages.

## Error Handling

All functions throw `ApiError` on failure:

```typescript
interface ApiError {
  status: number;   // HTTP status code
  message: string;  // Error message from server
}

try {
  await login(config, email, password);
} catch (error) {
  if (error.status === 401) {
    console.error('Invalid credentials');
  } else if (error.status === 403) {
    console.error('Account not verified — check email');
  } else if (error.status === 400) {
    console.error('Validation error:', error.message);
  } else {
    console.error('Unexpected error:', error);
  }
}
```

## Type Definitions

### UserInfo

```typescript
type UserInfo<E extends object = Record<never, never>> = {
  _id: string;
  roles: string[];
  team?: {
    _id: { $oid: string };
    role: string;
  };
  profile?: {
    name?: string;
    surname?: string;
    avatarUrl?: string;
  };
} & E;
```

**Generic parameter**: Applications whose users collection has a JSON Schema can extend this with their own fields. For example:
```typescript
type MyUser = UserInfo<{
  latestConsents?: { tos: string; pp: string; acceptedAt?: { $date: number } };
}>;
```

### TeamMembership

```typescript
interface TeamMembership {
  id: { $oid: string };
  name?: string;
  description?: string;
  role: 'owner' | 'member';
  active?: boolean;
}
```

### TeamMember

```typescript
interface TeamMember {
  email: string;
  name?: string;
  role: 'owner' | 'member';
  joinedAt: string;
}
```

### Invitation

```typescript
interface Invitation {
  email: string;
  teamName: string;
  role: 'owner' | 'member';
  isNewUser: boolean;
  expiresAt: string;
}
```

### PendingInvitation

```typescript
interface PendingInvitation {
  email: string;
  role: 'owner' | 'member';
  isNewUser: boolean;
  createdAt?: string;
  expiresAt?: string;
  expired?: boolean;
}
```

### Plan

```typescript
interface Plan {
  id: string;
  name: string;
  description?: string;
  seats?: {
    mode: 'capped' | 'per_seat' | 'unlimited';
    max?: number;  // Seat cap for 'capped', or ceiling for 'per_seat'
  };
  limits?: Record<string, number | boolean | string>;  // Arbitrary limits
  prices?: Record<string, PlanPrice>;  // Keyed by interval ('month', 'year')
}
```

### PlanPrice

```typescript
interface PlanPrice {
  price_id: string;
  amount: number | null;  // In minor units (cents for EUR/USD)
  currency: string | null;
}
```

### Subscription

```typescript
interface Subscription {
  plan: string;
  active: boolean;
  licensed: boolean;  // Whether the caller holds a seat licence
  cancel_at_period_end: boolean;
  status?: string;
  trial_end?: { $date: number };
  current_period_end?: { $date: number };
  seats: {
    limit: number | null;  // null means unlimited
    licensed: number;
    available: number | null;  // null means unlimited
    over_limit: boolean;
    over_limit_since?: { $date: number };
    over_limit_days?: number;
  };
}
```

### Licenses

```typescript
interface Licenses {
  licensed: string[];  // User ids (emails) currently holding a seat
  seats: {
    limit: number | null;
    licensed: number;
    available: number | null;
  };
}
```

### CatalogItem

```typescript
interface CatalogItem {
  _id: string;
  type: 'physical' | 'digital';
  name: string;
  description?: string;
  image_url?: string;
  unit_amount: number;  // In minor units
  currency?: string;
  purchasable: boolean;
  tax_code?: string;
  stripe_price_id?: string;  // Present when item has its own Stripe Price
}
```

### Order

```typescript
interface Order {
  _id: { $oid: string };
  stripe_session_id: string;
  stripe_payment_intent?: string | null;
  secret?: string;  // For guest checkout lookup
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
```

### OrderLineItem

```typescript
interface OrderLineItem {
  product_id: string;
  type: 'physical' | 'digital';
  name: string;
  unit_amount: number;
  quantity: number;
  subtotal: number;
  tax_code?: string;
}
```

### OrderStatus

```typescript
type OrderStatus = 'pending_payment' | 'paid' | 'failed' | 'expired';
```

### CartLine

```typescript
interface CartLine {
  productId: string;
  quantity: number;
  name: string;  // Display only
  unitAmount: number;  // Display only, minor units
  currency: string;
  options?: Record<string, string>;  // Variant choices
  image?: string;  // For display
}
```

### CartItem

```typescript
type CartItem = Omit<CartLine, 'quantity' | 'currency'> & { currency?: string };
```

### CartTotals

```typescript
interface CartTotals {
  totalItems: number;
  subtotal: number;  // Minor units, single-currency only
  currency: string;  // First line's currency, or 'eur' for empty cart
}
```

### OrderRef

```typescript
interface OrderRef {
  id: string;
  secret?: string;  // Absent when deployment only interpolates {ORDER_ID}
}
```

### CatalogQuery

```typescript
interface CatalogQuery {
  collection?: string;  // Default: 'catalog'
  pagesize?: number;
  page?: number;
  filter?: Record<string, unknown>;  // MongoDB query
  sort?: string;  // e.g., '-_id' for newest first
}
```

### OrderItem

```typescript
interface OrderItem {
  productId: string;
  quantity: number;
  metadata?: Record<string, string>;  // Shop's own labels (variant, gift message, etc.)
}
```

### WaitOptions

```typescript
interface WaitOptions {
  timeoutMs?: number;  // Default: 30000
  intervalMs?: number;  // Default: 1000
  signal?: AbortSignal;
}
```

### WaitTimeoutError

```typescript
class WaitTimeoutError extends Error {
  name: 'WaitTimeoutError';
  // Thrown by waitForSubscription/waitForOrder when condition never became true in time
  // Timing out is not a failed payment — webhook may just be late
}
```

### GrantLicenseResult

```typescript
type GrantLicenseResult = 'granted' | 'already-licensed';
```

## Internal Architecture

### Module Structure

```
src/
├── client.ts      # Token storage, API fetch, URL validation
├── auth.ts        # Auth flows, proactive refresh, bearer delivery
├── team.ts        # Team operations
├── invite.ts      # Invitation flows
├── password.ts    # Password reset
├── consents.ts    # Consents gating (acceptConsents)
├── profile.ts     # Profile and user document updates (updateProfile, updateUser, changePassword)
├── payments.ts    # Subscriptions, checkout, billing portal, seat licences
├── orders.ts      # Catalog, orders, checkout, order tracking
├── cart.ts        # Cart management (pure functions)
├── money.ts       # Price formatting (formatPrice)
├── types.ts       # TypeScript interfaces (generic UserInfo<E>)
└── index.ts       # Public API exports
```

### Key Implementation Details

**Token Storage**: localStorage with in-memory fallback
- Graceful handling of localStorage unavailability
- Automatic cleanup on expiration

**API Fetch Wrapper**: `apiFetch()`
- Automatic Bearer token attachment
- Content-Type header management
- No-Auth-Challenge header (suppresses browser Basic Auth popup)
- Error parsing and ApiError throwing

**Proactive Refresh**: Module-scoped timer
- Survives across calls
- Cleared on logout or explicit session clear
- 80% of TTL scheduling

## Building

```bash
# Build from monorepo root
npm run build -w packages/kit

# Or from package directory
cd packages/kit
npm run build
```

**Output**: `dist/` directory with compiled JavaScript and type declarations

## Testing

See [Testing Guide](../testing/guide.md) for integration test setup and execution.

```bash
# Run integration tests
npm test -w packages/kit

# With HTML report
npm test -w packages/kit && ./packages/kit/open-report.sh
```

**Test files**:
- `packages/kit/src/__tests__/integration/consents.test.ts`
- `packages/kit/src/__tests__/integration/payments.test.ts`
- `packages/kit/src/__tests__/integration/orders.test.ts`
- `packages/kit/src/__tests__/integration/cart.test.ts`

## Source Map

| File | Purpose |
|------|---------|
| `src/client.ts` | Token storage, `apiFetch`, URL validation |
| `src/auth.ts` | Authentication flows, proactive refresh, bearer delivery |
| `src/team.ts` | Team CRUD, member management, team switching |
| `src/invite.ts` | Invitation send, accept, activate, list |
| `src/password.ts` | Forgot password, reset password |
| `src/consents.ts` | Consents gating (`acceptConsents`) |
| `src/profile.ts` | Profile updates, user document updates, password change |
| `src/payments.ts` | Subscriptions, checkout, billing portal, seat licences |
| `src/orders.ts` | Catalog, orders, checkout, order tracking |
| `src/cart.ts` | Cart management (pure functions) |
| `src/money.ts` | Price formatting (`formatPrice`) |
| `src/types.ts` | TypeScript interfaces for all data structures |
| `src/index.ts` | Public API re-exports |

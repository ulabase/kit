---
type: Guide
title: Testing Guide
description: Testing guide for Ulabase Kit and CLI. Covers integration tests, kit unit tests, CLI unit tests, adapter unit tests, environment configuration, running tests, and writing new tests.
tags: [testing, integration, unit, vitest, guide]
sources:
  - id: openwiki-source-e7a0b8cb7be6a8386aa66fdb
    resource: repo://docs/ADAPTER_CONTRACT.md
  - id: openwiki-source-92450a7065eb85e0f30b5461
    resource: repo://packages/cli/package.json
  - id: openwiki-source-8bdaa310d96f188962daac0e
    resource: repo://packages/cli/src/__tests__/unit/admin.test.ts
  - id: openwiki-source-26c1f4520f822e9ae6ab9a1d
    resource: repo://packages/cli/src/__tests__/unit/env.test.ts
  - id: openwiki-source-342c2249f92e2ca7695bfc8a
    resource: repo://packages/cli/src/__tests__/unit/service.test.ts
  - id: openwiki-source-d8112324397071944e41ddcb
    resource: repo://packages/cli/src/__tests__/unit/session.test.ts
  - id: openwiki-source-f23f6013db8c2550129a8ee5
    resource: repo://packages/cli/src/__tests__/unit/setup.test.ts
  - id: openwiki-source-3736e25152650a4decd06697
    resource: repo://packages/cli/vitest.unit.config.ts
  - id: openwiki-source-46339ee0e97e6859bc5ea428
    resource: repo://packages/kit/package.json
  - id: openwiki-source-7a045df7165360917a5c3615
    resource: repo://packages/kit/src/__tests__/unit/cart.test.ts
  - id: openwiki-source-bc8947c7b01ad0de9e4423b7
    resource: repo://packages/kit/src/__tests__/unit/client.test.ts
  - id: openwiki-source-9f4235dd2715f5a55a0d1886
    resource: repo://packages/kit/src/__tests__/unit/money.test.ts
  - id: openwiki-source-8e84ec6588e149b9332902b1
    resource: repo://packages/kit/src/__tests__/unit/orders.test.ts
  - id: openwiki-source-42cff9bfe915d7b06dd5bd38
    resource: repo://packages/kit/src/__tests__/unit/payments.test.ts
  - id: openwiki-source-f5c174f35c5102ba81477e16
    resource: repo://packages/kit/vitest.unit.config.ts
generated: { by: "openwiki/0.6.1", at: "2026-10-01T10:51:10.399Z" }
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T10:51:10.399Z
---

# Testing Guide

This guide covers testing for Ulabase Kit and CLI: core integration tests, kit unit tests, CLI unit tests, and adapter unit tests.

## Overview

Ulabase Kit has four test tiers:

| Tier | What it tests | Backend needed | Runs on |
|------|---------------|----------------|---------|
| **Core integration** (`packages/kit`) | Auth flows, token lifecycle, teams, invites against live API | Ulabase instance + secrets | Tags (release), manual trigger |
| **Kit unit** (`packages/kit`) | Payments, orders, cart, client, money modules | None (mocks transport) | Every push and PR |
| **CLI unit** (`packages/cli`) | Setup runner logic, env ref resolution, session management, admin client operations | None (mocks admin and service clients) | Every push and PR |
| **Adapter unit** (`kit-react`, `kit-vue`, `kit-ng`) | Wiring: reactive state, guards, middleware, cookie bridge | None (mocks `@ulabase/kit`) | Every push and PR |

**Test Framework**: Vitest 4
**Adapter test contract**: [`docs/ADAPTER_CONTRACT.md`](repo://docs/ADAPTER_CONTRACT.md)

## Environment Setup

### 1. Create Environment File

Create `packages/kit/.env` (not committed):

```bash
ULABASE_TEST_API_URL=https://<your-instance>.ulabase.com
ULABASE_TEST_ADMIN_PASSWORD=<root-password>
```

**Variables**:
- `ULABASE_TEST_API_URL`: Your Ulabase service URL
- `ULABASE_TEST_ADMIN_PASSWORD`: Admin password for test data cleanup

### 2. Verify Configuration

```bash
cd packages/kit
npm test -- --reporter=verbose 2>&1 | head -20
```

## Running Tests

### Basic Test Run

```bash
# From monorepo root
npm test -w packages/kit

# From package directory
cd packages/kit
npm test
```

### With HTML Report

```bash
npm test -w packages/kit && ./packages/kit/open-report.sh
```

**Output**: `packages/kit/test-results/index.html`

### With JUnit XML (CI)

Tests automatically generate JUnit XML at `packages/kit/test-results/junit.xml`.

### Watch Mode

```bash
cd packages/kit
npx vitest --watch
```

### Run Specific Test File

```bash
cd packages/kit
npx vitest run src/__tests__/integration/auth.test.ts
```

### Run Tests Matching Pattern

```bash
cd packages/kit
npx vitest run -t "login"
```

## Test Architecture

### Global Setup

File: `packages/kit/src/__tests__/integration/global-setup.ts`

**Purpose**: Clean all test data before and after test suite

**What it cleans**:
1. All test users (`*@test.ulabase.dev`)
2. All test teams (created by test users)
3. All test invitations

**When it runs**:
- Before all test suites (setup)
- After all test suites (teardown)

### Test Isolation

Each test run uses unique identifiers:

```typescript
const runId = crypto.randomUUID().slice(0, 8);

export function testEmail(label: string): string {
  return `test-${runId}-${label}@test.ulabase.dev`;
}
```

**Benefits**:
- Parallel test runs don't conflict
- Easy to identify test data
- Clean separation between test runs

### Helper Utilities

File: `packages/kit/src/__tests__/integration/helpers.ts`

#### Configuration

```typescript
// Get test configuration from environment
getConfig(): AuthConfig

// Get admin password
getAdminPassword(): string
```

#### Test Data

```typescript
// Generate unique test email
testEmail('auth')  // Returns: test-<runId>-auth@test.ulabase.dev
```

#### Admin Access

```typescript
// Make authenticated request as admin
adminFetch(path: string, init?: RequestInit): Promise<Response>

// GET request as admin
adminGet<T>(path: string): Promise<T>
```

**Usage**: Tests use admin access to:
- Create/verify users directly
- Read verification tokens
- Clean up test data

#### Token Reading

```typescript
// Read verification token from invitation email
readVerificationToken(email: string): Promise<string>

// Read invitation token
readInvitationToken(email: string): Promise<string>
```

#### User Management

```typescript
// Delete user (cleanup)
deleteUser(email: string): Promise<void>
```

#### Cookie Jar (for cookie mode tests)

```typescript
// Install cookie jar for fetch
installCookieJar(): void

// Remove cookie jar
uninstallCookieJar(): void
```

## Test Files

### auth.test.ts

**Purpose**: Registration, login, email verification flows

**Tests**:
- Register creates new user
- CheckSession returns null before login
- Verify returns fragment delivery URL
- Verify with fragment delivery activates account
- Login stores token and returns user info
- CheckSession returns user after login
- Logout clears session

### team.test.ts

**Purpose**: Team switching and multi-team scenarios

**Tests**:
- GetTeams returns all memberships
- SwitchTeam changes active team
- SwitchTeam updates token claims
- Cookie mode team switching

### team-management.test.ts

**Purpose**: Team CRUD and member management

**Tests**:
- CreateTeam creates additional team
- UpdateTeam renames team
- DeleteTeam removes team
- ListTeamMembers returns members
- RemoveMember removes member from team
- UpdateMemberRole changes member role

### invite.test.ts

**Purpose**: Invitation flows

**Tests**:
- Invite sends invitation
- GetInvitation returns invitation details
- Activate sets password for new user
- AcceptInvite adds existing user to team
- ResendInvite resends expired invitation
- ListInvitations returns pending invitations

### password.test.ts

**Purpose**: Password reset flows

**Tests**:
- ForgotPassword sends reset email
- ResetPassword changes password and logs in

### consents.test.ts

**Purpose**: Consents gating (`acceptConsents`, ACL permission scoping)

**Tests**:
- Register with application fields succeeds (drops extras when no JSON Schema)
- `acceptConsents` records the server-stamped versions, not the ones the client sent
- `acceptConsents` renews the token (guard sees the updated claims)
- Consent history appends entries rather than overwriting
- Writing outside the `bson-request-whitelist` is rejected with 403

**Note**: This suite creates an ACL permission in `beforeAll` and waits 22 seconds for the server's ACL cache to refresh. The permission uses `bson-request-whitelist(consents)` and `mergeRequest` to stamp the accepted versions server-side.

### profile.test.ts

**Purpose**: Profile updates

**Tests**:
- UpdateProfile changes profile fields
- ChangePassword updates password

## Writing New Tests

### Test Structure

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { login, logout, clearToken } from '../../index';
import { getConfig, testEmail, deleteUser } from './helpers';

const config = getConfig();
const email = testEmail('my-test');
const password = 'Test-Password-99!';

beforeAll(async () => {
  // Setup: create test data
});

afterAll(async () => {
  // Cleanup: remove test data
  clearToken();
  try { await deleteUser(email); } catch { /* ignore */ }
});

describe('my feature', () => {
  it('does something', async () => {
    // Test implementation
  });
});
```

### Best Practices

#### 1. Use Unique Emails

```typescript
const email = testEmail('my-feature');
// Generates: test-<runId>-my-feature@test.ulabase.dev
```

#### 2. Clean Up After Tests

```typescript
afterAll(async () => {
  clearToken();
  try { await deleteUser(email); } catch { /* ignore */ }
});
```

#### 3. Test Both Bearer and Cookie Modes

```typescript
describe('login', () => {
  it('works in bearer mode', async () => {
    await login(config, email, password, 'bearer');
    expect(getToken()).toBeTruthy();
  });

  it('works in cookie mode', async () => {
    await login(config, email, password, 'cookie');
    expect(getToken()).toBeNull(); // Token in cookie, not localStorage
  });
});
```

#### 4. Verify Token Claims

```typescript
it('switches team and updates token claims', async () => {
  await switchTeam(config, teamId);
  const token = getToken()!;
  const payload = JSON.parse(atob(token.split('.')[1]));
  expect(payload.team._id.$oid).toBe(teamId.$oid);
});
```

#### 5. Test Error Cases

```typescript
it('throws on invalid credentials', async () => {
  await expect(login(config, email, 'wrong-password'))
    .rejects.toMatchObject({ status: 401 });
});
```

### Testing Cookie Mode

For cookie mode tests, use the cookie jar helpers:

```typescript
import { installCookieJar, uninstallCookieJar } from './helpers';

beforeAll(() => installCookieJar());
afterAll(() => uninstallCookieJar());

it('works with cookies', async () => {
  await login(config, email, password, 'cookie');
  // Cookie jar handles cookie storage
});
```

## Kit Unit Tests

Kit unit tests run without a backend, testing the core modules: payments, orders, cart, client, and money. They use a custom transport function to mock HTTP requests, making them fast and deterministic.

### Running Kit Unit Tests

```bash
# From monorepo root
npm run test:unit -w packages/kit

# From package directory
cd packages/kit
npm run test:unit
```

### Configuration

File: `packages/kit/vitest.unit.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

// Kept apart from vitest.config.ts on purpose: that one drives the integration
// suite, which needs a live service and the ULABASE_TEST_* secrets the release
// workflow provides. These run anywhere, with nothing configured.
export default defineConfig({
  test: {
    include: ['src/__tests__/unit/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
```

**Key Settings**:
- `include: ['src/__tests__/unit/**/*.test.ts']` — Runs only unit tests
- `environment: 'node'` — Runs in Node.js environment
- No backend or secrets required

### Test Files

#### payments.test.ts

**Purpose**: Payment operations including license grants, checkout sessions, billing portal, and subscription polling.

**Tests**:
- `grantLicense` resolves "granted" on 201
- `grantLicense` resolves "already-licensed" on 200
- `grantLicense` rejects with status 409 when no seat is available
- `grantLicense` rejects with status 404 when userId is not a member
- `createCheckoutSession` resolves the checkout url on 201
- `createCheckoutSession` rejects with status 409 for a team that already has an active subscription
- `openBillingPortal` rejects with status 402 for a team with no Stripe customer yet
- `waitForSubscription` resolves on the first check when the predicate is already true
- `waitForSubscription` polls at the given interval until the predicate becomes true
- `waitForSubscription` rejects with WaitTimeoutError when the condition never becomes true
- `waitForSubscription` rejects immediately when the signal is already aborted
- `waitForSubscription` rejects when the signal aborts while waiting between polls
- `getSubscription` performs a plain GET with the session already applied

#### orders.test.ts

**Purpose**: Order operations including catalog reading, order creation, order retrieval, and order status polling.

**Tests**:
- `getCatalog` reads the default "catalog" collection when none is given
- `getCatalog` reads the configured collection when the service renamed it
- `getCatalog` forwards pagination as pagesize/page query params
- `createOrder` posts to the default "orders" collection with items and no email for an authenticated buyer
- `createOrder` includes email for a guest checkout
- `createOrder` posts to the configured collection when the service renamed it
- `getOrder` reads by id with no query string when no secret is given
- `getOrder` appends the secret as a query param for a guest read
- `waitForOrder` resolves immediately when the order has already left pending_payment
- `waitForOrder` keeps polling while pending_payment, then resolves once the webhook lands
- `waitForOrder` rejects with WaitTimeoutError when timeout occurs
- `readOrderRef` reads the fragment — the placement that keeps the secret out of logs
- `readOrderRef` reads the query string too, for deployments that put it there
- `readOrderRef` prefers the fragment when a URL somehow carries both
- `readOrderRef` returns the id alone when only {ORDER_ID} was interpolated
- `readOrderRef` returns null when the placeholders were never configured
- `readOrderRef` decodes percent-encoded values
- `readOrderRef` returns null rather than throwing on a URL it cannot parse

#### cart.test.ts

**Purpose**: Cart operations including adding, removing, updating quantities, calculating totals, and localStorage persistence.

**Tests**:
- `addToCart` adds a line
- `addToCart` increases the line already holding the item instead of adding a second
- `addToCart` keeps a variant apart from its siblings
- `addToCart` does not modify the array it was given
- `addToCart` refuses to add less than one
- `addToCart` leaves out empty options rather than storing an empty object
- `setCartQuantity` sets it
- `setCartQuantity` removes the line at zero
- `removeFromCart` removes only the named line
- `cartTotals` counts units, not lines
- `cartTotals` sums minor units
- `cartTotals` answers eur for an empty cart
- `toOrderItems` leaves names, prices and pictures behind
- `toOrderItems` sends the chosen options
- `toOrderItems` omits metadata entirely for a line with no options
- Storage round-trips a cart
- Storage is empty when nothing was saved
- Storage drops a line that is not one, and keeps the rest
- Storage answers an empty cart for stored JSON that is not an array
- Storage keeps two apps on one origin apart
- Storage forgets on request
- Storage does not throw when storage refuses to write

#### client.test.ts

**Purpose**: Client operations including error handling, token claims, and API fetch behavior.

**Tests**:
- `onError` reports a non-2xx and still throws it to the caller
- `onError` reports a request that never reached the service as status 0
- `onError` stays quiet on success
- `onError` is optional — a config without it behaves as before
- Console logging on failure logs a non-2xx when nobody registered onError
- Console logging on failure stays quiet when a handler is listening
- `getTokenClaims` reads the subject, which is the user id
- `getTokenClaims` returns null with no token
- `getTokenClaims` returns null rather than throwing on a malformed token

#### money.test.ts

**Purpose**: Price formatting with proper currency handling.

**Tests**:
- `formatPrice` divides a 2-decimal currency by 100
- `formatPrice` does not divide a 0-decimal currency
- `formatPrice` divides a 3-decimal currency by 1000
- `formatPrice` accepts a lowercase currency code, as Stripe sends it

### Writing Kit Unit Tests

Kit unit tests use a custom transport function to mock HTTP requests:

```typescript
import { describe, it, expect } from 'vitest';
import { someFunction } from '../../index';
import type { AuthConfig } from '../../types';

const apiBaseUrl = 'https://x.ulabase.com';

describe('someFunction', () => {
  it('does something', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response(JSON.stringify({ /* mock response */ }), { status: 200 }),
    };
    
    const result = await someFunction(config);
    expect(result).toEqual(/* expected result */);
  });
});
```

**Key Patterns**:
- Use `transport` in `AuthConfig` to mock HTTP responses
- Use `vi.useFakeTimers()` for time-dependent tests (polling, timeouts)
- Use `vi.fn()` to track function calls
- Test both success and error cases
- Test edge cases (empty inputs, malformed data)

## CLI Unit Tests

CLI unit tests mock the admin and service clients, testing setup runner logic, env ref resolution, session management, and admin client operations. They run without a backend or secrets.

### Running CLI Unit Tests

```bash
# From monorepo root
npm run test:unit -w packages/cli

# From package directory
cd packages/cli
npm run test:unit
```

### Configuration

File: `packages/cli/vitest.unit.config.ts`

```typescript
import { defineConfig } from 'vitest/config';

// Everything here runs with no live service: the clients speak `fetch`, and a
// test supplies its own through `AuthConfig.transport`. That is the whole point
// of keeping the client layer isomorphic — see docs/ADAPTERS.md.
export default defineConfig({
  test: {
    include: ['src/__tests__/unit/**/*.test.ts'],
    globals: false,
    environment: 'node',
  },
});
```

**Key Settings**:
- `include: ['src/__tests__/unit/**/*.test.ts']` — Runs only unit tests
- `environment: 'node'` — Runs in Node.js environment
- No backend or secrets required
- CLI tests use the same transport mocking pattern as kit unit tests

### Test Files

#### admin.test.ts

**Purpose**: Admin client operations including plugin management, configuration, and environment variable resolution.

**Tests**:
- Admin client speaks to the endpoints the admin node exposes
- Admin client reads a plugin schema from `available`, so an uninstalled plugin still has one
- Admin client writes the redaction placeholder back untouched
- Admin client resolves a fromEnv marker into the request body and nowhere else
- Admin client fails naming the variable rather than sending undefined
- Admin client keeps its token out of localStorage and out of other clients

#### env.test.ts

**Purpose**: Environment variable reference resolution and validation.

**Tests**:
- `fromEnv` carries the name, not a value
- `fromEnv` resolves from the supplied environment, leaving everything else alone
- `fromEnv` does not mutate the setup it was given
- `fromEnv` names every missing variable at once, so a short pipeline learns all of them
- `fromEnv` treats a declared-but-empty variable as missing
- `fromEnv` refuses to be serialised unresolved

#### service.test.ts

**Purpose**: Service client operations including token management, collection/index operations, and document writes.

**Tests**:
- Service client mints a token once and reuses it
- Service client renews a token that is about to expire, without the caller knowing
- Service client shares one mint between calls that start together
- Service client answers a check with false on 404 and throws on anything else
- Service client finds an index in the collection listing
- Service client writes through the paths RESTHeart expects (documents use `?wm=upsert` to create on first write; collections and indexes omit it)
- Service client re-running a document write is not an error (idempotent upsert)
- Service client resolves `fromEnv` markers in service client bodies (e.g. user passwords)
- Service client fails naming the variable rather than writing an unresolved object

#### session.test.ts

**Purpose**: Session management including file storage, token resolution, and session clearing.

**Tests**:
- `sessionPath` lives under XDG_CONFIG_HOME when it is set
- `sessionPath` falls back to ~/.config
- `writeSession` round-trips
- `writeSession` is readable only by its owner
- `writeSession` tightens the mode of a file that already existed
- `readSession` reads a missing file as absent
- `readSession` reads a corrupt file as absent rather than throwing
- `readSession` reads a file missing either field as absent
- `resolveToken` is null when there is neither a variable nor a file
- `resolveToken` reads the stored session
- `resolveToken` lets the environment win over the stored session, always
- `resolveToken` ignores an empty variable, which is how an unset CI secret arrives
- `resolveToken` trims the variable, because a secret store pastes a trailing newline
- `clearSession` removes the file and says it did
- `clearSession` says so when there was nothing to remove

#### setup.test.ts

**Purpose**: Setup runner logic including step execution, dry runs, force mode, and progress reporting.

**Tests**:
- `runSetup` leaves a satisfied step alone
- `runSetup` applies an unsatisfied step and re-checks it
- `runSetup` reports an apply that silently did nothing as failed, not green
- `runSetup` waits for an apply whose effect the check cannot see yet
- `runSetup` waits out an init that takes seconds, not milliseconds
- `runSetup` applies a satisfied step when forced, and still verifies it
- `runSetup` forcing does not turn a broken step green
- `runSetup` stops the rest when a step fails, because configuration has dependencies
- `runSetup` a dry run answers what is missing, all of it, and writes nothing
- `runSetup` a dry run never resolves a fromEnv marker
- `runSetup` emits a step name and state, and nothing that could carry a secret
- `runSetup` reports a missing environment variable by name
- `runSetup` hands each step both clients and the service id
- A multi-step setup against a stateful target configures an empty target, then does nothing at all the second time
- A multi-step setup against a stateful target a dry run reports every outstanding step, not just the first

### Writing CLI Unit Tests

CLI unit tests use mock clients to test the setup runner and client operations. The admin and service test files use different mock patterns:

**admin.test.ts** uses a `stub` function that answers from a route table and records what it was asked:

```typescript
import { describe, it, expect } from 'vitest';
import { createAdminClient } from '../../admin.js';
import type { AdminClient } from '../../admin.js';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** A transport that answers from a table and records what it was asked. */
function stub(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const path = new URL(url).pathname;
    calls.push({
      url: path,
      method,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const key = `${method} ${path}`;
    const found = routes[key];
    if (found === undefined) {
      return new Response(JSON.stringify({ message: 'not stubbed' }), { status: 404 });
    }
    return new Response(JSON.stringify(found), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { calls, transport };
}

const base = 'https://api.ulabase.com';

describe('admin client', () => {
  it('speaks to the endpoints the admin node exposes', async () => {
    const { calls, transport } = stub({
      'GET /plugins': [{ _id: 'stripe' }],
      'POST /plugins-mgmt/ea820b/stripe/install': { success: true },
      'POST /plugins-mgmt/ea820b/stripe/init': { created: 3 },
      'DELETE /plugins-mgmt/ea820b/stripe': { success: true },
    });
    const admin = createAdminClient({ apiBaseUrl: base, transport });

    await admin.pluginCatalog();
    await admin.installPlugin('ea820b', 'stripe');
    await admin.initPlugin('ea820b', 'stripe', 'products');
    await admin.uninstallPlugin('ea820b', 'stripe');

    expect(calls.map(c => `${c.method} ${c.url}`)).toEqual([
      'GET /plugins',
      'POST /plugins-mgmt/ea820b/stripe/install',
      'POST /plugins-mgmt/ea820b/stripe/init',
      'DELETE /plugins-mgmt/ea820b/stripe',
    ]);
  });
});
```

**service.test.ts** uses a `harness` function that includes a `serviceToken` mock:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { createServiceClient } from '../../service.js';
import type { AdminClient } from '../../admin.js';

/** A JWT whose payload says when it expires. Only `exp` is ever read. */
function jwt(expiresInMs: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor((Date.now() + expiresInMs) / 1000) })
  ).toString('base64url');
  return `header.${payload}.signature`;
}

interface Call {
  path: string;
  method: string;
  auth: string | null;
  body: unknown;
}

function harness(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const transport = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    const u = new URL(url);
    const path = `${u.pathname}${u.search}`;
    calls.push({
      path,
      method,
      auth: new Headers(init?.headers).get('Authorization'),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const route = routes[`${method} ${path}`] ?? { status: 404, body: { message: 'not found' } };
    return new Response(route.body === undefined ? null : JSON.stringify(route.body), {
      status: route.status,
    });
  };

  const serviceToken = vi.fn(async () => ({
    token: jwt(15 * 60_000),
    url: 'https://c0ffee.ulabase.app',
    node: 'c0ffee.ulabase.app',
  }));

  const admin = { config: { apiBaseUrl: 'https://api.ulabase.com', transport }, serviceToken } as unknown as AdminClient;
  return { calls, admin, serviceToken };
}

describe('service client', () => {
  it('mints a token once and reuses it', async () => {
    const { admin, serviceToken, calls } = harness({
      'GET /catalog': { status: 200, body: { _id: 'catalog' } },
      'GET /orders': { status: 200, body: { _id: 'orders' } },
    });
    const service = createServiceClient(admin, 'ea820b');

    await service.collectionExists('catalog');
    await service.collectionExists('orders');

    expect(serviceToken).toHaveBeenCalledTimes(1);
    expect(calls.every(c => c.auth?.startsWith('Bearer '))).toBe(true);
  });
});
```

**Key Patterns**:
- Use a `stub` function (admin.test.ts) or `harness` function (service.test.ts) to mock HTTP responses and record calls
- Test both success and error cases
- Test edge cases (missing variables, corrupt data)
- Use `vi.fn()` to track function calls
- Use temporary directories for file system tests

## Adapter Unit Tests

Adapter tests mock `@ulabase/kit` and assert only the **wiring**: which core call fires, and how the reactive state (signals / context / refs) and framework glue (guards, middleware, cookies) react.

- Fast, deterministic, **no backend and no secrets**
- Run on every push and PR (the **Unit Tests** CI workflow)
- `kit-react` is the reference implementation

### Running Adapter Tests

```bash
npm run build   # adapters resolve @ulabase/kit from its built dist
npm test -w packages/kit-react -w packages/kit-vue -w packages/kit-ng
```

**Important**: The `npm run build` step is required because adapter tests mock `@ulabase/kit`, which must be built first. This ensures adapters test against the actual compiled code, not the TypeScript sources.

<!-- openwiki: broken internal link [/openwiki/contributing/development.md] link "/openwiki/contributing/development.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
**Note**: `kit-ng` uses Angular's experimental Vitest runner (requires Node ≥ 22.22.3, as specified in the [development guide](/openwiki/contributing/development.md)). The others use Vitest directly.

### Adapter Test Contract

All adapters implement the shared checklist in [`docs/ADAPTER_CONTRACT.md`](repo://docs/ADAPTER_CONTRACT.md). The contract covers five sections (A through E):

| Surface | Tests | Status |
|---------|-------|--------|
| **A. Reactive contract** (every SPA adapter) | Bootstrap, login, logout, switchTeam, updateProfile, acceptInvite, clearSession, hasMultipleTeams | ✅ all three |
| **B. Guards** (every SPA adapter) | authGuard unauthenticated/authenticated, publicGuard authenticated/unauthenticated | ✅ all three |
| **C. Token lifecycle** | 401 clears session (kit-ng interceptor) | ✅ kit-ng |
| **D. SSR extras** (next/nuxt subpaths) | Middleware refresh, protected paths, session routes, action token sinks, fragment bridge | ✅ D1–D9, D10 pending |
| **E. Payments** (every SPA adapter) | Bootstrap without/with payments, login, switchTeam, logout, clearSession, canManageBilling, checkout 409, waitForSubscription, updateProfile/acceptConsents | ✅ all three |

**Contract Sections**:
- **A. Reactive contract**: Tests the core reactive state management (user, teams, authentication state)
- **B. Guards**: Tests route protection (authGuard, publicGuard)
- **C. Token lifecycle**: Tests automatic session clearing on 401 responses (currently only kit-ng)
- **D. SSR extras**: Tests server-side rendering features (middleware, cookies, session routes) - D10 (fragment bridge) is pending
- **E. Payments**: Tests Stripe subscription management (reactive state only)

**Note**: Section E (Payments) is not applicable to SSR surfaces (`*/next` and `*/nuxt`) because they are session, cookie and middleware helpers that run before render and do not have reactive client state. Section C is only applicable to kit-ng as it uses an HTTP interceptor for token lifecycle management. Sections A and B are implemented for all SPA adapters (kit-react, kit-vue, kit-ng). Section D is only applicable to SSR surfaces (kit-react/next, kit-vue/nuxt).

### Payments Test Contract (Section E)

The payments test contract (E1–E10) covers the reactive client state for Stripe subscriptions. This section is implemented for all three SPA adapters:

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

**Implementation Notes**:
- E1–E6 test the reactive state lifecycle: when payments are enabled, subscription state is loaded/cleared alongside user and teams
- E7 tests role-based access control for billing management
- E8 tests error handling for duplicate checkout sessions
- E9 tests the polling mechanism for subscription activation
- E10 tests that profile/consent updates don't trigger unnecessary subscription reloads

**Rollout Status**: All three SPA adapters (kit-react, kit-vue, kit-ng) implement E1–E10. SSR surfaces (*/next, */nuxt) do not implement this section because they lack reactive client state.

### Test File Locations

| Adapter | SPA tests | SSR tests | Test runner |
|---------|-----------|-----------|-------------|
| `kit-react` | `src/__tests__/*.test.tsx` | `src/next/__tests__/*.test.ts` | Vitest |
| `kit-vue` | `src/__tests__/*.test.ts` | `src/nuxt/__tests__/*.test.ts` | Vitest |
| `kit-ng` | `src/*.spec.ts` | n/a | Angular Vitest runner |

## CI/CD Integration

### GitHub Actions

**Unit Tests** (adapter and CLI tests, every push/PR):
- Workflow: `.github/workflows/unit-tests.yml`
- Runs on every push to `main` and every pull request
- No secrets needed — adapters mock `@ulabase/kit`, CLI tests mock clients
- Scopes to `kit-react`, `kit-vue`, `kit-ng`, and `cli` (never `--workspaces`, which would also run kit's integration suite)

```yaml
# Runs: npm ci → npm run build → npm test -w packages/kit-react -w packages/kit-vue -w packages/kit-ng -w packages/cli
```

**Integration Tests** (core tests, gated):
- Workflow: `.github/workflows/integration-test.yml`
- Manual trigger or as part of the release pipeline
- Requires Ulabase instance and secrets

```yaml
name: Integration Tests

on:
  workflow_dispatch:  # Manual trigger

jobs:
  integration:
    runs-on: ubuntu-latest
    environment: integration-test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run build -w packages/kit
      - run: npm test -w packages/kit
        env:
          ULABASE_TEST_API_URL: ${{ secrets.ULABASE_TEST_API_URL }}
          ULABASE_TEST_ADMIN_PASSWORD: ${{ secrets.ULABASE_TEST_ADMIN_PASSWORD }}
```

### Test Results

- **HTML Report**: `packages/kit/test-results/index.html`
- **JUnit XML**: `packages/kit/test-results/junit.xml`
- **Upload**: Test results uploaded as artifacts in CI

## Debugging Tests

### Verbose Output

```bash
cd packages/kit
npx vitest run --reporter=verbose
```

### Debug in VS Code

Add to `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Tests",
      "runtimeExecutable": "${workspaceFolder}/node_modules/.bin/vitest",
      "args": ["run", "--reporter=verbose"],
      "console": "integratedTerminal",
      "env": {
        "ULABASE_TEST_API_URL": "https://your-instance.ulabase.com",
        "ULABASE_TEST_ADMIN_PASSWORD": "your-password"
      }
    }
  ]
}
```

### Check Test Data

```bash
# List test users
curl -u root:password https://your-instance.ulabase.com/users?filter='{"_id":{"$regex":"@test\\.ulabase\\.dev$"}}'

# List test teams
curl -u root:password https://your-instance.ulabase.com/teams?filter='{"createdBy":{"$regex":"@test\\.ulabase\\.dev"}}'
```

### Common Issues

**Issue**: Tests fail with "ULABASE_TEST_API_URL is not set"
**Solution**: Create `packages/kit/.env` with required variables

**Issue**: Tests fail with 401 on admin requests
**Solution**: Verify `ULABASE_TEST_ADMIN_PASSWORD` is correct

**Issue**: Tests fail with "user already exists"
**Solution**: Run global cleanup manually or wait for next test run

**Issue**: Token refresh tests fail
**Solution**: Check if Ulabase instance has token refresh enabled

## Test Configuration

### Vitest Config

File: `packages/kit/vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '.env') });

export default defineConfig({
  test: {
    include: ['src/__tests__/integration/**/*.test.ts'],
    globals: false,
    globalSetup: ['src/__tests__/integration/global-setup.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    sequence: { concurrent: false },
    typecheck: { tsconfig: './tsconfig.test.json' },
    reporters: [
      'verbose',
      ['junit', { outputFile: './test-results/junit.xml' }],
      ['html', { outputFile: './test-results/index.html' }]
    ],
  },
});
```

**Key Settings**:
- `testTimeout: 30_000` — 30 second timeout per test
- `hookTimeout: 30_000` — 30 second timeout for hooks
- `sequence: { concurrent: false }` — Tests run sequentially
- `globalSetup` — Runs cleanup before/after all tests

## Extending Tests

### Adding New Test File

1. Create file in `packages/kit/src/__tests__/integration/`
2. Name it `<feature>.test.ts`
3. Import helpers from `./helpers`
4. Use `testEmail()` for unique emails
5. Clean up in `afterAll()`

### Testing New API Endpoints

```typescript
import { apiFetch } from '../../client';

it('calls new endpoint', async () => {
  await login(config, email, password);
  const res = await apiFetch(config, '/new-endpoint');
  expect(res.ok).toBe(true);
});
```

### Testing Error Scenarios

```typescript
it('handles validation errors', async () => {
  try {
    await someOperation(config, invalidData);
    expect.fail('Should have thrown');
  } catch (error) {
    expect(error.status).toBe(400);
    expect(error.message).toContain('validation');
  }
});
```

## Performance Considerations

### Test Execution Time

- Average test suite: ~30-60 seconds
- Individual test: ~1-5 seconds
- Bottleneck: API calls to Ulabase

### Optimization Tips

1. **Minimize API calls**: Use admin access for setup
2. **Reuse test data**: Create once, test multiple scenarios
3. **Parallel execution**: Currently disabled (sequential)
4. **Local Ulabase**: Use local instance for faster tests

### Current Limitations

- **Sequential execution**: Integration tests run sequentially (no parallel execution)
- **API bottleneck**: Integration test performance limited by API calls to Ulabase
- **No mock mode**: Integration tests require a live Ulabase instance

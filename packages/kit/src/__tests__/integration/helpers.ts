import type { AuthConfig } from '../../types';

// ── Config ──────────────────────────────────────────────────────────────────

export function getConfig(): AuthConfig {
  const apiBaseUrl = process.env['ULABASE_TEST_API_URL'];
  if (!apiBaseUrl) throw new Error('ULABASE_TEST_API_URL is not set');
  return { apiBaseUrl };
}

export function getAdminPassword(): string {
  const password = process.env['ULABASE_TEST_ADMIN_PASSWORD'];
  if (!password) throw new Error('ULABASE_TEST_ADMIN_PASSWORD is not set');
  return password;
}

// ── Test-data isolation ──────────────────────────────────────────────────────

const runId = crypto.randomUUID().slice(0, 8);

export function testEmail(label: string): string {
  return `test-${runId}-${label}@test.ulabase.dev`;
}

// ── Admin fetch (Basic Auth, no cookie jar) ──────────────────────────────────

const _originalFetch = globalThis.fetch.bind(globalThis);

export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const { apiBaseUrl } = getConfig();
  const credentials = Buffer.from(`root:${getAdminPassword()}`).toString('base64');
  const headers = new Headers({ Authorization: `Basic ${credentials}` });
  const method = init?.method?.toUpperCase() ?? 'GET';
  // Only set Content-Type on requests that have a body
  if (init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  // Merge any additional headers from init
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((v, k) => headers.set(k, v));
  }
  return _originalFetch(`${apiBaseUrl}${path}`, {
    ...init,
    method,
    headers,
  });
}

export async function adminGet<T>(path: string): Promise<T> {
  const res = await adminFetch(path);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`adminFetch GET ${path} → ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

// ── Token readers ─────────────────────────────────────────────────────────────

export async function readVerificationToken(email: string): Promise<string> {
  const doc = await adminGet<Record<string, unknown>>(`/users/${encodeURIComponent(email)}`);
  const token = doc['emailVerificationToken'];
  if (!token) throw new Error(`emailVerificationToken not found for ${email}. Doc keys: ${Object.keys(doc).join(', ')}`);
  return token as string;
}

/**
 * Complete the email verification of a freshly registered user.
 *
 * `GET /auth/verify` verifies the token, promotes the account, and then 302s to
 * the service's `frontend-app-url` — an address that belongs to the application,
 * not to this suite, and that nothing is listening on while the tests run.
 * Node's fetch follows redirects by default, so without `redirect: 'manual'` a
 * verification that succeeded server-side still fails the hook with
 * `ECONNREFUSED` against whatever that URL points at.
 */
export async function verifyEmail(email: string): Promise<void> {
  const token = await readVerificationToken(email);
  const { apiBaseUrl } = getConfig();
  const url = `${apiBaseUrl}/auth/verify?email=${encodeURIComponent(email)}&token=${token}&delivery=cookie`;
  const res = await fetch(url, { redirect: 'manual' });
  if (res.status >= 400) {
    throw new Error(`verification failed for ${email} → ${res.status}: ${await res.text()}`);
  }
}

export async function readInvitationToken(email: string): Promise<string> {
  const filter = encodeURIComponent(JSON.stringify({ email }));
  const docs   = await adminGet<Array<Record<string, unknown>>>(`/auth_invitations?filter=${filter}&pagesize=1`);
  const token  = docs[0]?.['token'];
  if (!token) throw new Error(`invitation token not found for ${email}`);
  return token as string;
}

export async function readPasswordResetToken(email: string): Promise<string> {
  const doc = await adminGet<Record<string, unknown>>(`/users/${encodeURIComponent(email)}`);
  const token = doc['emailPasswordResetToken'] ?? doc['passwordResetToken'];
  if (!token) throw new Error(`password reset token not found for ${email}. Doc keys: ${Object.keys(doc).join(', ')}`);
  return token as string;
}

// ── Cookie jar (Node's fetch has no automatic cookie store) ──────────────────
//
// Browsers manage cookies transparently across requests. Node's global fetch
// (undici) does not: `credentials: 'include'` only controls whether cookies
// *would* be sent, but there is no persistent, browser-like cookie store to
// send them from — each `fetch()` call is independent. To exercise
// cookie-mode auth end-to-end (e.g. login via /token/cookie followed by an
// authenticated request) in this Node/vitest environment, install this tiny
// jar around `globalThis.fetch` for the duration of a test.
//
// `adminFetch` above is unaffected: it captured the original `fetch` at
// module load time, before any jar is installed.

let jar: string[] = [];
let realFetch: typeof fetch | null = null;

export function installCookieJar(): void {
  if (realFetch) return; // already installed
  realFetch = globalThis.fetch;
  jar = [];
  const captured = realFetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (jar.length > 0) headers.set('Cookie', jar.join('; '));
    const res = await captured(input, { ...init, headers });
    const setCookies = typeof res.headers.getSetCookie === 'function'
      ? res.headers.getSetCookie()
      : [];
    for (const setCookie of setCookies) {
      const pair = setCookie.split(';')[0]?.trim();
      if (!pair) continue;
      const name = pair.split('=')[0];
      jar = jar.filter(c => !c.startsWith(`${name}=`));
      jar.push(pair);
    }
    return res;
  }) as typeof fetch;
}

export function uninstallCookieJar(): void {
  if (realFetch) {
    globalThis.fetch = realFetch;
    realFetch = null;
  }
  jar = [];
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

export async function deleteUser(email: string): Promise<void> {
  await adminFetch(`/users/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

export async function cleanupTestUsers(): Promise<void> {
  const filter = encodeURIComponent(JSON.stringify({ _id: { $regex: '@test\\.ulabase\\.dev$' } }));
  await adminFetch(`/users/*?filter=${filter}`, { method: 'DELETE' });
  await adminFetch(`/auth_invitations/*?filter=${filter}`, { method: 'DELETE' });
}

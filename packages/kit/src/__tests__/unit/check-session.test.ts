import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSession, clearToken, getToken, setToken } from '../../index';
import type { AuthConfig } from '../../types';

const apiBaseUrl = 'https://x.restheart.com';

/** A JWT with the given payload. Unsigned — nothing here verifies it. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const inAnHour = Math.floor(Date.now() / 1000) + 3600;
const me = { _id: 'a@example.com', roles: ['user'] };

/** A transport that answers 429, without a readable Retry-After, `limited` times, then the user. */
function rateLimitedFor(limited: number) {
  let calls = 0;
  const transport = vi.fn(async () => {
    calls++;
    return calls <= limited
      ? new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 })
      : new Response(JSON.stringify(me), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return transport;
}

afterEach(() => {
  vi.useRealTimers();
  clearToken();
});

describe('checkSession and the rate limit', () => {
  it('outlasts a minute of 429 without Retry-After, and keeps the session', async () => {
    vi.useFakeTimers();
    setToken(jwt({ sub: me._id, exp: inAnHour }));
    const transport = rateLimitedFor(3);
    const config: AuthConfig = { apiBaseUrl, transport };

    const pending = checkSession(config);
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(pending).resolves.toMatchObject({ _id: me._id });
    expect(transport).toHaveBeenCalledTimes(4);
    expect(getToken()).not.toBeNull();
  });

  it('throws after four 429, and still keeps the token', async () => {
    vi.useFakeTimers();
    setToken(jwt({ sub: me._id, exp: inAnHour }));
    const config: AuthConfig = { apiBaseUrl, transport: rateLimitedFor(10) };

    const pending = checkSession(config);
    const outcome = expect(pending).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(60_000);
    await outcome;

    expect(getToken()).not.toBeNull();
  });
});

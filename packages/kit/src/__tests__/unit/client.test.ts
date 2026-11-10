import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, clearToken, getTokenClaims, setToken } from '../../index';
import type { ApiError, AuthConfig } from '../../types';

const apiBaseUrl = 'https://x.restheart.com';

/** A JWT with the given payload. Unsigned — nothing here verifies it. */
function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
}

const inAnHour = Math.floor(Date.now() / 1000) + 3600;

afterEach(() => {
  clearToken();
});

describe('onError', () => {
  it('E1 reports a non-2xx and still throws it to the caller', async () => {
    const onError = vi.fn();
    const config: AuthConfig = {
      apiBaseUrl,
      onError,
      transport: async () =>
        new Response(JSON.stringify({ message: 'You must accept the terms' }), { status: 451 }),
    };

    await expect(apiFetch(config, '/demo')).rejects.toMatchObject({ status: 451 });

    expect(onError).toHaveBeenCalledTimes(1);
    const err = onError.mock.calls[0][0] as ApiError;
    expect(err.status).toBe(451);
    // The message comes from the body, not the status text — that is what makes
    // it worth surfacing.
    expect(err.message).toBe('You must accept the terms');
  });

  it('E2 reports a request that never reached the service as status 0', async () => {
    const onError = vi.fn();
    const config: AuthConfig = {
      apiBaseUrl,
      onError,
      transport: async () => {
        throw new TypeError('Failed to fetch');
      },
    };

    // An offline user is not a signed-out user; status 0 is how they are told
    // apart.
    await expect(apiFetch(config, '/demo')).rejects.toMatchObject({
      status: 0,
      message: 'Failed to fetch',
    });
    expect(onError).toHaveBeenCalledWith({ status: 0, message: 'Failed to fetch' });
  });

  it('E3 stays quiet on success', async () => {
    const onError = vi.fn();
    const config: AuthConfig = {
      apiBaseUrl,
      onError,
      transport: async () => new Response('{}', { status: 200 }),
    };

    await apiFetch(config, '/demo');
    expect(onError).not.toHaveBeenCalled();
  });

  it('E4 is optional — a config without it behaves as before', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response('{}', { status: 500 }),
    };
    await expect(apiFetch(config, '/demo')).rejects.toMatchObject({ status: 500 });
  });
});

describe('console logging on failure', () => {
  it('E4 logs a non-2xx when nobody registered onError', async () => {
    // In a browser with no handler this line is often the only trace a failed
    // call leaves, and it is worth having.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const config: AuthConfig = {
      apiBaseUrl,
      transport: async () => new Response('{}', { status: 500 }),
    };

    await expect(apiFetch(config, '/demo')).rejects.toMatchObject({ status: 500 });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain('[apiFetch]');
    spy.mockRestore();
  });

  it('E5 stays quiet when a handler is listening', async () => {
    // A caller with an onError has said it is watching, and a second report is
    // noise: in a CLI it lands on stderr right before the sentence the tool
    // wrote for the user, and in CI it puts full URLs in the log. Nothing is
    // lost — onError observes rather than swallows, and the error still throws.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onError = vi.fn();
    const config: AuthConfig = {
      apiBaseUrl,
      onError,
      transport: async () => new Response('{}', { status: 500 }),
    };

    await expect(apiFetch(config, '/demo')).rejects.toMatchObject({ status: 500 });

    expect(spy).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('E6 carries a string code, so an app branches on it and not on the wording', async () => {
    const config: AuthConfig = {
      apiBaseUrl,
      onError: () => {},
      transport: async () =>
        new Response(JSON.stringify({ code: 'resend-cap', message: 'This invitation has been sent the most times allowed.' }), { status: 403 }),
    };

    await expect(apiFetch(config, '/auth/resend-invite')).rejects.toMatchObject({
      status: 403,
      code: 'resend-cap',
      message: 'This invitation has been sent the most times allowed.',
    });
  });

  it('E7 leaves out a numeric code, which names nothing', async () => {
    // RESTHeart's own errors say { message, code: 409 }: not a reason an app can branch on
    const config: AuthConfig = {
      apiBaseUrl,
      onError: () => {},
      transport: async () => new Response(JSON.stringify({ message: 'Email already registered', code: 409 }), { status: 409 }),
    };

    const err = await apiFetch(config, '/auth/register').catch((e: unknown) => e as Record<string, unknown>);
    expect(err).toMatchObject({ status: 409, message: 'Email already registered' });
    expect(err).not.toHaveProperty('code');
  });
});

describe('getTokenClaims', () => {
  it('C1 reads the subject, which is the user id', () => {
    setToken(jwt({ sub: 'someone@example.com', exp: inAnHour }));
    expect(getTokenClaims()?.['sub']).toBe('someone@example.com');
  });

  it('C2 returns null with no token', () => {
    expect(getTokenClaims()).toBeNull();
  });

  it('C3 returns null rather than throwing on a malformed token', () => {
    setToken('not-a-jwt');
    expect(getTokenClaims()).toBeNull();
  });
});

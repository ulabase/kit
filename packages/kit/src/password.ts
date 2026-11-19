import type { AuthConfig, LoginMode } from './types.js';
import { apiFetch } from './client.js';
import { applyBearerDelivery } from './auth.js';

/**
 * Asks for a password reset email. The answer is the same whether the email has an account
 * or not.
 *
 * @param locale Optional. The language of the email, a code of 2 to 5 letters such as
 *               `'it'`. The service uses it only when the recipient has no locale of their
 *               own, and falls back to its default without it. Needs RESTHeart 9.17.1.
 */
export async function forgotPassword(config: AuthConfig, email: string, locale?: string): Promise<void> {
  await apiFetch(config, '/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(locale ? { email, locale } : { email }),
  });
}

/**
 * Apply a new password using a reset token.
 *
 * Uses the `delivery` query parameter to control token delivery:
 * - bearer (default): delivery=body — token returned in the response JSON body
 * - cookie: delivery=cookie — backend sets HttpOnly JWT cookie, no token in body
 *
 * Returns the fresh bearer token (bearer mode), or `null` (cookie mode), so a
 * server action can write it into a response cookie.
 */
export async function resetPassword(
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  mode: LoginMode = 'bearer'
): Promise<string | null> {
  const delivery = mode === 'bearer' ? 'body' : 'cookie';
  const res = await apiFetch(config, `/auth/reset-password?delivery=${delivery}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (mode === 'bearer') {
    return applyBearerDelivery(config, res);
  }
  // Cookie mode: backend already set the JWT cookie, nothing to do
  return null;
}

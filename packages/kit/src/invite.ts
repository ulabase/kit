import type { AuthConfig, Invitation, LoginMode, PendingInvitation } from './types.js';
import { apiFetch } from './client.js';
import { applyBearerDelivery } from './auth.js';

/**
 * Invites an email to the caller's team.
 *
 * @param locale Optional. The language of the invitation email, a code of 2 to 5 letters
 *               such as `'it'`. For an email with no account it is also stored on the user
 *               the invitation creates. For an existing user it counts only when they have
 *               no locale of their own. Needs RESTHeart 9.17.1.
 */
export async function invite(
  config: AuthConfig,
  email: string,
  role: 'owner' | 'member',
  locale?: string
): Promise<void> {
  await apiFetch(config, '/auth/invite', {
    method: 'POST',
    body: JSON.stringify(locale ? { email, role, locale } : { email, role }),
  });
}

export async function getInvitation(
  config: AuthConfig,
  email: string,
  token: string
): Promise<Invitation> {
  const res = await apiFetch(
    config,
    `/auth/invitation?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`
  );
  return res.json() as Promise<Invitation>;
}

/**
 * Activate account for a newly invited user (sets password, auto-logs in).
 *
 * Uses the `delivery` query parameter to control token delivery:
 * - bearer (default): delivery=body — token returned in the response JSON body
 * - cookie: delivery=cookie — backend sets HttpOnly JWT cookie, no token in body
 *
 * Returns the fresh bearer token (bearer mode), or `null` (cookie mode), so a
 * server action can write it into a response cookie.
 */
export async function activate(
  config: AuthConfig,
  payload: { email: string; token: string; password: string },
  mode: LoginMode = 'bearer'
): Promise<string | null> {
  const delivery = mode === 'bearer' ? 'body' : 'cookie';
  const res = await apiFetch(config, `/auth/activate?delivery=${delivery}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });

  if (mode === 'bearer') {
    return applyBearerDelivery(config, res);
  }
  // Cookie mode: backend already set the JWT cookie, nothing to do
  return null;
}

export async function acceptInvite(config: AuthConfig, token: string): Promise<void> {
  await apiFetch(config, '/auth/accept-invite', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Sends a pending invitation again, with a new token.
 *
 * @param locale Optional. The language of the email, a code of 2 to 5 letters such as
 *               `'it'`. The service uses it only when the recipient has no locale of their
 *               own, and falls back to its default without it. Needs RESTHeart 9.17.1.
 */
export async function resendInvite(config: AuthConfig, email: string, locale?: string): Promise<void> {
  await apiFetch(config, '/auth/resend-invite', {
    method: 'POST',
    body: JSON.stringify(locale ? { email, locale } : { email }),
  });
}

/** Lists pending (non-expired) invitations for the caller's active team. Owner/admin only. */
export async function listInvitations(config: AuthConfig): Promise<PendingInvitation[]> {
  const res = await apiFetch(config, '/auth/invitations');
  return res.json() as Promise<PendingInvitation[]>;
}

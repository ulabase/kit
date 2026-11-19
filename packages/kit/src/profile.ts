import type { AuthConfig } from './types.js';
import { apiFetch } from './client.js';

/**
 * Updates the caller's own profile fields. restheart#646.
 *
 * `locale` is the language the user wants the emails in, a code of 2 to 5 letters such as
 * `'it'`: the user's own choice, which replaces the one a registration or an invitation made
 * for them. Needs RESTHeart 9.17.1: before, a body with only `locale` is refused with `400`.
 */
export async function updateProfile(
  config: AuthConfig,
  updates: { firstName?: string; lastName?: string; locale?: string }
): Promise<void> {
  await apiFetch(config, '/auth/profile', { method: 'PATCH', body: JSON.stringify(updates) });
}

/**
 * Update a user document via `PATCH /users/{email}`.
 *
 * Unlike {@link updateProfile} (which goes through `/auth/profile` and is
 * limited to `firstName` / `lastName`), this function targets the generic
 * MongoDB resource, where the application's ACL permission decides what fields
 * are writable — typically scoped with `bson-request-whitelist`.
 *
 * Nothing authorizes this request out of the box. `restheart-accounts` only
 * installs a veto that denies self-service writes to `roles`, `password`,
 * `team`/`teams` and the other account-management fields; granting the rest is
 * the application's own ACL to do.
 *
 * ```ts
 * await updateUser(config, email, { preferences: { theme: 'dark' } });
 * ```
 *
 * **Important:** when no JSON Schema is configured on the users collection the
 * server silently drops unrecognised properties.
 *
 * For consents specifically, prefer `acceptConsents` — the same request plus
 * the token renewal without which the guard keeps blocking the user.
 *
 * @param email  The user's email (the `_id` field in the users collection).
 * @param updates  Partial document to merge into the user document.
 */
export async function updateUser(
  config: AuthConfig,
  email: string,
  updates: Record<string, unknown>
): Promise<void> {
  await apiFetch(config, `/users/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
}

/** Changes the caller's password (current password required, no email round-trip). restheart#647. */
export async function changePassword(
  config: AuthConfig,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  await apiFetch(config, '/auth/change-password', { method: 'PATCH', body: JSON.stringify({ currentPassword, newPassword }) });
}

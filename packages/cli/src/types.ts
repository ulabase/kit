/**
 * The placeholder the server substitutes for every `format: password` field of a
 * plugin's configuration when it is read back.
 *
 * Eight bullets, always — the width is fixed because a secret's length is itself
 * a leak. `PATCH .../config` replaces the *whole* config document and restores
 * the stored value for any field still holding this exact string, which is what
 * makes read-modify-write safe.
 *
 * It is exported so a caller can *recognise* one. Nothing in this package ever
 * produces one, and nothing interprets one: a helper that stripped
 * "empty-looking" fields, or diffed before writing, would put bullets where the
 * tenant's real Stripe key used to be.
 *
 * Mirrors `PluginSecretsRedactor.REDACTED` on the server.
 */
export const REDACTED = '••••••••';

/** True when `value` is the server's redaction placeholder. */
export function isRedacted(value: unknown): boolean {
  return value === REDACTED;
}

/** A feature's configuration document, as stored and as sent back. */
export type FeatureConfig = Record<string, unknown>;

/** @deprecated Use {@link FeatureConfig}. */
export type PluginConfig = FeatureConfig;

/**
 * A JSON Schema, as the marketplace catalog carries it.
 *
 * Deliberately loose: this package reads a schema, it does not implement one.
 * The only node it interprets is `format: 'password'`, which is how the server
 * decides what to redact, and therefore how a caller can tell which fields it
 * must never fabricate a value for.
 */
export interface ConfigSchema {
  type?: string;
  properties?: Record<string, ConfigSchema>;
  required?: string[];
  format?: string;
  [key: string]: unknown;
}

/** An entry of the marketplace catalog — the `plugins` collection on the admin node. */
export interface CatalogFeature {
  _id: string;
  name?: string;
  description?: string;
  config_schema?: ConfigSchema;
  [key: string]: unknown;
}

/** A feature as installed on a service, from the service's own configuration document. */
export interface InstalledFeature {
  plugin_id: string;
  status?: string;
  enabled?: boolean;
  installed_at?: unknown;
  config?: FeatureConfig;
  [key: string]: unknown;
}

/** The body of `GET /plugins-mgmt/{srvId}`. */
export interface ServiceFeatures {
  service_id: string;
  installed: InstalledFeature[];
  available: CatalogFeature[];
}

/** @deprecated Use {@link CatalogFeature}. */
export type CatalogPlugin = CatalogFeature;
/** @deprecated Use {@link InstalledFeature}. */
export type InstalledPlugin = InstalledFeature;
/** @deprecated Use {@link ServiceFeatures}. */
export type ServicePlugins = ServiceFeatures;

/** The body of `GET /srvs-mgmt/{srvId}/jwt`. */
export interface ServiceToken {
  /** A service-admin JWT. Valid fifteen minutes, or 480 for a dedicated service. */
  token: string;
  /** The service's base URL — `https://{srvId}.ulabase.app`. */
  url: string;
  /** The bare hostname of the node the service runs on. */
  node: string;
}

/** What the mutating admin endpoints answer with. */
export interface MutationResult {
  success: boolean;
  message?: string;
  [key: string]: unknown;
}

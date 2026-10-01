import { apiFetch, login } from '@ulabase/kit';
import type { AuthConfig, UserInfo } from '@ulabase/kit';
import { resolveEnvRefs, defaultEnv, type EnvSource } from './env.js';
import type {
  CatalogFeature,
  ConfigSchema,
  FeatureConfig,
  MutationResult,
  ServiceFeatures,
  ServiceToken,
} from './types.js';

/** What `createAdminClient` needs on top of the core's `AuthConfig`. */
export interface AdminClientConfig extends Omit<AuthConfig, 'getToken' | 'setToken'> {
  /**
   * Where `fromEnv` markers are resolved from. Defaults to the ambient
   * environment; a test supplies its own, which is why the client layer never
   * reads `process.env` directly.
   */
  env?: EnvSource;
}

export interface AdminClient {
  /** Authenticate as the Ulabase account. Must precede every other call. */
  login(email: string, password: string): Promise<UserInfo>;

  /**
   * Authenticate with a personal access token instead — what the `ulabase` CLI does.
   *
   * No round trip: a token *is* the credential, where an email and a password
   * are only the means of getting one. Nothing is verified here; call
   * {@link verifyToken} for that.
   */
  useToken(token: string): void;

  /**
   * A cheap authenticated read, to find out whether the current credential
   * works before doing anything that matters.
   *
   * `GET /plugins` on purpose: it is the least a `cli` token is granted, so a
   * token that fails here fails at everything, and one that passes has cleared
   * both the authenticator and the ACL rather than only the first of the two.
   */
  verifyToken(): Promise<void>;

  /** The marketplace catalog — `GET /plugins`. Includes each feature's `config_schema`. */
  featureCatalog(): Promise<CatalogFeature[]>;

  /** Installed *and* available features for a service — `GET /plugins-mgmt/{srvId}`. */
  listFeatures(srvId: string): Promise<ServiceFeatures>;

  /** Whether `featureId` is installed and not uninstalled. The check `installFeature` needs. */
  isFeatureInstalled(srvId: string, featureId: string): Promise<boolean>;

  /**
   * A feature's `config_schema`, or `null` when the catalog does not carry one.
   *
   * Reachable for an *uninstalled* feature too, because `GET /plugins-mgmt/{srvId}`
   * returns the whole catalog under `available` — which is what lets a setup be
   * validated before a run rather than four steps into it.
   */
  configSchema(srvId: string, featureId: string): Promise<ConfigSchema | null>;

  /** A feature's stored configuration, with its secrets replaced by {@link REDACTED}. */
  getFeatureConfig(srvId: string, featureId: string): Promise<FeatureConfig>;

  /**
   * Replace a feature's configuration.
   *
   * The server replaces the *whole* document and restores the stored value for
   * any field still holding the redaction placeholder, so passing back what
   * `getFeatureConfig` returned — placeholders untouched — leaves the tenant's
   * secrets intact.
   *
   * This is where `fromEnv` markers become values: resolved into a copy while
   * the body is serialised, and nowhere else.
   */
  updateFeatureConfig(srvId: string, featureId: string, config: FeatureConfig): Promise<MutationResult>;

  /**
   * Install a feature. The server builds the initial configuration itself and
   * ignores any body, so configuring one is a second step — `updateFeatureConfig`.
   *
   * Free features only: a paid one answers `400` and points at `/purchase`, which
   * moves money and is deliberately out of this package's reach.
   */
  installFeature(srvId: string, featureId: string): Promise<MutationResult>;
  uninstallFeature(srvId: string, featureId: string): Promise<MutationResult>;
  enableFeature(srvId: string, featureId: string): Promise<MutationResult>;
  disableFeature(srvId: string, featureId: string): Promise<MutationResult>;

  /** Run a feature's own initialisation — stripe's collections, indexes and products. */
  initFeature(srvId: string, featureId: string, mode?: string): Promise<Record<string, unknown>>;

  /** Validate a stored configuration against the real provider. */
  testFeature(srvId: string, featureId: string): Promise<MutationResult>;

  /** @deprecated Use {@link featureCatalog}. */
  pluginCatalog(): Promise<CatalogFeature[]>;
  /** @deprecated Use {@link listFeatures}. */
  listPlugins(srvId: string): Promise<ServiceFeatures>;
  /** @deprecated Use {@link isFeatureInstalled}. */
  isPluginInstalled(srvId: string, featureId: string): Promise<boolean>;
  /** @deprecated Use {@link getFeatureConfig}. */
  getPluginConfig(srvId: string, featureId: string): Promise<FeatureConfig>;
  /** @deprecated Use {@link updateFeatureConfig}. */
  updatePluginConfig(srvId: string, featureId: string, config: FeatureConfig): Promise<MutationResult>;
  /** @deprecated Use {@link installFeature}. */
  installPlugin(srvId: string, featureId: string): Promise<MutationResult>;
  /** @deprecated Use {@link uninstallFeature}. */
  uninstallPlugin(srvId: string, featureId: string): Promise<MutationResult>;
  /** @deprecated Use {@link enableFeature}. */
  enablePlugin(srvId: string, featureId: string): Promise<MutationResult>;
  /** @deprecated Use {@link disableFeature}. */
  disablePlugin(srvId: string, featureId: string): Promise<MutationResult>;
  /** @deprecated Use {@link initFeature}. */
  initPlugin(srvId: string, featureId: string, mode?: string): Promise<Record<string, unknown>>;
  /** @deprecated Use {@link testFeature}. */
  testPlugin(srvId: string, featureId: string): Promise<MutationResult>;

  /** A service-admin JWT and the service's URL — `GET /srvs-mgmt/{srvId}/jwt`. */
  serviceToken(srvId: string): Promise<ServiceToken>;

  /**
   * An escape hatch for what the methods above do not cover — the same one
   * {@link ServiceClient.fetch} is, on the other side.
   *
   * The admin node has endpoints this client has no reason to wrap one at a
   * time: `/auth-config/{srvId}`, for instance, which is what sets a service's
   * JWT claims. Path is admin-node-relative, and the response is whatever the
   * node returned — a non-2xx throws an `ApiError`, like everything else here.
   *
   * Note that not every admin endpoint is reachable with a personal access
   * token: most are gated on the `cli` role by an ACL document. The ones that
   * authorise on *owning the service* rather than on a role — `/srvs-mgmt/…/jwt`
   * and `/auth-config/…` — are, which is what makes them usable from a setup.
   */
  fetch(path: string, init?: RequestInit): Promise<Response>;

  /** The `AuthConfig` this client speaks through. The service client derives from it. */
  readonly config: AuthConfig;
  /** Where this client resolves `fromEnv` markers from. */
  readonly env: EnvSource;
}

/**
 * A client over the admin node, `api.ulabase.com`.
 *
 * Runs in Node, not in a browser, and not by accident: the admin node's
 * `originVetoer` allows a missing `Origin` header and whitelists only
 * `ulabase.com`, so a page served from a developer's own origin is
 * vetoed. See `docs/ADAPTERS.md`.
 */
export function createAdminClient(config: AdminClientConfig): AdminClient {
  // `AuthConfig`'s token store defaults to `localStorage`, which does not exist
  // in Node — `login` would throw on persisting and `apiFetch` would read
  // nothing back. These are the hooks the core already has for exactly this
  // (the server runtimes use them to read a cookie), and the token lives in
  // this closure rather than a module global so two clients in one process
  // cannot overwrite each other's session.
  let token: string | null = null;

  const { env: envSource, ...authConfig } = config;
  const env = envSource ?? defaultEnv();

  const cfg: AuthConfig = {
    // Silences the core's `[apiFetch] … → 401` on stderr: this package reports
    // failures itself, in sentences, and a raw line immediately before one of
    // them is noise — worse in CI, where it puts full URLs in the log. A caller
    // that supplies its own handler keeps it; `onError` observes rather than
    // swallows, so no error is lost by taking this seam.
    onError: () => {},
    ...authConfig,
    getToken: () => token,
    setToken: (t: string) => {
      token = t;
    },
  };

  const json = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const res = await apiFetch(cfg, path, init);
    return (await res.json()) as T;
  };

  const post = <T = MutationResult>(path: string, body?: unknown): Promise<T> =>
    json<T>(path, {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  const listFeatures = (srvId: string) =>
    json<ServiceFeatures>(`/plugins-mgmt/${encodeURIComponent(srvId)}`);

  // the admin node's path still says plugins: a server-side name, not a word the caller reads
  const featurePath = (srvId: string, featureId: string) =>
    `/plugins-mgmt/${encodeURIComponent(srvId)}/${encodeURIComponent(featureId)}`;

  const featureCatalog = () => json<CatalogFeature[]>('/plugins');

  const isFeatureInstalled = async (srvId: string, featureId: string) => {
    const { installed } = await listFeatures(srvId);
    return installed.some(p => p.plugin_id === featureId);
  };

  const getFeatureConfig = (srvId: string, featureId: string) =>
    json<FeatureConfig>(`${featurePath(srvId, featureId)}/config`);

  // `async` deliberately: `resolveEnvRefs` throws on a missing variable, and
  // an otherwise-Promise-returning method that throws synchronously is a trap
  // — a caller using `.catch()` rather than `try`/`await` would miss it.
  const updateFeatureConfig = async (srvId: string, featureId: string, featureConfig: FeatureConfig) =>
    json<MutationResult>(`${featurePath(srvId, featureId)}/config`, {
      method: 'PATCH',
      body: JSON.stringify(resolveEnvRefs(featureConfig, env)),
    });

  const installFeature = (srvId: string, featureId: string) =>
    post(`${featurePath(srvId, featureId)}/install`);

  const uninstallFeature = (srvId: string, featureId: string) =>
    json<MutationResult>(featurePath(srvId, featureId), { method: 'DELETE' });

  const enableFeature = (srvId: string, featureId: string) =>
    post(`${featurePath(srvId, featureId)}/enable`);

  const disableFeature = (srvId: string, featureId: string) =>
    post(`${featurePath(srvId, featureId)}/disable`);

  const initFeature = (srvId: string, featureId: string, mode?: string) =>
    post<Record<string, unknown>>(
      `${featurePath(srvId, featureId)}/init`,
      mode === undefined ? undefined : { mode }
    );

  const testFeature = (srvId: string, featureId: string) =>
    post(`${featurePath(srvId, featureId)}/test`);

  return {
    config: cfg,
    env,

    login: (email, password) => login(cfg, email, password),

    useToken: (t: string) => {
      token = t;
    },

    async verifyToken() {
      await json<CatalogFeature[]>('/plugins');
    },

    featureCatalog,
    listFeatures,
    isFeatureInstalled,

    async configSchema(srvId, featureId) {
      const { available } = await listFeatures(srvId);
      return available.find(p => p._id === featureId)?.config_schema ?? null;
    },

    getFeatureConfig,
    updateFeatureConfig,
    installFeature,
    uninstallFeature,
    enableFeature,
    disableFeature,
    initFeature,
    testFeature,

    // the former names, kept for setups written against them
    pluginCatalog: featureCatalog,
    listPlugins: listFeatures,
    isPluginInstalled: isFeatureInstalled,
    getPluginConfig: getFeatureConfig,
    updatePluginConfig: updateFeatureConfig,
    installPlugin: installFeature,
    uninstallPlugin: uninstallFeature,
    enablePlugin: enableFeature,
    disablePlugin: disableFeature,
    initPlugin: initFeature,
    testPlugin: testFeature,

    serviceToken: (srvId) =>
      json<ServiceToken>(`/srvs-mgmt/${encodeURIComponent(srvId)}/jwt`),

    fetch: (path, init) => apiFetch(cfg, path, init),
  };
}

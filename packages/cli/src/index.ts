export { REDACTED, isRedacted } from './types.js';
export type {
  FeatureConfig,
  ConfigSchema,
  CatalogFeature,
  InstalledFeature,
  ServiceFeatures,
  PluginConfig,
  CatalogPlugin,
  InstalledPlugin,
  ServicePlugins,
  ServiceToken,
  MutationResult,
} from './types.js';

export { fromEnv, isEnvRef, resolveEnvRefs, defaultEnv, MissingEnvError } from './env.js';
export type { EnvRef, EnvSource } from './env.js';

export { createAdminClient } from './admin.js';
export type { AdminClient, AdminClientConfig } from './admin.js';

export { createServiceClient } from './service.js';
export type { ServiceClient, Document, IndexKeys } from './service.js';

export { isApiError } from './http.js';

export { planLabel, formatServices, sortServices } from './services.js';
export type { ListedService } from './services.js';

export {
  TOKEN_VAR,
  sessionPath,
  readSession,
  writeSession,
  clearSession,
  resolveToken,
} from './session.js';
export type { Session, TokenSource, ResolvedToken } from './session.js';

export { step, defineSetup, runSetup, DEFAULT_ENV, isEnvName } from './setup.js';
export type {
  Step,
  StepContext,
  StepState,
  StepResult,
  Setup,
  SetupReport,
  ProgressEvent,
  RunOptions,
} from './setup.js';

import { EnvironmentProviders, inject, makeEnvironmentProviders } from '@angular/core';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import type { AuthConfig } from '@ulabase/kit';
import { RH_AUTH_CONFIG } from './tokens.js';
import { rhAuthInterceptor } from './auth.interceptor.js';
import { httpClientTransport } from './http-transport.js';

export function provideRhAuth(config: AuthConfig): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideHttpClient(withInterceptors([rhAuthInterceptor])),
    {
      provide: RH_AUTH_CONFIG,
      // A factory, not a value, so the kit's own calls can be routed through
      // `HttpClient` — which does not exist yet when the caller builds the
      // config. An explicit `transport` is left alone, so an application can
      // still supply its own.
      useFactory: (): AuthConfig => ({
        ...config,
        transport: config.transport ?? httpClientTransport(inject(HttpClient)),
      }),
    },
  ]);
}

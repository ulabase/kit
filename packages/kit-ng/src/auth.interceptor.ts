import { inject } from '@angular/core';
import {
  HttpRequest,
  HttpHandlerFn,
  HttpInterceptorFn,
  HttpErrorResponse,
} from '@angular/common/http';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { RhAuthService } from './auth.service.js';
import { RH_AUTH_CONFIG, RH_KIT_REQUEST } from './tokens.js';
import { clearToken, cancelRefresh, getToken } from '@ulabase/kit';
import type { AuthConfig } from '@ulabase/kit';

/** The token source is pluggable and may be async — keep the sync path sync. */
function readToken(config: AuthConfig): string | null | Promise<string | null> {
  return config.getToken ? config.getToken() : getToken();
}

function isPromise<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as Promise<T>)?.then === 'function';
}

/**
 * Authenticates the application's own `HttpClient` requests, and clears the
 * session when the service rejects one with a 401.
 *
 * The kit's own calls go out through `fetch` and never reach an Angular
 * interceptor, so without this an app querying its own collections had to
 * attach the bearer token by hand at every call site.
 *
 * **Only requests to `apiBaseUrl` are touched.** The token is a credential:
 * attaching it to every outgoing request would hand it to any third-party host
 * the app happens to call. Requests elsewhere pass through untouched — they
 * still get the 401 handling, which is about the session and not the target.
 *
 * An `Authorization` header already on the request is left alone, so a call
 * that needs different credentials can say so.
 */
export const rhAuthInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn
) => {
  const auth = inject(RhAuthService);
  const config = inject(RH_AUTH_CONFIG);

  // A 401 on the kit's own endpoints does not always mean the session is dead
  // — change-password and token answer 401 for wrong *supplied* credentials —
  // and the kit already handles those. Clearing here would sign a user out for
  // mistyping their old password.
  const ownsIts401s = req.context.get(RH_KIT_REQUEST);

  const onError = (source: Observable<unknown>) =>
    source.pipe(
      catchError((err: unknown) => {
        if (!ownsIts401s && err instanceof HttpErrorResponse && err.status === 401) {
          clearToken();
          cancelRefresh();
          auth.clearSession();
        }
        return throwError(() => err);
      })
    );

  if (!req.url.startsWith(config.apiBaseUrl)) {
    return next(req).pipe(onError) as ReturnType<HttpHandlerFn>;
  }

  const withCredentials = (token: string | null) =>
    next(
      req.clone({
        setHeaders: {
          ...(token && !req.headers.has('Authorization')
            ? { Authorization: `Bearer ${token}` }
            : {}),
          // Suppress RESTHeart's WWW-Authenticate challenge on a 401 —
          // without it the browser shows its native Basic Auth popup.
          ...(req.headers.has('No-Auth-Challenge') ? {} : { 'No-Auth-Challenge': 'true' }),
        },
        // Matches the kit's own `credentials: 'include'`, so a cookie-mode
        // session authenticates these requests too.
        withCredentials: true,
      })
    ).pipe(onError) as ReturnType<HttpHandlerFn>;

  const token = readToken(config);
  return isPromise(token)
    ? (from(token).pipe(switchMap(withCredentials)) as ReturnType<HttpHandlerFn>)
    : withCredentials(token);
};

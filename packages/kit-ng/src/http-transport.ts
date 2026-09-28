import {
  HttpClient,
  HttpContext,
  HttpErrorResponse,
  HttpHeaders,
  HttpResponse,
} from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { AuthConfig } from '@ulabase/kit';
import { RH_KIT_REQUEST } from './tokens.js';

/** Statuses the Fetch spec forbids a body on — `new Response(body, …)` throws. */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

function toHttpHeaders(source: HeadersInit | undefined): HttpHeaders {
  let headers = new HttpHeaders();
  new Headers(source).forEach((value, name) => {
    headers = headers.set(name, value);
  });
  return headers;
}

function toHeaders(source: HttpHeaders): Headers {
  const headers = new Headers();
  for (const name of source.keys()) {
    for (const value of source.getAll(name) ?? []) {
      headers.append(name, value);
    }
  }
  return headers;
}

function toResponse(body: string | null, status: number, statusText: string, headers: HttpHeaders): Response {
  return new Response(NULL_BODY_STATUS.has(status) ? null : body, {
    status,
    statusText,
    headers: toHeaders(headers),
  });
}

/**
 * A {@link AuthConfig.transport} backed by Angular's `HttpClient`, so the kit's
 * own calls go through the interceptor chain like everything else the
 * application sends.
 *
 * Without it the kit speaks `fetch` directly and an interceptor never sees a
 * login, a session check or a token renewal — which makes any cross-cutting
 * concern written as an interceptor quietly partial.
 *
 * Two mismatches with `fetch` are reconciled here:
 *
 * - **`HttpClient` throws on a non-2xx response.** `fetch` resolves and lets
 *   the caller read the status, which is what the core does to build its
 *   `ApiError`. So an `HttpErrorResponse` carrying a real response is turned
 *   back into a resolved `Response`.
 * - **`status === 0` is not a response**, it is a network or CORS failure with
 *   nothing behind it. `new Response` would reject the status anyway, so the
 *   original error is rethrown and surfaces as a rejected promise, exactly as
 *   a failed `fetch` would.
 *
 * The body is read as text and left unparsed: the core calls `.json()` itself,
 * and on an error response it needs the raw body to pull out the message.
 */
export function httpClientTransport(http: HttpClient) {
  return (url: string, init?: RequestInit): Promise<Response> => {
    const request = firstValueFrom(
      http.request(init?.method ?? 'GET', url, {
        body: init?.body ?? null,
        headers: toHttpHeaders(init?.headers as HeadersInit | undefined),
        observe: 'response',
        responseType: 'text',
        // The kit handles 401s on its own endpoints; see RH_KIT_REQUEST.
        context: new HttpContext().set(RH_KIT_REQUEST, true),
        // Mirrors the core's `credentials: 'include'` — cookie-mode sessions
        // authenticate on the cookie alone.
        withCredentials: true,
      })
    );

    return request.then(
      (res: HttpResponse<string>) => toResponse(res.body, res.status, res.statusText, res.headers),
      (err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status !== 0) {
          const body = typeof err.error === 'string' ? err.error : JSON.stringify(err.error ?? null);
          return toResponse(body, err.status, err.statusText, err.headers);
        }
        throw err;
      }
    );
  };
}

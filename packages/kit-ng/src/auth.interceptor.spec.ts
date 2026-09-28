import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpContext,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import * as kit from '@ulabase/kit';
import { RhAuthService } from './auth.service';
import { rhAuthInterceptor } from './auth.interceptor';
import { RH_AUTH_CONFIG, RH_KIT_REQUEST } from './tokens';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
  TestBed.configureTestingModule({
    providers: [
      RhAuthService,
      { provide: RH_AUTH_CONFIG, useValue: config },
      provideHttpClient(withInterceptors([rhAuthInterceptor])),
      provideHttpClientTesting(),
    ],
  });
});
afterEach(() => {
  TestBed.inject(HttpTestingController).verify();
  TestBed.resetTestingModule();
});

/** Fire a request and resolve once the observable settles (it errors here). */
function fire(path: string): Promise<void> {
  const http = TestBed.inject(HttpClient);
  return new Promise<void>((resolve) => {
    http.get(path).subscribe({ next: () => resolve(), error: () => resolve() });
  });
}

describe('rhAuthInterceptor', () => {
  it('C1 clears the session on a 401 response', async () => {
    const auth = TestBed.inject(RhAuthService);
    const clearSpy = vi.spyOn(auth, 'clearSession');
    const done = fire('/x');
    TestBed.inject(HttpTestingController)
      .expectOne('/x')
      .flush('nope', { status: 401, statusText: 'Unauthorized' });
    await done;

    expect(kit.clearToken).toHaveBeenCalled();
    expect(kit.cancelRefresh).toHaveBeenCalled();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('C1 leaves the session alone on a non-401 error', async () => {
    const auth = TestBed.inject(RhAuthService);
    const clearSpy = vi.spyOn(auth, 'clearSession');
    const done = fire('/y');
    TestBed.inject(HttpTestingController)
      .expectOne('/y')
      .flush('boom', { status: 500, statusText: 'Server Error' });
    await done;

    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('C2 attaches the bearer token to requests to the service', async () => {
    vi.mocked(kit.getToken).mockReturnValue('tok');
    const done = fire(`${config.apiBaseUrl}/my-collection`);
    const req = TestBed.inject(HttpTestingController).expectOne(
      `${config.apiBaseUrl}/my-collection`
    );

    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    expect(req.request.headers.get('No-Auth-Challenge')).toBe('true');
    expect(req.request.withCredentials).toBe(true);

    req.flush({});
    await done;
  });

  it('C2 never sends the token to a third-party host', async () => {
    vi.mocked(kit.getToken).mockReturnValue('tok');
    const done = fire('https://evil.example.com/collect');
    const req = TestBed.inject(HttpTestingController).expectOne(
      'https://evil.example.com/collect'
    );

    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.headers.has('No-Auth-Challenge')).toBe(false);
    expect(req.request.withCredentials).toBe(false);

    req.flush({});
    await done;
  });

  it('C2 leaves an Authorization header the caller already set', async () => {
    vi.mocked(kit.getToken).mockReturnValue('tok');
    const http = TestBed.inject(HttpClient);
    const done = new Promise<void>(resolve => {
      http
        .get(`${config.apiBaseUrl}/x`, { headers: { Authorization: 'Basic abc' } })
        .subscribe({ next: () => resolve(), error: () => resolve() });
    });
    const req = TestBed.inject(HttpTestingController).expectOne(`${config.apiBaseUrl}/x`);

    expect(req.request.headers.get('Authorization')).toBe('Basic abc');

    req.flush({});
    await done;
  });

  it('C3 leaves the session alone on a 401 to a kit request', async () => {
    // Wrong current password answers 401; signing the user out for that would
    // be a regression introduced by routing the kit through HttpClient.
    const auth = TestBed.inject(RhAuthService);
    const clearSpy = vi.spyOn(auth, 'clearSession');
    const http = TestBed.inject(HttpClient);
    const done = new Promise<void>(resolve => {
      http
        .patch(
          `${config.apiBaseUrl}/auth/change-password`,
          {},
          { context: new HttpContext().set(RH_KIT_REQUEST, true) }
        )
        .subscribe({ next: () => resolve(), error: () => resolve() });
    });
    TestBed.inject(HttpTestingController)
      .expectOne(`${config.apiBaseUrl}/auth/change-password`)
      .flush('nope', { status: 401, statusText: 'Unauthorized' });
    await done;

    expect(clearSpy).not.toHaveBeenCalled();
    expect(kit.clearToken).not.toHaveBeenCalled();
  });

  it('C2 sends no Authorization header when there is no token', async () => {
    vi.mocked(kit.getToken).mockReturnValue(null);
    const done = fire(`${config.apiBaseUrl}/x`);
    const req = TestBed.inject(HttpTestingController).expectOne(`${config.apiBaseUrl}/x`);

    expect(req.request.headers.has('Authorization')).toBe(false);
    // Still marked, so a 401 does not raise the browser's Basic Auth popup.
    expect(req.request.headers.get('No-Auth-Challenge')).toBe('true');

    req.flush({});
    await done;
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type CanActivateFn } from '@angular/router';
import { firstValueFrom, isObservable, type Observable } from 'rxjs';
import * as kit from '@ulabase/kit';
import { RhAuthService } from './auth.service';
import { authGuard, publicGuard } from './auth.guard';
import { RH_AUTH_CONFIG } from './tokens';

vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'] } as kit.UserInfo;

function setup() {
  TestBed.configureTestingModule({
    providers: [RhAuthService, { provide: RH_AUTH_CONFIG, useValue: config }, provideRouter([])],
  });
}

/** Run a guard in an injection context and normalise its boolean/observable result. */
async function run(guard: CanActivateFn): Promise<boolean> {
  const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));
  return isObservable(result) ? firstValueFrom(result as Observable<boolean>) : (result as boolean);
}

function signedIn() {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
  vi.mocked(kit.checkSession).mockResolvedValue(null);
});
afterEach(() => TestBed.resetTestingModule());

describe('authGuard', () => {
  it('B1 redirects to /auth/login when unauthenticated', async () => {
    setup();
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(await run(authGuard)).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/auth/login']);
  });

  it('B2 allows when already authenticated', async () => {
    signedIn();
    setup();
    await firstValueFrom(TestBed.inject(RhAuthService).checkSession()); // populate state
    expect(await run(authGuard)).toBe(true);
  });
});

describe('publicGuard', () => {
  it('B3 redirects an authenticated user into the app', async () => {
    signedIn();
    setup();
    await firstValueFrom(TestBed.inject(RhAuthService).checkSession());
    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(await run(publicGuard)).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/']);
  });

  it('B4 allows when unauthenticated', async () => {
    setup();
    expect(await run(publicGuard)).toBe(true);
  });
});

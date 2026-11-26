import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { catchError, map, of, tap } from 'rxjs';
import { RhAuthService } from './auth.service.js';

export const authGuard: CanActivateFn = () => {
  const auth = inject(RhAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  return auth.checkSession().pipe(
    // A check that fails, such as the 451 of a consents gate or a network failure that outlived
    // the kit's retries, is no session. Uncaught, it failed the navigation, and the router
    // reported it as an unhandled rejection. The same answer as the Vue adapter's guards.
    catchError(() => of(null)),
    map(user => user !== null),
    tap(ok => { if (!ok) router.navigate(['/auth/login']); })
  );
};

export const publicGuard: CanActivateFn = () => {
  const auth = inject(RhAuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) return true;

  return auth.checkSession().pipe(
    catchError(() => of(null)),
    map(user => user === null),
    tap(isPublic => { if (!isPublic) router.navigate(['/']); })
  );
};

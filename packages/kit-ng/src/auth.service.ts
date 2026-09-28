import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, from, map, of, switchMap, tap, throwError } from 'rxjs';
import type { UserInfo, TeamMembership, TeamMember, PendingInvitation, AuthConfig, LoginMode } from '@ulabase/kit';
import * as kit from '@ulabase/kit';
import { RH_AUTH_CONFIG } from './tokens.js';

@Injectable({ providedIn: 'root' })
export class RhAuthService {
  private readonly config: AuthConfig = inject(RH_AUTH_CONFIG);

  private readonly _user = signal<UserInfo | null>(null);
  private readonly _teams = signal<TeamMembership[]>([]);

  readonly user = this._user.asReadonly();
  readonly teams = this._teams.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly hasMultipleTeams = computed(() => this._teams().length > 1);

  /**
   * Check the current session state.
   *
   * Reads the token from localStorage — if present and not expired,
   * returns user info from the server. Otherwise returns null.
   */
  checkSession(): Observable<UserInfo | null> {
    // If no valid token in localStorage, we're logged out — no HTTP call needed
    if (!kit.getToken()) {
      this._user.set(null);
      this._teams.set([]);
      return of(null);
    }

    return from(kit.checkSession(this.config)).pipe(
      tap(u => {
        this._user.set(u);
        if (!u) {
          this._teams.set([]);
        }
      }),
      switchMap(u =>
        u === null
          ? of([])
          : from(kit.getTeams(this.config)).pipe(catchError(() => of([])))
      ),
      tap(ts => this._teams.set(ts)),
      map(() => this._user())
    );
  }

  register(payload: {
    email: string;
    password: string;
    teamName: string;
    firstName: string;
    lastName: string;
    [key: string]: unknown;
  }): Observable<void> {
    return from(kit.register(this.config, payload));
  }

  verify(email: string, token: string, delivery: 'cookie' | 'fragment' = 'fragment'): Observable<string> {
    return from(kit.verify(this.config, email, token, delivery));
  }

  login(email: string, password: string, mode: LoginMode = 'bearer'): Observable<UserInfo> {
    return from(kit.login(this.config, email, password, mode)).pipe(
      tap(u => this._user.set(u)),
      switchMap(u =>
        from(kit.getTeams(this.config)).pipe(
          catchError(() => of([])),
          tap(ts => this._teams.set(ts)),
          map(() => u)
        )
      )
    );
  }

  logout(): Observable<void> {
    return from(kit.logout(this.config)).pipe(
      tap(() => {
        this._user.set(null);
        this._teams.set([]);
      })
    );
  }

  invite(email: string, role: 'owner' | 'member'): Observable<void> {
    return from(kit.invite(this.config, email, role));
  }

  getInvitation(email: string, token: string) {
    return from(kit.getInvitation(this.config, email, token));
  }

  activate(payload: { email: string; token: string; password: string }, mode: LoginMode = 'bearer'): Observable<void> {
    return from(kit.activate(this.config, payload, mode)).pipe(map(() => undefined));
  }

  acceptInvite(token: string): Observable<void> {
    return from(kit.acceptInvite(this.config, token)).pipe(
      switchMap(() =>
        from(kit.getTeams(this.config)).pipe(
          catchError(() => of([])),
          tap(ts => this._teams.set(ts))
        )
      ),
      map(() => undefined)
    );
  }

  resendInvite(email: string): Observable<void> {
    return from(kit.resendInvite(this.config, email));
  }

  listInvitations(): Observable<PendingInvitation[]> {
    return from(kit.listInvitations(this.config));
  }

  loadTeams(): Observable<TeamMembership[]> {
    return from(kit.getTeams(this.config)).pipe(
      tap(ts => this._teams.set(ts))
    );
  }

  switchTeam(teamId: { $oid: string }, mode: LoginMode = 'bearer'): Observable<void> {
    return from(kit.switchTeam(this.config, teamId, mode)).pipe(
      switchMap(() => this.checkSession()),
      map(() => undefined)
    );
  }

  clearSession(): void {
    kit.clearToken();
    kit.cancelRefresh();
    this._user.set(null);
    this._teams.set([]);
  }

  forgotPassword(email: string): Observable<void> {
    return from(kit.forgotPassword(this.config, email));
  }

  resetPassword(payload: { email: string; token: string; password: string }, mode: LoginMode = 'bearer'): Observable<void> {
    return from(kit.resetPassword(this.config, payload, mode)).pipe(map(() => undefined));
  }

  // ── Team members ─────────────────────────────────────────────────────────

  listTeamMembers(): Observable<TeamMember[]> {
    return from(kit.listTeamMembers(this.config));
  }

  removeMember(email: string): Observable<void> {
    return from(kit.removeMember(this.config, email));
  }

  updateMemberRole(email: string, role: 'owner' | 'member'): Observable<void> {
    return from(kit.updateMemberRole(this.config, email, role));
  }

  // ── Team lifecycle ───────────────────────────────────────────────────────

  createTeam(teamName: string): Observable<TeamMembership> {
    return from(kit.createTeam(this.config, teamName));
  }

  updateTeam(updates: { name?: string; description?: string }): Observable<void> {
    return from(kit.updateTeam(this.config, updates));
  }

  deleteTeam(): Observable<void> {
    return from(kit.deleteTeam(this.config));
  }

  // ── Profile & password ──────────────────────────────────────────────────

  updateProfile(updates: { firstName?: string; lastName?: string }): Observable<void> {
    return from(kit.updateProfile(this.config, updates)).pipe(
      switchMap(() => this.checkSession()),
      map(() => undefined)
    );
  }

  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return from(kit.changePassword(this.config, currentPassword, newPassword));
  }

  updateUser(email: string, updates: Record<string, unknown>): Observable<void> {
    return from(kit.updateUser(this.config, email, updates));
  }

  // ── Consents ────────────────────────────────────────────────────────────

  /**
   * Record the signed-in user's acceptance of the application's consents,
   * renew the token so the guard sees it, and update the `user` signal.
   */
  acceptConsents(body?: Record<string, unknown>, mode: LoginMode = 'bearer'): Observable<UserInfo> {
    // The user document may be missing precisely because the rule is blocking
    // `/users/me` — the case this call exists to get out of. The token still
    // says who they are.
    const userId = this._user()?._id ?? (kit.getTokenClaims()?.['sub'] as string | undefined);
    if (!userId) {
      return throwError(() => ({ status: 0, message: 'acceptConsents requires a signed-in user' }));
    }
    return from(kit.acceptConsents(this.config, userId, body, mode)).pipe(
      tap(u => this._user.set(u))
    );
  }

  /** Force a new token, carrying the user document as it is now. */
  renewToken(mode: LoginMode = 'bearer'): Observable<string | null> {
    return from(kit.renewToken(this.config, mode));
  }

  /**
   * An authenticated `fetch` against the service, returned as an Observable.
   *
   * The Angular counterpart of React's `auth.api()` — the bearer token is
   * attached automatically, and the request goes through the Angular
   * interceptor chain (when `httpClientTransport` is configured).
   *
   * ```ts
   * this.auth.api('/demo').pipe(
   *   switchMap(res => res.json()),
   * ).subscribe(data => console.log(data));
   * ```
   *
   * For a POST:
   * ```ts
   * this.auth.api('/demo', {
   *   method: 'POST',
   *   body: JSON.stringify({ name: 'hello' }),
   * }).pipe(switchMap(res => res.json()));
   * ```
   *
   * Rejects with an `ApiError` (`{ status, message }`) on any non-2xx response.
   */
  api(path: string, init?: RequestInit): Observable<Response> {
    return from(kit.apiFetch(this.config, path, init));
  }
}

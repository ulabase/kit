import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import * as kit from '@ulabase/kit';
import type {
  AuthConfig,
  Invitation,
  LoginMode,
  PendingInvitation,
  TeamMember,
  TeamMembership,
  UserInfo,
} from '@ulabase/kit';

/**
 * The reactive auth surface, shared app-wide through {@link RhAuthProvider}.
 *
 * State fields are plain values that trigger a re-render when they change;
 * methods are thin wrappers over `@ulabase/kit` that update that state.
 * This is the React equivalent of `kit-ng`'s `RhAuthService` — the same contract,
 * returning Promises instead of Observables.
 */
export interface RhAuth {
  // ── Reactive state ─────────────────────────────────────────────────────────
  /** The authenticated user, or `null`. `user._id` is the email. */
  user: UserInfo | null;
  /** Teams the user belongs to. */
  teams: TeamMembership[];
  /** Derived from `user`. */
  isAuthenticated: boolean;
  /** `true` when the user belongs to more than one team. */
  hasMultipleTeams: boolean;
  /**
   * `true` until the initial {@link RhAuth.checkSession} started on mount has
   * settled. Guards render a fallback while this is `true` to avoid a flash of
   * unauthenticated content.
   */
  initializing: boolean;

  // ── Methods ────────────────────────────────────────────────────────────────
  checkSession(): Promise<UserInfo | null>;
  register(payload: {
    email: string;
    password: string;
    teamName: string;
    firstName: string;
    lastName: string;
    [key: string]: unknown;
  }): Promise<void>;
  verify(email: string, token: string, delivery?: 'cookie' | 'fragment'): Promise<string>;
  login(email: string, password: string, mode?: LoginMode): Promise<UserInfo>;
  logout(): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(
    payload: { email: string; token: string; password: string },
    mode?: LoginMode
  ): Promise<void>;
  updateProfile(updates: { firstName?: string; lastName?: string }): Promise<void>;
  updateUser(email: string, updates: Record<string, unknown>): Promise<void>;
  /**
   * A `fetch` against the service with the session already applied — the
   * React counterpart of Angular's `rhAuthInterceptor`.
   *
   * React has no interceptor slot, so an app querying its own collections
   * would otherwise attach the bearer token by hand at every call site. Pass a
   * path, not a URL; rejects with an `ApiError` on any non-2xx response.
   *
   * ```tsx
   * const res = await auth.api('/my-collection?pagesize=10');
   * const docs = await res.json();
   * ```
   */
  api(path: string, init?: RequestInit): Promise<Response>;
  /**
   * Record the signed-in user's acceptance of the application's consents,
   * renew the token so the guard sees it, and update `user` with the result.
   */
  acceptConsents(body?: Record<string, unknown>, mode?: LoginMode): Promise<UserInfo>;
  /** Force a new token, carrying the user document as it is now. */
  renewToken(mode?: LoginMode): Promise<string | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  invite(email: string, role: 'owner' | 'member'): Promise<void>;
  getInvitation(email: string, token: string): Promise<Invitation>;
  activate(
    payload: { email: string; token: string; password: string },
    mode?: LoginMode
  ): Promise<void>;
  acceptInvite(token: string): Promise<void>;
  resendInvite(email: string): Promise<void>;
  listInvitations(): Promise<PendingInvitation[]>;
  loadTeams(): Promise<TeamMembership[]>;
  switchTeam(teamId: { $oid: string }, mode?: LoginMode): Promise<void>;
  listTeamMembers(): Promise<TeamMember[]>;
  removeMember(email: string): Promise<void>;
  updateMemberRole(email: string, role: 'owner' | 'member'): Promise<void>;
  createTeam(teamName: string): Promise<TeamMembership>;
  updateTeam(updates: { name?: string; description?: string }): Promise<void>;
  deleteTeam(): Promise<void>;
  clearSession(): void;
}

const RhAuthContext = createContext<RhAuth | null>(null);

export interface RhAuthProviderProps {
  config: AuthConfig;
  children: ReactNode;
}

/**
 * Provides the shared auth state to the tree. Register it once, near the root:
 *
 * ```tsx
 * <RhAuthProvider config={{ apiBaseUrl: import.meta.env.VITE_API_URL }}>
 *   <App />
 * </RhAuthProvider>
 * ```
 *
 * On mount it runs {@link RhAuth.checkSession} once, so a page reload restores
 * the session before the first guard evaluates.
 */
export function RhAuthProvider({ config, children }: RhAuthProviderProps): ReactNode {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [initializing, setInitializing] = useState(true);

  // Keep the latest config in a ref so the memoised methods stay stable even if
  // the caller passes a fresh config object on every render.
  const configRef = useRef(config);
  configRef.current = config;

  // Same reason, for the methods that need the signed-in user's id: reading it
  // from a ref keeps them out of the dependency arrays, so their identity does
  // not change on every sign-in.
  const userRef = useRef<UserInfo | null>(null);
  userRef.current = user;

  const loadTeams = useCallback(async (): Promise<TeamMembership[]> => {
    const ts = await kit.getTeams(configRef.current);
    setTeams(ts);
    return ts;
  }, []);

  const checkSession = useCallback(async (): Promise<UserInfo | null> => {
    // No valid token → logged out, no HTTP call needed.
    if (!kit.getToken()) {
      setUser(null);
      setTeams([]);
      return null;
    }
    const u = await kit.checkSession(configRef.current);
    setUser(u);
    if (u === null) {
      setTeams([]);
      return null;
    }
    // checkSession also loads teams; swallow team-load failures.
    const ts = await kit.getTeams(configRef.current).catch(() => [] as TeamMembership[]);
    setTeams(ts);
    return u;
  }, []);

  const login = useCallback(
    async (email: string, password: string, mode: LoginMode = 'bearer'): Promise<UserInfo> => {
      const u = await kit.login(configRef.current, email, password, mode);
      setUser(u);
      // login also loads teams in the same round trip.
      const ts = await kit.getTeams(configRef.current).catch(() => [] as TeamMembership[]);
      setTeams(ts);
      return u;
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    await kit.logout(configRef.current);
    setUser(null);
    setTeams([]);
  }, []);

  const clearSession = useCallback((): void => {
    kit.clearToken();
    kit.cancelRefresh();
    setUser(null);
    setTeams([]);
  }, []);

  const acceptInvite = useCallback(async (token: string): Promise<void> => {
    await kit.acceptInvite(configRef.current, token);
    const ts = await kit.getTeams(configRef.current).catch(() => [] as TeamMembership[]);
    setTeams(ts);
  }, []);

  const switchTeam = useCallback(
    async (teamId: { $oid: string }, mode: LoginMode = 'bearer'): Promise<void> => {
      await kit.switchTeam(configRef.current, teamId, mode);
      await checkSession();
    },
    [checkSession]
  );

  const updateProfile = useCallback(
    async (updates: { firstName?: string; lastName?: string }): Promise<void> => {
      await kit.updateProfile(configRef.current, updates);
      await checkSession();
    },
    [checkSession]
  );

  // Thin passthroughs that don't touch shared state.
  const register = useCallback(
    (payload: Parameters<typeof kit.register>[1]) => kit.register(configRef.current, payload),
    []
  );
  const verify = useCallback(
    (email: string, token: string, delivery: 'cookie' | 'fragment' = 'fragment') =>
      kit.verify(configRef.current, email, token, delivery),
    []
  );
  const forgotPassword = useCallback(
    (email: string) => kit.forgotPassword(configRef.current, email),
    []
  );
  const resetPassword = useCallback(
    async (
      payload: { email: string; token: string; password: string },
      mode: LoginMode = 'bearer'
    ): Promise<void> => {
      await kit.resetPassword(configRef.current, payload, mode);
    },
    []
  );
  const changePassword = useCallback(
    (currentPassword: string, newPassword: string) =>
      kit.changePassword(configRef.current, currentPassword, newPassword),
    []
  );
  const updateUser = useCallback(
    (email: string, updates: Record<string, unknown>) =>
      kit.updateUser(configRef.current, email, updates),
    []
  );
  const api = useCallback(
    (path: string, init?: RequestInit) => kit.apiFetch(configRef.current, path, init),
    []
  );
  const acceptConsents = useCallback(
    async (body?: Record<string, unknown>, mode: LoginMode = 'bearer'): Promise<UserInfo> => {
      // The user document may be missing precisely because the rule is blocking
      // `/users/me` — the case this call exists to get out of. The token still
      // says who they are.
      const userId = userRef.current?._id ?? (kit.getTokenClaims()?.['sub'] as string | undefined);
      if (!userId) throw { status: 0, message: 'acceptConsents requires a signed-in user' };
      const u = await kit.acceptConsents(configRef.current, userId, body, mode);
      setUser(u);
      return u;
    },
    []
  );
  const renewToken = useCallback(
    (mode: LoginMode = 'bearer') => kit.renewToken(configRef.current, mode),
    []
  );
  const invite = useCallback(
    (email: string, role: 'owner' | 'member') => kit.invite(configRef.current, email, role),
    []
  );
  const getInvitation = useCallback(
    (email: string, token: string) => kit.getInvitation(configRef.current, email, token),
    []
  );
  const activate = useCallback(
    async (
      payload: { email: string; token: string; password: string },
      mode: LoginMode = 'bearer'
    ): Promise<void> => {
      await kit.activate(configRef.current, payload, mode);
    },
    []
  );
  const resendInvite = useCallback(
    (email: string) => kit.resendInvite(configRef.current, email),
    []
  );
  const listInvitations = useCallback(() => kit.listInvitations(configRef.current), []);
  const listTeamMembers = useCallback(() => kit.listTeamMembers(configRef.current), []);
  const removeMember = useCallback(
    (email: string) => kit.removeMember(configRef.current, email),
    []
  );
  const updateMemberRole = useCallback(
    (email: string, role: 'owner' | 'member') =>
      kit.updateMemberRole(configRef.current, email, role),
    []
  );
  const createTeam = useCallback((teamName: string) => kit.createTeam(configRef.current, teamName), []);
  const updateTeam = useCallback(
    (updates: { name?: string; description?: string }) => kit.updateTeam(configRef.current, updates),
    []
  );
  const deleteTeam = useCallback(() => kit.deleteTeam(configRef.current), []);

  // Restore the session once on mount.
  useEffect(() => {
    let cancelled = false;
    checkSession()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkSession]);

  const value = useMemo<RhAuth>(
    () => ({
      user,
      teams,
      isAuthenticated: user !== null,
      hasMultipleTeams: teams.length > 1,
      initializing,
      checkSession,
      register,
      verify,
      login,
      logout,
      forgotPassword,
      resetPassword,
      updateProfile,
      updateUser,
      api,
      acceptConsents,
      renewToken,
      changePassword,
      invite,
      getInvitation,
      activate,
      acceptInvite,
      resendInvite,
      listInvitations,
      loadTeams,
      switchTeam,
      listTeamMembers,
      removeMember,
      updateMemberRole,
      createTeam,
      updateTeam,
      deleteTeam,
      clearSession,
    }),
    [
      user,
      teams,
      initializing,
      checkSession,
      register,
      verify,
      login,
      logout,
      forgotPassword,
      resetPassword,
      updateProfile,
      updateUser,
      api,
      acceptConsents,
      renewToken,
      changePassword,
      invite,
      getInvitation,
      activate,
      acceptInvite,
      resendInvite,
      listInvitations,
      loadTeams,
      switchTeam,
      listTeamMembers,
      removeMember,
      updateMemberRole,
      createTeam,
      updateTeam,
      deleteTeam,
      clearSession,
    ]
  );

  return <RhAuthContext.Provider value={value}>{children}</RhAuthContext.Provider>;
}

/**
 * Read the shared auth state and methods. Must be called under a
 * {@link RhAuthProvider}.
 *
 * ```tsx
 * const auth = useAuth();
 * if (auth.isAuthenticated) return <span>{auth.user?.profile?.name}</span>;
 * ```
 */
export function useAuth(): RhAuth {
  const ctx = useContext(RhAuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within a <RhAuthProvider>');
  }
  return ctx;
}

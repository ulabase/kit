import { computed, ref, type ComputedRef, type Ref } from 'vue';
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
 * The reactive auth store shared app-wide. This is the Vue equivalent of
 * `kit-ng`'s `RhAuthService` and `kit-react`'s `useAuth` — the same contract,
 * exposed as Vue refs and `async` methods.
 *
 * Create it with {@link createRhAuth} and read it with `useAuth()`.
 */
export interface RhAuthStore {
  /** The authenticated user, or `null`. `user._id` is the email. */
  readonly user: Readonly<Ref<UserInfo | null>>;
  /** Teams the user belongs to. */
  readonly teams: Readonly<Ref<TeamMembership[]>>;
  /** Derived from `user`. */
  readonly isAuthenticated: ComputedRef<boolean>;
  /** `true` when the user belongs to more than one team. */
  readonly hasMultipleTeams: ComputedRef<boolean>;
  /** `true` until the initial session check settles. */
  readonly initializing: Readonly<Ref<boolean>>;

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
   * A `fetch` against the service with the session already applied — the Vue
   * counterpart of Angular's `rhAuthInterceptor`.
   *
   * Vue has no interceptor slot, so an app querying its own collections would
   * otherwise attach the bearer token by hand at every call site. Pass a path,
   * not a URL; rejects with an `ApiError` on any non-2xx response.
   *
   * ```ts
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

/**
 * Build the reactive store. Called once by {@link createRhAuth}; on creation it
 * kicks off a session check so a page reload restores the session.
 */
export function createRhAuthStore(config: AuthConfig): RhAuthStore {
  const user = ref<UserInfo | null>(null);
  const teams = ref<TeamMembership[]>([]);
  const initializing = ref(true);

  const isAuthenticated = computed(() => user.value !== null);
  const hasMultipleTeams = computed(() => teams.value.length > 1);

  async function loadTeams(): Promise<TeamMembership[]> {
    const ts = await kit.getTeams(config);
    teams.value = ts;
    return ts;
  }

  async function checkSession(): Promise<UserInfo | null> {
    if (!kit.getToken()) {
      user.value = null;
      teams.value = [];
      return null;
    }
    const u = await kit.checkSession(config);
    user.value = u;
    if (u === null) {
      teams.value = [];
      return null;
    }
    teams.value = await kit.getTeams(config).catch(() => [] as TeamMembership[]);
    return u;
  }

  async function login(
    email: string,
    password: string,
    mode: LoginMode = 'bearer'
  ): Promise<UserInfo> {
    const u = await kit.login(config, email, password, mode);
    user.value = u;
    teams.value = await kit.getTeams(config).catch(() => [] as TeamMembership[]);
    return u;
  }

  async function logout(): Promise<void> {
    await kit.logout(config);
    user.value = null;
    teams.value = [];
  }

  function clearSession(): void {
    kit.clearToken();
    kit.cancelRefresh();
    user.value = null;
    teams.value = [];
  }

  async function acceptInvite(token: string): Promise<void> {
    await kit.acceptInvite(config, token);
    teams.value = await kit.getTeams(config).catch(() => [] as TeamMembership[]);
  }

  async function switchTeam(teamId: { $oid: string }, mode: LoginMode = 'bearer'): Promise<void> {
    await kit.switchTeam(config, teamId, mode);
    await checkSession();
  }

  async function updateProfile(updates: { firstName?: string; lastName?: string }): Promise<void> {
    await kit.updateProfile(config, updates);
    await checkSession();
  }

  async function acceptConsents(
    body?: Record<string, unknown>,
    mode: LoginMode = 'bearer'
  ): Promise<UserInfo> {
    // The user document may be missing precisely because the rule is blocking
    // `/users/me` — the case this call exists to get out of. The token still
    // says who they are.
    const userId = user.value?._id ?? (kit.getTokenClaims()?.['sub'] as string | undefined);
    if (!userId) throw { status: 0, message: 'acceptConsents requires a signed-in user' };
    const u = await kit.acceptConsents(config, userId, body, mode);
    user.value = u;
    return u;
  }

  const store: RhAuthStore = {
    user,
    teams,
    isAuthenticated,
    hasMultipleTeams,
    initializing,

    checkSession,
    register: (payload) => kit.register(config, payload),
    verify: (email, token, delivery = 'fragment') => kit.verify(config, email, token, delivery),
    login,
    logout,
    forgotPassword: (email) => kit.forgotPassword(config, email),
    resetPassword: async (payload, mode = 'bearer') => {
      await kit.resetPassword(config, payload, mode);
    },
    updateProfile,
    changePassword: (current, next) => kit.changePassword(config, current, next),
    updateUser: (email, updates) => kit.updateUser(config, email, updates),
    api: (path, init) => kit.apiFetch(config, path, init),
    acceptConsents,
    renewToken: (mode = 'bearer') => kit.renewToken(config, mode),
    invite: (email, role) => kit.invite(config, email, role),
    getInvitation: (email, token) => kit.getInvitation(config, email, token),
    activate: async (payload, mode = 'bearer') => {
      await kit.activate(config, payload, mode);
    },
    acceptInvite,
    resendInvite: (email) => kit.resendInvite(config, email),
    listInvitations: () => kit.listInvitations(config),
    loadTeams,
    switchTeam,
    listTeamMembers: () => kit.listTeamMembers(config),
    removeMember: (email) => kit.removeMember(config, email),
    updateMemberRole: (email, role) => kit.updateMemberRole(config, email, role),
    createTeam: (teamName) => kit.createTeam(config, teamName),
    updateTeam: (updates) => kit.updateTeam(config, updates),
    deleteTeam: () => kit.deleteTeam(config),
    clearSession,
  };

  // Restore the session once, at store creation.
  void checkSession()
    .catch(() => null)
    .finally(() => {
      initializing.value = false;
    });

  return store;
}

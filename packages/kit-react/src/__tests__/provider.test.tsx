import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import * as kit from '@ulabase/kit';
import { RhAuthProvider, useAuth, RhPaymentsProvider, usePayments } from '../index';

// The core is separately integration-tested against a live Ulabase
// instance. Here we mock it entirely and assert only the adapter's wiring:
// which core calls fire, and how the reactive state reacts.
vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'owner' } } as kit.UserInfo;

const wrapper = ({ children }: { children: ReactNode }) => (
  <RhAuthProvider config={config}>{children}</RhAuthProvider>
);

/** Mock a signed-in bootstrap: token present, session and teams resolve. */
function signedIn(teams: unknown[] = [{ id: { $oid: '1' }, role: 'owner' }]) {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue(teams as kit.TeamMembership[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null); // signed-out by default
});

describe('RhAuthProvider bootstrap', () => {
  it('starts unauthenticated and makes NO HTTP call when there is no token', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.initializing).toBe(false));
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    // The short-circuit: checkSession() returns null without hitting the server.
    expect(kit.checkSession).not.toHaveBeenCalled();
    expect(kit.getTeams).not.toHaveBeenCalled();
  });

  it('checkSession loads BOTH the user and the teams when a token exists', async () => {
    signedIn();
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.user?._id).toBe('a@b.com');
    expect(result.current.teams).toHaveLength(1);
    expect(kit.getTeams).toHaveBeenCalledOnce();
  });
});

describe('methods update the shared state', () => {
  it('login sets the user and also loads teams in the same flow', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.initializing).toBe(false));

    await act(async () => {
      await result.current.login('a@b.com', 'pw');
    });

    expect(result.current.user?._id).toBe('a@b.com');
    expect(result.current.teams).toHaveLength(2);
    expect(result.current.hasMultipleTeams).toBe(true);
    expect(kit.login).toHaveBeenCalledWith(config, 'a@b.com', 'pw', 'bearer');
  });

  it('logout clears user and teams', async () => {
    signedIn();
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(result.current.teams).toHaveLength(0);
  });

  it('switchTeam re-checks the session (fresh team claim)', async () => {
    signedIn();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    vi.mocked(kit.checkSession).mockClear();

    await act(async () => {
      await result.current.switchTeam({ $oid: '2' });
    });

    expect(kit.switchTeam).toHaveBeenCalledWith(config, { $oid: '2' }, 'bearer');
    expect(kit.checkSession).toHaveBeenCalledOnce(); // re-check after switch
  });

  it('acceptInvite reloads teams', async () => {
    signedIn([{ id: { $oid: '1' }, role: 'owner' }]);
    vi.mocked(kit.acceptInvite).mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);

    await act(async () => {
      await result.current.acceptInvite('invite-token');
    });

    expect(kit.acceptInvite).toHaveBeenCalledWith(config, 'invite-token');
    expect(result.current.teams).toHaveLength(2);
  });

  it('clearSession wipes state and the token', async () => {
    signedIn();
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => {
      result.current.clearSession();
    });

    expect(kit.clearToken).toHaveBeenCalledOnce();
    expect(kit.cancelRefresh).toHaveBeenCalledOnce();
    expect(result.current.user).toBeNull();
    expect(result.current.teams).toHaveLength(0);
  });
});

// ── Payments (E1–E9) ───────────────────────────────────────────────────────

const subscriptionFixture: kit.Subscription = {
  plan: 'gold',
  active: true,
  licensed: true,
  cancel_at_period_end: false,
  seats: { limit: 10, licensed: 3, available: 7, over_limit: false },
};

const paymentsConfig = { apiBaseUrl: 'https://x.restheart.com', payments: true };

const paymentsWrapper = ({ children }: { children: ReactNode }) => (
  <RhAuthProvider config={paymentsConfig}>
    <RhPaymentsProvider config={paymentsConfig}>{children}</RhPaymentsProvider>
  </RhAuthProvider>
);

function signedInWithSubscription() {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  // A fresh object per call, as a real HTTP/JSON response gives: the adapter
  // must key the reload on the team, not on the user object's identity.
  vi.mocked(kit.checkSession).mockImplementation(async () => ({ ...user }));
  vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'owner' }] as kit.TeamMembership[]);
  vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);
}

// auth and payments must come from the same rendered tree — two separate
// renderHook calls each mount their own <RhAuthProvider>, so calling a
// method on one instance would never be visible from the other's state.
function useAuthAndPayments() {
  return { auth: useAuth(), payments: usePayments() };
}

describe('E. Payments', () => {
  it('E1 bootstrap without payments: no call to /stripe/*, subscription stays null', async () => {
    signedIn();
    // No RhPaymentsProvider — payments disabled
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });

  it('E2 bootstrap with payments, session valid: loads subscription', async () => {
    signedInWithSubscription();
    const { result } = renderHook(() => usePayments(), { wrapper: paymentsWrapper });

    await waitFor(() => expect(result.current.subscription).not.toBeNull());
    expect(result.current.plan).toBe('gold');
    expect(result.current.isSubscribed).toBe(true);
    expect(result.current.seatsAvailable).toBe(7);
    expect(kit.getSubscription).toHaveBeenCalledOnce();
  });

  it('E3 login with payments: loads subscription in the same flow', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'owner' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const { result } = renderHook(() => useAuthAndPayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.auth.initializing).toBe(false));

    await act(async () => {
      await result.current.auth.login('a@b.com', 'pw');
    });

    await waitFor(() => expect(result.current.payments.subscription).not.toBeNull());
    expect(result.current.payments.plan).toBe('gold');
  });

  it('E4 switchTeam reloads subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');

    const { result } = renderHook(() => useAuthAndPayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(true));
    await waitFor(() => expect(result.current.payments.subscription).not.toBeNull());

    // Update mocks BEFORE switchTeam — the effect fires during checkSession.
    // switchTeam re-checks the session and the server answers with the user
    // carrying the *new* team; that team change is what triggers the reload.
    const newSub = { ...subscriptionFixture, plan: 'silver', active: true };
    vi.mocked(kit.getSubscription).mockResolvedValue(newSub);
    vi.mocked(kit.checkSession).mockResolvedValue({
      ...user,
      team: { _id: { $oid: '2' }, role: 'owner' },
    });

    await act(async () => {
      await result.current.auth.switchTeam({ $oid: '2' });
    });

    await waitFor(() => expect(result.current.payments.plan).toBe('silver'));
  });

  it('E5 logout clears subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuthAndPayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(true));
    await waitFor(() => expect(result.current.payments.subscription).not.toBeNull());

    await act(async () => {
      await result.current.auth.logout();
    });

    expect(result.current.payments.subscription).toBeNull();
    expect(result.current.payments.plan).toBeNull();
    expect(result.current.payments.isSubscribed).toBe(false);
  });

  it('E6 clearSession clears subscription', async () => {
    signedInWithSubscription();
    const { result } = renderHook(() => useAuthAndPayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(true));
    await waitFor(() => expect(result.current.payments.subscription).not.toBeNull());

    act(() => {
      result.current.auth.clearSession();
    });

    expect(result.current.payments.subscription).toBeNull();
  });

  it('E7 canManageBilling is true when user role matches ownershipRole (default owner)', async () => {
    signedInWithSubscription();
    const { result } = renderHook(() => usePayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.subscription).not.toBeNull());
    expect(result.current.canManageBilling).toBe(true);
  });

  it('E7 canManageBilling is false for a member', async () => {
    const memberUser = { _id: 'b@c.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'member' } } as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(memberUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'member' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const { result } = renderHook(() => usePayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.subscription).not.toBeNull());
    expect(result.current.canManageBilling).toBe(false);
  });

  it('E7 canManageBilling respects custom ownershipRole', async () => {
    const customConfig = { apiBaseUrl: 'https://x.restheart.com', payments: true, ownershipRole: 'admin' };
    const customWrapper = ({ children }: { children: ReactNode }) => (
      <RhAuthProvider config={customConfig}>
        <RhPaymentsProvider config={customConfig}>{children}</RhPaymentsProvider>
      </RhAuthProvider>
    );

    const adminUser = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'admin' } } as unknown as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(adminUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'admin' }] as unknown as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const { result } = renderHook(() => usePayments(), { wrapper: customWrapper });
    await waitFor(() => expect(result.current.subscription).not.toBeNull());
    expect(result.current.canManageBilling).toBe(true);
  });

  it('E8 checkout returning 409: error reaches caller, state unchanged', async () => {
    signedInWithSubscription();
    vi.mocked(kit.createCheckoutSession).mockRejectedValue({ status: 409, message: 'already subscribed' });

    const { result } = renderHook(() => usePayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.subscription).not.toBeNull());

    await expect(result.current.createCheckoutSession('gold', 'month')).rejects.toMatchObject({ status: 409 });
    expect(result.current.subscription).not.toBeNull();
  });

  it('E9 waitForSubscription updates subscription on resolve', async () => {
    signedInWithSubscription();
    const newSub = { ...subscriptionFixture, plan: 'platinum', active: true };
    vi.mocked(kit.waitForSubscription).mockResolvedValue(newSub);

    const { result } = renderHook(() => usePayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.subscription).not.toBeNull());

    await act(async () => {
      const sub = await result.current.waitForSubscription(s => s.plan === 'platinum');
      expect(sub.plan).toBe('platinum');
    });

    expect(result.current.plan).toBe('platinum');
  });

  it('E10 updateProfile does not reload the subscription — the profile is not team state', async () => {
    signedInWithSubscription();
    vi.mocked(kit.updateProfile).mockResolvedValue(undefined);

    const { result } = renderHook(() => useAuthAndPayments(), { wrapper: paymentsWrapper });
    await waitFor(() => expect(result.current.auth.isAuthenticated).toBe(true));
    await waitFor(() => expect(result.current.payments.subscription).not.toBeNull());

    vi.mocked(kit.getSubscription).mockClear();
    await act(async () => {
      await result.current.auth.updateProfile({ firstName: 'New' });
    });

    // updateProfile re-runs checkSession, which hands back a fresh user
    // document with the same team — no reason to re-read the subscription.
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });
});

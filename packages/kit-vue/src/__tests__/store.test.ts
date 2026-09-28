import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as kit from '@ulabase/kit';
import { createRhAuthStore } from '../store';
import { createRhPaymentsStore } from '../payments';

// The core is separately integration-tested against a live instance; here we
// mock it and assert only the store's reactive wiring.
vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'owner' } } as kit.UserInfo;

function signedIn(teams: unknown[] = [{ id: { $oid: '1' }, role: 'owner' }]) {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue(teams as kit.TeamMembership[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null); // signed-out by default
});

describe('bootstrap', () => {
  it('A1 starts unauthenticated with NO HTTP call when there is no token', async () => {
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.initializing.value).toBe(false));
    expect(s.user.value).toBeNull();
    expect(s.isAuthenticated.value).toBe(false);
    expect(kit.checkSession).not.toHaveBeenCalled();
  });

  it('A2 loads user and teams when a token exists', async () => {
    signedIn();
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
    expect(s.user.value?._id).toBe('a@b.com');
    expect(s.teams.value).toHaveLength(1);
  });
});

describe('methods update state', () => {
  it('A3 login sets the user and also loads teams', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);

    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.initializing.value).toBe(false));
    await s.login('a@b.com', 'pw');

    expect(s.user.value?._id).toBe('a@b.com');
    expect(s.teams.value).toHaveLength(2);
    expect(s.hasMultipleTeams.value).toBe(true);
    expect(kit.login).toHaveBeenCalledWith(config, 'a@b.com', 'pw', 'bearer');
  });

  it('A4 logout clears user and teams', async () => {
    signedIn();
    vi.mocked(kit.logout).mockResolvedValue(undefined);
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
    await s.logout();
    expect(s.user.value).toBeNull();
    expect(s.teams.value).toHaveLength(0);
  });

  it('A5 switchTeam re-checks the session', async () => {
    signedIn();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
    vi.mocked(kit.checkSession).mockClear();
    await s.switchTeam({ $oid: '2' });
    expect(kit.switchTeam).toHaveBeenCalledWith(config, { $oid: '2' }, 'bearer');
    expect(kit.checkSession).toHaveBeenCalledOnce();
  });

  it('A7 acceptInvite reloads teams', async () => {
    signedIn([{ id: { $oid: '1' }, role: 'owner' }]);
    vi.mocked(kit.acceptInvite).mockResolvedValue(undefined);
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);
    await s.acceptInvite('invite-token');
    expect(s.teams.value).toHaveLength(2);
  });

  it('A8 clearSession wipes state and the token', async () => {
    signedIn();
    const s = createRhAuthStore(config);
    await vi.waitFor(() => expect(s.isAuthenticated.value).toBe(true));
    s.clearSession();
    expect(kit.clearToken).toHaveBeenCalledOnce();
    expect(kit.cancelRefresh).toHaveBeenCalledOnce();
    expect(s.user.value).toBeNull();
    expect(s.teams.value).toHaveLength(0);
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

function signedInWithSubscription(teams: unknown[] = [{ id: { $oid: '1' }, role: 'owner' }]) {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockImplementation(async () => ({ ...user }));
  vi.mocked(kit.getTeams).mockResolvedValue(teams as kit.TeamMembership[]);
  vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);
}

describe('E. Payments', () => {
  it('E1 bootstrap without payments: no call to /stripe/*, subscription stays null', async () => {
    signedIn();
    const auth = createRhAuthStore(config);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    // No payments store created — payments disabled
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });

  it('E2 bootstrap with payments, session valid: loads subscription', async () => {
    signedInWithSubscription();
    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());
    expect(payments.plan.value).toBe('gold');
    expect(payments.isSubscribed.value).toBe(true);
    expect(payments.seatsAvailable.value).toBe(7);
    expect(kit.getSubscription).toHaveBeenCalled();
  });

  it('E3 login with payments: loads subscription in the same flow', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'owner' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.initializing.value).toBe(false));
    await auth.login('a@b.com', 'pw');

    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());
    expect(payments.plan.value).toBe('gold');
  });

  it('E4 switchTeam reloads subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    // Update mocks BEFORE switchTeam — the watch fires during checkSession.
    // switchTeam re-checks the session and the server answers with the user
    // carrying the *new* team; that team change is what triggers the reload.
    const newSub = { ...subscriptionFixture, plan: 'silver', active: true };
    vi.mocked(kit.getSubscription).mockResolvedValue(newSub);
    vi.mocked(kit.checkSession).mockImplementation(async () => ({
      ...user,
      team: { _id: { $oid: '2' }, role: 'owner' },
    }));

    await auth.switchTeam({ $oid: '2' });
    await vi.waitFor(() => expect(payments.plan.value).toBe('silver'));
  });

  it('E5 logout clears subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    await auth.logout();
    await vi.waitFor(() => expect(payments.subscription.value).toBeNull());
    expect(payments.plan.value).toBeNull();
    expect(payments.isSubscribed.value).toBe(false);
  });

  it('E6 clearSession clears subscription', async () => {
    signedInWithSubscription();
    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    auth.clearSession();
    await vi.waitFor(() => expect(payments.subscription.value).toBeNull());
  });

  it('E7 canManageBilling is true when user role matches ownershipRole (default owner)', async () => {
    signedInWithSubscription();
    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    expect(payments.canManageBilling.value).toBe(true);
  });

  it('E7 canManageBilling is false for a member', async () => {
    const memberUser = { _id: 'b@c.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'member' } } as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(memberUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'member' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    expect(payments.canManageBilling.value).toBe(false);
  });

  it('E7 canManageBilling respects custom ownershipRole', async () => {
    const customConfig = { apiBaseUrl: 'https://x.restheart.com', payments: true, ownershipRole: 'admin' };
    const adminUser = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'admin' } } as unknown as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(adminUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'admin' }] as unknown as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const auth = createRhAuthStore(customConfig);
    const payments = createRhPaymentsStore(customConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    expect(payments.canManageBilling.value).toBe(true);
  });

  it('E8 checkout returning 409: error reaches caller, state unchanged', async () => {
    signedInWithSubscription();
    vi.mocked(kit.createCheckoutSession).mockRejectedValue({ status: 409, message: 'already subscribed' });

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    await expect(payments.createCheckoutSession('gold', 'month')).rejects.toMatchObject({ status: 409 });
    expect(payments.subscription.value).not.toBeNull();
  });

  it('E9 waitForSubscription updates subscription on resolve', async () => {
    signedInWithSubscription();
    const newSub = { ...subscriptionFixture, plan: 'platinum', active: true };
    vi.mocked(kit.waitForSubscription).mockResolvedValue(newSub);

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    const result = await payments.waitForSubscription(sub => sub.plan === 'platinum');
    expect(result.plan).toBe('platinum');
    expect(payments.plan.value).toBe('platinum');
  });

  it('E10 updateProfile does not reload the subscription — the profile is not team state', async () => {
    signedInWithSubscription();
    vi.mocked(kit.updateProfile).mockResolvedValue(undefined);

    const auth = createRhAuthStore(paymentsConfig);
    const payments = createRhPaymentsStore(paymentsConfig, auth.user);
    await vi.waitFor(() => expect(auth.isAuthenticated.value).toBe(true));
    await vi.waitFor(() => expect(payments.subscription.value).not.toBeNull());

    vi.mocked(kit.getSubscription).mockClear();
    await auth.updateProfile({ firstName: 'New' });
    await new Promise(r => setTimeout(r, 0));

    // updateProfile re-runs checkSession, which hands back a fresh user
    // document with the same team — no reason to re-read the subscription.
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });
});

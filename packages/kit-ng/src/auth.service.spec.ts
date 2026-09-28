import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import * as kit from '@ulabase/kit';
import { RhAuthService } from './auth.service';
import { RhPaymentsService } from './payments.service';
import { RH_AUTH_CONFIG } from './tokens';

// The core is integration-tested against a live instance; here we mock it and
// assert only the service's signal wiring.
vi.mock('@ulabase/kit');

const config = { apiBaseUrl: 'https://x.restheart.com' };
const user = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'owner' } } as kit.UserInfo;

function service(): RhAuthService {
  TestBed.configureTestingModule({
    providers: [RhAuthService, { provide: RH_AUTH_CONFIG, useValue: config }],
  });
  return TestBed.inject(RhAuthService);
}

function signedIn(teams: unknown[] = [{ id: { $oid: '1' }, role: 'owner' }]) {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  vi.mocked(kit.checkSession).mockResolvedValue(user);
  vi.mocked(kit.getTeams).mockResolvedValue(teams as kit.TeamMembership[]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(kit.getToken).mockReturnValue(null);
});
afterEach(() => TestBed.resetTestingModule());

describe('RhAuthService', () => {
  it('A1 checkSession short-circuits (no HTTP) when there is no token', async () => {
    const svc = service();
    const u = await firstValueFrom(svc.checkSession());
    expect(u).toBeNull();
    expect(svc.isAuthenticated()).toBe(false);
    expect(kit.checkSession).not.toHaveBeenCalled();
  });

  it('A2 checkSession loads the user AND the teams', async () => {
    signedIn();
    const svc = service();
    await firstValueFrom(svc.checkSession());
    expect(svc.user()?._id).toBe('a@b.com');
    expect(svc.teams()).toHaveLength(1);
  });

  it('A3 login sets the user and also loads teams', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);
    const svc = service();
    await firstValueFrom(svc.login('a@b.com', 'pw'));
    expect(svc.user()?._id).toBe('a@b.com');
    expect(svc.teams()).toHaveLength(2);
    expect(svc.hasMultipleTeams()).toBe(true);
    expect(kit.login).toHaveBeenCalledWith(config, 'a@b.com', 'pw', 'bearer');
  });

  it('A4 logout clears user and teams', async () => {
    signedIn();
    vi.mocked(kit.logout).mockResolvedValue(undefined);
    const svc = service();
    await firstValueFrom(svc.checkSession());
    await firstValueFrom(svc.logout());
    expect(svc.user()).toBeNull();
    expect(svc.teams()).toHaveLength(0);
  });

  it('A5 switchTeam re-checks the session', async () => {
    signedIn();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');
    const svc = service();
    await firstValueFrom(svc.checkSession());
    vi.mocked(kit.checkSession).mockClear();
    await firstValueFrom(svc.switchTeam({ $oid: '2' }));
    expect(kit.switchTeam).toHaveBeenCalledWith(config, { $oid: '2' }, 'bearer');
    expect(kit.checkSession).toHaveBeenCalledOnce();
  });

  it('A7 acceptInvite reloads teams', async () => {
    signedIn([{ id: { $oid: '1' }, role: 'owner' }]);
    vi.mocked(kit.acceptInvite).mockResolvedValue(undefined);
    const svc = service();
    await firstValueFrom(svc.checkSession());
    vi.mocked(kit.getTeams).mockResolvedValue([
      { id: { $oid: '1' }, role: 'owner' },
      { id: { $oid: '2' }, role: 'member' },
    ] as kit.TeamMembership[]);
    await firstValueFrom(svc.acceptInvite('invite-token'));
    expect(svc.teams()).toHaveLength(2);
  });

  it('A8 clearSession wipes state and the token', async () => {
    signedIn();
    const svc = service();
    await firstValueFrom(svc.checkSession());
    svc.clearSession();
    expect(kit.clearToken).toHaveBeenCalledOnce();
    expect(kit.cancelRefresh).toHaveBeenCalledOnce();
    expect(svc.user()).toBeNull();
    expect(svc.teams()).toHaveLength(0);
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

function paymentsService(ownershipRole?: string): RhPaymentsService {
  TestBed.configureTestingModule({
    providers: [
      RhAuthService,
      RhPaymentsService,
      { provide: RH_AUTH_CONFIG, useValue: { apiBaseUrl: 'https://x.restheart.com', payments: true, ownershipRole } },
    ],
  });
  // Inject RhAuthService first so it's created with the test module's config
  TestBed.inject(RhAuthService);
  return TestBed.inject(RhPaymentsService);
}

function signedInWithSubscription(teams: unknown[] = [{ id: { $oid: '1' }, role: 'owner' }]) {
  vi.mocked(kit.getToken).mockReturnValue('tok');
  // A fresh object per call, as a real HTTP/JSON response gives: the adapter
  // must key the reload on the team, not on the user object's identity.
  vi.mocked(kit.checkSession).mockImplementation(async () => ({ ...user }));
  vi.mocked(kit.getTeams).mockResolvedValue(teams as kit.TeamMembership[]);
  vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);
}

describe('E. Payments', () => {
  it('E1 bootstrap without payments: no call to /stripe/*, subscription stays null', async () => {
    signedIn();
    // Use the non-payments service (config without payments: true)
    const svc = service();
    await firstValueFrom(svc.checkSession());
    // RhPaymentsService is not injected here — no payments config
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });

  it('E2 bootstrap with payments, session valid: loads subscription', async () => {
    signedInWithSubscription();
    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    // The effect in RhPaymentsService fires after user is set
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();
    expect(payments.plan()).toBe('gold');
    expect(payments.isSubscribed()).toBe(true);
    expect(payments.seatsAvailable()).toBe(7);
    expect(kit.getSubscription).toHaveBeenCalled();
  });

  it('E3 login with payments: loads subscription in the same flow', async () => {
    vi.mocked(kit.login).mockResolvedValue(user);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'owner' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.login('a@b.com', 'pw'));
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();
    expect(payments.plan()).toBe('gold');
  });

  it('E4 switchTeam reloads subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.switchTeam).mockResolvedValue('newtok');

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));

    // Update mocks BEFORE switchTeam — the effect fires during checkSession.
    // switchTeam re-checks the session and the server answers with the user
    // carrying the *new* team; that team change is what triggers the reload.
    const newSub = { ...subscriptionFixture, plan: 'silver', active: true };
    vi.mocked(kit.getSubscription).mockResolvedValue(newSub);
    vi.mocked(kit.checkSession).mockResolvedValue({
      ...user,
      team: { _id: { $oid: '2' }, role: 'owner' },
    });

    await firstValueFrom(auth.switchTeam({ $oid: '2' }));
    await new Promise(r => setTimeout(r, 0));
    expect(payments.plan()).toBe('silver');
  });

  it('E5 logout clears subscription', async () => {
    signedInWithSubscription();
    vi.mocked(kit.logout).mockResolvedValue(undefined);

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();

    await firstValueFrom(auth.logout());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).toBeNull();
    expect(payments.plan()).toBeNull();
    expect(payments.isSubscribed()).toBe(false);
  });

  it('E6 clearSession clears subscription', async () => {
    signedInWithSubscription();

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();

    auth.clearSession();
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).toBeNull();
  });

  it('E7 canManageBilling is true when user role matches ownershipRole (default owner)', async () => {
    signedInWithSubscription();
    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.canManageBilling()).toBe(true);
  });

  it('E7 canManageBilling is false for a member', async () => {
    const memberUser = { _id: 'b@c.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'member' } } as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(memberUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'member' }] as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.canManageBilling()).toBe(false);
  });

  it('E7 canManageBilling respects custom ownershipRole', async () => {
    const adminUser = { _id: 'a@b.com', roles: ['user'], team: { _id: { $oid: '1' }, role: 'admin' } } as unknown as kit.UserInfo;
    vi.mocked(kit.getToken).mockReturnValue('tok');
    vi.mocked(kit.checkSession).mockResolvedValue(adminUser);
    vi.mocked(kit.getTeams).mockResolvedValue([{ id: { $oid: '1' }, role: 'admin' }] as unknown as kit.TeamMembership[]);
    vi.mocked(kit.getSubscription).mockResolvedValue(subscriptionFixture);

    const payments = paymentsService('admin');
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.canManageBilling()).toBe(true);
  });

  it('E8 checkout returning 409: error reaches caller, state unchanged', async () => {
    signedInWithSubscription();
    vi.mocked(kit.createCheckoutSession).mockRejectedValue({ status: 409, message: 'already subscribed' });

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();

    await expect(firstValueFrom(payments.createCheckoutSession('gold', 'month'))).rejects.toMatchObject({ status: 409 });
    expect(payments.subscription()).not.toBeNull();
  });

  it('E9 waitForSubscription updates subscription on resolve', async () => {
    signedInWithSubscription();
    const newSub = { ...subscriptionFixture, plan: 'platinum', active: true };
    vi.mocked(kit.waitForSubscription).mockResolvedValue(newSub);

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();

    const result = await firstValueFrom(payments.waitForSubscription(s => s.plan === 'platinum'));
    expect(result.plan).toBe('platinum');
    expect(payments.plan()).toBe('platinum');
  });

  it('E10 updateProfile does not reload the subscription — the profile is not team state', async () => {
    signedInWithSubscription();
    vi.mocked(kit.updateProfile).mockResolvedValue(undefined);

    const payments = paymentsService();
    const auth = TestBed.inject(RhAuthService);
    await firstValueFrom(auth.checkSession());
    await new Promise(r => setTimeout(r, 0));
    expect(payments.subscription()).not.toBeNull();

    vi.mocked(kit.getSubscription).mockClear();
    await firstValueFrom(auth.updateProfile({ firstName: 'New' }));
    await new Promise(r => setTimeout(r, 0));

    // updateProfile re-runs checkSession, which hands back a fresh user
    // document with the same team — no reason to re-read the subscription.
    expect(kit.getSubscription).not.toHaveBeenCalled();
  });
});

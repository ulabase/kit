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
  CatalogItem,
  CatalogQuery,
  GrantLicenseResult,
  Licenses,
  Order,
  Plan,
  Subscription,
  WaitOptions,
} from '@ulabase/kit';
import { useAuth } from './context.js';

/**
 * The reactive payments surface, shared app-wide through {@link RhPaymentsProvider}.
 *
 * Separated from {@link RhAuth} because payments are not authentication.
 * Reads the current user from {@link useAuth} to derive `canManageBilling`,
 * but owns its own subscription state.
 *
 * Must be placed inside an {@link import('./context.js').RhAuthProvider | RhAuthProvider}.
 */
export interface RhPayments {
  // ── Reactive state ─────────────────────────────────────────────────────
  /** The team's subscription, or `null` if not loaded or payments disabled. */
  subscription: Subscription | null;
  /** The plan id from the subscription, or `null`. */
  plan: string | null;
  /** Whether the team has an active subscription. */
  isSubscribed: boolean;
  /**
   * Whether the current user can manage billing (checkout, portal, licenses).
   *
   * Derived from `user.team.role === ownershipRole` where `ownershipRole`
   * defaults to `'owner'` and is configurable via `config.ownershipRole`.
   */
  canManageBilling: boolean;
  /** Available seats, or `null` if unlimited or no subscription. */
  seatsAvailable: number | null;

  // ── Methods ───────────────────────────────────────────────────────────
  /** Reload the team's subscription. */
  loadSubscription(): Promise<Subscription | null>;
  /** The service's subscription plan catalog. No session required. */
  getPlans(): Promise<{ default_plan: string; plans: Plan[] }>;
  /**
   * Start a Stripe Checkout session.
   *
   * **Rejects with `status: 409`** when the team already has an active
   * subscription — send them to {@link openBillingPortal} instead.
   */
  createCheckoutSession(plan: string, interval: 'month' | 'year'): Promise<{ url: string }>;
  /** Open the Stripe Customer Portal for self-service plan changes. */
  openBillingPortal(): Promise<{ url: string }>;
  /** The team's seat licences. Requires `canManageBilling`. */
  getLicenses(): Promise<Licenses>;
  /**
   * Grant a seat licence. Returns `'granted'` or `'already-licensed'`.
   * Rejects with `status: 409` when no seat is available.
   */
  grantLicense(userId: string): Promise<GrantLicenseResult>;
  /** Revoke a seat licence. */
  revokeLicense(userId: string): Promise<void>;
  /** Read the product catalog. */
  getCatalog(opts?: CatalogQuery): Promise<CatalogItem[]>;
  /**
   * Create an order and start Checkout.
   *
   * @param email Required for guest checkout.
   */
  createOrder(
    items: { productId: string; quantity: number }[],
    email?: string,
    collection?: string
  ): Promise<{ _id: { $oid: string }; checkout_url: string; secret: string }>;
  /** Read an order back. */
  getOrder(id: string, secret?: string, collection?: string): Promise<Order>;
  /**
   * Poll until the subscription satisfies `predicate`.
   *
   * Use on the Checkout success page — the redirect back from Stripe races
   * the webhook, so a bare `getSubscription` can still show the old plan.
   *
   * **Timing out is not a payment failure.** Rejects with
   * `WaitTimeoutError` when the webhook hasn't arrived yet.
   */
  waitForSubscription(
    predicate: (subscription: Subscription) => boolean,
    opts?: WaitOptions
  ): Promise<Subscription>;
  /**
   * Poll until the order leaves `'pending_payment'`.
   *
   * Same race as {@link waitForSubscription} — use on the order success page.
   *
   * **Timing out is not a payment failure.** Rejects with
   * `WaitTimeoutError` when the webhook hasn't arrived yet.
   */
  waitForOrder(id: string, secret?: string, opts?: WaitOptions & { collection?: string }): Promise<Order>;
}

const RhPaymentsContext = createContext<RhPayments | null>(null);

export interface RhPaymentsProviderProps {
  config: AuthConfig;
  children: ReactNode;
}

/**
 * Provides the shared payments state to the tree. Must be placed inside
 * an {@link import('./context.js').RhAuthProvider | RhAuthProvider}.
 *
 * ```tsx
 * <RhAuthProvider config={config}>
 *   <RhPaymentsProvider config={config}>
 *     <App />
 *   </RhPaymentsProvider>
 * </RhAuthProvider>
 * ```
 *
 * When the user becomes authenticated, it loads the subscription automatically.
 * When the user logs out, it clears it.
 */
export function RhPaymentsProvider({ config, children }: RhPaymentsProviderProps): ReactNode {
  const auth = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const configRef = useRef(config);
  configRef.current = config;

  const paymentsEnabled = config.payments === true;
  const ownershipRole = config.ownershipRole ?? 'owner';

  // ── Derived state ──────────────────────────────────────────────────────
  const plan = subscription?.plan ?? null;
  const isSubscribed = subscription?.active ?? false;
  const canManageBilling = auth.user?.team?.role === ownershipRole;
  const seatsAvailable = subscription?.seats?.available ?? null;

  // ── Subscription loader ────────────────────────────────────────────────
  const loadSubscription = useCallback(async (): Promise<Subscription | null> => {
    if (!configRef.current.payments) return null;
    try {
      const sub = await kit.getSubscription(configRef.current);
      setSubscription(sub);
      return sub;
    } catch {
      setSubscription(null);
      return null;
    }
  }, []);

  // The team the subscription belongs to: null when signed out, '' for a
  // signed-in user with no team. The effect below depends on this string
  // rather than on `auth.user` itself — both `updateProfile` and
  // `acceptConsents` re-run `checkSession`, replacing the user with a freshly
  // parsed document, and depending on that object's identity would reload the
  // subscription on every profile edit and consent acceptance. A subscription
  // changes with the team, not with the profile.
  const teamKey = auth.user ? (auth.user.team?._id?.$oid ?? '') : null;

  // Load the subscription on sign-in and on team switch, clear it on sign-out.
  useEffect(() => {
    if (!paymentsEnabled) return;
    if (teamKey === null) {
      setSubscription(null);
    } else {
      loadSubscription();
    }
  }, [teamKey, paymentsEnabled, loadSubscription]);

  // ── Methods ────────────────────────────────────────────────────────────
  const getPlans = useCallback(
    () => kit.getPlans(configRef.current),
    []
  );
  const createCheckoutSession = useCallback(
    (plan: string, interval: 'month' | 'year') =>
      kit.createCheckoutSession(configRef.current, plan, interval),
    []
  );
  const openBillingPortal = useCallback(
    () => kit.openBillingPortal(configRef.current),
    []
  );
  const getLicenses = useCallback(
    () => kit.getLicenses(configRef.current),
    []
  );
  const grantLicense = useCallback(
    (userId: string) => kit.grantLicense(configRef.current, userId),
    []
  );
  const revokeLicense = useCallback(
    (userId: string) => kit.revokeLicense(configRef.current, userId),
    []
  );
  const getCatalog = useCallback(
    (opts?: CatalogQuery) =>
      kit.getCatalog(configRef.current, opts),
    []
  );
  const createOrder = useCallback(
    (items: { productId: string; quantity: number }[], email?: string, collection?: string) =>
      kit.createOrder(configRef.current, items, email, collection),
    []
  );
  const getOrder = useCallback(
    (id: string, secret?: string, collection?: string) =>
      kit.getOrder(configRef.current, id, secret, collection),
    []
  );
  const waitForSubscriptionFn = useCallback(
    (predicate: (s: Subscription) => boolean, opts?: WaitOptions) =>
      kit.waitForSubscription(configRef.current, predicate, opts).then(sub => {
        setSubscription(sub);
        return sub;
      }),
    []
  );
  const waitForOrderFn = useCallback(
    (id: string, secret?: string, opts?: WaitOptions & { collection?: string }) =>
      kit.waitForOrder(configRef.current, id, secret, opts),
    []
  );

  const value = useMemo<RhPayments>(
    () => ({
      subscription,
      plan,
      isSubscribed,
      canManageBilling,
      seatsAvailable,
      loadSubscription,
      getPlans,
      createCheckoutSession,
      openBillingPortal,
      getLicenses,
      grantLicense,
      revokeLicense,
      getCatalog,
      createOrder,
      getOrder,
      waitForSubscription: waitForSubscriptionFn,
      waitForOrder: waitForOrderFn,
    }),
    [
      subscription,
      plan,
      isSubscribed,
      canManageBilling,
      seatsAvailable,
      loadSubscription,
      getPlans,
      createCheckoutSession,
      openBillingPortal,
      getLicenses,
      grantLicense,
      revokeLicense,
      getCatalog,
      createOrder,
      getOrder,
      waitForSubscriptionFn,
      waitForOrderFn,
    ]
  );

  return <RhPaymentsContext.Provider value={value}>{children}</RhPaymentsContext.Provider>;
}

/**
 * Read the shared payments state and methods. Must be called under a
 * {@link RhPaymentsProvider}.
 *
 * ```tsx
 * const payments = usePayments();
 * if (payments.isSubscribed) return <span>Plan: {payments.plan}</span>;
 * ```
 */
export function usePayments(): RhPayments {
  const ctx = useContext(RhPaymentsContext);
  if (ctx === null) {
    throw new Error('usePayments must be used within a <RhPaymentsProvider>');
  }
  return ctx;
}

import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import * as kit from '@ulabase/kit';
import type {
  AuthConfig,
  CatalogItem,
  GrantLicenseResult,
  Licenses,
  Order,
  Plan,
  Subscription,
  UserInfo,
  WaitOptions,
  CatalogQuery,
} from '@ulabase/kit';

/**
 * The reactive payments store. Separated from {@link RhAuthStore} because
 * payments are not authentication.
 *
 * Reads the current user from the auth store to derive `canManageBilling`,
 * but owns its own subscription state.
 *
 * Create it with {@link createRhPayments} and read it with
 * {@link usePayments}.
 */
export interface RhPaymentsStore {
  /** The team's subscription, or `null` if not loaded or payments disabled. */
  readonly subscription: Readonly<Ref<Subscription | null>>;
  /** The plan id from the subscription, or `null`. */
  readonly plan: ComputedRef<string | null>;
  /** Whether the team has an active subscription. */
  readonly isSubscribed: ComputedRef<boolean>;
  /**
   * Whether the current user can manage billing (checkout, portal, licenses).
   *
   * Derived from `user.team.role === ownershipRole` where `ownershipRole`
   * defaults to `'owner'` and is configurable via `config.ownershipRole`.
   */
  readonly canManageBilling: ComputedRef<boolean>;
  /** Available seats, or `null` if unlimited or no subscription. */
  readonly seatsAvailable: ComputedRef<number | null>;

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

/**
 * Build the reactive payments store. The `user` ref should come from the
 * auth store — the payments store watches it to load/clear the subscription.
 */
export function createRhPaymentsStore(
  config: AuthConfig,
  user: Ref<UserInfo | null>
): RhPaymentsStore {
  const subscription = ref<Subscription | null>(null);

  const ownershipRole = config.ownershipRole ?? 'owner';
  const paymentsEnabled = config.payments === true;

  const plan = computed(() => subscription.value?.plan ?? null);
  const isSubscribed = computed(() => subscription.value?.active ?? false);
  const canManageBilling = computed(() => user.value?.team?.role === ownershipRole);
  const seatsAvailable = computed(() => subscription.value?.seats?.available ?? null);

  async function loadSubscription(): Promise<Subscription | null> {
    if (!paymentsEnabled) return null;
    try {
      const sub = await kit.getSubscription(config);
      subscription.value = sub;
      return sub;
    } catch {
      subscription.value = null;
      return null;
    }
  }

  // The team the subscription belongs to: null when signed out, '' for a
  // signed-in user with no team. The watcher below tracks this rather than the
  // user ref itself — both `updateProfile` and `acceptConsents` re-run
  // `checkSession`, replacing the user with a freshly parsed document, and
  // watching that object would reload the subscription on every profile edit
  // and consent acceptance. A subscription changes with the team, not with the
  // profile.
  const teamKey = computed(() => (user.value ? (user.value.team?._id?.$oid ?? '') : null));

  // Load the subscription on sign-in and on team switch, clear it on sign-out.
  if (paymentsEnabled) {
    watch(teamKey, (key) => {
      if (key === null) {
        subscription.value = null;
      } else {
        loadSubscription();
      }
    }, { immediate: true });
  }

  return {
    subscription,
    plan,
    isSubscribed,
    canManageBilling,
    seatsAvailable,

    loadSubscription,
    getPlans: () => kit.getPlans(config),
    createCheckoutSession: (plan, interval) => kit.createCheckoutSession(config, plan, interval),
    openBillingPortal: () => kit.openBillingPortal(config),
    getLicenses: () => kit.getLicenses(config),
    grantLicense: (userId) => kit.grantLicense(config, userId),
    revokeLicense: (userId) => kit.revokeLicense(config, userId),
    getCatalog: (opts) => kit.getCatalog(config, opts),
    createOrder: (items, email, collection) => kit.createOrder(config, items, email, collection),
    getOrder: (id, secret, collection) => kit.getOrder(config, id, secret, collection),
    waitForSubscription: async (predicate, opts) => {
      const sub = await kit.waitForSubscription(config, predicate, opts);
      subscription.value = sub;
      return sub;
    },
    waitForOrder: (id, secret, opts) => kit.waitForOrder(config, id, secret, opts),
  };
}

import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, catchError, from, of, tap } from 'rxjs';
import type {
  AuthConfig,
  CatalogItem,
  GrantLicenseResult,
  Licenses,
  Order,
  Plan,
  Subscription,
  WaitOptions,
  CatalogQuery,
} from '@ulabase/kit';
import * as kit from '@ulabase/kit';
import { RH_AUTH_CONFIG } from './tokens.js';
import { RhAuthService } from './auth.service.js';

/**
 * Subscription, billing and order management.
 *
 * Separated from {@link RhAuthService} because payments are not authentication.
 * Reads the current user from {@link RhAuthService} to derive
 * `canManageBilling`, but owns its own subscription state.
 *
 * Subscription is loaded automatically when the user signs in and reloaded
 * when they switch team (via an `effect` watching {@link teamKey}). No manual
 * wiring needed.
 *
 * Only active when `config.payments` is `true` — otherwise every method
 * is a no-op and no `/stripe/*` call is ever made.
 */
@Injectable({ providedIn: 'root' })
export class RhPaymentsService {
  private readonly config: AuthConfig = inject(RH_AUTH_CONFIG);
  private readonly auth = inject(RhAuthService);

  private readonly _subscription = signal<Subscription | null>(null);

  readonly subscription = this._subscription.asReadonly();
  readonly plan = computed(() => this._subscription()?.plan ?? null);
  readonly isSubscribed = computed(() => this._subscription()?.active ?? false);
  readonly canManageBilling = computed(
    () => this.auth.user()?.team?.role === (this.config.ownershipRole ?? 'owner')
  );
  readonly seatsAvailable = computed(() => this._subscription()?.seats?.available ?? null);

  /**
   * The team the subscription belongs to: `null` when signed out, `''` for a
   * signed-in user with no team.
   *
   * The effect below tracks this rather than `auth.user()` itself. Both
   * `updateProfile` and `acceptConsents` re-run `checkSession`, which replaces
   * the user with a freshly parsed document — tracking that object's identity
   * would reload the subscription on every profile edit and consent
   * acceptance, which the adapter contract rules out. A subscription changes
   * with the team, not with the profile.
   */
  private readonly teamKey = computed(() => {
    const user = this.auth.user();
    return user ? (user.team?._id?.$oid ?? '') : null;
  });

  private get paymentsEnabled(): boolean {
    return this.config.payments === true;
  }

  constructor() {
    if (this.paymentsEnabled) {
      effect(() => {
        const teamKey = this.teamKey();
        untracked(() => {
          if (teamKey === null) {
            this._subscription.set(null);
          } else {
            this.loadSubscription().subscribe();
          }
        });
      });
    }
  }

  /** Reload the team's subscription. No-op when `config.payments` is not `true`. */
  loadSubscription(): Observable<Subscription | null> {
    if (!this.paymentsEnabled) return of(null);
    return from(kit.getSubscription(this.config)).pipe(
      tap(sub => this._subscription.set(sub)),
      catchError(() => {
        this._subscription.set(null);
        return of(null);
      })
    );
  }

  /** The service's subscription plan catalog. No session required. */
  getPlans(): Observable<{ default_plan: string; plans: Plan[] }> {
    return from(kit.getPlans(this.config));
  }

  /**
   * Start a Stripe Checkout session.
   *
   * **Rejects with `status: 409`** when the team already has an active
   * subscription — send them to {@link openBillingPortal} instead.
   */
  createCheckoutSession(plan: string, interval: 'month' | 'year'): Observable<{ url: string }> {
    return from(kit.createCheckoutSession(this.config, plan, interval));
  }

  /** Open the Stripe Customer Portal for self-service plan changes. */
  openBillingPortal(): Observable<{ url: string }> {
    return from(kit.openBillingPortal(this.config));
  }

  /** The team's seat licences. Requires `canManageBilling`. */
  getLicenses(): Observable<Licenses> {
    return from(kit.getLicenses(this.config));
  }

  /**
   * Grant a seat licence. Returns `'granted'` or `'already-licensed'`.
   * Rejects with `status: 409` when no seat is available.
   */
  grantLicense(userId: string): Observable<GrantLicenseResult> {
    return from(kit.grantLicense(this.config, userId));
  }

  /** Revoke a seat licence. */
  revokeLicense(userId: string): Observable<void> {
    return from(kit.revokeLicense(this.config, userId));
  }

  /** Read the product catalog. */
  getCatalog(opts?: CatalogQuery): Observable<CatalogItem[]> {
    return from(kit.getCatalog(this.config, opts));
  }

  /**
   * Create an order and start Checkout.
   *
   * @param email Required for guest checkout.
   */
  createOrder(
    items: { productId: string; quantity: number }[],
    email?: string,
    collection?: string
  ): Observable<{ _id: { $oid: string }; checkout_url: string; secret: string }> {
    return from(kit.createOrder(this.config, items, email, collection));
  }

  /** Read an order back. */
  getOrder(id: string, secret?: string, collection?: string): Observable<Order> {
    return from(kit.getOrder(this.config, id, secret, collection));
  }

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
  ): Observable<Subscription> {
    return from(
      kit.waitForSubscription(this.config, predicate, opts).then(sub => {
        this._subscription.set(sub);
        return sub;
      })
    );
  }

  /**
   * Poll until the order leaves `'pending_payment'`.
   *
   * Same race as {@link waitForSubscription} — use on the order success page.
   *
   * **Timing out is not a payment failure.** Rejects with
   * `WaitTimeoutError` when the webhook hasn't arrived yet.
   */
  waitForOrder(
    id: string,
    secret?: string,
    opts?: WaitOptions & { collection?: string }
  ): Observable<Order> {
    return from(kit.waitForOrder(this.config, id, secret, opts));
  }
}

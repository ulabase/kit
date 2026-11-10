import type { AuthConfig, CatalogItem, Order } from './types.js';
import { apiFetch } from './client.js';
import { WaitTimeoutError, sleep, type WaitOptions } from './payments.js';

/**
 * The catalog, orders and transactions collection names are all configured
 * per service (`stripeConfig.products.*-collection`), not fixed — the request
 * interceptors that create/checkout orders match on the *configured* name, so
 * the HTTP path really does change if a deployment renamed a collection. Every
 * function below takes the collection name as a parameter for this reason;
 * the default matches what the service uses when it hasn't been renamed, it
 * is not a kit-level constant.
 */
const DEFAULT_ORDERS_COLLECTION = 'orders';
const DEFAULT_CATALOG_COLLECTION = 'catalog';

/** The query parameters RESTHeart keeps for itself: never bound as aggregation variables. */
const RESERVED_QPARAMS = new Set([
  'page', 'pagesize', 'count', 'sort_by', 'sort', 'filter', 'hint', 'avars', 'keys', 'cache', 'hal',
  'id_type', 'checkEtag', 'shardkey', 'np', 'rep', 'sid', 'txn', 'jsonMode', 'nocache', 'writeMode',
  'wm', 'writeConcern', 'readConcern', 'readPreference',
]);

// ── Catalog ──────────────────────────────────────────────────────────────────

/** What {@link getCatalog} accepts. Exported so the adapters state one shape. */
export interface CatalogQuery {
    /**
     * Defaults to `'catalog'`: pass the configured `products.catalog-collection`
     * if the service renamed it.
     */
    collection?: string;
    /**
     * An aggregation declared on the catalog collection: the catalog is then
     * read through `GET /{collection}/_aggrs/{aggregation}`.
     *
     * The way to narrow the catalog. A paged list cannot be narrowed afterwards
     * (that searches the page, not the catalog), and the service does not take a
     * client's own query: `?filter=` is off on the service nodes unless a
     * permission sets `mongo.allowFilter`, because a free query also questions
     * the fields a permission hides. The aggregation is the query, written once
     * on the service; the client only brings its values, in {@link vars}.
     *
     * ```ts
     * getCatalog(config, { aggregation: 'shop', vars: { category: 'desk' } });
     * ```
     *
     * A permission's `readFilter` does not apply to an aggregation: the
     * pipeline has to state which documents it may return.
     */
    aggregation?: string;
    /**
     * The values of the aggregation's variables, each sent as a query
     * parameter in JSON: a string of digits stays a string, a number a number.
     * A name RESTHeart reserves for itself (`filter`, `sort`, `page`...) is
     * refused, since it would not reach the pipeline as a variable.
     */
    vars?: Record<string, unknown>;
    pagesize?: number;
    page?: number;
}

/**
 * Reads the product catalog: a MongoDB collection read, or one of its
 * aggregations, not a dedicated endpoint. Without an aggregation, the plain
 * list in the collection's default order, paged with `page` and `pagesize`:
 * what the permission's `readFilter` lets through, which needs no query. What this returns and what access it
 * requires are the deployment's own ACL and pipeline (only what is for sale,
 * pagination, projections: none of that is the kit's to decide).
 */
export async function getCatalog(
  config: AuthConfig,
  opts?: CatalogQuery
): Promise<CatalogItem[]> {
  const collection = opts?.collection ?? DEFAULT_CATALOG_COLLECTION;
  const params = new URLSearchParams();
  if (opts?.pagesize !== undefined) params.set('pagesize', String(opts.pagesize));
  if (opts?.page !== undefined) params.set('page', String(opts.page));
  for (const [name, value] of Object.entries(opts?.vars ?? {})) {
    if (RESERVED_QPARAMS.has(name)) throw new Error(`getCatalog: "${name}" is a RESTHeart query parameter, not a variable name`);
    if (value !== undefined) params.set(name, JSON.stringify(value));
  }
  const qs = params.toString();
  const path = opts?.aggregation
    ? `/${collection}/_aggrs/${encodeURIComponent(opts.aggregation)}`
    : `/${collection}`;

  const res = await apiFetch(config, `${path}${qs ? `?${qs}` : ''}`);
  return res.json() as Promise<CatalogItem[]>;
}

/**
 * Reads one product by id: `GET /{collection}/{id}`, under the same permission
 * as the list. A product the permission does not let through answers 404 or
 * 403, as a withdrawn one does.
 *
 * @param collection Defaults to `'catalog'`: pass the configured
 *                    `products.catalog-collection` if the service renamed it.
 */
export async function getCatalogItem(
  config: AuthConfig,
  id: string,
  collection: string = DEFAULT_CATALOG_COLLECTION
): Promise<CatalogItem> {
  const res = await apiFetch(config, `/${collection}/${encodeURIComponent(id)}`);
  return res.json() as Promise<CatalogItem>;
}

// ── Orders ───────────────────────────────────────────────────────────────────

/**
 * Creates an order and starts Checkout for it — `window.location.href =
 * checkout_url`, same as {@link createCheckoutSession} for subscriptions.
 *
 * Prices come from `catalogItem.unitAmount` on the server, resolved from
 * `productId` at the moment of the call — never from anything this function
 * is passed, so there is no client-suppliable price to tamper with.
 *
 * @param email      Required for a guest checkout; the deployment's ACL
 *                    decides whether an unauthenticated request is allowed at
 *                    all (see the products guide's guest-checkout example).
 *                    Omit when the caller is authenticated.
 * @param collection Defaults to `'orders'` — pass the configured
 *                    `products.orders-collection` if the service renamed it.
 */
/**
 * One line of an order as the service takes it.
 *
 * `metadata` is the shop's own labels for this line — what a variant is, a
 * gift message, an engraving. The service stores it on the order line and
 * passes it to Stripe, where it shows on the dashboard, the receipt and the
 * invoice; the keys are whatever the shop chose, since only the shop knows
 * what they mean. At most 50 of them, keys under 40 characters and values
 * under 500, which are Stripe's limits and so ours.
 *
 * It has to travel from the client because the service cannot infer it: a
 * variant reference identifies which row of the catalog was bought, not which
 * of its fields the seller wants to read on a packing slip.
 */
export interface OrderItem {
  productId: string;
  quantity: number;
  metadata?: Record<string, string>;
}

export async function createOrder(
  config: AuthConfig,
  items: OrderItem[],
  email?: string,
  collection: string = DEFAULT_ORDERS_COLLECTION
): Promise<{ _id: { $oid: string }; checkout_url: string; secret: string }> {
  const body: Record<string, unknown> = { items };
  if (email) body['email'] = email;

  const res = await apiFetch(config, `/${collection}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ _id: { $oid: string }; checkout_url: string; secret: string }>;
}

/**
 * Reads an order back.
 *
 * @param secret     The guest checkout path: no session, the secret
 *                    {@link createOrder} returned proves ownership instead.
 *                    Harmless to pass alongside a session too — `apiFetch`
 *                    still attaches the bearer token if there is one.
 * @param collection Defaults to `'orders'` — pass the configured
 *                    `products.orders-collection` if the service renamed it.
 */
export async function getOrder(
  config: AuthConfig,
  id: string,
  secret?: string,
  collection: string = DEFAULT_ORDERS_COLLECTION
): Promise<Order> {
  const qs = secret ? `?secret=${encodeURIComponent(secret)}` : '';
  const res = await apiFetch(config, `/${collection}/${encodeURIComponent(id)}${qs}`);
  return res.json() as Promise<Order>;
}

/** An order reference recovered from the Checkout return URL. */
export interface OrderRef {
  id: string;
  /** Absent when the deployment only interpolates `{ORDER_ID}`. */
  secret?: string;
}

/**
 * Reads the order reference Stripe's redirect brought back.
 *
 * Stripe substitutes only `{CHECKOUT_SESSION_ID}` in the success URL, so on its
 * own the return page learns nothing about *which* order it is showing — and a
 * guest has no session for the server to recognise them by. RESTHeart's `stripe`
 * plugin fills that gap: configure `products.success-url` with `{ORDER_ID}` and
 * `{ORDER_SECRET}` and it interpolates them when it creates the session.
 *
 * ```
 * success-url: https://shop.example.com/order#order={ORDER_ID}&secret={ORDER_SECRET}
 * ```
 *
 * This reads the **fragment first, then the query string**, because that is the
 * order of preference for putting them there. A fragment never leaves the
 * browser: it is absent from access logs, proxy logs and `Referer` headers,
 * which matters because the secret is a bearer credential — it is the only thing
 * standing between a stranger and a guest's order, email and shipping address
 * included.
 *
 * Returns `null` when neither carries an order id, which is the normal answer on
 * a deployment that has not configured the placeholders. Callers should keep
 * whatever fallback they had (see the ecommerce starter, which stashes the
 * reference in `localStorage` before redirecting).
 *
 * ```ts
 * const ref = readOrderRef();          // reads window.location
 * if (ref) {
 *   clearOrderRef();                   // strip it from the address bar
 *   const order = await waitForOrder(config, ref.id, ref.secret);
 * }
 * ```
 *
 * @param url Defaults to `window.location.href`. Pass one explicitly to test,
 *            or on a server, where there is no `window`.
 */
export function readOrderRef(url?: string): OrderRef | null {
  const href = url ?? (typeof window !== 'undefined' ? window.location.href : '');
  if (!href) return null;

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  // The fragment is the recommended placement, so it wins when both are present.
  const fromFragment = new URLSearchParams(parsed.hash.replace(/^#/, ''));
  const fromQuery = parsed.searchParams;

  for (const params of [fromFragment, fromQuery]) {
    const id = params.get('order');
    if (id) {
      const secret = params.get('secret');
      return secret ? { id, secret } : { id };
    }
  }

  return null;
}

/**
 * Strips the order reference from the address bar, leaving the rest of the URL
 * alone.
 *
 * Call it as soon as {@link readOrderRef} has the values. A secret sitting in
 * the address bar is one screenshot, one shared link or one bookmark away from
 * being someone else's — and it stays in session history until it is replaced.
 *
 * No-op outside a browser.
 */
export function clearOrderRef(): void {
  if (typeof window === 'undefined' || !window.history?.replaceState) return;

  const url = new URL(window.location.href);

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  fragment.delete('order');
  fragment.delete('secret');
  const remainingHash = fragment.toString();
  url.hash = remainingHash ? `#${remainingHash}` : '';

  url.searchParams.delete('order');
  url.searchParams.delete('secret');

  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
}

/**
 * Polls {@link getOrder} until it leaves `'pending_payment'` — the products
 * counterpart of `waitForSubscription`, for the same reason: the redirect
 * back from Checkout races Stripe's webhook, so a success page that reads the
 * order the moment it mounts can still see `'pending_payment'` on an order
 * that already succeeded.
 *
 * The first check runs immediately, before any wait — see
 * `waitForSubscription`'s doc for why.
 *
 * **Timing out is not a failed payment.** Same distinction as
 * `waitForSubscription`: this rejects with a {@link WaitTimeoutError}, kept
 * separate from `ApiError` so "the order failed" and "we haven't heard back
 * yet" never collapse into the same error screen.
 *
 * ```ts
 * // on the order success page
 * const order = await waitForOrder(config, orderId, secret);
 * if (order.status === 'paid') showConfirmation(order);
 * ```
 */
export async function waitForOrder(
  config: AuthConfig,
  id: string,
  secret?: string,
  opts: WaitOptions & { collection?: string } = {}
): Promise<Order> {
  const { timeoutMs = 30_000, intervalMs = 1_000, signal, collection } = opts;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    signal?.throwIfAborted();
    const order = await getOrder(config, id, secret, collection);
    if (order.status !== 'pending_payment') return order;

    if (Date.now() >= deadline) {
      throw new WaitTimeoutError(
        `waitForOrder: order ${id} still pending_payment after ${timeoutMs}ms — the payment may have succeeded; the webhook may just be late`
      );
    }
    await sleep(intervalMs, signal);
  }
}

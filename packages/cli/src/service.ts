import { getTokenExpiry } from '@ulabase/kit';
import type { AdminClient } from './admin.js';
import { existsOr404, request } from './http.js';
import { resolveEnvRefs, defaultEnv } from './env.js';

/**
 * A document as RESTHeart stores it. Loose on purpose: an ACL permission, a
 * user and a collection's metadata have nothing in common but being documents,
 * and a type that tried to describe all three would describe none of them.
 */
export type Document = Record<string, unknown>;

/** The `keys` of a MongoDB index — `{ field: 1 }`, `{ field: 'text' }`. */
export type IndexKeys = Record<string, unknown>;

export interface ServiceClient {
  /** The service this client configures. */
  readonly srvId: string;

  /** The service's base URL, once a token has been minted. */
  url(): Promise<string>;

  collectionExists(name: string): Promise<boolean>;
  createCollection(name: string, meta?: Document): Promise<void>;

  indexExists(coll: string, id: string): Promise<boolean>;
  createIndex(coll: string, id: string, keys: IndexKeys, opts?: Document): Promise<void>;

  permissionExists(id: string): Promise<boolean>;
  putPermission(id: string, doc: Document): Promise<void>;

  userExists(id: string): Promise<boolean>;
  createUser(id: string, doc: Document): Promise<void>;

  schemaExists(coll: string): Promise<boolean>;
  putSchema(coll: string, schema: Document): Promise<void>;

  /** An escape hatch for what the table above does not cover. Path is service-relative. */
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

/** How close to expiry a cached token is considered spent. */
const RENEW_MARGIN_MS = 60_000;

/**
 * A client over a service node, derived from the admin client because that is
 * where its token comes from.
 *
 * The token is the reason this owns rather than exposes it. `/jwt` mints
 * through the admin node's `jwtIssuer`, whose TTL is **fifteen minutes** — and
 * a run that installs a plugin, waits for its `init`, creates collections and
 * writes permissions can outlive that. A caller handed a token would die
 * mid-run with a `401` that reads like a permissions problem, against a service
 * left half-configured. So: fetched lazily, cached, renewed a minute before it
 * expires, and never returned.
 */
export function createServiceClient(admin: AdminClient, srvId: string): ServiceClient {
  let cached: { token: string; url: string; expiresAt: number } | null = null;
  let inFlight: Promise<{ token: string; url: string }> | null = null;

  async function credentials(): Promise<{ token: string; url: string }> {
    if (cached && Date.now() < cached.expiresAt - RENEW_MARGIN_MS) {
      return { token: cached.token, url: cached.url };
    }
    // Steps run in sequence, but a setup is free to fan out inside one `apply`.
    // Sharing the in-flight mint keeps that from becoming a burst of identical
    // `/jwt` calls the moment a token turns over.
    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const { token, url } = await admin.serviceToken(srvId);
        const exp = getTokenExpiry(token);
        // A token whose `exp` we cannot read is still a usable token; assume the
        // shortest TTL the admin node issues rather than treating it as expired.
        cached = { token, url, expiresAt: exp ?? Date.now() + 15 * 60_000 };
        return { token, url };
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    const { token, url } = await credentials();
    return request(url, path, { ...init, token }, admin.config.transport);
  }

  /**
   * Serialise a body, resolving `fromEnv` markers on the way out.
   *
   * The admin client is not the only place a setup can want a secret: a user
   * document has a password, a permission can carry a token. Without this a
   * marker would reach `JSON.stringify` and, but for its `toJSON` guard, be
   * written as `{"name":"…"}` — an object where the secret should be, with no
   * error to notice. Resolution stays where it was: as late as possible, in the
   * call that puts the value on the wire and nowhere else.
   */
  const body = (value: unknown): string =>
    JSON.stringify(resolveEnvRefs(value, admin.env ?? defaultEnv()));

  const seg = (s: string) => encodeURIComponent(s);

  /**
   * `PUT` on a **document** creates it only with `?wm=upsert`.
   *
   * Without it RESTHeart's write mode is `update`, and an update of something
   * that is not there answers `404` — not "created". So every step that puts a
   * permission, a user or a schema failed on a service where it did not already
   * exist, which is precisely the service a setup is run against.
   *
   * It is also exactly what a setup wants semantically: a step is a check and an
   * apply, and a re-run must be able to write the same document again without
   * failing. `upsert` is the idempotent verb.
   *
   * Collections and indexes do **not** need this — `PUT /{coll}` and
   * `PUT /{coll}/_indexes/{id}` create on their own — so it is applied here per
   * call rather than globally, where it would be a lie about the other two.
   */
  const upsert = (path: string) => `${path}?wm=upsert`;

  return {
    srvId,

    url: async () => (await credentials()).url,

    collectionExists: (name) => existsOr404(() => send(`/${seg(name)}`)),

    async createCollection(name, meta) {
      await send(`/${seg(name)}`, {
        method: 'PUT',
        body: body(meta ?? {}),
      });
    },

    async indexExists(coll, id) {
      // RESTHeart has no `GET /{coll}/_indexes/{id}` — the collection's indexes
      // come back as one array, and a missing collection is a 404 here too,
      // which is the right answer: no collection, no index.
      const found = await existsOr404(async () => {
        const res = await send(`/${seg(coll)}/_indexes`);
        const indexes = (await res.json()) as Array<{ _id?: string }>;
        if (!indexes.some(i => i._id === id)) throw { status: 404, message: 'index not found' };
      });
      return found;
    },

    async createIndex(coll, id, keys, opts) {
      await send(`/${seg(coll)}/_indexes/${seg(id)}`, {
        method: 'PUT',
        body: body({ keys, ...(opts ? { ops: opts } : {}) }),
      });
    },

    permissionExists: (id) => existsOr404(() => send(`/acl/${seg(id)}`)),

    async putPermission(id, doc) {
      await send(upsert(`/acl/${seg(id)}`), { method: 'PUT', body: body(doc) });
    },

    userExists: (id) => existsOr404(() => send(`/users/${seg(id)}`)),

    async createUser(id, doc) {
      await send(upsert(`/users/${seg(id)}`), { method: 'PUT', body: body(doc) });
    },

    schemaExists: (coll) => existsOr404(() => send(`/schemas/${seg(coll)}`)),

    async putSchema(coll, schema) {
      await send(upsert(`/schemas/${seg(coll)}`), { method: 'PUT', body: body(schema) });
    },

    fetch: send,
  };
}

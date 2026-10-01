# @ulabase/cli

Set up a Ulabase service from a file committed to git.

A developer who forks a starter gets working code and an unconfigured service. What follows is
clicking: create the catalog collection, add an index, write the ACL permission that lets a guest
`POST` an order, install the `stripe` feature, fill in its keys, set the success URL. None of that
is in version control, none of it can be re-run against a second service, and the failure mode is
quiet — a missing anonymous `GET /catalog` permission shows up as *an empty shop, no error*.

This package makes it a file:

```ts
// ulabase.setup.ts
import { defineSetup, step } from '@ulabase/cli';

export default defineSetup('Shop', [
  step('catalog collection', {
    check: ({ service }) => service.collectionExists('catalog'),
    apply: ({ service }) => service.createCollection('catalog'),
  }),
  step('guests may read the catalog', {
    check: ({ service }) => service.permissionExists('catalog-read-anon'),
    apply: ({ service }) => service.putPermission('catalog-read-anon', {
      predicate: "path(/catalog) and method(GET)",
      roles: ['$unauthenticated'],
      priority: 100,
    }),
  }),
]);
```

```bash
npx ulabase setup --srv c0ffee
```

```
[1/6] · stripe feature installed
[2/6] + stripe products mode configured
[3/6] + stripe collections and indexes initialised
[4/6] + guests may read the catalog
[5/6] + guests may place an order
[6/6] + guests may read back the order they placed

Ecommerce on c0ffee: 1 satisfied, 5 applied
```

Run it again and every line is `·` — satisfied, nothing written.

That output is [`ulabase.setup.ts` in the ecommerce starter][starter-setup] — a real setup for a real app,
which lives in that repo rather than in this one. This package ships the surface a setup is written
against; a setup belongs to the application it configures, and changes in the same commit as the
code that depends on it.

[starter-setup]: https://github.com/ulabase/starter-ecommerce/blob/main/ulabase.setup.ts

## Installing

Two install shapes, because there are two things here and they are used at different moments.

```bash
npm i -g ulabase         # the `ulabase` command, for a terminal
npm i -D @ulabase/cli    # the library, for a project whose setup file imports it
```

A setup file imports `defineSetup`, `step` and `fromEnv`, so a project that has one
wants the local dependency — a global install is not on Node's resolution path and the import
would not resolve. The `ulabase` command is account-level and outlives any one project, so it wants
the global one. Installing both is normal here, the same way `vite` is both a bin and the module
`defineConfig` comes from.

In a pipeline, neither: `npx ulabase setup …` and nothing to keep installed.

The two copies do not conflict. `fromEnv` markers are matched with `Symbol.for`, which is the
global symbol registry rather than a per-module identity, and a `Setup` is plain data —
`{ name, steps: [{ name, check, apply }] }`, no `instanceof`, no shared class. So the `ulabase` you
have installed can run a setup built against a different version of the library. That is a
property to preserve, not an accident: a `Symbol()` in place of `Symbol.for` would break it
silently.

## Node only, and not by accident

The admin node's `originVetoer` whitelists `ulabase.com` and allows a *missing* `Origin`
header. A page served from your own origin sends one and is vetoed; Node, curl and anything that
is not a browser pass. So this is a CLI and a library for Node, and designing it as a browser page
would have produced an API that cannot work.

It is also the right call on its own merits: the credential here is your Ulabase account,
which governs every service you own and its billing — a much larger blast radius than the tenant
token the framework adapters handle, and not a thing to put in a deployed page.

This is **not a fourth adapter**. There is no reactive state, no session to restore, no signal to
update. See [docs/ADAPTERS.md](../../docs/ADAPTERS.md).

## Steps

The unit is not an operation, it is a **step**: a `check` that answers satisfied-or-not, and an
`apply` that makes it so.

```ts
import { defineSetup, step } from '@ulabase/cli';

export default defineSetup('Blog', [
  step('posts collection', {
    check: ({ service }) => service.collectionExists('posts'),
    apply: ({ service }) => service.createCollection('posts'),
  }),
  step('posts are indexed by slug', {
    check: ({ service }) => service.indexExists('posts', 'slug_unique'),
    apply: ({ service }) => service.createIndex('posts', 'slug_unique', { slug: 1 }, { unique: true }),
  }),
]);
```

That shape gives idempotency, resumability, a dry run and a progress report for free, because they
are all the same thing seen from different angles.

A step receives `{ service, admin, srvId }` — both clients, because feature install, config and
init are admin-node operations while collections and permissions are service-node ones.

| State | Meaning |
|---|---|
| `satisfied` | The check passed. Nothing was done, and nothing needed to be. |
| `applied` | The check failed, the apply ran, the re-check passed. |
| `missing` | A dry run found this undone. |
| `failed` | The apply threw, or ran and left the check still failing. |
| `skipped` | An earlier step failed, so this one was not attempted. |

The runner **re-checks after applying**, so a step that silently did nothing is reported failed
rather than green. A real run halts on a failure, because configuration has real dependencies —
no index before its collection, no feature config before the feature is installed. A dry run does
not halt: it changed nothing, and being told all of what is missing is the point.

## Secrets

A setup lives in git. `fromEnv` is how it names a secret without holding one:

```ts
step('stripe configured', {
  check: async ({ admin, srvId }) => …,
  apply: ({ admin, srvId }) => admin.updateFeatureConfig(srvId, 'stripe', {
    'secret-key': fromEnv('STRIPE_SECRET_KEY'),
    'success-url': 'https://shop.example.com/shop/order',
  }),
});
```

`fromEnv` returns a marker, not a string. It becomes a value in exactly one place — the admin
client, while it serialises the request body — so the secret never reaches the run report, and a
dry run never resolves one at all. An unset variable fails the step with `missing
STRIPE_SECRET_KEY`: the *name*, which is not a secret, rather than `undefined` sent to Stripe and
a rejection three steps later that reads like a bad key instead of an absent one.

### Reading a config back

`GET .../config` replaces every `format: password` field with a fixed-width `••••••••` — fixed
width because a secret's length is still a leak. `PATCH` replaces the **whole** document and
restores the stored value for any field still holding that placeholder.

So read-modify-write is safe exactly as long as you pass the placeholder through untouched:

```ts
const config = await admin.getFeatureConfig(srvId, 'stripe');
await admin.updateFeatureConfig(srvId, 'stripe', { ...config, 'success-url': next });
```

Do not diff, do not strip "empty-looking" fields, do not normalise — any of those writes bullets
over the real key. `REDACTED` and `isRedacted()` are exported so you can *recognise* one; nothing
in this package ever produces one.

A blank or absent secret is **not** redacted, because "not configured" is information you need,
and turning it into bullets would erase it. That distinction is what lets a setup re-run with no
secrets in the environment at all: a stored key comes back as bullets, a check written as
`isRedacted(v) || v !== ''` passes, and the apply that would have read `STRIPE_SECRET_KEY` never
runs.

## Logging in

The credential is a **personal access token**. Issue one at
[ulabase.com](https://ulabase.com), under your profile.

```bash
ulabase login                     # prompts, stores 0600 under ~/.config/ulabase
ulabase setup --srv c0ffee
ulabase logout                    # forgets it here; revoke it in the console
```

The CLI has no way to accept a password, and that is the design rather than a gap. If you signed up
with Google or GitHub you have no password to give it — the OAuth flow returns no token, only an
httpOnly cookie, so nothing outside a browser can complete it. And an account password is the wrong
thing to hand a pipeline in any case: it reaches billing and every service you own, and revoking it
means changing it everywhere it is used.

A token is narrower on both counts. It carries a derived `cli` role instead of yours, so it
configures services and **cannot buy or cancel one**, touch your account, or manage your team — and
that is enforced by the server's access rules, not by this CLI choosing to behave. And you revoke
one token by itself, without disturbing anything else the account is used for.

## From a pipeline

Set `ULABASE_TOKEN` from your platform's secret store. There is no `ulabase login` step: the variable
**always wins over a stored session**, in that direction and with no condition attached, so a CI run
can never quietly fall back to a session left behind on a shared runner.

Never a flag — a credential in a flag is a credential in the shell history, and in the process list
of every other user on the machine.

```yaml
# .github/workflows/deploy.yml
- run: npx ulabase setup --srv c0ffee
  env:
    ULABASE_TOKEN: ${{ secrets.ULABASE_TOKEN }}
    STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
    STRIPE_WEBHOOK_SECRET: ${{ secrets.STRIPE_WEBHOOK_SECRET }}
```

```yaml
# bitbucket-pipelines.yml
- step:
    script:
      - npx ulabase setup --srv c0ffee
    # ULABASE_TOKEN, STRIPE_* as repository or deployment variables
```

A revoked or expired token is reported as exactly that rather than as a bare `401`, and the message
differs by where the token came from: a pipeline is told to update its secret store, a terminal is
told to run `ulabase login`.

Both platforms mask a registered secret in their own logs, but that is their safety net and not
this package's: the progress callback emits a step's name and state and nothing else, so there is
nothing of the secret to mask.

| Exit code | Meaning |
|---|---|
| `0` | Every step satisfied or applied. |
| `1` | A step failed. |
| `2` | A dry run found work outstanding — configuration drift, not an error. |

`--dry-run` in a pull-request check and a full run on merge gives you a deploy **gate**: a
misconfigured Stripe key fails the pipeline before it can report success.

## CLI

```
ulabase login  [--api <url>]
ulabase logout
ulabase setup --srv <id> [options]

--file <path>   A module exporting a setup (default export, or `setup`).
                A function export is called with no arguments.
                Defaults to ./ulabase.setup.ts in the working directory.
--srv <id>      The service to set up.
--dry-run       Run every check, apply nothing, write nothing.
--api <url>     Admin node (default: ULABASE_API, else https://cloud-api.restheart.com).
--json          Emit the report as JSON instead of a step list.
```

`ulabase login` checks the token against the admin node before storing it. Writing an unverified
credential to disk only moves the failure to the next command, where it lands as a `401` in the
middle of something you cared about instead of while you can still paste the right thing. The
stored session records which admin node the token was verified against, and a `--api` that
disagrees is refused rather than sent — otherwise a production credential would be offered to
whatever host happened to be named.

`ulabase new free|shared` — creating a service from the terminal — is specified in
[`specs/todo/provisioning.md`](../../specs/todo/provisioning.md) and not built.

Provisioning will deliberately not be reachable from a setup: a pipeline re-runs a setup on every
merge, and a step that could create a *shared* service would start a purchase per merge.

A `.ts` setup needs a runtime that can load one — Node 22.18+ strips types on its own, anything
earlier wants `npx tsx`.

## API

### `createAdminClient(config)`

Over `api.ulabase.com`, taking the core's `AuthConfig` plus an optional `env`.

`login`, `featureCatalog`, `listFeatures`, `isFeatureInstalled`, `configSchema`, `getFeatureConfig`,
`updateFeatureConfig`, `installFeature`, `uninstallFeature`, `enableFeature`, `disableFeature`,
`initFeature`, `testFeature`, `serviceToken`.

The former `…Plugin…` names (`installPlugin`, `getPluginConfig`, …) still work, deprecated.

`installFeature` takes no configuration — the server builds the initial document itself and ignores
a body, so configuring is always a second step. Free features only; a paid one answers `400` and
points at `/purchase`, which moves money and is deliberately out of reach.

### `createServiceClient(admin, srvId)`

Over the service node, derived from the admin client because that is where its token comes from.

`/jwt` mints a **fifteen-minute** token, and a run that installs a feature, waits for its `init` and
then writes permissions can outlive that. So the client owns it: fetched lazily, cached, renewed a
minute before expiry, shared between concurrent callers, never returned. A caller handed a token
would die mid-run with a `401` that reads like a permissions problem, against a service left
half-configured.

| Check | Apply |
|---|---|
| `collectionExists(name)` | `createCollection(name, meta?)` |
| `indexExists(coll, id)` | `createIndex(coll, id, keys, opts?)` |
| `permissionExists(id)` | `putPermission(id, doc)` |
| `userExists(id)` | `createUser(id, doc)` |
| `schemaExists(coll)` | `putSchema(coll, schema)` |

Plus `fetch(path, init?)` for what that table does not cover.

A check answers `false` on `404` and throws on anything else — a `403` means the token cannot see
the thing, which is not the same as the thing not being there, and swallowing it would report
"missing", apply, and fail again.

### `runSetup(setup, { admin, srvId, dryRun?, onProgress? })`

Returns a `SetupReport`. Progress is a callback, not `console.log` — the CLI subscribes to it, and
so could a local page.

## Out of scope

- **Creating services.** Provisioning is the console's job; this configures one that exists.
- **Billing.** `/purchase`, `/cancel` and `/invoices` move money. A wizard that can spend your
  money by accident is not a wizard.
- **A hosted configuration page.** Ruled out by the `originVetoer`. A local page served *by* the
  CLI would talk to the CLI's own process, and is a reasonable later addition.
- **Editing arbitrary RESTHeart configuration.** Only feature config.

## Licence

MIT

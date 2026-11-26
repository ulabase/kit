# @ulabase/cli

The `ulabase` command line. It starts an app from a starter, lists your services, and sets up a
Ulabase service from a file committed to git.

```bash
ulabase signup                                  # your account, in the browser
ulabase srv new                                 # your service, in the browser
ulabase login --new-token                       # a token, created in the browser
ulabase app new --name my-app --starter react     # a starter app, connected to your service
ulabase srv ls                                  # your services
ulabase setup --srv c0ffee                      # a service, set up from a file
```

The first part of this page is the setup file, which is what the package is a library for. The
commands that get you started are under [Starting an app](#starting-an-app).

## Why a setup file

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

## Starting an app

Four commands take you from nothing to a starter app running on your own service. The first three
open a page of the console, and you finish there. The last one runs in the terminal.

```bash
ulabase signup
ulabase srv new
ulabase login --new-token
ulabase app new --name my-app --starter react
```

### The commands that open a page

`signup`, `srv new` and `login --new-token` create nothing themselves. Each opens a page of the
console in your browser and prints its address. The account, the service and the token are created
on the page.

Where no browser can be opened, the command prints the address and opens nothing: over ssh, on
Linux with no display, in a pipeline, or when the output is redirected. Open the address on another
device. `--no-open` does the same on any machine.

`srv new --plan free|launch|pro` selects the plan on the page.

Services are created in the console only, and paid plans are bought there. So `srv new` is safe
wherever it runs: a pipeline that calls it gets a printed address and nothing else.

### `ulabase srv ls`

```
ID      NAME       PLAN    REGION        TAGS
c0ffee  shop       Free    eu-central-1  prod, web
2000c9  shop-live  Launch  eu-central-1
```

The services of all your teams, with a `TEAM` column when they are in more than one. The id is what
`--srv` takes. A token limited to some services lists only those. `--json` prints the list as JSON.

### `ulabase app new --name <name> --starter <starter>`

Downloads a starter app into a new folder, installs its packages and connects it to a service.

- `--name` is the name of the app. The command creates the folder and writes the name in the app's
  `package.json`. A folder that exists and is not empty stops the command, and nothing changes.
- `--starter` names the starter by a rule, with no list in the code: `--starter x` is the
  repository `github.com/ulabase/starter-x`. So `react`, `ng`, `vue` and `ecommerce` work today,
  and a starter published later works with no new release of this package. A name that matches no
  repository gets the list of the starters that exist, read from GitHub at that moment.
- The option takes a name, never an address or another owner. `npm install` runs the starter's
  install scripts, so the code comes from the `ulabase` organization only.
- The download is `git clone --depth 1`, with the `.git` folder removed afterwards. git must be
  installed.
- What belongs to the starter's repository is removed too: `.github`, its CI, and `openwiki`, a
  wiki generated from the starter's code. The new folder is your app, with no history.

Then the command connects the app. It takes the service from `--srv`, or lists your services and
asks. Connecting runs the starter's own setup file, as `ulabase setup --srv <id>` would in that
folder: it configures the service and writes its address into the app.

An app that is not connected does not work. The command leaves it unconnected, and prints the
commands that are missing, when you are not logged in, when you have no service, when you answer
that you will connect it later, with `--no-setup`, with `--no-install`, or with no terminal to ask
on and no `--srv`.

## Environments

An app has more than one environment, and each is a service: a Free one to build on, a paid one
for production. The same setup file configures both, so they stay alike.

```bash
ulabase setup --srv c0ffee                     # the development environment
ulabase setup --srv 2000c9 --env production    # the production one
```

`--env` reaches the steps as `env` in their context, `development` when the option is absent. The
steps that configure the service ignore it. The one that writes the service's address into the app
uses it to choose the file. In the starters built with Vite that is `.env.<env>`:

```
.env.development     # VITE_API_URL=https://c0ffee.ulabase.app
.env.production      # VITE_API_URL=https://2000c9.ulabase.app
```

```bash
npm run dev                        # the development service
npm run dev -- --mode production   # the production service, from your computer
npm run build                      # builds for the production service
```

The Angular starter has `environment.dev.ts` and `environment.ts`, and knows `development` and
`production`.

## Logging in

The credential is a **personal access token**. You create it in the console, at
[ulabase.com/me/tokens](https://ulabase.com/me/tokens), and you can limit it there to some of your
services.

```bash
ulabase login --new-token         # opens the page that creates a token, then prompts for it
ulabase login                     # prompts for a token you already have
ulabase setup --srv c0ffee
ulabase logout                    # forgets it here; revoke it in the console
```

The token is stored 0600 under `~/.config/ulabase`.

A token limited to some services reaches those and no others, and cannot create a service. Give a
pipeline a token limited to the service it deploys to.

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
- run: npx ulabase setup --srv 2000c9 --env production
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
ulabase signup   [--no-open]
ulabase login    [--new-token] [--no-open]
ulabase logout
ulabase srv new  [--plan free|launch|pro] [--no-open]
ulabase srv ls   [--json]
ulabase app new  --name <name> --starter <starter> [--srv <id>] [--no-install] [--no-setup]
ulabase setup    --srv <id> [--env <name>] [options]

--file <path>   A module exporting a setup (default export, or `setup`).
                A function export is called with no arguments.
                Defaults to ./ulabase.setup.ts in the working directory.
--srv <id>      The service to set up, or to connect a new app to.
--env <name>    The environment the setup is for (default: development).
--dry-run       Run every check, apply nothing, write nothing.
--force <name>  Apply the steps whose name contains <name> without their check.
--api <url>     Admin node (default: ULABASE_API, else the one of the stored
                session, else https://api.ulabase.com).
--json          Emit the report, or the list of services, as JSON.
```

The commands name the thing first and the action after it, as `docker` and `gh` do: `srv new`,
`srv ls`, `app new`. The commands with no thing stay at the first level.

`ulabase login` checks the token against the admin node before storing it. Writing an unverified
credential to disk only moves the failure to the next command, where it lands as a `401` in the
middle of something you cared about instead of while you can still paste the right thing. The
stored session records which admin node the token was verified against, and a `--api` that
disagrees is refused rather than sent — otherwise a production credential would be offered to
whatever host happened to be named.

Creating a service is not reachable from a setup, and the command does not create one either:
`ulabase srv new` opens the page of the console that does. A pipeline re-runs a setup on every
merge, and a step that could create a paid service would start a purchase per merge. The design is
in [`specs/todo/provisioning.md`](../../specs/todo/provisioning.md).

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

### `runSetup(setup, { admin, srvId, env?, dryRun?, onProgress? })`

Returns a `SetupReport`. Progress is a callback, not `console.log` — the CLI subscribes to it, and
so could a local page.

## Out of scope

- **Creating services.** Provisioning is the console's job: `ulabase srv new` opens its page, and
  `ulabase setup` configures a service that exists.
- **Billing.** `/purchase`, `/cancel` and `/invoices` move money. A wizard that can spend your
  money by accident is not a wizard.
- **A hosted configuration page.** Ruled out by the `originVetoer`. A local page served *by* the
  CLI would talk to the CLI's own process, and is a reasonable later addition.
- **Editing arbitrary RESTHeart configuration.** Only feature config.

## Licence

MIT

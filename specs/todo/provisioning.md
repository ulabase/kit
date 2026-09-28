# `ulabase` — a session, and a service you can create from the terminal

**Status:** to do. **Repo:** `ulabase/kit`, inside the existing `@ulabase/cli`.
**Depends on:** `GET /srv-tiers` on the admin node — see
`restheart-cloud-server/specs/todo/srv-tiers-endpoint.md`. Everything else exists today.
**Related:** [`configuration.md`](./configuration.md), whose CLI this extends.

## Why

`configuration.md` configures a service that exists, and says so twice: provisioning is out of
scope, billing is out of scope. Both exclusions were right *for a setup runner*. Neither is a reason
not to have the command.

The gap is small and obvious in use. You have a setup file in git, you have a CLI that applies it, and
the first thing you must do is leave the terminal, open a browser, click through a wizard, and come
back with a six-character id to paste into a flag. The setup describes a service; nothing describes
how you got one.

## The dominant constraint

**Provisioning does not go in CI.** Not "not yet" — not at all.

A setup file is committed, and a pipeline re-runs it on every merge. A step that could create a
service would create one per merge, and a step that could create a *shared* service would start a
purchase per merge. That is not a bug to be guarded against with a flag; it is the wrong thing to
be reachable from that direction at all.

So provisioning is **a command, not a step**. It is not callable from `runSetup`, no setup can reach
it, and it refuses to run without a terminal. The setup runner keeps exactly the property it has
today — a run that changes nothing it was not told to change, and can be a deploy gate.

This also dissolves the hard problem from the earlier design sketch. If provisioning were a step,
`srvId` would stop being an input to `runSetup` and become an output produced mid-run, with every
later step depending on a value that did not exist when the run started. As a command it is just:
create, print the id, and the id goes into the next command.

## The shape

```bash
ulabase login                       # once a day
ulabase new free   --name shop      # a service, immediately
ulabase new shared --name shop      # a service, after you pay for it in a browser
ulabase setup --srv c0ffee
```

`ulabase` and the `setup` subcommand are **already in place** — the package was renamed from
`kit-config` to `@ulabase/cli` and the subcommand introduced before the first publish, so
that adding `login` and `new` is not a breaking change. `setup` is what the flag-only invocation
became, and it defaults to `./ulabase.setup.ts` so the common call is just `ulabase setup --srv <id>`.

Same package. `login`, `new` and `setup` share the admin client, the session and the error
handling, and splitting them would duplicate all three to buy a smaller npm page. The package is
installed globally for `ulabase` and locally for a project's setup file — two shapes for two audiences,
which works because a `Setup` is plain data and `fromEnv` matches with `Symbol.for`, so the two
copies interoperate.

## Task 1 — the session ✅ done

**File:** `packages/cli/src/session.ts`, plus `login`/`logout` in `cli.ts` and `useToken`/
`verifyToken` on the admin client.
**Depends on:** personal access tokens — `restheart-cloud-server/specs/done/personal-access-tokens.md`,
which depended in turn on [restheart#699](https://github.com/SoftInstigate/restheart/issues/699) and
[#700](https://github.com/SoftInstigate/restheart/issues/700), milestone 9.8.0. Both shipped.

Verified against the live integration environment: `ulabase login` with `ULABASE_TOKEN`, the stored
session driving `ulabase setup`, a token revoked mid-session producing "Your session was revoked or has
expired. Run `ulabase login`." within the authenticator's cache TTL, and a session stored for one admin
node refusing to be sent to another.

The password path is **gone**, not deprecated: `RH_CLOUD_EMAIL`/`RH_CLOUD_PASSWORD` now produce a
message naming what replaced them, because failing with "not logged in" would have been true and
unhelpful for anyone upgrading.

**This task was specified as email and password, and that was wrong.** A user who signed up with
Google has no password, so `ulabase login` would simply not work for them — and there is no client-side
fix, because the OAuth callback returns no token at all: it sets an httpOnly cookie on
`cloud-api.restheart.com`, and `frontend-success-url` is fixed server configuration. Telling an SSO
user to invent a password through the reset flow undoes the reason they chose SSO and makes an
account password-attackable that was not.

The wider problem is that `RH_CLOUD_PASSWORD` in a pipeline's secret store is the **account**
password: it reaches billing and every service, and it cannot be revoked without changing it
everywhere. That is the wrong credential for CI whether or not the user has one.

So the credential is a **personal access token**, issued from the console and carrying a derived
`cli` role that is deny-by-default — it cannot start a purchase, which is the constraint from
[the dominant constraint](#the-dominant-constraint) enforcing itself rather than depending on this
CLI to refuse.

```bash
ulabase login                       # prompts for a token, or reads ULABASE_TOKEN
```

Stored at `~/.config/ulabase/session.json`, mode `0600`. The token goes in the file — that is
what a PAT is for, and unlike a password it is revocable one at a time and scoped to what a CLI
does. **Never a password**, which the CLI now never sees at all.

**Precedence, and it matters:** `ULABASE_TOKEN` wins over the stored file, always. A pipeline has
no `ulabase login` step, and a developer's stored session must never be what a CI run silently falls
back to, nor the reverse.

A revoked or expired token is not an error to decorate — it is `run ulabase login`, or in CI, "this
token was revoked or has expired". Non-zero exit, and the message says that and nothing else.

**Acceptance:** a user who signed up with Google authenticates and runs `ulabase setup` without ever
setting a password; `ulabase login` then `ulabase setup` works with no environment variables set; the same
`setup` with `ULABASE_TOKEN` set uses that and not the file; a revoked token produces a message
naming the cause rather than a bare `401`.

## Task 2 — `ulabase new free`

**File:** `packages/cli/src/commands/new.ts`

`POST /provision/free` with `{name, region, tags, org}`. The `srvId` is not in the body — it is in
the `Location` header, as the service URL, and gets parsed out of the hostname.

Three things the command has to get right:

**The org.** An account may have several. `POST /graphql/cloud` with
`{ me { orgs { _id name } } }` — already allowed by `userCanExecuteGQLRequests`, no new endpoint.
One org, use it; several, ask; `--org` to skip the asking.

**The region.** From `GET /srv-tiers` (Task 4's dependency), not from a hardcoded list, so a new
region works without a package release.

**The quota.** `2 + paidCount*2 > freeCount` (`ProvisionFree.java:210`). Over it, the server
answers `403`, which reads as a permissions problem. The command has to say *"you are at your free
service limit (2, plus 2 per paid service)"*, because that is a sentence the user can act on.

**Acceptance:** creates a service and prints its id, its URL, and the `ulabase setup --srv <id>` line
to run next; over quota, exits non-zero with the limit explained rather than a `403`.

## Task 3 — `ulabase new shared`

Same command, a different path, because the service does not exist when the call returns.

`POST /stripe/checkout-session` with `{name, region, tags, price_id, success_url}` answers
`{id, url}` — a **hosted** Stripe Checkout page. The service is created later, by
`WebhookHandler.addSharedSrv`, when Stripe reports the payment. So:

1. Create the session. Print the URL, and open it — this command is interactive by construction,
   and a URL you have to copy out of a terminal is a URL you paste wrong. `--no-open` for anyone
   who disagrees.
2. `success_url` points at the console, the same one the wizard uses. The browser needs somewhere
   sensible to land, and the CLI deliberately does **not** depend on it: no local callback server,
   no port to be already in use, nothing to fail while the user is mid-payment.
3. Poll `POST /graphql/cloud` for a new service in the org until it appears.
4. Print the id, the URL, and the next command.

The polling is where this command is most likely to be wrong, so: a timeout that says *"payment may
still be processing — check cloud.restheart.com"* rather than "failed", because at that point money
may well have moved and telling the user it failed is worse than telling them nothing. And no
prompt to retry the payment, ever.

**Acceptance:** the command exits non-zero and explains itself if run without a TTY; it never
starts a Checkout session non-interactively; a timeout does not claim failure.

## Task 4 — the tiers

`GET /srv-tiers` **ships** — `restheart-cloud-server/specs/done/srv-tiers-endpoint.md`, readable by
`user`, `owner` and `cli`. It becomes `admin.srvTiers()`, and is what `new` reads for both the
region list and the `price_id`. `dedicated` is returned with an empty `regions`, which is how a
client learns it is not creatable from here and should point at the console.

Still to build on this side: the `admin.srvTiers()` method itself.

### Known blocker for Task 2, found while testing

**`POST /graphql/cloud` with `{ me { orgs { _id name } } }` returns `me: null` under a personal
access token.** Not a permissions failure — `cliCanExecuteGQLRequests` grants the path and the call
answers `200`. `Query.me` matches `_id` against `@user._id` or `@user.sub`, and
`MongoApiKeyAuthenticator` builds its account with an *empty* properties document
(`new MongoRealmAccount(..., new BsonDocument())`), so both are null and nothing matches.

Task 2's org selection depends on this query, so it cannot work until the authenticator carries the
principal in the account properties. The fix belongs in `restheart` and needs a snapshot rebuild.
Worth noting that the failure is silent — a `200` with `null` data, not an error.

## Order

`Task 1` → `Task 2` → `Task 4` → `Task 3`.

Task 2 before Task 4 because free provisioning needs no price id and proves the org selection, the
`Location` parsing and the quota message against a real server. Task 3 last because it is the only
one that cannot be tested without spending money.

## Out of scope

- **Deleting or resizing services.** `ulabase new` is not `ulabase manage`. Destructive operations against
  a running service want a confirmation design of their own, not a fourth subcommand added by
  momentum.
- **Dedicated services.** No region registry entry, no defined CLI path. The console's job.
- **A setup step that provisions.** See the dominant constraint. If this is ever revisited, revisit
  the constraint first and in writing.

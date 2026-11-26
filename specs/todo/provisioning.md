# `ulabase` — a session, and a service you can create from the terminal

**Status:** built on 2026-11-25 as the «Revision of 2026-11-25» below says, on dev and not published to npm. To do: the trial on dev, then the release. **Repo:** `ulabase/kit`, inside the existing `@ulabase/cli`.
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

## Revision of 2026-11-25

Decided by Andrea on 2026-11-25. Where this section disagrees with the rest of the file, this
section wins. Tasks 2 and 3 below are superseded by it.

### The decision: the browser does it

The Google Ads clicks of November 2026 left the site in seconds, and from sign-up to a starter that
runs there are ten steps today. The first answer was a command that does everything: it signs the
person up, creates the service and issues its own token. That needs an OAuth issuer on the admin
node, a permission to create on the token, and a rule that widens a token's scope.

Andrea chose the simple road instead. **The command opens the right page of the console, and the
person completes the operation in the browser.** Where no browser can be opened, the command
prints the address. The command creates nothing and is granted nothing new.

The pages exist already:

| Command | Page it opens |
|---|---|
| `ulabase signup` | `https://ulabase.com/signup` |
| `ulabase srv new` | `https://ulabase.com/orgs/active/new-service` |
| `ulabase login --new-token` | `https://ulabase.com/me/tokens` |

What this removes from the earlier design:

- no `OAuthTokenIssuer` on the admin node, no PKCE flow, no loopback redirect;
- no `cli-create` role and no token whose scope grows: a scope is a list of services, chosen when
  the token is created (`ulabase-nodes/specs/todo/sicurezza--pat-scope.md`);
- no `POST /provision/free` from the command, so the `me: null` blocker below does not matter here;
- no payment path in the command: the wizard in the console is the only place a service is bought.

It reverses one earlier decision of the same day: there is a `ulabase signup` command.

### The commands

```bash
ulabase signup                  # opens the sign-up page
ulabase srv new             # opens the page that creates a service
ulabase login                   # asks for a token, as today
ulabase login --new-token       # opens the page that creates a token, then asks for it
ulabase app new --name shop --starter react    # downloads a starter app into ./shop
ulabase srv ls                  # lists your services
ulabase setup --srv c0ffee      # as today
```

#### The names: the thing first, then the action

Decided by Andrea on 2026-11-25. The commands follow Docker's convention, which is also the one of
GitHub's `gh`: first the thing, then what to do with it. `ulabase srv new`, `ulabase srv ls`,
`ulabase app new`. A thing gathers its actions, so `ulabase srv --help` shows them all, and a later
`srv rm` or `token ls` needs no new rule.

The commands with no thing stay at the first level, as `docker login` does: `signup`, `login`,
`logout`, `setup`. `login --new-token` stays an option of `login`: it is a step of the login.

The older sections of this file say `ulabase new free` and `ulabase new shared`. Those names were
never published.

#### Opening a page

One function, shared by the three commands.

- It tries to open the address in the default browser: `open` on macOS, `xdg-open` on Linux,
  `start` on Windows. No new dependency.
- It always prints the address too, on its own line, so the person can open it on another device.
- It does not try to open a browser when there is none to open: over ssh (`SSH_CONNECTION` or
  `SSH_TTY` set), on Linux with no `DISPLAY` and no `WAYLAND_DISPLAY`, or when stdout is not a
  terminal. It prints the address and says to open it.
- `--no-open` prints the address and opens nothing.
- The console's address comes from the same place as the admin API's: `--api` and the stored
  session decide prod or dev, so `ulabase signup` against dev opens `ulabase.dev`.

A failed attempt to open the browser is not an error: the address is on the screen.

#### `ulabase signup`

Opens `/signup` and exits with 0. It prints what to run next: `ulabase srv new`.

It does not wait and does not know whether the person signed up. After sign-up the console lands
on the welcome page, whose one button creates a Free service, and then on «Starter apps», which
shows the commands for that service. So a new user may never need `ulabase srv new`.

#### `ulabase srv new`

Opens `/orgs/active/new-service` and exits with 0. The console sends who is not signed in to the login page
first, then to the wizard of their active team.

- `--plan free|launch|pro` preselects the plan: the wizard already reads `?tier=`. The option is
  named after the plans as the user reads them. The address carries the same word, `tier=launch`: the wizard maps it to
  the plan's internal id, `starter`, which no address shows.
- No `--name` and no `--region`: the wizard asks for them.

It prints what to do next: copy the service id from the page the wizard lands on, then
`ulabase setup --srv <id>`. That page, «Starter apps», already shows the command with the id in it.

It runs anywhere, with or without a terminal: it creates nothing, so the dominant constraint is
kept by construction. A pipeline that runs it gets a printed address and nothing else.

#### `ulabase login --new-token`

`ulabase login` stays as it is: it reads `ULABASE_TOKEN`, or asks for a token and stores it in
`~/.config/ulabase/session.json`.

`--new-token` adds one step before the question: it opens `/me/tokens`, where the person creates a
token and copies it. Then the command asks for the token, as today. This works over ssh with no
change: the page is opened on another device, and the token is pasted into the terminal.

When `ulabase login` is run with no token and no `--new-token`, the prompt names the option:
«No token yet? Run `ulabase login --new-token`».

`ULABASE_TOKEN` set skips the page and the question, as today.

#### `ulabase app new --name <name> --starter <starter>`

Downloads a starter app into a new folder and installs its packages. It takes the place of
`git clone` and `npm install` in the starters' READMEs. It creates no service and asks for no token.

- **`--name <name>`** is the name of the application. The command creates the folder `<name>` and
  writes `<name>` as `name` in the `package.json` it downloaded. It is an option and not a bare
  argument, by Andrea's choice of 2026-11-25: the command reads the same as its meaning, and the
  two options can come in any order. Without it, on a terminal the command asks for the name; with
  no terminal it stops and says to pass the option.
  A bare name, as in `ulabase app new shop`, is refused with a message that shows `--name shop`.
- **`--starter <starter>`** names the starter by a rule, with no list in the code:
  `--starter <x>` downloads `https://github.com/ulabase/starter-<x>`. So `react`, `ng`, `vue` and
  `ecommerce` work today, and a repository `ulabase/starter-whatever` created tomorrow works with
  `--starter whatever`, with no new release of the command.

The rule decides three behaviours:

- **The starter does not exist.** GitHub answers 404. The command says so and lists the starters
  that exist. The list is read from GitHub at that moment: the public repositories of the `ulabase`
  organization whose name starts with `starter-`. If that request fails too, the message gives the
  address `https://github.com/ulabase` in its place.
- **No `--starter`.** On a terminal the command shows the same list and asks. With no terminal it
  stops and says to pass the option.
- **Only public repositories of `ulabase`.** The option takes a name, never an address or another
  owner, so the command downloads code only from our organization.

What it does, in order:

1. stops if the folder `<name>` exists and is not empty, and touches nothing;
2. clones the default branch of the starter with `git clone --depth 1`, then removes `.git`;
   it also removes what belongs to the starter's repository and not to the app: `.github`, which
   is our CI, `openwiki`, and the block of `AGENTS.md` and `CLAUDE.md` that points at that wiki;
3. writes `<name>` into `package.json`;
4. runs `npm install` in the folder; `--no-install` skips it;
5. connects the app to a service, as said below;
6. prints the next steps: `cd <name>` and the command that starts the app, and before them the
   steps that are still missing.

**Connecting the app to a service.** A starter does not work until it is connected: its
`ulabase.setup.ts` has a step that writes the address of the service into the `apiUrl` line of
`src/environments/environment.ts`, and the other steps configure the service for the app. An app
started before that calls a placeholder address, and its sign-up fails. So `app new` connects the
app itself, after step 4, by running the setup as `ulabase setup --srv <id>` would in that folder.

Which service:

- `--srv <id>` names it.
- Without `--srv`, on a terminal, the command shows the services of `srv ls` and asks which one.
  The list has one more choice, «none, I will connect it later». With one service only, it is
  proposed as the answer.
- With no service at all, the command says so, names `ulabase srv new`, and leaves the app
  unconnected.
- With no terminal and no `--srv`, it connects nothing.
- `--no-setup` connects nothing and asks nothing.

All of this needs a session. With no token the command does not fail: it downloads the starter,
and prints `ulabase login --new-token` and `ulabase setup --srv <id>` as the next steps.

When the app is left unconnected, the last lines say so plainly: the app will not work until
`ulabase setup --srv <id>` has run.

The question without `--srv` depends on the same request as `srv ls`: until the admin node can
list services for a token, `app new` connects only with `--srv`.

The starter is downloaded with `git clone --depth 1`, and the `.git` folder is removed afterwards.
Decided by Andrea on 2026-11-25, for one reason: GitHub counts clones in the traffic of a
repository, and does not count downloads of the archive. So each `app new` shows up in the
statistics of its starter. GitHub keeps those numbers for 14 days: to keep a history they have to
be read and stored before they expire.

The command needs git on the machine. Without it, it stops and says that git is required, with the
address of the repository for who wants to download it by hand.

A starter is trusted code: it is ours, and `npm install` runs its install scripts. That is why the
option cannot name a repository outside `ulabase`.

#### `ulabase srv ls`

Asked by Andrea on 2026-11-25. It lists the services the stored token may act on, as a table:

```
ID      NAME        PLAN    REGION        TAGS
c0ffee  shop        Free    eu-central-1  prod, web
2000c9  shop-live   Launch  eu-central-1
```

- The columns are the id, the name, the plan, the region and the tags. The id is there because it
  is what `--srv` takes.
- The plan is shown with the name the user reads in the console: `Launch` for the internal
  `starter`, `Enterprise` for `dedicated`.
- The services of all the user's teams are listed, sorted by name. With more than one team, a
  `TEAM` column is added.
- `--json` prints the same rows as a JSON array, for scripts.
- With no service it prints one line that says so and names `ulabase srv new`.
- A token limited to some services lists only those.

It needs a session, as `setup` does: with no token it says to run `ulabase login`.

**Depends on the admin node.** The `cli` role has no request today that lists services. Its only
candidate is `POST /graphql/cloud` with `me { orgs { srvs } }`, and `me` is `null` under a personal
access token: see «Known blocker for Task 2» below. Whether that was fixed since is to check first.
Two ways, to choose in `ulabase-nodes`:

- fix `me` under a token, and filter the services by the token's scope;
- a `GET /srvs-mgmt` for `cli`, which answers the services `mayActOn` allows. It is one place for
  the scope rule, and the command needs no GraphQL.

### Environments: one service each

Decided by Andrea on 2026-11-25. An app has more than one environment, at least development and
production, and each one is a service. Today a starter holds one address, the `apiUrl` line of
`src/environments/environment.ts`, so to run the app against another service one has to run the
setup again or edit a tracked file by hand.

Each starter uses the mechanism of its own framework, and the command only has to know which
environment it is writing.

#### In the starters

React, Vue and e-commerce are built with Vite, which reads one file for each mode:

```
.env.development     # VITE_API_URL=https://c0ffee.ulabase.app
.env.production      # VITE_API_URL=https://2000c9.ulabase.app
```

`src/environments/environment.ts` stops holding the address and reads it:
`apiUrl: import.meta.env.VITE_API_URL ?? ''`. Empty still shows the «configure your service»
screen. The rest of the app keeps reading `environment.apiUrl`, so nothing else changes.

```bash
npm run dev                        # against the development service
npm run dev -- --mode production   # against the production service
npm run build                      # builds for production
```

Angular has the two files already, `environment.dev.ts` for `ng serve` and `environment.ts` for
the production build, through `fileReplacements`. It keeps them.

The two files are committed. The address of a service is not a secret, and who clones the project
sees which service is production. The starters' own repositories keep them empty, as today, and
the pre-commit guard that refuses a staged address now watches these files.

#### In the command

```bash
ulabase setup --srv c0ffee                     # the development environment
ulabase setup --srv 2000c9 --env production    # the production one
```

- `--env <name>` says which environment the run is for. Without it the environment is
  `development`.
- The name reaches the steps of the setup: the context a step receives, today `admin` and `srvId`,
  gains `env`. The command does not write files itself. The step «the app points at this service»
  of each starter chooses the file from `env`: `.env.<env>` with Vite, `environment.dev.ts` or
  `environment.ts` with Angular.
- Any name is accepted, because Vite takes any mode: `--env staging` writes `.env.staging`, and
  `npm run dev -- --mode staging` runs on it. The Angular starter knows `development` and
  `production` and refuses another name with a message.
- Everything else in the setup is the same for every environment: the same file configures the
  development service and the production one, so the two stay alike. What differs, such as a
  Stripe key, comes from `fromEnv`, as today.
- `ulabase app new` connects the development environment. Production is connected later, with
  `setup --env production`.

In a pipeline the token comes from `ULABASE_TOKEN`, limited to the production service, and the run
is `ulabase setup --srv <id> --env production` before the build.

Not built: a file in the project that gives a name to each service, so that `--env production`
alone would find the id. The id is still passed with `--srv`. To revisit when a user asks.

#### Acceptance

- After `ulabase setup --srv c0ffee` and `ulabase setup --srv 2000c9 --env production`, the React
  starter has the two addresses in `.env.development` and `.env.production`, and
  `src/environments/environment.ts` has no address in it.
- `npm run dev` calls `c0ffee`, `npm run dev -- --mode production` calls `2000c9`, and the build
  holds the address of `2000c9`.
- A second `ulabase setup --srv c0ffee` changes no file.
- The Angular starter refuses `--env staging` and says which names it knows.

### In the console

Small, and none of it blocks the commands:

- `/me/tokens?new=1` opens the creation dialog at once, so the page the command opens is already
  on the form. `login --new-token` uses this address when it exists.
- The scope of a token is chosen in that dialog. It is the work of
  `ulabase-nodes/specs/todo/sicurezza--pat-scope.md`, which no longer depends on this file.
- «Starter apps» keeps showing the commands. Its login line becomes `ulabase login --new-token`.

### Trying it on dev, with the local build

Nothing is published: the commands are in `packages/cli` on `main`, and the trial uses a build of
this checkout against dev.

```bash
cd ~/ulabase/kit && npm run build
alias ulabase-dev="ULABASE_API=https://api.ulabase.dev node ~/ulabase/kit/packages/cli/dist/cli.js"

ulabase-dev signup                 # prints https://ulabase.dev/signup
ulabase-dev srv new --plan launch  # prints https://ulabase.dev/orgs/active/new-service?tier=launch
ulabase-dev login --new-token      # prints https://ulabase.dev/me/tokens?new=1, then asks for the token
ulabase-dev srv ls
ulabase-dev srv ls --json
ulabase-dev app new --name shop --starter react
ulabase-dev setup --srv <id> --env production    # in the folder of a starter
```

Over ssh the commands print the address and open nothing: that is the case of this machine.

The trial, step by step, with what each step must show.

**Run on 2026-11-25**, by Claude with Andrea's authorization, with a test user on dev that has two
Free services and two tokens (scripts and screenshots in `~/ulabase/artifacts/cli-trial-2026-11-25`).
Every step below gave the result written, the ones on a terminal through a simulated one. The
four starters passed steps 17 to 21 and are pushed. Two things seen on the way:

- the folder `app new` left had the starter's own `.github`, `openwiki`, `AGENTS.md` and
  `CLAUDE.md`. Fixed the same day: `app new` removes them;
- `npm install` of the React starter reports 11 vulnerabilities in its dependencies, 2 critical.

| # | Do | Expect |
|---|---|---|
| 1 | `ulabase-dev signup` | prints `https://ulabase.dev/signup`, opens nothing over ssh, exit 0 |
| 2 | `ulabase-dev srv new --plan launch` | prints `https://ulabase.dev/orgs/active/new-service?tier=launch`; the page opens the wizard with Launch selected |
| 3 | `ulabase-dev srv new --plan gold` | refuses, and names `free, launch, pro` |
| 4 | in the console on dev, `/me/tokens?new=1` | the cursor is in the name field; the form offers «All my services» or «Only the services I choose» |
| 5 | create a token limited to one service, then `ulabase-dev login` and paste it | «Logged in to https://api.ulabase.dev» |
| 6 | `ulabase-dev srv ls` | that one service, with its plan as `Free`, `Launch` or `Pro` |
| 7 | `ulabase-dev setup --srv <another service of yours> --dry-run`, in a starter's folder | refused: the token does not reach that service |
| 8 | create a token for all the services, log in with it, `ulabase-dev srv ls` and `--json` | every service of every team; a `TEAM` column with more than one team |
| 9 | `ulabase-dev login --new-token` | prints `https://ulabase.dev/me/tokens?new=1`, then asks for the token |
| 10 | `ulabase-dev app new --name shop --starter react`, in an empty folder | clones, installs, lists the services and asks; after the answer runs the setup and ends with «It is connected to the service …» |
| 11 | `cd shop && npm run dev` | the app opens on sign-up, and a sign-up works against the service chosen |
| 12 | `ulabase-dev app new --name shop --starter react` again | «The folder shop exists and is not empty. Nothing was changed.» |
| 13 | `ulabase-dev app new --name x --starter nope` | «There is no starter called "nope". The starters are: ecommerce, ng, react, vue.» |
| 14 | `ulabase-dev app new shop` | «The name of the app is an option: ulabase app new --name shop» |
| 15 | `ulabase-dev app new --name y --starter vue --no-setup` | downloads and installs, connects nothing, and says the app will not work until the setup has run |
| 16 | `ulabase-dev srv ls > out.txt` | the table is in the file |

The starters, in the local clones under `~/ulabase/starter-*`, which hold the commits not pushed
yet. Step 10 clones from GitHub, so until the push it gets the published starter, whose setup
writes `src/environments/environment.ts`: that works too.

| # | Do, in `~/ulabase/starter-react` | Expect |
|---|---|---|
| 17 | `npm run dev` | the app starts on the service of `.env.development.local` |
| 18 | `ulabase-dev setup --srv <id>` | the last step writes `VITE_API_URL` in `.env.development`; a second run changes nothing |
| 19 | `ulabase-dev setup --srv <id> --env production` | the address is in `.env.production` |
| 20 | `npm run build` | builds, with the production address |
| 21 | the same in `starter-vue`, `starter-ecommerce`, and `starter-ng` with `--env staging` | Angular refuses `staging` and names its two environments |

After steps 17 to 21, `git restore .env.development .env.production` in each clone, then push the
starters.

### Open

1. **Sign-up with email verification.** The verification link opens the console from the mail.
   `ulabase signup` does not need to survive it, because it waits for nothing. To check only that
   the welcome page still follows.
2. **The promise in the pages and the ads.** «An app in a minute from one command» is not what this
   builds. The claim to make, if any, is decided after the first measured run from sign-up to a
   running starter.

### Order of the work

1. The function that opens a page, with its rules for terminals with no browser.
2. `signup`, `srv new`, `login --new-token`.
3. `app new`.
4. `srv ls`, after the admin node can list services for a token.
5. Environments: `--env` on `setup`, then the four starters.
6. The manual: `cli.adoc`, the starters' READMEs and «Starter apps» in the console.
7. In the console, `/me/tokens?new=1`.

The scope of a token is separate work and can come before or after.

### Acceptance

- On a laptop, `ulabase signup` opens the sign-up page in the browser and prints its address.
- Over ssh, with no browser on the machine, each of the three commands prints the address, opens
  nothing and exits with 0.
- `ulabase srv new --plan launch` opens the wizard with the Launch plan selected.
- `ulabase login --new-token` opens the tokens page, then stores the token the person pastes, and
  `ulabase setup --srv <id>` runs on it.
- With `ULABASE_TOKEN` set, `ulabase login --new-token` opens nothing and asks nothing.
- Run with stdout redirected to a file, each command writes the address to the file and opens no
  browser.
- `ulabase app new --name shop --starter react` leaves a folder `shop` with the React starter, its
  packages installed, `shop` as the package name and no `.git` folder.
- A repository `ulabase/starter-whatever` created after the command was published is downloaded by
  `--starter whatever`, with no new release.
- With a session, `ulabase app new --name shop --starter react --srv c0ffee` leaves an app whose
  `apiUrl` is the address of `c0ffee`, and whose sign-up works when started.
- Without `--srv`, on a terminal, the command lists the services and connects the one chosen.
- With no session, the command downloads the starter, connects nothing and says the app will not
  work until the setup has run.
- `--starter nope` exits non-zero, says the starter does not exist and lists the ones that do.
- With the folder `shop` already there and not empty, the command exits non-zero and changes nothing.
- `ulabase srv ls` prints the id, name, plan, region and tags of the user's services; with a token
  limited to `c0ffee` it prints that service only; `--json` prints an array.

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
`api.ulabase.com`, and `frontend-success-url` is fixed server configuration. Telling an SSO
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

## Task 2 — `ulabase new free` (superseded on 2026-11-25)

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

## Task 3 — `ulabase new shared` (superseded on 2026-11-25)

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
still be processing — check ulabase.com"* rather than "failed", because at that point money
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

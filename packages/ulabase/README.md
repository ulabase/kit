# ulabase

**The SaaS for your SaaS.** Ulabase is a managed backend: database, REST and GraphQL APIs, sign-up
and login, teams, payments and MCP for AI agents. This is its command line.

```bash
npm i -g ulabase        # the ulabase command (also ula), in a terminal
npx ulabase setup       # in a pipeline, nothing to install
```

## Your service, configured from a file

Collections, indexes, permissions and features go in a file committed next to your app, instead of
being clicked together in the console:

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
ulabase login --new-token              # once: opens the page that creates a token
ulabase setup --srv c0ffee --dry-run   # what would change
ulabase setup --srv c0ffee             # apply it
```

## A starter app, from the terminal

```bash
ulabase signup                                  # your account, in the browser
ulabase srv new                                 # your service, in the browser
ulabase app new --name my-app --starter react     # a starter app, connected to your service
ulabase srv ls                                  # your services
```

`signup` and `srv new` open a page of the console, where you finish. `app new` downloads a starter
(`react`, `ng`, `vue`, `ecommerce`), installs its packages and connects it to one of your services.

Every step is a check and an apply, so running it again on a service already set up writes
nothing. In CI, set `ULABASE_TOKEN` from your secret store instead of logging in.

## More

- [`@ulabase/cli`](https://github.com/ulabase/kit/tree/main/packages/cli): the full reference. This
  package only makes `npx ulabase` work and installs that one.
- [`@ulabase/kit`](https://github.com/ulabase/kit): sign-up, login, teams and payments for your
  frontend, with adapters for Angular, React and Vue.
- Starter apps: [Angular](https://github.com/ulabase/starter-ng),
  [React](https://github.com/ulabase/starter-react),
  [Vue](https://github.com/ulabase/starter-vue),
  [e-commerce](https://github.com/ulabase/starter-ecommerce).
- [ulabase.com](https://ulabase.com)

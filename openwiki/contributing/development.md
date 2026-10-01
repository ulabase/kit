---
type: Guide
title: Contributing & Development
description: Development setup guide for ULABASE Kit. Covers local development, workspace configuration, building packages, and debugging tips.
tags: [contributing, development, setup, debugging]
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T10:51:10.399Z
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-da5ce9b2f007ceacfe51e34a
    resource: repo://.github/workflows/unit-tests.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-92450a7065eb85e0f30b5461
    resource: repo://packages/cli/package.json
  - id: openwiki-source-0b4887a994e66924f073c267
    resource: repo://packages/cli/tsconfig.json
  - id: openwiki-source-4d6cb4e0ccb252a2a197ab08
    resource: repo://packages/kit-ng/angular.json
  - id: openwiki-source-f02fe869e879d7a4e2ba5dfe
    resource: repo://packages/kit-ng/ng-package.json
  - id: openwiki-source-01685a6829395c2a4f8d6b98
    resource: repo://packages/kit-ng/package.json
  - id: openwiki-source-e9c640fee8f826ca12a30d21
    resource: repo://packages/kit-ng/tsconfig.json
  - id: openwiki-source-3a32f455ba8d38700cf6d96e
    resource: repo://packages/kit-react/tsconfig.json
  - id: openwiki-source-e2eb24b148aef310c446f420
    resource: repo://packages/kit/vitest.config.ts
  - id: openwiki-source-06c92acb1e58241d198db5aa
    resource: repo://packages/ulabase/package.json
  - id: openwiki-source-e79b0aa7b4f168ddb0be2dd4
    resource: repo://rebuild-kit-ng.sh
  - id: openwiki-source-df1e4d0dc0a35c64fd0e652b
    resource: repo://tsconfig.base.json
generated: { by: "openwiki/0.6.1", at: "2026-10-01T10:51:10.399Z" }
---

# Contributing & Development

This guide covers local development setup, workspace configuration, building packages, and debugging tips for contributing to ULABASE Kit.

## Prerequisites

- **Node.js**: 22.22.3+ (required by Angular 22 CLI for `kit-ng` tests; the rest of the workspace is fine on any Node 22)
- **npm**: 9+ (workspaces support)
- **Git**: 2.30+
- **ULABASE**: Account for integration tests ([sign up](https://ulabase.com))

## Quick Setup

### 1. Clone Repository

```bash
git clone https://github.com/ulabase/ulabase-kit.git
cd ulabase-kit
```

### 2. Install Dependencies

```bash
npm install
```

This installs all dependencies for all workspace packages using npm workspaces.

### 3. Build Packages

```bash
npm run build
```

Builds `kit` first, then `kit-ng`, `kit-react`, `kit-vue`, and finally `cli` (order matters due to dependency).

> **Node ≥ 22.22.3** is required — the Angular 22 CLI that runs `kit-ng`'s tests enforces it. The rest of the workspace is fine on any Node 22.

### 4. Run Tests

**Adapter and CLI unit tests** (no backend needed):

```bash
npm run build   # adapters resolve @ulabase/kit from its built dist
npm test -w packages/kit-react -w packages/kit-vue -w packages/kit-ng -w packages/cli
```

**Integration tests** (requires ULABASE instance):

```bash
# Create test environment file
cat > packages/kit/.env << EOF
ULABASE_TEST_API_URL=https://<your-instance>.ulabase.com
ULABASE_TEST_ADMIN_PASSWORD=<root-password>
EOF

# Run integration tests
npm test -w packages/kit
```

## Repository Structure

```
ulabase-kit/
├── packages/
│   ├── kit/                    # Core package (@ulabase/kit)
│   │   ├── src/                # Source code
│   │   ├── dist/               # Compiled output (gitignored)
│   │   ├── __tests__/          # Integration and unit tests
│   │   ├── vitest.config.ts    # Integration test config
│   │   ├── vitest.unit.config.ts # Unit test config
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── kit-ng/                 # Angular adapter (@ulabase/kit-ng)
│   │   ├── src/                # Source + unit tests (*.spec.ts)
│   │   ├── dist/               # Compiled output (gitignored)
│   │   ├── angular.json        # Angular workspace config (Vitest runner)
│   │   ├── package.json
│   │   ├── ng-package.json     # Angular packaging config
│   │   └── tsconfig.json
│   │
│   ├── kit-react/              # React adapter (@ulabase/kit-react)
│   │   ├── src/                # Source + unit tests
│   │   ├── src/next/           # /next subpath (Next.js SSR)
│   │   ├── vitest.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── kit-vue/                # Vue adapter (@ulabase/kit-vue)
│   │   ├── src/                # Source + unit tests
│   │   ├── src/nuxt/           # /nuxt subpath (Nuxt SSR)
│   │   ├── vitest.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                    # CLI tool (@ulabase/cli)
│   │   ├── src/                # Source + unit tests
│   │   ├── dist/               # Compiled output (gitignored)
│   │   ├── vitest.unit.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── ulabase/                # ULABASE entry point package
│       ├── package.json
│       └── ...
│
├── docs/                       # Documentation
│   ├── ADAPTERS.md             # Adapter contract & roadmap
│   └── ADAPTER_CONTRACT.md     # Shared test checklist
├── .github/workflows/          # CI/CD workflows
├── package.json                # Workspace root
├── tsconfig.base.json          # Shared TypeScript config
└── rebuild-kit-ng.sh           # Local dev helper script
```

## Workspace Configuration

### npm Workspaces

The monorepo uses npm workspaces with six packages: kit (core), kit-ng (Angular adapter), kit-react (React adapter), kit-vue (Vue adapter), cli (CLI tool), and ulabase (entry point):

```json
{
  "name": "ulabase-kit-monorepo",
  "private": true,
  "workspaces": ["packages/*"]
}
```

**Benefits**:
- Single `npm install` at root
- Shared dependencies
- Workspace-aware commands

### Dependency Resolution

All adapters and the CLI depend on `kit` at exact version `0.0.0`:

```json
{
  "dependencies": {
    "@ulabase/kit": "0.0.0"
  }
}
```

**Why `0.0.0`?**
- Prevents npm from resolving `kit` from the registry
- Ensures adapters and CLI always use local workspace `kit`
- Release workflow rewrites to tag version before publishing

**If resolution looks wrong**:

```bash
rm -rf node_modules packages/*/node_modules
npm install
```

### TypeScript Configuration

**Base config** (`tsconfig.base.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Package configs** extend base:
- `packages/kit/tsconfig.json` — Standard TypeScript; excludes test directory from compilation
- `packages/kit-ng/tsconfig.json` — Angular-specific: experimental decorators, dom lib, strict Angular compiler options
- `packages/kit-react/tsconfig.json` — React JSX (`react-jsx`), dom lib
- `packages/kit-vue/tsconfig.json` — Vue settings, dom lib
- `packages/cli/tsconfig.json` — Node.js target with `@types/node`

## Building

### Build All Packages

```bash
npm run build
```

**Order**: kit → kit-ng → kit-react → kit-vue → cli (adapters and CLI depend on kit)

### Build Individual Packages

```bash
# Build kit only
npm run build -w packages/kit

# Build kit-ng only (requires kit to be built first)
npm run build -w packages/kit-ng

# Build cli only (requires kit to be built first)
npm run build -w packages/cli
```

### Build Output

**kit**:
- `packages/kit/dist/` — Compiled JavaScript + type declarations
- Entry point: `packages/kit/dist/index.js`
- Types: `packages/kit/dist/index.d.ts`

**kit-ng**:
- `packages/kit-ng/dist/` — Angular package format
- Entry point: `packages/kit-ng/dist/index.js`
- Types: `packages/kit-ng/dist/index.d.ts`

**kit-react**:
- `packages/kit-react/dist/` — ES modules
- Entry point: `packages/kit-react/dist/index.js`
- `/next` subpath: `packages/kit-react/dist/next/`

**kit-vue**:
- `packages/kit-vue/dist/` — ES modules
- Entry point: `packages/kit-vue/dist/index.js`
- `/nuxt` subpath: `packages/kit-vue/dist/nuxt/`

**cli**:
- `packages/cli/dist/` — ES modules
- Entry point: `packages/cli/dist/index.js`
- Binaries: `packages/cli/dist/cli.js` (exposed as `ulabase` and `ula` commands)

### Watch Mode

```bash
# Watch for changes and rebuild
cd packages/kit
npx tsc --watch
```

## Local Development with Starter App

### Link Packages Locally

For developing against a local Angular app:

```bash
# From monorepo root
npm run build

# Link kit globally
npm link -w packages/kit

# Link kit-ng (from dist directory)
cd packages/kit-ng/dist && npm link

# In your Angular starter app
cd /path/to/your/angular-app
npm link @ulabase/kit @ulabase/kit-ng

# Clear Angular cache if needed
rm -rf .angular/cache
```

### Using rebuild-kit-ng.sh

The `rebuild-kit-ng.sh` script (a zsh script) builds only kit and kit-ng (not all packages), then links kit globally, links kit-ng from its dist directory, links both into the starter app at `/Users/uji/development/ulabase/starter-ng`, and clears the Angular cache.

```bash
./rebuild-kit-ng.sh
```

**What it does**:
1. Builds `kit` (workspace root)
2. Builds `kit-ng` (workspace root)
3. Links `kit` globally
4. Links `kit-ng` from its dist directory
5. Links both into the starter app
6. Clears Angular cache

**Note**: Update `STARTER_DIR` in the script to match your starter app path.

### Unlink Packages

```bash
# In your Angular app
npm unlink @ulabase/kit @ulabase/kit-ng

# In monorepo
npm unlink -w packages/kit
cd packages/kit-ng/dist && npm unlink
```

## Testing

### Adapter and CLI Unit Tests

No backend needed — run on every push:

```bash
npm run build
npm test -w packages/kit-react -w packages/kit-vue -w packages/kit-ng -w packages/cli
```

See [Testing Guide](../testing/guide.md) and `docs/ADAPTER_CONTRACT.md` for the shared test checklist.

### Integration Tests

Tests run against a real ULABASE instance:

```bash
# Create environment file
cat > packages/kit/.env << EOF
ULABASE_TEST_API_URL=https://<your-instance>.ulabase.com
ULABASE_TEST_ADMIN_PASSWORD=<root-password>
EOF

# Run tests
npm test -w packages/kit
```

### Test Reports

```bash
# Run tests and open HTML report
npm test -w packages/kit && ./packages/kit/open-report.sh
```

**Output**: `packages/kit/test-results/index.html`

### Watch Mode

```bash
cd packages/kit
npx vitest --watch
```

### Run Specific Tests

```bash
# Run specific test file
npx vitest run src/__tests__/integration/auth.test.ts

# Run tests matching pattern
npx vitest run -t "login"
```

See [Testing Guide](../testing/guide.md) for detailed testing documentation.

## Debugging

### TypeScript Compilation Errors

**Common issues**:

1. **Missing dependencies**
   ```bash
   npm install
   ```

2. **Stale build artifacts**
   ```bash
   rm -rf packages/*/dist
   npm run build
   ```

3. **Type mismatches**
   - Check `types.ts` for interface definitions
   - Verify import paths use `.js` extension (ESM)

### Runtime Errors

**Common issues**:

1. **localStorage unavailable**
   - Kit falls back to in-memory token storage
   - Check browser console for warnings

2. **CORS errors**
   - Ensure `apiBaseUrl` is correct
   - Check ULABASE CORS configuration

3. **401 errors**
   - Token expired or invalid
   - Check token in localStorage
   - Verify ULABASE is running

### Debug in Browser

1. Open browser DevTools
2. Go to Application → Storage → Local Storage
3. Look for `ulabase_access_token` key
4. Decode JWT at [jwt.io](https://jwt.io)

### Debug in Node.js (Tests)

```bash
# Run tests with Node.js debugger
cd packages/kit
node --inspect-brk ./node_modules/.bin/vitest run
```

Then attach debugger in VS Code or Chrome DevTools.

## Code Style

### TypeScript

- Strict mode enabled
- ES2022 target
- ESNext modules
- Explicit return types (recommended)
- No `any` types (use `unknown` if needed)

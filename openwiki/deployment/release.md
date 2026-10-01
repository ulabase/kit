---
type: Guide
title: Release Process
description: Tag-driven release pipeline for Ulabase. Covers version management, integration-test gating, OIDC publishing, and the ulabase meta-package.
tags: [release, deployment, ci-cd, npm, github-actions]
sources:
  - id: openwiki-source-4d1d392666be6dfdd7a91a2e
    resource: repo://.github/workflows/release.yml
  - id: openwiki-source-92450a7065eb85e0f30b5461
    resource: repo://packages/cli/package.json
  - id: openwiki-source-01685a6829395c2a4f8d6b98
    resource: repo://packages/kit-ng/package.json
  - id: openwiki-source-54f8315d21086325777bcf77
    resource: repo://packages/kit-react/package.json
  - id: openwiki-source-3b715d0672cc288b21ea6330
    resource: repo://packages/kit-vue/package.json
  - id: openwiki-source-46339ee0e97e6859bc5ea428
    resource: repo://packages/kit/package.json
  - id: openwiki-source-06c92acb1e58241d198db5aa
    resource: repo://packages/ulabase/package.json
generated: { by: "openwiki/0.6.1", at: "2026-10-01T10:51:10.399Z" }
verified:
  - by: openwiki/0.6.1
    at: 2026-10-01T10:51:10.399Z
---

# Release Process

This document describes the tag-driven release process for Ulabase, including version management, CI/CD pipeline, and npm publishing.

## Overview

Ulabase uses a **tag-driven release process**:

1. Create a version tag
2. Push tag to GitHub
3. CI runs integration tests
4. If tests pass, all six packages are published to npm
5. If tests fail, nothing is published

**No manual versioning step needed** — the tag determines the version.

## Packages

| Package | npm name | Purpose |
|---------|----------|---------|
| `packages/kit` | `@ulabase/kit` | Core SDK — auth, teams, payments |
| `packages/kit-ng` | `@ulabase/kit-ng` | Angular adapter (services, guards, interceptor) |
| `packages/kit-react` | `@ulabase/kit-react` | React adapter (context, hooks, route guards) |
| `packages/kit-vue` | `@ulabase/kit-vue` | Vue adapter (composables, navigation guards) |
| `packages/cli` | `@ulabase/cli` | CLI for declarative Ulabase configuration (`ulabase` / `ula` commands) |
| `packages/ulabase` | `ulabase` | Meta-package — thin `npx ulabase` entry point that pulls in `@ulabase/cli` |

## Version Management

### Version Strategy

- All six packages share the same version
- Versions follow [Semantic Versioning](https://semver.org/)
- Current development version: `0.0.0` (in git)

### Workspace Configuration

In development, each adapter depends on `@ulabase/kit` at exact version `0.0.0`, and the `ulabase` meta-package depends on `@ulabase/cli` at the same placeholder:

```json
{
  "dependencies": {
    "@ulabase/kit": "0.0.0"
  }
}
```

**Why `0.0.0`?**
- Prevents npm from resolving `kit` from the registry instead of the workspace
- Ensures adapters always compile against the local `kit` source
- Release workflow rewrites this to the tag version before publishing

### Version Updates

During release, the workflow updates:

1. `packages/kit/package.json` — `version` field
2. `packages/kit-ng/package.json` — `version` and `dependencies.@ulabase/kit`
3. `packages/kit-react/package.json` — `version` and `dependencies.@ulabase/kit`
4. `packages/kit-vue/package.json` — `version` and `dependencies.@ulabase/kit`
5. `packages/cli/package.json` — `version` and `dependencies.@ulabase/kit`
6. `packages/ulabase/package.json` — `version` and `dependencies.@ulabase/cli`

All values move together to ensure consistency.

## Release Workflow

### Step 1: Create Version Tag

```bash
# From main branch
git tag 1.2.3
git push origin 1.2.3
```

**Tag Format**: `[major].[minor].[patch]` (e.g., `1.0.0`, `2.1.3`)

### Step 2: CI Pipeline

GitHub Actions automatically triggers the release workflow:

**Workflow**: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - '[0-9]+.[0-9]+.[0-9]+'

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    environment: integration-test
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - run: npm install -g npm@latest

      - name: Set version from tag
        run: |
          npm pkg set version=${{ github.ref_name }} -w packages/kit
          npm pkg set version=${{ github.ref_name }} -w packages/kit-ng
          npm pkg set version=${{ github.ref_name }} -w packages/kit-react
          npm pkg set version=${{ github.ref_name }} -w packages/kit-vue
          npm pkg set version=${{ github.ref_name }} -w packages/cli
          npm pkg set version=${{ github.ref_name }} -w packages/ulabase
          npm pkg set dependencies.@ulabase/kit=${{ github.ref_name }} -w packages/kit-ng
          npm pkg set dependencies.@ulabase/kit=${{ github.ref_name }} -w packages/kit-react
          npm pkg set dependencies.@ulabase/kit=${{ github.ref_name }} -w packages/kit-vue
          npm pkg set dependencies.@ulabase/kit=${{ github.ref_name }} -w packages/cli
          npm pkg set dependencies.@ulabase/cli=${{ github.ref_name }} -w packages/ulabase
      
      - run: npm install
      - run: npm run build

      - run: mkdir -p packages/kit/test-results

      - name: Integration tests
        run: npm test -w @ulabase/kit
        env:
          ULABASE_TEST_API_URL: ${{ secrets.ULABASE_TEST_API_URL }}
          ULABASE_TEST_ADMIN_PASSWORD: ${{ secrets.ULABASE_TEST_ADMIN_PASSWORD }}

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: packages/kit/test-results/

      - name: Publish
        if: success()
        run: |
          npm publish --access public -w packages/kit
          npm publish --access public packages/kit-ng/dist
          npm publish --access public -w packages/kit-react
          npm publish --access public -w packages/kit-vue
          npm publish --access public -w packages/cli
          # after @ulabase/cli, which it depends on: `npx ulabase`
          npm publish --access public -w packages/ulabase
```

**Key details:**

- The `Set version from tag` step uses `npm pkg set` (not `npm version`) to edit package.json files without reifying. A single `npm install` afterwards resolves the workspace in one shot.
- `kit-ng` publishes from its `dist` directory directly (`packages/kit-ng/dist`) because it uses ng-packagr to build.
- The `ulabase` meta-package is published **last** because it depends on `@ulabase/cli`; the comment in the workflow documents this ordering constraint.
- Test results are uploaded as artifacts even on failure (`if: always()`), so you can inspect them from the Actions run.
- The `Publish` step only runs on success (`if: success()`), gating all six publishes behind the integration test.

### Step 3: OIDC Provenance

The release job declares `id-token: write` permission, enabling [npm provenance attestations](https://docs.npmjs.com/generating-provenance-statements) via GitHub's OIDC trusted publisher. This means:

- No `NPM_TOKEN` secret is required for publishing — each package must have a trusted publisher configured on npmjs.com.
- A package that has never been published cannot have a trusted publisher, so its **first version must be published by hand** using `npm publish --access public` with a classic token.

### Step 4: Pipeline Execution

1. **Checkout**: Clone repository at tag
2. **Setup Node**: Install Node.js 22
3. **Update npm**: Install latest npm
4. **Set Versions**: Update all package.json files with tag version (kit + 5 dependents)
5. **Install Dependencies**: `npm install` to reify workspace
6. **Build**: Build all packages (`npm run build`)
7. **Integration Tests**: Run core tests against Ulabase
8. **Publish**: Publish all six packages to npm (if tests pass)

### Step 5: Publication

If integration tests pass:
- `@ulabase/kit` published to npm
- `@ulabase/kit-ng` published to npm
- `@ulabase/kit-react` published to npm
- `@ulabase/kit-vue` published to npm
- `@ulabase/cli` published to npm
- `ulabase` meta-package published to npm
- All packages have the same version

If integration tests fail:
- No packages published
- Tag remains in git
- Fix issues and create new tag

## CI/CD Configuration

### Required Secrets

Configure in GitHub repository settings → Environments → `integration-test`:

| Secret | Description |
|--------|-------------|
| `ULABASE_TEST_API_URL` | Ulabase test instance URL |
| `ULABASE_TEST_ADMIN_PASSWORD` | Admin password for test instance |

### Environment

The release workflow uses the `integration-test` environment:

- Required reviewers (optional)
- Environment secrets
- Deployment protection rules

### Permissions

```yaml
permissions:
  contents: read    # Read repository
  id-token: write   # npm provenance attestation (OIDC)
```

### Integration Test Workflow

A separate manual workflow (`integration-test.yml`) allows running integration tests on demand without publishing. It uses the same secrets and environment but can be triggered via `workflow_dispatch`.

## Manual Release Steps

### 1. Prepare Release

```bash
# Ensure you're on main
git checkout main
git pull origin main

# Verify tests pass locally
npm test -w packages/kit

# Update CHANGELOG.md (if maintained)
# Commit any changelog changes
```

### 2. Create and Push Tag

```bash
# Create tag
git tag 1.2.3

# Push tag
git push origin 1.2.3
```

### 3. Monitor CI

- Go to GitHub → Actions → Release workflow
- Watch for successful completion
- Check npm for published packages

### 4. Verify Publication

```bash
# Check npm
npm view @ulabase/kit versions
npm view @ulabase/kit-ng versions
npm view @ulabase/kit-react versions
npm view @ulabase/kit-vue versions
npm view @ulabase/cli versions
npm view ulabase versions

# Test installation
npm install @ulabase/kit@1.2.3
npm install @ulabase/kit-react@1.2.3
npm install @ulabase/cli@1.2.3
```

## Hotfix Releases

For critical bug fixes:

1. Create hotfix branch from tag
2. Apply fix
3. Merge to main
4. Create new patch version tag
5. Push tag to trigger release

```bash
# Create hotfix branch
git checkout -b hotfix/1.2.4 1.2.3

# Apply fix
# ... make changes ...

# Merge to main
git checkout main
git merge hotfix/1.2.4

# Create new tag
git tag 1.2.4
git push origin 1.2.4
```

## Pre-release Versions

For beta/alpha releases:

```bash
# Create pre-release tag
git tag 2.0.0-beta.1
git push origin 2.0.0-beta.1
```

**Note**: Pre-release versions require npm dist-tag configuration:

```bash
# Publish as beta
npm publish -w packages/kit --tag beta
npm publish -w packages/kit-ng --tag beta
```

## Rollback Procedure

If a release has critical issues:

### 1. Deprecate Version on npm

```bash
npm deprecate @ulabase/kit@1.2.3 "Critical bug, use 1.2.4"
npm deprecate @ulabase/kit-ng@1.2.3 "Critical bug, use 1.2.4"
npm deprecate @ulabase/cli@1.2.3 "Critical bug, use 1.2.4"
```

### 2. Publish Fixed Version

```bash
# Create fix
# ... make changes ...

# Tag and push
git tag 1.2.4
git push origin 1.2.4
```

### 3. Un-deprecate Previous Version (Optional)

```bash
npm deprecate @ulabase/kit@1.2.3 ""
npm deprecate @ulabase/kit-ng@1.2.3 ""
```

## Troubleshooting

### Issue: CI Fails on Integration Tests

**Symptoms**: Release workflow fails at test step

**Possible Causes**:
- Ulabase test instance down
- Test credentials expired
- API changes breaking tests

**Solution**:
1. Check test instance status
2. Verify secrets are correct
3. Run tests locally to debug

### Issue: npm Publish Fails

**Symptoms**: CI passes but packages not published

**Possible Causes**:
- Trusted publisher not configured on npmjs.com
- Version already exists
- Package name conflict

**Solution**:
1. Verify trusted publisher is configured for each package on npmjs.com
2. Check if version already exists on npm
3. Ensure package name is available

### Issue: Version Mismatch

**Symptoms**: `kit-ng` can't find `kit` version

**Possible Causes**:
- Version update failed
- npm install didn't reify

**Solution**:
1. Check package.json versions match
2. Verify dependencies field updated
3. Run `npm install` manually

### Issue: Workspace Resolution Problems

**Symptoms**: `kit-ng` uses registry `kit` instead of workspace

**Possible Causes**:
- Stale node_modules
- Nested node_modules shadowing

**Solution**:
```bash
rm -rf node_modules packages/*/node_modules
npm install
```

## Best Practices

### 1. Test Before Tagging

```bash
# Run full test suite
npm test -w packages/kit

# Build all packages
npm run build

# Test in starter app (optional)
cd /path/to/starter
npm link @ulabase/kit @ulabase/kit-ng
ng serve
```

### 2. Use Semantic Versioning

- **Major**: Breaking changes
- **Minor**: New features (backward compatible)
- **Patch**: Bug fixes

### 3. Coordinate with Dependencies

If the Ulabase API changes:
- Update kit to match
- Test against new API version
- Document API version requirement

### 4. Monitor Post-Release

After release:
- Check npm download stats
- Monitor GitHub issues
- Watch for user feedback

## Release Checklist

- [ ] All tests pass locally
- [ ] CHANGELOG.md updated
- [ ] README.md updated (if needed)
- [ ] Package READMEs updated (if needed)
- [ ] Documentation updated (if needed)
- [ ] Tag created with correct version
- [ ] Tag pushed to GitHub
- [ ] CI workflow completed successfully

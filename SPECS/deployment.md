# Deployment & CI Spec

**Status:** ✅ Done (updated 2026-05-08)

## npm Package

- **Binary name:** `codacy` (registered in `package.json` under `bin`)
- **Included files:** `dist/` and `README.md` (via `files` field)
- **Pre-publish:** `prepublishOnly` runs `npm run update-api && npm run build` as a safety net for local publishes
- **Engines:** requires Node.js >= 20
- **Install globally:** `npm install -g "@codacy/codacy-cloud-cli"`

## GitHub Actions

### Build + Test (`ci.yml`)

Triggers on: push and pull requests to `main`.

Matrix: Node.js 20, 22.

Jobs:
- **build-and-test**: checkout → setup node → install → generate API client → type check → build → smoke test the built CLI → test
  - The smoke step runs `node dist/index.js --version` three ways (plain, with `HTTPS_PROXY` set, and with an unreadable `SSL_CERT_FILE` expected to fail). It is the only thing that executes the real entry point — every command test builds a bare `new Command()` — so it is what catches a dependency that loads or constructs fine on one Node version but not another.
- **changeset-check** (PRs only): verifies at least one `.changeset/*.md` file is present in the PR diff

### Release (`release.yml`)

Triggers on: push to `main`.

Uses the [changesets/action](https://github.com/changesets/changesets) to automate versioning and publishing.

Steps:
1. Checkout
2. Setup Node with `registry-url: https://registry.npmjs.org`
3. `npm ci`
4. Generate API client (`npm run update-api`)
5. Build (`npm run build`)
6. Test (`npm test`)
7. `changesets/action` — either:
   - Creates/updates a "chore: version packages" PR (bumps version, updates CHANGELOG.md)
   - If that PR was just merged, runs `changeset publish` to publish to npm with provenance

### Changelog generation (resilient wrapper)

The `changelog` entry in `.changeset/config.json` points to `.changeset/changelog.cjs`
instead of `@changesets/changelog-github` directly. That wrapper still uses the
GitHub generator (rich entries with PR/author links) but makes it **best-effort**:
it retries the GitHub GraphQL call and, if GitHub is unreachable, falls back to
`@changesets/changelog-git` (plain entries with commit SHAs). This prevents a
transient GitHub API failure (`Failed to parse data from GitHub` /
`Premature close`) from aborting the whole "version packages" step.

- Tunable via env vars `CHANGELOG_GITHUB_ATTEMPTS` (default 3) and
  `CHANGELOG_GITHUB_RETRY_MS` (default 1000) — used by the wrapper's tests.
- `@changesets/changelog-git` is pinned as an explicit devDependency so the
  fallback never relies on transitive hoisting.

## Homebrew Formula

Planned for future distribution as a separate brew formula for macOS/Linux/Windows. No implementation yet.

## Required Secrets

| Secret | Used by |
|---|---|
| `NPM_TOKEN` | Release workflow (`NODE_AUTH_TOKEN` for npm publish) |
| `CODACY_API_TOKEN` | CLI runtime (env var, not a secret in CI) |

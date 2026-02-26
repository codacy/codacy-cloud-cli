# Deployment & CI Spec

**Status:** ✅ Done (2026-02-18)

## npm Package

- **Binary name:** `codacy` (registered in `package.json` under `bin`)
- **Included files:** `dist/` and `README.md` (via `files` field)
- **Pre-publish:** `prepublishOnly` runs `npm run build` using `tsconfig.build.json`
- **Engines:** requires Node.js >= 18
- **Install globally:** `npm install -g "@codacy/codacy-cloud-cli"`

## GitHub Actions

### Build + Test (`ci.yml`)

Triggers on: push and pull requests to `main`.

Matrix: Node.js 18, 20, 22.

Steps:
1. Checkout
2. Setup Node
3. `npm ci`
4. `npm run build`
5. `npm test`

### Publish to npm (`publish.yml`)

Triggers on: GitHub release published.

Steps:
1. Checkout
2. Setup Node with `registry-url: https://registry.npmjs.org`
3. `npm ci`
4. `npm run build`
5. `npm publish` (uses `NODE_AUTH_TOKEN` secret)

## Homebrew Formula

Planned for future distribution as a separate brew formula for macOS/Linux/Windows. No implementation yet.

## Required Secrets

| Secret | Used by |
|---|---|
| `NODE_AUTH_TOKEN` | npm publish workflow |
| `CODACY_API_TOKEN` | CLI runtime (env var, not a secret in CI) |

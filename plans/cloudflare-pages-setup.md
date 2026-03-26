# Cloudflare Pages: Deploy Landing Page

Deploy the **landing page** (`landing/`) to Cloudflare Pages via CLI.

## Context

- **What:** The `landing/` directory is a self-contained Vite + React site (`anvil-landing`) — separate from the main Anvil SPA.
- **Build:** `cd landing && npm run build` → outputs to `landing/dist/`
- **Wrangler:** Already installed (v4.59.1, both global and devDependency)
- **Credentials:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in `.env` (Fundamental Research Labs account)
- **URL:** https://anvil-5c2.pages.dev/

## Phases

- [x] Authenticate wrangler with Cloudflare (using API token from `.env`)
- [x] Create Cloudflare Pages project via CLI
- [x] Build and deploy `landing/dist/` to Cloudflare Pages
- [x] Add deploy script to root `package.json`
- [x] Verify live site works

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Usage

```bash
# Deploy landing page
pnpm landing:deploy

# Dev server
pnpm landing:dev

# Build only
pnpm landing:build
```

## Optional: GitHub Integration (later)

Cloudflare Pages can auto-deploy on push via GitHub integration. CLI-only deploys work fine to start.

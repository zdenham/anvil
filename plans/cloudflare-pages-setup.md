# Cloudflare Pages: Deploy Landing Page

Deploy the **landing page** (`landing/`) to Cloudflare Pages via CLI.

## Context

- **What:** The `landing/` directory is a self-contained Vite + React site (`anvil-landing`) — separate from the main Anvil SPA.
- **Build:** `cd landing && npm run build` → outputs to `landing/dist/`
- **Wrangler:** Already installed (v4.59.1, both global and devDependency)
- **Credentials:** None configured yet

## Phases

- [ ] Authenticate wrangler with Cloudflare (`wrangler login`)
- [ ] Create Cloudflare Pages project via CLI
- [ ] Build and deploy `landing/dist/` to Cloudflare Pages
- [ ] Add deploy script to root `package.json`
- [ ] Verify live site works

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase Details

### 1. Authenticate wrangler

```bash
wrangler login
```

Opens a browser to authenticate with your Cloudflare account. Stores an OAuth token locally.

### 2. Create Cloudflare Pages project

```bash
wrangler pages project create anvil --production-branch main
```

This creates the Pages project on Cloudflare. The site will be available at `anvil.pages.dev` (or whatever name is available).

### 3. Build and deploy

```bash
cd landing && npm install && npm run build && cd ..
wrangler pages deploy landing/dist --project-name anvil
```

### 4. Add deploy script to root package.json

Add to `scripts`:
```json
"landing:deploy": "cd landing && npm run build && cd .. && wrangler pages deploy landing/dist --project-name anvil"
```

### 5. Verify

Visit the `.pages.dev` URL and confirm the landing page loads correctly.

## Optional: GitHub Integration (later)

Cloudflare Pages can auto-deploy on push via GitHub integration. CLI-only deploys work fine to start.

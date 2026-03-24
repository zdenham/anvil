# Render CLI Deployment Plan

Deploy the Fastify server (`server/`) to Render using the Render CLI with native Node.js runtime (no Docker, no repo connection required).

## Overview

**Goal**: Manually deploy `anvil-server` to Render using their CLI with native Node.js runtime.

**Server Details**:
- Fastify server with ClickHouse connection
- Environment variables: `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_TABLE`, `PORT`
- Health check endpoint: `GET /health`
- Main endpoint: `POST /logs`

---

## Prerequisites

### 1. Create a Render Account
- Sign up at https://render.com if you don't have an account
- Navigate to Account Settings → API Keys
- Generate an API key and save it securely

### 2. Install Render CLI

```bash
# Using Homebrew (macOS)
brew install render
```

### 3. Authenticate the CLI

```bash
render login
```

This opens a browser for OAuth authentication, or you can use:

```bash
export RENDER_API_KEY=your_api_key_here
```

---

## Step 1: Set Up Bundled Build

The server imports from `../../core/types/logs.js`. We'll use `tsup` to bundle everything into a single self-contained file.

### Install tsup

```bash
cd server
pnpm add -D tsup
```

### Update package.json scripts

Add/update the build script in `server/package.json`:

```json
{
  "scripts": {
    "dev": "tsx watch --env-file=.env src/index.ts",
    "build": "tsup src/index.ts --format esm --target node20 --outDir dist --clean",
    "start": "node dist/index.js",
    "migrate": "tsx --env-file=.env src/migrate.ts"
  }
}
```

### Test the build locally

```bash
cd server
pnpm build
pnpm start
```

This creates a single `dist/index.js` that includes the inlined `core/types` code.

---

## Step 2: Create Render Service via CLI

Use the Render CLI to create and configure the web service directly from your terminal.

### Create the service

```bash
render services create \
  --name anvil-server \
  --type web \
  --runtime node \
  --region oregon \
  --plan starter
```

Note the service ID returned (e.g., `srv-xxxxxxxxxxxxx`).

### Set environment variables

```bash
render env set CLICKHOUSE_URL="https://your-clickhouse-host:8443" --service srv-YOUR_SERVICE_ID
render env set CLICKHOUSE_USER="your_username" --service srv-YOUR_SERVICE_ID
render env set CLICKHOUSE_PASSWORD="your_password" --service srv-YOUR_SERVICE_ID
render env set CLICKHOUSE_DATABASE="your_database" --service srv-YOUR_SERVICE_ID
render env set CLICKHOUSE_TABLE="logs" --service srv-YOUR_SERVICE_ID
```

### Configure build and start commands

```bash
render services update srv-YOUR_SERVICE_ID \
  --build-command "pnpm install && pnpm build" \
  --start-command "node dist/index.js" \
  --health-check-path "/health"
```

---

## Step 3: Deploy

### Deploy from local directory

```bash
cd server
render up
```

The `render up` command packages your local code and deploys it directly to Render without needing a git repo connection.

### Alternative: Trigger deploy after pushing to connected repo

If you later connect a repo:

```bash
render deploys create srv-YOUR_SERVICE_ID
```

---

## Step 4: Monitor and Manage

### Check deploy status

```bash
render deploys list srv-YOUR_SERVICE_ID
```

### View logs

```bash
render logs srv-YOUR_SERVICE_ID
```

### List your services

```bash
render services list
```

---

## Step 5: Create Deployment Script (Optional)

Create `server/scripts/deploy.sh`:

```bash
#!/bin/bash
set -e

echo "Building server..."
pnpm build

echo "Deploying to Render..."
render up

echo "Deployment complete!"
```

Make it executable:
```bash
chmod +x server/scripts/deploy.sh
```

---

## Environment Variables Reference

| Variable | Description | Required |
|----------|-------------|----------|
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint | Yes |
| `CLICKHOUSE_USER` | ClickHouse username | Yes |
| `CLICKHOUSE_PASSWORD` | ClickHouse password | Yes |
| `CLICKHOUSE_DATABASE` | Database name | Yes |
| `CLICKHOUSE_TABLE` | Table name for logs | Yes |
| `PORT` | Server port (Render sets this automatically) | No |

---

## Checklist

- [ ] Create Render account and generate API key
- [ ] Install Render CLI (`brew install render`)
- [ ] Authenticate CLI (`render login`)
- [ ] Add tsup to server dependencies
- [ ] Update build script to use tsup bundling
- [ ] Test bundled build locally
- [ ] Create Render web service via CLI
- [ ] Configure environment variables
- [ ] Deploy with `render up`
- [ ] Verify health check endpoint works
- [ ] Test `/logs` endpoint from your application

---

## Troubleshooting

### Build Failures
- Ensure `tsup` is installed: `pnpm add -D tsup`
- Check that the build command outputs to `dist/index.js`

### Health Check Failures
- Ensure ClickHouse is accessible from Render's network
- Check environment variables are set correctly
- View logs: `render logs srv-YOUR_SERVICE_ID`

### Module Resolution Issues
- The bundled build should inline all local imports
- If issues persist, ensure tsup config includes all dependencies

---

## Cost Estimate

| Tier | Price | Notes |
|------|-------|-------|
| Free | $0 | 750 hours/month, spins down after inactivity |
| Starter | $7/month | Always on, 512MB RAM |
| Standard | $25/month | 2GB RAM, better for production |

For a logging server that needs to be always available, **Starter** is recommended minimum.

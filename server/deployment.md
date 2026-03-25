# Anvil Server Deployment

The server is deployed to [Fly.io](https://fly.io) in the `fundamental-research-labs` organization.

**Live URL:** https://anvil-server.fly.dev/

## Prerequisites

- [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
- Authenticated with `fly auth login`

## Environment Variables

The following secrets must be set in Fly.io:

| Variable | Description |
|----------|-------------|
| `CLICKHOUSE_URL` | ClickHouse HTTP endpoint |
| `CLICKHOUSE_USER` | ClickHouse username |
| `CLICKHOUSE_PASSWORD` | ClickHouse password |
| `CLICKHOUSE_DATABASE` | Database name |
| `CLICKHOUSE_TABLE` | Table name for logs |

Set secrets with:

```bash
fly secrets set -a anvil-server \
  CLICKHOUSE_URL="..." \
  CLICKHOUSE_USER="..." \
  CLICKHOUSE_PASSWORD="..." \
  CLICKHOUSE_DATABASE="..." \
  CLICKHOUSE_TABLE="..."
```

## Deploying

From the `server/` directory:

```bash
fly deploy
```

This builds the Docker image and deploys it. The app uses rolling deployments with 2 machines for high availability.

## Configuration

Key settings in `fly.toml`:

- **Region:** `sjc` (San Jose)
- **Auto-stop:** Machines stop when idle to save costs
- **Auto-start:** Machines start automatically on incoming requests
- **Memory:** 1GB shared CPU

## Useful Commands

```bash
# Check app status
fly status -a anvil-server

# View live logs
fly logs -a anvil-server

# SSH into a machine
fly ssh console -a anvil-server

# View secrets (names only)
fly secrets list -a anvil-server

# Scale machines
fly scale count 2 -a anvil-server
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check, returns ClickHouse connection status |
| `/logs` | POST | Ingest log batch |

### Health Check

```bash
curl https://anvil-server.fly.dev/health
```

### Send Logs

```bash
curl -X POST https://anvil-server.fly.dev/logs \
  -H 'Content-Type: application/json' \
  --data-raw '{"logs":[{"timestamp":1737690000000,"level":"INFO","message":"test"}]}'
```

## Local Development

```bash
# Install dependencies
pnpm install

# Run with hot reload (requires .env file)
pnpm dev

# Build
pnpm build

# Run production build
pnpm start
```

Note: Local development uses `--env-file=.env` to load environment variables. The production start script does not use this flag since Fly.io injects secrets as environment variables directly.

---
name: Query ClickHouse
description: Query ClickHouse observability logs over HTTP API
argument-hint: "[SQL query or investigation description]"
user-invocable: true
allowed-tools: Bash
---

# Query ClickHouse Observability Logs

Query mort production logs stored in ClickHouse via HTTP API using curl.

## Connection

Credentials are in `server/.env` (gitignored). Before every curl command, source the env file to load connection variables:

```bash
source server/.env && curl -s --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
  "$CLICKHOUSE_URL/" \
  --data "SELECT ... FORMAT JSON"
```

The env file provides: `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_TABLE`.

- Always append `FORMAT JSON` for structured output
- Use `FORMAT JSONCompact` for large result sets (less verbose)

## Tables

### `logs` — Core log events (~1.8M rows)

| Column | Type | Description |
|--------|------|-------------|
| `log_id` | String | UUID, auto-generated, primary key |
| `timestamp` | DateTime64(3) | Event time with ms precision |
| `device_id` | String | Device identifier (defaults to '') |
| `level` | LowCardinality(String) | debug, info, warn, error |
| `message` | String | Event message |

### `log_properties` — Key-value properties per log

| Column | Type | Description |
|--------|------|-------------|
| `log_id` | String | FK to logs.log_id |
| `device_id` | String | Device identifier |
| `timestamp` | DateTime64(3) | Event timestamp (duplicated for ordering) |
| `key` | LowCardinality(String) | Property name |
| `value_string` | String | String value (default '') |
| `value_number` | Float64 | Numeric value (default 0) |
| `value_bool` | UInt8 | Boolean value (default 0) |

### `identities` — Device-to-user mapping

| Column | Type | Description |
|--------|------|-------------|
| `device_id` | String | Device identifier |
| `github_handle` | String | GitHub username |
| `registered_at` | DateTime64(3) | Registration timestamp |

## Property Keys

Common keys in `log_properties` (88 total). Notable ones:

- **Identifiers**: `thread_id`, `agent_id`, `device_id`, `terminal_id`, `watch_id`, `parent_id`
- **Execution**: `command`, `cwd`, `pid`, `exit_code`, `duration_ms`, `elapsed_ms`
- **Errors**: `error`, `result`, `success`
- **I/O**: `stdout`, `stdout_len`, `stderr_len`, `bytes`, `read.bytes`, `sz`
- **UI**: `window`, `focused`, `hotkey`, `shortcut`, `width`, `height`, `cols`
- **Networking**: `conn`, `connection.state`, `socket_path`, `socket_health`, `stream.id`
- **Context**: `path`, `runner`, `event`, `kind`, `stage`, `pipeline`, `shell`, `program`
- **Data**: `additional`, `properties`, `raw_contents`, `preview`

## Common Query Patterns

All queries below assume `source server/.env` has been run first.

```bash
# Template for all queries:
source server/.env && curl -s --user "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" \
  "$CLICKHOUSE_URL/" --data "YOUR_QUERY FORMAT JSON"
```

```sql
-- Recent errors
SELECT timestamp, level, message FROM logs
WHERE level = 'error' ORDER BY timestamp DESC LIMIT 50

-- Logs with a specific property (e.g., thread_id)
SELECT l.timestamp, l.level, l.message, p.value_string AS thread_id
FROM logs l
JOIN log_properties p ON l.log_id = p.log_id
WHERE p.key = 'thread_id' AND p.value_string = '...'
ORDER BY l.timestamp

-- Search by message
SELECT timestamp, level, message FROM logs
WHERE message ILIKE '%pattern%' ORDER BY timestamp DESC LIMIT 100

-- Error rate by hour
SELECT toStartOfHour(timestamp) AS hour, count() AS errors
FROM logs WHERE level = 'error'
GROUP BY hour ORDER BY hour DESC LIMIT 24

-- Level distribution
SELECT level, count() AS total FROM logs GROUP BY level ORDER BY total DESC

-- Get all properties for a specific log
SELECT key, value_string, value_number, value_bool
FROM log_properties WHERE log_id = '...'

-- Logs with errors (property-based)
SELECT l.timestamp, l.message, p.value_string AS error
FROM logs l
JOIN log_properties p ON l.log_id = p.log_id
WHERE p.key = 'error' AND p.value_string != ''
ORDER BY l.timestamp DESC LIMIT 50

-- Duration outliers
SELECT l.timestamp, l.message, p.value_number AS duration_ms
FROM logs l
JOIN log_properties p ON l.log_id = p.log_id
WHERE p.key = 'duration_ms' AND p.value_number > 1000
ORDER BY p.value_number DESC LIMIT 50

-- Device activity summary
SELECT device_id, count() AS events, min(timestamp) AS first, max(timestamp) AS last
FROM logs GROUP BY device_id ORDER BY events DESC LIMIT 20

-- Resolve device to GitHub user
SELECT d.device_id, i.github_handle, count() AS events
FROM logs d
LEFT JOIN identities i ON d.device_id = i.device_id
GROUP BY d.device_id, i.github_handle
ORDER BY events DESC

-- Multiple properties for same log (pivot pattern)
SELECT
  l.timestamp, l.message,
  maxIf(p.value_string, p.key = 'thread_id') AS thread_id,
  maxIf(p.value_string, p.key = 'command') AS command,
  maxIf(p.value_number, p.key = 'duration_ms') AS duration_ms
FROM logs l
JOIN log_properties p ON l.log_id = p.log_id
GROUP BY l.log_id, l.timestamp, l.message
ORDER BY l.timestamp DESC LIMIT 50
```

## Investigation Workflow

When given a vague request like "check for errors" or "why is it slow":

1. **Start broad** — error rates, level distribution, recent errors
2. **Narrow** — filter by device, time range, message pattern based on findings
3. **Correlate** — join with `log_properties` to get `thread_id`, `agent_id`, `command`, etc.
4. **Trace** — use `thread_id` or `device_id` to follow a session across events
5. **Identify user** — join `identities` to map `device_id` to `github_handle`

## Response Format

The JSON response contains:
- `data` — array of result rows
- `rows` — total row count
- `statistics.elapsed` — query execution time in seconds
- `meta` — column type information

Parse and summarize results for the user rather than dumping raw JSON.

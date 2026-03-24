# Fly Redis

<!-- TODO(anvil-rename): update when infra is migrated -->
The gateway uses a Redis instance hosted on Fly (`mort-redis` app, `sjc` region).

## Proxying to Local

We run Redis locally on the default port (6379), so the Fly proxy uses port **16380**.

```bash
fly proxy 16380:6379 -a mort-redis
```

This forwards `localhost:16380` to the Fly Redis instance via WireGuard.

### Verifying the Connection

```bash
# Quick ping test
redis-cli -p 16380 ping
# Expected: PONG

# Check server info
redis-cli -p 16380 info server

# Check keyspace
redis-cli -p 16380 info keyspace

# Browse keys
redis-cli -p 16380 scan 0 count 20
```

### Interactive Session

```bash
redis-cli -p 16380
```

### Stopping the Proxy

If started in the foreground, `Ctrl+C`. If backgrounded:

```bash
# TODO(anvil-rename): update when infra is migrated
pkill -f "fly proxy.*mort-redis"
```

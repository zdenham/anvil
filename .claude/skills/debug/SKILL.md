---
name: Debug
description: Debug issues using E2E tests, log analysis, and dev server management
user-invocable: true
---

# Debugging Mort

This skill provides guidance and helpers for debugging issues in the Mort codebase.

## Quick Reference

### Start/Stop Dev Server

```bash
# Start the dev server (full stack: agents, sdk, migrations, tauri)
pnpm dev

# Start headless (no main window)
pnpm dev:headless

# Start without HMR (for debugging hot-reload issues)
pnpm dev:no-hmr

# Kill the dev server (find and terminate all related processes)
pkill -f "tauri dev" && pkill -f "vite" && pkill -f "cargo-watch"
```

### Run Tests

```bash
# Run all tests
pnpm test

# Run UI isolation tests (React components with mocked Tauri)
pnpm test:ui
pnpm test:ui:watch  # watch mode

# Run agent tests (Node environment, includes integration tests)
pnpm test:agents

# Run agent harness tests (spawns real agent subprocesses)
pnpm test:harness
```

### Query Logs

**Local dev logs:**
```bash
# View live dev logs
tail -f logs/dev.log

# Search logs for errors
grep -i "error" logs/dev.log | tail -50

# Search structured JSON logs (LLM-friendly format)
cat ~/.mortician/logs/structured.jsonl | jq 'select(.level == "ERROR")'

# View recent log entries with context
tail -100 logs/dev.log | grep -A5 -B5 "pattern"

# Filter by component
grep "agent_hub" logs/dev.log | tail -20
grep "hub::client" logs/dev.log | tail -20
```

**Production/staging logs:** Use `/query-clickhouse` to query ClickHouse observability logs over HTTP API (errors, sessions, performance, etc.).

## Test Infrastructure Overview

### Test Locations

| Test Type | Location | Config | Command |
|-----------|----------|--------|---------|
| UI Components | `src/**/*.test.{ts,tsx}` | `vitest.config.ts` | `pnpm test` |
| UI Isolation | `src/**/*.ui.test.{ts,tsx}` | `vitest.config.ui.ts` | `pnpm test:ui` |
| Agent Core | `agents/src/**/*.test.ts` | `agents/vitest.config.ts` | `pnpm test:agents` |
| Integration | `agents/src/**/*.integration.test.ts` | `agents/vitest.config.ts` | `pnpm test:agents` |
| Harness | `agents/src/testing/__tests__/` | `agents/vitest.config.ts` | `pnpm test:harness` |

### Key Test Files

- **Agent Message Handler**: `agents/src/runners/message-handler.test.ts`
- **Thread History**: `agents/src/runners/thread-history.test.ts`, `thread-history-live.test.ts`
- **Output Processing**: `agents/src/output.test.ts`
- **Shared Runner Logic**: `agents/src/runners/shared.integration.test.ts`

### Agent Test Harness

The agent harness (`agents/src/testing/agent-harness.ts`) provides sophisticated E2E testing by:

1. **Spawning real agent subprocesses** with controlled environments
2. **Creating temporary test fixtures**:
   - `TestMortDirectory` - Temp mort config
   - `TestRepository` - Git repo fixtures
   - `MockHubServer` - Agent communication mock
3. **Capturing structured output** for assertions

Example harness test pattern:
```typescript
import { AgentHarness } from '../testing/agent-harness';

const harness = new AgentHarness();
await harness.setup();
const result = await harness.runAgent({ prompt: 'test prompt' });
expect(result.events).toContainEqual(expect.objectContaining({ type: 'complete' }));
await harness.cleanup();
```

### UI Test Mocking

UI tests use comprehensive Tauri API mocks defined in `src/test/setup-ui.ts`:

- `@tauri-apps/api/core` - invoke, transformCallback
- `@tauri-apps/api/event` - listen, emit
- Plugins: dialog, global-shortcut, shell, opener
- Mock filesystem, git state, thread metadata

## Logging Architecture

### Log Layers (Rust Backend)

The Rust backend (`src-tauri/src/logging/mod.rs`) has 4 output layers:

1. **Console Layer** - Colored, compact format with uptime timer
2. **JSON File** - `logs/structured.jsonl` for LLM analysis
3. **In-Memory Buffer** - Max 1000 entries, deduplicates similar logs
4. **ClickHouse Layer** - Optional remote logging (via `LOG_SERVER_URL`)

### Log Sources

| Source | Location | Output |
|--------|----------|--------|
| Rust/Tauri | `src-tauri/src/**/*.rs` | Console + files |
| Frontend | `src/lib/logger-client.ts` | Via Tauri invoke |
| Agent Core | `agents/src/lib/logger.ts` | Via hub socket |
| Core Lib | `core/lib/logger.ts` | Console |

### Rate-Limited Logging

Use throttle macros to prevent log spam:
```rust
throttle_debug!("frequent operation");
throttle_info!("periodic update");
throttle_warn!("repeated warning");
```

## Common Debugging Scenarios

### Agent Not Responding

1. Check hub connection: `grep "hub" logs/dev.log | tail -20`
2. Look for socket errors: `grep -i "socket\|connection\|disconnect" logs/dev.log`
3. Run agent tests: `pnpm test:agents`

### UI Not Updating

1. Check frontend logs in browser DevTools console
2. Look for event emission: `grep "emit\|listen" logs/dev.log`
3. Run UI tests: `pnpm test:ui`

### Build Failures

1. Check for TypeScript errors: `pnpm typecheck`
2. Check Rust compilation: `cd src-tauri && cargo check`
3. Clean and rebuild: `pnpm clean && pnpm build`

### Test Failures

1. Run specific test file: `pnpm vitest run path/to/test.ts`
2. Run in watch mode for iteration: `pnpm vitest watch path/to/test.ts`
3. Check test setup mocks: `src/test/setup.ts`, `src/test/setup-ui.ts`

## Dev Server Architecture

The dev server runs 4 concurrent processes:

```
┌─────────────────────────────────────────────────────┐
│                    pnpm dev                         │
├─────────────────────────────────────────────────────┤
│  agents     │ cd agents && pnpm build --watch      │
│  sdk        │ cd core/sdk && pnpm build:watch      │
│  migrations │ cd migrations && pnpm build:watch    │
│  tauri      │ tauri dev $TAURI_ARGS                │
└─────────────────────────────────────────────────────┘
              │
              ▼
         logs/dev.log (combined output)
```

Environment presets are in `scripts/env-presets/`:
- `dev.sh` - Development config (port 1421, dev suffix)
- `prod.sh` - Production-like config

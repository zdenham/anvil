# Progress 002

## Done
- Fixed 3 test failures related to Unix socket removal:
  - `client.test.ts`: Added `VisibilityWatcher` mock so `sendEvent` isn't gated by visibility
  - `connection.test.ts`: Fixed `vi.mock` hoisting issue — `EventEmitter` import must use async `await import("events")` inside mock factory
  - `mock-hub-server.test.ts`: Updated permission response assertion from `"allow"` to `"approve"` to match actual protocol
- All key test files pass: `client.test.ts` (10), `connection.test.ts` (9), `mock-hub-server.test.ts` (29), `socket.test.ts` (6)
- Confirmed grep acceptance criteria: zero Unix socket hits in `core/`, only false positives in `agents/` (`socketHealth` config field, `socketMessages` test var, `proxy-server.ts` net import)

## Remaining
- Run full `cd agents && pnpm test` and verify the 3 fixed tests don't regress (full suite has ~12 pre-existing failures unrelated to this task)
- The `proxy-server.ts` still imports `from "net"` — this is the TCP proxy server, not Unix socket transport, so it's out of scope
- All 7 acceptance criteria from the readme are satisfied

## Context
- Permission protocol uses `"approve"/"deny"`, not `"allow"/"deny"` — the old test was wrong
- `VisibilityWatcher` reads pane-layout.json and gates non-lifecycle events for non-visible threads — tests must mock it
- Pre-existing test failures (thread-history, retry timers, worktree naming, events, queued messages) are unrelated to this task

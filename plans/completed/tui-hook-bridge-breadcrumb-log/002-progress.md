# Progress 002

## Done

- Phase 2: HTTP hook endpoints in sidecar (`/hooks/session-start`, `/hooks/pre-tool-use`, `/hooks/post-tool-use`, `/hooks/stop`)
  - `sidecar/src/hooks/hook-handler.ts` — Express router calling shared core/lib/hooks/ evaluators
  - `sidecar/src/hooks/thread-state-writer.ts` — ThreadState via threadReducer with per-thread async mutex
  - `sidecar/src/hooks/transcript-reader.ts` — Incremental transcript parsing, maps transcript TokenUsage → events TokenUsage
  - 11 new tests all passing
- Phase 3: Dynamic hooks.json generation (`sidecar/src/hooks/hooks-writer.ts`)
  - Called from server.ts `listening` event, writes to `<DATA_DIR>/hooks/hooks.json`
  - 7 new tests all passing
- Phase 4: Extended `buildSpawnConfig()` with `--plugin local:<mortDir>` and env vars (`MORT_THREAD_ID`, `MORT_DATA_DIR`)
  - Updated `createTuiThread` caller in thread-creation-service.ts
- Updated plan phases in both `claude-tui-hook-bridge.md` and `tui-runner-state-architecture.md`

## Remaining

- Phase 5: Frontend integration for TUI thread state display via WebSocket broadcasts
- Phase 6: Lifecycle event emission and tracking (events.jsonl)

## Context

- TokenUsage field name mismatch: transcript uses `cacheCreationInputTokens`/`cacheReadInputTokens`, events uses `cacheCreationTokens`/`cacheReadTokens` — mapped in transcript-reader.ts
- Pre-existing test failures in sidecar (agent-hub-roundtrip) and core (thread-reducer, socket) are unrelated
- The `tui-thread-state` broadcast event is emitted but no frontend consumer exists yet (Phase 5)
- hooks-writer writes to DATA_DIR not \~/.mort — this is correct since DATA_DIR is the mort dir path
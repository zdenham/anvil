# Progress 003

## Done
- Phase 5: Frontend integration for TUI thread state display
  - `sidecar/src/hooks/thread-state-writer.ts` — broadcastUpdate now sends full ThreadAction payload (not just `{type}`)
  - `src/lib/agent-service.ts` — Added `initTuiThreadStateListener()` that listens for `tui-thread-state` WS events and routes them to `eventBus` as `THREAD_ACTION` events
  - Status transitions (COMPLETE/ERROR/CANCELLED) also emit `THREAD_STATUS_CHANGED` for sidebar updates
  - Cleanup integrated into `cleanupAgentMessageListener()`
- Phase 6: Lifecycle event emission and tracking (events.jsonl)
  - `sidecar/src/hooks/event-writer.ts` — New EventWriter class, appends to `~/.mort/threads/{id}/events.jsonl`
  - Events: SESSION_STARTED, TOOL_STARTED, TOOL_COMPLETED, TOOL_DENIED, FILE_MODIFIED, SESSION_ENDED
  - Integrated into `hook-handler.ts` — all hook endpoints now emit lifecycle events
- Tests: 7 new tests in `event-writer.test.ts`, 5 new tests in `hook-handler.test.ts` for events.jsonl — all passing
- Updated broadcast test to verify full action payload
- Marked Phases 5 and 6 complete in `claude-tui-hook-bridge.md`

## Remaining
- Nothing — all 6 phases of the TUI hook bridge plan are complete

## Context
- Pre-existing `agent-hub-roundtrip` test failure is unrelated (noted in iteration 2)
- The TUI listener uses the same `eventBus.emit(THREAD_ACTION)` path as agent threads, so all existing state machine / reducer infrastructure applies

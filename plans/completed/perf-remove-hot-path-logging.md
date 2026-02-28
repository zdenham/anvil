# Remove Render-Path Logging from Hot Components

Extracted from `memory-and-perf-from-timeline.md` Phase 3.

## Phases

- [x] Audit and remove/gate all render-path logs in hot components
- [x] Verify no remaining per-render IPC calls in component bodies

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

During a 10s timeline recording:
- 63 `[ThreadContent:TIMING]` logs
- 29 `[ThreadView:TIMING]` logs
- 28 `[ThreadContent] RENDER` logs
- Debug logs in listener handlers (`[FC-DEBUG]` in AGENT_STATE handler)

All via IPC during active streaming. Even after log batching (Phase 1), these inflate log volume and cause unnecessary work in render paths.

## Files to Change

### `src/components/content-pane/thread-content.tsx`
- Remove or gate `[ThreadContent:TIMING]` and `[ThreadContent] RENDER` logs
- These fire on every render — not useful in production

### `src/components/thread/thread-view.tsx`
- Remove or gate `[ThreadView:TIMING]` logs

### `src/components/thread/message-list.tsx`
- Remove or gate any per-render timing logs

### `src/components/workspace/chat-pane.tsx`
- Remove or gate the render log (it's in the component body, not a useEffect — fires on every render)

### `src/entities/threads/listeners.ts`
- Remove or gate the `[FC-DEBUG]` logs in the AGENT_STATE handler (lines 96-100, 107, 110)
- These were added during investigation and should not remain in production code

## Approach

- **Remove** logs that were clearly added for debugging (FC-DEBUG, RENDER counts)
- **Gate behind `import.meta.env.DEV`** any timing logs that have ongoing diagnostic value
- Do NOT add new logging to replace what's removed — the batched logger + debug panel provide sufficient observability

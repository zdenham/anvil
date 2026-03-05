# Fix Duplicate Events in Event Debugger

## Problem

The event debugger's "Copy JSON" exports duplicate events. Every event appears twice:
- Once with pipeline `[agent:sent, hub:received]`
- Again with pipeline `[agent:sent, hub:received, hub:emitted]`

## Root Cause

In `src-tauri/src/agent_hub.rs`, every message is emitted twice:
1. `app_handle.emit("agent:message", &raw_msg)` — Tauri event (pipeline has `hub:received`)
2. `ws_broadcaster.broadcast("agent:message", raw_msg.clone())` — WS broadcast (pipeline now has `hub:emitted` appended)

The frontend listener in `agent-service.ts` receives both and calls `captureEvent()` for each, with no deduplication.

## Fix: Dedup in Event Debugger Store

In `src/stores/event-debugger-store.ts`, deduplicate by `(threadId, seq)` in `captureEvent()`. When a duplicate seq is seen for the same thread, replace the earlier entry (so we keep the version with the most complete pipeline) rather than adding a new one.

### Implementation

In `captureEvent()`:
1. Extract `seq` from `msg.pipeline[0].seq` and `threadId` from `msg.threadId`
2. If we already have an event with this `(threadId, seq)`, replace it in-place (the later arrival has the fuller pipeline)
3. If no match, append as usual

Use a `Map<string, number>` keyed by `${threadId}:${seq}` → event array index for O(1) lookup.

## Phases

- [ ] Add seq-based dedup to `captureEvent()` in event-debugger-store
- [ ] Verify fix with existing tests or manual inspection

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

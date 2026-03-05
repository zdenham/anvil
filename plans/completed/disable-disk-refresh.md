# Disable Disk Refresh — Pure Event-Based Rendering Experiment

## Goal

Add a runtime toggle (dev-only) that disables all disk reads from the rendering pipeline, so we can observe what the UI looks like when driven **purely by streaming events and agent state deltas** — no gap-recovery reads, no metadata refreshes, no staleness polling.

## Phases

- [ ] Add a `pureEventMode` toggle to a dev settings store
- [ ] Guard all disk-read paths in `listeners.ts` behind the toggle
- [ ] Guard streaming gap recovery (clear-and-wait) in `streaming-store.ts`
- [ ] Disable recovery polling in `state-recovery.ts`
- [ ] Expose toggle in devtools and add logging
- [ ] Manual verification and cleanup

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Inventory of Disk-Read Paths to Guard

Every callsite that reads from disk during the streaming/render lifecycle:

| # | File | Line(s) | What it does | Guard strategy |
|---|------|---------|--------------|----------------|
| 1 | `listeners.ts` | 142 | `refreshById` on every `AGENT_STATE_DELTA` (metadata) | Skip entirely |
| 2 | `listeners.ts` | 151-153 | `refreshById` for parent cascade (inactive thread path) | Skip |
| 3 | `listeners.ts` | 161, 168 | `loadThreadState` on full-sync (no base / no full payload) | Use `full` payload if available; skip disk fallback |
| 4 | `listeners.ts` | 184 | `loadThreadState` on **chain gap** | Skip — just reset chain and accept the gap |
| 5 | `listeners.ts` | 199-201 | `loadThreadState` on error fallback | Skip — log error only |
| 6 | `listeners.ts` | 77, 85, 99, 117 | `refreshById` on `THREAD_CREATED`, `THREAD_UPDATED`, `THREAD_STATUS_CHANGED`, `AGENT_STATE` | Skip |
| 7 | `listeners.ts` | 211, 219 | `refreshById` + `loadThreadState` on `AGENT_COMPLETED` | Skip |
| 8 | `listeners.ts` | 252 | `refreshById` on `THREAD_NAME_GENERATED` | Skip |
| 9 | `listeners.ts` | 193-194 | Parent cascade `refreshById` (active thread path) | Skip |
| 10 | `streaming-store.ts` | 48-55 | Stream gap → clear stream + delete chain ID | Keep the clear (no disk read), but log it differently |
| 11 | `state-recovery.ts` | 31-41 | `recoverStateFromDisk` | No-op |
| 12 | `state-recovery.ts` | 52-71 | `startRecoveryPolling` (3s interval) | Don't start |

## Detailed Design

### Phase 1 — `pureEventMode` toggle

Create a small Zustand store (`src/stores/pure-event-mode.ts`) with a single boolean:

```ts
// src/stores/pure-event-mode.ts
import { create } from "zustand";

interface PureEventModeState {
  enabled: boolean;
  toggle: () => void;
  setEnabled: (v: boolean) => void;
}

export const usePureEventMode = create<PureEventModeState>((set) => ({
  enabled: false,
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setEnabled: (enabled) => set({ enabled }),
}));
```

Expose on `window.__pureEventMode` for devtools toggling.

### Phase 2 — Guard disk reads in `listeners.ts`

Wrap each disk-read callsite with a check:

```ts
import { usePureEventMode } from "@/stores/pure-event-mode";

// Helper at top of file
const isPureEventMode = () => usePureEventMode.getState().enabled;
```

**`AGENT_STATE_DELTA` handler (line 138):**
- Skip `refreshById` (metadata) when pure mode on
- On full-sync with no `full` payload (line 165-169): log warning, skip disk read, reset chain ID
- On **chain gap** (line 180-185): log gap, reset `lastAppliedEventId` to `id`, **do not read disk** — the next event with `previousEventId === null` will carry a `full` payload and resync naturally
- On error fallback (line 196-202): log error, do not read disk
- Skip all parent cascade `refreshById` calls

**Other event handlers:**
- `THREAD_CREATED`, `THREAD_UPDATED`, `THREAD_STATUS_CHANGED`, `AGENT_STATE`, `AGENT_COMPLETED`, `THREAD_NAME_GENERATED`: wrap `refreshById` / `loadThreadState` calls in `if (!isPureEventMode())` guards

### Phase 3 — Guard streaming gap recovery

In `streaming-store.ts`, the gap path (line 48-55) already just clears the stream — no disk read. So no change needed. But add a log when pure mode is on:

```ts
if (isPureEventMode()) {
  logger.info(`[streaming-store] STREAM_DELTA gap in pure-event mode — cleared stream, waiting for resync`);
}
```

### Phase 4 — Disable recovery polling

In `state-recovery.ts`:
- `recoverStateFromDisk`: early return if pure mode on
- `startRecoveryPolling`: don't start interval if pure mode on
- `handleStaleness`: skip recovery + polling if pure mode on (still allow diagnostic config relaying)

### Phase 5 — Devtools exposure + logging

- Expose `window.__pureEventMode = usePureEventMode` for console toggling:
  ```
  window.__pureEventMode.getState().toggle()
  ```
- When toggled **on**, log all skipped disk reads with `[PURE-EVENT]` prefix so you can see exactly what would have been a disk read
- When toggled **off**, existing behavior resumes immediately — trigger a `loadThreadState` for the active thread to resync from disk

### Phase 6 — Verification

Scenarios to test:
1. Start agent with pure mode **off** → toggle **on** mid-conversation → verify streaming still works, messages render from deltas
2. Start agent with pure mode **on** from the beginning → verify first event carries `full` payload and renders correctly
3. Observe what breaks: metadata (cost, status) may not update; thread names may not appear; parent thread cost aggregation will lag
4. Check `window.__diskReadStats.snapshot()` — gap-triggered reads should be 0 in pure mode

## Risks & Notes

- **Metadata will be stale**: thread status, cost, name — these only update via `refreshById` which reads `metadata.json`. In pure event mode these won't update unless the agent also sends them in state events.
- **`AGENT_COMPLETED` won't finalize state**: the final state load on completion won't happen, so any events lost in flight will leave the UI in whatever state the last delta produced.
- **This is intentionally destructive to correctness** — the point is to observe the delta between event-driven rendering and disk-truth rendering, so gaps/staleness are the signal.
- **Toggle off resumes disk reads immediately** with a one-time resync, so there's a safe escape hatch.

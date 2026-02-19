# 03: Frontend Monitoring, Recovery & Diagnostic UI

**Depends on**: 00-shared-types
**Parallel with**: 01-agent-side, 02-rust-hub
**Blocks**: 04-integration

## Overview

Add frontend-side heartbeat monitoring, sequence gap detection, disk-based state recovery, and a diagnostic UI panel. The frontend is the consumer that cares about event freshness — it detects problems and triggers recovery.

All per-message diagnostic logging is opt-in via `DiagnosticLoggingConfig` from `SettingsStoreClient`. Always-on logging is limited to heartbeat status transitions, sequence gap warnings, and errors.

## Phases

- [x] Add `frontend:received` pipeline stamp and sequence gap detection to `agent-service.ts`
- [x] Create `heartbeat-store.ts` (Zustand) with per-thread heartbeat state and monitoring interval
- [x] Add heartbeat case to `agent-service.ts` message listener
- [x] Create `state-recovery.ts` with disk-based recovery and polling fallback
- [x] Wire staleness detection → disk recovery + auto-enable diagnostic logging
- [x] Add heartbeat status indicator to thread UI (dot: green/yellow/red)
- [x] Add diagnostic debug panel (dev-only or behind setting) with per-module toggles

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Pipeline Stage Tracking (`src/lib/agent-service.ts`)

On each incoming `agent:message`:
- Add `{ stage: "frontend:received", seq: msg.pipeline[0].seq, ts: Date.now() }` to the pipeline array
- Track `lastSeq` per `threadId` in heartbeat store
- Check for gaps: if `msg.pipeline[0].seq > lastSeq + 1` → always log warning with exact gap range and pipeline trail
  - Example: `"[agent-service] SEQ GAP: expected 42, got 47 — 5 events dropped. Last seen stages: hub:emitted@seq=41"`
  - Pinpoints drops to **Stage 4** (Tauri emit → webview) if Rust logs show it emitted seq 42-46 but frontend only sees 47
- **When `diagnosticConfig.pipeline` enabled**: Log every message's full pipeline trail (all stages with timestamps, showing latency between hops)
- **When disabled**: Only gap warnings logged
- Accumulate gap stats per thread for summary log on agent completion

### Heartbeat Store (`src/stores/heartbeat-store.ts`)

New Zustand store:

```typescript
interface HeartbeatEntry {
  lastTimestamp: number;     // agent-side timestamp from heartbeat message
  lastReceivedAt: number;    // local receipt time (Date.now())
  lastSeq: number;           // sequence number from pipeline stamp
  missedCount: number;       // consecutive missed heartbeats
  status: 'healthy' | 'degraded' | 'stale';
}

interface HeartbeatState {
  heartbeats: Record<string, HeartbeatEntry>; // threadId → entry
  updateHeartbeat(threadId: string, timestamp: number, seq: number): void;
  removeThread(threadId: string): void;
}
```

**Monitoring interval** (every 3s) checks `Date.now() - lastReceivedAt`:
- `< 8s` → healthy (allows 1 missed heartbeat + jitter)
- `8-15s` → degraded (2-3 missed)
- `> 15s` → stale (pipeline broken)

**Status transitions** (always logged regardless of diagnostic config):
- `healthy → degraded`: `logger.warn("[heartbeat] Thread {id} degraded — {missedCount} missed heartbeats")`
- `degraded → stale`: `logger.warn("[heartbeat] Thread {id} stale — triggering disk recovery")`
- `stale → healthy`: `logger.info("[heartbeat] Thread {id} recovered — heartbeats resumed")`

Clean up heartbeat tracking when `AGENT_COMPLETED` or `AGENT_CANCELLED` fires.

### Heartbeat Message Handling (`src/lib/agent-service.ts`)

New `heartbeat` case in the `agent:message` listener switch:
```typescript
case "heartbeat":
  heartbeatStore.getState().updateHeartbeat(
    msg.threadId,
    msg.timestamp,
    msg.pipeline?.[0]?.seq ?? 0,
  );
  break;
```

### State Recovery (`src/lib/state-recovery.ts`)

```typescript
async function recoverStateFromDisk(threadId: string): Promise<void> {
  const state = await threadService.loadThreadState(threadId);
  if (state) {
    eventBus.emit(EventName.AGENT_STATE, { threadId, state });
  }
}
```

**Polling fallback**: When heartbeats go stale, start polling `state.json` from disk every 3 seconds until heartbeats resume or agent completes. This ensures the UI always catches up even if the event pipeline is completely broken.

### Auto-Enable Diagnostics on Staleness

When the heartbeat monitor transitions a thread to `stale`:
1. Enable all diagnostic modules via `settingsStoreClient.set("diagnosticLogging", { pipeline: true, heartbeat: true, sequenceGaps: true, socketHealth: true })`
2. Send `diagnostic:config` relay message through the hub to notify in-flight agents (so they update their module flags without restart)
3. Update Rust-side managed state via Tauri command (`update_diagnostic_config`)
4. Log: `logger.warn("[diagnostics] Auto-enabled all diagnostic modules due to heartbeat staleness")`
5. On recovery back to `healthy`: do NOT auto-disable (leave on so developer can review captured data; manual disable via UI)

### Heartbeat Status Indicator (UI)

In thread header or status bar (visible only when agent status === "running"):
- Small dot reflecting heartbeat health: Green (healthy), Yellow (degraded), Red (stale)
- Tooltip: last heartbeat time, sequence number, missed count, gaps detected

### Diagnostic Debug Panel

Dev-only or behind setting. Shows:
- Per-thread: heartbeat status, last seq, total gaps detected, recovery count
- AgentHub connected agents list (via existing `list_connected_agents` invoke)
- Last N sequence gaps with timestamps
- **Per-module toggles**: `pipeline`, `heartbeat`, `sequenceGaps`, `socketHealth`
  - Each shows current state (on/off) and whether auto-enabled by staleness detection
  - "Enable All" / "Disable All" shortcut
  - Badge if any modules were auto-enabled

## Key Decisions

- **Frontend-side monitoring, not Rust-side**: The frontend is the consumer that cares about freshness. Rust hub is a dumb pipe — keep it that way.
- **Auto-enable diagnostics on staleness**: Ensures full tracing is active exactly when the problem is happening. Doesn't auto-disable on recovery so captured data can be reviewed.
- **Disk recovery as primary mechanism**: Leverages existing "disk as truth" pattern. No message replay or complex retry logic needed.
- **Polling fallback at 3s**: If heartbeats go stale, poll state.json directly. This is the last-resort recovery path for a completely broken event pipeline.
- **Status indicator is minimal**: Small dot, tooltip for details. Not a modal or banner — the problem is subtle and the fix (disk recovery) is automatic.

## Files

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/lib/agent-service.ts` | Add heartbeat case, pipeline stamp on receipt, seq gap detection |
| Create | `src/stores/heartbeat-store.ts` | Zustand store for per-thread heartbeat state + monitoring interval |
| Create | `src/lib/state-recovery.ts` | Disk-based recovery + polling fallback |
| Modify | `src/entities/threads/listeners.ts` | Trigger recovery on staleness, auto-enable diagnostics |
| Modify | `src/components/thread/working-indicator.tsx` | Heartbeat status dot (green/yellow/red) |
| Create | `src/components/diagnostics/diagnostic-panel.tsx` | Debug panel with per-module toggles (optional, dev-only) |

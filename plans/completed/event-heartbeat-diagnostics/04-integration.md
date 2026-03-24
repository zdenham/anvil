# 04: Integration & Verification

**Depends on**: 01-agent-side, 02-rust-hub, 03-frontend (all three must be complete)

## Overview

Wire the three layers together and verify end-to-end correctness. Each layer was built to the shared type contract from 00-shared-types, but integration points need validation:

1. Pipeline stamps flow correctly through all 4 stages
2. Heartbeats are emitted, forwarded, received, and monitored
3. Diagnostic config propagates from frontend → Rust → agent (and back on auto-enable)
4. Disk recovery triggers correctly on staleness and actually updates the UI
5. Reconnection works when the hub restarts

## Phases

- [x] Verify pipeline stamp flow: agent → hub → frontend (check stamp array integrity at each hop)
- [x] Verify heartbeat flow: agent emits → hub forwards → frontend monitors → status transitions work
- [x] Verify diagnostic config propagation: frontend toggle → Tauri command → Rust state + relay → agent hot-reload
- [x] Verify auto-enable on staleness: simulate staleness → diagnostics auto-enable → agents receive config update
- [x] Verify disk recovery: simulate stale heartbeat → state.json polled → UI updates with disk state
- [x] Verify reconnection: simulate hub disconnect → agent buffers → reconnect → flush queue → UI catches up
- [x] Wire `ANVIL_DIAGNOSTIC_LOGGING` env var into agent spawn path (set from frontend diagnostic config when spawning new agents)
- [x] Run existing test suite (`cd agents && pnpm test`) to ensure no regressions

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Integration Points

### 1. Agent Spawn Path

When the frontend spawns a new agent, it needs to pass the current diagnostic config as `ANVIL_DIAGNOSTIC_LOGGING` env var. Find where agent processes are spawned (likely in Rust or via Tauri command) and inject:

```
ANVIL_DIAGNOSTIC_LOGGING=<JSON string of current DiagnosticLoggingConfig>
```

This ensures new agents start with the correct diagnostic settings without needing a relay message.

### 2. Heartbeat Start Gating

Only root-level agents should call `startHeartbeat()`. Sub-agents spawned via Task tool don't need heartbeats. The gating logic goes in `runner.ts` — check if this agent has a `parentId` (sub-agent) and skip heartbeat if so.

### 3. Message Type Registration

Ensure the `heartbeat` message type is handled at every layer:
- Agent: sends `{ type: "heartbeat", timestamp: ... }` (with pipeline stamps from `send()`)
- Rust hub: forwards like any other non-register, non-relay message (no special case needed)
- Frontend `agent-service.ts`: new `case "heartbeat"` routes to heartbeat store

### 4. Diagnostic Config Relay

The relay path for `diagnostic:config`:
- Frontend calls `settingsStoreClient.set("diagnosticLogging", config)`
- Frontend calls Tauri command `update_diagnostic_config(config)` to update Rust state
- Frontend calls `sendToAgent(threadId, { type: "relay", name: "diagnostic:config", payload: config })` for each running agent
- Agent's `HubClient` handles incoming `diagnostic:config` relay and updates its `diagnosticConfig`

### 5. Cleanup

Ensure all new intervals/timers are properly cleaned up:
- Heartbeat timer: cleared on `disconnect()` / `gracefulDisconnect()`
- Monitoring interval in heartbeat store: cleared when store is destroyed or all threads complete
- Polling fallback in state recovery: cleared when heartbeats resume or agent completes

## Testing Strategy

- **Unit tests**: Each sub-plan should have tests for its components (heartbeat timer, gap detection, config parsing)
- **Integration test**: Use `AgentTestHarness` from existing test infrastructure to spawn an agent, verify pipeline stamps arrive correctly, simulate disconnect, verify reconnection
- **Manual validation**: Start an agent, enable pipeline diagnostics, verify stamps appear in logs at all 4 stages

## Files

| Action | File | Description |
|--------|------|-------------|
| Modify | `src/lib/agent-service.ts` | Inject `ANVIL_DIAGNOSTIC_LOGGING` env var in spawn + resume |
| Verify | `agents/src/runner.ts` | Heartbeat gating on root-level (already correct from Phase 1) |
| Fix | `src/entities/threads/listeners.ts` | Fix diagnostic relay type mismatch (`diagnostic:config` → `diagnostic_config`), add Rust hub update call |
| Fix | `src/components/diagnostics/diagnostic-panel.tsx` | Add `update_diagnostic_config` Tauri command calls to module toggles |
| Fix | `agents/src/lib/hub/client.test.ts` | Update tests for pipeline stamp expectations |
| Verify | All files from 01, 02, 03 | Integration verification |

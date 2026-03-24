# Event Heartbeat & Dropped Event Diagnostics

## Problem

The UI sometimes stops receiving events from the agent while the agent is still running. The agent continues working (producing output, making API calls), but the UI appears frozen. There is no heartbeat system, no sequence numbering, and no way to detect or recover from this state.

## Root Cause Analysis

The agent has NOT disconnected from the socket — `runner.ts:231-240` calls `process.exit(1)` on socket disconnect, and since the agent keeps running, the socket connection is alive. The problem is **downstream of the socket write**.

The event pipeline has 5 stages:
```
Agent (Node.js) → Socket Write → AgentHub (Rust) → Tauri emit → Frontend listener
     [1]              [2]              [3]              [4]            [5]
```

Stages 1-2 are likely NOT the problem. Most likely culprits are stages 3-5 (Rust forwarding, Tauri IPC delivery, Frontend processing). See `original-plan.md` for full root cause analysis.

## Sub-Plan Dependency Graph

```
                    ┌─────────────────────┐
                    │  00-shared-types     │  (must go first)
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
   ┌──────────────────┐ ┌─────────────┐ ┌──────────────────┐
   │  01-agent-side    │ │ 02-rust-hub │ │ 03-frontend      │
   │  (Node.js)       │ │ (Rust)      │ │ (TS/React)       │
   └──────────────────┘ └─────────────┘ └──────────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────────┐
                    │  04-integration     │  (after all tracks)
                    └─────────────────────┘
```

**Parallelism**: Sub-plans 01, 02, and 03 can execute in parallel once 00 is complete. They touch completely separate codebases (Node.js agents, Rust Tauri backend, TypeScript frontend) with no file overlap.

## Sub-Plans

| # | Name | Files | Depends On |
|---|------|-------|------------|
| [00](./00-shared-types.md) | Shared Types & Config | `core/types/pipeline.ts`, `core/types/diagnostic-logging.ts` | — |
| [01](./01-agent-side.md) | Agent-Side Pipeline & Heartbeat | `agents/src/lib/hub/client.ts`, `connection.ts`, `heartbeat.ts`, `runner.ts`, `output.ts` | 00 |
| [02](./02-rust-hub.md) | Rust AgentHub Pipeline Tracking | `src-tauri/src/agent_hub.rs` | 00 |
| [03](./03-frontend.md) | Frontend Monitoring & Recovery | `src/lib/agent-service.ts`, `src/stores/heartbeat-store.ts`, `src/lib/state-recovery.ts`, UI components | 00 |
| [04](./04-integration.md) | Integration & Verification | Cross-cutting wiring, E2E validation | 01, 02, 03 |

## Phases

- [x] Implement shared types and diagnostic config (00-shared-types)
- [x] Implement agent-side pipeline stamping, heartbeat, connection health, and reconnection (01-agent-side)
- [x] Implement Rust hub pipeline tracking and seq gap detection (02-rust-hub)
- [x] Implement frontend heartbeat monitoring, state recovery, and diagnostic UI (03-frontend)
- [x] Integration wiring and end-to-end verification (04-integration)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Key Decisions (apply to all sub-plans)

1. **Pipeline stage tracking is Phase 1** (not heartbeats): We don't know where events are being dropped. Pipeline stage stamps at every hop triangulate the exact failure point before we invest in recovery mechanisms.
2. **String enum pipeline stages**: `"agent:sent"`, `"hub:received"`, `"hub:emitted"`, `"frontend:received"` — human-readable in logs without cross-referencing.
3. **Diagnostic logging is per-module, not a single boolean**: Four independent modules (`pipeline`, `heartbeat`, `sequenceGaps`, `socketHealth`) toggled separately via `DiagnosticLoggingConfig`. Status transitions, gap summaries, and errors always log regardless.
4. **Auto-enable diagnostics on heartbeat staleness**: Full tracing kicks in exactly when the problem is happening. Stays on after recovery so captured data can be reviewed.
5. **5-second heartbeat interval**: Balances responsiveness and overhead (~200 bytes per heartbeat).
6. **Pipeline stamps on all messages** (not just heartbeats): Enables gap detection for any message type.
7. **Disk recovery as primary recovery mechanism**: Leverages existing "disk as truth" architecture.
8. **Frontend-side monitoring** (not Rust-side): Frontend is the consumer that cares about freshness. Rust hub is a dumb pipe.
9. **Heartbeat is opt-in per agent process**: Only root-level agents start heartbeat.
10. **Disconnect no longer kills the agent**: Agent keeps running and writing to disk. Reconnection attempted. Even on failure, agent completes its work.
11. **Bounded reconnect retry**: 5 attempts with exponential backoff (~15s total).
12. **Smart reconnect queue**: Buffer up to 50 messages. State messages deduplicated (only latest per thread).
13. **Three-tier logging**: (a) Always-on: transitions, gaps, errors. (b) Per-module opt-in diagnostic. (c) Existing agent-side `DEBUG` env var.
14. **Module config as JSON env var**: Agents receive `DiagnosticLoggingConfig` as JSON string in `ANVIL_DIAGNOSTIC_LOGGING`.

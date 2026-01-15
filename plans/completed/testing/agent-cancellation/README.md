# Agent Cancellation Implementation Plan

## Overview

This plan implements the ability for users to cancel running agents. Currently, once an agent is spawned, it runs until completion, error, or process termination. This feature addresses several user pain points:

- Agents stuck in infinite loops
- Prompts that need correction mid-execution
- Unwanted cost accumulation
- Desire to pivot to a different approach

**Key Design Decisions:**
- Cancellation is non-destructive: all progress (messages, file changes) is preserved
- Cancelled threads are resumable (same as completed threads)
- No confirmation dialog required (fast cancellation for cost control)
- Uses standard exit code 130 (128 + SIGINT) for cancelled processes

## Architecture

The cancellation flow spans three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (Tauri)                                               │
│  - Tracks active processes via activeProcesses Map              │
│  - cancelAgent() sends SIGTERM to process                       │
│  - Handles exit code 130 → marks thread "cancelled"             │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ SIGTERM
┌─────────────────────────────────────────────────────────────────┐
│  Agent Runtime (Node.js)                                        │
│  - Signal handler triggers abortController.abort()              │
│  - SDK query() respects AbortController, throws AbortError      │
│  - Catch block calls cancelled(), persists state, exits 130     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ abortController
┌─────────────────────────────────────────────────────────────────┐
│  Claude Agent SDK                                               │
│  - Receives abortController in query() options                  │
│  - Aborts in-flight API calls and tool execution                │
│  - Throws AbortError to caller                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Execution Order

```
01-core-types.md (prerequisite, small)
         │
    ┌────┴────┐
    │         │
    ▼         ▼
02-agent-runtime.md    03-frontend-integration.md
(agents/* files)       (src/* files)
    │         │
    └────┬────┘
         │
         ▼
   Integration testing
```

## Sub-Plans

| # | Plan | Purpose | Files Modified |
|---|------|---------|----------------|
| 01 | [Core Types](./01-core-types.md) | Add "cancelled" status to type definitions | `core/types/events.ts`, `core/types/threads.ts` |
| 02 | [Agent Runtime](./02-agent-runtime.md) | Make Node agent respond to SIGTERM with graceful abort | `agents/src/runners/shared.ts`, `agents/src/output.ts`, `agents/src/runner.ts` |
| 03 | [Frontend Integration](./03-frontend-integration.md) | Track processes, provide cancelAgent(), update UI | `src/lib/agent-service.ts`, `src/entities/threads/service.ts`, UI components |

### Plan Details

**01 - Core Types** (Prerequisite)
- Adds "cancelled" to `AgentThreadStatus` and `ThreadStatus` enums
- Adds `AGENT_CANCELLED` event for frontend notification
- Must complete before 02 and 03 can start

**02 - Agent Runtime** (Can run in parallel with 03)
- Adds `AbortController` support to `runAgentLoop()` and `setupSignalHandlers()`
- Creates `cancelled()` output function for state persistence
- Handles `AbortError` in runner with exit code 130

**03 - Frontend Integration** (Can run in parallel with 02)
- Unifies process tracking (`activeProcesses` Map for all agent types)
- Implements `cancelAgent()` function with timeout escalation
- Handles exit code 130 in close handlers
- Adds cancel button and cancelled state display in UI

## Testing Strategy

After each sub-plan:

| Sub-Plan | Verification |
|----------|--------------|
| 01 | `pnpm typecheck` passes |
| 02 | Agent exits with code 130 on SIGTERM, writes "cancelled" to state.json |
| 03 | `cancelAgent()` sends kill signal, thread marked cancelled in UI |

### Integration Tests
- Cancel during idle (waiting for API response)
- Cancel during tool execution
- Cancel rapid succession
- Verify worktree released after cancel
- Verify state.json and metadata.json have "cancelled" status
- Cancel then resume thread

## Known Limitations

1. **Tauri kill() limitation**: Tauri's `Child.kill()` sends SIGTERM, not SIGKILL. Truly hung processes may require app restart.
2. **Tool execution interruption**: File writes may be incomplete if cancelled mid-tool. Orphaned tool output is marked as error state.

## Original Plan

See [`../agent-cancellation.md`](../agent-cancellation.md) for the full context, rationale, edge cases, and detailed implementation code.

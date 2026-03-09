# Fix: Cancellation Regression — Red Banner + Parent Thread Killed Mid-Run

## Problem

After implementing `fix-cancellation-stuck-running.md`, two new symptoms appeared:

1. **Red error banner with no message** appears randomly during agent runs
2. **Parent thread state changes to terminal** (error/completed) while the agent is still running
3. Cancel/pause button disappears (consequence of thread being in terminal state)

## User Experience

```
You're chatting with an agent. It spawns a sub-agent (Task tool).

  ┌─────────────────────────────────────────────────────────┐
  │  Parent Thread (your view)                              │
  │                                                         │
  │  [user] "Refactor the auth module"                      │
  │  [agent] "I'll break this into tasks..."                │
  │  [agent] ██ Task: Update login flow                     │
  │          ↳ sub-agent working...                         │
  │          ↳ sub-agent done ✓                             │
  │                                                         │
  │  At this exact moment ──────────────────────────┐       │
  │                                                 ▼       │
  │  ┌───────────────────────────────────────────────────┐  │
  │  │  Red banner appears (no text)                     │  │
  │  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  │
  │  └───────────────────────────────────────────────────┘  │
  │                                                         │
  │  Cancel button: GONE                                    │
  │  Thread status: "error" (but agent is still running!)   │
  │  Input box: shows "Resume" instead of message queue     │
  │                                                         │
  │  The agent keeps working in the background,             │
  │  but you can't interact with it.                        │
  └─────────────────────────────────────────────────────────┘

  What happened behind the scenes:

  Sub-agent completes
       │
       ▼
  Parent's hub client sends AGENT_COMPLETED
  (envelope stamped with PARENT threadId — this is the bug)
       │
       ▼
  routeAgentEvent: AGENT_COMPLETED not in case list
       │
       ▼
  Falls to default case → wraps payload:
  { threadId: PARENT, payload: { threadId: CHILD, exitCode: 0 } }
       │
       ▼
  AGENT_COMPLETED listener destructures:
  threadId = PARENT (wrong!), exitCode = undefined (missing!)
       │
       ▼
  Safety net: "PARENT is still running after exit? Must have crashed"
  exitCode undefined ≠ 130, ≠ 0 → forcedStatus = "error"
       │
       ▼
  threadService.setStatus(PARENT, "error")
       │
       ├──→ metadata.status = "error"     → red banner visible
       └──→ threadState.error = undefined  → red banner has no text
```

## Root Cause

`AGENT_COMPLETED` **is missing from** `routeAgentEvent`**'s explicit routing list** in `src/lib/agent-service.ts:245-258`.

When a child thread (Task/Agent tool) completes during a parent agent's run, the agent emits `AGENT_COMPLETED` via the hub socket (`agents/src/runners/shared.ts:1203`). The socket message arrives at the frontend with `msg.threadId = PARENT_THREAD_ID` (because the parent's socket connection tags all messages with its own threadId).

In `routeAgentEvent`, `AGENT_COMPLETED` is not in the explicit case list, so it falls to the **default case** (line 273-277):

```ts
default:
  eventBus.emit(eventName as any, { threadId, payload });
//                                   ^^^^^^^^  ^^^^^^^
//                                   PARENT ID  original payload nested inside
```

This emits `{ threadId: PARENT_ID, payload: { threadId: CHILD_ID, exitCode: 0 } }` instead of the correct `{ threadId: CHILD_ID, exitCode: 0 }`.

The Phase 2c safety net (added by the previous fix) in `listeners.ts:159-172` then:

1. Destructures `{ threadId, exitCode }` → gets `threadId = PARENT_ID`, `exitCode = undefined`
2. Calls `refreshById(PARENT_ID)` — parent is still "running" on disk
3. Checks `freshThread?.status === "running"` → **true** (parent IS running)
4. Computes `forcedStatus`: `undefined === 130` → false, `undefined === 0` → false → **"error"**
5. Calls `threadService.setStatus(PARENT_ID, "error")` — **kills the parent thread**

This explains all three symptoms: red error banner (no actual error message), terminal state while agent runs, and cancel button gone.

### Why it's "random"

It only triggers when the agent spawns a child thread (Task/Agent tool) and that child completes. Simple single-thread agent runs without child tasks are unaffected.

## Phases

- [x] Phase 1: Add AGENT_COMPLETED to routeAgentEvent routing

- [x] Phase 2: Harden safety net against misrouted events

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Add AGENT_COMPLETED to routeAgentEvent routing

`src/lib/agent-service.ts` — Add `EventName.AGENT_COMPLETED` to the passthrough case list in `routeAgentEvent`:

```ts
    case EventName.THREAD_CREATED:
    case EventName.THREAD_UPDATED:
    case EventName.THREAD_STATUS_CHANGED:
    case EventName.WORKTREE_ALLOCATED:
    case EventName.WORKTREE_RELEASED:
    case EventName.WORKTREE_NAME_GENERATED:
    case EventName.ACTION_REQUESTED:
    case EventName.AGENT_CANCELLED:
    case EventName.AGENT_COMPLETED:        // ← ADD THIS
    case EventName.THREAD_NAME_GENERATED:
    case EventName.PLAN_DETECTED:
    case EventName.COMMENT_ADDED:
    case EventName.COMMENT_UPDATED:
    case EventName.COMMENT_RESOLVED:
    case EventName.COMMENT_DELETED:
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      eventBus.emit(eventName as any, payload as any);
      break;
```

This ensures the payload is passed through as-is (`{ threadId: CHILD_ID, exitCode: 0 }`), so the listener processes the correct thread.

### Verification

After fix, when a child thread completes:

- `routeAgentEvent` receives `payload = { threadId: childId, exitCode: 0 }`
- Emits it directly → listener gets `threadId = childId`
- Safety net checks the CHILD thread, not the parent
- Parent thread remains "running" (correct)

## Phase 2: Harden safety net against misrouted events

Add a guard in the Phase 2c safety net to verify the AGENT_COMPLETED event actually corresponds to a process that was tracked on the frontend side. Socket-routed child thread completions don't have entries in `activeSimpleProcesses` or `agentProcesses` — only `agent_close`-originated events do (since the frontend only tracks processes it spawned directly).

`src/entities/threads/listeners.ts` — In the `AGENT_COMPLETED` handler, import and check against `isAgentRunning`:

```ts
import { isAgentRunning } from "@/lib/agent-service.js";

// Inside the AGENT_COMPLETED handler, wrap the safety net:
const freshThread = threadService.get(threadId);
if (freshThread?.status === "running") {
  // Only force-transition if this thread had a frontend-tracked process.
  // Socket-routed AGENT_COMPLETED events (child thread completions) don't have
  // entries in agentProcesses — their lifecycle is managed by the parent agent.
  if (!isAgentRunning(threadId)) {
    logger.warn(`[ThreadListener] Thread ${threadId} still "running" after process exit (code=${exitCode}), forcing status`);
    const forcedStatus = exitCode === 130 ? "cancelled" : exitCode === 0 ? "completed" : "error";
    await threadService.setStatus(threadId, forcedStatus);
  }
}
```

This prevents the safety net from ever firing for events that didn't originate from a tracked process exit, making it robust against any future routing bugs.

### Files to modify

| File | Change |
| --- | --- |
| `src/lib/agent-service.ts` | Add `AGENT_COMPLETED` to explicit routing in `routeAgentEvent` (line \~252) |
| `src/entities/threads/listeners.ts` | Guard safety net with `isAgentRunning` check |

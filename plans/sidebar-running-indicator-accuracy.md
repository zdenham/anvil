# Sidebar Running Indicator Accuracy

## Problem

When a Claude Code TUI session is started, the left sidebar status dot stays green (running) for the entire lifetime of the PTY process — even when the agent is idle waiting for user input. The green indicator should only show while the agent is actively processing a turn.

## Root Cause

TUI threads have no turn-level status signaling. The sidebar dot is driven by `thread.status` in metadata, which stays "running" from PTY spawn until PTY exit. There's no mechanism to transition status between turns.

## Approach: Hook-Based Turn Lifecycle

The sidecar already receives hooks from Claude Code CLI for every TUI session. These hooks are natural turn-boundary signals:

| Hook | Fires when | Signal meaning |
| --- | --- | --- |
| `UserPromptSubmit` | User sends a message | **Turn starting** → status should be `"running"` |
| `PreToolUse` / `PostToolUse` | Tool execution | Agent is actively working (already `"running"`) |
| `Stop` | Agent finishes responding | **Turn ended** → status should be `"idle"` |
| `SessionStart` | Session begins | Initial setup (thread already `"running"` from creation) |

The `UserPromptSubmit` → `Stop` cycle maps directly to the running/idle transitions we need.

## Phases

- [x] Fix Stop hook to not evict state (supports multi-turn TUI sessions)

- [x] Bridge hook actions to metadata status updates in the frontend

- [x] Persist status changes to metadata.json from the listener

- [x] Verify sidebar dot correctly reflects idle vs active state

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase Details

### Phase 1: Fix Stop hook state eviction

**File:** `sidecar/src/hooks/hook-handler.ts:220-251`

The `Stop` hook fires at the **end of each agent turn**, not just session end. But the current handler evicts in-memory state (`stateWriter.evict()`, `transcriptReader.reset()`), which destroys accumulated messages/file changes between turns.

**Changes:**

- Remove the `stateWriter.evict(threadId)` and `transcriptReader.reset(threadId)` calls from the Stop handler
- Move cleanup to a separate mechanism triggered by PTY process exit (the `AGENT_COMPLETED` event path already handles this)
- Alternatively, add a dedicated cleanup endpoint or use a TTL-based eviction for orphaned state

**Note:** The `COMPLETE` action dispatched by Stop is fine — the thread reducer sets `status: "complete"`. But the eviction must not happen because the TUI session continues.

### Phase 2: Bridge hook actions to metadata status

**File:** `src/lib/agent-service.ts:186-216`

The `tui-thread-state` listener currently only handles terminal actions (`COMPLETE`, `ERROR`, `CANCELLED`). It needs to also handle turn-start signals.

**Changes:**

- Add `APPEND_USER_MESSAGE` to the set of actions that trigger `THREAD_STATUS_CHANGED`
- Map `APPEND_USER_MESSAGE` → status `"running"` (user submitted a prompt, agent is about to process)
- Map `COMPLETE` → status `"idle"` instead of `"completed"` (turn ended but process is still alive — the PTY session continues)
- Keep `ERROR` and `CANCELLED` mapped to their current values (these are true terminal states)

```typescript
const TURN_START_ACTIONS = new Set(["APPEND_USER_MESSAGE", "INIT"]);
const TURN_END_ACTIONS = new Set(["COMPLETE"]);
const TERMINAL_ACTIONS = new Set(["ERROR", "CANCELLED"]);

// APPEND_USER_MESSAGE or INIT → "running"
// COMPLETE → "idle"
// ERROR → "error", CANCELLED → "cancelled"
```

**Edge case:** `SessionStart` dispatches `INIT` which should also map to `"running"`. Include `INIT` in turn-start actions for the case where a session starts without an immediate `UserPromptSubmit`.

### Phase 3: Persist status to metadata.json

**File:** `src/entities/threads/listeners.ts:185-211`

The `handleStatusChanged` listener currently calls `threadService.refreshById()` which reads metadata from disk. But for TUI threads, nobody has written the new status to `metadata.json` — the sidecar only updates `state.json`. So `refreshById()` reads stale metadata.

**Changes:**

- When `THREAD_STATUS_CHANGED` fires, call `threadService.setStatus(threadId, status)` to write the status to `metadata.json`, rather than just refreshing from disk
- The event payload already includes `status` (from the mapping in Phase 2)
- Keep the existing cascade logic for cancelled status
- Keep the unread marking for running status

```typescript
const handleStatusChanged = async ({ threadId, status }: EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]) => {
  // Write status to metadata.json so it persists
  await threadService.setStatus(threadId, status);

  const thread = threadService.get(threadId);
  // ... existing cascade and unread logic ...
};
```

**Check:** Verify that `EventPayloads[typeof EventName.THREAD_STATUS_CHANGED]` includes the `status` field. If not, add it to the event type.

### Phase 4: Verify sidebar dot behavior

- Confirm `thread-colors.ts` handles "idle" status correctly (it should fall through to the `isRead` check, showing as grey/read — not green)
- Confirm the StatusDot component doesn't need changes (idle threads should not show the green running animation)
- Test the full cycle: PTY spawn → green dot → agent responds → dot goes grey → user sends message → green dot again

## Key Files

| File | Role |
| --- | --- |
| `sidecar/src/hooks/hook-handler.ts:220-251` | Stop hook — remove state eviction |
| `src/lib/agent-service.ts:186-216` | TUI state listener — add turn-start/end action handling |
| `src/entities/threads/listeners.ts:185-211` | `handleStatusChanged` — write status to metadata.json |
| `src/entities/threads/service.ts:404` | `setStatus()` — already exists, writes metadata to disk |
| `src/utils/thread-colors.ts:17-31` | Status → sidebar dot variant mapping |
| `core/types/threads.ts` | `ThreadStatus` type — already includes `"idle"` |

## Implementation Notes

- The `ThreadStatus` type already includes `"idle"` — no type changes needed
- `getThreadStatusVariant()` in `thread-colors.ts` only checks for `"running"` specifically, so `"idle"` will correctly fall through to the `isRead`-based variants (blue unread or grey read)
- The `handleAgentCompleted` listener (PTY process exit) already force-transitions status away from "running" — this remains the final cleanup backstop
- State eviction for TUI threads should happen on PTY exit via `AGENT_COMPLETED`, not on each Stop hook
# Fix TUI Agent Running Status (Green Dot)

## Problem

When a Claude Code TUI process is alive, the sidebar always shows it as green (running). The green dot should only appear when the agent is **actively processing** — not when it's sitting idle waiting for user input.

**Current behavior:**

1. `session-start` hook → `INIT` action → `status: "running"` (immediately green)
2. Agent stays green through all activity AND idle periods
3. `stop` hook → `COMPLETE` action → `status: "complete"` (only goes away when process exits)

**Expected behavior:**

1. Process starts → idle (not green)
2. User submits prompt → running (green)
3. Agent finishes turn → idle (not green)
4. Process exits → completed

## Design

### Core Challenge: Detecting Turn Completion

Claude Code's hook system provides: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`. There is **no explicit "turn complete" hook**. After the agent finishes streaming its response and returns to the input prompt, no hook fires until the next user action.

### Approach: Debounced Idle Detection via PostToolUse + Transcript Sync

**Signals we can use:**

| Event | Meaning |
| --- | --- |
| `user-prompt-submit` | Turn starts → set **running** |
| `pre-tool-use` | Agent still working → cancel idle timer |
| `post-tool-use` | Tool finished → start idle timer |
| `stop` | Session ends → set **completed** |

**For tool-using turns:** After the last `post-tool-use`, no subsequent `pre-tool-use` arrives. A debounce timer (e.g., 3 seconds) fires and sets status to "idle".

**For text-only turns (no tool calls):** The agent streams text and finishes without any tool hooks firing. This is the hardest case. Options:

1. **Accept the limitation** — status stays "running" until next prompt or stop (v1)
2. **Transcript file watching** — watch the transcript file for write inactivity after `user-prompt-submit` (v2 enhancement)
3. **Transcript polling** — periodically check transcript for `stop_reason: "end_turn"` after `user-prompt-submit` (v2 enhancement)

**Recommendation:** Start with debounce-based detection (v1). This covers the common case (tool-using agents) and the init case (not green before first prompt). Text-only response idle detection can be added as a follow-up.

### State Changes

#### 1. New ThreadAction: `SET_IDLE`

Add to `core/lib/thread-reducer.ts`:

```typescript
| { type: "SET_IDLE" }
```

Handler: `return { ...state, status: "idle" }`

This is distinct from `COMPLETE` (process still alive, ready for input).

#### 2. ThreadState initial status → "idle"

In `thread-reducer.ts` `applyInit()`: change `status: "running"` → `status: "idle"`.

In `thread-state-writer.ts` auto-init: change `status: "running"` → `status: "idle"`.

#### 3. New ThreadAction: `SET_RUNNING`

Add to `core/lib/thread-reducer.ts`:

```typescript
| { type: "SET_RUNNING" }
```

Handler: `return { ...state, status: "running" }`

#### 4. Sidecar Hook Handler Changes

`hook-handler.ts`**:**

- `session-start`: No change needed (INIT already creates state, now with "idle" status)
- `user-prompt-submit`: Add `SET_RUNNING` dispatch
- `post-tool-use`: Start debounce timer per thread; on fire → dispatch `SET_IDLE`
- `pre-tool-use`: Cancel debounce timer for thread
- `stop`: No change needed (COMPLETE already handles this)

Add a `Map<string, NodeJS.Timeout>` for per-thread idle timers in the hook router closure.

#### 5. Frontend Status Mapping

`src/utils/thread-colors.ts` `getThreadStatusVariant()` — no changes needed. `thread.status === "running"` already gates the green dot. When status is "idle", it falls through to "unread" or "read" — correct behavior.

BUT: we need to verify that the ThreadState status ("idle" / "running") propagates correctly to `ThreadMetadata.status` which the sidebar reads. These are two different stores — ThreadState (reducer-based, from sidecar) vs ThreadMetadata (disk-based, from agents). For TUI threads, the sidebar reads from whichever is the source of truth.

**Key question to verify during implementation:** Does the sidecar's ThreadState status broadcast correctly update what `getThreadStatusVariant()` reads? If the sidebar reads `ThreadMetadata` from `metadata.json` on disk (written by the agent runner), the sidecar's in-memory state changes won't affect the sidebar. We may need to also update `metadata.json` status from the sidecar, or ensure the frontend reads from the right source.

### Files to Modify

| File | Change |
| --- | --- |
| `core/lib/thread-reducer.ts` | Add `SET_IDLE` and `SET_RUNNING` actions; change `applyInit` default status to "idle" |
| `core/types/events.ts` | Add "idle" to `AgentThreadStatusSchema` if needed |
| `sidecar/src/hooks/hook-handler.ts` | Dispatch `SET_RUNNING` on user-prompt-submit; add debounce timer logic for idle detection |
| `sidecar/src/hooks/thread-state-writer.ts` | Change auto-init status from "running" to "idle" |
| `agents/src/runners/shared.ts` | Potentially no change (agent-spawned threads have different lifecycle) |

### Edge Cases

1. **Rapid tool calls** — Timer cancellation in `pre-tool-use` prevents premature idle
2. **Multiple concurrent threads** — Per-thread timer map handles this
3. **Agent-spawned threads** (not TUI) — These use `SimpleRunnerStrategy` and set status via `metadata.json`. Their lifecycle is spawn→run→complete, so "always running while alive" is correct for them. No changes needed.
4. **Text-only responses** — v1 limitation: stays green until next prompt or stop. Acceptable since most agent turns use tools.
5. **Long-running tools** — Status stays "running" during tool execution (correct). Timer only starts after `post-tool-use`.

## Phases

- [ ] Add `SET_IDLE` and `SET_RUNNING` actions to thread reducer + change init default to "idle"

- [ ] Update sidecar hook handler: dispatch SET_RUNNING on user-prompt-submit, add debounce idle timer logic

- [ ] Verify frontend status propagation: ensure ThreadState status changes from sidecar reach the sidebar correctly

- [ ] Test: manual verification with TUI agent — green only during active processing

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---
# Fix Orphaned Child Threads from Denied Sub-Agent Spawns

## Problem

Sub-agents spawned in plan mode are immediately denied, leaving orphaned child threads. The user sees:

1. The main thread shows the Agent tool call as an error
2. A child thread is created but has 0 tool calls (status: "running" forever)
3. 185 orphaned child threads accumulated in `~/.mort/archive/threads/`

**Specific instance:** Thread `d4827785` → child `dd0c7c06`: Agent tool denied, child has `status: "running"`, 1 message, 0 tool calls.

## Root Cause

**Two bugs working together:**

### Bug 1: Plan mode doesn't allow the `Agent` tool

**File:** `core/types/permissions.ts:101`

```typescript
// Plan mode rules:
{ toolPattern: "^Task$", decision: "allow" },  // ← only allows "Task"
```

The SDK renamed the tool from `Task` to `Agent` (≥0.2.64), but the permission rule was never updated. The `Agent` tool falls through to `defaultDecision: "deny"`. This is why **every** sub-agent spawn in plan mode gets denied.

### Bug 2: PreToolUse hook creates child thread before permission check

**File:** `agents/src/runners/shared.ts` lines 753-903

The `PreToolUse:SubAgent` hook eagerly creates the child thread on disk (directory, metadata.json, state.json, emits THREAD_CREATED event), then returns `{ continue: true }`. The permission evaluator hook runs separately and denies the tool. But:

- The child thread already exists on disk
- `PostToolUseFailure` has cleanup logic (lines 1294-1324) but it doesn't reliably fire for permission-level denials, or the in-memory `toolUseIdToChildThreadId` map is lost on process restart
- No fallback cleanup exists

### Missing test coverage

The existing tests (`sub-agent.integration.test.ts`) verify child thread **creation** and **metadata fields**, but do NOT verify:

- Sub-agent tool calls appear in child thread state (not parent)
- Denied Agent tools clean up orphaned child threads
- Plan mode correctly allows sub-agent spawning

## Phases

- [ ] Phase 1: Fix plan mode permission rule for Agent tool

- [ ] Phase 2: Defer child thread creation to first sub-agent message

- [ ] Phase 3: Add cleanup for denied/failed Agent tool calls

- [ ] Phase 4: Add integration tests

- [ ] Phase 5: Clean up existing orphaned threads

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix plan mode permission rule for Agent tool

**File:** `core/types/permissions.ts`

Update plan mode rules to allow both the old and new tool names:

```typescript
{ toolPattern: "^(Task|Agent)$", decision: "allow" },
```

This is the **critical fix** — without it, plan mode will continue to deny every sub-agent spawn.

## Phase 2: Defer child thread creation to first sub-agent message

**Goal:** Don't create the child thread on disk until we know the sub-agent is actually running. This prevents orphaned threads from denied tools.

### Changes to `agents/src/runners/shared.ts`

Replace eager thread creation with a two-phase "pending → materialized" pattern:

**PreToolUse:SubAgent** — Store pending thread info in-memory only (no disk writes):

```typescript
const pendingChildThreads = new Map<string, PendingChildThread>();

interface PendingChildThread {
  childThreadId: string;
  metadata: Record<string, unknown>;
  initialState: Record<string, unknown>;
  childThreadPath: string;
}
```

- Populate `toolUseIdToChildThreadId` mapping (same as before)
- Store metadata/state in `pendingChildThreads` map
- Do NOT create directory, metadata.json, state.json, or emit THREAD_CREATED event yet
- Still run fire-and-forget name generation (store result in pending map)

### Changes to `agents/src/runners/message-handler.ts`

`handleForChildThread()` — Materialize the pending thread on first message:

```typescript
if (!existsSync(join(this.mortDir!, "threads", childThreadId, "state.json"))) {
  materializePendingThread(childThreadId);
}
```

Export a `materializePendingThread(childThreadId)` function from `shared.ts` that:

1. Reads from `pendingChildThreads` map
2. Creates directory, metadata.json, state.json on disk
3. Emits THREAD_CREATED event
4. Removes from pending map

**PostToolUse:SubAgent** — Also materializes if still pending (for the final response append).

The `TaskToolBlock` already handles missing child threads gracefully — it shows a generic "Running sub-agent" block when no child thread exists, so the brief delay before materialization is invisible.

## Phase 3: Add cleanup for denied/failed Agent tool calls

### Changes to `agents/src/runners/shared.ts`

**PostToolUseFailure handler** (lines 1294-1324) — Clean up pending entries:

```typescript
if (input.tool_name === "Task" || input.tool_name === "Agent") {
  const childThreadId = toolUseIdToChildThreadId.get(input.tool_use_id);
  if (childThreadId) {
    pendingChildThreads.delete(childThreadId);
    toolUseIdToChildThreadId.delete(input.tool_use_id);
    // If already materialized, mark as error (existing logic)
  }
}
```

**PostToolUse handler** — Safety check: if the tool result indicates denial/error and the thread was never materialized, clean up the pending entry.

### Startup cleanup

Add a startup step in `runAgentLoop` that scans for child threads with:

- `status: "running"` + `parentThreadId` matches current thread
- state.json has ≤ 1 message + `createdAt` older than 2 minutes

Mark these as `status: "cancelled"` — prevents permanent zombies from process crashes.

## Phase 4: Add integration tests

### New test: `agents/src/testing/__tests__/sub-agent-routing.integration.test.ts`

**Test 1: "sub-agent tool calls appear in child thread state, not parent"**

- Spawn agent with prompt to use Agent tool (Explore sub-agent)
- After completion, read both parent and child thread state.json
- Assert: child thread has &gt; 1 message and tool_use blocks
- Assert: parent thread does NOT have sub-agent tool calls (only the Agent tool_use itself)

**Test 2: "denied Agent tool does not leave orphaned child thread"**

- Spawn agent with permission rules that deny Agent tool
- After completion, verify no child thread directories exist on disk

**Test 3: "plan mode allows Agent tool"**

- Spawn agent in plan mode with prompt that triggers Agent tool
- Verify the Agent tool is allowed and child thread is created with tool calls

### Assertion helpers in `agents/src/testing/assertions.ts`

```typescript
assertAgent(output).childThreadHasToolCalls(mortDir: string)
assertAgent(output).noOrphanedChildThreads(mortDir: string)
```

## Phase 5: Clean up existing orphaned threads

Add a one-time cleanup (in thread store startup or Tauri init):

- Scan all threads with `parentThreadId` set, `status: "running"`, state.json ≤ 1 message
- Mark `status: "cancelled"` in metadata.json
- Emit THREAD_STATUS_CHANGED for UI refresh

## Key Files

| File | Change |
| --- | --- |
| `core/types/permissions.ts` | Add `Agent` to plan mode allow rule |
| `agents/src/runners/shared.ts` | Defer thread creation, pending map, cleanup |
| `agents/src/runners/message-handler.ts` | Materialize pending thread on first message |
| `agents/src/testing/__tests__/sub-agent-routing.integration.test.ts` | New tests |
| `agents/src/testing/assertions.ts` | New assertion helpers |
| `src/entities/threads/service.ts` | Startup cleanup for orphaned threads |

## Risks

- **Race condition**: Materialization must be atomic — use a flag to prevent double-creation if multiple messages arrive simultaneously
- **UI delay**: SubAgentReferenceBlock won't appear until first sub-agent message. `TaskToolBlock` already handles this (shows generic "Running sub-agent" block)
- **Background tasks**: `run_in_background` path emits task_started/task_notification system messages — ensure materialization handles these too
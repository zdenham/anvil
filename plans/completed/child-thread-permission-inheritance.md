# Child Thread Permission Mode Inheritance

## Problem

Child threads spawned via the Task tool always start in Plan mode regardless of the parent's current permission mode. Additionally, when a user changes the parent's permission mode mid-run, running child threads are not updated — they remain in whatever mode they started with.

This creates two concrete problems:

1. **Spawn mismatch:** User is in Implement mode, agent spawns a child to write code, child starts in Plan mode and gets permission denials on writes outside `plans/`.
2. **Mode drift:** User switches parent from Plan to Implement, but the 3 already-running children stay in Plan mode. User must manually navigate to each child thread and switch individually.

## Architecture Context

### How child threads are created today

In `agents/src/runners/shared.ts` (PreToolUse:Task hook, ~line 512), the parent agent creates child metadata:

```typescript
const childMetadata = {
  id: childThreadId,
  repoId: context.repoId,
  worktreeId: context.worktreeId,
  status: "running",
  // ❌ no permissionMode field — defaults to "plan"
  agentType: agentType,
};
```

The child agent process reads `permissionMode` from `metadata.json` at startup (`simple-runner-strategy.ts:436-445`). Since it's missing, `runner.ts` defaults to `"plan"`.

### How mode changes work today

When a user presses `Shift+Tab`:

```
Frontend (thread-content.tsx)
  → sendToAgent(threadId, { type: "event", name: PERMISSION_MODE_CHANGED, ... })
  → Only the targeted thread's agent process receives it
  → permissionEvaluator.setMode(newMode) — only that agent's evaluator
```

Child threads have their own agent processes with their own `permissionEvaluator` instances. No mechanism forwards the change.

### Hub socket communication

The Tauri backend (`src-tauri/src/agent_hub.rs`) manages agent connections:

- **`agents: HashMap<String, AgentWriter>`** — maps `threadId` → channel for sending messages to connected agents
- **`hierarchy: HashMap<String, Option<String>>`** — maps `threadId` → `parentId` (populated on registration)

The hub supports `send_to_agent(threadId, msg)` to deliver a message to a specific connected agent. Currently only the frontend uses this (via Tauri command). For Part 2, we add a `relay` message type so agents can send messages to other agents through the hub.

## Design

### Part 1: Mode inheritance on spawn

When the Task hook creates a child thread, write the parent's **current live mode** into the child metadata.

The `permissionEvaluator` is already in scope inside the Task hook closure in `shared.ts`, and already has a `getModeId()` getter:

```typescript
const childMetadata = {
  id: childThreadId,
  // ...existing fields...
  permissionMode: permissionEvaluator.getModeId(),
};
```

This ensures the child inherits the parent's mode as it is *right now*, not the mode at agent startup (which may have changed via mid-run switching).

### Part 2: Mode propagation to running children

When the user changes a parent thread's mode, propagate the change to all running children.

**Approach: Agent-level propagation via hub socket** (preferred over Rust backend)

The propagation happens inside the parent's Node agent process, not the Rust backend. When the parent agent receives a `permission_mode_changed` message via the hub socket, it:

1. Discovers child threads from disk (reads `~/.anvil/threads/` and filters by `parentThreadId === context.threadId`)
2. Sends a `permission_mode_changed` message to each child via the hub socket using `hubClient.send()`
3. Updates each child's `metadata.json` on disk so the mode persists across restarts

This keeps the logic in Node where we have easy filesystem access and avoids adding Rust-side child lookup code. The hub socket already supports sending messages to any connected agent by thread ID — the parent just needs to address messages to its children.

**Implementation in `runner.ts`:** Extend the existing `permission_mode_changed` handler (~line 191) to also propagate:

```typescript
case "permission_mode_changed": {
  const newModeId = msg.payload.modeId as PermissionModeId;
  const newMode = BUILTIN_MODES[newModeId];
  if (newMode && permissionEvaluator) {
    permissionEvaluator.setMode(newMode);
    logger.info(`[runner] Permission mode changed to: ${newMode.name}`);

    // Propagate to child threads
    await propagateModeToChildren(context.threadId, newModeId, hubClient);

    // Notify agent via streamInput
    messageStream.push(/* ...existing system message... */);
  }
  break;
}
```

**Child discovery helper:** A new function that scans thread metadata on disk:

```typescript
async function propagateModeToChildren(
  parentThreadId: string,
  modeId: PermissionModeId,
  hubClient: HubClient,
): Promise<void> {
  const threadsDir = path.join(ANVIL_DIR, "threads");
  const entries = await fs.readdir(threadsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metadataPath = path.join(threadsDir, entry.name, "metadata.json");
    try {
      const raw = await fs.readFile(metadataPath, "utf-8");
      const metadata = JSON.parse(raw);
      if (metadata.parentThreadId !== parentThreadId) continue;
      if (metadata.status !== "running") continue;

      // Send mode change via hub socket — hub routes by threadId
      hubClient.sendEvent(metadata.id, "permission_mode_changed", { modeId });

      // Persist to disk so mode survives restarts
      metadata.permissionMode = modeId;
      metadata.updatedAt = Date.now();
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // Child thread may have been cleaned up — skip
    }
  }
}
```

**Hub routing:** The `hubClient.send()` currently sends messages attributed to the parent's threadId. We need to verify the hub can route a message *to* a specific child agent. Looking at the hub, `send_to_agent(threadId, msg)` is a Tauri command — so the agent process would need to invoke it via a Tauri command or the hub needs to support forwarding.

**Alternative routing:** Instead of the agent sending directly to children, the agent can use the in-memory `toolUseIdToChildThreadId` map (already populated during Task hook in `shared.ts`) to discover running child thread IDs without disk reads for active children. For the hub message routing, the simplest path is to add a `send_to_agent` message type that the hub recognizes — the parent sends `{ type: "send_to_agent", targetThreadId, payload }` over its socket, and the hub forwards `payload` to the target agent's socket.

**Hub relay message type** (minimal Rust change):

```rust
// In agent_hub.rs message handler, add:
"relay" => {
    if let Some(target_id) = msg.get("targetThreadId").and_then(|v| v.as_str()) {
        if let Some(payload) = msg.get("payload") {
            let _ = self.send_to_agent(target_id, &payload.to_string());
        }
    }
}
```

This is a small, generic addition — any agent can relay a message to any other connected agent through the hub. The parent agent uses it to forward the mode change to each child.

**Children already handle the message:** The existing `permission_mode_changed` case in `runner.ts:191-206` processes the mode change, updates the evaluator, and injects a system message. No child-side changes needed.

### What about deeply nested children?

If a child thread spawns its own children (grandchildren), propagation is naturally recursive: when a child receives a `permission_mode_changed` message, its own handler in `runner.ts` will propagate to *its* children using the same mechanism. Each agent only needs to propagate one level down — the recursion happens through the message chain.

### Metadata persistence

The `propagateModeToChildren` function handles persistence directly — it writes the updated `permissionMode` to each child's `metadata.json` on disk. No frontend involvement needed for persistence.

## Phases

- [x] Verify `getModeId()` on `PermissionEvaluator` returns live mode (already exists)
- [x] Write parent's live permission mode into child metadata at spawn
- [x] Add `relay` message type to hub socket (Rust — small addition to message handler)
- [x] Add `propagateModeToChildren()` helper in agent runner
- [x] Extend `permission_mode_changed` handler in `runner.ts` to call propagation
- [x] Add tests for inheritance and propagation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Modify

### Part 1: Inheritance on spawn

| File | Change |
|------|--------|
| `agents/src/runners/shared.ts` | Set `permissionMode: permissionEvaluator.getModeId()` in child metadata (~line 512) |

### Part 2: Propagation to children

| File | Change |
|------|--------|
| `src-tauri/src/agent_hub.rs` | Add `relay` message type handler (~5 lines) to forward messages between agents |
| `agents/src/lib/hub/client.ts` | Add `relay(targetThreadId, payload)` method to `HubClient` |
| `agents/src/runner.ts` | Extend `permission_mode_changed` handler to call `propagateModeToChildren()` |
| `agents/src/runners/shared.ts` | Add `propagateModeToChildren()` helper (disk scan + relay + persist) |

### Tests

| File | Change |
|------|--------|
| `agents/src/lib/__tests__/permission-evaluator.test.ts` | Test `getModeId()` returns live mode after `setMode()` |
| Agent harness or manual test | Verify child starts with inherited mode; verify propagation updates running child |

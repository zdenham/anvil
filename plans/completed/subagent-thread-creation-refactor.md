# Refactor: Move Sub-Agent Thread Creation to PreToolUse:Task

## Problem

The current implementation creates child threads in the `SubagentStart` hook, which causes **false positives** with "warmup" agents. The Claude Code SDK pre-spawns Explore and Plan agents to reduce latency, but these warmup agents:

1. Trigger `SubagentStart` without a corresponding `PreToolUse:Task`
2. Have no entry in `pendingTaskQueue` → get fallback prompt "Sub-agent: {type}"
3. Create orphan child threads with no parent Task tool to display them
4. Never have a `toolUseId` mapping → frontend can't render them properly

## Solution

Move thread creation to `PreToolUse:Task`, which:
- Only fires for **real** Task tool calls (not warmups)
- Has all required data upfront (toolUseId, prompt, agentType)
- Eliminates the need for queue coordination

## Key Discovery: SDK Uses Full tool_use_id for Message Routing

From testing the actual SDK behavior, we discovered that `parent_tool_use_id` on sub-agent messages uses the **full tool_use_id format** (e.g., `toolu_01FfbKLsAKehhQYR2ebXsWFv`), NOT the short hex `agent_id` (e.g., `a08ba50`).

Evidence from test output:
```json
// SubagentStart provides agent_id
{ "agent_id": "a08ba50", "agent_type": "general-purpose" }

// But messages use full tool_use_id as parent_tool_use_id
{ "type": "user", "parent_tool_use_id": "toolu_01FfbKLsAKehhQYR2ebXsWFv", ... }
{ "type": "assistant", "parent_tool_use_id": "toolu_01FfbKLsAKehhQYR2ebXsWFv", ... }
```

**This means we can eliminate ALL agent hooks** (`SubagentStart` and `SubagentStop`) because:
- `PreToolUse:Task` gives us the `tool_use_id` we need for message routing
- We don't need `agent_id` at all - messages route by `tool_use_id`

## Phases

- [ ] Move thread creation from SubagentStart to PreToolUse:Task
- [ ] Remove SubagentStart hook entirely (not needed for message routing)
- [ ] Remove SubagentStop hook entirely (consolidate into PostToolUse:Task)
- [ ] Remove all agent-related maps (agentIdToChildThreadId, agentIdToToolUseId, pendingTaskQueue)
- [ ] Update PostToolUse:Task to handle completion + add response
- [ ] Test that warmup agents no longer create orphan threads

---

## Current Flow (Problem)

```
PreToolUse:Task → queue {toolUseId, prompt, agentType}
SubagentStart   → pop queue, create thread, map agentId
                  ❌ Warmup agents have no queue entry → orphan threads
SubagentStop    → update status
PostToolUse:Task → fix metadata (prompt, toolUseId)
```

## Proposed Flow (Solution)

```
PreToolUse:Task  → create thread, map toolUseId → childThreadId, emit THREAD_CREATED
                   ✅ Warmups never trigger PreToolUse:Task → no orphan threads
MessageHandler   → route by parent_tool_use_id (full tool_use_id format)
                   Uses toolUseIdToChildThreadId.get(parentToolUseId)
PostToolUse:Task → update status to completed, add response, emit THREAD_STATUS_CHANGED, cleanup
```

**Hooks removed entirely:**
- `SubagentStart` - not needed, we have tool_use_id from PreToolUse
- `SubagentStop` - consolidated into PostToolUse:Task

---

## Implementation Details

### Step 1: PreToolUse:Task - Create Thread Here

**File:** `agents/src/runners/shared.ts`

Move all thread creation logic to `PreToolUse:Task`:

```typescript
PreToolUse: [
  {
    matcher: "Task",
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as PreToolUseHookInput;
        const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };

        // Skip if missing required context
        if (!context.repoId || !context.worktreeId) {
          return { continue: true };
        }

        const childThreadId = crypto.randomUUID();
        const toolUseId = input.tool_use_id;
        const agentType = taskInput.subagent_type ?? "general-purpose";
        const taskPrompt = taskInput.prompt ?? `Sub-agent: ${agentType}`;

        // Create child thread directory and metadata
        const childThreadPath = join(config.mortDir, "threads", childThreadId);
        const now = Date.now();

        const childMetadata = {
          id: childThreadId,
          repoId: context.repoId,
          worktreeId: context.worktreeId,
          status: "running",
          turns: [{
            index: 0,
            prompt: taskPrompt,
            startedAt: now,
            completedAt: null,
          }],
          isRead: true,
          name: `${agentType}: <pending>`,
          createdAt: now,
          updatedAt: now,
          parentThreadId: context.threadId,
          parentToolUseId: toolUseId,  // Full toolu_01ABC... format
          agentType: agentType,
        };

        mkdirSync(childThreadPath, { recursive: true });
        writeFileSync(
          join(childThreadPath, "metadata.json"),
          JSON.stringify(childMetadata, null, 2)
        );

        // Map toolUseId → childThreadId
        // This is the ONLY map we need - messages use full tool_use_id as parent_tool_use_id
        toolUseIdToChildThreadId.set(toolUseId, childThreadId);

        // Emit THREAD_CREATED event
        emitEvent(EventName.THREAD_CREATED, {
          threadId: childThreadId,
          repoId: context.repoId,
          worktreeId: context.worktreeId,
        });

        // Fire-and-forget: generate thread name
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (apiKey) {
          generateThreadName(taskPrompt, apiKey)
            .then((generatedName) => {
              const metadataPath = join(childThreadPath, "metadata.json");
              if (existsSync(metadataPath)) {
                const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                metadata.name = generatedName;
                metadata.updatedAt = Date.now();
                writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                emitEvent(EventName.THREAD_NAME_GENERATED, {
                  threadId: childThreadId,
                  name: generatedName,
                });
              }
            })
            .catch((err) => {
              logger.warn(`[PreToolUse:Task] Failed to generate name: ${err}`);
            });
        }

        logger.info(`[PreToolUse:Task] Created child thread: ${childThreadId} for toolUseId: ${toolUseId}`);
        return { continue: true };
      },
    ],
  },
],
```

### Step 2: Remove SubagentStart Hook Entirely

**Delete the entire `SubagentStart` hook.** It's no longer needed because:

1. We create threads in `PreToolUse:Task`
2. SDK messages use the full `tool_use_id` as `parent_tool_use_id`, not the short hex `agent_id`
3. `toolUseIdToChildThreadId` is sufficient for message routing

**Remove from imports:**
```typescript
// Remove SubagentStartHookInput from imports
import {
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  // type SubagentStartHookInput,  ← DELETE
  // type SubagentStopHookInput,   ← DELETE
} from "@anthropic-ai/claude-agent-sdk";
```

**Delete the entire SubagentStart hook registration.**

### Step 3: Remove SubagentStop Hook Entirely

**Delete the entire `SubagentStop` hook.** Its responsibilities are consolidated into `PostToolUse:Task`.

**Rationale:**
- `PostToolUse:Task` fires after the sub-agent completes
- It has access to the `tool_use_id` which is all we need for lookup
- Using tool use hooks for the entire lifecycle is cleaner and more consistent

### Step 4: Remove All Agent-Related State

Delete all the agent-specific maps and queues:

```typescript
// DELETE all of these:
const agentIdToChildThreadId = new Map<string, string>();
const agentIdToToolUseId = new Map<string, string>();
const pendingTaskQueue: Array<{
  toolUseId: string;
  prompt: string;
  agentType: string;
}> = [];

// KEEP only this one:
const toolUseIdToChildThreadId = new Map<string, string>();
```

### Step 5: Update MessageHandler.getChildThreadId()

Simplify the lookup - we only need one map:

```typescript
/**
 * Get the child thread ID for a given parent_tool_use_id from SDK messages.
 * Messages use the full tool_use_id format (e.g., "toolu_01ABC...").
 */
export function getChildThreadId(parentToolUseId: string): string | undefined {
  return toolUseIdToChildThreadId.get(parentToolUseId);
}
```

### Step 6: PostToolUse:Task - Handle Completion + Add Response to State

Update `PostToolUse:Task` to use `tool_use_id` for lookup (not `agentId`):

```typescript
if (input.tool_name === "Task") {
  try {
    const toolUseId = input.tool_use_id;
    const childThreadId = toolUseIdToChildThreadId.get(toolUseId);

    if (!childThreadId) {
      logger.warn(`[PostToolUse:Task] No child thread for toolUseId: ${toolUseId}`);
      return;
    }

    const taskResponse = typeof input.tool_response === "string"
      ? JSON.parse(input.tool_response)
      : input.tool_response;

    const childThreadPath = join(config.mortDir, "threads", childThreadId);
    const metadataPath = join(childThreadPath, "metadata.json");
    const statePath = join(childThreadPath, "state.json");

    // === Update metadata.json ===
    if (existsSync(metadataPath)) {
      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));

      metadata.status = "completed";

      if (metadata.turns?.length > 0) {
        const lastTurn = metadata.turns[metadata.turns.length - 1];
        lastTurn.completedAt = Date.now();

        const textContent = taskResponse.content?.find(
          (c: { type: string }) => c.type === "text"
        );
        lastTurn.response = textContent?.text ?? JSON.stringify(taskResponse.content);
      }

      metadata.updatedAt = Date.now();
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      logger.info(`[PostToolUse:Task] Updated metadata for thread ${childThreadId}`);
    }

    // === Append final response to state.json ===
    if (taskResponse.content && Array.isArray(taskResponse.content)) {
      let state: ThreadState;

      if (existsSync(statePath)) {
        state = JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
      } else {
        state = {
          messages: [],
          fileChanges: [],
          workingDirectory: context.workingDir,
          status: "running",
          timestamp: Date.now(),
          toolStates: {},
        };
      }

      state.messages.push({
        role: "assistant",
        content: taskResponse.content,
      });

      state.status = "complete";
      state.timestamp = Date.now();

      writeFileSync(statePath, JSON.stringify(state, null, 2));
      logger.info(`[PostToolUse:Task] Appended final response to state.json`);
    }

    // Emit THREAD_STATUS_CHANGED
    emitEvent(EventName.THREAD_STATUS_CHANGED, {
      threadId: childThreadId,
      status: "completed",
    });

    // Cleanup - just the one map
    toolUseIdToChildThreadId.delete(toolUseId);

  } catch (err) {
    logger.warn(`[PostToolUse:Task] Failed to update child thread: ${err}`);
  }
}
```

**Why append to state.json?**

The child thread's `state.json` contains the `messages` array which is the full conversation history displayed in the UI. Without this step:
- Messages streamed during execution are captured by `MessageHandler.handleForChildThread()`
- But the **final response** (which is returned as the Task tool result to the parent) would be missing from the child thread's conversation view
- This is because the SDK returns the final response as the tool result, not as a separate assistant message event

By appending to `state.json`, users can click into a completed sub-agent thread and see the complete conversation including the final response that was returned to the parent.

---

## Summary of Changes

| Component | Before | After |
|-----------|--------|-------|
| `pendingTaskQueue` | `{toolUseId, prompt, agentType}[]` | **REMOVED** |
| `agentIdToChildThreadId` | `Map<string, string>` | **REMOVED** |
| `agentIdToToolUseId` | `Map<string, string>` | **REMOVED** |
| `toolUseIdToChildThreadId` | `Map<string, string>` | **KEEP (only map needed)** |
| `PreToolUse:Task` | Queue info | **Create thread, map toolUseId, emit THREAD_CREATED** |
| `SubagentStart` | Create thread, map IDs | **REMOVED** |
| `SubagentStop` | Update status, emit event | **REMOVED** |
| `PostToolUse:Task` | Fix metadata | **Mark completed, add response, emit event, cleanup** |

## Benefits

1. **No orphan threads** - Warmup agents never trigger `PreToolUse:Task`
2. **Immediate thread visibility** - UI shows "running" state right away
3. **All data available upfront** - No queue mismatch issues
4. **Much simpler architecture** - Only ONE map needed, no agent hooks at all
5. **Correct toolUseId from start** - No need to fix up in PostToolUse
6. **Consistent hook model** - Entire sub-agent lifecycle managed via tool use hooks only
7. **Complete conversation history** - Final response appended to child thread's `state.json`

## What Gets Deleted

```typescript
// DELETE - no longer needed
const agentIdToChildThreadId = new Map<string, string>();
const agentIdToToolUseId = new Map<string, string>();
const pendingTaskQueue: Array<{ toolUseId: string; prompt: string; agentType: string; }> = [];

// DELETE - entire SubagentStart hook handler
SubagentStart: [{ hooks: [...] }]

// DELETE - entire SubagentStop hook handler
SubagentStop: [{ hooks: [...] }]

// DELETE - from imports
type SubagentStartHookInput
type SubagentStopHookInput
```

## Testing

Run the integration test to verify:
```bash
cd agents && pnpm test src/testing/__tests__/sub-agent.integration.test.ts \
  --testNamePattern="general purpose sub-agent spawns multiple child threads"
```

Expected results:
- Only 1 child thread created (general-purpose)
- No Explore/Plan warmup threads
- Child thread has correct prompt and toolUseId from the start
- Message routing works via `toolUseIdToChildThreadId`

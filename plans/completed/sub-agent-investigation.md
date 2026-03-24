# Sub-Agent Thread Investigation Report

## Issue Summary

Four issues were reported with sub-agent thread handling:
1. **User message is populated incorrectly** - showing "Sub-agent: Explore" instead of the actual task prompt
2. **No state is being added to the .anvil-dev directory** - sub-agent state.json files not being created
3. **Tool uses are being populated to the PARENT thread, not the sub-agent thread** - Sub-agent tool calls appear in parent state instead of child state
4. **Reference blocks not being rendered in parent thread** - The SubAgentReferenceBlock should replace TaskToolBlock but isn't showing

## Critical Discovery: The Prompt IS Available!

When you expand a Task tool result in the UI, you see:
```json
{
  "status": "completed",
  "prompt": "Simply respond with \"hello\"",  // <-- THE PROMPT IS HERE!
  "agentId": "ad79f4f",
  "content": [...],
  "totalDurationMs": 2559,
  "totalTokens": 13443,
  ...
}
```

**This is the Task tool result** - the SDK returns this structured response when a sub-agent completes.

## Key Insight: `agent_id` IS `parent_tool_use_id`

The SDK uses the same short hex ID (`agent_id`) for both:
- `SubagentStartHookInput.agent_id` - e.g., `ad79f4f`
- `parent_tool_use_id` on messages within the sub-agent - same value

This is confirmed by the integration test at `sub-agent.integration.test.ts:154-157`:
```typescript
// parentToolUseId should be a hex string (SDK's agent_id format)
const hexIdPattern = /^[0-9a-f]+$/i;
expect(childThread!.parentToolUseId).toMatch(hexIdPattern);  // Passes!
```

The Task tool result also contains this ID as `agentId`:
```json
{"prompt":"Simply respond...","agentId":"ad79f4f",...}
```

**The current mapping implementation IS correct.** The issue is only with the prompt.

From the SDK docs:
> "Messages from within a subagent's context include a `parent_tool_use_id` field, letting you track which messages belong to which subagent execution."

## Investigation Findings

### Issue 1: Getting the Task Prompt

The `SubagentStartHookInput` does NOT provide the prompt:
```typescript
export type SubagentStartHookInput = BaseHookInput & {
    hook_event_name: 'SubagentStart';
    agent_id: string;      // SDK's internal agent ID
    agent_type: string;    // "Explore", "Plan", etc.
    // NO prompt field!
};
```

**Solution: Use `PreToolUse` hook on Task tool**

The `PreToolUseHookInput` provides everything we need:
```typescript
export type PreToolUseHookInput = BaseHookInput & {
    hook_event_name: 'PreToolUse';
    tool_name: string;      // "Task"
    tool_input: unknown;    // { prompt: "...", subagent_type: "..." }
    tool_use_id: string;    // The ID that sub-agent messages will reference!
};
```

### Issue 2: Message Routing Architecture

Current implementation uses `agent_id` from SubagentStart:
```typescript
// shared.ts:51-59 - PROBLEM: Maps by agent_id
const agentIdToChildThreadId = new Map<string, string>();

// SubagentStart hook stores: agent_id -> childThreadId
agentIdToChildThreadId.set(agentId, childThreadId);

// But message-handler.ts looks for parent_tool_use_id (which is tool_use_id!)
const parentToolUseId = this.getParentToolUseId(message);
const childThreadId = getChildThreadId(parentToolUseId);  // Won't find it!
```

**The mapping is using the wrong key!**

## Recommended Solution

### Phase 1: Fix Message Routing (Use `tool_use_id` instead of `agent_id`)

Replace `agentIdToChildThreadId` with `toolUseIdToChildThreadId`:

```typescript
// NEW: Map by tool_use_id (what messages use as parent_tool_use_id)
const toolUseIdToChildThreadId = new Map<string, string>();
const toolUseIdToPrompt = new Map<string, { prompt: string; agentType: string }>();
```

### Phase 2: Capture Prompt via PreToolUse Hook

Add a `PreToolUse` hook that fires BEFORE `SubagentStart`:

```typescript
PreToolUse: [{
    matcher: "Task",
    hooks: [async (input: PreToolUseHookInput) => {
        const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };

        // Store prompt and type keyed by tool_use_id
        toolUseIdToPrompt.set(input.tool_use_id, {
            prompt: taskInput.prompt ?? "Unknown task",
            agentType: taskInput.subagent_type ?? "general-purpose"
        });

        return { continue: true };
    }]
}]
```

### Phase 3: Create Thread in PreToolUse (Not SubagentStart)

Move thread creation from `SubagentStart` to `PreToolUse` on Task tool:

```typescript
PreToolUse: [{
    matcher: "Task",
    hooks: [async (input: PreToolUseHookInput) => {
        const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };
        const toolUseId = input.tool_use_id;

        // Create child thread
        const childThreadId = crypto.randomUUID();
        const now = Date.now();

        const childMetadata: ThreadMetadata = {
            id: childThreadId,
            repoId: context.repoId!,
            worktreeId: context.worktreeId!,
            parentThreadId: context.threadId,
            parentToolUseId: toolUseId,  // <-- Use tool_use_id, NOT agent_id
            agentType: taskInput.subagent_type ?? "general-purpose",
            turns: [{
                index: 0,
                prompt: taskInput.prompt ?? "Unknown task",  // <-- The actual prompt!
                startedAt: now,
                completedAt: null,
            }],
            status: "running",
            createdAt: now,
            updatedAt: now,
        };

        // Store mapping by tool_use_id (for message routing)
        toolUseIdToChildThreadId.set(toolUseId, childThreadId);

        // Write metadata to disk
        const threadDir = join(config.anvilDir, "threads", childThreadId);
        mkdirSync(threadDir, { recursive: true });
        writeFileSync(join(threadDir, "metadata.json"), JSON.stringify(childMetadata, null, 2));

        return { continue: true };
    }]
}]
```

### Phase 4: Link agent_id to tool_use_id in SubagentStart

The `SubagentStart` hook still fires and provides `agent_id`. We can use it to link the two IDs:

```typescript
SubagentStart: [{
    hooks: [async (input: SubagentStartHookInput) => {
        const agentId = input.agent_id;

        // We need to find the tool_use_id that corresponds to this agent
        // The SubagentStart hook fires AFTER PreToolUse, so the mapping should exist
        // However, we don't have a direct link...

        // OPTION: Store agent_id -> tool_use_id mapping for SubagentStop to use
        // This is tricky because we don't have the tool_use_id here

        return { continue: true };
    }]
}]
```

### Phase 5: Handle SubagentStop

The `SubagentStopHookInput` provides:
- `agent_id` - The SDK's internal ID
- `agent_transcript_path` - Path to the sub-agent's transcript

```typescript
SubagentStop: [{
    hooks: [async (input: SubagentStopHookInput) => {
        const agentId = input.agent_id;

        // We need to find the child thread by agent_id
        // Since we created the thread keyed by tool_use_id, we need another mapping

        // Read transcript to get final results if needed
        const transcript = JSON.parse(readFileSync(input.agent_transcript_path, "utf-8"));

        return { continue: true };
    }]
}]
```

## Clarification: agent_id IS parent_tool_use_id

After investigating the tests at `sub-agent.integration.test.ts:154-157`:
```typescript
// parentToolUseId should be a hex string (SDK's agent_id format)
// The SDK uses short hex IDs like "a7302c6", not full UUIDs
const hexIdPattern = /^[0-9a-f]+$/i;
expect(childThread!.parentToolUseId).toMatch(hexIdPattern);
```

The tests confirm that `agent_id` (e.g., `ad79f4f`) IS the same value used as `parent_tool_use_id` on messages within the sub-agent. The SDK uses this short hex ID for both.

**The current mapping IS correct** - `agentIdToChildThreadId` maps by `agent_id`, and messages have `parent_tool_use_id` set to the same value.

## The Real Problem: Getting the Prompt

The current implementation creates the thread in `SubagentStart` hook, which only provides:
- `agent_id` - ✅ Available (and equals `parent_tool_use_id`)
- `agent_type` - ✅ Available
- `prompt` - ❌ NOT available

**Solution: Use PreToolUse on Task tool to capture the prompt**

The SDK fires hooks in this order:
1. `PreToolUse` (Task tool) - has `tool_use_id` and `tool_input.prompt`
2. `SubagentStart` - has `agent_id` (same as `tool_use_id`)
3. Messages with `parent_tool_use_id` (= `agent_id`)
4. `SubagentStop` - has `agent_id` and final result

We can use `PreToolUse` to capture the prompt and store it temporarily, then retrieve it in `SubagentStart`.

**The key challenge**: `PreToolUse` provides `tool_use_id` (e.g., `toolu_01ABC...`), but `SubagentStart` provides `agent_id` (e.g., `ad79f4f`). These are different values! However, the SDK calls them in order, so we can use a queue approach.

## Concrete Implementation

### Approach: Use a Queue for Pending Task Prompts

```typescript
// Store pending Task tool prompts (PreToolUse fires before SubagentStart)
const pendingTaskPrompts: Array<{ toolUseId: string; prompt: string; agentType: string }> = [];

// In PreToolUse hook for Task tool:
PreToolUse: [{
    matcher: "Task",
    hooks: [async (input: PreToolUseHookInput) => {
        const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };
        pendingTaskPrompts.push({
            toolUseId: input.tool_use_id,
            prompt: taskInput.prompt ?? "Unknown task",
            agentType: taskInput.subagent_type ?? "general-purpose"
        });
        return { continue: true };
    }]
}]

// In SubagentStart hook:
SubagentStart: [{
    hooks: [async (input: SubagentStartHookInput) => {
        // Pop the oldest pending prompt (FIFO order matches SDK event order)
        const pending = pendingTaskPrompts.shift();

        if (pending) {
            // Create child thread with the actual prompt
            const childMetadata = {
                // ... other fields ...
                turns: [{
                    index: 0,
                    prompt: pending.prompt,  // <-- The actual task prompt!
                    startedAt: now,
                    completedAt: null,
                }],
            };
        }
        // ... rest of implementation
    }]
}]
```

This works because:
1. `PreToolUse` fires BEFORE the SDK executes the Task tool
2. Task tool execution spawns the sub-agent
3. `SubagentStart` fires when sub-agent starts
4. Order is guaranteed: PreToolUse → SubagentStart for each Task call

### Alternative: Use PostToolUse to Update After Completion

If the queue approach is fragile (e.g., parallel Task calls), we can update the prompt after the Task completes:

```typescript
PostToolUse: [{
    matcher: "Task",
    hooks: [async (input: PostToolUseHookInput) => {
        const toolResult = input.tool_response as {
            prompt?: string;
            agentId?: string;
            status?: string;
        };

        if (toolResult?.agentId) {
            const childThreadId = agentIdToChildThreadId.get(toolResult.agentId);
            if (childThreadId && toolResult.prompt) {
                // Update the thread metadata with the actual prompt
                const metadataPath = join(anvilDir, "threads", childThreadId, "metadata.json");
                const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                metadata.turns[0].prompt = toolResult.prompt;
                metadata.updatedAt = Date.now();
                writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

                // Re-generate thread name with actual prompt
                generateThreadName(toolResult.prompt, apiKey)
                    .then(name => { /* update metadata.name */ });
            }
        }
        return { continue: true };
    }]
}]
```

This approach is safer because:
1. `PostToolUse` provides `tool_response` which contains `prompt` and `agentId`
2. We can directly link `agentId` to our mapping
3. No need to manage a queue of pending prompts

### Recommended: Combine Both Approaches

1. **PreToolUse**: Capture prompt for immediate use (thread creation)
2. **PostToolUse**: Validate/update if needed using the tool response

This provides redundancy and handles edge cases.

## Relevant Code Locations

| File | Line | Purpose |
|------|------|---------|
| `agents/src/runners/shared.ts` | 503-603 | SubagentStart hook implementation |
| `agents/src/runners/shared.ts` | 604-647 | SubagentStop hook implementation |
| `agents/src/runners/message-handler.ts` | 265-275 | getParentToolUseId extraction |
| `agents/src/runners/message-handler.ts` | 326-395 | handleForChildThread state routing |
| `agents/src/runners/shared.ts` | 51-59 | agentIdToChildThreadId mapping (NEEDS CHANGE) |

## SDK Types Reference

```typescript
// PreToolUseHookInput - Has everything we need!
export type PreToolUseHookInput = BaseHookInput & {
    hook_event_name: 'PreToolUse';
    tool_name: string;      // "Task"
    tool_input: unknown;    // { prompt: "...", subagent_type: "..." }
    tool_use_id: string;    // Key for message routing
};

// SubagentStartHookInput - Missing prompt and tool_use_id
export type SubagentStartHookInput = BaseHookInput & {
    hook_event_name: 'SubagentStart';
    agent_id: string;       // SDK's internal ID
    agent_type: string;     // "Explore", "Plan", etc.
};

// SubagentStopHookInput - Has transcript path
export type SubagentStopHookInput = BaseHookInput & {
    hook_event_name: 'SubagentStop';
    stop_hook_active: boolean;
    agent_id: string;
    agent_transcript_path: string;  // Can read for final state
};

// SDK Messages - Use parent_tool_use_id (= tool_use_id)
export type SDKUserMessage = {
    parent_tool_use_id: string | null;
    tool_use_result?: unknown;  // Task result has { prompt, agentId, ... }
    // ...
};
```

## Issue 3: Tool Uses Populated to Parent Instead of Sub-Agent Thread

### Symptom
When a sub-agent uses tools (Read, Grep, etc.), those tool uses appear in the **parent** thread's state.json instead of the child thread's state.json.

### Root Cause Analysis

The message routing in `message-handler.ts:50-59` works correctly **IF** the mapping exists:

```typescript
async handle(message: SDKMessage): Promise<boolean> {
  const parentToolUseId = this.getParentToolUseId(message);
  if (parentToolUseId && this.anvilDir) {
    const childThreadId = getChildThreadId(parentToolUseId);
    if (childThreadId) {
      return this.handleForChildThread(childThreadId, message);  // ✅ Routes to child
    }
  }
  // Falls through to parent thread handling if no mapping found
  return this.handleAssistant(message);  // ❌ BUG: Goes to parent
}
```

**The Issue: ID Mismatch Between `tool_use_id` and `agent_id`**

Based on the test at `sub-agent.integration.test.ts:154-157`, the SDK provides:
- `agent_id` in SubagentStart: short hex ID like `ad79f4f`
- `parent_tool_use_id` on messages: **also** the short hex ID `ad79f4f`

However, the Task tool's `tool_use_id` is different - it's a full Anthropic ID like `toolu_01ABC123...`.

The current implementation stores the mapping correctly:
```typescript
// shared.ts:557
agentIdToChildThreadId.set(agentId, childThreadId);  // Maps: ad79f4f -> child-uuid
```

And messages have `parent_tool_use_id: "ad79f4f"` which should match.

**Potential Race Condition:**
If SDK messages arrive BEFORE the `SubagentStart` hook completes and sets the mapping, `getChildThreadId()` returns `undefined` and messages go to the parent.

**Verification Needed:**
Add logging to confirm whether:
1. The mapping is populated before messages arrive
2. The `parent_tool_use_id` on messages matches the `agent_id` from SubagentStart

### Investigation Questions

1. Is there a timing issue where messages arrive before SubagentStart hook fires?
2. Are tool uses within the sub-agent arriving with the correct `parent_tool_use_id`?
3. Is the `handleForChildThread` function being called at all?

### Recommended Fix

Add defensive logging and potentially a delay/queue:

```typescript
// In MessageHandler.handle()
const parentToolUseId = this.getParentToolUseId(message);
if (parentToolUseId) {
  logger.info(`[MessageHandler] Message has parent_tool_use_id: ${parentToolUseId}`);
  const childThreadId = getChildThreadId(parentToolUseId);
  logger.info(`[MessageHandler] Found childThreadId: ${childThreadId ?? 'NONE'}`);

  if (!childThreadId) {
    logger.warn(`[MessageHandler] No mapping found for ${parentToolUseId} - message will go to parent!`);
  }
}
```

---

## Issue 4: Reference Blocks Not Rendering in Parent Thread

### Symptom
When viewing a parent thread that spawned a sub-agent, the Task tool block should be replaced by a `SubAgentReferenceBlock` showing a compact reference to the child thread. Instead, the full `TaskToolBlock` is shown.

### How It's Supposed to Work

The frontend rendering flow in `task-tool-block.tsx:111-130`:

```typescript
export function TaskToolBlock({ id, ... }: ToolBlockProps) {
  // Check if this Task created a sub-agent thread
  const childThread = useThreadStore((state) =>
    state.getChildThreadByParentToolUseId(id)  // <-- Looks up by tool_use_id
  );

  // If a child thread exists, render the reference block instead
  if (childThread) {
    return (
      <SubAgentReferenceBlock
        toolUseId={id}
        childThreadId={childThread.id}
        name={childThread.name ?? "Sub-agent"}
        status={childThread.status}
        toolCallCount={toolCallCount}
      />
    );
  }

  // Otherwise render full TaskToolBlock...
}
```

The `getChildThreadByParentToolUseId` function in `store.ts:104-105`:

```typescript
getChildThreadByParentToolUseId: (parentToolUseId) =>
  get()._threadsArray.find((c) => c.parentToolUseId === parentToolUseId),
```

### Root Cause: ID Mismatch

The TaskToolBlock passes `id` (the Task tool's `tool_use_id`, e.g., `toolu_01ABC123...`) to `getChildThreadByParentToolUseId()`.

But the child thread's metadata has:
```typescript
parentToolUseId: agentId  // e.g., "ad79f4f" (short hex ID)
```

**These don't match!**

| Value | Example | Where Used |
|-------|---------|------------|
| Task tool's `tool_use_id` | `toolu_01ABC123...` | TaskToolBlock `id` prop |
| SDK's `agent_id` | `ad79f4f` | Child thread's `parentToolUseId` |

The child thread stores the SDK's `agent_id` (short hex) as `parentToolUseId`, but the frontend looks up by the full `tool_use_id`.

### Current Code That Sets `parentToolUseId`

In `shared.ts:543`:
```typescript
const childMetadata = {
  // ...
  parentToolUseId: agentId,  // Uses SDK's agent_id, NOT the Task tool's tool_use_id
};
```

### The Fix

**Option A: Store the correct ID in child thread metadata**

The child thread's `parentToolUseId` should be the Task tool's `tool_use_id`, not the SDK's `agent_id`. This requires capturing the `tool_use_id` from PreToolUse and passing it to SubagentStart.

**Option B: Look up by agent_id in the frontend**

Add the SDK's `agent_id` to the Task tool result, then use that for lookup. But this requires parsing the tool result.

**Recommended: Option A with PreToolUse Queue**

1. In `PreToolUse` for Task tool: Store `tool_use_id` → pending prompt info
2. In `SubagentStart`: Pop from queue, get the `tool_use_id`, store as `parentToolUseId`
3. Frontend lookup now works because IDs match

### Alternative: Parse Task Tool Result

The Task tool result contains `agentId`:
```json
{"prompt":"...", "agentId":"ad79f4f", ...}
```

The frontend could:
1. Parse the tool result when it completes
2. Store an `agentId` → `tool_use_id` mapping
3. Use that to look up child threads

But this is more complex and requires parsing tool results.

---

## Updated Recommended Solution

### Phase 1: Add PreToolUse Hook for Task Tool

Capture the `tool_use_id` and prompt before SubagentStart fires:

```typescript
// New map to link tool_use_id to pending task info
const pendingTaskInfo = new Map<string, {
  toolUseId: string;
  prompt: string;
  agentType: string
}>();

// Queue to pass info from PreToolUse to SubagentStart (FIFO order)
const pendingTaskQueue: Array<{
  toolUseId: string;
  prompt: string;
  agentType: string
}> = [];

PreToolUse: [{
  matcher: "Task",
  hooks: [async (input: PreToolUseHookInput) => {
    const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };

    pendingTaskQueue.push({
      toolUseId: input.tool_use_id,  // The FULL tool_use_id: toolu_01ABC...
      prompt: taskInput.prompt ?? "Unknown task",
      agentType: taskInput.subagent_type ?? "general-purpose"
    });

    logger.info(`[PreToolUse:Task] Queued task: ${input.tool_use_id}`);
    return { continue: true };
  }]
}]
```

### Phase 2: Update SubagentStart to Use Queue

```typescript
SubagentStart: [{
  hooks: [async (input: SubagentStartHookInput) => {
    const agentId = input.agent_id;  // SDK's short hex ID

    // Pop from queue (FIFO order matches SDK event order)
    const pending = pendingTaskQueue.shift();

    if (!pending) {
      logger.warn(`[SubagentStart] No pending task info for agent ${agentId}`);
      // Fallback to current behavior
    }

    const childThreadId = crypto.randomUUID();
    const now = Date.now();

    const childMetadata = {
      id: childThreadId,
      repoId: context.repoId,
      worktreeId: context.worktreeId,
      status: "running",
      turns: [{
        index: 0,
        prompt: pending?.prompt ?? `Sub-agent: ${input.agent_type}`,
        startedAt: now,
        completedAt: null,
      }],
      parentThreadId: context.threadId,
      parentToolUseId: pending?.toolUseId ?? agentId,  // Use FULL tool_use_id if available!
      agentType: input.agent_type,
      // ...
    };

    // IMPORTANT: Store mapping by BOTH IDs
    // - agent_id for message routing (messages have parent_tool_use_id = agent_id)
    // - tool_use_id for child thread metadata (for frontend lookup)
    agentIdToChildThreadId.set(agentId, childThreadId);

    // ... write to disk, emit events
  }]
}]
```

### Phase 3: Dual Mapping for Message Routing

Since messages within sub-agents have `parent_tool_use_id = agent_id` (short hex), we need to keep the existing mapping:

```typescript
// Keep this for MESSAGE ROUTING (sub-agent messages use agent_id)
agentIdToChildThreadId.set(agentId, childThreadId);

// The child thread's metadata.parentToolUseId should be the FULL tool_use_id
// for FRONTEND LOOKUP (TaskToolBlock uses tool_use_id)
```

### Summary of ID Usage

| ID | Format | Used By | Purpose |
|----|--------|---------|---------|
| `tool_use_id` | `toolu_01ABC...` | PreToolUse, TaskToolBlock | Frontend lookup |
| `agent_id` | `ad79f4f` | SubagentStart, message routing | Message routing |

**Child thread metadata should store `tool_use_id`** (for frontend lookup)
**Agent runner should map by `agent_id`** (for message routing)

---

## Verification Steps

```bash
# Run sub-agent tests
cd agents && pnpm test -- --run sub-agent.integration.test.ts
```

All tests should pass after implementing the fix.

---

## Testing Checklist

After implementing fixes, verify:

1. **Issue 1 (Prompt)**: Child thread shows actual task prompt, not "Sub-agent: Explore"
2. **Issue 2 (State files)**: Child thread has `state.json` with tool states
3. **Issue 3 (Tool routing)**: Sub-agent's tool uses appear in child thread, not parent
4. **Issue 4 (Reference block)**: Parent thread shows SubAgentReferenceBlock for completed tasks

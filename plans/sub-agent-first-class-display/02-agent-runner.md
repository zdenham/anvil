# 02: Agent Runner

Implement sub-agent lifecycle hooks and message routing in the agent runner.

## Phases

- [x] Add SubagentStart hook (create child thread, store mapping)
- [x] Add SubagentStop hook (update child thread status)
- [x] Modify MessageHandler to route by `parent_tool_use_id`
- [x] Integrate with thread-naming-service

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent Runner                            │
│                                                                 │
│  MessageHandler:                                                │
│    parent_tool_use_id === null ──▶ Parent Thread State File    │
│    parent_tool_use_id !== null ──▶ Child Thread State File     │
│                                    (lookup via toolUseId map)   │
│                                                                 │
│  SubagentStart Hook:                                            │
│    1. Generate child thread ID (UUID)                           │
│    2. Create thread on disk with parentThreadId set             │
│    3. Store mapping: toolUseId -> childThreadId (in-memory)     │
│    4. Emit THREAD_CREATED event                                 │
│    5. Fire-and-forget: request name via thread-naming-service   │
│                                                                 │
│  SubagentStop Hook:                                             │
│    1. Mark child thread status as idle/complete                 │
│    2. Emit THREAD_STATUS_CHANGED event                          │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation

```typescript
// agents/src/runners/shared.ts

// In-memory mapping (cleared on process exit)
const toolUseIdToChildThreadId = new Map<string, string>();

hooks: {
  SubagentStart: [{
    matcher: { toolName: 'Task' },
    hooks: [async (input: SubagentStartHookInput, context) => {
      const childThreadId = crypto.randomUUID();
      const taskInput = getCurrentTaskToolInput();

      // Create child thread with parent link
      await createThread({
        id: childThreadId,
        name: `${input.agent_type}: ${taskInput.description}`,
        status: 'running',
        repoId: context.repoId,
        worktreeId: context.worktreeId,
        parentThreadId: context.threadId,
        parentToolUseId: currentToolUseId,
        agentType: input.agent_type,
      });

      // Store mapping for message routing
      toolUseIdToChildThreadId.set(currentToolUseId, childThreadId);

      // Fire-and-forget naming (same as regular threads)
      threadNamingService.requestName(childThreadId, taskInput.description);

      return { continue: true };
    }]
  }],

  SubagentStop: [{
    matcher: { toolName: 'Task' },
    hooks: [async (input: SubagentStopHookInput) => {
      const childThreadId = toolUseIdToChildThreadId.get(currentToolUseId);
      if (childThreadId) {
        await updateThreadStatus(childThreadId, 'idle');
        toolUseIdToChildThreadId.delete(currentToolUseId);
      }
      return { continue: true };
    }]
  }]
}

// In MessageHandler - route sub-agent messages
async handle(message: SDKMessage): Promise<boolean> {
  const parentToolUseId = this.getParentToolUseId(message);

  if (parentToolUseId) {
    const childThreadId = toolUseIdToChildThreadId.get(parentToolUseId);
    if (childThreadId) {
      // Write to child thread's state file instead of parent
      return this.handleMessageForThread(childThreadId, message);
    }
  }

  // Normal parent thread handling
  return this.handleMessageForThread(this.threadId, message);
}
```

## Files to Modify

- `agents/src/runners/shared.ts` - Add hooks and mapping
- `agents/src/runners/message-handler.ts` - Route by parent_tool_use_id
- `agents/src/services/thread-naming-service.ts` - Ensure works for sub-agents

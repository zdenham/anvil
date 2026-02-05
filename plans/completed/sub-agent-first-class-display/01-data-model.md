# 01: Data Model

Extend ThreadMetadata with sub-agent fields. No new types or events needed.

## Phases

- [x] Add fields to ThreadMetadata
- [x] Update Zod validation schema

---

## Extended ThreadMetadata

```typescript
// core/types/threads.ts - Add these optional fields
interface ThreadMetadata {
  // ... existing fields (id, name, status, repoId, worktreeId, createdAt, updatedAt)

  // Sub-agent fields (only present for sub-agent threads)
  parentThreadId?: string;      // Parent thread ID (presence implies sub-agent)
  parentToolUseId?: string;     // Task tool_use ID that spawned this
  agentType?: string;           // "Explore", "Plan", "general-purpose", etc.
}
```

## Key Points

- A thread with `parentThreadId` is a sub-agent
- Read-only is implicit (detected by `parentThreadId !== undefined`)
- No new event types needed

## Events: Reuse Existing

Sub-agents use existing thread events:

- `THREAD_CREATED` - emitted on SubagentStart (with `parentThreadId` in metadata)
- `THREAD_STATE` - emitted as sub-agent messages stream in
- `THREAD_STATUS_CHANGED` - emitted on SubagentStop

The frontend detects sub-agents by checking `metadata.parentThreadId !== undefined`.

## Files to Modify

- `core/types/threads.ts` - Add optional fields
- Thread validation schema (wherever Zod schema lives)

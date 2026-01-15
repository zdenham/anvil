# Sub-Plan 01: Core Types

**Status:** Not Started
**Prerequisite for:** 02-agent-runtime.md, 03-frontend-integration.md
**Can run parallel with:** None (must complete first)
**Estimated scope:** Small (~4 changes)

## Overview

Add "cancelled" status to type definitions so both agent runtime and frontend can use it.

## Current State (as of 2026-01-10)

Verified against actual codebase:

| Location | Current State | Needs Change |
|----------|---------------|--------------|
| `core/types/events.ts:36` - `AgentThreadStatusSchema` | `["running", "complete", "error"]` | Yes - add "cancelled" |
| `core/types/events.ts:47-84` - `EventName` | No `AGENT_CANCELLED` | Yes - add event |
| `core/types/events.ts:96-149` - `EventPayloads` | No `AGENT_CANCELLED` | Yes - add payload |
| `core/types/events.ts:217-239` - `EventNameSchema` | No `AGENT_CANCELLED` | Yes - add to enum |
| `core/types/threads.ts:3` - `ThreadStatus` | `"idle" \| "running" \| "completed" \| "error" \| "paused"` | Yes - add "cancelled" |
| `core/types/threads.ts:32` - `ThreadMetadataSchema.status` | `["idle", "running", "completed", "error", "paused"]` | Yes - add "cancelled" |
| `agents/src/runners/types.ts:106-110` - `RunnerStrategy.cleanup()` | `status: "completed" \| "error"` | Yes - add "cancelled" |

## Changes

### 1. Add "cancelled" to AgentThreadStatus

**File: `core/types/events.ts`**

Find line 36 and update:

```typescript
// Before (line 36)
export const AgentThreadStatusSchema = z.enum(["running", "complete", "error"]);

// After
export const AgentThreadStatusSchema = z.enum(["running", "complete", "error", "cancelled"]);
```

### 2. Add AGENT_CANCELLED Event

**File: `core/types/events.ts`**

#### 2a. Add to EventName object (around line 64)

```typescript
export const EventName = {
  // ... existing events ...

  // Agent process
  AGENT_SPAWNED: "agent:spawned",
  AGENT_STATE: "agent:state",
  AGENT_COMPLETED: "agent:completed",
  AGENT_ERROR: "agent:error",
  AGENT_TOOL_COMPLETED: "agent:tool-completed",
  AGENT_CANCELLED: "agent:cancelled",  // <-- ADD THIS

  // Orchestration
  // ...
} as const;
```

#### 2b. Add to EventPayloads interface (around line 113, after AGENT_TOOL_COMPLETED)

```typescript
export interface EventPayloads {
  // ... existing payloads ...

  // Agent events
  [EventName.AGENT_SPAWNED]: { threadId: string; taskId: string };
  [EventName.AGENT_STATE]: { threadId: string; state: ThreadState };
  [EventName.AGENT_COMPLETED]: { threadId: string; exitCode: number; costUsd?: number };
  [EventName.AGENT_ERROR]: { threadId: string; error: string };
  [EventName.AGENT_TOOL_COMPLETED]: { threadId: string; taskId: string };
  [EventName.AGENT_CANCELLED]: { threadId: string };  // <-- ADD THIS

  // ...
}
```

#### 2c. Add to EventNameSchema (around line 229, after AGENT_TOOL_COMPLETED)

```typescript
export const EventNameSchema = z.enum([
  // ... existing events ...
  EventName.AGENT_SPAWNED,
  EventName.AGENT_STATE,
  EventName.AGENT_COMPLETED,
  EventName.AGENT_ERROR,
  EventName.AGENT_TOOL_COMPLETED,
  EventName.AGENT_CANCELLED,  // <-- ADD THIS
  // ...
]);
```

### 3. Add "cancelled" to ThreadStatus and ThreadMetadataSchema

**File: `core/types/threads.ts`**

#### 3a. Update ThreadStatus type (line 3)

```typescript
// Before
export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused";

// After
export type ThreadStatus = "idle" | "running" | "completed" | "error" | "paused" | "cancelled";
```

#### 3b. Update ThreadMetadataSchema status field (line 32)

```typescript
// Before
export const ThreadMetadataSchema = z.object({
  // ...
  status: z.enum(["idle", "running", "completed", "error", "paused"]),
  // ...
});

// After
export const ThreadMetadataSchema = z.object({
  // ...
  status: z.enum(["idle", "running", "completed", "error", "paused", "cancelled"]),
  // ...
});
```

### 4. Update RunnerStrategy cleanup signature

**File: `agents/src/runners/types.ts`**

Update the cleanup method signature (lines 106-110):

```typescript
// Before
cleanup(
  context: OrchestrationContext,
  status: "completed" | "error",
  error?: string
): Promise<void>;

// After
cleanup(
  context: OrchestrationContext,
  status: "completed" | "error" | "cancelled",
  error?: string
): Promise<void>;
```

**Note:** This change ensures the strategy interface supports cancellation. Implementations (TaskRunnerStrategy, SimpleRunnerStrategy) will be updated in 02-agent-runtime.md.

## Type Mapping Reference

| Context | Enum | Values | Used By |
|---------|------|--------|---------|
| Agent output (state.json) | `AgentThreadStatus` | "running", "complete", "error", "cancelled" | Node agent process |
| Thread metadata (metadata.json) | `ThreadStatus` | "idle", "running", "completed", "error", "paused", "cancelled" | Frontend Tauri app |

**Important:** Agent uses `"complete"` while frontend uses `"completed"` (with 'd'). This is intentional for backwards compatibility with agent output protocol.

## Implementation Notes

1. **Order matters**: Update `core/types/` first since other packages import from there
2. **Re-exports**: `src/entities/threads/types.ts` re-exports from `@core/types/threads.js` - no changes needed there
3. **No breaking changes**: Adding to union types is backwards compatible

## Verification

```bash
# From project root
pnpm typecheck
```

Should pass with no errors. The new types won't be used yet, but they'll be available for sub-plans 02 and 03.

**Expected outcome:** Type checking passes. No runtime behavior changes yet.

## Files Modified

- `core/types/events.ts` (4 locations)
- `core/types/threads.ts` (2 locations)
- `agents/src/runners/types.ts` (1 location)

## Dependencies

This plan has no dependencies - it must complete first before other cancellation plans can proceed.

## Related Plans

- **02-agent-runtime.md**: Uses `AgentThreadStatus: "cancelled"` in output.ts, updates strategy implementations
- **03-frontend-integration.md**: Uses `ThreadStatus: "cancelled"` and `AGENT_CANCELLED` event

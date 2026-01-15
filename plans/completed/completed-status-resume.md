# Fix: Allow message submission when agent status is "completed"

## Problem

When a user tries to send a follow-up message in the SimpleTaskWindow after an agent has completed its task, they see:

```
[SimpleTaskWindow] Cannot submit in current state {"status":"completed"}
```

The message is never sent.

## Root Cause

In `src/components/simple-task/simple-task-window.tsx` (lines 93-94):

```typescript
const canQueueMessages = viewStatus === 'running';
const canResumeAgent = viewStatus === 'idle' || viewStatus === 'error' || viewStatus === 'cancelled';
```

The `handleSubmit` function (lines 111-137) has three branches:
1. `canQueueMessages` → queue message to running agent
2. `canResumeAgent` → spawn new agent process with history
3. else → log warning and do nothing

When `viewStatus === "completed"`:
- `canQueueMessages` is `false` (not running)
- `canResumeAgent` is `false` (not idle/error/cancelled)
- Falls through to the warning log

## Solution

Add `"completed"` to the `canResumeAgent` condition. A completed agent should be resumable - users naturally want to ask follow-up questions after an agent finishes its work.

### Change Required

**File**: `src/components/simple-task/simple-task-window.tsx`

**Lines 94-95** - Change:
```typescript
const canResumeAgent = viewStatus === 'idle' || viewStatus === 'error' || viewStatus === 'cancelled';
```

To:
```typescript
const resumableStatuses: ViewStatus[] = ['idle', 'error', 'cancelled', 'completed'];
const canResumeAgent = resumableStatuses.includes(viewStatus);
```

## Behavior After Fix

| viewStatus | canQueueMessages | canResumeAgent | Action |
|------------|-----------------|----------------|--------|
| `running` | true | false | Queue message to stdin |
| `idle` | false | true | Spawn new agent with history |
| `error` | false | true | Spawn new agent with history |
| `cancelled` | false | true | Spawn new agent with history |
| `completed` | false | **true** | Spawn new agent with history |
| `loading` | false | false | Warning (expected - still loading) |

## Testing

1. Start a simple task and let the agent complete
2. Verify status shows "completed"
3. Type a follow-up message and submit
4. Verify agent resumes with full conversation history
5. Verify no warning appears in logs

## Risk Assessment

**Low risk** - This is a one-line change that:
- Uses existing `resumeSimpleAgent` code path (already tested for idle/error/cancelled)
- Matches user expectations (completed conversations should be resumable)
- Does not affect any other status handling

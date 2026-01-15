# Spotlight Changes

**`src/components/spotlight/spotlight.tsx`**

## Changes Required

- Start with `taskId: null` instead of requiring a task upfront
- Agent handles routing via tool call (the `/route` skill)
- UI updates to show task context once assigned

## Flow

1. User opens spotlight
2. Thread created with `taskId: null`
3. User submits query
4. Agent receives query + injected task context via hook
5. Agent invokes `/route` skill
6. Agent runs CLI command to associate/create task
7. Thread updated with `taskId`
8. UI reflects task association

## UI Updates

When task is assigned:
- Show task title/slug in spotlight header
- Indicate task type (work/investigate)
- Show branch name for context

## Files to Modify

- `src/components/spotlight/spotlight.tsx` - Start with null taskId, update UI on assignment

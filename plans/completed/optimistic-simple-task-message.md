# Optimistic Human Message in Simple Task View

## Problem

When opening a simple task view, there's a noticeable delay before the human message appears. The flow is:

1. User submits prompt in spotlight
2. Window opens → shows "Loading..." or empty state
3. Agent spawns and writes to disk
4. UI finally displays the human message

This creates a jarring transition where the user's input seems to disappear momentarily.

## Current State

The infrastructure for passing the prompt optimistically **already exists** but isn't being used:

**`use-simple-task-params.ts`** (lines 8-12, 43-47):
- Returns `{ taskId, threadId, prompt }`
- The `prompt` is populated from both IPC and events

**`simple-task-window.tsx`** (lines 28-41):
- Receives `prompt` in props but **does not use it**
- Currently destructures only `{ taskId, threadId }`, ignoring `prompt`
- Gets messages solely from store: `activeState?.messages ?? []`

**Message format expected** (`ThreadView`):
```typescript
type MessageParam = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}
```

## Proposed Solution

Use the `prompt` from params to create an optimistic user message that displays immediately, before the thread state is populated from disk.

### Implementation

1. **Use the prompt in `SimpleTaskWindowContent`**:
   ```typescript
   function SimpleTaskWindowContent({
     taskId,
     threadId,
     prompt, // Already passed, just need to destructure
   }: SimpleTaskWindowContentProps) {
   ```

2. **Derive status to handle optimistic state**:
   ```typescript
   // If we have optimistic messages but no real state, treat as "running"
   // This prevents ThreadView from showing EmptyState when status === "idle"
   const viewStatus: ViewStatus =
     prompt && !activeState?.messages?.length
       ? "running"
       : entityStatus === "paused"
         ? "idle"
         : entityStatus;

   const isStreaming = viewStatus === "running";
   ```

3. **Create optimistic message when store is empty**:
   ```typescript
   const optimisticMessages = useMemo((): MessageParam[] => {
     // If we have messages from the store, use those (real data)
     if (activeState?.messages && activeState.messages.length > 0) {
       return activeState.messages;
     }

     // If we have a prompt but no messages yet, show optimistic message
     if (prompt) {
       return [{ role: "user", content: prompt }];
     }

     return [];
   }, [activeState?.messages, prompt]);
   ```

4. **Pass optimistic messages to ThreadView**:
   ```typescript
   <ThreadView
     messages={optimisticMessages}  // instead of: messages
     isStreaming={isStreaming}
     status={viewStatus}
     toolStates={toolStates}
   />
   ```

### Why This Approach

- **Minimal change**: The prompt is already flowing through the system, just needs to be used
- **No duplication**: Once real messages arrive from the store, they replace the optimistic one
- **Correct format**: User message format `{ role: "user", content: string }` is valid `MessageParam`
- **Natural transition**: The optimistic message will look identical to the real message when it loads

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No prompt provided | Fall back to empty array, shows empty state |
| Real messages arrive | Immediately replace optimistic message |
| Resume/follow-up messages | Prompt may be undefined, uses store messages |
| Window reopened for existing task | Has real messages, optimistic message ignored |

## Files to Modify

1. **`src/components/simple-task/simple-task-window.tsx`**
   - Destructure `prompt` from props
   - Add `useMemo` to compute optimistic messages
   - Pass optimistic messages to `ThreadView`

## Testing

1. Open spotlight, type a prompt, submit as simple task
2. Verify the human message appears immediately (before agent spawns)
3. Verify the message remains visible as the agent responds
4. Verify no duplicate messages appear
5. Test resume flow - existing messages should display, not optimistic prompt

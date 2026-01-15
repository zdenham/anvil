# Phase 3: UI Integration

## Dependencies
- **Depends on:** `01-core-components.md` (AskUserQuestionBlock must exist)
- **Blocks:** `04-testing.md`
- **Can run parallel with:** `02-agent-handler.md`

## Scope

Wire up the AskUserQuestionBlock component through the component hierarchy:
- AssistantMessage renders it for AskUserQuestion tool_use blocks
- ThreadView passes the response callback through
- SimpleTaskWindow handles the actual submission

## Files to Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/components/thread/assistant-message.tsx` | **Verify exists, then modify** | Render AskUserQuestionBlock for the tool |
| `src/components/thread/thread-view.tsx` | **Verify exists, then modify** | Pass onToolResponse prop through |
| `src/components/simple-task/simple-task-window.tsx` | **Verify exists, then modify** | Implement response handler |

---

## Step 3.1: Update AssistantMessage Component

**File:** `src/components/thread/assistant-message.tsx`

**Action:** Verify file exists at `src/components/thread/assistant-message.tsx`, then apply changes.

### Changes Required

1. Import `AskUserQuestionBlock`
2. Add case for `AskUserQuestion` tool in the tool_use block switch
3. Accept `onToolResponse` prop

### Imports to Add

```typescript
import { AskUserQuestionBlock } from "./ask-user-question-block";

// Type imports (ensure these are available)
import type { ToolExecutionState } from "@/types/agent";
import type { MessageParam, ContentBlock, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
```

### Props Addition

```typescript
interface AssistantMessageProps {
  messages: MessageParam[];
  messageIndex: number;
  isStreaming?: boolean;
  toolStates?: Record<string, ToolExecutionState>;
  /** Callback when user responds to a tool (e.g., AskUserQuestion) */
  onToolResponse?: (toolId: string, response: string) => void;
}
```

### Tool Use Case

In the switch statement for `block.type === "tool_use"`:

```typescript
case "tool_use": {
  if (block.name === "AskUserQuestion") {
    const input = block.input as {
      question: string;
      options: string[];
      allow_multiple?: boolean;
    };
    const state = toolStates?.[block.id] ?? { status: "running" as const };

    return (
      <AskUserQuestionBlock
        key={block.id}
        id={block.id}
        question={input.question}
        options={input.options}
        allowMultiple={input.allow_multiple}
        status={state.status === "complete" ? "answered" : "pending"}
        result={state.result}
        onSubmit={(response) => onToolResponse?.(block.id, response)}
      />
    );
  }

  // Default tool rendering...
}
```

---

## Step 3.2: Update ThreadView Component

**File:** `src/components/thread/thread-view.tsx`

**Action:** Verify file exists at `src/components/thread/thread-view.tsx`, then apply changes.

### Changes Required

1. Accept `onToolResponse` prop
2. Pass it to `AssistantMessage`

### Props Addition

```typescript
interface ThreadViewProps {
  // ... existing props
  onToolResponse?: (toolId: string, response: string) => void;
}
```

### Pass to AssistantMessage

```typescript
<AssistantMessage
  // ...existing props
  onToolResponse={onToolResponse}
/>
```

---

## Step 3.3: Update SimpleTaskWindow Component

**File:** `src/components/simple-task/simple-task-window.tsx`

**Action:** Verify file exists at `src/components/simple-task/simple-task-window.tsx`, then apply changes.

### Changes Required

1. Import `submitToolResult` from agent service
2. Create `handleToolResponse` callback
3. Pass it to `ThreadView`

### Imports to Add

```typescript
import { submitToolResult } from "@/services/agent-service";
import { logger } from "@/lib/logger-client";
```

### Handler Implementation

```typescript
const handleToolResponse = useCallback(async (toolId: string, response: string) => {
  if (!workingDirectory) {
    logger.error("[SimpleTaskWindow] Cannot respond: no working directory");
    return;
  }

  try {
    await submitToolResult(taskId, threadId, toolId, response, workingDirectory);
  } catch (error) {
    logger.error("[SimpleTaskWindow] Failed to submit tool response", { error, toolId });
    throw error;
  }
}, [taskId, threadId, workingDirectory]);
```

### Pass to ThreadView

```typescript
<ThreadView
  // ...existing props
  onToolResponse={handleToolResponse}
/>
```

---

## Prop Flow Diagram

```
SimpleTaskWindow
  +-- handleToolResponse (implementation)
     |
     v
  ThreadView
    +-- onToolResponse (pass-through)
       |
       v
    AssistantMessage
      +-- onToolResponse -> AskUserQuestionBlock.onSubmit
         |
         v
      User clicks option -> submitToolResult()
```

---

## Tool State Mapping

| ToolExecutionState.status | AskUserQuestionBlock.status |
|---------------------------|------------------------------|
| `"running"` | `"pending"` |
| `"complete"` | `"answered"` |
| `"error"` | `"pending"` (with error styling) |

---

## Error State Handling

When a tool submission fails, the component should provide visual feedback and allow retry.

### Error Styling

Add error state to the component's visual states:

```typescript
// In AskUserQuestionBlock, handle error state in className
className={cn(
  "rounded-lg border p-4",
  isPending && !hasError
    ? "border-accent-500/50 bg-accent-950/20"
    : hasError
    ? "border-red-500/50 bg-red-950/20"
    : "border-zinc-700 bg-zinc-900/50"
)}
```

### Error Message Display

When an error occurs during submission, display it below the options:

```typescript
{/* Error state */}
{hasError && errorMessage && (
  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-red-500/30 ml-8">
    <AlertCircle className="h-4 w-4 text-red-400" />
    <span className="text-sm text-red-300">{errorMessage}</span>
  </div>
)}
```

### Retry Considerations

1. **Keep selection state** - If submission fails, preserve the user's selection so they can retry
2. **Reset isSubmitting** - Clear the submitting flag so the user can try again
3. **Log the error** - Use logger for debugging but show user-friendly message in UI

### Error Handler Update in SimpleTaskWindow

```typescript
const handleToolResponse = useCallback(async (toolId: string, response: string) => {
  if (!workingDirectory) {
    logger.error("[SimpleTaskWindow] Cannot respond: no working directory");
    // Optionally emit an error state to the component
    return;
  }

  try {
    await submitToolResult(taskId, threadId, toolId, response, workingDirectory);
  } catch (error) {
    logger.error("[SimpleTaskWindow] Failed to submit tool response", { error, toolId });
    // Re-throw to allow component to handle error state
    // The component should catch this and show error UI
    throw error;
  }
}, [taskId, threadId, workingDirectory]);
```

---

## Verification

```bash
# Verify all source files exist before modification
ls -la src/components/thread/assistant-message.tsx
ls -la src/components/thread/thread-view.tsx
ls -la src/components/simple-task/simple-task-window.tsx

# Type check
pnpm tsc --noEmit

# Check imports are correct
grep -n "AskUserQuestionBlock" src/components/thread/assistant-message.tsx
grep -n "onToolResponse" src/components/thread/thread-view.tsx
grep -n "handleToolResponse" src/components/simple-task/simple-task-window.tsx
```

---

## Exit Criteria

- [ ] Verified `src/components/thread/assistant-message.tsx` exists before modification
- [ ] Verified `src/components/thread/thread-view.tsx` exists before modification
- [ ] Verified `src/components/simple-task/simple-task-window.tsx` exists before modification
- [ ] `assistant-message.tsx` renders `AskUserQuestionBlock` for `AskUserQuestion` tool
- [ ] `thread-view.tsx` passes `onToolResponse` prop through
- [ ] `simple-task-window.tsx` implements `handleToolResponse` callback
- [ ] Error states are handled with appropriate styling and messaging
- [ ] All three files pass type checking
- [ ] No circular dependencies introduced

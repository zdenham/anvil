# Fix Thread Input Prompt History Saving

## Problem

Prompts submitted from the normal thread input (in `ThreadContent`) are not being saved to prompt history. Only prompts submitted from the Spotlight are currently saved.

**Current behavior:**
- Spotlight saves prompts via `promptHistoryService.add()` when creating threads
- Spotlight saves drafts via `promptHistoryService.addDraft()` when losing focus
- Thread input does NOT save prompts at all

**Expected behavior:**
- All user prompts should be saved to history, regardless of which input they come from

## Root Cause

In `src/components/content-pane/thread-content.tsx`, the `handleSubmit` function calls `spawnSimpleAgent()`, `resumeSimpleAgent()`, or `sendQueuedMessage()` but never calls `promptHistoryService.add()`.

## Solution

Create a shared helper function that saves prompts to history, then use it from all input sources.

## Phases

- [x] Create shared prompt submission helper
- [x] Integrate with thread content
- [x] Disable history cycling when Command key is pressed or user types
- [x] Verify spotlight still works correctly

## Implementation

### Phase 1: Create Shared Prompt Submission Helper

Create a small utility that handles the prompt history saving logic. This keeps the save logic centralized and ensures consistency across all input sources.

**File:** `src/lib/prompt-history-helpers.ts`

```typescript
import { promptHistoryService } from "./prompt-history-service";
import { logger } from "@shared/logger";

/**
 * Save a submitted prompt to history.
 * Call this after successfully submitting a prompt from any input source.
 */
export async function savePromptToHistory(
  prompt: string,
  taskId?: string
): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  try {
    await promptHistoryService.add(trimmed, taskId);
  } catch (error) {
    logger.error("[PromptHistory] Failed to save prompt to history:", error);
  }
}

/**
 * Save a draft prompt to history (e.g., when input loses focus).
 * Uses addDraft which only saves if not already in history.
 */
export async function saveDraftToHistory(prompt: string): Promise<void> {
  const trimmed = prompt.trim();
  if (!trimmed) return;

  try {
    await promptHistoryService.addDraft(trimmed);
  } catch (error) {
    logger.error("[PromptHistory] Failed to save draft to history:", error);
  }
}
```

### Phase 2: Integrate with Thread Content

Update `src/components/content-pane/thread-content.tsx` to save prompts after submission.

In the `handleSubmit` function (around line 268), add a call to save the prompt:

```typescript
import { savePromptToHistory } from "@/lib/prompt-history-helpers";

// In handleSubmit, after the prompt is successfully processed:
const handleSubmit = useCallback(
  async (userPrompt: string) => {
    // ... existing validation and setup code ...

    // Save to history (fire and forget - don't block on this)
    savePromptToHistory(userPrompt, taskId);

    // ... rest of existing submit logic ...
  },
  [/* deps */]
);
```

### Phase 3: Disable History Cycling on Command Key or User Input

History cycling should be disabled in two scenarios:
1. **When Command (⌘) key is pressed** - This allows Command+Up/Down to perform other actions (e.g., cursor jump to beginning/end of input)
2. **When the user types into the input** - Exit history mode and reset to normal editing

**Current behavior:**
- User typing already calls `resetHistory()` which exits history mode ✓
- Command key is NOT checked before triggering history navigation ✗

**Fix:** Update the `usePromptHistory` hook or the consuming components to check for `metaKey` before processing history navigation.

#### Option A: Check in consuming components (recommended)

Update `src/components/reusable/thread-input.tsx`:

```typescript
// In handleKeyDown, before history navigation:
if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !triggerState?.isActive) {
  // Skip history navigation if Command key is pressed
  if (e.metaKey) {
    return; // Let default behavior handle Cmd+Up/Down
  }
  // ... rest of history navigation logic
}
```

Update `src/components/spotlight/spotlight.tsx` similarly in the `handleKeyDown` handler:

```typescript
case "ArrowDown":
  // Skip history if Command key is pressed
  if (e.metaKey) break;
  // ... existing history navigation code

case "ArrowUp":
  // Skip history if Command key is pressed
  if (e.metaKey) break;
  // ... existing history navigation code
```

#### Option B: Check in the hook itself

Alternatively, modify `usePromptHistory` to accept an options parameter that can disable navigation:

```typescript
interface UsePromptHistoryOptions {
  onQueryChange: (query: string) => void;
}

// The hook consumer passes whether navigation should be allowed
const handleHistoryNavigation = useCallback(
  async (direction: "up" | "down", options?: { disabled?: boolean }): Promise<boolean> => {
    if (options?.disabled) return false;
    // ... rest of logic
  },
  [...]
);
```

**Recommendation:** Option A is simpler and keeps the metaKey check close to where the keyboard event is handled, making the intent clearer.

### Phase 4: Update Spotlight to Use Shared Helper (Optional)

For consistency, update `src/components/spotlight/spotlight.tsx` to use the shared helper instead of calling `promptHistoryService` directly.

Replace:
```typescript
promptHistoryService.add(result.data.query).catch((error) => {
  logger.error("[Spotlight] Failed to save prompt to history:", error);
});
```

With:
```typescript
savePromptToHistory(result.data.query, taskId);
```

And replace the draft saving:
```typescript
await promptHistoryService.addDraft(trimmedQuery);
```

With:
```typescript
await saveDraftToHistory(trimmedQuery);
```

## Testing

1. **Thread Input Test:**
   - Open an existing thread
   - Submit a prompt via the thread input
   - Check that the prompt appears when pressing Up arrow in any input

2. **Spotlight Test:**
   - Create a new thread via Spotlight
   - Verify the prompt is saved to history

3. **History Navigation Test:**
   - Verify Up/Down arrow navigation still works correctly in both inputs
   - Verify history entries are deduplicated (same prompt doesn't appear twice)

4. **Command Key Test:**
   - In thread input: Press Cmd+Up/Down - should NOT trigger history cycling (should move cursor or do default behavior)
   - In spotlight: Press Cmd+Up/Down - should NOT trigger history cycling
   - After releasing Command, Up/Down should resume history cycling when appropriate

5. **User Typing Exit Test:**
   - Start cycling through history with Up arrow
   - Type any character - should exit history mode immediately
   - Subsequent Up arrow should start fresh from the beginning of history

## Files Changed

- `src/lib/prompt-history-helpers.ts` (new)
- `src/components/content-pane/thread-content.tsx` (add import + call in handleSubmit)
- `src/components/reusable/thread-input.tsx` (add metaKey check before history navigation)
- `src/components/spotlight/spotlight.tsx` (add metaKey check + optional refactor to use shared helper)

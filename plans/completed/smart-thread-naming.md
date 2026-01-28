# Smart Thread Naming Implementation Plan

## Overview

Implement an LLM-powered thread naming feature that automatically generates descriptive names (max 30 characters) for threads based on the user's initial prompt. The naming runs in parallel with the agent execution and broadcasts an event for UI consumption.

## Requirements

- Use Vercel AI SDK with Claude Haiku model
- Use existing Anthropic API key from environment
- Max 30 characters for generated names
- Run in parallel with agent execution (non-blocking)
- Broadcast event when name is generated
- Initiated in agent runner after thread creation

## Architecture Decision

**Location: Agent Runner Process (Node.js)**

The naming will be initiated in `agents/src/runners/simple-runner-strategy.ts` during the `setup()` phase, immediately after the thread is created on disk. This allows it to run truly in parallel with the main agent loop.

## Implementation Steps

### 1. Add Vercel AI SDK Dependencies

**File:** `agents/package.json`

Add the required packages:
```json
{
  "dependencies": {
    "@ai-sdk/anthropic": "^1.x.x",
    "ai": "^4.x.x"
  }
}
```

### 2. Create Thread Naming Event

**File:** `core/types/events.ts`

Add new event type to `EventName`:
```typescript
THREAD_NAME_GENERATED = "thread:name:generated"
```

Add payload type to `EventPayloads`:
```typescript
[EventName.THREAD_NAME_GENERATED]: {
  threadId: string;
  name: string;
}
```

### 3. Add Name Field to Thread Metadata

**File:** `core/types/threads.ts`

Add optional `name` field to `ThreadMetadata`:
```typescript
interface ThreadMetadata {
  // ... existing fields
  name?: string;  // Auto-generated thread name (max 30 chars)
}
```

Update `ThreadMetadataSchema` to include the new field.

### 4. Create Thread Naming Service

**File:** `agents/src/services/thread-naming-service.ts` (new file)

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const SYSTEM_PROMPT = `You are a thread naming assistant. Generate a concise, descriptive name for a conversation thread based on the user's initial message.

Rules:
- Maximum 30 characters
- Be descriptive but brief
- Use title case
- No quotes or special characters
- Focus on the main topic or action requested

Respond with ONLY the thread name, nothing else.`;

export async function generateThreadName(
  prompt: string,
  apiKey: string
): Promise<string> {
  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a thread name for this user message:\n\n${prompt}`,
    maxTokens: 50,
  });

  // Ensure max 30 characters and clean up
  return text.trim().slice(0, 30);
}
```

### 5. Add Event Emission Helper

**File:** `agents/src/lib/events.ts`

Add helper function for the new event:
```typescript
export function threadNameGenerated(threadId: string, name: string): void {
  emitEvent(EventName.THREAD_NAME_GENERATED, { threadId, name });
}
```

### 6. Integrate into Simple Runner Strategy

**File:** `agents/src/runners/simple-runner-strategy.ts`

Modify the `setup()` method to initiate naming in parallel:

```typescript
import { generateThreadName } from "../services/thread-naming-service";
import { threadNameGenerated } from "../lib/events";

// In setup(), after thread creation for new threads:
async setup(config: ParsedConfig): Promise<OrchestrationContext> {
  // ... existing setup code ...

  if (!isResume) {
    // Create thread on disk (existing code)
    await threadService.create({ ... });
    events.threadCreated(threadId, repoId, worktreeId);

    // Start thread naming in parallel (fire and forget)
    this.initiateThreadNaming(threadId, config.prompt);
  }

  // ... rest of setup ...
}

private initiateThreadNaming(threadId: string, prompt: string): void {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[thread-naming] No API key available");
    return;
  }

  generateThreadName(prompt, apiKey)
    .then(async (name) => {
      // Update thread metadata with name
      const threadService = new ThreadService(this.mortDir);
      await threadService.update(threadId, { name });

      // Broadcast event for UI
      threadNameGenerated(threadId, name);
    })
    .catch((error) => {
      // Log error but don't fail the main agent flow
      console.error("[thread-naming] Failed to generate name:", error.message);
    });
}
```

### 7. Update Thread Service

**File:** `core/services/thread/thread-service.ts`

Ensure the `update()` method can handle the new `name` field. This should already work if it accepts partial updates, but verify it passes through the `name` field correctly.

### 8. Register Event in Event Bridge (Frontend)

**File:** `src/lib/event-bridge.ts`

Add `THREAD_NAME_GENERATED` to `BROADCAST_EVENTS` array so it's forwarded across windows:
```typescript
const BROADCAST_EVENTS: EventNameType[] = [
  // ... existing events
  EventName.THREAD_NAME_GENERATED,
];
```

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `agents/package.json` | Modify | Add `@ai-sdk/anthropic` and `ai` dependencies |
| `core/types/events.ts` | Modify | Add `THREAD_NAME_GENERATED` event |
| `core/types/threads.ts` | Modify | Add `name` field to `ThreadMetadata` |
| `agents/src/services/thread-naming-service.ts` | Create | New service for LLM name generation |
| `agents/src/lib/events.ts` | Modify | Add `threadNameGenerated()` helper |
| `agents/src/runners/simple-runner-strategy.ts` | Modify | Initiate naming in `setup()` |
| `src/lib/event-bridge.ts` | Modify | Register new event for broadcast |

## Event Flow

```
1. User submits prompt
   ↓
2. Agent spawned, SimpleRunnerStrategy.setup() called
   ↓
3. Thread created on disk
   ↓
4. Two parallel paths:
   ├─ Main agent loop starts (existing behavior)
   └─ Thread naming initiated (new)
       ↓
       Haiku LLM call via Vercel AI SDK
       ↓
       Name generated (max 30 chars)
       ↓
       Thread metadata updated
       ↓
       THREAD_NAME_GENERATED event emitted
       ↓
       Event broadcast to UI (future consumption)
```

## Testing Considerations

1. **Unit tests** for `generateThreadName()` service
2. **Integration test** verifying event emission
3. **Edge cases:**
   - Very long prompts (should still work, just uses beginning)
   - API key missing (graceful degradation, logs error)
   - Network failure (graceful degradation, no name set)
   - Special characters in prompt
   - Empty/very short prompts

## Out of Scope

- UI display of thread names (explicitly noted as out of scope)
- Manual thread renaming
- Thread name persistence in thread list views
- Retry logic for failed naming attempts

## Verification Testing

A live agent harness test has been created to verify this implementation:

**Test File:** `agents/src/testing/__tests__/thread-naming.integration.test.ts`

### Running the Tests

```bash
# From the agents directory
cd agents

# Run only thread naming tests (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=your-key pnpm test thread-naming

# Or run with vitest directly
ANTHROPIC_API_KEY=your-key pnpm vitest run thread-naming.integration.test.ts

# Run with verbose output
ANTHROPIC_API_KEY=your-key pnpm vitest run thread-naming.integration.test.ts --reporter=verbose
```

### Test Coverage

The test suite verifies:

1. **Event Emission** - `THREAD_NAME_GENERATED` event is emitted with correct payload
2. **Name Constraints** - Generated names are max 30 characters
3. **Contextual Relevance** - Names are descriptive based on prompt content
4. **Edge Cases**:
   - Very short prompts ("Fix the bug")
   - Very long prompts (multi-paragraph descriptions)
5. **Parallel Execution** - Naming doesn't block main agent execution
6. **Disk Persistence** - Thread metadata on disk includes the `name` field

### Expected Test Results (Before Implementation)

Before implementation, all tests will fail with one of:
- Missing `THREAD_NAME_GENERATED` event
- Thread metadata missing `name` field

### Expected Test Results (After Implementation)

After implementation, all tests should pass:
- `THREAD_NAME_GENERATED` event emitted for each new thread
- Event payload contains `threadId` (UUID) and `name` (≤30 chars)
- Thread metadata JSON includes matching `name` field
- All tests complete within 2 minute timeout

### Debugging Failed Tests

If tests fail after implementation:

1. **Check logs** - The test outputs all events received
2. **Verify API key** - Ensure `ANTHROPIC_API_KEY` is set
3. **Check thread metadata** - Look at `~/.mort/threads/{id}/metadata.json`
4. **Review event emission** - Ensure `threadNameGenerated()` helper is called

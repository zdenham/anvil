# Plan 03: Event Listeners

## Dependencies

- **Requires Plan 02** (`refreshThreadState` must exist in service)

## Goal

Wire up event listeners for `AGENT_STATE` and `AGENT_COMPLETED` to trigger disk refresh.

## Files to Modify

| File | Action |
|------|--------|
| `src/entities/threads/listeners.ts` | Add AGENT_STATE and AGENT_COMPLETED listeners |

## Implementation

### Update `src/entities/threads/listeners.ts`

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { threadService } from "./service.js";
import { logger } from "@/lib/logger-client.js";

export function setupThreadListeners(): void {
  // ... existing listeners ...

  // Agent state updates - refresh thread state from disk
  eventBus.on(EventName.AGENT_STATE, async ({ threadId }) => {
    try {
      await threadService.refreshThreadState(threadId);
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh thread state ${threadId}:`, e);
    }
  });

  // Agent completed - refresh thread state from disk
  eventBus.on(EventName.AGENT_COMPLETED, async ({ threadId }) => {
    try {
      await threadService.refreshThreadState(threadId);
      await threadService.refreshById(threadId); // Also refresh metadata
    } catch (e) {
      logger.error(`[ThreadListener] Failed to refresh completed thread ${threadId}:`, e);
    }
  });
}
```

## Data Flow

```
Agent emits event → eventBus.on() → threadService.refreshThreadState() → read disk → update store → UI re-renders
```

## Notes

- Follows existing entity/listener pattern
- Error handling with logger (no crashes)
- `AGENT_COMPLETED` also refreshes metadata via `refreshById`

## Validation

- Events trigger disk reads
- Store updates on each event
- Errors are logged, not thrown

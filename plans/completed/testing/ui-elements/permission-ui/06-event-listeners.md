# Sub-Plan 06: Event Listeners and Bridge Integration

## Scope

Create event listeners for permission requests and integrate with the event bridge system.

## Dependencies

- **01-core-types.md** - Requires event types in `core/types/events.ts`
- **02-zustand-store.md** - Requires `usePermissionStore`

## Files to Create

### `src/entities/permissions/listeners.ts` (~40 lines)

```typescript
import { EventName } from "@core/types/events.js";
import { eventBus } from "../events.js";
import { usePermissionStore } from "./store.js";
import { PermissionRequestSchema } from "@core/types/permissions.js";
import { logger } from "@/lib/logger-client.js";

export function setupPermissionListeners(): void {
  // Handle incoming permission requests from agent
  eventBus.on(EventName.PERMISSION_REQUEST, (payload) => {
    const result = PermissionRequestSchema.safeParse(payload);

    if (!result.success) {
      logger.warn("[PermissionListener] Invalid permission request:", result.error);
      return;
    }

    usePermissionStore.getState()._applyAddRequest(result.data);
  });

  // Clean up on agent completion
  eventBus.on(EventName.AGENT_COMPLETED, ({ threadId }) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  });

  // Clean up on agent error
  eventBus.on(EventName.AGENT_ERROR, ({ threadId }) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  });

  // Clean up on agent cancellation
  // This handles the case where user cancels an agent that has pending permission requests
  eventBus.on(EventName.AGENT_CANCELLED, ({ threadId }) => {
    usePermissionStore.getState()._applyClearThread(threadId);
  });
}
```

### `src/entities/permissions/listeners.test.ts`

Include tests from main plan's "Test 4: Event Flow" section.

## Files to Modify

### `src/lib/event-bridge.ts`

Add to `BROADCAST_EVENTS` array:
```typescript
EventName.PERMISSION_REQUEST,
EventName.PERMISSION_RESPONSE,
```

### `src/entities/index.ts`

Register permission listeners:
```typescript
import { setupPermissionListeners } from "./permissions/listeners.js";

export function setupEntityListeners(): void {
  // ... existing listeners
  setupPermissionListeners();
}
```

### `src/entities/permissions/index.ts`

Create module barrel export:
```typescript
export { usePermissionStore } from "./store.js";
export { permissionService } from "./service.js";
export { setupPermissionListeners } from "./listeners.js";
export type {
  PermissionRequest,
  PermissionStatus,
  PermissionDecision,
  PermissionResponse,
  PermissionMode,
  PermissionDisplayMode,
} from "./types.js";
export { isDangerousTool, isWriteTool } from "./types.js";
```

## Verification

```bash
pnpm tsc --noEmit
pnpm test -- src/entities/permissions/listeners
```

## Estimated Time

25-35 minutes

## Notes

- Follows event bridge pattern: events are signals, listeners validate and update stores
- Zod validation at IPC boundary for permission requests
- Automatic cleanup on agent completion/error prevents orphaned requests

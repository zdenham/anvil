# Sub-Plan 03: Agent-Side Permission Handler

## Scope

Implement the Node.js agent-side permission handling logic, including stdin listener and permission request/response flow.

## Dependencies

- **01-core-types.md** - Requires `PermissionMode`, `isWriteTool` types

## Files to Create

### `agents/src/permissions/permission-handler.ts` (~80 lines)

```typescript
import { emitEvent } from "../runners/shared.js";
import { logger } from "../lib/logger.js";
import { randomUUID } from "crypto";
import { createInterface } from "readline";
import type { PermissionMode } from "@core/types/permissions.js";
import { isWriteTool } from "@core/types/permissions.js";

// Map of pending permission requests awaiting responses
const pendingRequests = new Map<string, {
  resolve: (decision: "approve" | "deny") => void;
  reason?: string;
}>();

// Readline interface for stdin (initialized once)
let stdinReader: ReturnType<typeof createInterface> | null = null;

/**
 * Initialize stdin listener for permission responses.
 * Call once at agent startup.
 */
export function initPermissionHandler(): void {
  if (stdinReader) return;

  stdinReader = createInterface({
    input: process.stdin,
    terminal: false,
  });

  stdinReader.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.type === "permission:response" && msg.requestId) {
        const pending = pendingRequests.get(msg.requestId);
        if (pending) {
          pending.reason = msg.reason;
          pending.resolve(msg.decision);
          pendingRequests.delete(msg.requestId);
        }
      }
    } catch {
      // Ignore non-JSON lines
    }
  });
}

/**
 * Check if permission is required for a tool.
 */
export function shouldRequestPermission(
  toolName: string,
  mode: PermissionMode
): boolean {
  if (mode === "allow-all") return false;
  if (mode === "ask-always") return true;
  if (mode === "ask-writes") return isWriteTool(toolName);
  return false;
}

/**
 * Request permission for a tool and wait for response.
 * Emits event and blocks until frontend responds via stdin.
 */
export async function requestPermission(
  threadId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ decision: "approve" | "deny"; reason?: string }> {
  const requestId = randomUUID();

  // Emit request event
  emitEvent("permission:request", {
    requestId,
    threadId,
    toolName,
    toolInput,
    timestamp: Date.now(),
  });

  logger.debug(`[permission] Awaiting response for ${toolName} (${requestId})`);

  // Wait for response via stdin
  return new Promise((resolve) => {
    pendingRequests.set(requestId, {
      resolve: (decision) => resolve({ decision, reason: pendingRequests.get(requestId)?.reason }),
    });

    // Timeout after 5 minutes (user may be away)
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        resolve({ decision: "deny" }); // Default to deny on timeout
      }
    }, 5 * 60 * 1000);
  });
}

/**
 * Cleanup permission handler on shutdown.
 */
export function cleanupPermissionHandler(): void {
  stdinReader?.close();
  stdinReader = null;
  pendingRequests.clear();
}
```

### `agents/src/permissions/index.ts`

```typescript
export {
  initPermissionHandler,
  shouldRequestPermission,
  requestPermission,
  cleanupPermissionHandler,
} from "./permission-handler.js";
```

### `agents/src/permissions/permission-handler.test.ts`

Include tests from main plan's "Test 6: Agent Permission Handler" section.

## Files to Modify

### `agents/src/runners/types.ts`

Add to agent context type:
```typescript
permissionMode?: PermissionMode;
```

### `agents/src/runners/shared.ts`

Add canUseTool callback integration:
```typescript
import {
  initPermissionHandler,
  shouldRequestPermission,
  requestPermission,
  cleanupPermissionHandler,
} from "../permissions/permission-handler.js";

// In agent initialization:
initPermissionHandler();

// Add to runAgentLoop options based on config
const permissionMode = context.permissionMode ?? "allow-all";

const canUseTool = permissionMode === "allow-all"
  ? undefined
  : async (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
      if (!shouldRequestPermission(toolName, permissionMode)) {
        return true;
      }
      const response = await requestPermission(context.threadId, toolName, input);
      return response.decision === "approve";
    };
```

## Verification

```bash
pnpm --filter agents typecheck
pnpm --filter agents test -- permission
```

## Estimated Time

45-60 minutes

## Notes

- Uses Node.js readline for stdin parsing
- 5-minute timeout prevents indefinite blocking
- Permission requests are tracked in a Map for concurrent request support
- Business logic lives in agent process per project architecture guidelines

### Approach Selection: canUseTool vs PreToolUse Hook

**Recommended: Use `canUseTool` callback**

| Approach | Use When | Pros | Cons |
|----------|----------|------|------|
| `canUseTool` callback | Simple approve/deny decisions | Cleaner API, direct boolean return | Less flexible for modification |
| `PreToolUse` hook | Need to modify tool input or add custom logic | Can modify inputs, more control | More complex setup |

For this permission UI implementation, use `canUseTool` because:
1. We only need approve/deny decisions (boolean return)
2. We don't modify tool inputs
3. Simpler integration with the Claude SDK

The `PreToolUse` hook approach (Option B in the code) is shown for reference but should only be used if future requirements need input modification capabilities.

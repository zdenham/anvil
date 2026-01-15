# Permission UI Implementation Plan

## Consolidated From

This plan consolidates:
- `plans/ui-elements/permission-dialogs.md` (modal dialog approach)
- `plans/ui-elements/permission-prompts.md` (inline prompt approach)

The key insight is that modal vs inline display is a **configuration option**, not separate implementations. The underlying store, service, event handling, and agent integration are identical.

---

## Overview

Permission UI allows users to approve or deny tool uses when Claude requests permission. This follows the Claude Code SDK's `canUseTool` callback pattern, with communication via the event bridge system.

**Goal:** When an agent requests permission to use a tool (e.g., Bash, Edit), show a permission UI to the user with tool details and allow them to approve or deny.

**Display Modes:**
- `modal`: Centered dialog with backdrop (interrupts workflow)
- `inline`: Embedded in thread view (non-blocking, vim-style navigation)

> **Note:** "Persistent preference" feature (allow-always, deny-always) is deferred to a future iteration per YAGNI. Build the basic approve/deny flow first.

## Design Rationale

Permission state is **ephemeral** and does not need disk persistence:
- Permission requests only exist while an agent is actively running
- When the agent terminates (complete/error), pending permissions are no longer meaningful
- The frontend store acts as the source of truth during the agent's lifetime
- Events are signals that trigger state changes, not data carriers (per Event Bridge pattern)

This differs from Tasks/Threads which persist across sessions. Permissions are transient UI state.

---

## Architecture

### Event Flow

```
Agent Process (Node)                          Tauri Frontend
────────────────────────────────────────────────────────────────────────────
1. canUseTool callback fires (or PreToolUse hook)
   └─> emitEvent("permission:request", {...})
                                             → eventBus receives event
                                             → permissionListeners.ts handles
                                             → permissionStore updates
                                             → PermissionUI renders (modal or inline)

2. User clicks Approve/Deny (or presses y/n/Enter/Escape)
   └─ permissionService.respond()
      └─> IPC call to agent stdin           ← invoke("send_agent_stdin", {...})

3. Agent stdin receives JSON response
   └─> canUseTool Promise resolves
   └─> Tool execution proceeds or stops
```

### Key Insight: stdin Communication

The existing agent-service.ts uses Tauri's shell plugin to spawn Node processes. For permission responses, we need **bidirectional communication**:
- **stdout**: Agent → Frontend (already works via event bridge)
- **stdin**: Frontend → Agent (NEW - for permission responses)

We'll use Tauri's `Child.write()` method to send JSON messages to the agent's stdin.

---

## File Structure

### New Files

```
src/entities/permissions/
  types.ts                       # Type definitions (~50 lines)
  store.ts                       # Zustand store (~120 lines)
  service.ts                     # Send response to agent (~60 lines)
  listeners.ts                   # Event subscriptions (~40 lines)
  index.ts                       # Exports

src/components/permission/
  permission-ui.tsx              # Main component (delegates to mode) (~80 lines)
  permission-modal.tsx           # Modal display mode (~100 lines)
  permission-inline.tsx          # Inline display mode (~120 lines)
  permission-input-display.tsx   # Formats tool input for display (~60 lines)
  use-permission-keyboard.ts     # Keyboard shortcut hook (~80 lines)
  index.ts                       # Exports

agents/src/permissions/
  permission-handler.ts          # Agent-side permission logic (~80 lines)
```

### Modified Files

```
core/types/events.ts                          # Add PERMISSION_REQUEST/RESPONSE events
core/types/permissions.ts                     # Shared permission types (new file)
agents/src/runners/shared.ts                  # Add canUseTool/PreToolUse hook
agents/src/runners/types.ts                   # Add permission types to context
src/lib/event-bridge.ts                       # Add permission events to broadcast list
src/lib/agent-service.ts                      # Track Child processes for stdin writes
src/components/simple-task/simple-task-window.tsx  # Integrate PermissionUI
src/components/thread/thread-view.tsx         # Integrate inline permissions
src/entities/index.ts                         # Setup permission listeners
src/entities/settings/types.ts                # Add permissionMode and displayMode
```

---

## Implementation Steps

### Phase 1: Core Types and Events

#### Step 1.1: Create Shared Permission Types (`core/types/permissions.ts`)

> **Zod at Boundaries:** Permission requests arrive via IPC from the agent process, so Zod validation is appropriate here.

```typescript
import { z } from "zod";

// Permission mode - when to prompt
export const PermissionModeSchema = z.enum([
  "ask-always",    // Ask for every tool
  "ask-writes",    // Ask for file/git writes only
  "allow-all",     // No prompts (bypass)
]);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

// Display mode - how to show the prompt
export const PermissionDisplayModeSchema = z.enum([
  "modal",         // Centered dialog with backdrop
  "inline",        // Embedded in thread view
]);
export type PermissionDisplayMode = z.infer<typeof PermissionDisplayModeSchema>;

// Schema for validating permission requests from agent IPC (trust boundary)
export const PermissionRequestSchema = z.object({
  requestId: z.string(),
  threadId: z.string(),
  toolName: z.string(),
  toolInput: z.record(z.unknown()),
  timestamp: z.number(),
});

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

// Plain TypeScript types for internal use (no validation needed)
export type PermissionDecision = "approve" | "deny";

export type PermissionStatus = "pending" | "approved" | "denied";

export interface PermissionResponse {
  requestId: string;
  threadId: string;
  decision: PermissionDecision;
  reason?: string;
}

// Tools that modify files or git state (show warning styling)
export const DANGEROUS_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit"] as const;

export function isDangerousTool(toolName: string): boolean {
  return (DANGEROUS_TOOLS as readonly string[]).includes(toolName);
}

// Alias for backward compatibility
export const WRITE_TOOLS = DANGEROUS_TOOLS;

export function isWriteTool(toolName: string): boolean {
  return isDangerousTool(toolName);
}
```

#### Step 1.2: Add Event Types (`core/types/events.ts`)

Add to `EventName` object:
```typescript
// Permission flow
PERMISSION_REQUEST: "permission:request",
PERMISSION_RESPONSE: "permission:response",
```

Add to `EventPayloads` interface:
```typescript
[EventName.PERMISSION_REQUEST]: {
  requestId: string;
  threadId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
};

[EventName.PERMISSION_RESPONSE]: {
  requestId: string;
  threadId: string;
  decision: "approve" | "deny";
  reason?: string;
};
```

Add to `EventNameSchema` enum array.

### Phase 2: Zustand Store

#### Step 2.1: Create Permission Store (`src/entities/permissions/store.ts`)

> **Entity Stores Pattern:** Follow the single-copy-per-entity rule. Permission requests are keyed by `requestId`. Store exposes `_apply*` methods for optimistic updates with rollback capability.

```typescript
import { create } from "zustand";
import type { PermissionRequest, PermissionStatus, PermissionDisplayMode } from "@core/types/permissions.js";

interface PermissionStoreState {
  // Pending requests keyed by requestId
  requests: Record<string, PermissionRequest & { status: PermissionStatus }>;

  // Currently focused request index (for keyboard navigation in inline mode)
  focusedIndex: number;

  // Display mode preference
  displayMode: PermissionDisplayMode;
}

type Rollback = () => void;

interface PermissionStoreActions {
  // Add a new pending request (returns rollback function per entity-stores pattern)
  _applyAddRequest: (request: PermissionRequest) => Rollback;

  // Update request status
  _applyUpdateStatus: (requestId: string, status: PermissionStatus) => Rollback;

  // Remove a request (after response sent)
  _applyRemoveRequest: (requestId: string) => Rollback;

  // Clear all requests for a thread (on agent complete/error)
  _applyClearThread: (threadId: string) => void;

  // Display mode
  setDisplayMode: (mode: PermissionDisplayMode) => void;

  // Focus management (for inline mode keyboard nav)
  setFocusedIndex: (index: number) => void;
  focusNext: () => void;
  focusPrev: () => void;

  // Selectors
  getPendingRequests: () => (PermissionRequest & { status: PermissionStatus })[];
  getRequestsByThread: (threadId: string) => (PermissionRequest & { status: PermissionStatus })[];
  getNextRequestForThread: (threadId: string) => (PermissionRequest & { status: PermissionStatus }) | undefined;
  getFocusedRequest: () => (PermissionRequest & { status: PermissionStatus }) | undefined;
}

export const usePermissionStore = create<PermissionStoreState & PermissionStoreActions>(
  (set, get) => ({
    requests: {},
    focusedIndex: 0,
    displayMode: "modal",

    _applyAddRequest: (request) => {
      const prevState = get();
      set((state) => ({
        requests: {
          ...state.requests,
          [request.requestId]: { ...request, status: "pending" as PermissionStatus },
        },
      }));
      return () => set({ requests: prevState.requests });
    },

    _applyUpdateStatus: (requestId, status) => {
      const prevState = get();
      const request = prevState.requests[requestId];
      if (!request) return () => {};
      set((state) => ({
        requests: {
          ...state.requests,
          [requestId]: { ...request, status },
        },
      }));
      return () => set({ requests: prevState.requests });
    },

    _applyRemoveRequest: (requestId) => {
      const prevState = get();
      const removedRequest = prevState.requests[requestId];
      set((state) => {
        const { [requestId]: _, ...rest } = state.requests;
        // Move focus to next request if current was removed
        const pending = Object.values(rest).filter((r) => r.status === "pending");
        const nextFocusedIndex = Math.min(state.focusedIndex, Math.max(0, pending.length - 1));
        return { requests: rest, focusedIndex: nextFocusedIndex };
      });
      return () => {
        if (removedRequest) {
          set((state) => ({
            requests: { ...state.requests, [requestId]: removedRequest },
            focusedIndex: prevState.focusedIndex,
          }));
        }
      };
    },

    _applyClearThread: (threadId) => {
      set((state) => {
        const remaining: typeof state.requests = {};
        for (const [id, req] of Object.entries(state.requests)) {
          if (req.threadId !== threadId) {
            remaining[id] = req;
          }
        }
        const pending = Object.values(remaining).filter((r) => r.status === "pending");
        return {
          requests: remaining,
          focusedIndex: Math.min(state.focusedIndex, Math.max(0, pending.length - 1)),
        };
      });
    },

    setDisplayMode: (mode) => set({ displayMode: mode }),

    setFocusedIndex: (index) => set({ focusedIndex: index }),

    focusNext: () => {
      const pending = get().getPendingRequests();
      if (pending.length === 0) return;
      set((state) => ({
        focusedIndex: Math.min(state.focusedIndex + 1, pending.length - 1),
      }));
    },

    focusPrev: () => {
      set((state) => ({
        focusedIndex: Math.max(state.focusedIndex - 1, 0),
      }));
    },

    getPendingRequests: () =>
      Object.values(get().requests)
        .filter((r) => r.status === "pending")
        .sort((a, b) => a.timestamp - b.timestamp),

    getRequestsByThread: (threadId) =>
      Object.values(get().requests)
        .filter((r) => r.threadId === threadId)
        .sort((a, b) => a.timestamp - b.timestamp),

    getNextRequestForThread: (threadId) => {
      const requests = get().getRequestsByThread(threadId);
      return requests.find((r) => r.status === "pending");
    },

    getFocusedRequest: () => {
      const pending = get().getPendingRequests();
      return pending[get().focusedIndex];
    },
  })
);
```

### Phase 3: Agent Integration

> **Agent Process Architecture:** Per docs/agents.md, prefer putting business logic in the Node agent process. The Tauri UI should be event-driven, reacting to agent events rather than orchestrating.

#### Step 3.1: Create Permission Handler (`agents/src/permissions/permission-handler.ts`)

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

#### Step 3.2: Modify Agent Service (`src/lib/agent-service.ts`)

Track Child processes by threadId for stdin communication:

```typescript
// Near top of file, after activeSimpleProcesses
const agentProcesses = new Map<string, Child>();

// In spawnAgentWithOrchestration, after spawn():
const child = await command.spawn();
agentProcesses.set(options.threadId, child);

// In command.on("close"), before the callback:
agentProcesses.delete(options.threadId);

// Add new exported function:
export async function sendPermissionResponse(
  threadId: string,
  requestId: string,
  decision: "approve" | "deny",
  reason?: string
): Promise<void> {
  const process = agentProcesses.get(threadId);
  if (!process) {
    logger.warn(`[agent-service] No process found for threadId: ${threadId}`);
    return;
  }

  const message = JSON.stringify({
    type: "permission:response",
    requestId,
    decision,
    reason,
  }) + "\n";

  await process.write(message);
  logger.info(`[agent-service] Sent permission response:`, { requestId, decision });
}
```

Similar changes for `spawnSimpleAgent` and `resumeSimpleAgent`.

#### Step 3.3: Modify Agent Runner (`agents/src/runners/shared.ts`)

Add canUseTool callback or PreToolUse hook:

```typescript
// Add to imports
import {
  initPermissionHandler,
  shouldRequestPermission,
  requestPermission,
  cleanupPermissionHandler,
} from "../permissions/permission-handler.js";

// Add to runAgentLoop options based on config
const permissionMode = context.permissionMode ?? "allow-all";

// Option A: Using canUseTool callback
const canUseTool = permissionMode === "allow-all"
  ? undefined
  : async (toolName: string, input: Record<string, unknown>): Promise<boolean> => {
      if (!shouldRequestPermission(toolName, permissionMode)) {
        return true;
      }
      const response = await requestPermission(context.threadId, toolName, input);
      return response.decision === "approve";
    };

// Option B: Using PreToolUse hook (alternative approach)
const hooks = {
  PreToolUse: [{
    hooks: [
      async (hookInput: unknown) => {
        const input = hookInput as PreToolUseHookInput;
        if (!shouldRequestPermission(input.tool_name, permissionMode)) {
          return { decision: "approve" };
        }
        const response = await requestPermission(
          context.threadId,
          input.tool_name,
          input.tool_input as Record<string, unknown>
        );
        if (response.decision === "deny") {
          return { decision: "block", reason: response.reason ?? "User denied tool execution" };
        }
        return { decision: "approve" };
      },
    ],
  }],
};
```

### Phase 4: Event Listeners

> **Event Bridge Pattern:** Events are signals, not data carriers. The listener validates the incoming event payload (Zod at boundaries) and updates the store.

#### Step 4.1: Create Permission Listeners (`src/entities/permissions/listeners.ts`)

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
}
```

#### Step 4.2: Register Listeners (`src/entities/index.ts`)

```typescript
import { setupPermissionListeners } from "./permissions/listeners.js";

export function setupEntityListeners(): void {
  // ... existing listeners
  setupPermissionListeners();
}
```

#### Step 4.3: Update Event Bridge (`src/lib/event-bridge.ts`)

Add to `BROADCAST_EVENTS`:
```typescript
EventName.PERMISSION_REQUEST,
EventName.PERMISSION_RESPONSE,
```

### Phase 5: Permission Service

> **Service as Store Writer:** Per entity-stores pattern, only services write to stores. The service handles the respond flow: send to agent, then update store.

#### Step 5.1: Create Permission Service (`src/entities/permissions/service.ts`)

```typescript
import { sendPermissionResponse } from "@/lib/agent-service";
import { usePermissionStore } from "./store";
import { eventBus } from "../events";
import { EventName } from "@core/types/events.js";
import { logger } from "@/lib/logger-client";
import type { PermissionDecision, PermissionRequest, PermissionStatus } from "@core/types/permissions.js";

export const permissionService = {
  /**
   * Respond to a permission request.
   * Sends response to agent and updates store.
   */
  async respond(
    request: PermissionRequest,
    decision: PermissionDecision,
    reason?: string
  ): Promise<void> {
    logger.info(`[permissionService] Responding to ${request.requestId}:`, decision);

    const status: PermissionStatus = decision === "approve" ? "approved" : "denied";

    // Optimistically update status
    const rollback = usePermissionStore.getState()._applyUpdateStatus(request.requestId, status);

    try {
      // Send to agent via stdin
      await sendPermissionResponse(request.threadId, request.requestId, decision, reason);

      // Emit event for logging/debugging
      eventBus.emit(EventName.PERMISSION_RESPONSE, {
        requestId: request.requestId,
        threadId: request.threadId,
        decision,
        reason,
      });
    } catch (error) {
      logger.error("[permissionService] Failed to send response:", error);
      rollback(); // Rollback on failure
      throw error;
    }
  },

  /**
   * Approve all pending requests for a thread.
   */
  async approveAll(threadId: string): Promise<void> {
    const requests = usePermissionStore.getState()
      .getRequestsByThread(threadId)
      .filter((r) => r.status === "pending");

    for (const request of requests) {
      await this.respond(request, "approve");
    }
  },

  /**
   * Get the current pending request for a thread.
   */
  getPendingRequest(threadId: string): (PermissionRequest & { status: PermissionStatus }) | undefined {
    return usePermissionStore.getState().getNextRequestForThread(threadId);
  },
};
```

### Phase 6: UI Components

> **React Rules (docs/agents.md):** Separate logic into pure functions. Avoid unnecessary useEffects for deriving state. The keyboard hook is a legitimate useEffect for event subscription.

#### Step 6.1: Create Keyboard Hook (`src/components/permission/use-permission-keyboard.ts`)

Unified keyboard handling supporting both display modes:

```typescript
import { useEffect, useCallback } from "react";
import { usePermissionStore } from "@/entities/permissions";
import { permissionService } from "@/entities/permissions/service";
import type { PermissionDecision, PermissionRequest, PermissionStatus } from "@core/types/permissions.js";

interface UsePermissionKeyboardOptions {
  threadId: string;
  enabled?: boolean;
}

/**
 * Keyboard shortcuts for permission prompts.
 *
 * Modal mode:
 * | Key    | Action |
 * |--------|--------|
 * | Enter  | Approve focused permission |
 * | Escape | Deny focused permission |
 *
 * Inline mode:
 * | Key   | Action |
 * |-------|--------|
 * | y     | Approve focused permission |
 * | n     | Deny focused permission |
 * | a     | Approve all pending |
 * | j/↓   | Focus next |
 * | k/↑   | Focus previous |
 */
export function usePermissionKeyboard({
  threadId,
  enabled = true,
}: UsePermissionKeyboardOptions): void {
  const handleRespond = useCallback(
    async (request: PermissionRequest & { status: PermissionStatus }, decision: PermissionDecision) => {
      if (request.status !== "pending") return;
      await permissionService.respond(request, decision);
    },
    []
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      const target = event.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const store = usePermissionStore.getState();
      const displayMode = store.displayMode;
      const pending = store.getPendingRequests();
      const focused = store.getFocusedRequest();

      if (pending.length === 0) return;

      // Modal mode shortcuts
      if (displayMode === "modal") {
        switch (event.key) {
          case "Enter":
            event.preventDefault();
            if (focused) handleRespond(focused, "approve");
            break;
          case "Escape":
            event.preventDefault();
            if (focused) handleRespond(focused, "deny");
            break;
        }
        return;
      }

      // Inline mode shortcuts (vim-style)
      switch (event.key) {
        case "y":
          event.preventDefault();
          if (focused) handleRespond(focused, "approve");
          break;
        case "n":
          event.preventDefault();
          if (focused) handleRespond(focused, "deny");
          break;
        case "a":
          event.preventDefault();
          permissionService.approveAll(threadId);
          break;
        case "j":
        case "ArrowDown":
          event.preventDefault();
          store.focusNext();
          break;
        case "k":
        case "ArrowUp":
          event.preventDefault();
          store.focusPrev();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, threadId, handleRespond]);
}
```

#### Step 6.2: Create Input Display Component (`src/components/permission/permission-input-display.tsx`)

```typescript
import { useMemo } from "react";

interface PermissionInputDisplayProps {
  toolName: string;
  toolInput: Record<string, unknown>;
}

interface FormattedInput {
  primary: string;
  secondary?: string;
  type: "command" | "path" | "json";
}

/**
 * Formats tool input for human-readable display.
 * Handles common tool patterns (Bash commands, file paths, etc.)
 */
export function PermissionInputDisplay({ toolName, toolInput }: PermissionInputDisplayProps) {
  const formatted = useMemo((): FormattedInput => {
    // Bash: show command
    if (toolName === "Bash" && typeof toolInput.command === "string") {
      return { primary: toolInput.command, type: "command" };
    }

    // File operations: show path
    if (typeof toolInput.file_path === "string") {
      return { primary: toolInput.file_path, type: "path" };
    }

    // Default: show JSON
    return { primary: JSON.stringify(toolInput, null, 2), type: "json" };
  }, [toolName, toolInput]);

  return (
    <div className="mt-2 rounded bg-surface-800 p-3 font-mono text-sm overflow-x-auto">
      {formatted.type === "command" && (
        <div className="text-amber-400">$ {formatted.primary}</div>
      )}
      {formatted.type === "path" && (
        <div className="text-blue-400">{formatted.primary}</div>
      )}
      {formatted.type === "json" && (
        <pre className="whitespace-pre-wrap text-surface-300">
          {formatted.primary}
        </pre>
      )}
      {formatted.secondary && (
        <div className="text-surface-400 mt-1">{formatted.secondary}</div>
      )}
    </div>
  );
}
```

#### Step 6.3: Create Modal Component (`src/components/permission/permission-modal.tsx`)

```typescript
import { useCallback } from "react";
import { AlertTriangle, Check, X } from "lucide-react";
import { usePermissionStore } from "@/entities/permissions/store";
import { permissionService } from "@/entities/permissions/service";
import { isDangerousTool, type PermissionDecision } from "@core/types/permissions.js";
import { PermissionInputDisplay } from "./permission-input-display";

interface PermissionModalProps {
  threadId: string;
}

export function PermissionModal({ threadId }: PermissionModalProps) {
  const request = usePermissionStore((state) =>
    state.getNextRequestForThread(threadId)
  );

  const handleRespond = useCallback(
    async (decision: PermissionDecision) => {
      if (!request || request.status !== "pending") return;
      await permissionService.respond(request, decision);
    },
    [request]
  );

  if (!request || request.status !== "pending") return null;

  const isDangerous = isDangerousTool(request.toolName);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Dialog */}
      <div
        className={`relative bg-surface-800 rounded-lg border shadow-xl w-full max-w-lg mx-4 ${
          isDangerous ? "border-amber-500/50" : "border-surface-700"
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="permission-dialog-title"
      >
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            {isDangerous && (
              <AlertTriangle className="text-amber-500 flex-shrink-0" size={24} />
            )}
            <h2
              id="permission-dialog-title"
              className="text-lg font-semibold text-surface-100"
            >
              Allow {request.toolName}?
            </h2>
          </div>

          {/* Tool input preview */}
          <PermissionInputDisplay
            toolName={request.toolName}
            toolInput={request.toolInput}
          />

          {/* Action buttons */}
          <div className="flex justify-end gap-3 mt-6">
            <button
              onClick={() => handleRespond("deny")}
              className="px-4 py-2 text-sm text-surface-300 hover:text-surface-100
                         border border-surface-600 rounded-lg hover:border-surface-500
                         flex items-center gap-2"
            >
              <X size={16} />
              Deny
              <kbd className="ml-1 px-1.5 py-0.5 bg-surface-700 rounded text-xs">Esc</kbd>
            </button>
            <button
              onClick={() => handleRespond("approve")}
              className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700
                         text-white rounded-lg flex items-center gap-2"
            >
              <Check size={16} />
              Approve
              <kbd className="ml-1 px-1.5 py-0.5 bg-green-800 rounded text-xs">Enter</kbd>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

#### Step 6.4: Create Inline Component (`src/components/permission/permission-inline.tsx`)

```typescript
import { useState, useCallback } from "react";
import { Shield, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { permissionService } from "@/entities/permissions/service";
import { isDangerousTool, type PermissionRequest, type PermissionStatus } from "@core/types/permissions.js";
import { PermissionInputDisplay } from "./permission-input-display";

interface PermissionInlineProps {
  request: PermissionRequest & { status: PermissionStatus };
  isFocused: boolean;
}

export function PermissionInline({ request, isFocused }: PermissionInlineProps) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const handleApprove = useCallback(async () => {
    if (request.status !== "pending") return;
    await permissionService.respond(request, "approve");
  }, [request]);

  const handleReject = useCallback(async () => {
    if (request.status !== "pending") return;
    if (showRejectInput) {
      await permissionService.respond(request, "deny", rejectReason || undefined);
    } else {
      setShowRejectInput(true);
    }
  }, [request, showRejectInput, rejectReason]);

  const isDangerous = isDangerousTool(request.toolName);

  const statusStyles = {
    pending: "border-amber-500/50 bg-amber-950/20",
    approved: "border-green-500/50 bg-green-950/20",
    denied: "border-red-500/50 bg-red-950/20",
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-4",
        statusStyles[request.status],
        isFocused && "ring-2 ring-accent-400"
      )}
      role="dialog"
      aria-label={`Permission request for ${request.toolName}`}
      data-testid={`permission-prompt-${request.requestId}`}
      data-status={request.status}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Shield className="h-5 w-5 text-amber-400" aria-hidden="true" />
        <span className="font-medium text-surface-200">
          Permission Required
        </span>
        {isDangerous && (
          <span className="text-xs text-amber-400 bg-amber-500/20 px-1.5 py-0.5 rounded">
            Writes
          </span>
        )}
      </div>

      {/* Tool info */}
      <div className="mb-4">
        <div className="text-sm text-surface-300 mb-1">
          Tool: <span className="font-mono text-surface-100">{request.toolName}</span>
        </div>
        <PermissionInputDisplay
          toolName={request.toolName}
          toolInput={request.toolInput}
        />
      </div>

      {/* Actions */}
      {request.status === "pending" && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded",
              "bg-green-600 hover:bg-green-500 text-white text-sm font-medium",
              "transition-colors"
            )}
            aria-label="Approve (y)"
          >
            <Check className="h-4 w-4" />
            Approve
            <kbd className="ml-1 text-xs opacity-70">y</kbd>
          </button>

          <button
            onClick={handleReject}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded",
              "bg-red-600 hover:bg-red-500 text-white text-sm font-medium",
              "transition-colors"
            )}
            aria-label="Reject (n)"
          >
            <X className="h-4 w-4" />
            Reject
            <kbd className="ml-1 text-xs opacity-70">n</kbd>
          </button>

          {showRejectInput && (
            <input
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason (optional)"
              className="flex-1 px-2 py-1.5 bg-surface-800 rounded text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  permissionService.respond(request, "deny", rejectReason || undefined);
                }
                if (e.key === "Escape") {
                  setShowRejectInput(false);
                  setRejectReason("");
                }
              }}
              autoFocus
            />
          )}
        </div>
      )}

      {/* Status badges */}
      {request.status === "approved" && (
        <div className="flex items-center gap-2 text-green-400 text-sm">
          <Check className="h-4 w-4" />
          <span>Approved</span>
        </div>
      )}

      {request.status === "denied" && (
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <X className="h-4 w-4" />
          <span>Denied</span>
        </div>
      )}
    </div>
  );
}
```

#### Step 6.5: Create Main Permission UI Component (`src/components/permission/permission-ui.tsx`)

```typescript
import { usePermissionStore } from "@/entities/permissions/store";
import { usePermissionKeyboard } from "./use-permission-keyboard";
import { PermissionModal } from "./permission-modal";
import { PermissionInline } from "./permission-inline";

interface PermissionUIProps {
  threadId: string;
}

/**
 * Main permission UI component.
 * Delegates to modal or inline based on display mode setting.
 */
export function PermissionUI({ threadId }: PermissionUIProps) {
  const displayMode = usePermissionStore((state) => state.displayMode);
  const requests = usePermissionStore((state) => state.getRequestsByThread(threadId));
  const focusedIndex = usePermissionStore((state) => state.focusedIndex);

  // Enable keyboard handling when there are pending requests
  usePermissionKeyboard({
    threadId,
    enabled: requests.some((r) => r.status === "pending"),
  });

  if (requests.length === 0) return null;

  if (displayMode === "modal") {
    return <PermissionModal threadId={threadId} />;
  }

  // Inline mode: render all requests in thread
  return (
    <div className="space-y-3">
      {requests.map((request, index) => (
        <PermissionInline
          key={request.requestId}
          request={request}
          isFocused={index === focusedIndex}
        />
      ))}
    </div>
  );
}
```

#### Step 6.6: Create Index Export (`src/components/permission/index.ts`)

```typescript
export { PermissionUI } from "./permission-ui";
export { PermissionModal } from "./permission-modal";
export { PermissionInline } from "./permission-inline";
export { PermissionInputDisplay } from "./permission-input-display";
export { usePermissionKeyboard } from "./use-permission-keyboard";
```

### Phase 7: Integration

#### Step 7.1: Integrate into SimpleTaskWindow (`src/components/simple-task/simple-task-window.tsx`)

Add PermissionUI after ThreadView:

```typescript
import { PermissionUI } from "@/components/permission";

// In SimpleTaskWindowContent, after ThreadView:
<PermissionUI threadId={threadId} />
```

#### Step 7.2: Add Settings for Permission Mode

**File:** `src/entities/settings/types.ts`

```typescript
import type { PermissionMode, PermissionDisplayMode } from "@core/types/permissions.js";

export interface Settings {
  // ... existing fields
  permissionMode: PermissionMode;
  permissionDisplayMode: PermissionDisplayMode;
}
```

**File:** `src/entities/settings/store.ts`

```typescript
// In default settings
permissionMode: "allow-all" as PermissionMode,
permissionDisplayMode: "modal" as PermissionDisplayMode,
```

---

## Testing Plan

### Unit Tests

#### Test 1: Permission Store (`src/entities/permissions/store.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { usePermissionStore } from "./store";

describe("PermissionStore", () => {
  beforeEach(() => {
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });
  });

  describe("_applyAddRequest", () => {
    it("adds request with pending status", () => {
      const request = {
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: { command: "ls" },
        timestamp: Date.now(),
      };

      usePermissionStore.getState()._applyAddRequest(request);

      const stored = usePermissionStore.getState().requests["req-1"];
      expect(stored).toBeDefined();
      expect(stored.status).toBe("pending");
    });

    it("returns rollback function that restores previous state", () => {
      const request = { requestId: "req-1", threadId: "t1", toolName: "Bash", toolInput: {}, timestamp: 1 };
      const rollback = usePermissionStore.getState()._applyAddRequest(request);

      expect(usePermissionStore.getState().requests["req-1"]).toBeDefined();

      rollback();

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });
  });

  describe("_applyUpdateStatus", () => {
    it("updates existing request status", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      usePermissionStore.getState()._applyUpdateStatus("req-1", "approved");

      expect(usePermissionStore.getState().requests["req-1"].status).toBe("approved");
    });

    it("returns rollback function", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      const rollback = usePermissionStore.getState()._applyUpdateStatus("req-1", "denied");
      expect(usePermissionStore.getState().requests["req-1"].status).toBe("denied");

      rollback();
      expect(usePermissionStore.getState().requests["req-1"].status).toBe("pending");
    });
  });

  describe("_applyRemoveRequest", () => {
    it("removes request from map", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });

      usePermissionStore.getState()._applyRemoveRequest("req-1");

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
    });

    it("adjusts focus index when removing requests", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "t1",
        toolName: "Read",
        toolInput: {},
        timestamp: 2,
      });
      usePermissionStore.setState({ focusedIndex: 1 });

      usePermissionStore.getState()._applyRemoveRequest("req-2");

      expect(usePermissionStore.getState().focusedIndex).toBe(0);
    });
  });

  describe("getPendingRequests", () => {
    it("returns only pending requests sorted by timestamp", () => {
      const now = Date.now();
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "t1",
        toolName: "Write",
        toolInput: {},
        timestamp: now + 100,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "t1",
        toolName: "Edit",
        toolInput: {},
        timestamp: now,
      });
      usePermissionStore.getState()._applyUpdateStatus("req-2", "approved");

      const pending = usePermissionStore.getState().getPendingRequests();
      expect(pending).toHaveLength(1);
      expect(pending[0].requestId).toBe("req-1");
    });
  });

  describe("focus navigation", () => {
    it("focusNext increments within bounds", () => {
      for (let i = 0; i < 3; i++) {
        usePermissionStore.getState()._applyAddRequest({
          requestId: `req-${i}`,
          threadId: "t1",
          toolName: "Write",
          toolInput: {},
          timestamp: i,
        });
      }

      usePermissionStore.getState().focusNext();
      expect(usePermissionStore.getState().focusedIndex).toBe(1);

      usePermissionStore.getState().focusNext();
      usePermissionStore.getState().focusNext();
      expect(usePermissionStore.getState().focusedIndex).toBe(2); // Clamped
    });

    it("focusPrev decrements within bounds", () => {
      usePermissionStore.setState({ focusedIndex: 1 });
      usePermissionStore.getState().focusPrev();
      expect(usePermissionStore.getState().focusedIndex).toBe(0);

      usePermissionStore.getState().focusPrev();
      expect(usePermissionStore.getState().focusedIndex).toBe(0); // Clamped
    });
  });

  describe("_applyClearThread", () => {
    it("removes only requests for specified thread", () => {
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-1",
        threadId: "thread-1",
        toolName: "Bash",
        toolInput: {},
        timestamp: 1,
      });
      usePermissionStore.getState()._applyAddRequest({
        requestId: "req-2",
        threadId: "thread-2",
        toolName: "Read",
        toolInput: {},
        timestamp: 2,
      });

      usePermissionStore.getState()._applyClearThread("thread-1");

      expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
      expect(usePermissionStore.getState().requests["req-2"]).toBeDefined();
    });
  });
});
```

### UI Isolation Tests

#### Test 2: Permission Modal (`src/components/permission/permission-modal.ui.test.tsx`)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { usePermissionStore } from "@/entities/permissions/store";
import { PermissionModal } from "./permission-modal";

vi.mock("@/entities/permissions/service", () => ({
  permissionService: {
    respond: vi.fn(),
  },
}));

import { permissionService } from "@/entities/permissions/service";

describe("PermissionModal", () => {
  const threadId = "thread-123";

  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });
  });

  it("renders nothing when no pending request", () => {
    render(<PermissionModal threadId={threadId} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders dialog when request is pending", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Bash",
      toolInput: { command: "rm -rf /" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Allow Bash?")).toBeInTheDocument();
    expect(screen.getByText("$ rm -rf /")).toBeInTheDocument();
  });

  it("shows warning indicator for dangerous tools", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Bash",
      toolInput: { command: "echo hello" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);

    expect(screen.getByRole("dialog").parentElement?.querySelector(".border-amber-500\\/50")).toBeInTheDocument();
  });

  it("calls service.respond with approve on Approve click", async () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: { file_path: "/test.txt" },
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "approve"
      );
    });
  });

  it("calls service.respond with deny on Deny click", async () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId,
      toolName: "Read",
      toolInput: {},
      timestamp: Date.now(),
    });

    render(<PermissionModal threadId={threadId} />);
    fireEvent.click(screen.getByRole("button", { name: /deny/i }));

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-1" }),
        "deny"
      );
    });
  });
});
```

#### Test 3: Permission Inline (`src/components/permission/permission-inline.ui.test.tsx`)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test/helpers";
import { PermissionInline } from "./permission-inline";
import type { PermissionRequest, PermissionStatus } from "@core/types/permissions.js";

vi.mock("@/entities/permissions/service", () => ({
  permissionService: {
    respond: vi.fn(),
  },
}));

import { permissionService } from "@/entities/permissions/service";

describe("PermissionInline", () => {
  const createRequest = (
    overrides: Partial<PermissionRequest & { status: PermissionStatus }> = {}
  ): PermissionRequest & { status: PermissionStatus } => ({
    requestId: "req-123",
    threadId: "thread-456",
    toolName: "Write",
    toolInput: { file_path: "/test.txt", content: "hello" },
    timestamp: Date.now(),
    status: "pending",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders tool name and key parameters", () => {
    const request = createRequest();

    render(<PermissionInline request={request} isFocused={false} />);

    expect(screen.getByText("Permission Required")).toBeInTheDocument();
    expect(screen.getByText(/Write/i)).toBeInTheDocument();
    expect(screen.getByText(/test\.txt/)).toBeInTheDocument();
  });

  it("shows focus ring when focused", () => {
    const request = createRequest();

    const { container } = render(<PermissionInline request={request} isFocused={true} />);

    expect(container.firstChild).toHaveClass("ring-2");
  });

  it("calls service.respond on Approve click", async () => {
    const request = createRequest();

    render(<PermissionInline request={request} isFocused={false} />);
    fireEvent.click(screen.getByRole("button", { name: /approve/i }));

    await waitFor(() => {
      expect(permissionService.respond).toHaveBeenCalledWith(request, "approve");
    });
  });

  it("shows reason input on first reject click", () => {
    const request = createRequest();

    render(<PermissionInline request={request} isFocused={false} />);
    fireEvent.click(screen.getByRole("button", { name: /reject/i }));

    expect(screen.getByPlaceholderText(/reason/i)).toBeInTheDocument();
  });

  it("shows Approved badge for approved status", () => {
    const request = createRequest({ status: "approved" });

    render(<PermissionInline request={request} isFocused={false} />);

    expect(screen.getByText("Approved")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Denied badge for denied status", () => {
    const request = createRequest({ status: "denied" });

    render(<PermissionInline request={request} isFocused={false} />);

    expect(screen.getByText("Denied")).toBeInTheDocument();
  });

  it("has correct accessibility attributes", () => {
    const request = createRequest({ toolName: "Write" });

    render(<PermissionInline request={request} isFocused={false} />);

    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Permission request for Write"
    );
  });
});
```

### Integration Tests

#### Test 4: Event Flow (`src/entities/permissions/listeners.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventBus, EventName } from "@/entities/events";
import { usePermissionStore } from "./store";
import { setupPermissionListeners } from "./listeners";

vi.mock("@/lib/logger-client", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("Permission Listeners", () => {
  beforeEach(() => {
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "modal",
    });
    eventBus.all.clear();
    setupPermissionListeners();
  });

  it("adds request to store on PERMISSION_REQUEST event", () => {
    eventBus.emit(EventName.PERMISSION_REQUEST, {
      requestId: "req-1",
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: { command: "ls" },
      timestamp: Date.now(),
    });

    const request = usePermissionStore.getState().requests["req-1"];
    expect(request).toBeDefined();
    expect(request.toolName).toBe("Bash");
    expect(request.status).toBe("pending");
  });

  it("clears requests on AGENT_COMPLETED event", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: {},
      timestamp: Date.now(),
    });

    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId: "thread-1",
      exitCode: 0,
    });

    expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
  });

  it("clears requests on AGENT_ERROR event", () => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: "req-1",
      threadId: "thread-1",
      toolName: "Bash",
      toolInput: {},
      timestamp: Date.now(),
    });

    eventBus.emit(EventName.AGENT_ERROR, {
      threadId: "thread-1",
      error: "Connection lost",
    });

    expect(usePermissionStore.getState().requests["req-1"]).toBeUndefined();
  });
});
```

#### Test 5: Keyboard Hook (`src/components/permission/use-permission-keyboard.test.ts`)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePermissionKeyboard } from "./use-permission-keyboard";
import { usePermissionStore } from "@/entities/permissions";

vi.mock("@/entities/permissions/service", () => ({
  permissionService: {
    respond: vi.fn().mockResolvedValue(undefined),
    approveAll: vi.fn().mockResolvedValue(undefined),
  },
}));

import { permissionService } from "@/entities/permissions/service";

describe("usePermissionKeyboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePermissionStore.setState({
      requests: {},
      focusedIndex: 0,
      displayMode: "inline",
    });
  });

  const addTestRequest = (id: string, index: number) => {
    usePermissionStore.getState()._applyAddRequest({
      requestId: id,
      threadId: "thread-1",
      toolName: "Write",
      toolInput: { file_path: `/file${index}.txt` },
      timestamp: index,
    });
  };

  describe("inline mode (y/n/a keys)", () => {
    it("approves focused request on y key", async () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));

      await vi.waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "req-1" }),
          "approve"
        );
      });
    });

    it("denies focused request on n key", async () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "n" }));

      await vi.waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "req-1" }),
          "deny"
        );
      });
    });

    it("approves all on a key", async () => {
      addTestRequest("req-1", 0);
      addTestRequest("req-2", 1);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

      await vi.waitFor(() => {
        expect(permissionService.approveAll).toHaveBeenCalledWith("thread-1");
      });
    });

    it("navigates with j/k keys", () => {
      addTestRequest("req-1", 0);
      addTestRequest("req-2", 1);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "j" }));
      expect(usePermissionStore.getState().focusedIndex).toBe(1);

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
      expect(usePermissionStore.getState().focusedIndex).toBe(0);
    });
  });

  describe("modal mode (Enter/Escape keys)", () => {
    beforeEach(() => {
      usePermissionStore.setState({ displayMode: "modal" });
    });

    it("approves on Enter key", async () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

      await vi.waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "req-1" }),
          "approve"
        );
      });
    });

    it("denies on Escape key", async () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

      await vi.waitFor(() => {
        expect(permissionService.respond).toHaveBeenCalledWith(
          expect.objectContaining({ requestId: "req-1" }),
          "deny"
        );
      });
    });
  });

  describe("disabled state", () => {
    it("ignores keystrokes when disabled", () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: false }));

      window.dispatchEvent(new KeyboardEvent("keydown", { key: "y" }));

      expect(permissionService.respond).not.toHaveBeenCalled();
    });
  });

  describe("input focus handling", () => {
    it("ignores keystrokes when typing in input", () => {
      addTestRequest("req-1", 0);

      renderHook(() => usePermissionKeyboard({ threadId: "thread-1", enabled: true }));

      const input = document.createElement("input");
      document.body.appendChild(input);

      const event = new KeyboardEvent("keydown", { key: "y", bubbles: true });
      Object.defineProperty(event, "target", { value: input });
      window.dispatchEvent(event);

      expect(permissionService.respond).not.toHaveBeenCalled();

      document.body.removeChild(input);
    });
  });
});
```

#### Test 6: Agent Permission Handler (`agents/src/permissions/permission-handler.test.ts`)

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  shouldRequestPermission,
  cleanupPermissionHandler,
} from "./permission-handler";

vi.mock("../runners/shared.js", () => ({
  emitEvent: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Permission Handler", () => {
  afterEach(() => {
    cleanupPermissionHandler();
  });

  describe("shouldRequestPermission", () => {
    it('returns false for "allow-all" mode', () => {
      expect(shouldRequestPermission("Write", "allow-all")).toBe(false);
      expect(shouldRequestPermission("Read", "allow-all")).toBe(false);
    });

    it('returns true for all tools in "ask-always" mode', () => {
      expect(shouldRequestPermission("Write", "ask-always")).toBe(true);
      expect(shouldRequestPermission("Read", "ask-always")).toBe(true);
      expect(shouldRequestPermission("Glob", "ask-always")).toBe(true);
    });

    it('returns true only for write tools in "ask-writes" mode', () => {
      expect(shouldRequestPermission("Write", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Edit", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Bash", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("NotebookEdit", "ask-writes")).toBe(true);
      expect(shouldRequestPermission("Read", "ask-writes")).toBe(false);
      expect(shouldRequestPermission("Glob", "ask-writes")).toBe(false);
    });
  });
});
```

---

## Edge Cases and Error Handling

### Edge Cases to Test

1. **Agent terminates while permission pending**
   - Frontend handles orphaned requests gracefully
   - Cleanup on `agent:completed` and `agent:error` events

2. **Multiple rapid requests**
   - Store handles concurrent additions
   - Focus stays consistent

3. **Response fails to send**
   - Rollback status to pending on failure
   - Log error for debugging

4. **User navigates away from thread**
   - Requests persist across navigation
   - Re-render when returning to thread

5. **Rapid allow/deny clicks**
   - Prevent double-responding to same request

6. **Very long command inputs**
   - Scrollable display, no layout breaking

7. **Deeply nested JSON input**
   - Formatted JSON display with overflow handling

### Error Handling Checklist

- [ ] Agent stdin write failures logged and surface gracefully
- [ ] Store updates use rollback pattern for recovery
- [ ] Timeout for requests that never get a response (5 min)
- [ ] Graceful degradation if permissions store fails

---

## Test Execution Plan

### Run Order

1. **Type check first**
   ```bash
   pnpm tsc --noEmit
   pnpm --filter agents typecheck
   ```

2. **Run unit tests**
   ```bash
   pnpm test -- src/entities/permissions/
   ```

3. **Run UI tests**
   ```bash
   pnpm test:ui -- src/components/permission/
   ```

4. **Run agent tests**
   ```bash
   pnpm --filter agents test -- permission
   ```

5. **Manual E2E verification**
   - Start dev server: `pnpm tauri dev`
   - Create a simple task
   - Test modal mode: Enter to approve, Escape to deny
   - Test inline mode: y/n/a keys, j/k navigation
   - Verify dialog dismisses after response
   - Verify agent continues/stops appropriately

---

## Rollback Plan

If issues arise post-implementation:

1. **Quick disable**: Set `permissionMode: "allow-all"` as default
2. **Event removal**: Comment out permission events from `BROADCAST_EVENTS`
3. **Component removal**: Remove `<PermissionUI>` from SimpleTaskWindow

---

## Success Criteria

1. Permission UI appears when agent requests tool approval
2. Both modal and inline display modes work correctly
3. Approve/Deny buttons work correctly
4. Keyboard shortcuts work correctly for both modes
5. Agent execution continues on approve, stops on deny
6. UI automatically clears when agent completes or errors
7. Multiple pending requests queue correctly
8. All tests pass: unit, UI, and integration
9. No regressions to existing agent functionality

---

## File Checklist

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `core/types/permissions.ts` | ~50 | Shared permission types |
| `agents/src/permissions/permission-handler.ts` | ~80 | Agent-side permission logic |
| `src/entities/permissions/store.ts` | ~120 | Permission state management |
| `src/entities/permissions/service.ts` | ~60 | Permission response handling |
| `src/entities/permissions/listeners.ts` | ~40 | Event subscriptions |
| `src/entities/permissions/index.ts` | ~10 | Module exports |
| `src/components/permission/permission-ui.tsx` | ~40 | Main component (mode router) |
| `src/components/permission/permission-modal.tsx` | ~100 | Modal display mode |
| `src/components/permission/permission-inline.tsx` | ~120 | Inline display mode |
| `src/components/permission/permission-input-display.tsx` | ~60 | Tool input formatting |
| `src/components/permission/use-permission-keyboard.ts` | ~80 | Unified keyboard shortcuts |
| `src/components/permission/index.ts` | ~10 | Component exports |

### Modified Files

| File | Changes |
|------|---------|
| `core/types/events.ts` | Add permission event types |
| `agents/src/runners/shared.ts` | Add canUseTool/PreToolUse hook |
| `agents/src/runners/types.ts` | Add permissionMode to context |
| `src/entities/index.ts` | Register permission listeners |
| `src/lib/agent-service.ts` | Add sendPermissionResponse, track child processes |
| `src/lib/event-bridge.ts` | Add permission events to broadcast list |
| `src/components/simple-task/simple-task-window.tsx` | Integrate PermissionUI |
| `src/entities/settings/types.ts` | Add permissionMode and displayMode |
| `src/entities/settings/store.ts` | Add default values |

---

## Pattern Compliance Summary

| Pattern | Status | Notes |
|---------|--------|-------|
| **Adapters** | N/A | No cross-platform code sharing needed |
| **Disk as Truth** | N/A | Permission state is ephemeral (in-memory only) |
| **Event Bridge** | Compliant | Events as signals; listeners validate then update stores |
| **Entity Stores** | Compliant | Single store with `_apply*` methods returning rollback functions |
| **YAGNI** | Compliant | Persistent preferences deferred; only basic approve/deny |
| **Zod at Boundaries** | Compliant | Schema validation for IPC data; plain TS for internal use |
| **Type Layering** | Compliant | Shared types in `core/types/`, entity types in stores |
| **Testing** | Compliant | Unit, UI isolation, and integration tests included |
| **General Coding** | Compliant | Kebab-case files, files under 250 lines, early returns |
| **Single Responsibility** | Compliant | Store holds state, service handles actions, listeners handle events |
| **Agent Process Architecture** | Compliant | Permission logic in Node agent; Tauri UI is event-driven |
| **React Rules** | Compliant | Logic in pure functions; useEffect only for subscriptions |

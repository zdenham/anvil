# Sub-Plan 02: Permission Hook & Gate (Agent-Side I/O)

**Depends on:** `00-shared-contract.md`, `01-permission-evaluator.md`
**Parallel with:** `03-permission-ui.md` (no shared files)

This plan wires the evaluator into the actual SDK hook system and handles the async approval flow (emit request → wait → resolve).

## Phases

- [x] Implement `PermissionGate` class (wait/resolve mechanism)
- [x] Wire PreToolUse hook + mode change listener into `shared.ts`
- [x] Write integration tests for hook + gate

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Implement `PermissionGate`

Create `agents/src/lib/permission-gate.ts` (~70 lines).

This is the async bridge between the PreToolUse hook (which blocks the agent) and the frontend (which sends a response via hub socket).

### Class interface

```typescript
import { EventName } from "@core/types/events.js";

interface PendingRequest {
  resolve: (response: { approved: boolean; reason?: string } | "timeout") => void;
  threadId: string;
  toolName: string;
  createdAt: number;
}

export class PermissionGate {
  private pending = new Map<string, PendingRequest>();

  /**
   * Emit a permission request event and block until the frontend responds.
   * Returns the user's decision, or "timeout" if the abort signal fires.
   */
  async waitForResponse(
    requestId: string,
    context: {
      threadId: string;
      toolName: string;
      toolInput: unknown;
      reason: string;
      signal: AbortSignal;
    },
    emitEvent: (name: string, payload: unknown) => void,
  ): Promise<{ approved: boolean; reason?: string } | "timeout">;

  /**
   * Called when the frontend sends back a PERMISSION_RESPONSE via hub socket.
   * Resolves the waiting hook promise.
   */
  resolve(requestId: string, approved: boolean, reason?: string): void;

  /** Clean up all pending requests (e.g., on agent shutdown). */
  clear(): void;
}
```

### Implementation details

- `waitForResponse` creates a `Promise`, stores the resolver in `pending`, emits `PERMISSION_REQUEST`, and `await`s the promise.
- The `signal.addEventListener("abort", ...)` path resolves with `"timeout"` and cleans up.
- `resolve()` is called from the hub socket message handler when a `PERMISSION_RESPONSE` arrives.

## Phase 2: Wire into `shared.ts`

Modify `agents/src/runners/shared.ts` to:

### 2a. Accept permission config

Add to `AgentLoopOptions` (or whatever the options type is):

```typescript
permissionModeId?: PermissionModeId; // defaults to "plan"
```

### 2b. Construct evaluator + gate

Near the top of `runAgentLoop()`, after options are unpacked:

```typescript
import { PermissionEvaluator, GLOBAL_OVERRIDES } from "../lib/permission-evaluator.js";
import { PermissionGate } from "../lib/permission-gate.js";
import { BUILTIN_MODES } from "@core/types/permissions.js";

const permissionEvaluator = new PermissionEvaluator({
  mode: BUILTIN_MODES[options.permissionModeId ?? "plan"],
  overrides: GLOBAL_OVERRIDES,
  workingDirectory: options.workingDirectory,
});

const permissionGate = new PermissionGate();
```

### 2c. Add PreToolUse hook

Add a new hook matcher **before** the existing Task matcher (order matters):

```typescript
{
  matcher: undefined,  // matches ALL tools
  timeout: 3600,       // 1 hour
  hooks: [async (hookInput, toolUseId, { signal }) => {
    const input = hookInput as PreToolUseHookInput;
    const { decision, reason } = permissionEvaluator.evaluate(
      input.tool_name,
      input.tool_input,
    );

    if (decision === "allow") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "allow",
          permissionDecisionReason: reason,
        },
      };
    }

    if (decision === "deny") {
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      };
    }

    // decision === "ask" — block and wait for user
    const requestId = crypto.randomUUID();
    const response = await permissionGate.waitForResponse(
      requestId,
      { threadId, toolName: input.tool_name, toolInput: input.tool_input, reason, signal },
      emitEvent,
    );

    if (response === "timeout" || signal.aborted) {
      return { continue: false, stopReason: "Permission request timed out — agent stopped" };
    }

    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: response.approved ? "allow" : "deny",
        permissionDecisionReason: response.reason ?? (response.approved ? "User approved" : "User denied"),
      },
    };
  }],
}
```

### 2d. Handle PERMISSION_RESPONSE from hub socket

In the existing hub socket message handler (where queued messages are processed), add a case:

```typescript
if (msg.type === "permission_response") {
  permissionGate.resolve(msg.requestId, msg.decision === "approve", msg.reason);
}
```

### 2e. Handle PERMISSION_MODE_CHANGED from hub socket

```typescript
if (msg.type === "permission_mode_changed") {
  const newMode = BUILTIN_MODES[msg.modeId as PermissionModeId];
  if (newMode) {
    permissionEvaluator.setMode(newMode);
    // Notify agent via streamInput
    messageStream.enqueue({
      role: "user",
      content: `[System] Permission mode changed to "${newMode.name}". ${newMode.description}`,
    });
  }
}
```

### 2f. Clean up on agent exit

In the existing shutdown/cleanup logic:

```typescript
permissionGate.clear();
```

## Phase 3: Integration tests

Create `agents/src/lib/__tests__/permission-gate.test.ts`.

### Test cases

**Gate mechanics (unit-level, no SDK):**
- `waitForResponse` + `resolve(approved)` → promise resolves with `{ approved: true }`
- `waitForResponse` + `resolve(denied)` → promise resolves with `{ approved: false, reason }`
- `waitForResponse` + abort signal fires → promise resolves with `"timeout"`
- `resolve()` with unknown requestId → no-op, no error
- `clear()` → all pending requests resolve with "timeout"

**Event emission:**
- `waitForResponse` calls `emitEvent` with correct `PERMISSION_REQUEST` payload
- Payload includes `requestId`, `threadId`, `toolName`, `toolInput`

### Run verification

```bash
cd agents && pnpm test -- --run permission-gate
```

## Files

| File | Changes |
|------|---------|
| `agents/src/lib/permission-gate.ts` | **New** — ~70 lines |
| `agents/src/runners/shared.ts` | Add permission hook, gate wiring, mode change handler, cleanup |
| `agents/src/lib/__tests__/permission-gate.test.ts` | **New** — ~80 lines |

## Integration boundary with `03-permission-ui.md`

This plan emits `PERMISSION_REQUEST` events and consumes `PERMISSION_RESPONSE` messages. The frontend sub-plan (03) consumes `PERMISSION_REQUEST` events and sends `PERMISSION_RESPONSE` messages. The contract between them is defined in `core/types/events.ts` (from `00-shared-contract.md`). Neither plan needs to know the other's implementation details.

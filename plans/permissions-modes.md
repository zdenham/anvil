# Permissions Modes Implementation

## Problem

Currently the app runs with `bypassPermissions` / `allowDangerouslySkipPermissions: true` on every `query()` call. We need to implement configurable permission modes so users can control what tools agents are allowed to execute without manual approval.

The Claude Agent SDK has a **60-second timeout on both `canUseTool` callbacks and PreToolUse hooks** (default). When the timeout expires, the behavior is **fail-open** — the tool executes anyway, completely bypassing the approval mechanism. This is a known issue with open feature requests ([#304](https://github.com/anthropics/claude-agent-sdk-python/issues/304), [#319](https://github.com/anthropics/claude-agent-sdk-python/issues/319)).

## Research Findings

### SDK Timeout Behavior

| Mechanism | Default Timeout | Configurable? | Behavior on Timeout |
|-----------|----------------|---------------|---------------------|
| `canUseTool` callback | ~60s | **No** (open feature request) | Fail-open: tool executes anyway |
| PreToolUse hooks | 60s | **Yes** (`timeout` field on HookMatcher) | Tool proceeds without hook result |

### PreToolUse Hook Capabilities

Hooks can return `hookSpecificOutput` with a `permissionDecision` field:

- `"allow"` — auto-approve the tool call (can also modify input via `updatedInput`)
- `"deny"` — block the tool call (Claude sees the denial reason)
- `"ask"` — fall through to the default permission prompt

Hooks can also return `{ continue: false, stopReason: "..." }` to stop the entire agent session.

The hook `timeout` is configurable per-matcher:
```typescript
{ matcher: "Bash", hooks: [myHook], timeout: 3600 } // 1 hour
```

### Key Insight

Since hook timeout is configurable but `canUseTool` timeout is not, **we should use PreToolUse hooks (not `canUseTool`) for the approval flow**. This lets us set the timeout to whatever we want.

## Proposed Architecture

### Option A: PreToolUse Hook with Long Timeout (Recommended)

Use a PreToolUse hook with a long configurable timeout (e.g. 1 hour). The hook:
1. Evaluates tool call against the active permission mode rules
2. If auto-allowed by the mode, returns `permissionDecision: "allow"` immediately
3. If requires approval, emits a permission request event to the frontend, then awaits resolution via a Promise that resolves when the user responds
4. If the user doesn't respond within the timeout, returns `{ continue: false, stopReason: "Permission request timed out" }` to stop the agent cleanly

```
Agent calls tool
  → PreToolUse hook fires
    → Check permission mode rules
      → Auto-allow? Return { permissionDecision: "allow" }
      → Needs approval?
        → Emit PERMISSION_REQUEST event to frontend
        → Create Promise, store resolver in a Map keyed by requestId
        → await Promise (hook blocks here)
        → Frontend user clicks approve/deny
        → Frontend sends PERMISSION_RESPONSE back via IPC/event
        → Resolver fires, Promise resolves
        → Return { permissionDecision: "allow" } or { permissionDecision: "deny" }
      → Timed out?
        → Return { continue: false, stopReason: "..." }
```

**Pros:**
- Timeout is fully configurable (set on the HookMatcher)
- Clean integration with existing hook infrastructure (already have PreToolUse hooks)
- AbortSignal available for graceful cleanup
- No changes to query() permission mode needed — keep `bypassPermissions` and handle everything in hooks

**Cons:**
- Must be careful to compose with existing PreToolUse hooks (currently only matches "Task")
- Need to coordinate between the agent Node process and the Tauri frontend for the approval round-trip

### Option B: canUseTool with Streaming Workaround

A community workaround ([EdanStarfire/claudecode_webui](https://github.com/EdanStarfire/claudecode_webui)) uses the streaming interface instead of `query()` to avoid the `canUseTool` timeout entirely. This has reportedly worked for approval waits of up to 2 days.

**Pros:**
- No timeout limitations at all
- Uses the SDK's built-in permission model semantics

**Cons:**
- Requires switching from `query()` to the streaming interface — significant refactor
- Less documented / community workaround rather than official approach
- Streaming interface may have different behavior for other features we rely on

### Option C: Switch Permission Modes at the SDK Level

Use the SDK's built-in `permissionMode` options (`default`, `acceptEdits`, `bypassPermissions`, `plan`) and the `allowedTools` / `disallowedTools` lists.

**Pros:**
- Uses official SDK permission semantics
- No custom approval flow needed for basic modes

**Cons:**
- Still subject to 60-second `canUseTool` timeout for interactive approval
- Less flexible — can't implement custom rules or workflows
- Doesn't support the "ask user and wait" pattern we need

## Recommendation: Option A

Option A gives us full control, composes with our existing architecture, and avoids any SDK refactoring. The key implementation pieces are:

1. **Permission mode definitions** — rules for what tools are auto-allowed/denied/need-approval per mode
2. **PreToolUse hook** — evaluates rules, emits events, awaits user response
3. **Frontend permission dialog** — shows the request, lets user approve/deny
4. **Event bridge** — round-trip from agent process → frontend → agent process

## Phases

- [ ] Define permission mode types and rules engine
- [ ] Implement PreToolUse permission hook with event-based approval flow
- [ ] Add frontend permission request dialog and event handling
- [ ] Wire up permission mode selection in thread/task configuration
- [ ] Add tests for permission evaluation and approval flow

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Define Permission Mode Types and Rules Engine

### Permission mode types

Create `core/types/permissions.ts`:

```typescript
type PermissionDecision = "allow" | "deny" | "ask";

type PermissionRule = {
  toolPattern: string;           // regex pattern matching tool names
  inputPattern?: string;         // optional regex matching serialized input
  decision: PermissionDecision;
  reason?: string;
};

type PermissionMode = {
  id: string;
  name: string;
  description: string;
  rules: PermissionRule[];       // evaluated in order, first match wins
  defaultDecision: PermissionDecision; // if no rules match
};
```

### Built-in modes

```typescript
const BYPASS_MODE: PermissionMode = {
  id: "bypass",
  name: "Full Access",
  description: "All tools auto-approved (current behavior)",
  rules: [],
  defaultDecision: "allow",
};

const SUPERVISED_MODE: PermissionMode = {
  id: "supervised",
  name: "Supervised",
  description: "Read-only tools auto-approved, writes/commands need approval",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^(Bash|Write|Edit|NotebookEdit)$", decision: "ask" },
  ],
  defaultDecision: "ask",
};

const LOCKED_MODE: PermissionMode = {
  id: "locked",
  name: "Locked",
  description: "All tool use requires approval",
  rules: [],
  defaultDecision: "ask",
};
```

### Rules engine

Create `agents/src/lib/permission-rules.ts`:

```typescript
class PermissionEvaluator {
  constructor(private mode: PermissionMode) {}

  evaluate(toolName: string, toolInput: unknown): { decision: PermissionDecision; reason: string } {
    for (const rule of this.mode.rules) {
      if (new RegExp(rule.toolPattern).test(toolName)) {
        if (rule.inputPattern) {
          const serialized = JSON.stringify(toolInput);
          if (!new RegExp(rule.inputPattern).test(serialized)) continue;
        }
        return { decision: rule.decision, reason: rule.reason ?? `Matched rule: ${rule.toolPattern}` };
      }
    }
    return { decision: this.mode.defaultDecision, reason: "Default mode policy" };
  }
}
```

---

## Phase 2: Implement PreToolUse Permission Hook

### Core hook implementation

In `agents/src/runners/shared.ts`, add a new PreToolUse hook matcher alongside the existing "Task" matcher:

```typescript
// Permission approval hook — matches ALL tools, evaluated before the Task hook
{
  matcher: undefined, // matches everything
  timeout: 3600,      // 1 hour timeout
  hooks: [async (hookInput: unknown, toolUseId: string | undefined, { signal }: { signal: AbortSignal }) => {
    const input = hookInput as PreToolUseHookInput;
    const { decision, reason } = permissionEvaluator.evaluate(input.tool_name, input.tool_input);

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

    // decision === "ask" — emit request and wait for user response
    const requestId = crypto.randomUUID();
    const response = await waitForPermissionResponse(requestId, {
      threadId,
      toolName: input.tool_name,
      toolInput: input.tool_input,
      reason,
      signal,
    });

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

### Approval wait mechanism

Create `agents/src/lib/permission-gate.ts`:

```typescript
type PendingRequest = {
  resolve: (response: PermissionResponse | "timeout") => void;
  threadId: string;
  toolName: string;
  createdAt: number;
};

const pendingRequests = new Map<string, PendingRequest>();

async function waitForPermissionResponse(
  requestId: string,
  context: { threadId: string; toolName: string; toolInput: unknown; reason: string; signal: AbortSignal },
): Promise<PermissionResponse | "timeout"> {
  // Emit event to frontend
  emitEvent(EventName.PERMISSION_REQUEST, {
    requestId,
    threadId: context.threadId,
    toolName: context.toolName,
    toolInput: context.toolInput,
    reason: context.reason,
  });

  return new Promise((resolve) => {
    pendingRequests.set(requestId, {
      resolve,
      threadId: context.threadId,
      toolName: context.toolName,
      createdAt: Date.now(),
    });

    // Clean up on abort (timeout)
    context.signal.addEventListener("abort", () => {
      pendingRequests.delete(requestId);
      resolve("timeout");
    }, { once: true });
  });
}

// Called when frontend sends back a response
function resolvePermissionRequest(requestId: string, approved: boolean, reason?: string): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);
  pending.resolve({ approved, reason });
}
```

---

## Phase 3: Frontend Permission Request Dialog

### Event types

Add to `core/types/events.ts`:

```typescript
PERMISSION_REQUEST = "permission:request",
PERMISSION_RESPONSE = "permission:response",
```

### Permission dialog component

Create a dialog that shows when a `PERMISSION_REQUEST` event is received:
- Tool name and summarized input
- Reason the tool needs approval
- Approve / Deny buttons
- Auto-deny timer showing remaining time (optional UX enhancement)

On user action, emit `PERMISSION_RESPONSE` event back to the agent process with `{ requestId, approved, reason }`.

### Event bridge integration

The existing event bridge pattern handles the round-trip:
- Agent → Frontend: `emitEvent(PERMISSION_REQUEST, ...)` goes through the hub socket
- Frontend → Agent: `emitEvent(PERMISSION_RESPONSE, ...)` goes back through IPC, received by a listener that calls `resolvePermissionRequest()`

---

## Phase 4: Wire Up Permission Mode Selection

- Add `permissionMode` to thread/task metadata (default: `"bypass"` for backward compatibility)
- UI for selecting permission mode when creating/configuring a thread
- Pass selected mode into `runAgentLoop` options, which constructs the `PermissionEvaluator`

---

## Phase 5: Tests

- Unit tests for `PermissionEvaluator` — rule matching, pattern priority, default fallback
- Integration tests for the PreToolUse hook — auto-allow, auto-deny, ask-and-wait flows
- Test timeout behavior — verify agent stops cleanly when no response
- Test event round-trip — mock the frontend approval path

---

## Files to Create/Modify

| File | Changes |
|------|---------|
| `core/types/permissions.ts` | **New** — Permission mode types, rule types |
| `core/types/events.ts` | Add `PERMISSION_REQUEST`, `PERMISSION_RESPONSE` events |
| `agents/src/lib/permission-rules.ts` | **New** — `PermissionEvaluator` class |
| `agents/src/lib/permission-gate.ts` | **New** — `waitForPermissionResponse`, `resolvePermissionRequest`, pending request map |
| `agents/src/runners/shared.ts` | Add permission PreToolUse hook, integrate evaluator |
| `src/components/` | **New** — Permission request dialog component |
| Thread metadata / service | Add `permissionMode` field |

## Risk Considerations

- **Fail-open if hook timeout exceeded:** With `timeout: 3600` (1 hour), this is very unlikely in practice. If the AbortSignal fires, we explicitly stop the agent with `{ continue: false }` rather than letting it fail-open.
- **Stale pending requests:** If an agent is stopped/killed while a permission request is pending, the frontend dialog should detect the agent state change and dismiss itself. The `pendingRequests` map is in-memory so it's cleaned up on process exit.
- **Hook ordering:** The permission hook must fire before the existing "Task" matcher hook. Since hooks is an array, order is deterministic.
- **Event bridge latency:** The round-trip through the hub socket adds some latency, but this is negligible for a human-in-the-loop flow.

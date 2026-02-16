# Permissions Modes Implementation

## Sub-Plans

Decomposed for parallel execution by independent agents.

### Dependency graph

```
00-shared-contract ─┬─→ 01-permission-evaluator ─→ 02-permission-hook
                    │
                    └─→ 03-permission-ui
```

### Execution strategy

| Step | Plans | Agents | Notes |
|------|-------|--------|-------|
| 1 | `00-shared-contract` | 1 agent | ~15 min. Types only, no logic. Must complete first. |
| 2 | `01-permission-evaluator` + `03-permission-ui` | 2 agents in parallel | No file overlap. Evaluator is pure logic; UI is pure frontend. |
| 3 | `02-permission-hook` | 1 agent | Wires evaluator into `shared.ts`. Depends on 01 being done. |

**Total: 3 steps, max 2 agents in parallel.** Step 2 is the parallel sweet spot — the evaluator and UI touch completely disjoint file sets.

### Sub-plan summaries

- **[00-shared-contract](./00-shared-contract.md)** — Types + events in `core/types/`. Must complete first.
- **[01-permission-evaluator](./01-permission-evaluator.md)** — Pure rules engine class + unit tests in `agents/src/lib/`.
- **[02-permission-hook](./02-permission-hook.md)** — PreToolUse hook + gate + wiring into `shared.ts`.
- **[03-permission-ui](./03-permission-ui.md)** — StatusDot, pinned block, status bar, mode cycling in `src/`.

---

## Problem

Currently the app runs with `bypassPermissions` / `allowDangerouslySkipPermissions: true` on every `query()` call. We need to implement configurable permission modes so users can control what tools agents are allowed to execute without manual approval.

## Architecture Decision

**We will keep `bypassPermissions` enabled at the SDK level and implement our own permission system entirely via PreToolUse hooks.** This gives us:

- Full control over permission logic (path-scoped rules, global overrides, custom modes)
- No dependency on the SDK's limited built-in modes (`default`, `acceptEdits`, `plan`)
- A single code path — hooks are the sole authority, the SDK permission system is a no-op
- Ability to deny tools even in "allow all" mode via global override rules
- Mid-run mode switching by swapping the evaluator reference

The SDK's built-in `permissionMode` options are too coarse for our needs (can't express "only write to plans/", can't do path-scoped rules, only 4 modes available, `setPermissionMode()` only toggles between those 4). By keeping bypass on and filtering in PreToolUse, the hook becomes the single authority.

### Why not `canUseTool`?

The `canUseTool` callback has a **hard 60-second timeout that is not configurable** (open feature requests [#304](https://github.com/anthropics/claude-agent-sdk-python/issues/304), [#319](https://github.com/anthropics/claude-agent-sdk-python/issues/319)). On timeout, the behavior is **fail-open** — the tool executes anyway. PreToolUse hooks have a configurable `timeout` field per-matcher, so we can set arbitrarily long timeouts for the human-in-the-loop approval flow.

### Critical Assumption: Long Hook Timeouts Work — VERIFIED

The entire approach depends on PreToolUse hooks actually respecting long `timeout` values (e.g. 90+ seconds). **This has been verified with live integration tests** (see `agents/src/experimental/`). All 3 tests pass:

- 90s delay + allow → hook blocks 90s, tool executes after ✓
- 90s delay + deny → hook blocks 90s, tool does NOT execute ✓
- 70s delay (past default 60s) + allow → custom timeout is respected, no fail-open at 60s ✓

## Design Decisions

Decisions made during plan review (Q1–Q15):

1. **Mode switching mid-tool-call:** If a tool is already mid-execution when the user switches modes, the in-flight tool completes. The new mode applies starting from the next tool evaluation only.
2. **No session-scoped tool allowlists:** There are no "Always allow [tool]" or "Allow for session" quick-approve options. Each tool call is evaluated against the active mode's rules. This avoids complexity around allowlist persistence across mode switches.
3. **Mode communication to agent process:** The initial permission mode is passed as an argument to `spawnSimpleAgent()`. Mid-run mode changes are delivered as a hub socket message (same transport as queued messages and `PERMISSION_RESPONSE`), which triggers `evaluator.setMode()` in the hook closure.
4. **Permission requests are sequential:** Because the PreToolUse hook blocks the agent, only one permission request is pending at a time. The agent cannot call a second tool while the first hook is awaiting approval.
5. **Path matching uses relative paths:** The evaluator normalizes `tool_input.file_path` to a path relative to the working directory before matching against `pathPattern`. Patterns like `"^plans/"` match against `plans/readme.md`, not the absolute path. The evaluator requires the working directory at construction time.
6. **Three modes, not four:** Plan (default) → Implement → Supervise. No "Locked" mode.
7. **Default mode is Plan:** Agents spawn in Plan mode unless overridden. Plan mode allows reads, allows Bash, allows writes only within `plans/`, and auto-denies writes to other paths in the working directory.
8. **Permission prompt is pinned above input:** The inline permission block is rendered pinned above the chat input (not scrollable in the thread). It is keyboard-navigable (Enter to approve, Esc to deny) and auto-focused. Similar to Claude Code's UX.
9. **Mode switching is instant:** `Shift+Tab` cycles immediately with no confirmation, even for escalation (Plan → Implement). The status indicator below the input updates immediately.
10. **Supervise mode:** Shows a diff preview for Write/Edit calls. The user approves or denies before the edit is applied to disk (the hook blocks, file is unchanged until approval).
11. **Bash gating is out of scope:** Supervise mode does NOT prompt for Bash commands in this plan. Future work will add Bash gating, but it's explicitly excluded here to keep scope manageable. Plan and Implement modes auto-allow Bash.
12. **Mode indicator below input:** Displayed below the chat input, Claude Code-style. Left side shows the mode name with color coding, right side shows the context meter (relocated from the content pane header).
13. **Deny messages are visible to the agent:** When a hook returns `permissionDecision: "deny"`, the SDK surfaces the `permissionDecisionReason` to the agent as a tool error. This lets the agent adapt (e.g., "Permission denied: Plan mode only allows writes to plans/"). We craft specific, actionable deny messages per mode so the agent understands the constraint.
14. **No system prompt updates mid-run:** The SDK has no `setSystemPrompt()` API. To inform the agent of mode changes mid-run, we inject a user message via `streamInput()` (e.g., "Permission mode changed to Implement. You may now edit any file."). This uses the existing `messageStream` infrastructure already wired for queued messages.
15. **Cycle order:** Plan → Implement → Supervise → Plan.

## Research Findings

### SDK Timeout Behavior

| Mechanism | Default Timeout | Configurable? | Behavior on Timeout |
|-----------|----------------|---------------|---------------------|
| `canUseTool` callback | ~60s | **No** (open feature request) | Fail-open: tool executes anyway |
| PreToolUse hooks | 60s | **Yes** (`timeout` field on HookMatcher) | Tool proceeds without hook result |

### PreToolUse Hook Capabilities

Hooks can return `hookSpecificOutput` with a `permissionDecision` field:

- `"allow"` — auto-approve the tool call (can also modify input via `updatedInput`)
- `"deny"` — block the tool call (agent sees the `permissionDecisionReason` as tool error)
- `"ask"` — fall through to the default permission prompt

Hooks can also return `{ continue: false, stopReason: "..." }` to stop the entire agent session.

The hook `timeout` is configurable per-matcher:
```typescript
{ matcher: undefined, hooks: [myHook], timeout: 3600 } // 1 hour
```

### Hook-Permission Interaction

Even with `bypassPermissions` enabled, PreToolUse hooks **still fire and their deny decisions are respected**. The evaluation order is:

```
1. PreToolUse Hooks        ← runs regardless of mode, can deny
2. Deny Rules
3. Allow Rules
4. Ask Rules
5. Permission Mode Check   ← bypassPermissions auto-approves here
6. canUseTool Callback
```

A hook returning `deny` at step 1 short-circuits before the mode check at step 5 ever runs.

### SDK Deny Feedback to Agent

When a PreToolUse hook returns `permissionDecision: "deny"`:
- The `permissionDecisionReason` string is surfaced to the agent as a tool error
- The agent can read this reason and adapt its behavior (e.g., stop trying to write outside `plans/`)
- Denials are also tracked in the result metadata as `permission_denials: SDKPermissionDenial[]`

### Mid-Run Message Injection

The SDK's `streamInput()` method allows injecting user messages mid-conversation:
- Already used in this project for queued messages (`messageStream` option in `shared.ts`)
- Can be used to notify the agent of mode changes (since there's no `setSystemPrompt()` API)
- The agent receives the injected message as a normal user turn

## Approval Flow

```
Agent calls tool
  → PreToolUse hook fires (our custom hook, long timeout)
    → Check global overrides (hard deny rules that apply in ALL modes)
    → Normalize file paths to relative (strip working directory prefix)
    → Check permission mode rules (first match wins)
      → Auto-allow? Return { permissionDecision: "allow" }
      → Auto-deny? Return { permissionDecision: "deny", permissionDecisionReason: "..." }
      → Needs approval ("ask")?
        → Emit PERMISSION_REQUEST event to frontend
        → Create Promise, store resolver in a Map keyed by requestId
        → await Promise (hook blocks here)
        → User clicks approve/deny in pinned permission block
        → Frontend sends PERMISSION_RESPONSE back via hub socket
        → Resolver fires, Promise resolves
        → Return { permissionDecision: "allow" } or { permissionDecision: "deny" }
      → Timed out?
        → Return { continue: false, stopReason: "..." }
```

## Phases

- [x] Verify PreToolUse hook long-timeout feasibility with live agent harness test
- [x] Define permission mode types and rules engine
- [ ] Implement PreToolUse permission hook with event-based approval flow
- [ ] Add pinned permission request block above chat input (Claude Code-style)
- [ ] Add "needs input" yellow dot variant for threads awaiting user action
- [ ] Add below-input status bar (mode selector + context meter)
- [ ] Notify agent of mode changes via streamInput message injection
- [ ] Add tests for permission evaluation and approval flow

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 0: Verify PreToolUse Hook Long-Timeout Feasibility

**This phase must pass before any other work begins.** The entire permissions architecture depends on PreToolUse hooks correctly blocking for >60 seconds without fail-open behavior.

### What we're testing

1. A PreToolUse hook with `timeout: 120` (2 minutes) that deliberately delays for 90 seconds before returning `permissionDecision: "allow"` — verifying the agent waits and the tool executes after the delay
2. A PreToolUse hook with `timeout: 120` that deliberately delays for 90 seconds before returning `permissionDecision: "deny"` — verifying the agent sees the denial and does NOT execute the tool
3. Edge case: a hook that returns after the default 60s but before our custom 120s timeout — confirming the custom timeout is actually respected and the SDK doesn't silently fail-open at 60s

### Results — PASSED (2025-02-15)

All 3 tests pass. The SDK (`@anthropic-ai/claude-agent-sdk@^0.2.39`) correctly respects the `timeout` field on `HookMatcher`:

| Test | Delay | Decision | Result | Duration |
|------|-------|----------|--------|----------|
| 90s allow | 90s | allow | Hook resolved, tool executed | ~97s |
| 90s deny | 90s | deny | Hook resolved, tool NOT executed | ~97s |
| 70s edge case | 70s | allow | Hook resolved past 60s default, tool executed | ~77s |

**Conclusion:** The PreToolUse hook approach is viable. Proceed to Phase 1.

### Files

| File | Changes |
|------|---------|
| `agents/src/experimental/pretooluse-timeout-runner.ts` | **New** — minimal runner calling query() with delayed PreToolUse hook |
| `agents/src/experimental/__tests__/pretooluse-timeout.integration.test.ts` | **New** — integration test spawning runner and validating behavior |

---

## Phase 1: Define Permission Mode Types and Rules Engine

### Permission mode types

Create `core/types/permissions.ts` (extend existing file):

```typescript
type PermissionDecision = "allow" | "deny" | "ask";

type PermissionRule = {
  toolPattern: string;           // regex on tool name (e.g. "^(Write|Edit)$")
  pathPattern?: string;          // regex on relative file path (e.g. "^plans/")
  commandPattern?: string;       // regex on Bash command argument
  decision: PermissionDecision;
  reason?: string;               // surfaced to agent on deny
};

type PermissionModeId = "plan" | "implement" | "supervise";

type PermissionMode = {
  id: PermissionModeId;
  name: string;
  description: string;
  rules: PermissionRule[];       // evaluated in order, first match wins
  defaultDecision: PermissionDecision; // if no rules match
};

type PermissionConfig = {
  mode: PermissionMode;
  overrides: PermissionRule[];   // evaluated FIRST, before mode rules — can't be bypassed
  workingDirectory: string;      // used to normalize absolute paths to relative
};
```

### Path normalization

The evaluator normalizes `tool_input.file_path` to a path relative to the working directory before matching against `pathPattern`:

```typescript
function normalizeToRelativePath(absolutePath: string, workingDirectory: string): string {
  if (absolutePath.startsWith(workingDirectory)) {
    return absolutePath.slice(workingDirectory.length).replace(/^\//, "");
  }
  return absolutePath; // outside working directory — return as-is
}
```

This means `pathPattern: "^plans/"` matches `plans/readme.md` (derived from `/Users/zac/.../plans/readme.md`).

### Path/command extraction

The evaluator extracts known fields from `tool_input` for matching:
- `file_path` → used by `pathPattern` (for Write, Edit, Read, NotebookEdit tools)
- `command` → used by `commandPattern` (for Bash tool)
- `pattern` → used by `pathPattern` as fallback (for Glob tool)

### Global overrides

Override rules are evaluated **before** mode rules and **cannot be bypassed by any mode**, including Implement:

```typescript
const GLOBAL_OVERRIDES: PermissionRule[] = [
  { toolPattern: "^Bash$", commandPattern: "rm\\s+(-rf|--force).*\\.git", decision: "deny", reason: "Cannot delete .git directory" },
  { toolPattern: "^(Write|Edit)$", pathPattern: "\\.env", decision: "deny", reason: "Cannot modify .env files" },
];
```

### Built-in modes

```typescript
const PLAN_MODE: PermissionMode = {
  id: "plan",
  name: "Plan",
  description: "Can read everything, write only to plans/, Bash allowed",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", pathPattern: "^plans/", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "deny", reason: "Plan mode: writes are restricted to the plans/ directory" },
  ],
  defaultDecision: "deny",
};

const IMPLEMENT_MODE: PermissionMode = {
  id: "implement",
  name: "Implement",
  description: "All tools auto-approved",
  rules: [],
  defaultDecision: "allow",
};

const SUPERVISE_MODE: PermissionMode = {
  id: "supervise",
  name: "Supervise",
  description: "Read/Bash auto-approved, file edits require approval with diff preview",
  rules: [
    { toolPattern: "^(Read|Glob|Grep|WebFetch|WebSearch)$", decision: "allow" },
    { toolPattern: "^Bash$", decision: "allow" },
    { toolPattern: "^Task$", decision: "allow" },
    { toolPattern: "^(Write|Edit|NotebookEdit)$", decision: "ask" },
  ],
  defaultDecision: "ask",
};
```

**Cycle order:** Plan → Implement → Supervise → Plan

> **Out of scope:** Bash command gating (prompting for Bash approval) is explicitly excluded from this plan. All three modes auto-allow Bash. Future work may add a Bash review mechanism, but it requires different UX (showing the command vs showing a diff) and is better handled as a separate plan.

### Rules engine

Create `agents/src/lib/permission-evaluator.ts`:

```typescript
class PermissionEvaluator {
  private overrides: PermissionRule[];
  private mode: PermissionMode;
  private workingDirectory: string;

  constructor(config: PermissionConfig) {
    this.overrides = config.overrides;
    this.mode = config.mode;
    this.workingDirectory = config.workingDirectory;
  }

  /** Swap the active mode. Override rules are unaffected. */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  evaluate(toolName: string, toolInput: unknown): { decision: PermissionDecision; reason: string } {
    const rawFilePath = extractFilePath(toolInput);
    const filePath = rawFilePath
      ? normalizeToRelativePath(rawFilePath, this.workingDirectory)
      : undefined;
    const command = extractCommand(toolInput);

    // 1. Global overrides — checked first, can't be bypassed
    for (const rule of this.overrides) {
      if (matchesRule(rule, toolName, filePath, command)) {
        return { decision: rule.decision, reason: rule.reason ?? "Global override" };
      }
    }

    // 2. Mode rules — first match wins
    for (const rule of this.mode.rules) {
      if (matchesRule(rule, toolName, filePath, command)) {
        return { decision: rule.decision, reason: rule.reason ?? `Mode rule: ${this.mode.name}` };
      }
    }

    // 3. Default
    return { decision: this.mode.defaultDecision, reason: `Default policy: ${this.mode.name}` };
  }
}
```

Evaluation order: **Global overrides → Mode rules → Mode default**

---

## Phase 2: Implement PreToolUse Permission Hook

### Core hook implementation

In `agents/src/runners/shared.ts`, add a new PreToolUse hook matcher alongside the existing "Task" matcher. The `PermissionEvaluator` is constructed from the active `PermissionConfig` and stored as a `let` binding so `setMode()` can be called mid-run:

```typescript
// Permission approval hook — matches ALL tools, evaluated before the Task hook
{
  matcher: undefined, // matches everything
  timeout: 3600,      // 1 hour timeout (validated by Phase 0)
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

// Called when frontend sends back a response via hub socket
function resolvePermissionRequest(requestId: string, approved: boolean, reason?: string): void {
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);
  pending.resolve({ approved, reason });
}
```

---

## Phase 3: Pinned Permission Request Block (Claude Code-style)

### Existing scaffolding (already built)

The following already exist and should be leveraged, not rebuilt:

| File | What it provides |
|------|-----------------|
| `core/types/permissions.ts` | `PermissionRequest`, `PermissionDecision`, `PermissionStatus`, `PermissionDisplayMode` ("modal" \| "inline"), `isDangerousTool()` |
| `core/types/events.ts` | `PERMISSION_REQUEST` and `PERMISSION_RESPONSE` events with typed payloads |
| `src/entities/permissions/store.ts` | Zustand store with pending requests, focus management (inline nav), display mode state |
| `src/entities/permissions/service.ts` | `permissionService.respond()`, `approveAll()`, `denyAll()` — sends response to agent via IPC |
| `src/components/permission/permission-modal.tsx` | Existing modal implementation (keep as fallback, default to inline) |

### Design: Pinned permission block above input

Permission requests render **pinned above the chat input** — always visible, not part of the scrollable thread. This ensures the user never misses a pending approval and can scroll the thread to read context while the prompt is visible.

The block is keyboard-navigable and auto-focused:
- **Enter** → Approve
- **Esc** → Deny

In **Supervise mode**, the block shows a diff preview (old content vs new content) for Write/Edit tool calls:

```
┌─────────────────────────────────────────┐
│ ⚠ Allow Edit?                           │
│                                         │
│  src/components/app.tsx                  │
│  - const foo = "bar";                   │
│  + const foo = "baz";                   │
│                                         │
│  Reason: Supervise mode                 │
│                                         │
│           [Deny (Esc)]  [Approve (⏎)]   │
└─────────────────────────────────────────┘
```

After user responds, the block disappears (since it's pinned, not in the thread). A collapsed status line appears in the thread at the tool call position:

```
┌─────────────────────────────────────────┐
│ ✓ Edit approved — src/components/app.tsx│
└─────────────────────────────────────────┘
```

### Component: `PermissionRequestBlock`

Create `src/components/permission/permission-request-block.tsx`:

- Renders pinned above the chat input inside `ThreadInputSection`
- Props: `requestId`, `toolName`, `toolInput`, `status`, `onRespond`
- For Write/Edit in Supervise mode: shows diff preview (reading current file content to generate the diff)
- Keyboard shortcuts: `Enter` to approve, `Esc` to deny
- Auto-focuses when pending
- Visual states: pending (accent border), approved (green), denied (red/muted)
- Dangerous tools get amber warning icon (uses existing `isDangerousTool()`)

### Integration point

When a `PERMISSION_REQUEST` event arrives:

1. Permission store adds the request (existing `_applyAddRequest`)
2. `ThreadInputSection` checks for pending permission requests for the active thread
3. If a pending request exists, render `PermissionRequestBlock` pinned above the input
4. User presses Enter/Esc or clicks approve/deny → `permissionService.respond()` (existing)
5. Block disappears, collapsed status shows in thread

### Event bridge (already wired)

The existing event bridge handles the round-trip:
- Agent → Frontend: `PERMISSION_REQUEST` event through hub socket → permission store
- Frontend → Agent: `permissionService.respond()` → sends response via hub socket

---

## Phase 3b: "Needs Input" Yellow Dot Variant

### Problem

When an agent is waiting for a permission approval (or any human input like `AskUserQuestion`), the thread dot in the tree menu still shows **green/running**. The user has no way to see at a glance which threads need their attention vs which are happily running.

### Solution: New "needs-input" StatusDot variant

Add a **yellow/amber pulsing dot** to indicate "this thread is blocked waiting for user input."

Current `StatusDotVariant` values: `"running" | "unread" | "read" | "stale"`

Add: **`"needs-input"`** — amber with pulse animation, distinct from "stale" (which is static amber for missing plan files).

### StatusDot changes

In `src/components/ui/status-dot.tsx`:

```typescript
export type StatusDotVariant = "running" | "unread" | "read" | "stale" | "needs-input";
```

The `"needs-input"` variant uses `bg-amber-400` with the same pulse animation class as `"running"` but in amber instead of green. This requires a new CSS class `status-dot-needs-input` (sibling to `status-dot-running`).

### StatusLegend changes

In `src/components/ui/status-legend.tsx`, add a fourth entry:

```
● Running   ● Needs Input   ● Unread   ● Read
  green       amber/yellow     blue       grey
```

### Thread item text color

In `src/components/tree-menu/thread-item.tsx`, the `getTextColorClass()` function should treat `"needs-input"` with the same shimmer animation as `"running"` (or a distinct amber shimmer) to draw attention.

### When to show the yellow dot

A thread shows `"needs-input"` when **any** of these are true:
- There is a pending `PermissionRequest` for this thread in the permission store
- There is a pending `AskUserQuestion` tool use in the thread's `toolStates` (status: `"running"`, toolName: `"AskUserQuestion"`)

This is derived state, not persisted. The `ThreadItem` component (or the `useTreeData` hook that computes item status) checks both the permission store and the thread's tool states to determine if `"needs-input"` should override the default `"running"` variant.

### Derivation logic

In the tree data hook or thread item, the status priority is:

```
1. If thread has pending permission request OR pending AskUserQuestion → "needs-input"
2. If thread status is "running" → "running"
3. If thread is unread → "unread"
4. Otherwise → "read"
```

The `"needs-input"` variant takes **priority over "running"** since "running but blocked" is more important than "running."

### Files

| File | Changes |
|------|---------|
| `src/components/ui/status-dot.tsx` | Add `"needs-input"` variant with amber pulse |
| `src/components/ui/status-legend.tsx` | Add "Needs Input" entry to legend |
| `src/components/tree-menu/thread-item.tsx` | Handle `"needs-input"` in `getTextColorClass()` |
| `src/styles/` (CSS) | Add `status-dot-needs-input` animation class |
| `src/hooks/use-tree-data.ts` or `src/stores/tree-menu/` | Derive `"needs-input"` from permission store + tool states |

---

## Phase 4: Below-Input Status Bar (Mode Selector + Context Meter)

### Design: Claude Code-style below-input bar

Add a **status bar below the chat input** that contains two elements:

```
┌──────────────────────────────────────────────────┐
│  Type a message, @ to mention files...           │
├──────────────────────────────────────────────────┤
│  Plan                              ████░░ 42.3%  │
└──────────────────────────────────────────────────┘
```

**Left side:** Permission mode label (click or `Shift+Tab` to cycle)
**Right side:** Context meter (relocated from content-pane-header)

### Permission mode selector

Follows Claude Code's convention exactly:

- **Shift+Tab** cycles through modes: Plan → Implement → Supervise → Plan (only when input is focused)
- **Clicking the mode text** also cycles to the next mode
- Each mode has a distinct **color** for instant visual recognition:

| Mode | Color | Text |
|------|-------|------|
| Plan | `text-blue-400` | `Plan` |
| Implement | `text-green-400` | `Implement` |
| Supervise | `text-yellow-400` | `Supervise` |

The mode text renders as a small `text-[11px]` label in the bar, similar to how Claude Code shows `> bypass permissions` below its input. Color changes immediately on cycle — no confirmation step.

### Context meter relocation

Move the `ContextMeter` component from `content-pane-header.tsx` to this new below-input bar, **right-justified**. The header currently renders it at `src/components/content-pane/content-pane-header.tsx:239`. Remove it from the header and place it in the status bar.

The `ContextMeter` component itself (`src/components/content-pane/context-meter.tsx`) needs no changes — it takes a `threadId` prop and manages its own data. Just relocate where it's rendered.

### Component: `ThreadInputStatusBar`

Create `src/components/reusable/thread-input-status-bar.tsx`:

```typescript
interface ThreadInputStatusBarProps {
  threadId: string;
  permissionMode: PermissionModeId;
  onCycleMode: () => void;
}
```

- Renders below `ThreadInput` inside `ThreadInputSection`
- Left: mode label with color, click handler calls `onCycleMode`
- Right: `<ContextMeter threadId={threadId} />`
- `Shift+Tab` handler is added to `ThreadInput`'s `onKeyDown` — calls `onCycleMode` and prevents default

### Integration into ThreadInputSection

`ThreadInputSection` (`src/components/reusable/thread-input-section.tsx`) currently renders:
1. `QuickActionsPanel`
2. `ThreadInput`

After this change:
1. `QuickActionsPanel`
2. `PermissionRequestBlock` (when pending — pinned above input, from Phase 3)
3. `ThreadInput`
4. `ThreadInputStatusBar` (new — mode selector left, context meter right)

`ThreadInputSection` needs new props: `threadId`, `permissionMode`, `onCycleMode`.

### Data flow

1. **Thread metadata** — Add optional `permissionMode` field to `ThreadMetadataBaseSchema` (default: `"plan"`)
2. **Thread creation** — `CreateThreadOptions` gains optional `permissionMode`, defaults to workspace setting
3. **Workspace default** — Add `defaultPermissionMode` to workspace settings
4. **Agent spawn** — `spawnSimpleAgent()` passes mode ID to agent process as argument
5. **Agent runner** — `runAgentLoop()` reads mode, constructs `PermissionEvaluator` with working directory
6. **Mid-run switching** — `Shift+Tab` cycles mode → updates thread metadata → sends `PERMISSION_MODE_CHANGED` via hub socket → agent listener calls `evaluator.setMode(newMode)`

### New event

Add to `core/types/events.ts`:
```typescript
PERMISSION_MODE_CHANGED = "permission:mode-changed",
```

Payload:
```typescript
[EventName.PERMISSION_MODE_CHANGED]: {
  threadId: string;
  modeId: PermissionModeId; // "plan" | "implement" | "supervise"
};
```

### Files

| File | Changes |
|------|---------|
| `core/types/threads.ts` | Add `permissionMode` to `ThreadMetadataBaseSchema` |
| `core/types/events.ts` | Add `PERMISSION_MODE_CHANGED` event |
| `src/components/reusable/thread-input-status-bar.tsx` | **New** — Below-input bar with mode selector + context meter |
| `src/components/reusable/thread-input-section.tsx` | Add `ThreadInputStatusBar` + `PermissionRequestBlock`, new props |
| `src/components/reusable/thread-input.tsx` | Add `Shift+Tab` handler to `onKeyDown` |
| `src/components/content-pane/content-pane-header.tsx` | **Remove** `ContextMeter` from header (relocated to status bar) |
| `src/lib/thread-creation-service.ts` | Pass `permissionMode` through to agent spawn |
| `agents/src/runners/shared.ts` | Read mode from options, construct evaluator |
| Workspace settings | Add `defaultPermissionMode` setting |

---

## Phase 5: Notify Agent of Mode Changes via streamInput

When the user switches permission mode mid-run (via `Shift+Tab`), two things must happen:

1. **Evaluator update** — `evaluator.setMode(newMode)` is called so subsequent tool evaluations use the new rules. This is triggered by the `PERMISSION_MODE_CHANGED` hub socket message.

2. **Agent notification** — Inject a user message via `streamInput()` so the agent understands the new constraints:

```typescript
// When PERMISSION_MODE_CHANGED is received in the agent process:
evaluator.setMode(getBuiltinMode(newModeId));
messageStream.enqueue({
  role: "user",
  content: `[System] Permission mode changed to "${newModeName}". ${newModeDescription}`,
});
```

Example injected messages:
- `[System] Permission mode changed to "Plan". You can read all files and run commands, but writes are restricted to the plans/ directory.`
- `[System] Permission mode changed to "Implement". All tools are now available.`
- `[System] Permission mode changed to "Supervise". File edits (Write/Edit) now require user approval before being applied.`

This uses the existing `messageStream` infrastructure already wired in `shared.ts` for queued messages.

---

## Phase 6: Tests

- Unit tests for `PermissionEvaluator`:
  - Rule matching: tool pattern, path pattern, command pattern
  - Path normalization: absolute → relative
  - Pattern priority: overrides before mode rules before default
  - Mode switching: `setMode()` changes evaluation behavior
  - Edge cases: tool input with no file_path, paths outside working directory
- Integration tests for the PreToolUse hook:
  - Auto-allow in Implement mode
  - Auto-deny writes outside plans/ in Plan mode (verify deny reason is surfaced)
  - Ask-and-wait flow in Supervise mode (mock frontend response)
- Test timeout behavior: verify agent stops cleanly when no response
- Test event round-trip: mock the hub socket approval path
- Test mode change notification: verify `streamInput()` message is injected on mode switch

---

## Files to Create/Modify

### Already exist (built during earlier work)

| File | Status |
|------|--------|
| `core/types/permissions.ts` | **Exists** — Has `PermissionRequest`, `PermissionDecision`, `PermissionDisplayMode`, `isDangerousTool()`. Needs: add `PermissionRule`, `PermissionMode`, `PermissionModeId`, `PermissionConfig` types for the rules engine. |
| `core/types/events.ts` | **Exists** — Has `PERMISSION_REQUEST`, `PERMISSION_RESPONSE` events with typed payloads |
| `src/entities/permissions/store.ts` | **Exists** — Zustand store with request tracking, focus management, display mode |
| `src/entities/permissions/service.ts` | **Exists** — `respond()`, `approveAll()`, `denyAll()` with IPC |
| `src/components/permission/permission-modal.tsx` | **Exists** — Modal implementation (keep as fallback) |
| `agents/src/experimental/` | **Exists** — Phase 0 timeout feasibility tests |

### To create/modify

| File | Changes |
|------|---------|
| `core/types/permissions.ts` | Add `PermissionRule`, `PermissionMode`, `PermissionModeId`, `PermissionConfig` types, built-in mode definitions |
| `core/types/events.ts` | Add `PERMISSION_MODE_CHANGED` event |
| `core/types/threads.ts` | Add `permissionMode` to `ThreadMetadataBaseSchema` |
| `agents/src/lib/permission-evaluator.ts` | **New** — `PermissionEvaluator` class with path normalization, override + mode rule evaluation |
| `agents/src/lib/permission-gate.ts` | **New** — `waitForPermissionResponse`, `resolvePermissionRequest`, pending request map |
| `agents/src/runners/shared.ts` | Add permission PreToolUse hook (catch-all matcher, long timeout), integrate evaluator, handle `PERMISSION_MODE_CHANGED` socket message, inject streamInput notification |
| `src/components/permission/permission-request-block.tsx` | **New** — Pinned permission block above input (diff preview for Supervise, keyboard nav, auto-focus) |
| `src/components/reusable/thread-input-status-bar.tsx` | **New** — Below-input bar with mode selector (left) + context meter (right) |
| `src/components/reusable/thread-input-section.tsx` | Add `ThreadInputStatusBar` + `PermissionRequestBlock`, pass `threadId` + mode props |
| `src/components/reusable/thread-input.tsx` | Add `Shift+Tab` handler for mode cycling |
| `src/components/content-pane/content-pane-header.tsx` | **Remove** `ContextMeter` from header (relocated to status bar) |
| `src/components/ui/status-dot.tsx` | Add `"needs-input"` variant (amber pulse) |
| `src/components/ui/status-legend.tsx` | Add "Needs Input" entry |
| `src/components/tree-menu/thread-item.tsx` | Handle `"needs-input"` in `getTextColorClass()` |
| `src/hooks/use-tree-data.ts` | Derive `"needs-input"` status from permission store + tool states |
| `src/lib/thread-creation-service.ts` | Pass `permissionMode` to agent spawn |

## Risk Considerations

- **Phase 0 blocks everything:** If PreToolUse hook long timeouts don't actually work as documented, we need a fallback plan (likely Option B: streaming interface workaround). This is why we test first. **STATUS: PASSED — risk mitigated.**
- **Fail-open if hook timeout exceeded:** With `timeout: 3600` (1 hour), this is very unlikely in practice. If the AbortSignal fires, we explicitly stop the agent with `{ continue: false }` rather than letting it fail-open.
- **Stale pending requests:** If an agent is stopped/killed while a permission request is pending, the frontend permission block should detect the agent state change and dismiss itself. The `pendingRequests` map is in-memory so it's cleaned up on process exit.
- **Hook ordering:** The permission hook must fire before the existing "Task" matcher hook. Since hooks is an array, order is deterministic.
- **Event bridge latency:** The round-trip through the hub socket adds some latency, but this is negligible for a human-in-the-loop flow.
- **Deny reason visibility:** SDK research confirms `permissionDecisionReason` is surfaced to the agent as a tool error. We craft specific, actionable messages so the agent can adapt rather than retry blindly.
- **No system prompt mid-run:** The SDK lacks `setSystemPrompt()`. We work around this by injecting user messages via `streamInput()` on mode change. This is adequate but means the agent sees mode changes as user messages, not system context.

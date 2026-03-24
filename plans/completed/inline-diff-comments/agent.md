# Agent: Comment Resolution via Hook-Intercepted CLI

Agent-side comment resolution using a fake CLI command (`anvil-resolve-comment`) intercepted at the PreToolUse hook level, invoked via the `/anvil:address-comments` skill. Depends on `foundation.md` completing first. Runs in parallel with `frontend.md`.

**Files in this plan are under `agents/` and `plugins/anvil/` — no `src/` or `core/` modifications.**

## Phases

- [x] Create the `address-comments` skill definition
- [x] Extract comment resolution hook to its own module
- [x] Write hook interception tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach: Hook + `updatedInput` Rewrite

Instead of parsing `[COMMENT_RESOLVED: id]` markers from agent text output, we give the agent a fake CLI command. The agent calls it via Bash, and we intercept it before execution:

1. User (or frontend) invokes `/anvil:address-comments` — skill prompt loaded with comment context and `anvil-resolve-comment` instructions
2. Agent addresses comments, then calls `Bash` with `command: "anvil-resolve-comment id1,id2,id3"`
3. PreToolUse hook matches Bash calls starting with `anvil-resolve-comment`
4. Hook parses comma-separated IDs from the command
5. Hook emits `COMMENT_RESOLVED` events via hubClient for each ID
6. Hook returns `allow` with `updatedInput: { command: "echo 'Resolved comments: id1, id2, id3'" }`
7. Bash tool executes the harmless echo — agent sees a successful result

**Why this is better than text markers:**
- Agent explicitly signals intent via a tool call, not hidden text
- No fragile regex parsing of free-form text
- Agent gets clear success/failure feedback from the tool result
- Follows the existing `updatedInput` pattern (same as AskUserQuestion two-phase flow)
- No changes to `message-handler.ts` needed

**Why this is better than a real no-op CLI script:**
- No external script to install, manage, or keep on PATH
- Side effects (event emission) happen atomically in the hook
- Everything stays in the agent codebase — no filesystem dependency

---

## Phase 1: `address-comments` Skill Definition

**Files:**
- `plugins/anvil/skills/address-comments/SKILL.md` (new)

The skill is invoked as `/anvil:address-comments` and provides the agent with:
1. The list of unresolved comments (file, line, content, IDs)
2. Instructions to use `anvil-resolve-comment` after addressing each comment

```markdown
---
name: address-comments
description: Address unresolved inline diff comments and mark them resolved
user-invocable: true
---

# Address Inline Comments

You have been asked to address unresolved inline diff comments. Review each comment below and make the requested changes.

## Unresolved Comments

$COMMENTS

## Resolving Comments

After you have addressed a comment, mark it as resolved by running:

anvil-resolve-comment "<comma-separated-comment-ids>"

Example: `anvil-resolve-comment "abc-123,def-456"`

You may resolve comments individually or in batches. Only resolve a comment after you have actually made the requested changes.
```

**Note:** `$COMMENTS` is a placeholder — the frontend injects the actual comment data when invoking the skill. This could be done by passing comments as skill arguments, or by having the skill read them from disk at `~/.anvil/comments/{worktreeId}.json`. The exact injection mechanism depends on how the frontend triggers the skill (covered in `frontend.md`).

---

## Phase 2: Comment Resolution Hook Module

`agents/src/runners/shared.ts` is already 1293 lines (guideline is <250). Extract the hook to its own module.

**Files:**
- `agents/src/hooks/comment-resolution-hook.ts` (new)
- `agents/src/runners/shared.ts` (modify) — import and register the hook

### Hook Module

```typescript
// agents/src/hooks/comment-resolution-hook.ts
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { EventName } from "@core/types/events.js";

interface CommentHookDeps {
  worktreeId: string | undefined;
  emitEvent: (name: string, payload: Record<string, unknown>) => void;
}

/**
 * Creates a PreToolUse hook that intercepts `anvil-resolve-comment` Bash calls.
 * Parses comment IDs, emits COMMENT_RESOLVED events, rewrites command to echo.
 */
export function createCommentResolutionHook(deps: CommentHookDeps) {
  return async (hookInput: unknown) => {
    const input = hookInput as PreToolUseHookInput;
    const command = (input.tool_input as Record<string, unknown>).command as string;

    if (!command.trimStart().startsWith("anvil-resolve-comment")) {
      // Not our command — pass through to other hooks
      return { continue: true };
    }

    // Parse: anvil-resolve-comment "id1,id2,id3"
    const argsMatch = command.match(/anvil-resolve-comment\s+["']?([^"']+)["']?/);
    if (!argsMatch) {
      // Invalid usage — deny with reason (agent sees this as the tool error)
      return {
        reason: "Usage: anvil-resolve-comment \"<comma-separated-ids>\"",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "Invalid anvil-resolve-comment usage — no IDs provided",
        },
      };
    }

    const ids = argsMatch[1].split(",").map((id) => id.trim()).filter(Boolean);

    if (!deps.worktreeId) {
      return {
        reason: "Cannot resolve comments: no worktreeId in runner context",
        hookSpecificOutput: {
          hookEventName: "PreToolUse" as const,
          permissionDecision: "deny" as const,
          permissionDecisionReason: "No worktreeId available",
        },
      };
    }

    // Emit COMMENT_RESOLVED events for each ID
    for (const commentId of ids) {
      deps.emitEvent(EventName.COMMENT_RESOLVED, {
        worktreeId: deps.worktreeId,
        commentId,
      });
    }

    // Rewrite command to a harmless echo — agent sees success
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision: "allow" as const,
        updatedInput: {
          command: `echo "Resolved ${ids.length} comment(s): ${ids.join(", ")}"`,
        },
      },
    };
  };
}
```

### Hook Registration in `shared.ts`

**Critical: Hook ordering matters.** The existing PreToolUse hooks in `shared.ts` (line ~470) are:

1. `AskUserQuestion` hook (matcher: `"AskUserQuestion"`)
2. Permission hook (matcher: `undefined` — **catch-all, matches ALL tools including Bash**)
3. `Task` hook (matcher: `"Task"`)

The catch-all permission hook at position [1] would intercept Bash calls before a Bash-specific hook placed after it. The comment resolution hook must be placed **before the catch-all permission hook** (at position [1], pushing the permission hook to [2]):

```typescript
import { createCommentResolutionHook } from "@/hooks/comment-resolution-hook";

// Inside runAgentLoop(), in the PreToolUse hooks array:
// [0] AskUserQuestion hook (existing)
// [1] Comment resolution hook (NEW — must be before the catch-all)
{
  matcher: "Bash" as const,
  hooks: [
    createCommentResolutionHook({
      worktreeId: orchestrationContext.worktreeId,
      emitEvent,
    }),
  ],
},
// [2] Permission hook — catch-all (existing, unchanged)
// [3] Task hook (existing, unchanged)
```

**Why before the catch-all:** The SDK evaluates hooks in array order. The first hook that returns a non-`{ continue: true }` decision wins. If `anvil-resolve-comment` is detected, the comment hook handles it and the permission hook is never consulted. For all other Bash commands, the comment hook returns `{ continue: true }` and the permission hook evaluates normally.

### Key Details

- **`{ continue: true }`** for non-matching Bash calls lets the normal permission flow continue
- **`emitEvent`** is already in scope from the `runAgentLoop` closure (same as existing hooks)
- **`orchestrationContext.worktreeId`** — `OrchestrationContext` (defined in `agents/src/runners/types.ts`) already has `worktreeId?: string`
- **`updatedInput` in `hookSpecificOutput`** — same mechanism the SDK uses; the Bash tool receives the rewritten command instead of the original
- **`reason`** (top-level on `SyncHookJSONOutput`) is how to surface error text to the agent on deny. There is no `outputOverride` field in the SDK types.

### Event Flow

```
Agent Bash call → PreToolUse hook intercepts → parse IDs → emitEvent()
→ socket → agent-service (Tauri) → eventBus.emit()
→ setupCommentListeners() handler → commentService._resolveFromEvent()
→ disk write + store update → UI re-renders

Meanwhile: Bash executes rewritten echo → agent sees "Resolved 2 comment(s): abc, def"
```

---

## Phase 3: Hook Interception Tests

**Files:**
- `agents/src/hooks/__tests__/comment-resolution-hook.test.ts` (new)

### Test Strategy

Test `createCommentResolutionHook()` directly — it's a pure function that takes deps and returns a hook function. No need to test through the full agent loop.

**Parsing tests:**
- Extracts single ID from `anvil-resolve-comment "abc-123"`
- Extracts multiple IDs from `anvil-resolve-comment "abc-123,def-456,ghi-789"`
- Handles no quotes: `anvil-resolve-comment abc-123,def-456`
- Returns deny with `reason` for bare `anvil-resolve-comment` with no args
- Returns `{ continue: true }` for non-matching Bash commands (e.g. `ls -la`)
- Handles whitespace in comma-separated list
- Filters empty strings from splitting
- Returns deny when `worktreeId` is undefined

**Event emission tests:**
- Emits one `COMMENT_RESOLVED` event per ID
- Each event includes correct `worktreeId` and `commentId`
- No events emitted when parsing fails
- No events emitted when worktreeId is undefined

**updatedInput tests:**
- Rewritten command is `echo "Resolved N comment(s): ..."`
- Original command is never passed through

**Mock setup:**
```typescript
const mockEmitEvent = vi.fn();
const hook = createCommentResolutionHook({
  worktreeId: "test-worktree-id",
  emitEvent: mockEmitEvent,
});
```

Run tests with: `cd agents && pnpm test`

---

## Verification

After completing all phases:
1. `plugins/anvil/skills/address-comments/SKILL.md` exists and is invocable as `/anvil:address-comments`
2. `agents/src/hooks/comment-resolution-hook.ts` exists with exported `createCommentResolutionHook()`
3. Hook is registered in `shared.ts` PreToolUse array **before** the catch-all permission hook
4. `anvil-resolve-comment` calls are intercepted, IDs parsed, events emitted
5. Non-matching Bash calls pass through unaffected (return `{ continue: true }`)
6. All tests pass: `cd agents && pnpm test`

# TUI Thread & Worktree Naming

## Summary

Detect the first user message in CLI/TUI sessions to generate thread names and worktree names, matching the naming behavior of SDK-managed threads.

**Depends on**: `plans/claude-tui-hook-bridge.md` (HTTP hook infrastructure)

## Problem

SDK-managed threads call `generateThreadName(config.prompt)` and `generateWorktreeName(config.prompt)` because the prompt is known upfront. TUI threads spawn Claude CLI in a PTY — Anvil doesn't know what the user types until after they submit it. Without naming, TUI threads show up as unnamed entries in the sidebar.

## Approach: `UserPromptSubmit` HTTP Hook

The Claude Code SDK exposes a `UserPromptSubmit` hook event that fires every time the user submits a prompt. The hook input includes the full `prompt: string`.

```typescript
// From @anthropic-ai/claude-agent-sdk
type UserPromptSubmitHookInput = BaseHookInput & {
  hook_event_name: 'UserPromptSubmit';
  prompt: string;
};

type UserPromptSubmitHookSpecificOutput = {
  hookEventName: 'UserPromptSubmit';
  additionalContext?: string;  // Can inject context per-message
};
```

This is strictly better than transcript parsing for naming because:

- **Immediate**: fires before Claude starts processing, no need to wait for tool calls
- **Structured**: `prompt` is a clean string, no JSONL parsing
- **First-class**: documented SDK hook type, not an internal transcript format
- **Works for multi-turn**: fires on every user message, enabling re-naming or follow-up context injection

### Why not transcript parsing?

The transcript `.jsonl` does contain `type: "user"` lines, but:

- Transcript is only read on hook triggers (PostToolUse, Stop) — by the time you'd parse it, the agent is already working
- Extra I/O and parsing for something already available as a structured hook input
- Transcript format has no stability guarantees

## Design

### Hook registration

Add `UserPromptSubmit` to the dynamically generated `hooks.json` (Phase 3 of `claude-tui-hook-bridge.md`):

```json
{
  "UserPromptSubmit": [
    {
      "hooks": [{
        "type": "http",
        "url": "http://localhost:{port}/hooks/user-prompt-submit",
        "headers": { "X-Anvil-Thread-Id": "$ANVIL_THREAD_ID" },
        "allowedEnvVars": ["ANVIL_THREAD_ID"],
        "timeout": 10,
        "statusMessage": "Connecting to Anvil..."
      }]
    }
  ]
}
```

### Sidecar handler

```typescript
// sidecar/src/hooks/hook-handler.ts

async function handleUserPromptSubmit(
  input: UserPromptSubmitHookInput,
  threadId: string,
): Promise<HookJSONOutput> {
  const thread = threadStateWriter.getThread(threadId);

  // First user message → trigger naming
  const isFirstMessage = !thread || thread.messages.length === 0;

  if (isFirstMessage) {
    // Fire-and-forget naming (don't block the hook response)
    initiateNaming(threadId, input.prompt);
  }

  // Store user message in thread state
  stateWriter.dispatch(threadId, {
    type: "ADD_USER_MESSAGE",
    payload: { content: input.prompt },
  });

  // Optionally inject per-message context (plan updates, etc.)
  return {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: buildPerMessageContext(threadId),
    },
  };
}
```

### Naming flow

```typescript
// sidecar/src/hooks/naming.ts

async function initiateNaming(threadId: string, prompt: string): Promise<void> {
  // Reuse existing naming services from agents/src/services/
  const [threadName, worktreeName] = await Promise.all([
    generateThreadName(prompt, apiKey),
    generateWorktreeName(prompt, apiKey),
  ]);

  // Update thread metadata on disk
  await updateThreadMetadata(threadId, {
    name: threadName.name,
    worktreeName: worktreeName.name,
  });

  // Broadcast to frontend
  broadcaster.emit(threadId, {
    type: "THREAD_NAME_GENERATED",
    payload: { name: threadName.name },
  });

  broadcaster.emit(threadId, {
    type: "WORKTREE_NAME_GENERATED",
    payload: { name: worktreeName.name },
  });
}
```

### Shared naming services

`generateThreadName()` and `generateWorktreeName()` currently live in `agents/src/services/`. They're pure functions (prompt + API key → name) with no SDK dependencies. Two options:

**Option A — Import directly from** `agents/`: The sidecar can import from `agents/src/services/` if the build supports it. Simplest, no code duplication.

**Option B — Extract to** `core/lib/naming/`: Move the pure naming logic to `core/lib/` (same pattern as `core/lib/hooks/`). Both `agents/` and `sidecar/` import from `core/`. More consistent with the shared-helper pattern established in `claude-tui-hook-bridge.md`.

Recommendation: **Option B** — consistent with the architecture. The naming functions are small and self-contained.

```
core/lib/naming/
  thread-name.ts    ← generateThreadName(prompt, apiKey) → {name, usedFallback}
  worktree-name.ts  ← generateWorktreeName(prompt, apiKey) → {name, usedFallback}
                       + sanitizeWorktreeName(raw) → string

agents/src/services/
  thread-naming-service.ts  ← thin wrapper: calls core + emits events + updates disk
  worktree-naming-service.ts ← thin wrapper: calls core + emits events + updates disk
```

### Per-message context injection bonus

Since `UserPromptSubmit` fires on every message (not just the first), the handler doubles as a per-message context injector via `additionalContext`. Useful for:

- Injecting updated plan phase status when the user asks about progress
- Injecting worktree state changes
- Thread-specific context that changes between turns

This is orthogonal to naming but comes free with the hook registration.

## Phases

- [x] Phase 1: Extract naming logic to `core/lib/naming/` and update `agents/` wrappers

- [x] Phase 2: Add `UserPromptSubmit` to `hooks.json` generation and sidecar HTTP routing

- [x] Phase 3: Implement sidecar handler with first-message detection + fire-and-forget naming

- [x] Phase 4: Add `ADD_USER_MESSAGE` action to thread reducer for user message tracking

- [x] Phase 5: Wire up frontend to display generated names for TUI threads

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Key files

| File | Purpose |
| --- | --- |
| `core/lib/naming/thread-name.ts` | Shared thread naming logic (extracted) |
| `core/lib/naming/worktree-name.ts` | Shared worktree naming logic (extracted) |
| `agents/src/services/thread-naming-service.ts` | SDK wrapper (existing, updated to call core) |
| `agents/src/services/worktree-naming-service.ts` | SDK wrapper (existing, updated to call core) |
| `sidecar/src/hooks/hook-handler.ts` | New `handleUserPromptSubmit` route |
| `sidecar/src/hooks/naming.ts` | Fire-and-forget naming for TUI threads |
| `sidecar/src/hooks/hooks-writer.ts` | Updated to include `UserPromptSubmit` in hooks.json |

## Resolved decisions

1. `UserPromptSubmit` **over transcript parsing**: Hook gives the prompt immediately as a structured string. Transcript would require parsing JSONL after a tool call fires — too late and too fragile.
2. **First-message detection**: Check if thread has zero stored messages. Simple, reliable.
3. **Fire-and-forget naming**: Don't block the hook response waiting for Haiku LLM call. Name arrives async, frontend updates via broadcast.
4. **Shared naming in** `core/lib/`: Consistent with `core/lib/hooks/` pattern from hook-bridge plan.
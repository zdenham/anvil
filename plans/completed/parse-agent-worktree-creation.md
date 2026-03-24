# Intercept Agent Worktree Creation

## Problem

Agents can create worktrees in two ways that bypass Anvil's control:
1. **`EnterWorktree` tool** — Claude Code's built-in tool creates worktrees under `.claude/worktrees/`. Anvil has zero visibility.
2. **`git worktree add` via Bash** — Agent runs raw git commands. Same visibility problem.

We want Anvil to **own** worktree creation. The agent should never create worktrees on its own — it should request that Anvil create one, or at minimum Anvil should discover what was created and sync its state.

## Strategy: Two Layers of Defense

### Layer 1: Block `EnterWorktree` tool (prevent)

Use the SDK's `disallowedTools` option to remove `EnterWorktree` from the agent's available tools entirely. This is the cleanest approach — the model won't even know the tool exists.

**Additionally**, add a global override rule in the `PermissionEvaluator` as a belt-and-suspenders safety net. If `disallowedTools` is ever removed or misconfigured, the permission system will still deny it.

### Layer 2: Detect `git worktree add` via Bash PostToolUse (detect + sync)

We can't block `git worktree add` in Bash without also blocking legitimate git commands. Instead, detect it **after** execution in PostToolUse and trigger a `worktree_sync` so Anvil discovers the new worktree.

Also add system prompt guidance telling the agent not to create worktrees directly, so it avoids the pattern in the first place.

## Phases

- [x] Block `EnterWorktree` via SDK `disallowedTools` and permission evaluator override
- [x] Add system prompt guidance telling agent not to create worktrees
- [x] Add `WORKTREE_SYNCED` event to core event types and bridge
- [x] Add PostToolUse hook to detect `git worktree add` in Bash commands and emit sync event
- [x] Add frontend listener for `WORKTREE_SYNCED` to re-hydrate sidebar
- [x] Add tests for both the `EnterWorktree` denial and Bash worktree detection

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### 1. Block `EnterWorktree` via `disallowedTools` (agents/src/runners/shared.ts)

The SDK's `query()` accepts `disallowedTools: string[]` which removes tools from the model's context entirely. Add it to the `query()` call alongside the existing `tools` config:

```typescript
// In the query() call (~line 1363):
tools: agentConfig.tools,
disallowedTools: ["EnterWorktree", "EnterWorktree"],
```

Note: `EnterWorktree` is the SDK tool name. We list it to ensure the agent never sees it. The `EnterWorktree` tool creates worktrees under `.claude/worktrees/` which Anvil doesn't manage.

### 2. Permission Evaluator Safety Net (agents/src/lib/permission-evaluator.ts)

Add to `GLOBAL_OVERRIDES` as a belt-and-suspenders measure:

```typescript
export const GLOBAL_OVERRIDES: PermissionRule[] = [
  // ... existing overrides ...
  {
    toolPattern: "^EnterWorktree$",
    decision: "deny",
    reason: "Worktree creation is managed by Anvil. Use the Bash tool with `git worktree add` if you need a worktree, or ask the user to create one from the sidebar.",
  },
];
```

This fires if `disallowedTools` is ever bypassed or misconfigured. The deny reason also guides the agent toward the Bash fallback (which we detect in Layer 2).

### 3. System Prompt Guidance (agents/src/agent-types/simple.ts or shared-prompts.ts)

Add a section to the appended system prompt:

```markdown
## Worktree Policy

Do NOT use the `EnterWorktree` tool — it is disabled. Anvil manages worktree creation.
If your task requires a new worktree, inform the user and they will create one from the sidebar.
If you absolutely must create a worktree, use `git worktree add` via the Bash tool.
```

This goes in the agent's appended prompt so it's part of every conversation. Placement: in `shared-prompts.ts` or directly in the `simple.ts` agent config's `appendedPrompt`.

### 4. PostToolUse: Detect `git worktree add` in Bash (agents/src/runners/shared.ts)

In the existing PostToolUse hook, after the file-modifying tools block, add Bash command inspection:

```typescript
// Detect git worktree creation via Bash — trigger worktree sync
if (input.tool_name === "Bash") {
  const toolInput = input.tool_input as { command?: string };
  const command = toolInput.command ?? "";

  // Match: git worktree add <path> [<branch>]
  // Also matches: git worktree add -b <branch> <path>
  if (/git\s+worktree\s+add\b/.test(command)) {
    if (context.repoId) {
      emitEvent(EventName.WORKTREE_SYNCED, {
        repoId: context.repoId,
      }, "PostToolUse:git-worktree-add");

      logger.info(`[PostToolUse] Detected git worktree add command, triggering sync`);
    }
  }
}
```

This pattern matches the existing PostToolUse approach (file tracking, plan detection). We inspect `tool_input.command` (the Bash command string) rather than parsing the response. The regex is simple and intentionally broad — any `git worktree add` invocation triggers a sync.

### 5. New Event: `WORKTREE_SYNCED` (core/types/events.ts)

```typescript
// In EventName enum:
WORKTREE_SYNCED = "worktree:synced",

// In EventPayloads:
[EventName.WORKTREE_SYNCED]: {
  repoId: string;
};
```

Add to `BRIDGED_EVENTS` in `src/lib/event-bridge.ts` so it crosses the agent→frontend boundary.

### 6. Frontend Listener (src/entities/worktrees/listeners.ts)

```typescript
eventBus.on(EventName.WORKTREE_SYNCED, async ({ repoId }) => {
  // Call worktree_sync Tauri command to discover new worktrees on disk
  // Then re-hydrate the lookup store so sidebar updates
  await useRepoWorktreeLookupStore.getState().hydrate();
});
```

### 7. Key Files to Modify

| File | Change |
| --- | --- |
| `agents/src/runners/shared.ts` | Add `disallowedTools: ["EnterWorktree"]` to `query()` call |
| `agents/src/lib/permission-evaluator.ts` | Add `EnterWorktree` deny to `GLOBAL_OVERRIDES` |
| `agents/src/agent-types/shared-prompts.ts` | Add worktree policy section to system prompt |
| `agents/src/runners/shared.ts` | PostToolUse hook: detect `git worktree add` in Bash |
| `core/types/events.ts` | Add `WORKTREE_SYNCED` event |
| `src/lib/event-bridge.ts` | Add to `BRIDGED_EVENTS` |
| `src/entities/worktrees/listeners.ts` | Listen for `WORKTREE_SYNCED`, call sync + hydrate |

### 8. Why Not Block `git worktree add` in Bash?

We could add a permission rule to deny Bash commands matching `git worktree add`, but this is fragile:
- The agent could use `git -C /some/path worktree add` (different flag ordering)
- The command could be in a shell script or piped
- Blocking legitimate git operations is risky

Instead, we **detect and sync** — the worktree gets created, Anvil discovers it immediately, and the sidebar reflects reality. The system prompt guidance reduces the frequency of this path.

### 9. `EnterWorktree` via Sub-Agents

Sub-agents spawned by the manager agent inherit the same `query()` config. The `disallowedTools` and `GLOBAL_OVERRIDES` apply to all agents in the tree. No special handling needed for sub-agents.

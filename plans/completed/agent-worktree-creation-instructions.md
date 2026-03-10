# Agent Worktree Creation Instructions

## Problem

When an agent creates a worktree via `git worktree add`, it doesn't follow the same flow as the UI. The UI (`worktree_commands.rs`) does:

1. `git fetch origin`
2. Determine the default branch (`git symbolic-ref refs/remotes/origin/HEAD`)
3. Get the commit SHA of `origin/<default-branch>`
4. `git worktree add --detach <path> <commit>`
5. Falls back to `git worktree add --detach <path>` (local HEAD) if fetch fails

The current agent `WORKTREE_POLICY` in `agents/src/agent-types/shared-prompts.ts` just says:

```
If you absolutely must create a worktree, use `git worktree add` via the Bash tool.
```

This means agents create worktrees at local HEAD, which may be stale — missing recent remote commits.

## Solution

Update `WORKTREE_POLICY` in `agents/src/agent-types/shared-prompts.ts` to include step-by-step instructions matching the UI flow.

## Phases

- [x] Update `WORKTREE_POLICY` in `agents/src/agent-types/shared-prompts.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Change

**File:** `agents/src/agent-types/shared-prompts.ts`

Replace the `WORKTREE_POLICY` constant with:

```typescript
export const WORKTREE_POLICY = `## Worktree Policy

Do NOT use the \`EnterWorktree\` tool — it is disabled. Mort manages worktree creation.
If your task requires a new worktree, inform the user and they will create one from the sidebar.

If you absolutely must create a worktree via Bash, follow this flow to match the UI:

\`\`\`bash
# 1. Fetch latest from origin
git fetch origin

# 2. Get the default branch name
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@')

# 3. Get the remote HEAD commit
COMMIT=$(git rev-parse "origin/$DEFAULT_BRANCH")

# 4. Create worktree detached at that commit
git worktree add --detach <path> "$COMMIT"
\`\`\`

This ensures the worktree starts from the latest remote default branch, not your local HEAD which may be stale.`;
```

This gives agents the exact same starting point as UI-created worktrees: a detached HEAD at the tip of `origin/<default-branch>`.

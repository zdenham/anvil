# Merge Agent Refinement Plan

## Overview

Simplify and refine the merge agent with:
1. A cleaner solo dev workflow (rebase on LOCAL main, then ff-only merge)
2. Simplified settings (remove rebase/merge choice - always rebase)
3. Better unhappy path handling with human intervention

---

## Settings Changes

### Current → New

| Current | New |
|---------|-----|
| `MergeDestination`: "local" \| "pull-request" | `WorkflowMode`: "solo" \| "team" |
| `MergeMethod`: "merge" \| "rebase" | **Removed** (always rebase) |

### Files to Modify

1. **`src/entities/settings/types.ts`**
   - Remove `MergeMethod` type
   - Rename `MergeDestination` → `WorkflowMode` with values "solo" \| "team"
   - Update `WorkspaceSettings` interface
   - Update `DEFAULT_WORKSPACE_SETTINGS`

2. **`src/entities/settings/store.ts`**
   - Remove `getMergeMethod()` selector
   - Rename `getMergeDestination()` → `getWorkflowMode()`

3. **`src/components/main-window/settings/merge-settings.tsx`**
   - Remove "Merge Method" radio group
   - Update labels: "Solo dev" / "Work on a team"
   - Update descriptions to explain each mode

4. **`agents/src/agent-types/merge-types.ts`**
   - Mirror the type changes (remove `MergeMethod`, rename `MergeDestination`)
   - Update `MergeContext` interface

5. **`src/lib/agent-service.ts:buildMergeContextForTask()`**
   - Update to use new type names

---

## Merge Agent Prompt Changes

### File: `agents/src/agent-types/merge.ts`

#### Remove
- `buildMergeLocalInstructions()` (merge + local)
- `buildMergePRInstructions()` (merge + PR)
- The 2x2 strategy matrix logic

#### Replace With

**Solo Dev Workflow** (`buildSoloDevInstructions()`)

Happy path:
```
1. Check main worktree for uncommitted changes
   git -C <mainWorktreePath> status --porcelain
   → If NOT empty: request human review ("main has uncommitted changes")

2. Check if main is behind origin (fetch refs only, don't update main)
   git -C <mainWorktreePath> fetch origin <baseBranch> --dry-run 2>&1 | grep -q "would update"
   OR: git -C <mainWorktreePath> fetch origin && compare refs
   → If behind: request human review ("main is behind origin, please pull")

3. Rebase task branch onto LOCAL main (no remote fetch)
   # Get the commit SHA of local main from the main worktree
   MAIN_SHA=$(git -C <mainWorktreePath> rev-parse <baseBranch>)
   git rebase $MAIN_SHA
   → If conflicts: see conflict handling

4. Fast-forward merge in main worktree
   # Task branch is visible since worktrees share the same git repo
   git -C <mainWorktreePath> merge --ff-only <taskBranch>
   → If fails: request human review

5. Report success with commit hash
```

**Team Workflow** (`buildTeamInstructions()`)

```
1. Verify clean state in task worktree

2. Fetch and rebase onto origin/main
   git fetch origin <baseBranch>
   git rebase origin/<baseBranch>
   → If conflicts: see conflict handling

3. Push rebased branch
   git push origin <taskBranch> --force-with-lease

4. Create or find PR
   gh pr list --head <taskBranch> ...
   gh pr create ...

5. Store PR URL and report
```

#### Update `buildStrategyInstructions()`

```typescript
function buildStrategyInstructions(context: MergeContext): string {
  return context.workflowMode === 'solo'
    ? buildSoloDevInstructions(context)
    : buildTeamInstructions(context);
}
```

---

## Conflict Handling Updates

The existing `CONFLICT_HANDLING` section is good. Add these clarifications:

**For Solo Dev:**
- If conflicts during rebase are too complex (>5 files, semantic conflicts):
  - `git rebase --abort`
  - Request human review with details

**For Team:**
- Same approach, but conflicts can be resolved then pushed
- Human can resolve conflicts in a PR review

---

## Unhappy Path Summary

| Scenario | Action |
|----------|--------|
| Main worktree has uncommitted changes | Request human review |
| Main branch behind origin (missing remote commits) | Request human review |
| Simple rebase conflicts (<5 files, non-semantic) | Auto-resolve |
| Complex rebase conflicts | Abort, request human review |
| `--ff-only` merge fails | Request human review |

**Behind Check Logic (Solo Dev):**
```bash
# Fetch remote refs only (doesn't update local branches)
git -C <mainWorktreePath> fetch origin <baseBranch>

# Count commits main is behind origin
BEHIND=$(git -C <mainWorktreePath> rev-list --count <baseBranch>..origin/<baseBranch>)

if [ "$BEHIND" -gt 0 ]; then
  # Request human review - main is behind origin
fi
```

Note: `git fetch` updates remote-tracking refs (origin/main) but does NOT update the local main branch. This is safe.

Note: Main being AHEAD of origin (unpushed local commits) is allowed - solo devs may have local commits they haven't pushed yet.

---

## Implementation Order

1. **Settings types** (`types.ts`, `merge-types.ts`)
2. **Settings store** (`store.ts`)
3. **Settings UI** (`merge-settings.tsx`)
4. **Merge agent prompts** (`merge.ts`)
5. **Context builder** (`agent-service.ts`)

---

## Files to Modify (Complete List)

| File | Changes |
|------|---------|
| `src/entities/settings/types.ts` | Remove `MergeMethod`, rename `MergeDestination` → `WorkflowMode` |
| `src/entities/settings/store.ts` | Update selectors |
| `src/components/main-window/settings/merge-settings.tsx` | Simplify UI, update labels |
| `agents/src/agent-types/merge-types.ts` | Mirror type changes |
| `agents/src/agent-types/merge.ts` | Rewrite workflow prompts |
| `src/lib/agent-service.ts` | Update `buildMergeContextForTask()` |

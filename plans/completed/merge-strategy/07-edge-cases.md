# Edge Cases & Considerations

Reference document for handling edge cases during implementation.

---

## Merge Conflicts

**Scenario:** Git merge or rebase encounters conflicts.

**Handling:**
- Merge agent detects and reports conflicts via `pendingReview`
- Lists conflicting files clearly
- User can provide guidance ("resolve X by keeping theirs")
- Agent attempts resolution or asks user to resolve manually
- If unresolvable, task stays in `in_review` for manual intervention

---

## PR Creation Failures

**Scenario:** GitHub PR creation fails.

**Possible causes:**
- Auth failure: `gh` not authenticated
- Remote failure: network issues, permissions
- Branch already has PR

**Handling:**
- Agent reports specific error
- For auth: suggests `gh auth login`
- For existing PR: reports PR URL, asks how to proceed
- Store PR URL in task when created for reference

---

## Dirty Working Directory

**Scenario:** Uncommitted changes exist when merge agent runs.

**Handling:**
- Merge agent checks `git status` first
- If dirty, reports uncommitted files
- Asks user to commit or stash before proceeding
- Does NOT proceed with merge to avoid mixing changes

---

## Branch Protection

**Scenario:** Local merge to protected branch fails.

**Handling:**
- Agent detects push/merge rejection
- Reports protection rule violation
- Suggests switching to PR strategy for this task
- User can update settings or override

---

## Offline Mode

**Scenario:** No network connectivity.

**Handling:**
- Local merge works normally offline
- PR creation fails gracefully with clear error
- Agent suggests retrying when online or switching to local merge

---

## Cancelling During Merge

**Scenario:** User cancels or interrupts merge operation.

**Handling:**
- Task stays in `in_review` status
- `reviewApproved` stays `true` (still in merge phase)
- Next interaction spawns merge agent again
- User can provide feedback to change behavior
- User can explicitly request re-review by providing feedback

---

## Task Lifecycle: Branch Cleanup

**On task completion:**

```typescript
async function onTaskComplete(task: TaskMetadata, repoName: string) {
  const settings = settingsStore.getState();

  if (settings.getMergeDestination() === "local") {
    // Delete task branch after local merge
    await workspaceService.deleteTaskBranch(repoName, task.id);
  }
  // PR-based tasks: branch needed until PR merged on GitHub

  // Worktree can be released regardless
  await workspaceService.releaseWorktree(repoName, task.id);
}
```

---

## Subtask Handling

Subtasks merge into their parent task's branch, not the base branch:

```typescript
function getBaseBranchForTask(task: TaskMetadata): string {
  if (task.parentId) {
    const parent = taskStore.getState().getTask(task.parentId);
    if (parent?.branchName) {
      return parent.branchName;  // Merge into parent's branch
    }
  }
  return defaultBranch;  // Top-level tasks merge to main/master
}
```

---

## Recovery Scenarios

**Merge failed mid-operation:**
- Check git state with `git status`
- If in merge conflict state: `git merge --abort` or resolve
- If rebase interrupted: `git rebase --abort` or continue
- Agent should detect and offer appropriate recovery

**PR created but not recorded:**
- Agent can search for existing PRs: `gh pr list --head <branch>`
- If found, record URL and continue

**Task stuck in in_review:**
- User can drag back to `in_progress` to request more work
- Or provide feedback to guide merge agent
- Or manually complete if merge already done

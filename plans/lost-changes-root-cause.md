# Lost Changes Root Cause Analysis

## Finding: `git stash` + failed pop + `git stash drop` destroyed accumulated work

The original hypothesis was that `git checkout --force` (from Tauri's `git_checkout_branch` or `git_checkout_commit`) destroyed uncommitted modifications. **This is not what happened.** A thorough search of the drain database and all thread state files found **no evidence** of any agent calling `git checkout --force`, `git reset --hard`, or any other destructive checkout on the mortician repo.

### Actual Root Cause

Thread `a565f16e` (tiptap-parity work) at **7:17 PM Mar 7** ran a stash-based type-checking sequence that destroyed all accumulated uncommitted modifications from every agent that had been running that evening.

#### The sequence (drain.db evidence)

```
19:17:03  git stash && npx tsc --noEmit --pretty 2>&1 | head -20; git stash pop
          → git stash captured ALL tracked file modifications from the working tree
          → git stash pop FAILED (Cargo.lock conflicts)
          → Stash still exists, working tree in partial conflict state

19:17:13  git stash pop 2>&1 || git checkout stash -- src/index.css \
            src/components/content-pane/plan-content.tsx \
            src/components/content-pane/tiptap-editor.tsx 2>&1; \
          git stash drop 2>&1
          → git stash pop FAILS again (same Cargo.lock conflicts)
          → || fallback: restores ONLY 3 files this thread cared about
          → git stash drop DELETES THE ENTIRE STASH
          → All other agents' tracked file modifications: permanently gone
```

The agent's own thinking block confirms: _"The stash pop failed because of Cargo.lock conflicts"_ and later _"The stash overwrote my changes"_ — it noticed its own files were affected and recovered them, but had no awareness of other agents' work in the stash.

#### Why this matches the loss pattern perfectly

- **`git stash` (default)** captures only tracked file modifications — NOT untracked files
- **New component files** (untracked) → survived, because stash didn't touch them
- **Integration edits to existing files** (tracked modifications) → lost, because they were in the stash that got dropped
- **No branch/reflog evidence** → `git stash drop` removes the stash ref, making recovery via reflog temporary

#### Timeline confirmation

| Time | Event |
|------|-------|
| 4:29 PM – 6:47 PM | ~15 agent threads running plans, editing tracked files on main worktree |
| 6:47 PM | Last agent thread before the incident completes (366c37bb) |
| 7:13 PM | Thread a565f16e starts (tiptap-parity, turn 2) |
| **7:17:03 PM** | **`git stash` captures all accumulated modifications** |
| **7:17:13 PM** | **Failed pop → selective restore → `git stash drop` destroys everything** |
| 7:18:19 PM | Agent recovers its own 3 files from dropped stash SHA (`1b7f837`) |
| 7:19 PM – 7:22 PM | More agents start (quick-actions audit, trim quick actions) |
| 11:01 PM – 11:30 PM | Late-night threads (build fixes, sidebar-refactor worktree) |
| ~midnight | v0.0.59 commit — only new/untracked files staged |

### Why `git checkout --force` hypothesis was wrong

- `checkoutBranch()` and `checkoutCommit()` are defined in `tauri-commands.ts` but have **zero callers** in the frontend code
- No agent called `git_checkout_branch` or `git_checkout_commit` via WebSocket dispatch
- The drain database records every agent tool call — no `git checkout --force` or `git reset --hard` found
- Worktree creation at 11:07 PM used safe `git worktree add --detach`, not force-checkout

### Preventive measures

1. **Ban `git stash` in agent Bash commands** — agents should never stash in a shared working tree. Use `git diff > /tmp/patch && ... && git apply /tmp/patch` or `git worktree` isolation instead.

2. **Add a PreToolUse hook** that denies Bash commands containing `git stash`, `git checkout --`, `git reset --hard`, `git clean -f` when operating on the main worktree.

3. **Remove `--force` from `git_checkout_branch`/`git_checkout_commit`** — even though they weren't the cause this time, they remain dangerous. Use `git switch` without force, or at minimum check for uncommitted changes first.

4. **Isolate agents in worktrees** — each agent thread should operate in its own git worktree so stash/checkout operations can't affect other agents' work.

---

_Evidence sources: drain.db tool events, thread a565f16e state.json (thinking blocks confirming Cargo.lock conflict), thread metadata, repository settings.json_

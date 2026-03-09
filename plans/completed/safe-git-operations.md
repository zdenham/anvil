# Safe Git Operations

Prevent destructive git operations from silently discarding uncommitted work. Motivated by the v0.0.59 incident where `git stash` + failed pop + `git stash drop` destroyed all accumulated tracked-file modifications from concurrent agent threads (see `plans/lost-changes-root-cause.md`).

## Phases

- [x] Add PreToolUse hook to ban destructive git commands

- [x] Remove `--force` from checkout commands (defense in depth)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Root cause (updated)

The original hypothesis blamed `git checkout --force`. The actual root cause was an agent running `git stash` in the shared main worktree, which captured every concurrent agent's tracked modifications into a single stash entry. The stash pop failed (Cargo.lock conflicts), the agent selectively restored only its own 3 files, then ran `git stash drop` — permanently destroying all other agents' work. See `plans/lost-changes-root-cause.md` for full timeline.

## Phase 1: Add PreToolUse hook to ban destructive git commands

### Goal

Deny agent Bash commands that contain destructive git operations when targeting the main worktree. This is the primary preventive measure.

### Banned commands

| Pattern | Reason |
| --- | --- |
| `git stash` | Captures all tracked modifications — catastrophic in shared worktree with concurrent agents |
| `git checkout --force` / `git checkout -f` | Silently discards uncommitted changes |
| `git reset --hard` | Discards all uncommitted changes |
| `git clean -f` | Deletes untracked files |
| `git checkout -- .` / `git restore .` | Discards all working tree changes (specific-file variants are OK) |

### Implementation

Add a PreToolUse hook in the agent runner that fires on `Bash` tool calls. The hook should:

1. **Extract the command string** from the tool input
2. **Check against banned patterns** using regex matching (not naive substring — avoid false positives on e.g. `git stash list` or `git log --force`)
3. **Check worktree context** — only deny when the command runs in the main repo worktree. Commands in agent-owned worktrees (`.claude/worktrees/`, `.mort/worktrees/`) are fine.
4. **Return** `deny` **with a clear message** explaining why the command was blocked and suggesting alternatives:
   - Instead of `git stash`: use `git diff > /tmp/patch.diff && ... && git apply /tmp/patch.diff`
   - Instead of `git checkout --force`: use `git checkout` (without force) and handle conflicts
   - Instead of `git reset --hard`: commit or diff-patch first

### File changes

`agents/src/hooks/safe-git-hook.ts` (new file)

- Export a hook function that matches `Bash` tool use
- Regex patterns for each banned command
- Worktree detection logic (check cwd against known worktree paths)
- Return `{ deny: true, message: "..." }` on match

`agents/src/runner.ts`

- Import and register the safe-git hook in the hooks array passed to `runAgentLoop`

### Regex patterns (draft)

```typescript
const BANNED_PATTERNS = [
  // git stash (but not git stash list, git stash show)
  /\bgit\s+stash\b(?!\s+(list|show))/,
  // git checkout with --force or -f
  /\bgit\s+checkout\s+.*(-f|--force)\b/,
  // git reset --hard
  /\bgit\s+reset\s+--hard\b/,
  // git clean with -f
  /\bgit\s+clean\s+.*-[a-zA-Z]*f/,
  // git checkout -- . (blanket discard, but not single-file checkout)
  /\bgit\s+checkout\s+--\s+\./,
  // git restore . (blanket discard)
  /\bgit\s+restore\s+\./,
];
```

### Testing

- Unit tests in `agents/src/hooks/__tests__/safe-git-hook.test.ts`
- Test each pattern matches the dangerous variant and does NOT match safe variants
- Test worktree exemption logic

## Phase 2: Remove `--force` from checkout commands (defense in depth)

Even though `git checkout --force` was not the root cause, the `--force` flag on these commands is still dangerous and should be removed as defense in depth.

### Changes

`src-tauri/src/git_commands.rs`

1. `git_checkout_branch` — Remove `--force`:

   ```rust
   // Before
   .args(["checkout", "--force", &branch])
   // After
   .args(["checkout", &branch])
   ```

2. `git_checkout_commit` — Remove `--force`:

   ```rust
   // Before
   .args(["checkout", "--force", "--detach", &commit])
   // After
   .args(["checkout", "--detach", &commit])
   ```

3. Update doc comments on both functions to remove "with force to discard uncommitted changes".

`src/lib/tauri-commands.ts`

4. Update JSDoc on `checkoutBranch` and `checkoutCommit` to remove force/discard references.

### Remaining `--force` usages (audited, all acceptable)

| Location | Command | Verdict |
| --- | --- | --- |
| `git_commands.rs:465` | `git worktree remove --force` | OK — worktrees are ephemeral |
| `git_commands.rs:997` | `git rm --force` | OK — intentional file deletion |
| `filesystem.rs:284` | `git worktree add --force --detach` | OK — overrides stale registrations |
| `filesystem.rs:306` | `git worktree remove --force` | OK — same as above |
| `git_commands.rs:349` | `git branch -D` | OK — only mort-managed branches |

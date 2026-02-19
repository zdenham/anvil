# Fix: Per-Thread Diff View — Unstaged Files + Multi-Turn Accumulation

## Problem

Two related issues with the per-thread diff view:

1. **Unstaged/untracked files show no diff.** The Rust backend relies on an `operation` label from the agent to route diff strategy. When the label is wrong (common), untracked files get routed through `git diff <base_commit>` which returns nothing.

2. **Multi-turn conversations only show the latest turn's changes.** The `fileChanges` array is reset to `[]` on every turn resume. Changes from prior turns are lost.

## Phases

- [x] Simplify Rust backend to determine tracking status from git itself
- [x] Persist fileChanges across turns in the agent state pipeline
- [ ] Verify both fixes with manual testing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Issue 1: Unstaged/Untracked Files

### Root Cause

**File:** `src-tauri/src/git_commands.rs:535-537`

The backend partitions files by the `operation` field sent from the frontend:

```rust
let (new_files, tracked_files): (Vec<_>, Vec<_>) = requests
    .into_iter()
    .partition(|r| r.operation == "create");
```

- `"create"` → synthetic diff (read from disk, all lines as `+`)
- anything else → `git diff <base_commit> -- <file>`

The operation label comes from `shared.ts:690`, which naively assigns `"create"` for `Write` and `"modify"` for `Edit`. This is wrong in many cases (e.g., `Edit` after `Write` overwrites operation to `"modify"`). When an untracked file gets labeled `"modify"`, `git diff` returns empty.

**The operation label shouldn't matter for diff generation.** Git already knows which files exist at a given commit.

### Fix

Replace the operation-based partition with a `git ls-tree` check. The function should:

1. Accept just file paths (ignore operations for routing)
2. Use `git ls-tree <base_commit>` to determine which files exist at the base commit
3. Files in the tree → `git diff <base_commit> -- <file>`
4. Files NOT in the tree → `generate_new_file_diff()` (synthetic)

```rust
pub async fn git_diff_files(
    repo_path: String,
    base_commit: String,
    file_paths: Vec<String>,
    file_requests: Option<Vec<FileDiffRequest>>,
) -> Result<String, String> {
    // Collect all paths (support both calling conventions)
    let all_paths: Vec<String> = if let Some(requests) = file_requests {
        requests.into_iter().map(|r| r.path).collect()
    } else {
        file_paths
    };

    if all_paths.is_empty() {
        return Ok(String::new());
    }

    // Ask git which files exist at the base commit
    let ls_output = shell::command("git")
        .args(&["ls-tree", "--name-only", "-r", &base_commit])
        .current_dir(&repo_path)
        .output()
        .map_err(|e| format!("Failed to list files at base commit: {}", e))?;

    let tracked_at_base: HashSet<String> = String::from_utf8_lossy(&ls_output.stdout)
        .lines()
        .map(|s| s.to_string())
        .collect();

    let (tracked, untracked): (Vec<_>, Vec<_>) = all_paths
        .into_iter()
        .partition(|p| tracked_at_base.contains(p));

    let mut all_diffs = Vec::new();

    // Tracked files: git diff
    if !tracked.is_empty() {
        let mut args = vec!["diff".to_string(), base_commit.clone(), "--".to_string()];
        args.extend(tracked);
        let output = shell::command("git")
            .args(&args)
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to execute git diff: {}", e))?;
        let diff_output = String::from_utf8_lossy(&output.stdout).to_string();
        if !diff_output.is_empty() {
            all_diffs.push(diff_output);
        }
    }

    // Untracked files: synthetic diff
    for path in untracked {
        match generate_new_file_diff(&repo_path, &path) {
            Ok(diff) if !diff.is_empty() => all_diffs.push(diff),
            Err(e) => tracing::warn!("Failed to generate diff for new file {}: {}", path, e),
            _ => {}
        }
    }

    Ok(all_diffs.join("\n"))
}
```

Function signature stays the same (backward compatible), it just stops using `operation` for routing.

**File to modify:** `src-tauri/src/git_commands.rs`

---

## Issue 2: Multi-Turn File Changes Lost

### Root Cause

`fileChanges` is reset to `[]` every time a thread resumes for a new turn. The data is never carried forward.

**The reset** — `agents/src/output.ts:91`:
```typescript
state = {
    messages: priorMessages,
    fileChanges: [],  // ← always empty on resume
    // ...
};
```

**The missing load** — `agents/src/runner.ts:35-99` (`loadPriorState`):

The function loads `messages`, `sessionId`, `toolStates`, `lastCallUsage`, and `cumulativeUsage` from the prior state file — but **not `fileChanges`**. The `PriorState` interface (`shared.ts:374-385`) doesn't even have a `fileChanges` field.

**Result:** Turn 1 writes `fileChanges: [a.ts, b.ts]` to `state.json`. Turn 2 starts, resets to `fileChanges: []`, only accumulates turn 2's changes. The frontend reads `state.json` and only sees the latest turn.

### Fix

Thread `fileChanges` through the same pattern used for all other persisted state:

**1. Add to `PriorState` interface** (`agents/src/runners/shared.ts:374`):
```typescript
export interface PriorState {
  messages: MessageParam[];
  sessionId?: string;
  toolStates?: Record<string, ToolExecutionState>;
  lastCallUsage?: TokenUsage;
  cumulativeUsage?: TokenUsage;
  fileChanges?: FileChange[];  // NEW
}
```

**2. Load in `loadPriorState`** (`agents/src/runner.ts:54-92`):
```typescript
// Load prior file changes so diffs accumulate across turns
if (Array.isArray(state.fileChanges)) {
  result.fileChanges = state.fileChanges;
  logger.info(`[runner] Loaded ${state.fileChanges.length} prior file changes`);
}
```

**3. Accept in `initState`** (`agents/src/output.ts:76-101`):
```typescript
export async function initState(
  threadPath: string,
  workingDirectory: string,
  priorMessages: MessageParam[] = [],
  writer?: ThreadWriter,
  priorSessionId?: string,
  priorToolStates?: Record<string, ToolExecutionState>,
  priorLastCallUsage?: TokenUsage,
  priorCumulativeUsage?: TokenUsage,
  priorFileChanges?: FileChange[],  // NEW
): Promise<void> {
  state = {
    messages: priorMessages,
    fileChanges: priorFileChanges ?? [],  // preserve prior changes
    // ...
  };
}
```

**4. Pass through `runAgentLoop`** (`agents/src/runners/shared.ts:420`):

Extract `fileChanges` from `priorState` and pass to `initState`.

### Files to Modify

| File | Change |
|------|--------|
| `agents/src/runners/shared.ts` | Add `fileChanges` to `PriorState`, pass to `initState` |
| `agents/src/runner.ts` | Load `fileChanges` in `loadPriorState` |
| `agents/src/output.ts` | Accept `priorFileChanges` param in `initState`, use instead of `[]` |

---

## Notes

- The agent-side operation labels (`shared.ts:690`) are still slightly wrong but that's a separate concern — they're used for UI display in the changes tab, not for diff generation after Issue 1 is fixed.
- `git ls-tree -r <base_commit>` lists all files at that commit. For very large repos this could be slow; if needed we could check individual files with `git cat-file -e <base_commit>:<path>` instead.
- `updateFileChange` in `output.ts` already deduplicates by path (replaces existing entry), so loading prior changes and then accumulating new ones within a turn works correctly — if the agent modifies the same file again, it updates in place.

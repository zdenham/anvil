# 04 - Runner Updates

**Tier:** 2
**Depends on:** 01-types, 02-git-utilities
**Parallelizable with:** 03-workspace-service
**Blocking:** 05-agent-service

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Runner CLI interface - used by: 05-agent-service
interface RunnerArgs {
  agentType: string;
  cwd: string;
  prompt: string;
  conversationId: string;
  taskId: string;
  parentTaskId?: string;  // NEW: For subtask support
  mergeBase?: string;     // NEW: Passed from workspace allocation
  historyFile?: string;
}
```

### Imports (This Plan Depends On)

```typescript
// From 02-git-utilities
import { getDefaultBranch } from "./git";
```

---

## Implementation

### File: `agents/src/runner.ts`

#### 1. Update Argument Parsing

```typescript
interface Args {
  agentType: string;
  cwd: string;
  prompt: string;
  conversationId: string;
  taskId: string;
  parentTaskId?: string;  // NEW
  mergeBase?: string;     // NEW
  historyFile?: string;
}

function parseArgs(): Args {
  const args: Partial<Args> = {};

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];

    switch (arg) {
      case "--agent":
        args.agentType = process.argv[++i];
        break;
      case "--cwd":
        args.cwd = process.argv[++i];
        break;
      case "--prompt":
        args.prompt = process.argv[++i];
        break;
      case "--conversation-id":
        args.conversationId = process.argv[++i];
        break;
      case "--task-id":
        args.taskId = process.argv[++i];
        break;
      case "--parent-task-id":  // NEW
        args.parentTaskId = process.argv[++i];
        break;
      case "--merge-base":      // NEW
        args.mergeBase = process.argv[++i];
        break;
      case "--history-file":
        args.historyFile = process.argv[++i];
        break;
    }
  }

  // Validate required args
  if (!args.agentType || !args.cwd || !args.prompt ||
      !args.conversationId || !args.taskId) {
    throw new Error("Missing required arguments");
  }

  return args as Args;
}
```

#### 2. Remove Old Merge Base Logic

**Before:**
```typescript
// This should be REMOVED
function getMergeBase(cwd: string): string {
  try {
    // Try to find merge base with default branch
    const defaultBranch = "main"; // hardcoded!
    return execFileSync("git", ["merge-base", "HEAD", defaultBranch], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    // Fallback to HEAD~1
    return execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  }
}
```

**After:**
```typescript
// Use passed merge base, with fallback for backward compatibility
function getMergeBase(args: Args): string {
  // Prefer explicitly passed merge base
  if (args.mergeBase) {
    return args.mergeBase;
  }

  // Fallback for backward compatibility (should rarely happen)
  try {
    const defaultBranch = getDefaultBranch(args.cwd);
    return execFileSync("git", ["merge-base", "HEAD", defaultBranch], {
      cwd: args.cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    // Ultimate fallback
    return execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: args.cwd,
      encoding: "utf-8",
    }).trim();
  }
}
```

#### 3. Update Diff Generation

Ensure all diff-related code uses the merge base from args:

```typescript
// In getGitDiff or similar function
function getGitDiff(args: Args): string {
  const mergeBase = getMergeBase(args);

  return execFileSync("git", ["diff", mergeBase, "HEAD"], {
    cwd: args.cwd,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10MB
  }).toString();
}
```

#### 4. Pass Task Context to Agent

The agent may need to know about parent tasks for context:

```typescript
// When initializing agent context
const context = {
  taskId: args.taskId,
  parentTaskId: args.parentTaskId,  // NEW
  conversationId: args.conversationId,
  workingDirectory: args.cwd,
  mergeBase: getMergeBase(args),
  // ... other context
};
```

---

## CLI Usage Examples

```bash
# Standard task
node runner.js \
  --agent planner \
  --cwd /path/to/worktree \
  --prompt "Add user authentication" \
  --conversation-id conv-123 \
  --task-id task-456 \
  --merge-base a1b2c3d4

# Subtask
node runner.js \
  --agent coder \
  --cwd /path/to/worktree \
  --prompt "Implement login form" \
  --conversation-id conv-789 \
  --task-id task-sub-1 \
  --parent-task-id task-456 \
  --merge-base f6e5d4c3
```

---

## Backward Compatibility

The runner should still work without `--merge-base` for:
- Existing conversations being resumed
- Manual testing/debugging

The fallback uses `getDefaultBranch()` from 02-git-utilities instead of hardcoded "main".

---

## Verification

- [ ] New CLI arguments parse correctly
- [ ] Merge base from args is used when provided
- [ ] Fallback works when merge base not provided
- [ ] Parent task ID is passed to agent context
- [ ] Diff generation uses correct merge base

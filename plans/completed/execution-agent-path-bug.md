# Execution Agent Path Resolution Bug

## Problem Summary

The execution agent is looking for content in the working directory instead of using the absolute path to the `.mort` directory. This causes the agent to fail when reading task metadata and other persisted content.

## Bug Location

**Primary File:** `agents/src/cli/mort.ts` (line 15)

```typescript
const persistence = new NodePersistence();
```

## Root Cause

The CLI creates a `NodePersistence` instance **without passing the `mortDir` argument**.

Looking at `NodePersistence` in `agents/src/lib/persistence-node.ts` (lines 23-26):

```typescript
constructor(mortDir?: string) {
  super();
  // Priority: constructor arg > MORT_DATA_DIR env var > default ~/.mort
  this.mortDir = mortDir ?? process.env.MORT_DATA_DIR ?? join(homedir(), ".mort");
}
```

When `NodePersistence()` is called with no arguments:
1. It checks for `MORT_DATA_DIR` environment variable
2. If not set, defaults to `~/.mort` (user's home directory)

This is incorrect because the actual `.mort` directory may be located elsewhere (e.g., in a workspace-specific location).

## Contrast with Correct Implementation

The runner in `agents/src/runner.ts` correctly handles this:

```typescript
// Line 190-191: Receives mortDir via CLI argument
.option("--mort-dir <mortDir>", "Data directory for mort")

// Line 260: Passes it to persistence
const persistence = new NodePersistence(args.mortDir);

// Line 251: Uses it for thread paths
const threadPath = join(args.mortDir, "threads", args.threadId);
```

## Impact

When the execution agent runs CLI commands like:
- `mort tasks get --id=<task-id>`
- `mort tasks list`
- `mort tasks update --id=<task-id> --status=done`

These commands read from `~/.mort/` instead of the actual centralized `.mort` directory, causing:
- Tasks not found errors
- Stale or missing task metadata
- Agent appearing "confused" about where content is located

## Files Affected

| File | Issue |
|------|-------|
| `agents/src/cli/mort.ts` | Creates persistence without `mortDir` argument (line 15) |
| `agents/src/lib/persistence-node.ts` | Path resolution depends on constructor arg (line 30) |
| `agents/src/lib/workspace.ts` | `readTasksDirectory()` assumes `.mort` is in working directory (line 30) |

## Proposed Fix

### Option 1: Add `--mort-dir` flag to CLI commands

Modify `mort.ts` to accept a `--mort-dir` argument and pass it to `NodePersistence`:

```typescript
program
  .option("--mort-dir <mortDir>", "Data directory for mort")

// Then in command handlers:
const persistence = new NodePersistence(program.opts().mortDir);
```

### Option 2: Ensure runner passes `MORT_DATA_DIR` environment variable

When spawning the agent process, ensure the `MORT_DATA_DIR` environment variable is set to the correct absolute path.

### Option 3: Both

Implement both for redundancy - the CLI flag takes precedence, falling back to env var.

## Related Code Paths

1. **Task creation flow**: Spotlight -> Tauri -> Runner -> Persistence
2. **Task reading flow**: Agent -> CLI -> Persistence (BROKEN - uses wrong path)
3. **Thread storage**: Runner correctly uses `mortDir` for thread paths

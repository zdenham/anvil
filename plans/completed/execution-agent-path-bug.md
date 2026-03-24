# Execution Agent Path Resolution Bug

## Problem Summary

The execution agent is looking for content in the working directory instead of using the absolute path to the `.anvil` directory. This causes the agent to fail when reading task metadata and other persisted content.

## Bug Location

**Primary File:** `agents/src/cli/anvil.ts` (line 15)

```typescript
const persistence = new NodePersistence();
```

## Root Cause

The CLI creates a `NodePersistence` instance **without passing the `anvilDir` argument**.

Looking at `NodePersistence` in `agents/src/lib/persistence-node.ts` (lines 23-26):

```typescript
constructor(anvilDir?: string) {
  super();
  // Priority: constructor arg > ANVIL_DATA_DIR env var > default ~/.anvil
  this.anvilDir = anvilDir ?? process.env.ANVIL_DATA_DIR ?? join(homedir(), ".anvil");
}
```

When `NodePersistence()` is called with no arguments:
1. It checks for `ANVIL_DATA_DIR` environment variable
2. If not set, defaults to `~/.anvil` (user's home directory)

This is incorrect because the actual `.anvil` directory may be located elsewhere (e.g., in a workspace-specific location).

## Contrast with Correct Implementation

The runner in `agents/src/runner.ts` correctly handles this:

```typescript
// Line 190-191: Receives anvilDir via CLI argument
.option("--anvil-dir <anvilDir>", "Data directory for anvil")

// Line 260: Passes it to persistence
const persistence = new NodePersistence(args.anvilDir);

// Line 251: Uses it for thread paths
const threadPath = join(args.anvilDir, "threads", args.threadId);
```

## Impact

When the execution agent runs CLI commands like:
- `anvil tasks get --id=<task-id>`
- `anvil tasks list`
- `anvil tasks update --id=<task-id> --status=done`

These commands read from `~/.anvil/` instead of the actual centralized `.anvil` directory, causing:
- Tasks not found errors
- Stale or missing task metadata
- Agent appearing "confused" about where content is located

## Files Affected

| File | Issue |
|------|-------|
| `agents/src/cli/anvil.ts` | Creates persistence without `anvilDir` argument (line 15) |
| `agents/src/lib/persistence-node.ts` | Path resolution depends on constructor arg (line 30) |
| `agents/src/lib/workspace.ts` | `readTasksDirectory()` assumes `.anvil` is in working directory (line 30) |

## Proposed Fix

### Option 1: Add `--anvil-dir` flag to CLI commands

Modify `anvil.ts` to accept a `--anvil-dir` argument and pass it to `NodePersistence`:

```typescript
program
  .option("--anvil-dir <anvilDir>", "Data directory for anvil")

// Then in command handlers:
const persistence = new NodePersistence(program.opts().anvilDir);
```

### Option 2: Ensure runner passes `ANVIL_DATA_DIR` environment variable

When spawning the agent process, ensure the `ANVIL_DATA_DIR` environment variable is set to the correct absolute path.

### Option 3: Both

Implement both for redundancy - the CLI flag takes precedence, falling back to env var.

## Related Code Paths

1. **Task creation flow**: Spotlight -> Tauri -> Runner -> Persistence
2. **Task reading flow**: Agent -> CLI -> Persistence (BROKEN - uses wrong path)
3. **Thread storage**: Runner correctly uses `anvilDir` for thread paths

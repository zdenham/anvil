# Worktree "Open in Cursor" Production Bug

## Error
```
[15:46:30.289] [ERROR] [web] [main] [WorktreeRow] Failed to open worktree in Cursor: No such file or directory (os error 2)
```

## Diagnosis

### Why It Works in Dev But Not Production

**Development**: When you run `pnpm tauri dev`, the app is launched from the terminal which already has your full shell PATH (including `/usr/local/bin` where `cursor` CLI is installed). Child processes inherit the parent's environment.

**Production**: The app is launched from Finder/Launchpad/Spotlight, which gives it a minimal macOS system PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that doesn't include `/usr/local/bin`.

### Root Cause
The `openInCursor` function in `src/components/main-window/worktrees-page.tsx:225-232` uses Tauri's `Command.create("cursor", ...)` without providing the shell PATH in the environment:

```typescript
const openInCursor = async () => {
  try {
    const cmd = Command.create("cursor", [worktree.path]);
    await cmd.execute();
    // ...
  } catch (err) {
    logger.error(`[WorktreeRow] Failed to open worktree in Cursor:`, err);
  }
};
```

### Evidence
The codebase already solved this problem for other commands:
- `src/lib/agent-service.ts` uses `getShellPath()` (which invokes `get_shell_path` Tauri command) and passes it via the `env.PATH` option
- `src-tauri/src/shell.rs` provides the `get_shell_path` command that returns the user's actual shell PATH
- `src-tauri/src/paths.rs` captures the shell PATH at startup via login shell execution

The "cursor" command is also not in the shell scope for spawn/execute in `src-tauri/capabilities/default.json`, but since it's in `shell:allow-execute`, it should work if the PATH is correct.

## Proposed Fix

### 1. Update `openInCursor` to use shell PATH

**File**: `src/components/main-window/worktrees-page.tsx`

```typescript
// Add imports
import { invoke } from "@tauri-apps/api/core";

// Cache the shell path (similar to agent-service.ts pattern)
let cachedShellPath: string | null = null;
async function getShellPath(): Promise<string> {
  if (cachedShellPath === null) {
    cachedShellPath = await invoke<string>("get_shell_path");
  }
  return cachedShellPath;
}

// Update openInCursor function
const openInCursor = async () => {
  try {
    const shellPath = await getShellPath();
    logger.log(`[WorktreeRow] Opening worktree "${worktree.name}" in Cursor, path: ${worktree.path}, shellPath: ${shellPath}`);

    const cmd = Command.create("cursor", [worktree.path], {
      env: {
        PATH: shellPath,
      },
    });
    await cmd.execute();
    logger.log(`[WorktreeRow] Opened worktree "${worktree.name}" in Cursor successfully`);
  } catch (err) {
    logger.error(`[WorktreeRow] Failed to open worktree in Cursor:`, {
      worktreeName: worktree.name,
      worktreePath: worktree.path,
      error: err,
    });
  }
};
```

### 2. Add enhanced logging (for debugging future issues)

The fix above already includes enhanced logging:
- Log the worktree path and shell PATH before attempting to open
- Log success explicitly
- Log failure with full context (worktree name, path, and error)

## Alternative Approaches Considered

### A. Use `which_binary` to resolve full path first
```typescript
const cursorPath = await invoke<string | null>("which_binary", { name: "cursor" });
if (cursorPath) {
  const cmd = Command.create("cursor", [worktree.path]);
  // ...
}
```
**Rejected**: Still need to pass PATH for cursor itself to work correctly (it may spawn subprocesses)

### B. Create a Tauri backend command for opening in Cursor
```rust
#[tauri::command]
fn open_in_cursor(path: String) -> Result<(), String> {
    shell::command("cursor").arg(&path).spawn()?;
    Ok(())
}
```
**Considered**: This would work but adds complexity. The frontend fix is simpler and consistent with how `agent-service.ts` handles this.

### C. Use `shell:allow-open` with cursor:// protocol
**Rejected**: Cursor doesn't register a URL protocol for opening folders

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/main-window/worktrees-page.tsx` | Add `getShellPath()` helper, update `openInCursor` to pass shell PATH and add logging |

## Testing

1. Build production app: `pnpm tauri build`
2. Launch from Finder (not terminal)
3. Navigate to Worktrees page
4. Click "open" on a worktree
5. Verify Cursor opens the worktree folder
6. Check logs for the new logging output

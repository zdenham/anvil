# Plan: Use `open` Command Instead of `cursor` CLI

## Problem

Currently, the app uses the `cursor` CLI command to open worktrees in Cursor:

```typescript
// src/components/main-window/worktrees-page.tsx:243
const cmd = Command.create("cursor", [worktree.path], {
  env: { PATH: shellPath },
});
```

This requires users to have the `cursor` CLI command installed (via Cursor's "Install 'cursor' command in PATH" option). Many users may not have this configured.

## Solution

Use macOS `open` command with the `-a` flag to open Cursor by app name, and `--args` to pass the directory:

```bash
open -a "Cursor" /path/to/worktree
```

This works for any user with Cursor.app installed, regardless of whether they've set up the CLI.

## Implementation Steps

### 1. Update Tauri Capabilities

**File:** `src-tauri/capabilities/default.json`

Replace the `cursor` command entry with `open`:

```json
{
  "name": "open",
  "cmd": "open",
  "args": true
}
```

### 2. Update the `openInCursor` Function

**File:** `src/components/main-window/worktrees-page.tsx`

Change from:
```typescript
const cmd = Command.create("cursor", [worktree.path], {
  env: { PATH: shellPath },
});
```

To:
```typescript
const cmd = Command.create("open", ["-a", "Cursor", worktree.path], {});
```

Note: We no longer need the shell PATH since `open` is a system command at `/usr/bin/open`.

### 3. Clean Up (Optional)

If `cursor` was the only reason for `getShellPath()` in this file, and no other code in `worktrees-page.tsx` uses it, we can remove:
- The `cachedShellPath` variable
- The `getShellPath()` function

However, keep these if they're used elsewhere or might be useful for future functionality.

## Testing

1. **Without cursor CLI**: Ensure Cursor opens correctly even if `cursor` CLI is not installed
2. **With cursor CLI**: Verify no regression for users who have the CLI
3. **Cursor not installed**: Verify graceful error handling if Cursor.app doesn't exist

## Rollback

If issues arise, simply revert the changes. The old implementation is straightforward to restore.

## Notes

- The `open` command is a macOS built-in at `/usr/bin/open`, always available
- `-a "Cursor"` tells macOS to find Cursor.app in /Applications or ~/Applications
- The path argument tells Cursor which directory to open
- This approach also works for VS Code: `open -a "Visual Studio Code" /path`

# Fix: "Create Pull Request" Button Silent Failure

## Diagnosis

**Symptom**: Clicking "Create pull request" in production does nothing — no visual feedback, no error, no PR creation.

**Root cause (two layers)**:

1. **Immediate**: `handleCreatePr()` returns silently when `ghCli.isAvailable()` returns false — no UI feedback.
2. **Underlying**: We don't know _why_ `gh auth status` fails because `isAvailable()` swallows the error with a bare `catch`.

### Evidence: the missing log

```
[09:56:34.166] [DEBUG] [GhCli] Executing: gh auth status {"cwd":"/Users/zac/Documents/juice/shortcut"}
[09:56:34.170] [WARN ] [pr-actions] gh CLI not available or not authenticated {"worktreePath":"..."}
```

The `[GhCli] Command failed` log from `executor.ts:39` is **missing**. That log fires when `command.execute()` returns a non-zero exit code. Its absence means `command.execute()` itself threw an exception — it never returned a result at all.

This points to the Tauri shell plugin failing to locate the `gh` binary, not a `gh auth` authentication failure. Production Tauri apps launched from Finder/Dock don't inherit the user's shell PATH (`~/.zshrc` isn't sourced), so Homebrew paths like `/opt/homebrew/bin` aren't available.

### Code path

1. Button click → `handleCreatePr()` in `src/lib/pr-actions.ts:25`
2. Calls `ghCli.isAvailable()` → `src/lib/gh-cli/client.ts:38`
3. Runs `gh auth status` via `execGh()` → `src/lib/gh-cli/executor.ts`
4. `Command.create("gh", ...).execute()` **throws** (binary not found in restricted PATH)
5. `execGh` propagates the throw — the `[GhCli] Command failed` log at line 39 is never reached
6. `isAvailable()` bare `catch` swallows the error, returns `false` — no details logged
7. `pr-actions.ts:39` — returns silently, no UI feedback

### Where the error is lost

```typescript
// client.ts:38-45 — the catch swallows everything
async isAvailable(): Promise<boolean> {
  try {
    await execGh(["auth", "status"], this.cwd);
    return true;
  } catch {     // ← no logging, no error inspection
    return false;
  }
}
```

## Fix

Two changes: add diagnostics so we can see what's actually happening, and show the user feedback.

### 1. Log the actual error in `isAvailable()` (`src/lib/gh-cli/client.ts`)

```typescript
async isAvailable(): Promise<boolean> {
  try {
    await execGh(["auth", "status"], this.cwd);
    return true;
  } catch (error) {
    logger.warn("[GhCli] isAvailable check failed", {
      error: error instanceof Error ? error.message : String(error),
      kind: (error as any)?.kind ?? "unknown",
      cwd: this.cwd,
    });
    return false;
  }
}
```

This will tell us immediately whether it's "not-installed", "not-authenticated", "not-github-repo", or a Tauri shell plugin error.

### 2. Surface the error type in toast (`src/lib/pr-actions.ts`)

Refactor to pass the error reason through so the toast message is actionable:

```typescript
import { toast } from "./toast";

// Change isAvailable to return the error (or make a new method)
const availability = await ghCli.checkAvailability();
if (!availability.ok) {
  logger.warn("[pr-actions] gh CLI not available", {
    reason: availability.reason,
    worktreePath,
  });
  toast.error(availability.message);
  return;
}
```

Or simpler — keep `isAvailable()` as-is for logging, and just add a generic toast:

```typescript
if (!(await ghCli.isAvailable())) {
  logger.warn("[pr-actions] gh CLI not available or not authenticated", {
    worktreePath,
  });
  toast.error("GitHub CLI not available — install or authenticate `gh` to create PRs");
  return;
}
```

## Confirmed underlying fix: pass shell PATH to `execGh()`

**The gh CLI executor does NOT use the same PATH setup as agent spawning or Rust-side git commands.** This is the root cause.

| Caller | PATH resolution | Pattern |
|---|---|---|
| **Agent spawning** (`agent-service.ts`) | `getShellPath()` → Tauri `get_shell_path` → passed via `env: { PATH }` | Correct |
| **Rust git commands** (`git_commands.rs`) | `shell::command("git")` → `paths::shell_path()` → `cmd.env("PATH", ...)` | Correct |
| **gh CLI** (`executor.ts`) | `Command.create("gh", args, { cwd })` — **no env, no PATH** | Broken |

### 3. Pass shell PATH in `execGh()` (`src/lib/gh-cli/executor.ts`)

```typescript
import { invoke } from "@tauri-apps/api/core";

export async function execGh(args: string[], cwd: string): Promise<GhExecResult> {
  logger.debug(`[GhCli] Executing: gh ${args.join(" ")}`, { cwd });

  const shellPath = await invoke<string>("get_shell_path");
  const command = Command.create("gh", args, {
    cwd,
    env: { PATH: shellPath },
  });

  const output = await command.execute();
  // ... rest unchanged
}
```

This matches the pattern already used by `agent-service.ts` and ensures `gh` at `/opt/homebrew/bin/gh` is found in production builds launched from Finder/Dock.

## Phases

- [x] Add error logging to `isAvailable()` catch block in `src/lib/gh-cli/client.ts`
- [x] Pass shell PATH to `Command.create` in `execGh()` (`src/lib/gh-cli/executor.ts`) — same pattern as `agent-service.ts`
- [x] Add toast notification to `handleCreatePr()` early return in `src/lib/pr-actions.ts`
- [x] Check `pr-actions.ts` for other `Command.create("git", ...)` calls missing PATH — fix those too

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

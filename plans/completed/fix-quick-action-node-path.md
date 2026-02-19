# Fix Quick Action "No such file or directory" in Production

## Problem

Quick actions fail in production with `"No such file or directory (os error 2)"` when spawning the Node.js process. Works fine in dev.

**Root cause**: `quick-action-executor.ts` spawns `Command.create('node', [...], {})` with empty options — no `env.PATH`. On macOS, GUI apps launched from Finder/Dock don't inherit the user's shell PATH, so Tauri's shell plugin can't locate the `node` binary.

The error is about finding the `node` executable itself, not about the action files. The action files live at `~/.mort/quick-actions/dist/<entryPoint>` (resolved via `action.projectPath` from the quick-actions service, which reads from `appData.getAbsolutePath(QUICK_ACTIONS_DIR)`). The runner script (`sdk-runner.js`) is bundled with the app and resolved via `resolveResource()`. Both paths are correct — the problem is purely that the OS can't find `node` to run them.

**Existing solution in codebase**: `agent-service.ts:290-295` already solves this by calling `invoke<string>("get_shell_path")` (Rust command that sources the user's login shell to capture PATH), caching it, and passing it as `env.PATH` in spawn options.

## Fix

In `src/lib/quick-action-executor.ts`, add the shell PATH to the `Command.create` options, matching the pattern from `agent-service.ts`.

### Changes

**`src/lib/quick-action-executor.ts`**:

1. Import `invoke` from `@tauri-apps/api/core`
2. Before spawning, call `invoke<string>("get_shell_path")` to get the user's real PATH
3. Pass `{ env: { PATH: shellPath } }` as the third argument to `Command.create`

Diff sketch:
```typescript
// Add import
import { invoke } from '@tauri-apps/api/core';

// In executeQuickAction(), before Command.create:
const shellPath = await invoke<string>("get_shell_path");

// Update the Command.create call
const command = Command.create('node', [
  runnerPath,
  '--action', actionJsPath,
  '--context', JSON.stringify(execContext),
  '--mort-dir', dataDir,
], { env: { PATH: shellPath } });
```

No caching needed — quick actions are infrequent, so the overhead of one extra invoke per execution is negligible. (Agent-service caches because it spawns agents more frequently.)

## Phases

- [x] Add shell PATH resolution to quick-action-executor.ts spawn call

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to modify

- `src/lib/quick-action-executor.ts` — import `invoke`, call `get_shell_path`, pass `{ env: { PATH: shellPath } }` to `Command.create`

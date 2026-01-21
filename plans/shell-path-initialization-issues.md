# Shell PATH Initialization Issues - Investigation & Implementation

## Investigation Summary

### Current Implementation

The app uses a two-phase shell PATH initialization approach:

1. **At startup** (`paths::initialize()`): Uses a static fallback PATH via `capture_shell_path()`:
   ```rust
   fn capture_shell_path() -> String {
       let current = env::var("PATH").unwrap_or_default();
       let fallback = format!("{}:/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/sbin", current);
       tracing::info!("Using static PATH fallback (shell init deferred): {}", fallback);
       fallback
   }
   ```

2. **Deferred initialization**: The real login shell PATH is only captured when user clicks "Grant Documents Access" via `run_login_shell_initialization()`.

### Why This Was Implemented

Based on `plans/completed/deferred-shell-initialization.md`:
- Running a login shell at startup sources user's shell config files
- These configs may reference `~/Documents`, triggering macOS Documents permission prompt
- This was considered poor UX (jarring popup before UI renders)

### The Problem

**The static fallback PATH is insufficient for finding `node`** in many cases:

1. **Version managers not included**: The fallback only adds:
   - `/opt/homebrew/bin` (Homebrew on Apple Silicon)
   - `/usr/local/bin` (Homebrew on Intel/system binaries)
   - `/opt/homebrew/sbin`

   But many developers install Node via version managers which add paths like:
   - `~/.nvm/versions/node/v*/bin` (nvm)
   - `~/.fnm/aliases/default/bin` (fnm)
   - `~/.volta/bin` (volta)
   - `~/.asdf/shims` (asdf)
   - `~/.local/bin` (manually installed)

2. **User may skip permissions flow**: If user:
   - Skips onboarding
   - Doesn't click "Grant Documents Access"
   - Uses the app from a previous session where shell wasn't initialized

   Then `is_shell_initialized()` returns `false` but the app continues with the fallback PATH.

3. **No validation before spawn**: The agent service doesn't check if `node` is actually available before attempting to spawn.

4. **Tauri's command resolution timing**: When using `Command.create("node", ...)`:
   ```typescript
   const command = Command.create("node", commandArgs, {
     env: { PATH: shellPath }
   });
   ```
   The `env.PATH` is passed to the **spawned process**, but Tauri may resolve the `node` binary path **before** applying this environment, using the current process's PATH instead.

### Code Flow

```
App Start
    |
paths::initialize() -> capture_shell_path() -> STATIC FALLBACK PATH
    |
User uses app (may skip permissions UI)
    |
User tries to spawn agent
    |
agent-service.ts:
  - getShellPath() -> returns static fallback (or real PATH if initialized)
  - Command.create("node", args, { env: { PATH: shellPath } })
    |
Tauri shell plugin tries to find "node" binary
    |
ERROR: node not found (if installed via version manager)
```

### Files Involved

| File | Role |
|------|------|
| `src-tauri/src/paths.rs` | `capture_shell_path()`, `run_login_shell_initialization()`, `shell_path()` |
| `src-tauri/src/shell.rs` | `get_shell_path()` Tauri command, `command()` helper |
| `src/lib/agent-service.ts` | `getShellPath()`, `Command.create("node", ...)` |
| `src-tauri/capabilities/default.json` | Shell scope config: `{ name: "node", cmd: "node" }` |

---

## Implemented Solution: Auto-Initialize Shell Before First Agent Spawn

**Approach**: Automatically run shell initialization just-in-time before spawning an agent, if not already initialized.

**Implementation** (in `src/lib/agent-service.ts`):

```typescript
/**
 * Ensures shell environment is initialized before spawning agents.
 * Auto-runs login shell if not already initialized.
 * This ensures the real user PATH (with version managers like nvm, fnm, volta)
 * is available for finding the `node` binary.
 */
async function ensureShellInitialized(): Promise<void> {
  const initialized = await shellEnvironmentCommands.isShellInitialized();
  if (!initialized) {
    logger.info("[agent-service] Shell not initialized, running login shell...");
    const success = await shellEnvironmentCommands.initializeShellEnvironment();
    if (success) {
      // Clear cached shell path so next getShellPath() fetches updated value
      cachedShellPath = null;
      logger.info("[agent-service] Shell initialized successfully");
    } else {
      logger.warn("[agent-service] Shell initialization returned false, will use fallback PATH");
    }
  }
}

// Called at start of spawn functions:
export async function spawnAgentWithOrchestration(options: SpawnAgentWithOrchestrationOptions): Promise<void> {
  await ensureShellInitialized();
  // ... rest of function
}

export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  await ensureShellInitialized();
  // ... rest of function
}

export async function resumeAgent(...): Promise<void> {
  await ensureShellInitialized();
  // ... rest of function
}

export async function resumeSimpleAgent(...): Promise<void> {
  await ensureShellInitialized();
  // ... rest of function
}
```

**Pros**:
- Transparent to user
- Only runs login shell when actually needed
- Documents permission prompt only appears when user tries to use agents
- Works with all version managers (nvm, fnm, volta, asdf, etc.)

**Cons**:
- Small delay on first agent spawn
- Documents permission prompt timing might still surprise user (but it's contextual - they're trying to spawn an agent)

---

## Testing Checklist

- [ ] App starts without Documents permission prompt
- [ ] User with Node from Homebrew can spawn agents immediately
- [ ] User with Node from volta can spawn agents immediately
- [ ] User with Node from fnm can spawn agents immediately
- [ ] User with Node from nvm can spawn agents after shell init
- [ ] Shell initialization works after skipping onboarding

# Fix: Terminal not picking up user's shell PATH

## Problem

When a new terminal is spawned, it gets a static fallback PATH instead of the user's full login shell PATH. Tools installed via homebrew, nvm, cargo, etc. may not be available.

### Root Cause — the deferred shell init never reaches the PTY spawner

The shell PATH flows through three stages:

1. **Rust `paths::initialize()`** — runs at startup, builds a **static fallback** PATH (current env + hardcoded homebrew/nvm paths via `capture_shell_path()`). Does NOT run the login shell. Logs: `"shell init deferred"`.

2. **Rust `spawn_sidecar()`** — passes the static fallback to the sidecar via `.env("PATH", paths::shell_path())` (lib.rs:278). So the sidecar's `process.env.PATH` = static fallback.

3. **Sidecar `initializeShellEnv()`** — eventually called from the frontend (on permission grant). Runs `$SHELL -i -l -c "echo $PATH"` to get the **real** login shell PATH. Stores it in `state.shellPath`. But **never updates `process.env.PATH`**.

4. **Sidecar `buildPtyEnv()`** — spawns PTY with `PATH: process.env.PATH` (terminal-manager.ts:180). This is still the static fallback from step 2 — the resolved PATH from step 3 is sitting in `state.shellPath` unused.

**The gap:** `initializeShellEnv()` resolves the correct PATH but only stores it in state. `buildPtyEnv()` reads `process.env.PATH` which was never updated.

### Key Files

| File | Line | Role |
|------|------|------|
| `src-tauri/src/paths.rs` | 48-78 | `capture_shell_path()` — static fallback PATH |
| `src-tauri/src/lib.rs` | 278 | Passes static fallback to sidecar via `.env("PATH", ...)` |
| `sidecar/src/dispatch/dispatch-misc.ts` | 289-312 | `initializeShellEnv()` — resolves real PATH, stores in `state.shellPath` |
| `sidecar/src/managers/terminal-manager.ts` | 180 | `buildPtyEnv()` — reads `process.env.PATH` (stale) |
| `sidecar/src/state.ts` | 59 | `shellPath` initialized to `process.env.PATH` |

## Phases

- [x] In `initializeShellEnv()`, also set `process.env.PATH` when the resolved PATH is stored in state
- [x] Verify `buildPtyEnv()` picks up the resolved PATH without additional changes
- [x] Audit: ensure terminals aren't spawned before `initializeShellEnv()` completes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Proposed Fix

**Option A (simplest, recommended):** In `initializeShellEnv()` (dispatch-misc.ts), after resolving the full PATH, also set `process.env.PATH = path`. This way `buildPtyEnv()` and all other sidecar code automatically picks it up.

```typescript
// dispatch-misc.ts:initializeShellEnv, line ~301
if (path) {
  state.shellPath = path;
  process.env.PATH = path;  // <-- add this line
  state.shellInitialized = true;
  return true;
}
```

**Option B (more explicit):** Pass `state.shellPath` through to `TerminalManager.spawn()` or make `buildPtyEnv` accept a PATH override. More explicit but requires plumbing state through the dispatch layer.

**Recommendation:** Option A — one-line fix, mirrors the old Rust pattern where `shell_path()` was a global that all code read from. Also benefits any other sidecar code that shells out (e.g. `execFileSync("gh", ...)`).

### Edge case: terminals spawned before shell init

If a terminal is spawned before `initializeShellEnv()` completes, it gets the static fallback PATH (which includes homebrew and nvm paths, so it's usually workable). The frontend should ensure `ensureShellInitialized()` is called before first terminal spawn — verify this is the case.

# Fix Test Process Leaks from Piped Output

## Problem Summary

When test output is piped through commands that close early (e.g., `head -50`, `grep -m1`), vitest receives SIGPIPE and exits abruptly without running cleanup, leaving worker processes orphaned and causing massive memory spikes.

## The Problem in Detail

```
vitest → stdout pipe → head -50
                         ↓
                    (reads 50 lines, exits, closes pipe)
                         ↓
vitest tries to write → SIGPIPE signal
                         ↓
vitest exits abruptly (default SIGPIPE handler terminates process)
                         ↓
Worker processes/threads orphaned (no cleanup ran)
                         ↓
Orphans keep running, consuming memory
```

When the parent dies from SIGPIPE:
- Worker threads keep running (`process.exit` hooks never fire)
- `pool.close()` / `pool.terminate()` never gets called
- `afterAll` / global teardown hooks may not run

## Why This Matters

Developers and CI scripts commonly pipe output:
```bash
pnpm test 2>&1 | head -50        # View first 50 lines
pnpm test 2>&1 | grep -m1 FAIL   # Stop at first failure
```

This should not cause memory leaks or orphaned processes.

## Status: SOLVED

The solution uses a preload script that handles EPIPE errors and explicitly kills vitest worker processes.

## Investigation Findings

### Approaches Attempted

#### 1. SIGPIPE Handler in setupFiles (`src/test/setup.ts`)
**Result: Does not work**
- `setupFiles` run in worker processes, not the main Vitest process
- The main process is what writes to stdout and receives SIGPIPE/EPIPE
- Workers never see the signal

#### 2. EPIPE Handler in globalSetup (`src/test/global-setup.ts`)
**Result: Partially works for small tests, fails for larger test runs**

```typescript
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});
```

- Works when running single small test files (e.g., `pnpm test --run file.test.ts | head -5`)
- Fails when running multiple tests or full test suite with `head -50`
- The EPIPE error is not consistently caught before workers are orphaned

#### 3. Wrapper Scripts (bash and node)
**Result: Does not work**

Bash wrapper with trap:
```bash
trap cleanup PIPE TERM INT
exec npx vitest "$@"
```
- `exec` replaces the shell process, so traps never fire
- Without `exec`, the wrapper doesn't receive the SIGPIPE (vitest does)

Node wrapper with spawn:
```javascript
const vitest = spawn("npx", ["vitest", ...args], { stdio: "inherit" });
process.stdout.on("error", handleEpipe);
```
- With `stdio: "inherit"`, stdout goes directly from vitest to pipe, bypassing our handler
- With `stdio: "pipe"`, we'd need to manually forward all output, which adds complexity and may affect performance

#### 4. Process Group Killing
**Result: Unreliable**
- `process.kill(-pid, "SIGTERM")` to kill process group
- By the time we detect EPIPE, workers may already be orphaned
- Race condition between detection and cleanup

### Root Cause Analysis

The fundamental issue is the process hierarchy:

```
shell → pnpm → vitest main → vitest workers (forked)
                    ↓
              writes to stdout
                    ↓
              pipe breaks (head exits)
                    ↓
              SIGPIPE to vitest main
                    ↓
              vitest main dies immediately
                    ↓
              workers become orphans (parent PID changes to 1)
```

Vitest uses `tinypool` for worker management, which spawns workers using `child_process.fork()`. When the main process dies from SIGPIPE:
1. The workers' parent PID changes to 1 (init/launchd)
2. Workers continue running until they finish or are manually killed
3. No cleanup hooks run in the main process

### Why Application-Level Fixes Don't Work

1. **Signal timing**: By the time Node.js emits the EPIPE error event, the damage is done - vitest has already crashed or is crashing
2. **Buffering**: Vitest uses its own logging abstraction that may buffer writes, delaying when EPIPE is detected
3. **Worker isolation**: Workers are separate processes with no direct way to know their parent died
4. **No prctl equivalent**: Unlike Linux's `prctl(PR_SET_PDEATHSIG)`, macOS has no way for a child to request a signal when its parent dies

## Alternative Solutions (Not Needed Now)

### 1. Vitest Core Change
File an issue/PR with Vitest to handle SIGPIPE gracefully:
```typescript
// In vitest's main process
process.on('SIGPIPE', async () => {
  await pool.close();
  process.exit(0);
});
```
This would need to be done in vitest's core, not user config.

### 2. Worker Heartbeat
Workers could periodically check if their parent is alive:
```typescript
setInterval(() => {
  try {
    process.kill(process.ppid, 0); // Check if parent exists
  } catch {
    process.exit(0); // Parent died, exit
  }
}, 1000);
```
Downside: Adds overhead and 1-second delay before cleanup.

### 3. Alternative Test Runner
Use a test runner that handles SIGPIPE gracefully or doesn't fork workers.

### 4. User Education
Document that piping test output is not supported and will cause memory leaks. Recommend:
```bash
# Instead of:
pnpm test | head -50

# Use:
pnpm test > output.txt && head -50 output.txt
```

## Working Solution

The solution uses a Node.js preload script that:
1. Catches EPIPE errors on `process.stdout` and `process.stderr`
2. Patches `process.stdout.write` and `process.stderr.write` to catch synchronous errors
3. Uses `pkill` to explicitly terminate vitest worker processes when EPIPE is detected

### Implementation

**File: `src/test/epipe-handler.cjs`**
```javascript
// Preload script loaded via NODE_OPTIONS="--require ./src/test/epipe-handler.cjs"
// Catches EPIPE errors and kills vitest workers to prevent orphaned processes
```

**package.json change:**
```json
"test": "NODE_OPTIONS='--require ./src/test/epipe-handler.cjs' vitest"
```

### Why This Works

The key insight is that:
1. The preload script runs in the main vitest process (not workers)
2. When stdout's pipe breaks (e.g., `head -50` exits), Node.js emits an EPIPE error
3. We catch this error before it crashes the process
4. We use `pkill -f "vitest.*forks"` to find and terminate all worker processes
5. We then exit cleanly with code 0

This approach works because:
- `pkill` can find processes by command-line pattern regardless of process groups
- We don't rely on vitest's internal cleanup (which never runs on EPIPE crash)
- The 200ms timeout gives workers time to handle SIGTERM gracefully

### Testing

The solution was verified with:
```bash
pnpm test --run 2>&1 | head -5     # Very early cutoff - 0 orphans
pnpm test --run 2>&1 | head -20    # Normal cutoff - 0 orphans
pnpm test --run 2>&1 | grep -m1 RUN  # grep pattern match - 0 orphans
```

All scenarios result in zero orphaned processes.

## Previous Investigation (For Reference)

The approaches below were attempted but did not fully solve the problem:

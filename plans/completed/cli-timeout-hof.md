# CLI Timeout Higher-Order Function Implementation Plan

## Overview

Implement a higher-order function (HOF) that wraps anvil CLI functions with `Promise.race` to ensure they timeout and don't cause agents to hang indefinitely.

## Problem Statement

The anvil CLI functions can hang indefinitely in several scenarios:
1. **Stdin reading** - `readStdin()` blocks forever if stdin is piped but never closed
2. **File I/O** - Synchronous file operations in `NodePersistence` can block on slow I/O
3. **No timeout mechanism** - No existing safeguards against hanging operations

When an agent calls `anvil tasks get --id=...` and it hangs, the entire agent execution stalls with no recovery path.

---

## Implementation Steps

### Step 1: Create Timeout Utility Module

**File**: `agents/src/lib/timeout.ts`

Create a `withTimeout` HOF that wraps any async function:

```typescript
export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  timeoutMs: number,
  operationName?: string
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(
          `Operation "${operationName ?? fn.name}" timed out after ${timeoutMs}ms`,
          timeoutMs
        ));
      }, timeoutMs);
    });

    return Promise.race([fn(...args), timeoutPromise]);
  };
}
```

**Key design decisions**:
- Generic types preserve function signatures
- Custom `TimeoutError` class for specific error handling
- Optional `operationName` for better error messages
- Timeout is configurable per-function

### Step 2: Create CLI-Specific Timeout Wrapper

**File**: `agents/src/cli/timeout-wrapper.ts`

CLI commands need special handling:
- Constant timeout value (10 seconds)
- Consistent error output format (JSON with error field)
- Detailed logging to stderr with command and arguments for debugging

```typescript
import { withTimeout, TimeoutError } from "../lib/timeout.js";

const CLI_TIMEOUT_MS = 10_000; // 10 seconds

export function withCliTimeout<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>,
  operationName: string
): (...args: TArgs) => Promise<void> {
  const wrapped = withTimeout(fn, CLI_TIMEOUT_MS, operationName);

  return async (...args: TArgs): Promise<void> => {
    try {
      await wrapped(...args);
    } catch (e) {
      if (e instanceof TimeoutError) {
        const argsStr = args.length > 0 ? JSON.stringify(args) : "none";
        console.error(`[anvil-cli] TIMEOUT: "${operationName}" exceeded ${CLI_TIMEOUT_MS}ms`);
        console.error(`[anvil-cli] TIMEOUT: Command args: ${argsStr}`);
        console.log(JSON.stringify({
          error: `Timeout: ${operationName} took longer than ${CLI_TIMEOUT_MS}ms`,
          command: operationName,
          args: args,
          timeoutMs: CLI_TIMEOUT_MS
        }));
        process.exit(124); // Standard timeout exit code
      }
      throw e;
    }
  };
}
```

### Step 3: Wrap All CLI Command Functions

**File**: `agents/src/cli/anvil.ts`

Wrap each command handler with `withCliTimeout`:

```typescript
import { withCliTimeout } from "./timeout-wrapper.js";

// Original functions remain unchanged, just wrapped at export/use point

const tasksListWithTimeout = withCliTimeout(tasksList, "tasks list");
const tasksCreateWithTimeout = withCliTimeout(tasksCreate, "tasks create");
const tasksRenameWithTimeout = withCliTimeout(tasksRename, "tasks rename");
const tasksUpdateWithTimeout = withCliTimeout(tasksUpdate, "tasks update");
const tasksGetWithTimeout = withCliTimeout(tasksGet, "tasks get");
const requestHumanWithTimeout = withCliTimeout(requestHuman, "request-human");
```

Update the `main()` router to use wrapped versions:

```typescript
switch (subcommand) {
  case "list":
    await tasksListWithTimeout(rest);
    break;
  case "create":
    await tasksCreateWithTimeout(rest);
    break;
  // ... etc
}
```

### Step 4: Add Timeout to Stdin Reading

**File**: `agents/src/cli/anvil.ts`

The `readStdin()` function is a primary hang point. Add a dedicated timeout:

```typescript
const STDIN_TIMEOUT_MS = 5_000; // 5 seconds for stdin

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return "";
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      console.error(`[anvil-cli] TIMEOUT: readStdin exceeded ${STDIN_TIMEOUT_MS}ms`);
      process.stdin.destroy();
      reject(new TimeoutError("Reading stdin", STDIN_TIMEOUT_MS));
    }, STDIN_TIMEOUT_MS);

    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf-8").trim());
    });
    process.stdin.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
```

### Step 5: Export Timeout Utility for Tests and External Use

**File**: `agents/src/lib/index.ts` (or create if doesn't exist)

Export the timeout utilities for use in other parts of the codebase:

```typescript
export { withTimeout, TimeoutError } from "./timeout.js";
export { withCliTimeout } from "../cli/timeout-wrapper.js";
```

---

## File Changes Summary

| File | Change |
|------|--------|
| `agents/src/lib/timeout.ts` | **New** - Generic timeout HOF utility |
| `agents/src/cli/timeout-wrapper.ts` | **New** - CLI-specific timeout wrapper |
| `agents/src/cli/anvil.ts` | **Modify** - Wrap all command functions with timeout |
| `agents/src/lib/index.ts` | **Modify** - Export timeout utilities |

---

## Configuration

### Constants

| Constant | Value | Location |
|----------|-------|----------|
| `CLI_TIMEOUT_MS` | `10000` (10s) | `timeout-wrapper.ts` |
| `STDIN_TIMEOUT_MS` | `5000` (5s) | `anvil.ts` |

### Exit Codes

- `124` - Command timed out (standard Unix convention for timeout)
- `1` - Other errors (existing behavior)

---

## Timeout Values

| Operation | Timeout | Rationale |
|-----------|---------|-----------|
| CLI commands (global) | 10s | File operations should complete quickly |
| Stdin reading | 5s | Stdin should be immediately available or not piped |

---

## Error Handling

Timeout errors are handled consistently with detailed logging:

1. **Stderr logging** (two lines):
   - `[anvil-cli] TIMEOUT: "<operation>" exceeded <ms>ms`
   - `[anvil-cli] TIMEOUT: Command args: <args>`
2. **JSON output**:
   ```json
   {
     "error": "Timeout: <operation> took longer than <ms>ms",
     "command": "<operation>",
     "args": [...],
     "timeoutMs": 10000
   }
   ```
3. **Exit code**: `124` (standard timeout exit code)

Agents can detect timeouts by:
- Checking exit code 124
- Parsing JSON error output (includes command and args for debugging)

---

## Testing Considerations

1. **Unit tests for `withTimeout`**:
   - Fast function completes normally
   - Slow function times out
   - Error propagation works correctly

2. **Integration tests for CLI**:
   - Commands complete before timeout
   - Simulated slow operations trigger timeout
   - Exit codes are correct

3. **Edge cases**:
   - Very short timeouts (race conditions)
   - Cleanup of pending timers on success

---

## Future Enhancements

1. **Abort controller integration**: Use `AbortController` for cleaner cancellation
2. **Retry with backoff**: Optionally retry timed-out operations
3. **Metrics/telemetry**: Track timeout occurrences for debugging

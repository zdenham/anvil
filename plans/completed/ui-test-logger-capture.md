# UI Test Logger Capture

## Problem

UI isolation tests cannot assert on log output. When components call `logger.info("message")`, these logs are silently swallowed because:

1. `logger-client.ts` calls `invoke("web_log", ...)`
2. `mockInvoke` has no handler for `web_log`
3. The logger's `.catch()` silently ignores failures

This makes it impossible to verify that given event X, logs Y and Z occurred - useful for debugging and verifying side effects.

## Solution

Add log capture infrastructure to the UI test mocks, exposing a `TestLogs` helper similar to the existing `TestEvents` pattern.

## Implementation Steps

### 1. Add log capture to tauri-api.ts

Add captured logs array and handler in `src/test/mocks/tauri-api.ts`:

```typescript
// After mockThreadState definition (~line 58)
export const capturedLogs: Array<{ level: string; message: string; timestamp: number }> = [];

// In mockInvoke switch, before default case (~line 206)
case "web_log":
  capturedLogs.push({
    level: args?.level as string,
    message: args?.message as string,
    timestamp: Date.now(),
  });
  return;

// In resetAllMocks function
capturedLogs.length = 0;
```

### 2. Create TestLogs helper

Create `src/test/helpers/logs.ts`:

```typescript
/**
 * Log capture helper for UI isolation tests.
 *
 * Provides utilities to assert on logs emitted during tests.
 */

import { capturedLogs } from "../mocks/tauri-api";

type LogLevel = "log" | "info" | "warn" | "error" | "debug";

export class TestLogs {
  /**
   * Get all captured logs.
   */
  static getAll(): Array<{ level: string; message: string; timestamp: number }> {
    return [...capturedLogs];
  }

  /**
   * Get logs filtered by level.
   */
  static getByLevel(level: LogLevel): Array<{ message: string; timestamp: number }> {
    return capturedLogs
      .filter((log) => log.level === level)
      .map(({ message, timestamp }) => ({ message, timestamp }));
  }

  /**
   * Check if a log message was emitted (partial match).
   */
  static hasLog(substring: string, level?: LogLevel): boolean {
    return capturedLogs.some(
      (log) => log.message.includes(substring) && (level === undefined || log.level === level)
    );
  }

  /**
   * Get logs matching a pattern.
   */
  static findLogs(pattern: RegExp, level?: LogLevel): string[] {
    return capturedLogs
      .filter((log) => pattern.test(log.message) && (level === undefined || log.level === level))
      .map((log) => log.message);
  }

  /**
   * Assert that a specific log was emitted.
   * Throws if not found - use in expect().
   */
  static expectLog(substring: string, level?: LogLevel): void {
    if (!this.hasLog(substring, level)) {
      const levelStr = level ? ` at level "${level}"` : "";
      const logs = capturedLogs.map((l) => `  [${l.level}] ${l.message}`).join("\n");
      throw new Error(
        `Expected log containing "${substring}"${levelStr} but not found.\n\nCaptured logs:\n${logs || "  (none)"}`
      );
    }
  }

  /**
   * Assert that a log was NOT emitted.
   */
  static expectNoLog(substring: string, level?: LogLevel): void {
    if (this.hasLog(substring, level)) {
      throw new Error(`Expected no log containing "${substring}" but found one`);
    }
  }

  /**
   * Clear all captured logs.
   * Useful for isolating assertions to a specific action.
   */
  static clear(): void {
    capturedLogs.length = 0;
  }

  /**
   * Get the count of captured logs.
   */
  static count(level?: LogLevel): number {
    if (level === undefined) return capturedLogs.length;
    return capturedLogs.filter((log) => log.level === level).length;
  }
}
```

### 3. Export from helpers/index.ts

Add to `src/test/helpers/index.ts`:

```typescript
// Log capture
export { TestLogs } from "./logs";
```

### 4. Update setup-ui.ts (optional enhancement)

No changes required - `resetAllMocks()` already runs in `beforeEach` which will clear logs.

## Usage Examples

```typescript
import { render, TestLogs, TestEvents } from "@/test/helpers";
import { SomeComponent } from "@/components/some-component";

describe("SomeComponent", () => {
  it("logs when task status changes", async () => {
    render(<SomeComponent taskId="task-1" />);

    // Clear logs to isolate this action
    TestLogs.clear();

    // Trigger the event
    await TestEvents.taskStatusChanged("task-1", "in-progress");

    // Assert on logs
    TestLogs.expectLog("task-1");
    TestLogs.expectLog("status changed", "info");
    expect(TestLogs.hasLog("in-progress")).toBe(true);
  });

  it("logs errors on failure", async () => {
    render(<SomeComponent taskId="task-1" />);

    await TestEvents.agentError("thread-1", "Something went wrong");

    expect(TestLogs.count("error")).toBeGreaterThan(0);
    TestLogs.expectLog("Something went wrong", "error");
  });
});
```

## Files Changed

| File | Change |
|------|--------|
| `src/test/mocks/tauri-api.ts` | Add `capturedLogs` array, `web_log` handler, reset logic |
| `src/test/helpers/logs.ts` | New file - `TestLogs` class |
| `src/test/helpers/index.ts` | Export `TestLogs` |

## Verification

1. Run `pnpm test:ui` - existing tests should pass (logs were silently ignored before)
2. Add a test that uses `TestLogs.expectLog()` to verify capture works
3. Verify `TestLogs.clear()` isolates assertions correctly

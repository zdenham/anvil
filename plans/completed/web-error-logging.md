# Web Error Logging Plan

## Problem

Browser-level errors are not being piped to the unified Tauri logger:
- `console.error()` calls go to browser devtools only
- Uncaught exceptions (`window.onerror`) are lost
- Unhandled promise rejections (`unhandledrejection`) are lost
- React error boundary uses `console.error()` instead of the unified logger

The infrastructure exists (`logger-client.ts` → Tauri IPC → `log_from_web()`), but nothing captures these browser-level errors.

## Solution

Create a global error capture module that intercepts browser errors and forwards them through the existing logging pipeline.

## Implementation

### 1. Create Web Error Capture Module

**New file**: `src/lib/web-error-capture.ts`

```typescript
import { logger } from "./logger-client";

/**
 * Captures browser-level errors and forwards to unified logger.
 * Call once at app initialization, before React renders.
 */
export function initWebErrorCapture(): void {
  // 1. Capture uncaught exceptions
  window.addEventListener("error", (event) => {
    logger.error(
      `[UncaughtError] ${event.message}`,
      `at ${event.filename}:${event.lineno}:${event.colno}`
    );
  });

  // 2. Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason instanceof Error
      ? `${event.reason.message}\n${event.reason.stack}`
      : String(event.reason);
    logger.error(`[UnhandledRejection] ${reason}`);
  });

  // 3. Intercept console.error (preserve original behavior)
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    // Forward to unified logger
    logger.error("[ConsoleError]", ...args);
    // Still call original so devtools works
    originalConsoleError.apply(console, args);
  };
}
```

### 2. Initialize Early in App Bootstrap

**Modify**: `src/main.tsx`

Add initialization before React renders:

```typescript
import { initWebErrorCapture } from "./lib/web-error-capture";

// Capture browser errors before anything else
initWebErrorCapture();

// ... rest of main.tsx
```

### 3. Update Error Boundary to Use Unified Logger

**Modify**: `src/components/global-error-boundary.tsx`

Change `componentDidCatch` to use the unified logger:

```typescript
import { logger } from "@/lib/logger-client";

// In componentDidCatch:
componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
  logger.error("[ReactError]", error.message, error.stack, errorInfo.componentStack);
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/web-error-capture.ts` | New file - error capture module |
| `src/main.tsx` | Add `initWebErrorCapture()` call |
| `src/components/global-error-boundary.tsx` | Use logger instead of console.error |

## Log Output Format

All web errors will appear in the unified logs with prefixes:

```
[web] [UncaughtError] Cannot read property 'foo' of undefined at app.js:123:45
[web] [UnhandledRejection] Network request failed
[web] [ConsoleError] Some component logged an error
[web] [ReactError] Component threw during render
```

The `[web]` prefix comes from the existing `log_from_web()` function in `src-tauri/src/logging.rs` which uses `target: "web"`.

## Verification

1. Trigger a console.error in any component → should appear in Tauri logs
2. Throw an uncaught error → should appear in Tauri logs
3. Create an unhandled promise rejection → should appear in Tauri logs
4. Trigger a React render error → should appear in Tauri logs
5. All errors should still appear in browser devtools (original behavior preserved)

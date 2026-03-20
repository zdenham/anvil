import { logger } from "./logger-client";

/**
 * Captures browser-level errors and forwards to unified logger.
 * Call once at app initialization, before React renders.
 * @param windowName - Name to identify which window logs are coming from
 */
export function initWebErrorCapture(windowName: string): void {
  const prefix = `[${windowName}]`;

  // 1. Capture uncaught exceptions
  window.addEventListener("error", (event) => {
    // ResizeObserver warnings are benign and noisy — suppress them
    if (event.message?.includes("ResizeObserver loop")) return;

    logger.error(
      `${prefix} [UncaughtError] ${event.message}`,
      `at ${event.filename}:${event.lineno}:${event.colno}`
    );
  });

  // 2. Capture unhandled promise rejections
  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? `${event.reason.message}\n${event.reason.stack}`
        : String(event.reason);
    logger.error(`${prefix} [UnhandledRejection] ${reason}`);
  });

  // 3. Intercept console.error (preserve original behavior)
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    // Forward to unified logger
    logger.error(`${prefix} [ConsoleError]`, ...args);
    // Still call original so devtools works
    originalConsoleError.apply(console, args);
  };
}

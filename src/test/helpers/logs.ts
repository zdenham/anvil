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

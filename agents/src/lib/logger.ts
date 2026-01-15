/**
 * Simple logger for agents - outputs structured JSON to stdout.
 * All stdout JSON protocol output (logs, events, state) is centralized here.
 */

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

/**
 * Low-level function to write a JSON message to stdout.
 * This is the ONLY place in the codebase that should call console.log.
 * All structured protocol messages (type: "log", "event", "state") go through here.
 */
export function stdout(message: Record<string, unknown>): void {
  console.log(JSON.stringify(message));
}

function log(level: LogLevel, ...args: unknown[]): void {
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  stdout({ type: "log", level, message });
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) {
      log("DEBUG", ...args);
    }
  },
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};

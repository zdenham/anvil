type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function log(level: LogLevel, ...args: unknown[]): void {
  const message = args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
  // In core package, we use console methods directly since this code
  // may run in different contexts (agents subprocess vs frontend)
  switch (level) {
    case "DEBUG":
      console.debug(message);
      break;
    case "INFO":
      console.log(message);
      break;
    case "WARN":
      console.warn(message);
      break;
    case "ERROR":
      console.error(message);
      break;
  }
}

export const logger = {
  debug: (...args: unknown[]) => log("DEBUG", ...args),
  info: (...args: unknown[]) => log("INFO", ...args),
  warn: (...args: unknown[]) => log("WARN", ...args),
  error: (...args: unknown[]) => log("ERROR", ...args),
};

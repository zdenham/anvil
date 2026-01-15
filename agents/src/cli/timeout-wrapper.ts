/**
 * CLI-specific timeout wrapper for mort commands.
 * Provides consistent timeout behavior and error output for all CLI commands.
 */

import { withTimeout, TimeoutError } from "../lib/timeout.js";
import { logger } from "../lib/logger.js";

const CLI_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Wraps a CLI command function with a timeout.
 * On timeout:
 * - Logs detailed info to stderr
 * - Outputs JSON error to stdout
 * - Exits with code 124 (standard timeout exit code)
 *
 * @param fn - The CLI command function to wrap
 * @param operationName - Name of the operation for error messages
 * @returns Wrapped function with timeout handling
 */
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
        logger.error(
          `[mort-cli] TIMEOUT: "${operationName}" exceeded ${CLI_TIMEOUT_MS}ms`
        );
        logger.error(`[mort-cli] TIMEOUT: Command args: ${argsStr}`);
        logger.info(
          JSON.stringify({
            error: `Timeout: ${operationName} took longer than ${CLI_TIMEOUT_MS}ms`,
            command: operationName,
            args: args,
            timeoutMs: CLI_TIMEOUT_MS,
          })
        );
        process.exit(124); // Standard timeout exit code
      }
      throw e;
    }
  };
}

export { TimeoutError };

/**
 * Timeout utilities for wrapping async functions with Promise.race
 */

export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Higher-order function that wraps an async function with a timeout.
 * If the function doesn't complete within timeoutMs, it throws a TimeoutError.
 *
 * @param fn - The async function to wrap
 * @param timeoutMs - Timeout in milliseconds
 * @param operationName - Optional name for better error messages
 * @returns A wrapped function with the same signature
 */
export function withTimeout<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  timeoutMs: number,
  operationName?: string
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new TimeoutError(
            `Operation "${operationName ?? fn.name}" timed out after ${timeoutMs}ms`,
            timeoutMs
          )
        );
      }, timeoutMs);
    });

    return Promise.race([fn(...args), timeoutPromise]);
  };
}

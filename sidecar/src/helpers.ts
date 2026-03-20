/**
 * Argument extraction helpers for dispatch functions.
 *
 * Mirrors the Rust `extract_arg` / `extract_opt_arg` helpers.
 */

/** Extract a required argument, throwing if missing. */
export function extractArg<T>(
  args: Record<string, unknown>,
  key: string,
): T {
  if (!(key in args) || args[key] === undefined) {
    throw new Error(`Missing required argument: '${key}'`);
  }
  return args[key] as T;
}

/** Extract an optional argument, returning undefined if missing. */
export function extractOptArg<T>(
  args: Record<string, unknown>,
  key: string,
): T | undefined {
  if (!(key in args) || args[key] === undefined) {
    return undefined;
  }
  return args[key] as T;
}

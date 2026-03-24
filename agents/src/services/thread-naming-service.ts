/**
 * Thread naming service — thin wrapper around core naming logic.
 * Re-exports the shared implementation for backward compatibility.
 */

export {
  generateThreadName,
  type ThreadNameResult,
} from "@core/lib/naming/thread-name.js";

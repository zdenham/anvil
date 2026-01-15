import { triggerRegistry } from "./registry";
import { FileTriggerHandler } from "./handlers/file-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return; // Idempotent for HMR safety
  initialized = true;

  triggerRegistry.register(new FileTriggerHandler());
  // Future: register CommandTriggerHandler, TaskTriggerHandler
}

// Re-export for convenience
export { triggerRegistry } from "./registry";
export type * from "./types";

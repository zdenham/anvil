import { triggerRegistry } from "./registry";
import { FileTriggerHandler } from "./handlers/file-handler";
import { skillTriggerHandler } from "./handlers/skill-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return; // Idempotent for HMR safety
  initialized = true;

  triggerRegistry.register(new FileTriggerHandler());
  triggerRegistry.register(skillTriggerHandler);
}

// Re-export for convenience
export { triggerRegistry } from "./registry";
export type * from "./types";

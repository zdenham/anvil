// Event bus
export {
  eventBus,
  type AppEvents,
  type OpenTaskPayload,
  type OpenSimpleTaskPayload,
  type SimpleTaskViewType,
  type ShowErrorPayload,
  type TaskPanelReadyPayload,
  type WindowFocusChangedPayload,
} from "./events";

// Tasks
export { useTaskStore } from "./tasks/store";
export { taskService } from "./tasks/service";
export * from "./tasks/types";

// Threads
export { useThreadStore } from "./threads/store";
export { threadService } from "./threads/service";
export * from "./threads/types";

// Repositories
export { useRepoStore } from "./repositories/store";
export { repoService } from "./repositories/service";
export * from "./repositories/types";

// Settings
export { useSettingsStore } from "./settings/store";
export { settingsService } from "./settings/service";
export * from "./settings/types";

// Logs
export { useLogStore, useFilteredLogs } from "./logs";
export { logService } from "./logs";
export * from "./logs/types";

// Plans
export { usePlanStore } from "./plans/store";
export { planService } from "./plans/service";
export * from "./plans/types";

// ═══════════════════════════════════════════════════════════════════════════════
// App-level hydration & event listeners
// ═══════════════════════════════════════════════════════════════════════════════
import { taskService } from "./tasks/service";
import { threadService } from "./threads/service";
import { repoService } from "./repositories/service";
import { settingsService } from "./settings/service";
import { planService } from "./plans/service";
import { logger } from "@/lib/logger-client";
import { setupTaskListeners } from "./tasks/listeners";
import { setupThreadListeners } from "./threads/listeners";
import { setupRepositoryListeners } from "./repositories/listeners";
import { setupPermissionListeners } from "./permissions/listeners";
import { setupPlanListeners } from "./plans/listeners";

/**
 * Hydrates all entity stores from disk.
 * Should be called once at app initialization.
 */
export async function hydrateEntities(): Promise<void> {
  logger.log("[entities:hydrate] Starting entity hydration...");

  try {
    await Promise.all([
      taskService.hydrate(),
      threadService.hydrate(),
      repoService.hydrate(),
      settingsService.hydrate(),
      planService.hydrate(),
    ]);
    logger.log("[entities:hydrate] All entities hydrated successfully");
  } catch (error) {
    logger.error("[entities:hydrate] Hydration failed!", error);
    throw error;
  }
}

/**
 * Initialize all entity event listeners.
 * Call once at app startup, after setting up the event bridge.
 */
export function setupEntityListeners(): void {
  logger.log("[entities:listeners] Setting up entity listeners...");
  setupTaskListeners();
  setupThreadListeners();
  setupRepositoryListeners();
  setupPermissionListeners();
  setupPlanListeners();
  logger.log("[entities:listeners] All entity listeners initialized");
}

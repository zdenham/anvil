// Event bus
export {
  eventBus,
  type AppEvents,
  type OpenControlPanelPayload,
  type ControlPanelViewType,
  type ShowErrorPayload,
  type WindowFocusChangedPayload,
} from "./events";

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

// Relations
export { useRelationStore, relationService, useRelatedPlans, useRelatedThreads, useRelatedThreadsIncludingArchived } from "./relations";
export type { PlanThreadRelation, RelationType } from "./relations";

// Tree Menu
export { useTreeMenuStore } from "@/stores/tree-menu/store";
export { treeMenuService } from "@/stores/tree-menu/service";
export * from "@/stores/tree-menu/types";

// Repo/Worktree Lookup
export { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

// Quick Actions
export { useQuickActionsStore } from "./quick-actions/store";
export { quickActionService } from "./quick-actions/service";
export type * from "./quick-actions/types";

// Drafts
export { useDraftsStore, draftService } from "./drafts";
export type { DraftsFile } from "./drafts";

// ═══════════════════════════════════════════════════════════════════════════════
// App-level hydration & event listeners
// ═══════════════════════════════════════════════════════════════════════════════
import { threadService } from "./threads/service";
import { repoService } from "./repositories/service";
import { settingsService } from "./settings/service";
import { planService } from "./plans/service";
import { relationService } from "./relations/service";
import { logger } from "@/lib/logger-client";
import { setupThreadListeners } from "./threads/listeners";
import { setupRepositoryListeners } from "./repositories/listeners";
import { setupPermissionListeners } from "./permissions/listeners";
import { setupPlanListeners } from "./plans/listeners";
import { setupRelationListeners } from "./relations/listeners";
import { setupTreeMenuListeners } from "@/stores/tree-menu/listeners";
import { setupWorktreeListeners } from "./worktrees/listeners";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { quickActionService } from "./quick-actions/service";
import { setupQuickActionListeners } from "./quick-actions/listeners";
import { draftService } from "./drafts/service";

/**
 * Hydrates all entity stores from disk.
 * Should be called once at app initialization.
 */
export async function hydrateEntities(): Promise<void> {
  logger.log("[entities:hydrate] Starting entity hydration...");

  try {
    // First, hydrate the core entities in parallel
    await Promise.all([
      threadService.hydrate(),
      repoService.hydrate(),
      settingsService.hydrate(),
      planService.hydrate(),
      relationService.hydrate(),
    ]);
    logger.log("[entities:hydrate] Core entities hydrated successfully");

    // After plans are hydrated, refresh parent relationships for all repos
    // This ensures the isFolder and parentId fields are up-to-date
    // Get unique repoIds from existing plans since repos don't directly expose their UUIDs
    const allPlans = planService.getAll();
    const repoIds = [...new Set(allPlans.map(p => p.repoId))];
    for (const repoId of repoIds) {
      await planService.refreshParentRelationships(repoId);
    }
    logger.log("[entities:hydrate] Plan parent relationships refreshed");

    // After repositories are hydrated, build the repo/worktree lookup cache
    // This must happen after repoService.hydrate() since it reads repo settings
    await useRepoWorktreeLookupStore.getState().hydrate();
    logger.log("[entities:hydrate] Repo/worktree lookup hydrated");

    // Then hydrate tree menu UI state
    await treeMenuService.hydrate();
    logger.log("[entities:hydrate] Tree menu state hydrated");

    // Hydrate quick actions (from manifest + registry)
    await quickActionService.hydrate();
    logger.log("[entities:hydrate] Quick actions hydrated");

    // Hydrate drafts (input persistence)
    await draftService.hydrate();
    logger.log("[entities:hydrate] Drafts hydrated");

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
  setupThreadListeners();
  setupRepositoryListeners();
  setupPermissionListeners();
  setupPlanListeners();
  setupRelationListeners();
  setupTreeMenuListeners();
  setupWorktreeListeners();
  setupQuickActionListeners();
  logger.log("[entities:listeners] All entity listeners initialized");
}

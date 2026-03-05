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

// Skills
export { useSkillsStore } from "./skills";
export type * from "./skills";

// Terminal Sessions
export {
  useTerminalSessionStore,
  terminalSessionService,
  useTerminalSessions,
  useTerminalSessionsByWorktree,
  useTerminalSession,
  useTerminalOutputBuffer,
  useTerminalActions,
} from "./terminal-sessions";
export type { TerminalSession } from "./terminal-sessions";

// Pull Requests
export { usePullRequestStore } from "./pull-requests/store";
export { pullRequestService } from "./pull-requests/service";
export { handlePrGatewayEvent } from "./pull-requests/gateway-handler";
export type {
  PullRequestMetadata,
  PullRequestDetails,
  CreatePullRequestInput,
} from "./pull-requests/types";

// Comments
export { useCommentStore } from "./comments/store";
export { commentService } from "./comments/service";
export type { InlineComment } from "./comments/types";

// Gateway Channels
export { useGatewayChannelStore } from "./gateway-channels/store";
export { gatewayChannelService } from "./gateway-channels/service";
export { setupGatewayChannelListeners } from "./gateway-channels/listeners";
export type { GatewayChannelMetadata } from "./gateway-channels/types";

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
import { setupQuestionListeners } from "./questions/listeners";
import { setupPlanListeners } from "./plans/listeners";
import { setupRelationListeners } from "./relations/listeners";
import { setupTreeMenuListeners } from "@/stores/tree-menu/listeners";
import { setupWorktreeListeners } from "./worktrees/listeners";
import { treeMenuService } from "@/stores/tree-menu/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { quickActionService } from "./quick-actions/service";
import { setupQuickActionListeners } from "./quick-actions/listeners";
import { draftService } from "./drafts/service";
import { setupTerminalListeners } from "./terminal-sessions/listeners";
import { syncManagedSkills } from "@/lib/skill-sync";
import { setupApiHealthListeners } from "./api-health/listeners";
import { setupCommentListeners } from "./comments/listeners";
import { pullRequestService } from "./pull-requests/service";
import { setupPullRequestListeners } from "./pull-requests/listeners";
import { gatewayChannelService } from "./gateway-channels/service";
import { setupGatewayChannelListeners } from "./gateway-channels/listeners";
import { ensureGatewayChannelForRepo } from "./gateway-channels/ensure-channel";

export interface EntityInitOptions {
  /**
   * When true, this window owns the gateway SSE connection and webhook
   * event handling (including auto-address agent spawning).
   * Only ONE window should set this to true to avoid duplicate event processing.
   * @default true
   */
  isMainWindow?: boolean;
}

/**
 * Hydrates all entity stores from disk.
 * Should be called once at app initialization.
 */
export async function hydrateEntities(options: EntityInitOptions = {}): Promise<void> {
  const { isMainWindow = true } = options;
  logger.log("[entities:hydrate] Starting entity hydration...", { isMainWindow });

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

    // Clean up orphaned relation edges (both sides missing → delete, one side → archive)
    await relationService.cleanupOrphaned();

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

    // Hydrate pull requests
    await pullRequestService.hydrate();
    logger.log("[entities:hydrate] Pull requests hydrated");

    // Sync managed skills from bundled plugin to ~/.mort
    await syncManagedSkills();
    logger.log("[entities:hydrate] Managed skills synced");

    // Gateway SSE connection + channel setup: main window only.
    // Each window runs in its own JS context, so without this guard every
    // window would open its own SSE connection and independently process
    // (and act on) the same webhook events — causing duplicate agent spawns.
    if (isMainWindow) {
      // Hydrate gateway channels from disk (starts SSE connection)
      await gatewayChannelService.hydrate();
      logger.log("[entities:hydrate] Gateway channels hydrated");

      // Ensure a gateway channel exists for each repo (idempotent)
      const repos = repoService.getAll();
      for (const repo of repos) {
        try {
          await ensureGatewayChannelForRepo(repo);
        } catch (e) {
          // Non-fatal: channel creation failure is retried on next launch
          logger.error(`[entities:hydrate] Failed to ensure gateway channel for ${repo.name}:`, e);
        }
      }
      logger.log("[entities:hydrate] Gateway channels ensured for all repos");
    } else {
      logger.log("[entities:hydrate] Skipping gateway setup (non-main window)");
    }

    logger.log("[entities:hydrate] All entities hydrated successfully");
  } catch (error) {
    logger.error("[entities:hydrate] Hydration failed!", error);
    throw error;
  }
}

/**
 * Initialize all entity event listeners.
 * Call once at app startup, after setting up the event bridge.
 * Safe to call multiple times (HMR) — listeners with cleanup patterns
 * will deregister before re-registering.
 */
let listenersInitialized = false;

export function setupEntityListeners(options: EntityInitOptions = {}): void {
  const { isMainWindow = true } = options;
  if (listenersInitialized) {
    logger.warn("[entities:listeners] Re-initializing entity listeners (HMR?)");
  }
  logger.log("[entities:listeners] Setting up entity listeners...", { isMainWindow });
  setupThreadListeners();
  setupRepositoryListeners();
  setupPermissionListeners();
  setupQuestionListeners();
  setupPlanListeners();
  setupRelationListeners();
  setupTreeMenuListeners();
  setupWorktreeListeners();
  setupQuickActionListeners();
  setupTerminalListeners();
  setupApiHealthListeners();
  setupCommentListeners();

  // Gateway event routing + PR webhook handlers: main window only.
  // These listeners process SSE events and spawn agents — running them in
  // multiple windows causes duplicate agent spawns per webhook event.
  if (isMainWindow) {
    setupPullRequestListeners();
    setupGatewayChannelListeners();
  } else {
    logger.log("[entities:listeners] Skipping gateway/PR listeners (non-main window)");
  }

  listenersInitialized = true;
  logger.log("[entities:listeners] All entity listeners initialized");
}

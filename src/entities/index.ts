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
  const t0 = performance.now();

  async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const t = performance.now();
    const result = await fn();
    logger.info(`[startup:hydrate] ${label}: ${(performance.now() - t).toFixed(0)}ms`);
    return result;
  }

  try {
    // Core entities in parallel — time each + the whole block
    await timed("core entities (parallel)", () => Promise.all([
      timed("threadService.hydrate", () => threadService.hydrate()),
      timed("repoService.hydrate", () => repoService.hydrate()),
      timed("settingsService.hydrate", () => settingsService.hydrate()),
      timed("planService.hydrate", () => planService.hydrate()),
      timed("relationService.hydrate", () => relationService.hydrate()),
    ]));

    await timed("relationService.cleanupOrphaned", () => relationService.cleanupOrphaned());

    // Refresh parent relationships for all repos
    await timed("planService.refreshParentRelationships", async () => {
      const allPlans = planService.getAll();
      const repoIds = [...new Set(allPlans.map(p => p.repoId))];
      for (const repoId of repoIds) {
        await planService.refreshParentRelationships(repoId);
      }
    });

    await timed("repoWorktreeLookup.hydrate", () => useRepoWorktreeLookupStore.getState().hydrate());
    await timed("treeMenuService.hydrate", () => treeMenuService.hydrate());
    await timed("quickActionService.hydrate", () => quickActionService.hydrate());
    await timed("draftService.hydrate", () => draftService.hydrate());
    await timed("pullRequestService.hydrate", () => pullRequestService.hydrate());
    await timed("syncManagedSkills", () => syncManagedSkills());

    // Gateway SSE connection + channel setup: main window only.
    if (isMainWindow) {
      await timed("gatewayChannelService.hydrate", () => gatewayChannelService.hydrate());

      const repos = repoService.getAll();
      await timed(`ensureGatewayChannelForRepo (${repos.length} repos)`, async () => {
        for (const repo of repos) {
          const tr = performance.now();
          try {
            await ensureGatewayChannelForRepo(repo);
          } catch (e) {
            logger.error(`[startup:hydrate] Failed to ensure gateway channel for ${repo.name}:`, e);
          }
          logger.info(`[startup:hydrate]   gateway channel ${repo.name}: ${(performance.now() - tr).toFixed(0)}ms`);
        }
      });
    } else {
      logger.info("[startup:hydrate] Skipping gateway setup (non-main window)");
    }

    logger.info(`[startup:hydrate] === HYDRATION COMPLETE === total: ${(performance.now() - t0).toFixed(0)}ms`);
  } catch (error) {
    logger.error("[startup:hydrate] Hydration failed!", error);
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

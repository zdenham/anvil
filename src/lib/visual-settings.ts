import type { VisualSettings } from "@core/types/visual-settings.js";

export type VisualEntityType = "thread" | "plan" | "pull-request" | "terminal" | "folder" | "worktree";

// ═══════════════════════════════════════════════════════════════════════════
// On-demand visual settings backfill
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Entity shape expected by ensureVisualSettings.
 * Each entity type provides a subset of these fields.
 */
interface BackfillEntity {
  visualSettings?: VisualSettings;
  worktreeId?: string;
  parentThreadId?: string; // threads only
  parentId?: string;       // plans only (domain parent, NOT visualSettings.parentId)
}

/**
 * Compute default visualSettings for an entity that has NONE.
 *
 * **Strict skip-if-exists**: if `entity.visualSettings` is defined, returns it
 * as-is. Never overwrites, merges, or inspects existing settings.
 */
export function ensureVisualSettings(
  entityType: VisualEntityType,
  entity: BackfillEntity,
): VisualSettings {
  // Safety guard — never overwrite existing settings
  if (entity.visualSettings) return entity.visualSettings;

  switch (entityType) {
    case "thread": {
      const parentId = entity.parentThreadId ?? entity.worktreeId;
      return { parentId };
    }
    case "plan": {
      const parentId = entity.parentId ?? entity.worktreeId;
      return { parentId };
    }
    case "pull-request":
    case "terminal":
    case "folder":
      return { parentId: entity.worktreeId };
    default:
      return { parentId: entity.worktreeId };
  }
}

/**
 * Fire-and-forget persist — deduped so each entity is only written once per
 * app session. Prevents duplicate writes when React re-renders buildUnifiedTree.
 */
const persisted = new Set<string>();

export function persistVisualSettings(
  entityType: VisualEntityType,
  entityId: string,
  settings: VisualSettings,
): void {
  const key = `${entityType}:${entityId}`;
  if (persisted.has(key)) return;
  persisted.add(key);
  void updateVisualSettings(entityType, entityId, settings);
}

/**
 * Updates visualSettings on any entity type.
 * Single entry point for DnD drop handler and "Move to..." context menu.
 */
export async function updateVisualSettings(
  entityType: VisualEntityType,
  entityId: string,
  patch: Partial<VisualSettings>,
): Promise<void> {
  switch (entityType) {
    case "thread": {
      const { threadService } = await import("@/entities/threads/service");
      const thread = threadService.get(entityId);
      if (!thread) throw new Error(`Thread not found: ${entityId}`);
      const merged: VisualSettings = { ...thread.visualSettings, ...patch };
      await threadService.update(entityId, { visualSettings: merged });
      break;
    }
    case "plan": {
      const { planService } = await import("@/entities/plans/service");
      const plan = planService.get(entityId);
      if (!plan) throw new Error(`Plan not found: ${entityId}`);
      const merged: VisualSettings = { ...plan.visualSettings, ...patch };
      // IMPORTANT: planService.update() marks as unread unless isRead is explicit.
      // Always pass isRead: plan.isRead to preserve the current read state.
      await planService.update(entityId, { visualSettings: merged, isRead: plan.isRead });
      break;
    }
    case "pull-request": {
      const { pullRequestService } = await import("@/entities/pull-requests/service");
      const pr = pullRequestService.get(entityId);
      if (!pr) throw new Error(`PR not found: ${entityId}`);
      const merged: VisualSettings = { ...pr.visualSettings, ...patch };
      await pullRequestService.update(entityId, { visualSettings: merged });
      break;
    }
    case "terminal": {
      const { terminalSessionService } = await import("@/entities/terminal-sessions/service");
      await terminalSessionService.updateVisualSettings(entityId, patch);
      break;
    }
    case "folder": {
      const { folderService } = await import("@/entities/folders/service");
      await folderService.updateVisualSettings(entityId, patch);
      break;
    }
    case "worktree": {
      const { appData, loadSettings, saveSettings } = await import("@/lib/app-data-store");
      const repoDirs = await appData.listDir("repositories");

      for (const repoSlug of repoDirs) {
        let settings;
        try {
          settings = await loadSettings(repoSlug);
        } catch {
          continue;
        }
        const idx = settings.worktrees.findIndex((wt) => wt.id === entityId);
        if (idx === -1) continue;

        const worktree = settings.worktrees[idx];
        const merged: VisualSettings = { ...worktree.visualSettings, ...patch };
        settings.worktrees[idx] = { ...worktree, visualSettings: merged };
        await saveSettings(repoSlug, settings);
        const { useRepoWorktreeLookupStore } = await import("@/stores/repo-worktree-lookup-store");
        await useRepoWorktreeLookupStore.getState().hydrate();
        return;
      }

      throw new Error(`Worktree not found: ${entityId}`);
    }
  }
}

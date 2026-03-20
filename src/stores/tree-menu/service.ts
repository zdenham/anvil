import { appData } from "@/lib/app-data-store";
import { logger } from "@/lib/logger-client";
import { useTreeMenuStore } from "./store";
import { TreeMenuPersistedStateSchema, type TreeMenuPersistedState } from "./types";

const UI_STATE_PATH = "ui/tree-menu.json";

/**
 * Helper to get persisted state from store.
 */
function getPersistedState(): TreeMenuPersistedState {
  const { expandedSections, selectedItemId, pinnedWorktreeId, hiddenWorktreeIds, hiddenRepoIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedWorktreeId, hiddenWorktreeIds, hiddenRepoIds };
}

/**
 * Get default expansion state for a section/folder key.
 * Repo/worktree sections default expanded (true).
 * Plan folders, thread folders, and changes folders default collapsed (false).
 */
function getDefaultExpanded(sectionId: string): boolean {
  if (sectionId.startsWith("plan:") || sectionId.startsWith("thread:") || sectionId.startsWith("changes:")) {
    return false;
  }
  return true;
}

export const treeMenuService = {
  /**
   * Hydrates the tree menu store from disk.
   * Should be called once at app initialization.
   * Handles migration from old format (pinnedSectionId, hiddenSectionIds).
   */
  async hydrate(): Promise<void> {
    try {
      const raw = await appData.readJson(UI_STATE_PATH);
      if (raw) {
        const result = TreeMenuPersistedStateSchema.safeParse(raw);
        if (result.success) {
          useTreeMenuStore.getState().hydrate(result.data);
          logger.debug("[treeMenuService] Hydrated from disk");
          return;
        }
        // Old format: clear pin, ignore hiddenSectionIds
        logger.info("[treeMenuService] Migrating old tree-menu.json format");
        const migrated: TreeMenuPersistedState = {
          expandedSections: (raw as Record<string, unknown>).expandedSections as Record<string, boolean> ?? {},
          selectedItemId: (raw as Record<string, unknown>).selectedItemId as string | null ?? null,
          pinnedWorktreeId: null, // Clear old pin — user re-pins in one click
        };
        await appData.ensureDir("ui");
        await appData.writeJson(UI_STATE_PATH, migrated);
        useTreeMenuStore.getState().hydrate(migrated);
        return;
      }
      // No data — defaults
      useTreeMenuStore.getState().hydrate({
        expandedSections: {},
        selectedItemId: null,
        pinnedWorktreeId: null,
      });
      logger.debug("[treeMenuService] No persisted state found, using defaults");
    } catch (err) {
      logger.error("[treeMenuService] Failed to hydrate:", err);
      useTreeMenuStore.getState().hydrate({
        expandedSections: {},
        selectedItemId: null,
        pinnedWorktreeId: null,
      });
    }
  },

  /**
   * Toggles a node's expansion state.
   * Writes to disk first, then updates store.
   */
  async toggleSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
    const newExpanded = !current;

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: newExpanded,
      },
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetExpanded(sectionId, newExpanded);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist toggle:", err);
      throw err;
    }
  },

  /**
   * Expands a node.
   */
  async expandSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
    if (current === true) return; // Already expanded

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: true,
      },
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetExpanded(sectionId, true);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist expand:", err);
      throw err;
    }
  },

  /**
   * Collapses a node.
   */
  async collapseSection(sectionId: string): Promise<void> {
    const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
    if (current === false) return; // Already collapsed

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      expandedSections: {
        ...useTreeMenuStore.getState().expandedSections,
        [sectionId]: false,
      },
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetExpanded(sectionId, false);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist collapse:", err);
      throw err;
    }
  },

  /**
   * Sets the selected item.
   * Writes to disk first, then updates store.
   */
  async setSelectedItem(itemId: string | null): Promise<void> {
    const current = useTreeMenuStore.getState().selectedItemId;
    if (current === itemId) return;

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      selectedItemId: itemId,
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetSelectedItem(itemId);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist selection:", err);
      throw err;
    }
  },

  /**
   * Refreshes the store from disk.
   * Used when cross-window sync events arrive.
   */
  async refreshFromDisk(): Promise<void> {
    await this.hydrate();
  },

  /**
   * Pins a worktree (shows only that worktree's subtree).
   * Pass null to unpin.
   */
  async pinWorktree(worktreeId: string | null): Promise<void> {
    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      pinnedWorktreeId: worktreeId,
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetPinned(worktreeId);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist pin:", err);
      throw err;
    }
  },

  /**
   * Toggles pin state for a worktree.
   * If already pinned, unpins; otherwise pins.
   */
  async togglePinWorktree(worktreeId: string): Promise<void> {
    const current = useTreeMenuStore.getState().pinnedWorktreeId;
    const newPinned = current === worktreeId ? null : worktreeId;
    await this.pinWorktree(newPinned);
  },

  /**
   * Starts inline rename mode for a node.
   * Only one node can be renaming at a time.
   * Ephemeral UI state — not persisted to disk.
   */
  startRename(nodeId: string): void {
    useTreeMenuStore.getState()._applySetRenaming(nodeId);
  },

  /**
   * Stops inline rename mode.
   * Ephemeral UI state — not persisted to disk.
   */
  stopRename(): void {
    useTreeMenuStore.getState()._applySetRenaming(null);
  },

  /**
   * Hides a worktree from the tree.
   */
  async hideWorktree(worktreeId: string): Promise<void> {
    const current = useTreeMenuStore.getState().hiddenWorktreeIds;
    if (current.includes(worktreeId)) return;
    const newIds = [...current, worktreeId];

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      hiddenWorktreeIds: newIds,
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetHiddenWorktrees(newIds);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist hideWorktree:", err);
      throw err;
    }
  },

  /**
   * Hides a repo (and all its worktrees) from the tree.
   */
  async hideRepo(repoId: string): Promise<void> {
    const current = useTreeMenuStore.getState().hiddenRepoIds;
    if (current.includes(repoId)) return;
    const newIds = [...current, repoId];

    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      hiddenRepoIds: newIds,
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetHiddenRepos(newIds);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist hideRepo:", err);
      throw err;
    }
  },

  /**
   * Clears all hidden worktrees, hidden repos, and unpins.
   */
  async unhideAll(): Promise<void> {
    const newState: TreeMenuPersistedState = {
      ...getPersistedState(),
      pinnedWorktreeId: null,
      hiddenWorktreeIds: [],
      hiddenRepoIds: [],
    };

    try {
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, newState);
      useTreeMenuStore.getState()._applySetPinned(null);
      useTreeMenuStore.getState()._applySetHiddenWorktrees([]);
      useTreeMenuStore.getState()._applySetHiddenRepos([]);
    } catch (err) {
      logger.error("[treeMenuService] Failed to persist unhideAll:", err);
      throw err;
    }
  },
};

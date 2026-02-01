/**
 * MainWindowLayout
 *
 * Complete layout overhaul for Phase 4 of the main window refactor.
 *
 * Structure:
 * - Left panel: TreePanelHeader + TreeMenu + StatusLegend (inside ResizablePanel)
 * - Right panel: ContentPaneContainer
 *
 * Key responsibilities:
 * - Initialize stores on mount (content panes, tree menu, layout)
 * - Handle tree selection -> content pane view updates
 * - Handle "navigate" events from native macOS menu
 * - Connect header actions (Settings, Logs) to content pane views
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { ResizablePanel } from "@/components/ui/resizable-panel";
import { StatusLegend } from "@/components/ui/status-legend";
import { TreeMenu, TreePanelHeader } from "@/components/tree-menu";
import { ContentPaneContainer } from "@/components/content-pane";
import { BuildModeIndicator } from "@/components/ui/BuildModeIndicator";
import { CommandPalette } from "@/components/command-palette";
import { MainWindowProvider } from "./main-window-context";
import { contentPanesService, setupContentPanesListeners } from "@/stores/content-panes";
import { treeMenuService } from "@/stores/tree-menu/service";
import { navigationService } from "@/stores/navigation-service";
import { layoutService } from "@/stores/layout/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { threadService } from "@/entities/threads/service";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { logger } from "@/lib/logger-client";
import { generateUniqueWorktreeName } from "@/lib/random-name";
import { warmupAgentEnvironment } from "@/lib/agent-service";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { useTreeData } from "@/hooks/use-tree-data";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { planService } from "@/entities/plans";
import type { ContentPaneView } from "@/components/content-pane/types";

// Valid navigation targets from macOS menu
type NavTarget = "settings" | "logs";
const VALID_NAV_TARGETS: NavTarget[] = ["settings", "logs"];

export function MainWindowLayout() {
  // ═══════════════════════════════════════════════════════════════════════════
  // Fullscreen Detection (for macOS top padding)
  // ═══════════════════════════════════════════════════════════════════════════

  const isFullscreen = useFullscreen();

  // Track whether listeners have been initialized (prevents duplicate registration)
  const listenersInitialized = useRef(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // Tree Data (for Command+N new thread in most recent worktree)
  // ═══════════════════════════════════════════════════════════════════════════

  const treeSections = useTreeData();

  // Store ref to treeSections for use in keyboard handler (avoids stale closure)
  const treeSectionsRef = useRef(treeSections);
  treeSectionsRef.current = treeSections;

  // ═══════════════════════════════════════════════════════════════════════════
  // Command Palette State
  // ═══════════════════════════════════════════════════════════════════════════

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [creatingWorktreeForRepo, setCreatingWorktreeForRepo] = useState<string | null>(null);

  // Listen for Command+P / Ctrl+P to open command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for Command+N / Ctrl+N to create new thread
  // Priority: 1) Selected thread/plan's worktree, 2) Most recent worktree
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();

        let repoId: string | undefined;
        let worktreeId: string | undefined;
        let worktreeName: string | undefined;

        // 1. Check if a thread or plan is currently selected
        const selectedItemId = useTreeMenuStore.getState().selectedItemId;
        if (selectedItemId) {
          // Try thread first
          const selectedThread = threadService.get(selectedItemId);
          if (selectedThread) {
            repoId = selectedThread.repoId;
            worktreeId = selectedThread.worktreeId;
            const section = treeSectionsRef.current.find(
              s => s.repoId === repoId && s.worktreeId === worktreeId
            );
            worktreeName = section?.worktreeName ?? "unknown";
            logger.info(`[MainWindowLayout] Command+N: Creating new thread in selected thread's worktree "${worktreeName}"`);
          } else {
            // Try plan
            const selectedPlan = planService.get(selectedItemId);
            if (selectedPlan) {
              repoId = selectedPlan.repoId;
              worktreeId = selectedPlan.worktreeId;
              const section = treeSectionsRef.current.find(
                s => s.repoId === repoId && s.worktreeId === worktreeId
              );
              worktreeName = section?.worktreeName ?? "unknown";
              logger.info(`[MainWindowLayout] Command+N: Creating new thread in selected plan's worktree "${worktreeName}"`);
            }
          }
        }

        // 2. Fallback to most recently used worktree
        if (!repoId || !worktreeId) {
          const sections = treeSectionsRef.current;
          if (sections.length === 0) {
            logger.warn("[MainWindowLayout] Command+N: No worktrees available");
            return;
          }
          const mostRecent = sections[0];
          repoId = mostRecent.repoId;
          worktreeId = mostRecent.worktreeId;
          worktreeName = mostRecent.worktreeName;
          logger.info(`[MainWindowLayout] Command+N: Creating new thread in most recent worktree "${worktreeName}"`);
        }

        try {
          const thread = await threadService.create({
            repoId,
            worktreeId,
            prompt: "",
          });

          await treeMenuService.hydrate();
          await navigationService.navigateToThread(thread.id, { autoFocus: true });

          logger.info(`[MainWindowLayout] Command+N: Created new thread ${thread.id}`);
        } catch (err) {
          logger.error(`[MainWindowLayout] Command+N: Failed to create thread:`, err);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Store Initialization
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    // Setup listeners once (before hydration)
    if (!listenersInitialized.current) {
      setupContentPanesListeners();
      listenersInitialized.current = true;
    }

    async function initStores() {
      try {
        // Initialize stores in parallel - error isolation
        await Promise.allSettled([
          contentPanesService.hydrate(),
          treeMenuService.hydrate(),
          layoutService.hydrate(),
        ]);
        logger.debug("[MainWindowLayout] Stores initialized");
      } catch (err) {
        logger.error("[MainWindowLayout] Failed to initialize stores:", err);
      }
    }
    initStores();

    // Pre-warm agent environment in background to eliminate first-run delay
    // This initializes the shell environment (capturing PATH for nvm/fnm/volta)
    // so thread creation is instant even on first use
    warmupAgentEnvironment().catch((err) => {
      logger.warn("[MainWindowLayout] Agent warmup failed (non-fatal):", err);
    });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Set Content Pane View Event (from Spotlight via Rust)
  // This allows Spotlight to open threads/plans in the main window content pane
  // when user presses Enter (without Shift modifier)
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const unlisten = listen<ContentPaneView>("set-content-pane-view", async (event) => {
      const eventReceivedAt = Date.now();
      const view = event.payload;
      const threadId = view.type === "thread" ? view.threadId : undefined;
      logger.info("[MainWindowLayout:TIMING] Received set-content-pane-view event", {
        view,
        threadId,
        timestamp: new Date(eventReceivedAt).toISOString(),
      });

      // Update both tree selection and content pane via navigation service
      await navigationService.navigateToView(view);
      logger.info(`[MainWindowLayout:TIMING] navigateToView completed`, {
        viewType: view.type,
        threadId,
        elapsedMs: Date.now() - eventReceivedAt,
        timestamp: new Date().toISOString(),
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Navigation Event Handler (from macOS menu)
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const unlisten = listen<string>("navigate", async (event) => {
      const target = event.payload as NavTarget;
      if (VALID_NAV_TARGETS.includes(target)) {
        if (target === "settings") {
          await navigationService.navigateToView({ type: "settings" });
        } else if (target === "logs") {
          await navigationService.navigateToView({ type: "logs" });
        }
        logger.debug(`[MainWindowLayout] Navigated to ${target}`);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Tree Selection Handler
  // ═══════════════════════════════════════════════════════════════════════════

  const handleItemSelect = useCallback(async (itemId: string, itemType: "thread" | "plan") => {
    logger.info(`[MainWindowLayout] Item selected: ${itemType} ${itemId}`);

    if (itemType === "thread") {
      await navigationService.navigateToThread(itemId);
    } else {
      await navigationService.navigateToPlan(itemId);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Header Action Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSettingsClick = useCallback(async () => {
    await navigationService.navigateToView({ type: "settings" });
  }, []);

  const handleLogsClick = useCallback(async () => {
    await navigationService.navigateToView({ type: "logs" });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // New Thread/Worktree Handlers (from tree section plus buttons)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleNewThread = useCallback(async (repoId: string, worktreeId: string, _worktreePath: string) => {
    logger.info(`[MainWindowLayout] Creating new thread for worktree ${worktreeId} in repo ${repoId}`);

    try {
      const thread = await threadService.create({
        repoId,
        worktreeId,
        prompt: "", // Empty prompt - user will fill it in
      });

      // Refresh tree menu to show new thread, then navigate to it
      await treeMenuService.hydrate();
      await navigationService.navigateToThread(thread.id, { autoFocus: true });

      logger.info(`[MainWindowLayout] Created new thread ${thread.id}`);
    } catch (err) {
      logger.error(`[MainWindowLayout] Failed to create thread:`, err);
    }
  }, []);

  const handleNewWorktree = useCallback(async (repoName: string) => {
    logger.info(`[MainWindowLayout] New worktree requested for repo ${repoName}`);
    setCreatingWorktreeForRepo(repoName);

    try {
      // Sync existing worktrees to get current names
      const existingWorktrees = await worktreeService.sync(repoName);
      const existingNames = new Set(existingWorktrees.map(w => w.name));

      // Generate unique random name
      const worktreeName = generateUniqueWorktreeName(existingNames);
      logger.info(`[MainWindowLayout] Auto-generated worktree name: "${worktreeName}"`);

      await worktreeService.create(repoName, worktreeName);

      // Re-sync worktrees to ensure new worktree is in settings, then refresh lookup store
      await worktreeService.sync(repoName);
      await useRepoWorktreeLookupStore.getState().hydrate();

      await treeMenuService.hydrate();
      logger.info(`[MainWindowLayout] Created worktree "${worktreeName}" in ${repoName}`);
    } catch (error) {
      logger.error(`[MainWindowLayout] Failed to create worktree:`, error);
    } finally {
      setCreatingWorktreeForRepo(null);
    }
  }, []);

  const handleNewRepo = useCallback(async () => {
    logger.info(`[MainWindowLayout] New repository requested`);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Repository Folder",
      });

      if (selectedPath && typeof selectedPath === "string") {
        const validation = await repoService.validateNewRepository(selectedPath);
        if (!validation.valid) {
          logger.error(`[MainWindowLayout] Invalid repository: ${validation.error}`);
          return;
        }

        await repoService.createFromFolder(selectedPath);
        await repoService.hydrate();

        // Sync worktrees for all repos and refresh lookup store
        const repos = repoService.getAll();
        await Promise.all(repos.map((repo) => worktreeService.sync(repo.name)));
        await useRepoWorktreeLookupStore.getState().hydrate();

        await treeMenuService.hydrate();
        logger.info(`[MainWindowLayout] Added repository from ${selectedPath}`);
      }
    } catch (error) {
      logger.error(`[MainWindowLayout] Failed to add repository:`, error);
    }
  }, []);

  const handleArchiveWorktree = useCallback(async (repoName: string, worktreeId: string, worktreeName: string) => {
    logger.info(`[MainWindowLayout] Archive worktree requested: ${worktreeName} (${worktreeId}) in repo ${repoName}`);

    // Get threads in this worktree to show count in confirmation
    const threads = threadService.getByWorktree(worktreeId);
    const threadCount = threads.length;

    // Confirm with user
    const message = threadCount > 0
      ? `Archive worktree "${worktreeName}" and its ${threadCount} thread${threadCount === 1 ? "" : "s"}?`
      : `Archive worktree "${worktreeName}"?`;

    const confirmed = await confirm(message, {
      title: "Archive Worktree",
      kind: "warning",
    });

    if (!confirmed) {
      logger.info(`[MainWindowLayout] Archive worktree cancelled`);
      return;
    }

    try {
      // Archive all threads in the worktree
      for (const thread of threads) {
        await threadService.archive(thread.id);
        logger.info(`[MainWindowLayout] Archived thread ${thread.id}`);
      }

      // Delete the worktree
      await worktreeService.delete(repoName, worktreeName);

      // Sync worktrees and refresh lookup store
      await worktreeService.sync(repoName);
      await useRepoWorktreeLookupStore.getState().hydrate();

      // Refresh tree menu
      await treeMenuService.hydrate();

      logger.info(`[MainWindowLayout] Successfully archived worktree "${worktreeName}" with ${threadCount} threads`);
    } catch (error) {
      logger.error(`[MainWindowLayout] Failed to archive worktree:`, error);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <MainWindowProvider>
      <div className={`flex h-full bg-surface-900 ${isFullscreen ? "pt-3" : ""}`}>
        {/* Left Panel: Tree Menu */}
        <ResizablePanel
          position="left"
          minWidth={200}
          defaultWidth="1/3"
          persistKey="tree-panel-width"
          className="bg-surface-950 border-r border-surface-700 flex flex-col"
        >
          <TreePanelHeader
            onSettingsClick={handleSettingsClick}
            onLogsClick={handleLogsClick}
          />
          <TreeMenu
            onItemSelect={handleItemSelect}
            onNewThread={handleNewThread}
            onNewWorktree={handleNewWorktree}
            onNewRepo={handleNewRepo}
            onArchiveWorktree={handleArchiveWorktree}
            creatingWorktreeForRepo={creatingWorktreeForRepo}
            className="flex-1 min-h-0"
          />
          <div className="px-3 py-2 border-t border-surface-800">
            <StatusLegend />
          </div>
        </ResizablePanel>

        {/* Right Panel: Content Pane */}
        <ContentPaneContainer />

        {/* Build mode indicator */}
        <BuildModeIndicator />

        {/* Command Palette (Command+P) */}
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />
      </div>
    </MainWindowProvider>
  );
}


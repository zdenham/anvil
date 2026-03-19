/**
 * MainWindowLayout
 *
 * Complete layout overhaul for Phase 4 of the main window refactor.
 *
 * Structure:
 * - Left panel: TreePanelHeader + TreeMenu + StatusLegend (inside ResizablePanel)
 * - Center panel: SplitLayoutContainer (recursive split tree with pane groups)
 *
 * Key responsibilities:
 * - Initialize stores on mount (content panes, tree menu, layout)
 * - Handle tree selection -> content pane view updates
 * - Handle "navigate" events from native macOS menu
 * - Connect header actions (Settings, Logs) to content pane views
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@/lib/events";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { ResizablePanel } from "@/components/ui/resizable-panel";
import { BottomGutter } from "@/components/ui/bottom-gutter";
import { TreeMenu, TreePanelHeader } from "@/components/tree-menu";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { SplitLayoutContainer } from "@/components/split-layout";
import { TerminalPanelLayout } from "@/components/terminal-panel/terminal-panel-layout";
import { CommandPalette } from "@/components/command-palette";
import { MainWindowProvider } from "./main-window-context";
import { DebugPanel } from "@/components/debug-panel";
import { ResizablePanelVertical } from "@/components/ui/resizable-panel-vertical";
import { useDebugPanelStore, debugPanelService } from "@/stores/debug-panel";
import { usePaneLayoutStore, paneLayoutService, setupPaneLayoutListeners, closeTabsByWorktree } from "@/stores/pane-layout";
import { treeMenuService } from "@/stores/tree-menu/service";
import { navigationService } from "@/stores/navigation-service";
import { layoutService } from "@/stores/layout/service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";
import { useMRUWorktreeStore } from "@/stores/mru-worktree-store";
import { threadService } from "@/entities/threads/service";
import { repoService } from "@/entities/repositories";
import { worktreeService } from "@/entities/worktrees";
import { logger } from "@/lib/logger-client";
import { generateUniqueWorktreeName } from "@/lib/random-name";
import { createNewProjectAndHydrate } from "@/lib/project-creation-service";
import { warmupAgentEnvironment } from "@/lib/agent-service";
import { terminalSessionService } from "@/entities/terminal-sessions";
import { createThread } from "@/lib/thread-creation-service";
import { loadSettings } from "@/lib/app-data-store";

import { useTabSelectionSync } from "@/hooks/use-tab-selection-sync";
import { useQuickActionHotkeys } from "@/hooks/use-quick-action-hotkeys";
import { useTreeData } from "@/hooks/use-tree-data";
import { useRightPanel } from "@/hooks/use-right-panel";
import { useActiveWorktreeContext } from "@/hooks/use-active-worktree-context";
import { RightPanelContainer } from "@/components/right-panel/right-panel-container";
import { useTreeMenuStore } from "@/stores/tree-menu/store";
import { planService } from "@/entities/plans";
import { pullRequestService } from "@/entities/pull-requests";
import { handleCreatePr } from "@/lib/pr-actions";
import { GlobalToast } from "@/components/ui/global-toast";
import { toast } from "@/lib/toast";
import { WindowTitlebar } from "@/components/window-titlebar/window-titlebar";
import type { ContentPaneView } from "@/components/content-pane/types";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Valid navigation targets from macOS menu
type NavTarget = "settings" | "logs";
const VALID_NAV_TARGETS: NavTarget[] = ["settings", "logs"];

export function MainWindowLayout() {
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);

  // Sync sidebar tree selection when the active tab changes (tab clicks, not just navigation)
  useTabSelectionSync();

  useQuickActionHotkeys();

  // ═══════════════════════════════════════════════════════════════════════════
  // Right Panel (tabbed: search / files / changelog)
  // ═══════════════════════════════════════════════════════════════════════════

  const rightPanel = useRightPanel();
  const activeWorktreeContext = useActiveWorktreeContext();
  const terminalPanelOpen = usePaneLayoutStore((s) => s.terminalPanel?.isOpen ?? false);

  // Track whether listeners have been initialized (prevents duplicate registration)
  const listenersInitialized = useRef(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // Tree Data (for Command+N new thread in most recent worktree)
  // ═══════════════════════════════════════════════════════════════════════════

  // Flat tree items for Command+N / Command+T worktree resolution
  const treeItems = useTreeData();

  // Pinned worktree state for passing to TreeMenu
  const pinnedWorktreeId = useTreeMenuStore((state) => state.pinnedWorktreeId);

  // Store ref to treeItems for use in keyboard handler (avoids stale closure)
  const treeItemsRef = useRef(treeItems);
  treeItemsRef.current = treeItems;

  // ═══════════════════════════════════════════════════════════════════════════
  // Command Palette State
  // ═══════════════════════════════════════════════════════════════════════════

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [creatingWorktreeIds, setCreatingWorktreeIds] = useState<Set<string>>(new Set());

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

  // Listen for Command+Shift+F to open search panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        rightPanel.openSearch();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [rightPanel.openSearch]);

  // Listen for Command+Shift+D to toggle debug panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "d") {
        e.preventDefault();
        debugPanelService.toggle();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Toggle terminal panel (shared between Ctrl+` and titlebar button)
  const handleToggleTerminalPanel = useCallback(async () => {
    const result = paneLayoutService.toggleTerminalPanel();
    if (result === "needs-terminal") {
      // No terminals exist - create one using MRU worktree
      const mru = useMRUWorktreeStore.getState().getMRUWorktree();
      if (!mru) {
        logger.warn("[MainWindowLayout] Toggle terminal: No worktrees available");
        return;
      }
      const worktreeId = mru.worktreeId;
      const worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(mru.repoId, mru.worktreeId);
      if (!worktreePath) return;

      try {
        const session = await terminalSessionService.create(worktreeId, worktreePath);
        await navigationService.navigateToTerminal(session.id);
      } catch (err) {
        logger.error("[MainWindowLayout] Toggle terminal: Failed to create terminal:", err);
      }
    }
  }, []);

  // Listen for Ctrl+` to toggle terminal panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        handleToggleTerminalPanel();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleToggleTerminalPanel]);

  // Listen for Command+W / Ctrl+W to close active tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        const group = paneLayoutService.getActiveGroup();
        const tab = paneLayoutService.getActiveTab();
        if (group && tab) {
          paneLayoutService.closeTab(group.id, tab.id);
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for Command+N / Ctrl+N to create new thread
  // Priority: 1) Selected thread/plan's worktree, 2) Most recent worktree
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "n") {
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
            const worktreeNode = treeItemsRef.current.find(
              i => i.type === "worktree" && i.repoId === repoId && (i.worktreeId === worktreeId || i.id === worktreeId)
            );
            worktreeName = worktreeNode?.worktreeName ?? "unknown";
            logger.info(`[MainWindowLayout] Command+N: Creating new thread in selected thread's worktree "${worktreeName}"`);
          } else {
            // Try plan
            const selectedPlan = planService.get(selectedItemId);
            if (selectedPlan) {
              repoId = selectedPlan.repoId;
              worktreeId = selectedPlan.worktreeId;
              const worktreeNode = treeItemsRef.current.find(
                i => i.type === "worktree" && i.repoId === repoId && (i.worktreeId === worktreeId || i.id === worktreeId)
              );
              worktreeName = worktreeNode?.worktreeName ?? "unknown";
              logger.info(`[MainWindowLayout] Command+N: Creating new thread in selected plan's worktree "${worktreeName}"`);
            }
          }
        }

        // 2. Fallback to most recently used worktree (from MRU store)
        if (!repoId || !worktreeId) {
          const mru = useMRUWorktreeStore.getState().getMRUWorktree();
          if (!mru) {
            logger.warn("[MainWindowLayout] Command+N: No worktrees available");
            return;
          }
          repoId = mru.repoId;
          worktreeId = mru.worktreeId;
          worktreeName = useRepoWorktreeLookupStore.getState().getWorktreeName(mru.repoId, mru.worktreeId);
          logger.info(`[MainWindowLayout] Command+N: Creating new thread in MRU worktree "${worktreeName}"`);
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
      setupPaneLayoutListeners();
      listenersInitialized.current = true;
    }

    async function initStores() {
      try {
        // Initialize stores in parallel - error isolation
        await Promise.allSettled([
          paneLayoutService.hydrate(),
          treeMenuService.hydrate(),
          layoutService.hydrate(),
          debugPanelService.hydrate(),
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
    const unlisten = listen<ContentPaneView & { targetWindow?: string }>("set-content-pane-view", async (event) => {
      // Filter by targetWindow (WS broadcast goes to all windows)
      const { targetWindow, ...view } = event.payload;
      if (targetWindow && targetWindow !== "main") return;
      // Update both tree selection and content pane via navigation service
      await navigationService.navigateToView(view as ContentPaneView);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Navigation Event Handler (from macOS menu / tray)
  // ═══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    const unlisten = listen<{ targetWindow?: string; tab: string }>("navigate", async (event) => {
      // Filter by targetWindow (WS broadcast goes to all windows)
      const { targetWindow, tab } = event.payload;
      if (targetWindow && targetWindow !== "main") return;
      const target = tab as NavTarget;
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

  const handleItemSelect = useCallback(async (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request", event?: React.MouseEvent) => {
    // Cmd+Click (metaKey) or middle-click (button === 1) opens in a new tab
    const newTab = event?.metaKey || event?.button === 1;
    if (itemType === "thread") {
      await navigationService.navigateToThread(itemId, { newTab });
    } else if (itemType === "plan") {
      await navigationService.navigateToPlan(itemId, { newTab });
    } else if (itemType === "terminal") {
      await navigationService.navigateToTerminal(itemId);
    } else if (itemType === "pull-request") {
      await navigationService.navigateToPullRequest(itemId, { newTab });
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Header Action Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSettingsClick = useCallback(async () => {
    await navigationService.navigateToView({ type: "settings" });
  }, []);

  const handleArchiveClick = useCallback(async () => {
    await navigationService.navigateToView({ type: "archive" });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // New Thread/Worktree Handlers (from tree section plus buttons)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleNewThread = useCallback(async (repoId: string, worktreeId: string, _worktreePath: string) => {
    try {
      const thread = await threadService.create({
        repoId,
        worktreeId,
        prompt: "", // Empty prompt - user will fill it in
      });

      // Refresh tree menu to show new thread, then navigate to it
      await treeMenuService.hydrate();
      await navigationService.navigateToThread(thread.id, { autoFocus: true });
    } catch (err) {
      logger.error(`[MainWindowLayout] Failed to create thread:`, err);
    }
  }, []);

  const handleCreatePrCallback = useCallback(
    (repoId: string, worktreeId: string, worktreePath: string) => {
      handleCreatePr(repoId, worktreeId, worktreePath);
    },
    [],
  );

  const handleNewTerminal = useCallback(async (worktreeId: string, worktreePath: string) => {
    try {
      const session = await terminalSessionService.create(worktreeId, worktreePath);
      await navigationService.navigateToTerminal(session.id);
    } catch (err) {
      logger.error(`[MainWindowLayout] Failed to create terminal:`, err);
    }
  }, []);

  // Listen for Command+T / Ctrl+T to create new terminal
  // Priority: 1) Selected thread/plan's worktree, 2) Most recent worktree
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();

        let worktreeId: string | undefined;
        let worktreePath: string | undefined;

        // 1. Check if a thread or plan is currently selected
        const selectedItemId = useTreeMenuStore.getState().selectedItemId;
        if (selectedItemId) {
          const selectedThread = threadService.get(selectedItemId);
          if (selectedThread) {
            const worktreeNode = treeItemsRef.current.find(
              i => i.type === "worktree" && i.repoId === selectedThread.repoId && (i.worktreeId === selectedThread.worktreeId || i.id === selectedThread.worktreeId)
            );
            if (worktreeNode) {
              worktreeId = worktreeNode.worktreeId ?? worktreeNode.id;
              worktreePath = worktreeNode.worktreePath;
            }
          } else {
            const selectedPlan = planService.get(selectedItemId);
            if (selectedPlan) {
              const worktreeNode = treeItemsRef.current.find(
                i => i.type === "worktree" && i.repoId === selectedPlan.repoId && (i.worktreeId === selectedPlan.worktreeId || i.id === selectedPlan.worktreeId)
              );
              if (worktreeNode) {
                worktreeId = worktreeNode.worktreeId ?? worktreeNode.id;
                worktreePath = worktreeNode.worktreePath;
              }
            }
          }
        }

        // 2. Fallback to most recently used worktree (from MRU store)
        if (!worktreeId || !worktreePath) {
          const mru = useMRUWorktreeStore.getState().getMRUWorktree();
          if (!mru) {
            logger.warn("[MainWindowLayout] Command+T: No worktrees available");
            return;
          }
          worktreeId = mru.worktreeId;
          worktreePath = useRepoWorktreeLookupStore.getState().getWorktreePath(mru.repoId, mru.worktreeId);
        }

        await handleNewTerminal(worktreeId, worktreePath!);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleNewTerminal]);

  const handleNewWorktree = useCallback(async (repoName: string) => {
    logger.info(`[MainWindowLayout] New worktree requested for repo ${repoName}`);

    // Sync existing worktrees to get current names
    const existingWorktrees = await worktreeService.sync(repoName);
    const existingNames = new Set(existingWorktrees.map(w => w.name));

    // Generate unique random name and temp ID
    const worktreeName = generateUniqueWorktreeName(existingNames);
    const tempWorktreeId = crypto.randomUUID();
    logger.info(`[MainWindowLayout] Auto-generated worktree name: "${worktreeName}" (temp: ${tempWorktreeId})`);

    // Resolve repoId from repoName
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repoId = lookupStore.getRepoIdByName(repoName);
    if (!repoId) {
      logger.error(`[MainWindowLayout] Could not find repoId for "${repoName}"`);
      return;
    }

    // Optimistic insert — worktree appears immediately in sidebar
    lookupStore.addOptimisticWorktree(repoId, tempWorktreeId, worktreeName);
    setCreatingWorktreeIds((prev) => new Set([...prev, tempWorktreeId]));

    // Expand the new worktree node
    await treeMenuService.expandSection(tempWorktreeId);

    try {
      await worktreeService.create(repoName, worktreeName);

      // Re-sync and hydrate to get the real worktree data
      await worktreeService.sync(repoName);

      // Remove temp entry before hydrate replaces it with real data
      useRepoWorktreeLookupStore.getState().reconcileWorktree(repoId, tempWorktreeId);
      await useRepoWorktreeLookupStore.getState().hydrate();

      await treeMenuService.hydrate();

      // Sync worktrees to get the real worktree data (shared between terminal + setup thread)
      const syncedWorktrees = await worktreeService.sync(repoName);
      const newWorktree = syncedWorktrees.find(w => w.name === worktreeName);

      // Auto-create terminal in bottom pane for the new worktree
      if (newWorktree) {
        try {
          const session = await terminalSessionService.create(newWorktree.id, newWorktree.path);
          await navigationService.navigateToTerminal(session.id);
        } catch (termErr) {
          logger.warn(`[MainWindowLayout] Failed to auto-create terminal for worktree (non-fatal):`, termErr);
        }
      }

      // Auto-run setup thread if repo has a worktreeSetupPrompt
      try {
        const slug = slugify(repoName);
        const settings = await loadSettings(slug);
        if (settings.worktreeSetupPrompt && newWorktree) {
          logger.info(`[MainWindowLayout] Auto-creating setup thread for worktree "${worktreeName}"`);
          await createThread({
            prompt: settings.worktreeSetupPrompt,
            repoId: settings.id,
            worktreeId: newWorktree.id,
            worktreePath: newWorktree.path,
            permissionMode: "implement",
            skipNaming: true,
          });
          logger.info(`[MainWindowLayout] Setup thread created for worktree "${worktreeName}"`);
        }
      } catch (setupErr) {
        logger.warn(`[MainWindowLayout] Failed to create setup thread (non-fatal):`, setupErr);
      }

      logger.info(`[MainWindowLayout] Created worktree "${worktreeName}" in ${repoName}`);
    } catch (error) {
      // Rollback: remove optimistic entry
      useRepoWorktreeLookupStore.getState().removeOptimisticWorktree(repoId, tempWorktreeId);
      logger.error(`[MainWindowLayout] Failed to create worktree:`, error);
    } finally {
      setCreatingWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(tempWorktreeId);
        return next;
      });
    }
  }, []);

  const handleNewRepo = useCallback(async () => {
    logger.info(`[MainWindowLayout] New repository requested`);

    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select Project Folder",
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

  const handleCreateProject = useCallback(async () => {
    logger.info(`[MainWindowLayout] Create project requested`);
    try {
      const projectPath = await createNewProjectAndHydrate();
      if (projectPath) {
        logger.info(`[MainWindowLayout] Created new project at ${projectPath}`);
      }
    } catch (error) {
      logger.error(`[MainWindowLayout] Failed to create project:`, error);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Pin/Hide Handlers (workspace filtering)
  // ═══════════════════════════════════════════════════════════════════════════

  const handlePinToggle = useCallback(async (worktreeId: string) => {
    logger.info(`[MainWindowLayout] Pin toggle requested for worktree ${worktreeId}`);
    try {
      await treeMenuService.togglePinWorktree(worktreeId);
    } catch (err) {
      logger.error(`[MainWindowLayout] Failed to toggle pin:`, err);
    }
  }, []);

  const handleUnhideAll = useCallback(async () => {
    logger.info(`[MainWindowLayout] Unpin all requested`);
    try {
      await treeMenuService.pinWorktree(null);
    } catch (err) {
      logger.error(`[MainWindowLayout] Failed to unpin:`, err);
    }
  }, []);

  const handleArchiveWorktree = useCallback(async (repoName: string, worktreeId: string, worktreeName: string) => {
    logger.info(`[MainWindowLayout] Archive worktree requested: ${worktreeName} (${worktreeId}) in repo ${repoName}`);

    // Get entities in this worktree for confirmation counts and tab closure
    const threads = threadService.getByWorktree(worktreeId);
    const plans = planService.getByWorktree(worktreeId);
    const terminals = terminalSessionService.getByWorktree(worktreeId);
    const threadCount = threads.length;
    const planCount = plans.length;

    // Confirm with user
    const parts: string[] = [];
    if (threadCount > 0) parts.push(`${threadCount} thread${threadCount === 1 ? "" : "s"}`);
    if (planCount > 0) parts.push(`${planCount} plan${planCount === 1 ? "" : "s"}`);
    const message = parts.length > 0
      ? `Archive workspace "${worktreeName}" and its ${parts.join(" and ")}?`
      : `Archive workspace "${worktreeName}"?`;

    const confirmed = await confirm(message, {
      title: "Archive workspace",
      kind: "warning",
    });

    if (!confirmed) {
      logger.info(`[MainWindowLayout] Archive worktree cancelled`);
      return;
    }

    // Capture worktree info for rollback
    const lookupStore = useRepoWorktreeLookupStore.getState();
    const repoId = lookupStore.getRepoIdByName(repoName);
    if (!repoId) {
      logger.error(`[MainWindowLayout] Could not find repoId for "${repoName}"`);
      return;
    }
    const repo = lookupStore.repos.get(repoId);
    const worktreeInfo = repo?.worktrees.get(worktreeId);

    // ── Optimistic UI removal ──
    lookupStore.removeOptimisticWorktree(repoId, worktreeId);
    await closeTabsByWorktree({
      worktreeId,
      threadIds: new Set(threads.map(t => t.id)),
      planIds: new Set(plans.map(p => p.id)),
      terminalIds: new Set(terminals.map(t => t.id)),
    });
    await treeMenuService.hydrate();

    // ── Background archive (fire-and-forget with rollback) ──
    (async () => {
      try {
        // Parallelize entity archiving
        await Promise.all([
          terminalSessionService.archiveByWorktree(worktreeId),
          ...threads.map(t => threadService.archive(t.id)),
          ...plans.map(p => planService.archive(p.id)),
          pullRequestService.archiveByWorktree(worktreeId),
        ]);

        // Delete worktree after entities are archived
        await worktreeService.delete(repoName, worktreeName);

        // Reconcile with disk
        await worktreeService.sync(repoName);
        await useRepoWorktreeLookupStore.getState().hydrate();
        await treeMenuService.hydrate();

        logger.info(`[MainWindowLayout] Successfully archived worktree "${worktreeName}" with ${threadCount} threads, ${planCount} plans`);
      } catch (error) {
        logger.error(`[MainWindowLayout] Failed to archive worktree, rolling back:`, error);

        // Rollback: restore the worktree entry
        if (worktreeInfo) {
          useRepoWorktreeLookupStore.getState().restoreWorktree(repoId, worktreeId, worktreeInfo);
        }
        // Re-hydrate to reconcile with actual disk state
        await useRepoWorktreeLookupStore.getState().hydrate();
        await treeMenuService.hydrate();

        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        toast.error(`Failed to archive worktree "${worktreeName}": ${errorMsg}`);
      }
    })();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Files Tree Item Handler (opens right panel Files tab)
  // ═══════════════════════════════════════════════════════════════════════════

  const handleFilesClick = useCallback((item: TreeItemNode) => {
    if (!item.worktreeId) return;
    const worktreeNode = treeItems.find(
      (i) => i.type === "worktree" && i.id === item.worktreeId,
    );
    if (worktreeNode?.repoId && worktreeNode.worktreePath) {
      rightPanel.openFileBrowser(
        worktreeNode.repoId,
        item.worktreeId,
        worktreeNode.worktreePath,
      );
    }
  }, [treeItems, rightPanel]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Search Navigation Handlers
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSearchNavigateToThread = useCallback(async (threadId: string) => {
    await navigationService.navigateToThread(threadId);
  }, []);

  const handleSearchNavigateToFile = useCallback(async (
    filePath: string,
    lineNumber: number,
    worktreePath: string,
    isPlan: boolean,
  ) => {
    if (isPlan) {
      const plans = planService.getAll();
      const plan = plans.find((p) => p.relativePath === filePath);
      if (plan) {
        await navigationService.navigateToPlan(plan.id);
        return;
      }
    }
    const absolutePath = `${worktreePath}/${filePath}`;
    await navigationService.navigateToFile(absolutePath, { lineNumber });
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Debug Panel State
  // ═══════════════════════════════════════════════════════════════════════════

  const debugPanelOpen = useDebugPanelStore((s) => s.isOpen);
  const debugPanelHeight = useDebugPanelStore((s) => s.panelHeight);

  const handleDebugPanelHeightChange = useCallback((height: number) => {
    debugPanelService.setPanelHeight(height);
  }, []);

  const handleDebugPanelDragEnd = useCallback((height: number) => {
    debugPanelService.setPanelHeight(height);
  }, []);

  const handleDebugPanelClose = useCallback(() => {
    debugPanelService.close();
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <MainWindowProvider>
      <div data-testid="main-layout" className="flex flex-col h-full bg-surface-900">
        <WindowTitlebar
          leftPanelOpen={leftPanelOpen}
          rightPanelOpen={rightPanel.isOpen}
          terminalPanelOpen={terminalPanelOpen}
          onToggleLeftPanel={() => setLeftPanelOpen((v) => !v)}
          onToggleRightPanel={rightPanel.toggle}
          onToggleTerminalPanel={handleToggleTerminalPanel}
        />
        {/* Main horizontal layout */}
        <div className="flex flex-1 min-h-0">
          {/* Left Panel: Tree Menu */}
          {leftPanelOpen && <ResizablePanel
            position="left"
            minWidth={200}
            defaultWidth="1/3"
            persistKey="tree-panel-width"
            className="bg-surface-950 flex flex-col"
          >
            <TreePanelHeader
              onSettingsClick={handleSettingsClick}
              onArchiveClick={handleArchiveClick}
              onNewRepo={handleNewRepo}
              onCreateProject={handleCreateProject}
              onUnhideAll={handleUnhideAll}
              hasHiddenOrPinned={pinnedWorktreeId !== null}
            />
            <TreeMenu
              onItemSelect={handleItemSelect}
              onFilesClick={handleFilesClick}
              onNewThread={handleNewThread}
              onCreatePr={handleCreatePrCallback}
              onNewTerminal={handleNewTerminal}
              onNewWorktree={handleNewWorktree}
              onArchiveWorktree={handleArchiveWorktree}
              creatingWorktreeIds={creatingWorktreeIds}
              onPinToggle={handlePinToggle}
              pinnedWorktreeId={pinnedWorktreeId}
              className="flex-1 min-h-0"
            />
            <button
              onClick={handleCreateProject}
              className="flex items-center gap-1.5 px-3 py-1.5 mx-2 mb-2 text-xs text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded transition-colors"
            >
              <span className="text-surface-500">+</span>
              New Project
            </button>
          </ResizablePanel>}

          {/* Center Panel: Split Layout + Terminal Panel */}
          <TerminalPanelLayout>
            <SplitLayoutContainer />
          </TerminalPanelLayout>

          {/* Right Panel: Tabbed (Search / Files / Changelog) */}
          {rightPanel.isOpen && (
            <ResizablePanel
              position="right"
              minWidth={180}
              maxWidth={Math.floor(window.innerWidth * 0.5)}
              defaultWidth={250}
              persistKey="right-panel-width"
              closeThreshold={120}
              onClose={rightPanel.close}
              className="bg-surface-950"
            >
              <RightPanelContainer
                activeTab={rightPanel.activeTab}
                onTabChange={rightPanel.openTab}
                onClose={rightPanel.close}
                filesContext={activeWorktreeContext}
                filesWorktreeOverride={rightPanel.state.filesWorktreeOverride}
                onNavigateToFile={handleSearchNavigateToFile}
                onNavigateToThread={handleSearchNavigateToThread}
              />
            </ResizablePanel>
          )}
        </div>

        {/* Bottom gutter: status legend + quick actions */}
        <BottomGutter />

        {/* Debug Panel (Cmd+Shift+D) */}
        {debugPanelOpen && (
          <ResizablePanelVertical
            height={debugPanelHeight}
            onHeightChange={handleDebugPanelHeightChange}
            onDragEnd={handleDebugPanelDragEnd}
            minHeight={150}
            closeThreshold={100}
            onClose={handleDebugPanelClose}
          >
            <DebugPanel />
          </ResizablePanelVertical>
        )}

        {/* Command Palette (Command+P) */}
        <CommandPalette
          isOpen={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />

        {/* Global toast notifications */}
        <GlobalToast />
      </div>
    </MainWindowProvider>
  );
}


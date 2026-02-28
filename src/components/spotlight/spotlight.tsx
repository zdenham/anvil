import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { z } from "zod";
import {
  AppResultSchema,
  OpenRepoResult,
  OpenMortResult,
  OpenThreadsResult,
  RefreshResult,
  SpotlightResult,
} from "./types";
import { PathsInfoSchema } from "@/lib/types/paths";
import { ResultsTray } from "./results-tray";
import { useSpotlightHistory } from "./use-spotlight-history";
import { CalculatorService } from "../../lib/calculator-service";
import { TriggerSearchInput, type TriggerStateInfo } from "../reusable/trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";
import { repoService, type Repository, eventBus } from "../../entities";
import { worktreeService } from "../../entities/worktrees";
import type { RepoWorktree } from "@core/types/repositories";
import { PERMISSION_MODE_CYCLE, type PermissionModeId } from "@core/types/permissions";
import { openControlPanel, showMainWindow, showMainWindowWithView } from "../../lib/hotkey-service";
import { logger } from "../../lib/logger-client";
import { savePromptToHistory, saveDraftToHistory } from "../../lib/prompt-history-helpers";
import { loadSettings } from "../../lib/app-data-store";
import { createThread } from "../../lib/thread-creation-service";

/** Error types for thread creation */
type ThreadCreationError =
  | { type: "no_repositories" }
  | { type: "no_versions"; repoName: string }
  | { type: "agent_failed"; message: string };

/** Convert ThreadCreationError to user-friendly message */
function formatThreadCreationError(error: ThreadCreationError): string {
  switch (error.type) {
    case "no_repositories":
      return "No repositories configured. Please add a repository first.";
    case "no_versions":
      return `No versions available for repository: ${error.repoName}`;
    case "agent_failed":
      return error.message;
    default:
      return "An unknown error occurred";
  }
}

export class SpotlightController {
  private calculatorService = new CalculatorService();

  /**
   * Initialize the controller.
   * Entity stores are hydrated at app startup, so no bootstrapping needed here.
   */
  async initialize(): Promise<void> {
    // Entity stores are hydrated at app startup via hydrateEntities()
  }

  /** Convert * and / to display symbols × and ÷ if query looks like a math expression */
  formatQueryForDisplay(query: string): string {
    if (this.calculatorService.isExpression(query)) {
      return this.calculatorService.toDisplayFormat(query);
    }
    return query;
  }

  /**
   * Checks if query partially matches a target string (case-insensitive)
   */
  private partialMatch(query: string, target: string): boolean {
    const normalizedQuery = query.toLowerCase().trim();
    const normalizedTarget = target.toLowerCase();
    return normalizedTarget.includes(normalizedQuery);
  }

  async search(query: string): Promise<SpotlightResult[]> {
    const results: SpotlightResult[] = [];

    // Check for calculator expression first
    if (this.calculatorService.isExpression(query)) {
      const evaluation = this.calculatorService.evaluate(query);
      results.push({
        type: "calculator",
        data: evaluation,
      });
    }

    // Also search for apps (user might be searching for "Calculator" app)
    if (query.trim()) {
      const rawAppResults = await invoke<unknown>("search_applications", {
        query,
      });
      const appResults = z.array(AppResultSchema).parse(rawAppResults);
      // Filter out Mort app since we have a manual Mort entry
      const filteredApps = appResults.filter((app) => app.name.toLowerCase() !== "mort");
      results.push(
        ...filteredApps.map((app) => ({ type: "app" as const, data: app }))
      );

      // Add "Mort" action if query partially matches
      if (this.partialMatch(query, "Mort")) {
        const openMortData: OpenMortResult = { action: "open-mort" };
        results.push({
          type: "action",
          data: openMortData,
        });
      }

      // Add "Open Repository" action if query partially matches
      if (this.partialMatch(query, "Open Repository")) {
        const openRepoData: OpenRepoResult = { action: "open-repo" };
        results.push({
          type: "action",
          data: openRepoData,
        });
      }

      // Add "Threads" action if query partially matches
      if (this.partialMatch(query, "Threads")) {
        const openThreadsData: OpenThreadsResult = { action: "open-threads" };
        results.push({
          type: "action",
          data: openThreadsData,
        });
      }

      // Add "Refresh" action ONLY in dev mode
      if (import.meta.env.DEV && this.partialMatch(query, "Refresh")) {
        const refreshData: RefreshResult = { action: "refresh" };
        results.push({
          type: "action",
          data: refreshData,
        });
      }

      // Always add a "create thread" option at the end
      results.push({
        type: "thread",
        data: { query: query.trim() },
      });
    }

    return results;
  }

  async resizeWindow(
    resultCount: number,
    inputExpanded: boolean,
    compact: boolean = false
  ): Promise<void> {
    console.log(
      `[SPOTLIGHT-HEIGHT] resizeWindow called: resultCount=${resultCount}, inputExpanded=${inputExpanded}, compact=${compact}`
    );
    await invoke("resize_spotlight", { resultCount, inputExpanded, compact });
  }

  async hideSpotlight(): Promise<void> {
    await invoke("hide_spotlight");
  }

  async openApplication(path: string): Promise<void> {
    await invoke("open_application", { path });
  }

  /**
   * Opens a directory in the specified application.
   * If the directory is already open, focuses the existing window.
   * Defaults to "Cursor" if no app is specified.
   */
  async openDirectoryInApp(path: string, app?: string): Promise<void> {
    await invoke("open_directory_in_app", { path, app });
  }

  async copyToClipboard(text: string): Promise<void> {
    await navigator.clipboard.writeText(text);
  }

  /**
   * Gets the repository to use for thread creation.
   * If only one repo exists, returns it. Otherwise returns null (needs selection).
   */
  getDefaultRepository(): Repository | null {
    const repos = repoService.getAll();
    if (repos.length === 1) {
      return repos[0];
    }
    return null;
  }

  /**
   * Gets all available repositories.
   */
  getRepositories(): Repository[] {
    return repoService.getAll();
  }

  /**
   * Creates a simple thread that runs directly in the source repository or worktree.
   * No worktree allocation, no branch management - just direct execution.
   *
   * Uses the shared thread creation service for optimistic UI and agent spawning,
   * then handles spotlight-specific window routing.
   *
   * @param content - The thread prompt/description
   * @param repo - The repository to work in
   * @param worktreePath - Optional worktree path. If provided, agent runs there instead of source repo.
   * @param options.useNSPanel - If true, opens in NSPanel (Shift+Enter). If false, opens in main window (Enter).
   */
  async createSimpleThread(
    content: string,
    repo: Repository,
    worktreePath?: string,
    options?: { useNSPanel?: boolean; permissionMode?: PermissionModeId }
  ): Promise<void> {
    const useNSPanel = options?.useNSPanel ?? true; // Default to NSPanel for backward compatibility

    // Determine working directory: worktree path if provided, otherwise source repo
    const workingDir = worktreePath ?? repo.sourcePath;

    if (!workingDir) {
      const error: ThreadCreationError = { type: "no_repositories" };
      logger.error("[spotlight:createSimpleThread] No working directory", { repoName: repo.name });
      throw error;
    }

    // Lookup repository settings to get the UUID
    const slug = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const settings = await loadSettings(slug);

    // Determine worktree ID - either from selected worktree or use main worktree
    let worktreeId: string;
    if (worktreePath) {
      const worktree = settings.worktrees.find(w => w.path === worktreePath);
      if (!worktree) {
        throw new Error(`Worktree not found for path: ${worktreePath}`);
      }
      worktreeId = worktree.id;
    } else {
      const mainWorktree = settings.worktrees.find(w => w.name === 'main');
      if (!mainWorktree) {
        throw new Error(`Main worktree not found for repository: ${repo.name}`);
      }
      worktreeId = mainWorktree.id;
    }

    // Use the shared thread creation service for optimistic UI + agent spawn
    const { threadId, taskId } = await createThread({
      prompt: content,
      repoId: settings.id,
      worktreeId,
      worktreePath: workingDir,
      permissionMode: options?.permissionMode,
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // Spotlight-specific: Route to appropriate window
    // ═══════════════════════════════════════════════════════════════════════════

    if (useNSPanel) {
      await openControlPanel(threadId, taskId, content);
    } else {
      await showMainWindowWithView({ type: "thread", threadId });
    }
  }

  /**
   * Opens a folder picker dialog and imports the selected folder as a repository.
   * Returns true if a folder was selected and imported successfully.
   */
  async openRepository(): Promise<boolean> {
    try {
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select a repository folder",
      });

      if (!selectedPath) {
        return false;
      }

      await repoService.createFromFolder(selectedPath);
      return true;
    } catch (error) {
      logger.error("Failed to open repository:", error);
      return false;
    }
  }
}

interface SpotlightState {
  query: string;
  results: SpotlightResult[];
  historyResults: SpotlightResult[];
  selectedIndex: number;
  inputExpanded: boolean;
  appSuffix: string;
  selectedWorktreeIndex: number;
  repoWorktrees: RepoWorktree[];  // Flat MRU list across all repositories
  worktreeOverlayVisible: boolean;  // Whether overlay is currently shown
  worktreeOverlayConfirming: boolean;  // Whether overlay is in "confirming" animation state
  permissionMode: PermissionModeId;
}

const INITIAL_STATE: SpotlightState = {
  query: "",
  results: [],
  historyResults: [],
  selectedIndex: 0,
  inputExpanded: false,
  appSuffix: "",
  selectedWorktreeIndex: 0,
  repoWorktrees: [],
  worktreeOverlayVisible: false,
  worktreeOverlayConfirming: false,
  permissionMode: "implement",
};

const INITIAL_TRIGGER_STATE: TriggerStateInfo = {
  isActive: false,
  results: [],
  selectedIndex: 0,
  isLoading: false,
};

/** Overlay component that shows current worktree when cycling with arrow keys */
function WorktreeOverlay({
  visible,
  repoWorktrees,
  selectedIndex,
  isConfirming,
}: {
  visible: boolean;
  repoWorktrees: RepoWorktree[];
  selectedIndex: number;
  isConfirming: boolean;
}) {
  if (!visible || repoWorktrees.length === 0) return null;

  const selected = repoWorktrees[selectedIndex];
  const hasMultipleRepos = new Set(repoWorktrees.map((w) => w.repoName)).size > 1;
  const hasMultipleWorktrees = repoWorktrees.length > 1;

  const worktreeLabel = hasMultipleRepos
    ? `${selected.repoName} / ${selected.worktree.name}`
    : selected.worktree.name;

  return (
    <div className={`absolute inset-0 z-50 pointer-events-none ${
      isConfirming ? 'animate-pulse' : ''
    }`}>
      {/* Full-width container matching spotlight input dimensions */}
      <div className="h-full flex items-center px-4">
        <div className="flex-1 flex items-center justify-between gap-3">
          {/* Left arrow indicator */}
          <div className={`flex items-center justify-center w-8 h-8 rounded-md transition-opacity ${
            hasMultipleWorktrees ? 'opacity-60' : 'opacity-0'
          }`}>
            <svg className="w-4 h-4 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </div>

          {/* Center content - selected worktree */}
          <div className="flex-1 flex flex-col items-center justify-center">
            <span className="text-[9px] text-surface-600 mb-px">
              switch worktree ↵
            </span>
            <span className="text-xs font-mono text-surface-400">
              {worktreeLabel}
            </span>
            {hasMultipleWorktrees && (
              <div className="flex items-center gap-1 mt-1">
                {repoWorktrees.map((_, idx) => (
                  <div
                    key={idx}
                    className={`w-1 h-1 rounded-full transition-colors ${
                      idx === selectedIndex
                        ? 'bg-surface-400'
                        : 'bg-surface-700'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Right arrow indicator */}
          <div className={`flex items-center justify-center w-8 h-8 rounded-md transition-opacity ${
            hasMultipleWorktrees ? 'opacity-60' : 'opacity-0'
          }`}>
            <svg className="w-4 h-4 text-surface-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Spotlight = () => {
  const [state, setState] = useState<SpotlightState>(INITIAL_STATE);
  const [triggerState, setTriggerState] = useState<TriggerStateInfo>(INITIAL_TRIGGER_STATE);
  const inputRef = useRef<TriggerSearchInputRef>(null);
  const controllerRef = useRef<SpotlightController>(new SpotlightController());
  // Track inputExpanded in a ref so async callbacks always have the latest value
  const inputExpandedRef = useRef(false);
  // Track trigger state in a ref so async callbacks can check current trigger status
  const triggerStateRef = useRef<TriggerStateInfo>(INITIAL_TRIGGER_STATE);
  // Timeout ref for auto-hiding worktree overlay
  const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { query, results, selectedIndex, inputExpanded, appSuffix, selectedWorktreeIndex, repoWorktrees } = state;

  // Keep refs in sync with state
  inputExpandedRef.current = inputExpanded;
  triggerStateRef.current = triggerState;

  const { handleHistoryNavigation, resetHistory, isInHistoryMode } =
    useSpotlightHistory({
      onQueryChange: async (newQuery: string) => {
        const controller = controllerRef.current;

        // Update query immediately
        setState((prev) => ({
          ...prev,
          query: newQuery,
          selectedIndex: 0,
        }));

        // Run search to populate results (including "create thread" option)
        // Resize is handled by the unified useEffect
        if (newQuery.trim()) {
          const newResults = await controller.search(newQuery);
          setState((prev) => ({
            ...prev,
            results: newResults,
            selectedIndex: 0,
          }));
        } else {
          setState((prev) => ({ ...prev, results: [] }));
        }

        // Set cursor to end after state update
        requestAnimationFrame(() => {
          inputRef.current?.setCursorPosition(newQuery.length);
        });
      },
      onHistoryResults: (historyResults: SpotlightResult[]) => {
        setState((prev) => ({
          ...prev,
          historyResults,
          selectedIndex: 0,
        }));
      },
    });

  // Convert trigger results to SpotlightResults when trigger is active
  // In history mode, we still use `results` since onQueryChange runs search
  const displayResults: SpotlightResult[] = triggerState.isActive
    ? triggerState.results.map((r) => ({
        type: "file" as const,
        data: { path: r.description, insertText: r.insertText },
      }))
    : results;

  const displaySelectedIndex = triggerState.isActive
    ? triggerState.selectedIndex
    : selectedIndex;

  // Centralized resize helper that properly handles compact mode for file triggers
  const resizeSpotlight = useCallback(
    async (resultCount: number, expanded: boolean, isCompact?: boolean) => {
      const controller = controllerRef.current;
      // Use provided isCompact flag, or default to false
      const compact = isCompact ?? false;
      await controller.resizeWindow(resultCount, expanded, compact);
    },
    []
  );

  const resetState = useCallback(() => {
    // Clear overlay timeout on reset
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }
    setState(INITIAL_STATE);
    resetHistory();
  }, [resetHistory]);

  /** Dismisses the worktree overlay with a brief visual confirmation */
  const dismissWorktreeOverlay = useCallback(() => {
    // Clear any existing timeout
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }
    // Start the confirming animation (brief pulse)
    setState((s) => ({ ...s, worktreeOverlayConfirming: true }));
    // After brief animation, hide the overlay
    setTimeout(() => {
      setState((s) => ({ ...s, worktreeOverlayVisible: false, worktreeOverlayConfirming: false }));
    }, 100);
  }, []);

  const activateResult = useCallback(
    async (result: SpotlightResult, options?: { metaKey?: boolean }) => {
      const controller = controllerRef.current;
      const useNSPanel = !(options?.metaKey ?? false); // Enter = NSPanel (default), Cmd+Enter = Main Window

      // Handle file selection - insert file path at trigger position
      if (result.type === "file") {
        const triggerResult = triggerState.results.find(
          (r) => r.insertText === result.data.insertText
        );
        if (triggerResult) {
          inputRef.current?.selectTriggerResult(triggerResult);
        }
        return; // Don't hide spotlight - continue editing
      }

      // Handle history selection - set the query and continue editing
      if (result.type === "history") {
        setState((prev) => ({
          ...prev,
          query: result.data.prompt,
          results: [],
          selectedIndex: 0,
        }));
        resetHistory();
        // Resize is handled by the unified useEffect (results changed to [])
        // Focus and set cursor to end after state update
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.setCursorPosition(result.data.prompt.length);
        });
        return; // Don't hide spotlight - continue editing
      }

      if (result.type === "app") {
        await controller.openApplication(result.data.path);
        await controller.hideSpotlight();
      } else if (result.type === "calculator" && result.data.isValid) {
        await controller.copyToClipboard(String(result.data.result));
        await controller.hideSpotlight();
      } else if (result.type === "thread") {
        const repos = controller.getRepositories();

        if (repos.length === 0) {
          logger.error(
            "No repositories available. Please add a repository first."
          );
          return;
        }

        // Get selected repo+worktree from unified MRU list
        const selected = repoWorktrees[selectedWorktreeIndex];
        if (!selected) {
          logger.error("No worktree selected");
          return;
        }

        // Find the repository by name (repoId in RepoWorktree is the name)
        const selectedRepo = repos.find(r => r.name === selected.repoName);
        if (!selectedRepo) {
          logger.error(`Repository not found: ${selected.repoName}`);
          return;
        }
        const selectedWorktree = selected.worktree;

        // Save prompt to history (fire and forget)
        savePromptToHistory(result.data.query);

        // Handle thread creation error (shared between simple and full flow)
        const handleThreadError = (error: unknown) => {
          logger.error("[Spotlight] Thread creation failed:", error);

          const threadError = error as ThreadCreationError;
          const message = formatThreadCreationError(threadError);
          const stack = error instanceof Error ? error.stack : undefined;

          invoke("show_error_panel", { message, stack })
            .catch((err) => {
              logger.error("[Spotlight] show_error_panel invoke failed:", err);
            });
        };

        // Run in selected worktree
        // Route based on modifier: Enter = main window, Shift+Enter = NSPanel
        controller
          .createSimpleThread(result.data.query, selectedRepo, selectedWorktree.path, {
            useNSPanel,
            permissionMode: state.permissionMode,
          })
          .catch(handleThreadError);

        // Hide spotlight immediately - thread window is already showing
        await controller.hideSpotlight();
      } else if (result.type === "action" && result.data.action === "open-repo") {
        // Hide spotlight first, then open file dialog
        // This is necessary because NSPanel may interfere with native dialogs
        await controller.hideSpotlight();
        // Small delay to ensure panel is fully hidden before opening dialog
        // await new Promise((resolve) => setTimeout(resolve, 100));
        await controller.openRepository();
      } else if (result.type === "action" && result.data.action === "open-mort") {
        try {
          await showMainWindow();
          await controller.hideSpotlight();
        } catch (error) {
          logger.error("[spotlight] Failed to open main window:", error);
        }
      } else if (result.type === "action" && result.data.action === "open-threads") {
        // TODO: Implement show_threads_panel Rust command
        // try {
        //   logger.info("[spotlight] Opening threads panel...");
        //   await controller.hideSpotlight();
        //   await invoke("show_threads_panel");
        //   logger.info("[spotlight] Threads panel opened");
        // } catch (error) {
        //   logger.error("[spotlight] Failed to open threads panel:", error);
        // }
        logger.warn("[spotlight] open-threads action not implemented - show_threads_panel command does not exist");
      } else if (result.type === "action" && result.data.action === "refresh") {
        // Full rebuild: agents + rust, then restart app

        // Build agents
        try {
          logger.info("[spotlight] [1/4] Building agents...");
          const agentsCmd = Command.create("pnpm", ["build:agents"], {
            cwd: __PROJECT_ROOT__,
          });
          const agentsOutput = await agentsCmd.execute();
          if (agentsOutput.code !== 0) {
            logger.error("[spotlight] [1/4] Agent build FAILED", { code: agentsOutput.code });
          }
        } catch (error) {
          logger.error("[spotlight] [1/4] Agent build exception:", error);
        }

        // Build Rust
        try {
          logger.info("[spotlight] [2/4] Building Rust...");
          const cargoCmd = Command.create("cargo", ["build", "--package", "mort"], {
            cwd: `${__PROJECT_ROOT__}/src-tauri`,
          });
          const cargoOutput = await cargoCmd.execute();
          if (cargoOutput.code !== 0) {
            logger.error("[spotlight] [2/4] Rust build FAILED", { code: cargoOutput.code });
          }
        } catch (error) {
          logger.error("[spotlight] [2/4] Rust build exception:", error);
        }

        // Start Vite before restart (the original Vite will die when app restarts)
        const vitePort = import.meta.env.DEV ? "1421" : "1420";
        try {
          logger.info("[spotlight] [3/4] Starting Vite dev server...");

          // Kill any existing process on the Vite port first
          // The old Vite from tauri dev is still running
          try {
            // Use lsof to find PIDs on the port
            const lsofCmd = Command.create("lsof", ["-ti", `:${vitePort}`]);
            const lsofResult = await lsofCmd.execute();
            const pids = (lsofResult.stdout || "").trim().split("\n").filter(Boolean);

            if (pids.length > 0) {
              // Kill each process using node (since we can't directly call kill)
              for (const pid of pids) {
                try {
                  const killCmd = Command.create("node", ["-e", `process.kill(${pid}, 'SIGTERM')`]);
                  await killCmd.execute();
                } catch {
                  // Process may already be dead
                }
              }
            }
          } catch {
            // lsof returns exit code 1 if no process found - that's ok
          }

          // Small delay to ensure port is released
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Spawn Vite in background - it needs to outlive the current process
          // Pass the same environment variables that dev mode uses
          const viteCmd = Command.create("pnpm", ["exec", "vite", "--port", vitePort], {
            cwd: __PROJECT_ROOT__,
            env: {
              MORT_VITE_PORT: vitePort,
              MORT_APP_SUFFIX: "dev",
              MORT_DISABLE_HMR: "true",
            },
          });

          // Use spawn() instead of execute() so it runs in background
          await viteCmd.spawn();

          // Wait for Vite to be ready (poll the port)
          let viteReady = false;
          for (let i = 0; i < 50; i++) {
            try {
              const response = await fetch(`http://localhost:${vitePort}/`);
              if (response.ok || response.status === 404) {
                viteReady = true;
                break;
              }
            } catch {
              // Not ready yet, wait and retry
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          if (!viteReady) {
            logger.warn("[spotlight] [3/4] Vite may not be ready, proceeding anyway...");
          }
        } catch (error) {
          logger.error("[spotlight] [3/4] Failed to start Vite:", error);
        }

        // Restart the app to pick up all changes (agents, frontend, rust)
        logger.info("[spotlight] [4/4] Restarting app...");
        await invoke("restart_app");
      }
    },
    [triggerState.results, repoWorktrees, selectedWorktreeIndex, resizeSpotlight, inputExpanded, state.permissionMode]
  );

  // Initialize controller on mount and fetch app suffix
  useEffect(() => {
    controllerRef.current.initialize();

    // Fetch app suffix for visual differentiation
    invoke<unknown>("get_paths_info")
      .then((raw) => {
        const info = PathsInfoSchema.parse(raw);
        setState((prev) => ({ ...prev, appSuffix: info.app_suffix }));
      })
      .catch((error) => {
        logger.error("Failed to get paths info:", error);
      });
  }, []);

  // Load worktrees from ALL repositories and sort by MRU
  const loadWorktrees = useCallback(async () => {
    const controller = controllerRef.current;
    const repos = controller.getRepositories();

    if (repos.length === 0) {
      setState((prev) => ({
        ...prev,
        repoWorktrees: [],
        selectedWorktreeIndex: 0,
      }));
      return;
    }

    const allRepoWorktrees: RepoWorktree[] = [];

    for (const repo of repos) {
      try {
        const worktrees = await worktreeService.sync(repo.name);
        for (const wt of worktrees) {
          allRepoWorktrees.push({
            repoName: repo.name,
            repoId: repo.name, // Using name as ID for now, will need settings lookup for UUID
            worktree: wt,
          });
        }
      } catch (err) {
        logger.error(`[Spotlight] Failed to load worktrees for ${repo.name}:`, err);
      }
    }

    // Sort by MRU across ALL repos
    allRepoWorktrees.sort((a, b) =>
      (b.worktree.lastAccessedAt ?? 0) - (a.worktree.lastAccessedAt ?? 0)
    );

    setState((prev) => ({
      ...prev,
      repoWorktrees: allRepoWorktrees,
      selectedWorktreeIndex: 0, // Reset to first (most recent)
    }));
  }, []);

  // Load available worktrees when spotlight mounts
  useEffect(() => {
    loadWorktrees();
  }, [loadWorktrees]);

  // Keyboard navigation
  useEffect(() => {
    inputRef.current?.focus();
    const controller = controllerRef.current;

    const handleKeyDown = async (e: KeyboardEvent) => {
      // When trigger is active, handle navigation through trigger results
      if (triggerState.isActive) {
        switch (e.key) {
          case "Escape":
            e.preventDefault();
            inputRef.current?.closeTrigger();
            return;
          case "ArrowDown":
            e.preventDefault();
            inputRef.current?.setTriggerSelectedIndex(
              Math.min(triggerState.selectedIndex + 1, triggerState.results.length - 1)
            );
            return;
          case "ArrowUp":
            e.preventDefault();
            inputRef.current?.setTriggerSelectedIndex(
              Math.max(triggerState.selectedIndex - 1, 0)
            );
            return;
          case "Enter":
          case "Tab":
            if (triggerState.results[triggerState.selectedIndex]) {
              e.preventDefault();
              inputRef.current?.selectTriggerResult(triggerState.results[triggerState.selectedIndex]);
            }
            return;
        }
      }

      switch (e.key) {
        case "Escape":
          await controller.hideSpotlight();
          break;
        case "Tab": {
          e.preventDefault();
          if (e.shiftKey) {
            // Shift+Tab = cycle permission mode
            setState((prev) => {
              const idx = PERMISSION_MODE_CYCLE.indexOf(prev.permissionMode);
              const next = PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
              return { ...prev, permissionMode: next };
            });
          } else {
            // Tab = cycle worktree forward
            if (repoWorktrees.length > 1) {
              setState((prev) => ({
                ...prev,
                selectedWorktreeIndex:
                  (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
              }));
            }
          }
          break;
        }
        case "ArrowDown":
          // Skip history navigation if Command key is pressed
          if (e.metaKey) break;
          // Check if in history mode first
          if (isInHistoryMode) {
            const handled = await handleHistoryNavigation("down");
            if (handled) {
              e.preventDefault();
              break;
            }
          }
          if (displayResults.length > 1) {
            e.preventDefault();
            setState((prev) => ({
              ...prev,
              selectedIndex:
                prev.selectedIndex < displayResults.length - 1
                  ? prev.selectedIndex + 1
                  : prev.selectedIndex,
            }));
          }
          break;
        case "ArrowUp":
          // Skip history navigation if Command key is pressed
          if (e.metaKey) break;
          // Check if history navigation should handle this
          if (!query.trim() || isInHistoryMode) {
            const handled = await handleHistoryNavigation("up");
            if (handled) {
              e.preventDefault();
              break;
            }
          }
          if (displayResults.length > 1) {
            e.preventDefault();
            setState((prev) => ({
              ...prev,
              selectedIndex:
                prev.selectedIndex > 0
                  ? prev.selectedIndex - 1
                  : prev.selectedIndex,
            }));
          }
          break;
        case "ArrowRight": {
          // Show overlay and cycle worktrees only when query is empty
          const isQueryEmpty = query.trim() === "";
          if (isQueryEmpty && repoWorktrees.length >= 1) {
            e.preventDefault();
            setState((s) => {
              // First press just opens the overlay, subsequent presses cycle
              const shouldCycle = s.worktreeOverlayVisible && s.repoWorktrees.length > 1;
              return {
                ...s,
                worktreeOverlayVisible: true,
                selectedWorktreeIndex: shouldCycle
                  ? (s.selectedWorktreeIndex + 1) % s.repoWorktrees.length
                  : s.selectedWorktreeIndex,
              };
            });
          }
          // When query is non-empty, let default behavior happen (cursor moves right)
          break;
        }
        case "ArrowLeft": {
          // Show overlay and cycle worktrees only when query is empty
          const isQueryEmptyLeft = query.trim() === "";
          if (isQueryEmptyLeft && repoWorktrees.length >= 1) {
            e.preventDefault();
            setState((s) => {
              // First press just opens the overlay, subsequent presses cycle
              const shouldCycle = s.worktreeOverlayVisible && s.repoWorktrees.length > 1;
              return {
                ...s,
                worktreeOverlayVisible: true,
                selectedWorktreeIndex: shouldCycle
                  ? (s.selectedWorktreeIndex > 0
                      ? s.selectedWorktreeIndex - 1
                      : s.repoWorktrees.length - 1)
                  : s.selectedWorktreeIndex,
              };
            });
          }
          // When query is non-empty, let default behavior happen (cursor moves left)
          break;
        }
        case "Enter":
          // Shift+Enter = insert newline (let default behavior happen)
          if (e.shiftKey) {
            break;
          }
          e.preventDefault();
          // If worktree overlay is visible, Enter confirms the selection
          if (state.worktreeOverlayVisible) {
            dismissWorktreeOverlay();
            break;
          }
          if (displayResults.length > 0 && displayResults[selectedIndex]) {
            // Pass metaKey to activateResult for routing:
            // - Enter (no Cmd) = open in main window
            // - Cmd+Enter = open in NSPanel (overlay window)
            await activateResult(displayResults[selectedIndex], { metaKey: e.metaKey });
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    displayResults,
    selectedIndex,
    activateResult,
    query,
    isInHistoryMode,
    handleHistoryNavigation,
    triggerState,
    repoWorktrees,
    selectedWorktreeIndex,
    state.worktreeOverlayVisible,
    dismissWorktreeOverlay,
  ]);

  // Handler for panel hidden - moved outside useEffect to avoid hook violations
  const handlePanelHidden = useCallback(async () => {
    const trimmedQuery = query.trim();

    // Save draft if input is non-empty (saveDraftToHistory already checks for duplicates)
    if (trimmedQuery !== "") {
      await saveDraftToHistory(trimmedQuery);
      logger.debug("[Spotlight] Draft saved on focus loss:", { query: trimmedQuery });
    }

    // Existing reset logic
    resetState();
  }, [query, resetState]);

  // Focus input and refresh worktrees when spotlight is shown, reset state when hidden
  // Uses eventBus for Tauri panel events (global emit, not emit_to for NSPanels)
  useEffect(() => {
    const handleSpotlightShown = () => {
      inputRef.current?.focus();
      // Asynchronously refresh worktrees from git when spotlight opens
      // This runs in the background so it doesn't block the UI
      loadWorktrees();
    };

    eventBus.on("spotlight-shown", handleSpotlightShown);
    eventBus.on("panel-hidden", handlePanelHidden);

    return () => {
      eventBus.off("spotlight-shown", handleSpotlightShown);
      eventBus.off("panel-hidden", handlePanelHidden);
    };
  }, [handlePanelHidden, loadWorktrees]);

  const handleQueryChange = useCallback(
    async (newQuery: string) => {
      const controller = controllerRef.current;

      // Convert * and / to display symbols for math expressions (synchronous)
      const displayQuery = controller.formatQueryForDisplay(newQuery);

      // Update input state immediately (fixes cursor jumping)
      setState((prev) => ({
        ...prev,
        query: displayQuery,
        selectedIndex: 0,
      }));

      if (!displayQuery.trim()) {
        // Clear results - resize is handled by the unified useEffect below
        setState((prev) => ({ ...prev, results: [] }));
        return;
      }

      // Perform async operations after input state is updated
      // Resize is handled by the unified useEffect below
      const newResults = await controller.search(displayQuery);

      // Update results separately
      setState((prev) => ({
        ...prev,
        results: newResults,
        selectedIndex: 0,
      }));
    },
    []
  );

  // Unified resize logic - single source of truth for window height
  // Watches both trigger state and normal results to avoid race conditions
  useEffect(() => {
    if (triggerState.isActive) {
      // Trigger is active - resize for trigger results (compact mode)
      resizeSpotlight(triggerState.results.length, inputExpanded, true);
    } else {
      // No trigger - resize for normal results (non-compact mode)
      resizeSpotlight(results.length, inputExpanded, false);
    }
  }, [triggerState.isActive, triggerState.results.length, results.length, inputExpanded, resizeSpotlight]);

  // Dismiss worktree overlay when user starts typing
  useEffect(() => {
    if (query.length > 0 && state.worktreeOverlayVisible && !state.worktreeOverlayConfirming) {
      dismissWorktreeOverlay();
    }
  }, [query, state.worktreeOverlayVisible, state.worktreeOverlayConfirming, dismissWorktreeOverlay]);

  // Cleanup overlay timeout on unmount
  useEffect(() => {
    return () => {
      if (overlayTimeoutRef.current) {
        clearTimeout(overlayTimeoutRef.current);
      }
    };
  }, []);

  const handleExpandedChange = useCallback((expanded: boolean) => {
    // Just update state - resize is handled by the unified useEffect
    setState((prev) => ({ ...prev, inputExpanded: expanded }));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (displayResults.length > 0 && displayResults[selectedIndex]) {
      activateResult(displayResults[selectedIndex]);
    }
  };

  // Build CSS class for spotlight container
  const spotlightClasses = [
    "w-full",
    "spotlight-container",
    appSuffix && `spotlight-${appSuffix}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div data-testid="spotlight" className={`${spotlightClasses} relative`}>
      <form onSubmit={handleSubmit}>
        <TriggerSearchInput
          ref={inputRef}
          data-testid="spotlight-input"
          value={query}
          onChange={(value) => {
            resetHistory(); // Exit history mode when user types
            handleQueryChange(value);
          }}
          onExpandedChange={handleExpandedChange}
          hasContentBelow={displayResults.length > 0}
          triggerContext={{
            // Use MRU worktree path for file triggers - this ensures "@" works
            // correctly even with multiple repositories configured
            rootPath: repoWorktrees[0]?.worktree.path ?? null,
          }}
          disableDropdown // Render trigger results in ResultsTray instead
          onTriggerStateChange={setTriggerState}
          autoFocus
        />
      </form>
      <ResultsTray
        results={displayResults}
        selectedIndex={displaySelectedIndex}
        onSelectIndex={(index) => {
          if (triggerState.isActive) {
            inputRef.current?.setTriggerSelectedIndex(index);
          } else {
            setState((prev) => ({ ...prev, selectedIndex: index }));
          }
        }}
        onActivate={activateResult}
        worktreeInfo={{
          repoWorktrees,
          selectedWorktreeIndex,
          repoCount: controllerRef.current.getRepositories().length,
        }}
        permissionMode={state.permissionMode}
      />
      <WorktreeOverlay
        visible={state.worktreeOverlayVisible}
        repoWorktrees={repoWorktrees}
        selectedIndex={selectedWorktreeIndex}
        isConfirming={state.worktreeOverlayConfirming}
      />
    </div>
  );
};

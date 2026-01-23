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
import { spawnSimpleAgent } from "../../lib/agent-service";
import { openControlPanel, showMainWindow } from "../../lib/hotkey-service";
import { logger } from "../../lib/logger-client";
import { promptHistoryService } from "../../lib/prompt-history-service";
import { loadSettings } from "../../lib/persistence";

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
   * Note: Thread metadata is created by the simple-runner process, not here.
   * This follows the "Agent Process Architecture" principle from agents.md.
   *
   * @param content - The thread prompt/description
   * @param repo - The repository to work in
   * @param worktreePath - Optional worktree path. If provided, agent runs there instead of source repo.
   */
  async createSimpleThread(content: string, repo: Repository, worktreePath?: string): Promise<void> {
    const startTime = Date.now();
    logger.info("═══════════════════════════════════════════════════════════════");
    logger.info("[spotlight:createSimpleThread] START");
    logger.info("═══════════════════════════════════════════════════════════════");
    logger.info("[spotlight:createSimpleThread] Input parameters:", {
      repoName: repo.name,
      repoSourcePath: repo.sourcePath,
      worktreePath: worktreePath ?? "NOT PROVIDED",
      contentLength: content.length,
      contentPreview: content.substring(0, 100),
    });

    // Determine working directory: worktree path if provided, otherwise source repo
    const workingDir = worktreePath ?? repo.sourcePath;
    logger.info(`[spotlight:createSimpleThread] Resolved workingDir: ${workingDir}`);

    if (!workingDir) {
      const error: ThreadCreationError = { type: "no_repositories" };
      logger.error(
        `[spotlight:createSimpleThread] CRITICAL: Repository ${repo.name} has no sourcePath and no worktree provided`
      );
      logger.error("[spotlight:createSimpleThread] repo object:", JSON.stringify(repo, null, 2));
      throw error;
    }

    // Lookup repository settings to get the UUID
    const slug = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    logger.info(`[spotlight:createSimpleThread] Loading settings for slug: ${slug}`);

    let settings;
    try {
      settings = await loadSettings(slug);
      logger.info(`[spotlight:createSimpleThread] Settings loaded:`, {
        settingsId: settings.id,
        worktreesCount: settings.worktrees?.length ?? 0,
      });
    } catch (settingsError) {
      logger.error("[spotlight:createSimpleThread] Failed to load settings:", {
        slug,
        error: settingsError,
        errorMessage: settingsError instanceof Error ? settingsError.message : String(settingsError),
      });
      throw settingsError;
    }

    // Determine worktree ID - either from selected worktree or use main worktree
    let worktreeId: string;
    if (worktreePath) {
      // Find worktree by path
      logger.info(`[spotlight:createSimpleThread] Looking for worktree with path: ${worktreePath}`);
      const worktree = settings.worktrees.find(w => w.path === worktreePath);
      if (!worktree) {
        logger.error("[spotlight:createSimpleThread] Worktree not found for path:", {
          worktreePath,
          availableWorktrees: settings.worktrees.map(w => ({ name: w.name, path: w.path, id: w.id })),
        });
        throw new Error(`Worktree not found for path: ${worktreePath}`);
      }
      worktreeId = worktree.id;
      logger.info(`[spotlight:createSimpleThread] Found worktree: name=${worktree.name}, id=${worktreeId}`);
    } else {
      // Use main worktree (first in list, or create if missing)
      logger.info("[spotlight:createSimpleThread] No worktreePath provided, looking for 'main' worktree");
      const mainWorktree = settings.worktrees.find(w => w.name === 'main');
      if (!mainWorktree) {
        logger.error("[spotlight:createSimpleThread] Main worktree not found:", {
          repoName: repo.name,
          availableWorktrees: settings.worktrees.map(w => ({ name: w.name, path: w.path, id: w.id })),
        });
        throw new Error(`Main worktree not found for repository: ${repo.name}`);
      }
      worktreeId = mainWorktree.id;
      logger.info(`[spotlight:createSimpleThread] Using main worktree: id=${worktreeId}, path=${mainWorktree.path}`);
    }

    const taskId = crypto.randomUUID();
    const threadId = crypto.randomUUID();

    logger.info("[spotlight:createSimpleThread] Generated IDs:", {
      taskId,
      threadId,
      repoId: settings.id,
      worktreeId,
    });

    // Touch worktree to update lastAccessedAt (for MRU sorting)
    logger.info("[spotlight:createSimpleThread] Touching worktree for MRU...");
    worktreeService.touch(repo.name, workingDir).catch((err) => {
      logger.warn("[spotlight:createSimpleThread] Failed to touch worktree (non-fatal):", err);
    });

    // Open control panel immediately (optimistic UI)
    // Window shows prompt while agent starts up
    logger.info("[spotlight:createSimpleThread] ───────────────────────────────────────────────────────────────");
    logger.info("[spotlight:createSimpleThread] Calling openControlPanel...");
    const openControlPanelStart = Date.now();
    try {
      await openControlPanel(threadId, taskId, content);
      logger.info(`[spotlight:createSimpleThread] openControlPanel completed in ${Date.now() - openControlPanelStart}ms`);
    } catch (controlPanelError) {
      logger.error("[spotlight:createSimpleThread] openControlPanel FAILED:", {
        error: controlPanelError,
        errorMessage: controlPanelError instanceof Error ? controlPanelError.message : String(controlPanelError),
        threadId,
        taskId,
      });
      throw controlPanelError;
    }

    // Spawn simple agent (no orchestration)
    // The runner creates thread metadata and thread data on disk
    logger.info("[spotlight:createSimpleThread] ───────────────────────────────────────────────────────────────");
    logger.info("[spotlight:createSimpleThread] Calling spawnSimpleAgent...");
    logger.info("[spotlight:createSimpleThread] spawnSimpleAgent parameters:", {
      repoId: settings.id,
      worktreeId,
      threadId,
      promptLength: content.length,
      sourcePath: workingDir,
    });

    const spawnStart = Date.now();
    try {
      await spawnSimpleAgent({
        repoId: settings.id,     // UUID from settings
        worktreeId,              // UUID from worktree
        threadId,
        prompt: content,
        sourcePath: workingDir,
      });
      logger.info(`[spotlight:createSimpleThread] spawnSimpleAgent completed in ${Date.now() - spawnStart}ms`);
    } catch (spawnError) {
      logger.error("[spotlight:createSimpleThread] spawnSimpleAgent FAILED:", {
        error: spawnError,
        errorMessage: spawnError instanceof Error ? spawnError.message : String(spawnError),
        errorStack: spawnError instanceof Error ? spawnError.stack : undefined,
        threadId,
        workingDir,
        elapsed: `${Date.now() - spawnStart}ms`,
      });
      throw spawnError;
    }

    const totalElapsed = Date.now() - startTime;
    logger.info("═══════════════════════════════════════════════════════════════");
    logger.info(`[spotlight:createSimpleThread] SUCCESS - total time: ${totalElapsed}ms`);
    logger.info("═══════════════════════════════════════════════════════════════");
  }

  /**
   * Opens a folder picker dialog and imports the selected folder as a repository.
   * Returns true if a folder was selected and imported successfully.
   */
  async openRepository(): Promise<boolean> {
    try {
      logger.log("Opening folder picker dialog...");
      const selectedPath = await open({
        directory: true,
        multiple: false,
        title: "Select a repository folder",
      });

      logger.log("Dialog closed, selectedPath:", selectedPath);

      if (!selectedPath) {
        logger.log("No folder selected");
        return false;
      }

      logger.log("Creating repository from folder:", selectedPath);
      await repoService.createFromFolder(selectedPath);
      logger.log("Repository created successfully");
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
};

const INITIAL_TRIGGER_STATE: TriggerStateInfo = {
  isActive: false,
  results: [],
  selectedIndex: 0,
  isLoading: false,
};

export const Spotlight = () => {
  const [state, setState] = useState<SpotlightState>(INITIAL_STATE);
  const [triggerState, setTriggerState] = useState<TriggerStateInfo>(INITIAL_TRIGGER_STATE);
  const inputRef = useRef<TriggerSearchInputRef>(null);
  const controllerRef = useRef<SpotlightController>(new SpotlightController());
  // Track inputExpanded in a ref so async callbacks always have the latest value
  const inputExpandedRef = useRef(false);
  // Track trigger state in a ref so async callbacks can check current trigger status
  const triggerStateRef = useRef<TriggerStateInfo>(INITIAL_TRIGGER_STATE);

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
    setState(INITIAL_STATE);
    resetHistory();
  }, [resetHistory]);

  const activateResult = useCallback(
    async (result: SpotlightResult) => {
      const controller = controllerRef.current;

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
        promptHistoryService.add(result.data.query).catch((error) => {
          logger.error("[Spotlight] Failed to save prompt to history:", error);
        });

        // Handle thread creation error (shared between simple and full flow)
        const handleThreadError = (error: unknown) => {
          logger.error("═══════════════════════════════════════════════════════════════");
          logger.error("[Spotlight] THREAD CREATION ERROR");
          logger.error("═══════════════════════════════════════════════════════════════");
          logger.error("[Spotlight] Error (raw):", error);
          logger.error("[Spotlight] Error type:", typeof error);
          logger.error(
            "[Spotlight] Error constructor:",
            (error as Error)?.constructor?.name
          );
          if (error instanceof Error) {
            logger.error("[Spotlight] Error message:", error.message);
            logger.error("[Spotlight] Error stack:", error.stack);
          }
          if (typeof error === "object" && error !== null) {
            logger.error("[Spotlight] Error keys:", Object.keys(error));
            try {
              logger.error(
                "[Spotlight] Error JSON:",
                JSON.stringify(error, null, 2)
              );
            } catch (jsonError) {
              logger.error("[Spotlight] Could not stringify error:", jsonError);
            }
          }

          // Log context about the failed thread creation attempt
          logger.error("[Spotlight] Context at failure:", {
            selectedRepo: selected?.repoName ?? "NONE",
            selectedWorktreePath: selected?.worktree?.path ?? "NONE",
            promptLength: result.data.query?.length ?? 0,
          });

          const threadError = error as ThreadCreationError;
          const message = formatThreadCreationError(threadError);
          const stack = error instanceof Error ? error.stack : undefined;
          // Show error in dedicated error panel (appears above other panels)
          logger.error("[Spotlight] Thread creation failed, showing error panel:", {
            message,
            stack: stack?.substring(0, 500),
          });
          logger.error("═══════════════════════════════════════════════════════════════");

          invoke("show_error_panel", { message, stack })
            .then(() => {
              logger.info("[Spotlight] show_error_panel invoke completed");
            })
            .catch((err) => {
              logger.error("[Spotlight] show_error_panel invoke failed:", err);
            });
        };

        // Run in selected worktree
        controller
          .createSimpleThread(result.data.query, selectedRepo, selectedWorktree.path)
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
          logger.info("[spotlight] Opening main window...");
          await showMainWindow();
          logger.info("[spotlight] Main window opened, hiding spotlight...");
          await controller.hideSpotlight();
          logger.info("[spotlight] Spotlight hidden");
        } catch (error) {
          logger.error("[spotlight] Failed to open main window:", error);
        }
      } else if (result.type === "action" && result.data.action === "open-threads") {
        try {
          logger.info("[spotlight] Opening threads panel...");
          await controller.hideSpotlight();
          await invoke("show_threads_panel");
          logger.info("[spotlight] Threads panel opened");
        } catch (error) {
          logger.error("[spotlight] Failed to open threads panel:", error);
        }
      } else if (result.type === "action" && result.data.action === "refresh") {
        // Full rebuild: agents + rust, then restart app
        logger.info("[spotlight] === REFRESH START ===");
        logger.info(`[spotlight] Project root: ${__PROJECT_ROOT__}`);

        // Build agents
        try {
          logger.info("[spotlight] [1/4] Building agents...");
          logger.info(`[spotlight] Running: pnpm build:agents in ${__PROJECT_ROOT__}`);
          const agentsCmd = Command.create("pnpm", ["build:agents"], {
            cwd: __PROJECT_ROOT__,
          });
          const agentsOutput = await agentsCmd.execute();
          logger.info(`[spotlight] Agents build exit code: ${agentsOutput.code}`);
          if (agentsOutput.stdout) {
            logger.info(`[spotlight] Agents stdout: ${agentsOutput.stdout}`);
          }
          if (agentsOutput.stderr) {
            logger.info(`[spotlight] Agents stderr: ${agentsOutput.stderr}`);
          }
          if (agentsOutput.code === 0) {
            logger.info("[spotlight] [1/4] Agents rebuilt successfully ✓");
          } else {
            logger.error("[spotlight] [1/4] Agent build FAILED ✗");
          }
        } catch (error) {
          logger.error("[spotlight] [1/4] Agent build exception:", error);
        }

        // Build Rust
        try {
          logger.info("[spotlight] [2/4] Building Rust...");
          logger.info(`[spotlight] Running: cargo build --package mort in ${__PROJECT_ROOT__}/src-tauri`);
          const cargoCmd = Command.create("cargo", ["build", "--package", "mort"], {
            cwd: `${__PROJECT_ROOT__}/src-tauri`,
          });
          const cargoOutput = await cargoCmd.execute();
          logger.info(`[spotlight] Cargo build exit code: ${cargoOutput.code}`);
          if (cargoOutput.stdout) {
            logger.info(`[spotlight] Cargo stdout: ${cargoOutput.stdout}`);
          }
          if (cargoOutput.stderr) {
            logger.info(`[spotlight] Cargo stderr: ${cargoOutput.stderr}`);
          }
          if (cargoOutput.code === 0) {
            logger.info("[spotlight] [2/4] Rust rebuilt successfully ✓");
          } else {
            logger.error("[spotlight] [2/4] Rust build FAILED ✗");
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
          logger.info(`[spotlight] Killing any process on port ${vitePort}...`);
          try {
            // Use lsof to find PIDs on the port
            const lsofCmd = Command.create("lsof", ["-ti", `:${vitePort}`]);
            const lsofResult = await lsofCmd.execute();
            const pids = (lsofResult.stdout || "").trim().split("\n").filter(Boolean);

            if (pids.length > 0) {
              logger.info(`[spotlight] Found processes on port: ${pids.join(", ")}`);
              // Kill each process using node (since we can't directly call kill)
              for (const pid of pids) {
                try {
                  const killCmd = Command.create("node", ["-e", `process.kill(${pid}, 'SIGTERM')`]);
                  await killCmd.execute();
                  logger.info(`[spotlight] Killed process ${pid}`);
                } catch {
                  logger.info(`[spotlight] Could not kill process ${pid}`);
                }
              }
            } else {
              logger.info("[spotlight] No process found on port");
            }
          } catch (killError) {
            // lsof returns exit code 1 if no process found - that's ok
            logger.info("[spotlight] No process to kill on port");
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
          const viteProcess = await viteCmd.spawn();
          logger.info(`[spotlight] Vite spawned with pid: ${viteProcess.pid}`);

          // Wait for Vite to be ready (poll the port)
          logger.info("[spotlight] Waiting for Vite to be ready...");
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

          if (viteReady) {
            logger.info("[spotlight] [3/4] Vite is ready ✓");
          } else {
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
    [triggerState.results, repoWorktrees, selectedWorktreeIndex, resizeSpotlight, inputExpanded]
  );

  // Initialize controller on mount and fetch app suffix
  useEffect(() => {
    controllerRef.current.initialize();

    // Log background colors for debugging border-radius transparency
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("root");
    logger.info("[Spotlight] Background colors:", {
      html: html ? getComputedStyle(html).backgroundColor : "N/A",
      body: body ? getComputedStyle(body).backgroundColor : "N/A",
      root: root ? getComputedStyle(root).backgroundColor : "N/A",
      hasSpotlightContainer: !!html?.querySelector(".spotlight-container"),
    });

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
      logger.info("[Spotlight] No repositories, skipping worktree load");
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
        logger.info(`[Spotlight] Syncing worktrees for ${repo.name}`);
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

    logger.info(`[Spotlight] Loaded ${allRepoWorktrees.length} worktrees across ${repos.length} repos:`,
      allRepoWorktrees.map(rw => `${rw.repoName}/${rw.worktree.name}`));

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
        case "ArrowDown":
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
          // Cycle forward through worktrees when on a thread result
          // Only cycle if cursor is at the very end AND no text is selected
          const currentResult = displayResults[selectedIndex];
          if (currentResult?.type === "thread" && repoWorktrees.length > 1) {
            const cursorPos = inputRef.current?.getCursorPosition() ?? 0;
            const inputLength = query.length;
            // Check if cursor is at the end of the input
            const isAtEnd = cursorPos === inputLength;

            if (isAtEnd) {
              e.preventDefault();
              setState((prev) => ({
                ...prev,
                selectedWorktreeIndex: (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
              }));
            }
            // Otherwise: let default behavior happen (cursor moves right)
          }
          break;
        }
        case "ArrowLeft": {
          // Cycle back through worktrees when on a thread result
          // Only cycle if not on the first worktree
          const currentResultLeft = displayResults[selectedIndex];
          if (currentResultLeft?.type === "thread" && repoWorktrees.length > 1) {
            const notOnFirstWorktree = selectedWorktreeIndex > 0;

            if (notOnFirstWorktree) {
              e.preventDefault();
              setState((prev) => ({
                ...prev,
                selectedWorktreeIndex: prev.selectedWorktreeIndex - 1,
              }));
            }
            // Otherwise (on first worktree): let default behavior happen (cursor moves left)
          }
          break;
        }
        case "Enter":
          // Only intercept if not holding Shift (Shift+Enter = newline in textarea)
          if (!e.shiftKey) {
            e.preventDefault();
            if (displayResults.length > 0 && displayResults[selectedIndex]) {
              await activateResult(displayResults[selectedIndex]);
            }
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
  ]);

  // Handler for panel hidden - moved outside useEffect to avoid hook violations
  const handlePanelHidden = useCallback(async () => {
    const trimmedQuery = query.trim();

    // Save draft if input is non-empty and not already in history
    if (trimmedQuery !== "") {
      const existsInHistory = await promptHistoryService.exists(trimmedQuery);
      if (!existsInHistory) {
        try {
          await promptHistoryService.addDraft(trimmedQuery);
          logger.debug("[Spotlight] Draft saved on focus loss:", { query: trimmedQuery });
        } catch (error) {
          logger.error("[Spotlight] Failed to save draft:", error);
        }
      }
    }

    // Existing reset logic
    resetState();
  }, [query, resetState]);

  // Focus input and refresh worktrees when spotlight is shown, reset state when hidden
  // Uses eventBus for Tauri panel events (global emit, not emit_to for NSPanels)
  useEffect(() => {
    const handleSpotlightShown = () => {
      logger.info("[Spotlight] Spotlight shown - focusing input and refreshing worktrees");
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
    <div data-testid="spotlight" className={spotlightClasses}>
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
      />
    </div>
  );
};

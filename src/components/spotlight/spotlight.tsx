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
  OpenTasksResult,
  RefreshResult,
  SpotlightResult,
} from "./types";
import { PathsInfoSchema } from "@/lib/types/paths";
import { ResultsTray } from "./results-tray";
import { useSpotlightHistory } from "./use-spotlight-history";
import { CalculatorService } from "../../lib/calculator-service";
import { TriggerSearchInput, type TriggerStateInfo } from "../reusable/trigger-search-input";
import type { TriggerSearchInputRef } from "@/lib/triggers/types";
import { repoService, taskService, type Repository, eventBus, type TaskPanelReadyPayload } from "../../entities";
import { worktreeService } from "../../entities/worktrees";
import type { WorktreeState } from "@core/types/repositories";
import { EventName } from "@core/types/events.js";
import { spawnAgentWithOrchestration, spawnSimpleAgent } from "../../lib/agent-service";
import { openTask, openSimpleTask, showMainWindow } from "../../lib/hotkey-service";
import { logger } from "../../lib/logger-client";
import { promptHistoryService } from "../../lib/prompt-history-service";

/** Error types for task creation */
type TaskCreationError =
  | { type: "no_repositories" }
  | { type: "no_versions"; repoName: string }
  | { type: "agent_failed"; message: string };

/** Convert TaskCreationError to user-friendly message */
function formatTaskCreationError(error: TaskCreationError): string {
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

      // Add "Tasks" action if query partially matches
      if (this.partialMatch(query, "Tasks")) {
        const openTasksData: OpenTasksResult = { action: "open-tasks" };
        results.push({
          type: "action",
          data: openTasksData,
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

      // Always add a "create task" option at the end
      results.push({
        type: "task",
        data: { query: query.trim() },
      });
    }

    return results;
  }

  async resizeWindow(
    resultCount: number,
    inputExpanded: boolean
  ): Promise<void> {
    await invoke("resize_spotlight", { resultCount, inputExpanded });
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
   * Gets the repository to use for task creation.
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
   * Creates a new task and starts an agent to work on it.
   *
   * Simplified flow with Node orchestration:
   * 1. Generate taskId and threadId upfront
   * 2. Create draft task on disk (Node reads this)
   * 3. Open window IMMEDIATELY with prompt (optimistic UI)
   * 4. Spawn Node - it will use the explicit worktree path
   * 5. Window reacts to events from Node (thread:created, agent:state, etc.)
   *
   * @param content - The task prompt/description
   * @param repo - The repository to work in (optional, uses default if single repo)
   * @param worktreePath - Explicit worktree path (required for full flow)
   * @throws TaskCreationError on failure
   */
  async createTask(content: string, repo?: Repository, worktreePath?: string): Promise<void> {
    // Determine which repository to use
    const repos = repoService.getAll();

    logger.log(`[spotlight:createTask] Checking repositories in store`);
    logger.log(`[spotlight:createTask] Repository count: ${repos.length}`);
    logger.log(
      `[spotlight:createTask] Repository names:`,
      repos.map((r) => r.name)
    );

    if (repos.length === 0) {
      const error: TaskCreationError = { type: "no_repositories" };
      logger.error(
        "[spotlight:createTask] No repositories in store! Hydration may have failed."
      );
      logger.error("No repositories available. Please add a repository first.");
      throw error;
    }

    // Use provided repo, or default to first if only one exists
    const selectedRepo = repo ?? (repos.length === 1 ? repos[0] : null);
    if (!selectedRepo) {
      // Multiple repos but none selected - caller should handle this
      logger.error("Multiple repositories available. Please select one.");
      throw { type: "no_repositories" } as TaskCreationError;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CREATE DRAFT TASK & OPTIMISTIC UI
    // ═══════════════════════════════════════════════════════════════════════════

    // Generate thread ID upfront so we can open window immediately
    const threadId = crypto.randomUUID();
    logger.log(`spotlight:createTask - Generated thread ID: ${threadId}`);

    // Create draft task IMMEDIATELY before opening window
    // This ensures TaskWorkspace always has a taskId from the start
    // Node orchestration reads this task from disk
    const draftTask = await taskService.createDraft({
      prompt: content,
      repositoryName: selectedRepo.name,
      // Store worktreePath if provided (for explicit worktree management)
      ...(worktreePath && { worktreePath }),
    });

    // Touch worktree to update lastAccessedAt (for MRU sorting)
    if (worktreePath) {
      worktreeService.touch(selectedRepo.name, worktreePath).catch((err) => {
        logger.warn("[spotlight:createTask] Failed to touch worktree:", err);
      });
    }
    logger.log(
      `spotlight:createTask - Created draft task: ${draftTask.id}, slug: ${draftTask.slug}`
    );

    // Broadcast task creation to all windows (cross-window store sync)
    // Use eventBus.emit which goes through the outgoing bridge with correct "app:" prefix
    logger.log(`[Spotlight] Emitting TASK_CREATED event for task: ${draftTask.id}`);
    eventBus.emit(EventName.TASK_CREATED, { taskId: draftTask.id });

    // Set up listener for task-panel-ready event BEFORE opening
    // Uses eventBus instead of direct Tauri listen() to avoid async cleanup races
    const readyPromise = new Promise<void>((resolve) => {
      let resolved = false;

      const handler = (payload: TaskPanelReadyPayload) => {
        logger.log(
          `spotlight:createTask - Received task-panel-ready event:`,
          payload
        );
        if (payload.threadId === threadId && !resolved) {
          logger.log(
            `spotlight:createTask - task-panel-ready MATCHED for: ${threadId}`
          );
          resolved = true;
          clearTimeout(timeout);
          eventBus.off("task-panel-ready", handler);
          resolve();
        }
      };

      const timeout = setTimeout(() => {
        if (!resolved) {
          logger.warn(
            `spotlight:createTask - Timeout waiting for task-panel-ready, spawning anyway`
          );
          resolved = true;
          eventBus.off("task-panel-ready", handler);
          resolve();
        }
      }, 2000);

      eventBus.on("task-panel-ready", handler);
    });

    // Open task panel with BOTH threadId and taskId (optimistic UI)
    try {
      await openTask(threadId, draftTask.id, content, selectedRepo.name);
      logger.log(
        `spotlight:createTask - openTask command completed with taskId: ${draftTask.id}`
      );
    } catch (error) {
      logger.error(`spotlight:createTask - Failed to open task panel:`, error);
      // Continue anyway - we'll still try to do the work
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // SPAWN NODE - It handles worktree allocation and thread creation
    // ═══════════════════════════════════════════════════════════════════════════

    try {
      // Wait for thread window to be ready (with timeout)
      logger.log(`spotlight:createTask - Waiting for readyPromise`);
      await readyPromise;
      logger.log(`spotlight:createTask - readyPromise resolved`);

      // Spawn agent with Node orchestration - Node allocates worktree and creates thread
      logger.log(
        `spotlight:createTask - Spawning agent with orchestration, taskSlug: ${draftTask.slug}`
      );
      await spawnAgentWithOrchestration({
        agentType: "research", // Research agent handles routing and task management
        taskSlug: draftTask.slug, // Node uses slug to find task on disk
        taskId: draftTask.id, // Required for event emissions
        threadId, // Use our pre-generated ID
        prompt: content,
        worktreePath, // Explicit worktree selection (optional)
      });
      logger.log(`spotlight:createTask - Agent spawn completed successfully`);
    } catch (error) {
      logger.error(
        `spotlight:createTask - Caught error spawning agent:`,
        error
      );
      if (error instanceof Error) {
        logger.error(`spotlight:createTask - Error message: ${error.message}`);
        logger.error(`spotlight:createTask - Error stack: ${error.stack}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      const taskError: TaskCreationError = { type: "agent_failed", message };
      logger.error("Failed to start agent:", error);
      throw taskError;
    }
  }

  /**
   * Creates a simple task that runs directly in the source repository or worktree.
   * No worktree allocation, no branch management - just direct execution.
   *
   * Note: Task metadata is created by the simple-runner process, not here.
   * This follows the "Agent Process Architecture" principle from agents.md.
   *
   * @param content - The task prompt/description
   * @param repo - The repository to work in
   * @param worktreePath - Optional worktree path. If provided, agent runs there instead of source repo.
   */
  async createSimpleTask(content: string, repo: Repository, worktreePath?: string): Promise<void> {
    // Determine working directory: worktree path if provided, otherwise source repo
    const workingDir = worktreePath ?? repo.sourcePath;

    if (!workingDir) {
      const error: TaskCreationError = { type: "no_repositories" };
      logger.error(
        `[spotlight:createSimpleTask] Repository ${repo.name} has no sourcePath and no worktree provided`
      );
      throw error;
    }

    const taskId = crypto.randomUUID();
    const threadId = crypto.randomUUID();

    logger.info(`[spotlight:createSimpleTask] Creating simple task: ${taskId}, workingDir: ${workingDir}`);

    // Open simple task window immediately (optimistic UI)
    // Window shows prompt while agent starts up
    logger.info(`[spotlight:createSimpleTask] About to call openSimpleTask...`);
    await openSimpleTask(threadId, taskId, content);
    logger.info(`[spotlight:createSimpleTask] openSimpleTask returned successfully`);

    // Spawn simple agent (no orchestration)
    // The runner creates task metadata and thread data on disk
    logger.info(`[spotlight:createSimpleTask] About to call spawnSimpleAgent...`);
    await spawnSimpleAgent({
      taskId,
      threadId,
      prompt: content,
      sourcePath: workingDir,
    });
    logger.info(`[spotlight:createSimpleTask] spawnSimpleAgent returned successfully`);
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
  availableWorktrees: WorktreeState[];
}

const INITIAL_STATE: SpotlightState = {
  query: "",
  results: [],
  historyResults: [],
  selectedIndex: 0,
  inputExpanded: false,
  appSuffix: "",
  selectedWorktreeIndex: 0,
  availableWorktrees: [],
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

  const { query, results, selectedIndex, inputExpanded, appSuffix, selectedWorktreeIndex, availableWorktrees } = state;

  // Keep ref in sync with state
  inputExpandedRef.current = inputExpanded;

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

        // Run search to populate results (including "create task" option)
        // Use inputExpandedRef.current to get latest expansion state (avoids stale closure)
        if (newQuery.trim()) {
          const newResults = await controller.search(newQuery);
          await controller.resizeWindow(newResults.length, inputExpandedRef.current);
          setState((prev) => ({
            ...prev,
            results: newResults,
            selectedIndex: 0,
          }));
        } else {
          setState((prev) => ({ ...prev, results: [] }));
          await controller.resizeWindow(0, inputExpandedRef.current);
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

  const resetState = useCallback(() => {
    setState(INITIAL_STATE);
    resetHistory();
  }, [resetHistory]);

  const activateResult = useCallback(
    async (result: SpotlightResult, options?: { useFullFlow?: boolean }) => {
      const controller = controllerRef.current;
      const useFullFlow = options?.useFullFlow ?? false;

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
        await controller.resizeWindow(0, inputExpanded);
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
      } else if (result.type === "task") {
        // Get default repo (single repo case) or use first repo for now
        // TODO: Add repo selection UI for multi-repo scenarios
        const repos = controller.getRepositories();
        const defaultRepo = controller.getDefaultRepository();

        if (repos.length === 0) {
          logger.error(
            "No repositories available. Please add a repository first."
          );
          return;
        }

        // Use default repo if available, otherwise use first repo
        // Future: Show repo selector when multiple repos exist
        const selectedRepo = defaultRepo ?? repos[0];

        // Save prompt to history (fire and forget)
        promptHistoryService.add(result.data.query).catch((error) => {
          logger.error("[Spotlight] Failed to save prompt to history:", error);
        });

        // Handle task creation error (shared between simple and full flow)
        const handleTaskError = (error: unknown) => {
          logger.error("[Spotlight] Task creation error (raw):", error);
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
            logger.error(
              "[Spotlight] Error JSON:",
              JSON.stringify(error, null, 2)
            );
          }

          const taskError = error as TaskCreationError;
          const message = formatTaskCreationError(taskError);
          const stack = error instanceof Error ? error.stack : undefined;
          // Show error in dedicated error panel (appears above other panels)
          logger.info("[Spotlight] Task creation failed, showing error panel:", {
            message,
            stack,
          });
          invoke("show_error_panel", { message, stack })
            .then(() => {
              logger.info("[Spotlight] show_error_panel invoke completed");
            })
            .catch((err) => {
              logger.error("[Spotlight] show_error_panel invoke failed:", err);
            });
        };

        if (useFullFlow) {
          // Command+Enter: Full worktree flow with explicit worktree selection
          const selectedWorktree = availableWorktrees[selectedWorktreeIndex];
          if (!selectedWorktree && availableWorktrees.length > 0) {
            // Shouldn't happen, but fallback to first worktree
            logger.warn("[Spotlight] No worktree selected, using first available");
          }
          controller
            .createTask(result.data.query, selectedRepo, selectedWorktree?.path)
            .catch(handleTaskError);
        } else {
          // Enter: Simple flow - runs in selected worktree (if any) or source repo
          const selectedWorktree = availableWorktrees[selectedWorktreeIndex];
          controller
            .createSimpleTask(result.data.query, selectedRepo, selectedWorktree?.path)
            .catch(handleTaskError);
        }

        // Hide spotlight immediately - task window is already showing
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
      } else if (result.type === "action" && result.data.action === "open-tasks") {
        try {
          logger.info("[spotlight] Opening tasks panel...");
          await controller.hideSpotlight();
          await invoke("show_tasks_panel");
          logger.info("[spotlight] Tasks panel opened");
        } catch (error) {
          logger.error("[spotlight] Failed to open tasks panel:", error);
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
    [triggerState.results, availableWorktrees, selectedWorktreeIndex]
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

  // Load worktrees from cache, optionally syncing from git first
  const loadWorktrees = useCallback(async (syncFirst = false) => {
    const controller = controllerRef.current;
    const repo = controller.getDefaultRepository();
    if (!repo) {
      logger.info("[Spotlight] No default repository, skipping worktree load");
      return;
    }

    try {
      logger.info(`[Spotlight] Loading worktrees for ${repo.name} (sync=${syncFirst})`);
      // If syncing, refresh worktrees from git before loading
      const worktrees = syncFirst
        ? await worktreeService.sync(repo.name)
        : await worktreeService.list(repo.name);
      logger.info(`[Spotlight] Loaded ${worktrees.length} worktrees:`, worktrees.map(w => w.name));
      setState((prev) => ({
        ...prev,
        availableWorktrees: worktrees,
        selectedWorktreeIndex: 0, // Reset to first (most recent)
      }));
    } catch (err) {
      logger.error("[Spotlight] Failed to load worktrees:", err);
      setState((prev) => ({
        ...prev,
        availableWorktrees: [],
        selectedWorktreeIndex: 0,
      }));
    }
  }, []);

  // Load available worktrees when spotlight mounts
  useEffect(() => {
    loadWorktrees(false);
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
          // Cycle forward through worktrees when on a task result
          const currentResult = displayResults[selectedIndex];
          if (currentResult?.type === "task" && availableWorktrees.length > 0) {
            e.preventDefault();
            setState((prev) => ({
              ...prev,
              selectedWorktreeIndex: (prev.selectedWorktreeIndex + 1) % prev.availableWorktrees.length,
            }));
          }
          break;
        }
        case "Enter":
          // Only intercept if not holding Shift (Shift+Enter = newline in textarea)
          if (!e.shiftKey) {
            e.preventDefault();
            if (displayResults.length > 0 && displayResults[selectedIndex]) {
              // Command+Enter triggers full task flow (worktrees + branches)
              // Enter triggers simple flow (direct execution in source repo)
              const useFullFlow = e.metaKey;
              await activateResult(displayResults[selectedIndex], { useFullFlow });
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
    availableWorktrees,
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

  // Focus input when panel gains focus, reset state when panel is hidden
  // Uses eventBus instead of direct Tauri APIs to avoid async cleanup races
  useEffect(() => {
    const handleFocusChanged = ({ focused }: { focused: boolean }) => {
      if (focused) {
        inputRef.current?.focus();
        // Asynchronously refresh worktrees from git when spotlight opens
        // This runs in the background so it doesn't block the UI
        loadWorktrees(true);
      }
    };

    eventBus.on("window:focus-changed", handleFocusChanged);
    eventBus.on("panel-hidden", handlePanelHidden);

    return () => {
      eventBus.off("window:focus-changed", handleFocusChanged);
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
        // Clear results and resize for empty query
        setState((prev) => ({ ...prev, results: [] }));
        await controller.resizeWindow(0, inputExpandedRef.current);
        return;
      }

      // Perform async operations after input state is updated
      const newResults = await controller.search(displayQuery);
      await controller.resizeWindow(newResults.length, inputExpandedRef.current);

      // Update results separately
      setState((prev) => ({
        ...prev,
        results: newResults,
        selectedIndex: 0,
      }));
    },
    []
  );

  // Resize window when trigger results change
  useEffect(() => {
    const controller = controllerRef.current;
    if (triggerState.isActive) {
      controller.resizeWindow(triggerState.results.length, inputExpanded);
    }
  }, [triggerState.isActive, triggerState.results.length, inputExpanded]);

  const handleExpandedChange = useCallback(
    async (expanded: boolean) => {
      const controller = controllerRef.current;
      setState((prev) => ({ ...prev, inputExpanded: expanded }));
      // Use displayResults for proper count
      await controller.resizeWindow(displayResults.length, expanded);
    },
    [displayResults.length]
  );

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
            rootPath: controllerRef.current.getDefaultRepository()?.sourcePath ?? null,
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
          availableWorktrees,
          selectedWorktreeIndex,
        }}
      />
    </div>
  );
};

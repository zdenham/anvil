import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { nanoid } from "nanoid";

/**
 * Absolute path to this runner script.
 * Used by sub-agents to spawn recursive sub-agents without needing env vars.
 */
export const runnerPath = fileURLToPath(import.meta.url);
import { SimpleRunnerStrategy } from "./runners/simple-runner-strategy.js";
import {
  runAgentLoop,
  setupSignalHandlers,
  emitLog,
  emitEvent,
  propagateModeToChildren,
  type PriorState,
} from "./runners/shared.js";
import type { OrchestrationContext } from "./runners/types.js";
import { getAgentConfig } from "./agent-types/index.js";
import { cancelled, setHubClient, appendUserMessage, emitState } from "./output.js";
import { DiagnosticLoggingConfigSchema } from "@core/types/diagnostic-logging.js";
import { logger } from "./lib/logger.js";
import { HubClient, type TauriToAgentMessage } from "./lib/hub/index.js";
import { SocketMessageStream } from "./lib/hub/message-stream.js";
import { PermissionEvaluator, GLOBAL_OVERRIDES } from "./lib/permission-evaluator.js";
import { PermissionGate } from "./lib/permission-gate.js";
import { QuestionGate } from "./lib/question-gate.js";
import { BUILTIN_MODES } from "@core/types/permissions.js";
import type { PermissionModeId } from "@core/types/permissions.js";

/**
 * Load prior state from a history file (state.json).
 * Returns both messages (for UI history) and sessionId (for SDK resume).
 */
function loadPriorState(historyFile: string | undefined): PriorState {
  const emptyState: PriorState = { messages: [] };

  logger.info(`[runner] Loading prior state from ${historyFile ?? "none"}`);

  if (!historyFile) {
    return emptyState;
  }

  if (!existsSync(historyFile)) {
    logger.warn(`[runner] History file does not exist at path: ${historyFile}`);
    return emptyState;
  }

  try {
    const content = readFileSync(historyFile, "utf-8");
    const state = JSON.parse(content);

    const result: PriorState = { messages: [] };

    // Load messages for UI history display, backfilling missing IDs
    if (Array.isArray(state.messages)) {
      result.messages = state.messages.map((msg: Record<string, unknown>) => ({
        ...msg,
        id: typeof msg.id === "string" ? msg.id : nanoid(),
      }));
    } else {
      logger.warn(`[runner] state.messages is not an array: ${typeof state.messages}`);
    }

    // Load sessionId for SDK resume (enables conversation continuity)
    if (typeof state.sessionId === "string") {
      result.sessionId = state.sessionId;
    }

    // Load toolStates for UI rendering (so prior tool calls show as complete, not spinning)
    if (state.toolStates && typeof state.toolStates === "object") {
      result.toolStates = state.toolStates;
    }

    // Load token usage so context meter stays visible during resume
    if (state.lastCallUsage && typeof state.lastCallUsage === "object") {
      result.lastCallUsage = state.lastCallUsage;
    }
    if (state.cumulativeUsage && typeof state.cumulativeUsage === "object") {
      result.cumulativeUsage = state.cumulativeUsage;
    }

    // Load prior file changes so diffs accumulate across turns
    if (Array.isArray(state.fileChanges)) {
      result.fileChanges = state.fileChanges;
    }

    logger.info("[runner] Loaded prior state", {
      messageCount: result.messages.length,
      toolStateCount: result.toolStates ? Object.keys(result.toolStates).length : 0,
      hasFileChanges: !!result.fileChanges,
      hasSessionId: !!result.sessionId,
    });

    return result;
  } catch (err) {
    logger.warn(`[runner] Failed to load history file: ${err}`);
    return emptyState;
  }
}

/**
 * Set up `mort` command by creating a wrapper script and adding it to PATH.
 * This allows agents to use `mort tasks get ...` directly.
 */
function setupMortCommand(): void {
  // This file is at agents/dist/runner.js after build
  // CLI is at agents/dist/cli/mort.js
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const cliPath = join(currentDir, "cli", "mort.js");
  const binDir = join(currentDir, "bin");
  const wrapperPath = join(binDir, "mort");

  // Create bin directory if needed
  mkdirSync(binDir, { recursive: true });

  // Create a shell script wrapper named just "mort"
  const wrapperContent = `#!/bin/sh
exec node "${cliPath}" "$@"
`;

  // Write the wrapper script
  writeFileSync(wrapperPath, wrapperContent, { mode: 0o755 });

  // Add bin directory to PATH so `mort` command works
  process.env.PATH = `${binDir}:${process.env.PATH}`;
}

/**
 * Parse early CLI args needed for HubClient initialization.
 * Returns threadId and optional parentId.
 */
function parseEarlyArgs(args: string[]): { threadId?: string; parentId?: string } {
  const result: { threadId?: string; parentId?: string } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--thread-id" && args[i + 1]) {
      result.threadId = args[++i];
    } else if (args[i] === "--parent-id" && args[i + 1]) {
      result.parentId = args[++i];
    }
  }

  return result;
}

async function main(): Promise<void> {
  // Set up `mort` command before anything else
  setupMortCommand();

  // Only one strategy exists: SimpleRunnerStrategy
  const strategy = new SimpleRunnerStrategy();
  let context: OrchestrationContext | undefined;
  let hub: HubClient | null = null;

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  // Create message stream for queued messages (will be passed to runAgentLoop)
  const messageStream = new SocketMessageStream();
  // Set event emitter for ack events (emits via socket or stdout fallback)
  messageStream.setEventEmitter(emitEvent);
  // Set callback to append user messages to state (SDK doesn't return injected messages)
  messageStream.setAppendUserMessage(appendUserMessage);

  // Create permission gate for async approval flow
  const permissionGate = new PermissionGate();

  // Create question gate for AskUserQuestion async answer flow
  const questionGate = new QuestionGate();

  // Permission evaluator — created after context is available, but referenced in handler
  let permissionEvaluator: PermissionEvaluator | undefined;

  // Parse early args to get threadId for hub client initialization
  const args = process.argv.slice(2);
  const { threadId, parentId } = parseEarlyArgs(args);

  // Track shutdown state to avoid recursive errors
  let isShuttingDown = false;

  // Initialize hub client if we have a threadId
  if (threadId) {
    hub = new HubClient(threadId, parentId);

    // Handle incoming messages from Tauri
    hub.on("message", (msg: TauriToAgentMessage) => {
      switch (msg.type) {
        case "permission_response": {
          const { requestId, decision, reason } = msg.payload;
          logger.info(`[runner] Received permission response: ${requestId} -> ${decision}`);
          permissionGate.resolve(requestId, decision === "approve", reason);
          break;
        }
        case "question_response": {
          const { requestId, answers } = msg.payload;
          logger.info(`[runner] Received question response: ${requestId}`);
          questionGate.resolve(requestId, answers);
          break;
        }
        case "question_cancelled": {
          const { requestId } = msg.payload;
          logger.info(`[runner] Received question cancelled: ${requestId}`);
          questionGate.cancel(requestId);
          break;
        }
        case "permission_mode_changed": {
          const newModeId = msg.payload.modeId as PermissionModeId;
          const newMode = BUILTIN_MODES[newModeId];
          if (newMode && permissionEvaluator) {
            permissionEvaluator.setMode(newMode);
            logger.info(`[runner] Permission mode changed to: ${newMode.name}`);
            // Propagate to running child threads
            const mortDir = process.env.MORT_DATA_DIR;
            if (context && mortDir) {
              propagateModeToChildren(context.threadId, newModeId, mortDir);
            }
            // Notify agent via streamInput
            const planContext = newMode.id === "plan"
              ? " Write plans to plans/. Do not call ExitPlanMode or implement code."
              : "";
            messageStream.push(
              crypto.randomUUID(),
              `[System] <system-reminder>Permission mode changed to "${newMode.name}". ${newMode.description}.${planContext}</system-reminder>`,
            );
          } else {
            logger.warn(`[runner] Unknown permission mode: ${newModeId}`);
          }
          break;
        }
        case "queued_message": {
          // Inject queued message into the SDK via message stream
          // Use the frontend's ID to preserve dedup across the chain
          const { id, content } = msg.payload;
          logger.info(`[runner] Received queued message, injecting into stream: ${id}`);
          messageStream.push(id as import("crypto").UUID, content);
          break;
        }
        case "diagnostic_config": {
          // Runtime diagnostic config update (e.g. auto-enable on staleness)
          const parseResult = DiagnosticLoggingConfigSchema.safeParse(msg.payload);
          if (parseResult.success && hub) {
            hub.updateDiagnosticConfig(parseResult.data);
            logger.info("[runner] Diagnostic config updated at runtime");
          }
          break;
        }
        case "cancel":
          logger.info("[runner] Received cancel message from Tauri, aborting...");
          abortController.abort();
          break;
        default:
          logger.warn(`[runner] Unhandled message type: ${(msg as { type: string }).type}`);
          break;
      }
    });

    hub.on("disconnect", () => {
      if (isShuttingDown) return;
      // Agent keeps running — state written to disk only until reconnected
      logger.warn("[runner] Hub disconnected — agent will continue, state written to disk only");
    });

    hub.on("reconnected", () => {
      logger.info("[runner] Hub reconnected — resuming live state emission");
      // Emit current state immediately so UI catches up
      emitState().catch(() => {
        // Best-effort: state will be emitted on next change anyway
      });
    });

    hub.on("error", (err) => {
      // Only log if not already shutting down (avoids recursive EPIPE)
      if (!isShuttingDown) {
        logger.error(`[runner] AgentHub error: ${err}`);
      }
    });

    // Connect to hub
    try {
      await hub.connect();
      logger.info("[runner] Connected to AgentHub");

      // Start heartbeat for root-level agents only (sub-agents rely on parent)
      if (!parentId) {
        hub.startHeartbeat();
      }

      // Set hub client for output module
      setHubClient(hub);
    } catch (err) {
      logger.error(`[runner] Failed to connect to AgentHub: ${err}`);
      // Continue without hub - fall back to stdout-only mode
      hub = null;
    }
  }

  // Cleanup function that disconnects hub and logs session summary
  function cleanup() {
    if (hub) {
      logger.info(hub.sessionSummary);
      hub.disconnect();
      logger.info("[runner] Disconnected from AgentHub");
    }
  }

  // Register cleanup handlers
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });

  process.on("exit", cleanup);

  try {
    // Log the strategy
    emitLog(
      "INFO",
      `Starting agent with strategy: ${strategy.constructor.name}`
    );

    // Parse args using strategy-specific logic
    const config = strategy.parseArgs(args);

    // Set MORT_DATA_DIR env var so the `mort` CLI can find the correct data directory
    // This is important because the CLI is invoked as a subprocess by agents
    process.env.MORT_DATA_DIR = config.mortDir;

    // Get agent configuration (model, tools, prompts) - hardcoded to "simple"
    const agentConfig = getAgentConfig("simple");

    // Override appended prompt if provided via CLI (e.g., merge agent with dynamic context)
    if (config.appendedPrompt) {
      agentConfig.appendedPrompt = config.appendedPrompt;
    }

    // Set up orchestration context (working directory, thread metadata, etc.)
    context = await strategy.setup(config);

    // Construct permission evaluator now that we have the working directory
    const modeId = context.permissionModeId ?? "implement";
    permissionEvaluator = new PermissionEvaluator({
      mode: BUILTIN_MODES[modeId],
      overrides: GLOBAL_OVERRIDES,
      workingDirectory: context.workingDir,
    });
    logger.info(`[runner] Permission evaluator initialized with mode: ${modeId}`);

    // Set up signal handlers with abort support
    // Pass abortController so signals trigger abort instead of immediate exit
    setupSignalHandlers(async () => {
      if (context && strategy) {
        await strategy.cleanup(context, "cancelled");
      }
    }, abortController);

    // Load prior state from history file if resuming
    // Contains both messages (for UI) and sessionId (for SDK resume)
    const priorState = loadPriorState(config.historyFile);

    // Initialize network proxy if debug flag is set
    if (process.env.MORT_NETWORK_DEBUG === "1") {
      logger.info("[runner] Network debug enabled, starting proxy interceptor");
      const { CertManager } = await import("./lib/proxy/cert-manager.js");
      const { ProxyServer } = await import("./lib/proxy/proxy-server.js");

      const certManager = new CertManager(config.mortDir);
      await certManager.ensureCA();

      const proxy = new ProxyServer(certManager, (event) => {
        const { type: networkType, ...rest } = event;
        logger.debug(`[proxy] Emitting ${networkType} for ${(rest as Record<string, unknown>).requestId ?? "?"}`);
        hub?.send({ type: "network", networkType, ...rest });
      });

      const { port } = await proxy.start();

      // Inject into process.env so SDK subprocess inherits
      process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`;
      process.env.HTTP_PROXY = `http://127.0.0.1:${port}`;
      process.env.NODE_EXTRA_CA_CERTS = certManager.certPath;

      // Clean up on abort
      abortController.signal.addEventListener("abort", () => proxy.stop());
      logger.info(`[runner] Network proxy active on port ${port}`);
    }

    // Run the common agent loop with abort controller, message stream, and permission system
    await runAgentLoop(config, context, agentConfig, priorState, {
      abortController,
      messageStream,
      permissionEvaluator,
      permissionGate,
      questionGate,
    });

    // Safety timeout: if cleanup or process.exit hangs, force exit.
    // unref() ensures this timer doesn't prevent natural Node.js exit.
    const exitGuard = setTimeout(() => {
      logger.warn("[runner] Post-loop cleanup timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    exitGuard.unref();

    // Clean up on successful completion
    await strategy.cleanup(context, "completed");
    cleanup();

    logger.info("[runner] Agent completed successfully");
    process.exit(0);
  } catch (error) {
    // Check if this is an abort/cancellation
    const isAbort = error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"));

    logger.info(`[runner] Caught error in main: name=${error instanceof Error ? error.name : "unknown"}, message=${error instanceof Error ? error.message : String(error)}, isAbort=${isAbort}`);

    if (isAbort) {
      // Graceful cancellation
      logger.info("[runner] Agent cancelled - handling AbortError");
      await cancelled();
      logger.info("[runner] Called cancelled(), now running cleanup...");

      // Attempt cleanup
      if (strategy && context) {
        try {
          logger.info("[runner] Running strategy.cleanup(cancelled)...");
          await strategy.cleanup(context, "cancelled");
          logger.info("[runner] strategy.cleanup completed");
        } catch (cleanupError) {
          emitLog("WARN", `Cleanup after cancel: ${cleanupError}`);
        }
      }

      cleanup();
      logger.info("[runner] Exiting with code 130");
      process.exit(130); // Standard cancelled exit code (128 + SIGINT)
    }

    // Regular error handling
    emitLog(
      "ERROR",
      `Agent failed: ${error instanceof Error ? error.message : String(error)}`
    );

    // Attempt cleanup even on error
    if (strategy && context) {
      try {
        await strategy.cleanup(
          context,
          "error",
          error instanceof Error ? error.message : String(error)
        );
      } catch (cleanupError) {
        emitLog(
          "ERROR",
          `Cleanup failed: ${
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          }`
        );
      }
    }

    cleanup();
    process.exit(1);
  }
}

main();

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { TaskRunnerStrategy } from "./runners/task-runner-strategy.js";
import { SimpleRunnerStrategy } from "./runners/simple-runner-strategy.js";
import {
  runAgentLoop,
  setupSignalHandlers,
  emitLog,
  type PriorState,
} from "./runners/shared.js";
import type { RunnerStrategy, OrchestrationContext } from "./runners/types.js";
import { getAgentConfig } from "./agent-types/index.js";
import { cancelled } from "./output.js";
import { logger } from "./lib/logger.js";

/**
 * Load prior state from a history file (state.json).
 * Returns both messages (for UI history) and sessionId (for SDK resume).
 */
function loadPriorState(historyFile: string | undefined): PriorState {
  const emptyState: PriorState = { messages: [] };

  // Always log the history file path for debugging
  logger.info(`[runner] loadPriorState called with historyFile=${historyFile ?? "undefined"}`);

  if (!historyFile) {
    logger.info("[runner] No history file provided (first run)");
    return emptyState;
  }

  const fileExists = existsSync(historyFile);
  logger.info(`[runner] History file exists: ${fileExists}, path: ${historyFile}`);

  if (!fileExists) {
    logger.warn(`[runner] History file does not exist at path: ${historyFile}`);
    return emptyState;
  }

  try {
    const content = readFileSync(historyFile, "utf-8");
    const state = JSON.parse(content);

    const result: PriorState = { messages: [] };

    // Load messages for UI history display
    if (Array.isArray(state.messages)) {
      result.messages = state.messages;
      logger.info(`[runner] Loaded ${state.messages.length} prior messages from history`);
    } else {
      logger.warn(`[runner] state.messages is not an array: ${typeof state.messages}`);
    }

    // Load sessionId for SDK resume (enables conversation continuity)
    if (typeof state.sessionId === "string") {
      result.sessionId = state.sessionId;
      logger.info(`[runner] Loaded prior sessionId: ${state.sessionId}`);
    } else {
      logger.info("[runner] No prior sessionId found (will start new SDK session)");
    }

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
 * Parse --agent flag to determine which strategy to use.
 * @throws Error if --agent flag is missing or agent type is unknown
 */
function getStrategy(args: string[]): RunnerStrategy {
  const agentIndex = args.indexOf("--agent");
  if (agentIndex === -1 || !args[agentIndex + 1]) {
    throw new Error("Missing required --agent flag");
  }

  const agentType = args[agentIndex + 1];

  switch (agentType) {
    case "simple":
      return new SimpleRunnerStrategy();
    case "research":
    case "execution":
    case "merge":
      return new TaskRunnerStrategy();
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}

async function main(): Promise<void> {
  // Set up `mort` command before anything else
  setupMortCommand();

  let strategy: RunnerStrategy | undefined;
  let context: OrchestrationContext | undefined;

  // Create abort controller for cancellation support
  const abortController = new AbortController();
  logger.info(`[runner] Created AbortController, pid=${process.pid}`);

  try {
    const args = process.argv.slice(2);
    strategy = getStrategy(args);

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

    // Get agent configuration (model, tools, prompts)
    const agentConfig = getAgentConfig(config.agent);

    // Override appended prompt if provided via CLI (e.g., merge agent with dynamic context)
    if (config.appendedPrompt) {
      agentConfig.appendedPrompt = config.appendedPrompt;
    }

    // Set up orchestration context (working directory, task metadata, etc.)
    context = await strategy.setup(config);

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

    // Run the common agent loop with abort controller
    // Enable stdin queue for simple agents to support queued messages
    const enableStdinQueue = config.agent === "simple";
    await runAgentLoop(config, context, agentConfig, priorState, {
      abortController,
      enableStdinQueue,
    });

    // Clean up on successful completion
    await strategy.cleanup(context, "completed");

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

    process.exit(1);
  }
}

main();

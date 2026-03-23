import {
  query,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type PostToolUseFailureHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { StoredMessage } from "@core/types/events.js";
import { relative, isAbsolute, join, resolve } from "path";
import { readFileSync, writeFileSync, readdirSync, realpathSync, mkdirSync, existsSync } from "fs";
import crypto from "crypto";
import { parsePhases } from "../lib/phase-parser.js";
import {
  shouldFirePhaseReminder,
  shouldIncrementFileModCount,
  PHASE_REMINDER_TEXT,
} from "./phase-reminder.js";
import type { PhaseInfo } from "@core/types/plans.js";
import type { RunnerConfig, OrchestrationContext } from "./types.js";
import type { AgentConfig } from "../agent-types/index.js";
import {
  initState,
  markToolComplete,
  updateFileChange,
  getHubClient,
  moveMessageToEnd,
} from "../output.js";
import { NodePersistence } from "../lib/persistence-node.js";
import { EventName } from "@core/types/events.js";
import type { ToolExecutionState } from "@core/types/events.js";
import { MessageHandler } from "./message-handler.js";
import { QueuedAckManager } from "../lib/hub/queued-ack-manager.js";
import { StreamAccumulator } from "../lib/stream-accumulator.js";
import { DrainManager } from "../lib/drain-manager.js";
import { DrainEventName } from "@core/types/drain-events.js";
import type { ThreadWriter } from "../services/thread-writer.js";
import {
  buildEnvironmentContext,
  buildGitContext,
  formatSystemPromptContext,
} from "../context.js";
import { logger } from "../lib/logger.js";
import { isMockModeEnabled, mockQuery } from "../testing/mock-query.js";
import { generateThreadName } from "../services/thread-naming-service.js";
import type { SocketMessageStream } from "../lib/hub/message-stream.js";
import type { PermissionEvaluator } from "../lib/permission-evaluator.js";
import type { PermissionGate } from "../lib/permission-gate.js";
import type { PermissionModeId } from "@core/types/permissions.js";
import { createCommentResolutionHook } from "../hooks/comment-resolution-hook.js";
import { createReplHook } from "../hooks/repl-hook.js";
import { createSafeGitHook } from "../hooks/safe-git-hook.js";
import { DISALLOWED_TOOLS } from "@core/lib/hooks/tool-deny.js";
import { extractFileChange } from "@core/lib/hooks/file-changes.js";
import { rollUpCostToParent } from "../lib/mort-repl/budget.js";

// ============================================================================
// Sub-agent Tracking
// ============================================================================

/**
 * In-memory mapping from full tool_use_id to child thread ID.
 * The Task tool's tool_use_id (e.g., "toolu_01ABC...") is used for:
 * - MESSAGE ROUTING: SDK messages use full tool_use_id as parent_tool_use_id
 * - FRONTEND LOOKUP: TaskToolBlock uses tool_use_id to find child thread
 *
 * This is the ONLY map needed - we eliminated agentIdToChildThreadId,
 * agentIdToToolUseId, and pendingTaskQueue by moving thread creation
 * to PreToolUse:Task (which has the full tool_use_id available).
 *
 * Cleared on process exit.
 */
const toolUseIdToChildThreadId = new Map<string, string>();

/**
 * Get the child thread ID for a given parent_tool_use_id from SDK messages.
 * Used by MessageHandler to route sub-agent messages.
 *
 * SDK messages use the full tool_use_id format (e.g., "toolu_01ABC...") as parent_tool_use_id.
 * This is set in PreToolUse:Task when the thread is created.
 */
export function getChildThreadId(parentToolUseId: string): string | undefined {
  return toolUseIdToChildThreadId.get(parentToolUseId);
}

/**
 * Get the child thread ID for a given full tool_use_id.
 * Used by frontend (TaskToolBlock) to find child thread for SubAgentReferenceBlock rendering.
 */
export function getChildThreadIdByToolUseId(toolUseId: string): string | undefined {
  return toolUseIdToChildThreadId.get(toolUseId);
}

/**
 * Emit log message to stdout as JSON line.
 * Used by unified runner for startup/error logging.
 */
export function emitLog(
  level: "DEBUG" | "INFO" | "WARN" | "ERROR",
  message: string
): void {
  console.log(JSON.stringify({ type: "log", level, message }));
}

/**
 * Classify an error for drain analytics.
 * Maps error messages to structured categories.
 */
function classifyError(
  error: unknown,
): "permission_denied" | "execution_error" | "timeout" | "unknown" {
  const msg = String(error).toLowerCase();
  if (msg.includes("permission") || msg.includes("denied")) return "permission_denied";
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (msg.includes("error")) return "execution_error";
  return "unknown";
}

/**
 * Emit event via socket.
 * Used for lifecycle events like thread:created.
 * If hub is not connected, logs a warning and skips (events require socket connection).
 */
export function emitEvent(
  name: string,
  payload: Record<string, unknown>,
  source?: string,
): void {
  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendEvent(name, payload, source);
  } else {
    logger.warn(`[shared] Hub not connected, skipping event: ${name}`);
  }
}

/**
 * Propagate a permission mode change to all running child threads.
 * Discovers children by scanning thread metadata on disk, sends mode change
 * via hub relay, and persists the updated mode to each child's metadata.
 */
export function propagateModeToChildren(
  parentThreadId: string,
  modeId: PermissionModeId,
  mortDir: string,
): void {
  const hub = getHubClient();
  const threadsDir = join(mortDir, "threads");

  let entries: string[];
  try {
    entries = readdirSync(threadsDir);
  } catch {
    return; // No threads directory — nothing to propagate
  }

  for (const entry of entries) {
    const metadataPath = join(threadsDir, entry, "metadata.json");
    try {
      if (!existsSync(metadataPath)) continue;
      const raw = readFileSync(metadataPath, "utf-8");
      const metadata = JSON.parse(raw);

      if (metadata.parentThreadId !== parentThreadId) continue;
      if (metadata.status !== "running") continue;

      // Send mode change via hub relay to the child agent
      if (hub?.isConnected) {
        hub.relay(metadata.id, {
          type: "permission_mode_changed",
          payload: { modeId },
        });
        logger.info(`[propagateModeToChildren] Relayed mode=${modeId} to child=${metadata.id}`);
      }

      // Persist to disk so mode survives restarts
      metadata.permissionMode = modeId;
      metadata.updatedAt = Date.now();
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    } catch {
      // Child thread may have been cleaned up — skip
    }
  }
}

/**
 * Build system prompt for agent by interpolating template variables
 * and appending runtime context (environment, git status, thread info).
 */
export function buildSystemPrompt(
  config: AgentConfig,
  context: {
    repoId?: string;
    worktreeId?: string;
    threadId?: string;
    slug?: string;
    branchName?: string | null;
    cwd: string;
    mortDir: string;
    runnerPath: string;
    parentThreadId?: string;
    permissionModeId?: string;
  }
): string {
  // Interpolate template variables
  let prompt = config.appendedPrompt;
  prompt = prompt.replace(/\{\{repoId\}\}/g, context.repoId ?? "none");
  prompt = prompt.replace(/\{\{worktreeId\}\}/g, context.worktreeId ?? "none");
  prompt = prompt.replace(/\{\{slug\}\}/g, context.slug ?? "none");
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
  prompt = prompt.replace(/\{\{mortDir\}\}/g, context.mortDir);
  prompt = prompt.replace(/\{\{threadId\}\}/g, context.threadId ?? "none");
  prompt = prompt.replace(/\{\{runnerPath\}\}/g, context.runnerPath);
  prompt = prompt.replace(/\{\{cwd\}\}/g, context.cwd);

  // Build runtime context
  const envContext = buildEnvironmentContext(context.cwd);
  const gitContext = buildGitContext(context.cwd);
  const threadContext = {
    repoId: context.repoId ?? null,
    parentThreadId: context.parentThreadId,
    permissionModeId: context.permissionModeId,
  };
  const runtimeContext = formatSystemPromptContext(
    envContext,
    gitContext,
    threadContext
  );

  return `${prompt}\n\n${runtimeContext}`;
}

/**
 * Set up signal handlers for graceful shutdown with optional abort support.
 * When abortController is provided, signals trigger abort instead of immediate exit.
 * The actual exit happens after the abort is processed in the main loop.
 */
export function setupSignalHandlers(
  cleanup: () => Promise<void>,
  abortController?: AbortController
): void {
  let isShuttingDown = false;

  const handler = async (signal: string) => {
    // Prevent multiple simultaneous shutdown attempts
    if (isShuttingDown) {
      logger.info(`[runner] Signal ${signal} received but already shutting down, ignoring`);
      return;
    }
    isShuttingDown = true;

    logger.info(`[runner] Received ${signal}, initiating shutdown...`);

    if (abortController) {
      // Signal abort - let the main loop handle graceful exit
      abortController.abort();
      // Note: Don't exit here - let the abort propagate through the SDK
      // The main loop catch block will call cleanup and exit with code 130
    } else {
      // No abort controller - direct cleanup and exit (legacy behavior)
      logger.info(`[runner] No abort controller, running cleanup directly`);
      await cleanup();
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
  logger.info(`[runner] Signal handlers registered for SIGTERM and SIGINT`);
}

/**
 * Extract plan mentions from a user message.
 * Plan mentions use the syntax @{relativePlanPath} like @plans/my-feature.md
 *
 * @param message - The user message content to scan
 * @returns Array of relative plan paths found in the message
 */
function extractPlanMentions(message: string): string[] {
  // Match @plans/...md or @{plans/...md} patterns
  const mentionPattern = /@\{?(plans\/[^\s\}]+\.md)\}?/g;
  const matches: string[] = [];
  let match;

  while ((match = mentionPattern.exec(message)) !== null) {
    matches.push(match[1]);
  }

  return matches;
}

/**
 * Process plan mentions in a user message and create 'mentioned' relations.
 * This is called after appending a user message to detect @plans/*.md references.
 *
 * @param message - The user message content
 * @param persistence - Persistence instance for plan lookups and relation creation
 * @param context - Orchestration context with repoId, threadId, etc.
 */
async function processPlanMentions(
  message: string,
  persistence: NodePersistence,
  context: OrchestrationContext
): Promise<void> {
  // Skip if we don't have required context
  if (!context.repoId || !context.threadId) {
    return;
  }

  const mentions = extractPlanMentions(message);
  if (mentions.length === 0) {
    return;
  }

  logger.info(`[processPlanMentions] Found ${mentions.length} plan mentions: ${mentions.join(', ')}`);

  for (const relativePath of mentions) {
    try {
      // Look up plan by relative path
      const plan = await persistence.findPlanByPath(context.repoId, relativePath);

      if (plan) {
        // Create 'mentioned' relation (will be upgraded if thread later modifies/creates)
        const relation = await persistence.createOrUpgradeRelation(
          plan.id,
          context.threadId,
          'mentioned'
        );

        // Emit relation event
        emitEvent(EventName.RELATION_CREATED, {
          planId: plan.id,
          threadId: context.threadId,
          type: relation.type,
        }, "processPlanMentions:relation");
      }
    } catch (err) {
      logger.warn(`[processPlanMentions] Failed to process mention ${relativePath}: ${err}`);
    }
  }
}

/**
 * Check if a file path is a plan path (plans/*.md).
 * Handles both absolute and relative paths.
 *
 * Note: Uses realpathSync to resolve symlinks (e.g., /var -> /private/var on macOS)
 * because the SDK may return paths with different symlink resolution than the cwd.
 */
function isPlanPath(filePath: string, workingDir: string): boolean {
  // Normalize to relative path
  let relativePath = filePath;
  if (isAbsolute(filePath)) {
    // Resolve symlinks to handle /var vs /private/var mismatches on macOS
    try {
      const realFilePath = realpathSync(filePath);
      const realWorkingDir = realpathSync(workingDir);
      relativePath = relative(realWorkingDir, realFilePath);
    } catch {
      // Fall back to direct relative if realpath fails (file may not exist yet)
      relativePath = relative(workingDir, filePath);
    }
  }
  // Normalize slashes for cross-platform
  relativePath = relativePath.replace(/\\/g, "/");
  // Check if it's in plans/ directory and is a .md file
  return relativePath.startsWith("plans/") && relativePath.endsWith(".md");
}

/**
 * Options for the agent loop, allowing strategies to customize behavior.
 */
export interface AgentLoopOptions {
  /** Called after file-modifying tools to emit file changes */
  onFileChange?: (toolName: string) => void;
  /** Stop hook for validation (task-based only) */
  stopHook?: () => Promise<{ decision: "approve" } | { decision: "block"; reason: string }>;
  /** Thread writer for resilient state writes (task-based only) */
  threadWriter?: ThreadWriter;
  /** AbortController for cancellation support */
  abortController?: AbortController;
  /** Socket message stream for receiving queued messages via socket IPC */
  messageStream?: SocketMessageStream;
  /** Permission evaluator for PreToolUse hook decisions */
  permissionEvaluator?: PermissionEvaluator;
  /** Permission gate for async approval flow (ask decisions) */
  permissionGate?: PermissionGate;
  /** Question gate for AskUserQuestion async answer flow */
  questionGate?: import("../lib/question-gate.js").QuestionGate;
  /** Proxy config for network debug — injected only into SDK query() env, not subprocess env */
  proxyConfig?: { port: number; certPath: string };
  /** Mutable ref populated by runAgentLoop with the REPL cancel function.
   *  The runner reads this on abort to cancel REPL children before hub disconnect. */
  replCancelRef?: { current: (() => void) | null };
}

/**
 * Prior state loaded from a previous run.
 * Contains messages (for UI history), sessionId (for SDK resume), and toolStates (for UI rendering).
 */
export interface PriorState {
  /** Prior conversation messages - kept for UI display */
  messages: StoredMessage[];
  /** SDK session ID from previous run - used for resume */
  sessionId?: string;
  /** Prior tool states - preserved so resumed conversations show completed tools correctly */
  toolStates?: Record<string, ToolExecutionState>;
  /** Last call token usage - preserved so context meter stays visible during resume */
  lastCallUsage?: import("../../../core/types/events.js").TokenUsage;
  /** Cumulative token usage across all calls - preserved across resume */
  cumulativeUsage?: import("../../../core/types/events.js").TokenUsage;
  /** Prior file changes — preserved so diffs accumulate across turns */
  fileChanges?: import("../../../core/types/events.js").FileChange[];
}

/**
 * Main agent loop - shared between all agent types.
 * Handles LLM queries, tool calls, state updates.
 *
 * @param config - Runner configuration from CLI args
 * @param context - Orchestration context with working directory and task info
 * @param agentConfig - Agent-specific configuration (model, tools, prompts)
 * @param priorState - Prior state containing messages (for UI) and sessionId (for SDK resume)
 * @param options - Optional hooks for strategy-specific behavior
 */
export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorState: PriorState = { messages: [] },
  options: AgentLoopOptions = {}
): Promise<void> {
  const { messages: priorMessages, sessionId: priorSessionId, toolStates: priorToolStates, lastCallUsage, cumulativeUsage, fileChanges: priorFileChanges } = priorState;

  logger.info(`[runAgentLoop] Starting`, {
    priorMessages: priorMessages.length,
    toolStates: priorToolStates ? Object.keys(priorToolStates).length : 0,
    resuming: !!priorSessionId,
  });

  // Create drain manager for analytics event emission
  const drainManager = new DrainManager(getHubClient());
  const loopStartTime = Date.now();

  // Emit thread lifecycle started
  drainManager.emit(DrainEventName.THREAD_LIFECYCLE, {
    transition: "started",
  }, "runAgentLoop:lifecycle");

  // Initialize state with prior messages AND the new user message baked in.
  // Using the frontend's messageId ensures the optimistic message the UI already
  // rendered keeps the same ID when INIT replaces the state, preventing a
  // flash where the message disappears and reappears.
  const userMessage: StoredMessage = {
    role: "user",
    content: config.prompt,
    id: config.messageId ?? crypto.randomUUID(),
  };
  await initState(context.threadPath, context.workingDir, [...priorMessages, userMessage], options.threadWriter, priorSessionId, priorToolStates, lastCallUsage, cumulativeUsage, priorFileChanges);

  // Persistence instance for plan detection and mention tracking
  const persistence = new NodePersistence(config.mortDir);

  // Process plan mentions in the initial prompt (e.g., @plans/my-feature.md)
  await processPlanMentions(config.prompt, persistence, context);

  // Build system prompt
  // Import runnerPath dynamically to avoid circular dependency
  const { runnerPath } = await import("../runner.js");
  const baseSystemPrompt = buildSystemPrompt(agentConfig, {
    threadId: context.threadId,
    repoId: context.repoId,
    worktreeId: context.worktreeId,
    cwd: context.workingDir,
    mortDir: config.mortDir,
    runnerPath,
    parentThreadId: config.parentThreadId,
    permissionModeId: context.permissionModeId ?? "implement",
  });

  const systemPrompt = baseSystemPrompt;

  // FILE_MODIFYING_TOOLS now in core/lib/hooks/file-changes.ts

  // Phase reminder state: track incomplete phases to nudge agent to update plan
  let currentPlanPhaseInfo: PhaseInfo | null = null;
  let fileModToolsSinceLastReminder = 0;

  // Build hooks for state tracking and side effects
  const { permissionEvaluator, permissionGate, questionGate } = options;

  // Shared stash for two-phase AskUserQuestion flow:
  // PreToolUse hook stashes answers here, canUseTool picks them up.
  // Keyed by toolUseId so the correct answers are matched.
  const answerStash = new Map<string, Record<string, string>>();

  const hooks = {
    PreToolUse: [
      // AskUserQuestion hook — two-phase approach:
      // 1. Hook does the long async wait (up to 1 hour), stashes answers
      // 2. Returns "ask" to force fall-through to canUseTool
      // 3. canUseTool delivers answers via official updatedInput.answers path
      ...(questionGate
        ? [
            {
              matcher: "AskUserQuestion" as const,
              timeout: 3600, // 1 hour — user may take time to answer
              hooks: [
                async (
                  hookInput: unknown,
                  toolUseId: string | undefined,
                  { signal }: { signal: AbortSignal },
                ) => {
                  const input = hookInput as PreToolUseHookInput;
                  const toolInput = input.tool_input as Record<string, unknown>;
                  const requestId = crypto.randomUUID();

                  const response = await questionGate.waitForAnswer(
                    requestId,
                    {
                      threadId: context.threadId,
                      toolUseId,
                      toolInput,
                      signal,
                    },
                    emitEvent,
                  );

                  if (response === "timeout" || signal.aborted) {
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: signal.aborted
                          ? "Question timed out"
                          : "Question cancelled — user sent a message instead",
                      },
                    };
                  }

                  // Stash answers for canUseTool to pick up
                  if (toolUseId) {
                    answerStash.set(toolUseId, response.answers);
                  }

                  // Return "ask" to force fall-through to canUseTool
                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: "ask" as const,
                    },
                  };
                },
              ],
            },
          ]
        : []),
      // Safe git hook — blocks destructive git commands in the main worktree
      // Must be before all other Bash hooks
      {
        matcher: "Bash" as const,
        hooks: [
          createSafeGitHook(),
        ],
      },
      // REPL hook — intercepts mort-repl Bash calls for programmatic agent orchestration
      // Must be before comment resolution and permission hooks
      (() => {
        const replHook = createReplHook({
          context: {
            threadId: context.threadId,
            repoId: context.repoId,
            worktreeId: context.worktreeId,
            workingDir: context.workingDir,
            permissionModeId: context.permissionModeId,
            mortDir: config.mortDir,
          },
          emitEvent,
        });
        // Expose cancel function so runner can call it on abort before hub disconnect
        if (options.replCancelRef) {
          options.replCancelRef.current = replHook.cancelAll;
        }
        return {
          matcher: "Bash" as const,
          timeout: 86400, // 24 hours — repl scripts can spawn many sub-agents
          hooks: [replHook.hook],
        };
      })(),
      // Comment resolution hook — intercepts mort-resolve-comment Bash calls
      // Must be before the catch-all permission hook so it gets first look at Bash calls
      {
        matcher: "Bash" as const,
        hooks: [
          createCommentResolutionHook({
            worktreeId: context.worktreeId,
            emitEvent,
          }),
        ],
      },
      // Permission hook — matches ALL tools, evaluated before the Task hook
      ...(permissionEvaluator && permissionGate
        ? [
            {
              matcher: undefined as undefined, // matches everything
              timeout: 3600, // 1 hour (validated by Phase 0 experiments)
              hooks: [
                async (
                  hookInput: unknown,
                  toolUseId: string | undefined,
                  { signal }: { signal: AbortSignal },
                ) => {
                  const input = hookInput as PreToolUseHookInput;

                  // Skip AskUserQuestion — handled by dedicated question gate hook
                  if (input.tool_name === "AskUserQuestion") {
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "allow" as const,
                      },
                    };
                  }

                  const evalStart = Date.now();

                  // Start tool timer for duration tracking
                  if (toolUseId) drainManager.startTimer(toolUseId);

                  const { decision, reason } = permissionEvaluator.evaluate(
                    input.tool_name,
                    input.tool_input,
                  );
                  const evaluationTimeMs = Date.now() - evalStart;

                  if (decision === "allow") {
                    // Emit permission:decided + tool:started for allowed tools
                    drainManager.emit(DrainEventName.PERMISSION_DECIDED, {
                      toolName: input.tool_name,
                      toolUseId: toolUseId ?? "unknown",
                      decision: "allow",
                      reason,
                      modeId: permissionEvaluator.getModeId(),
                      evaluationTimeMs,
                    }, "PreToolUse:permission");
                    drainManager.emit(DrainEventName.TOOL_STARTED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      toolInput: JSON.stringify(input.tool_input).slice(0, 2000),
                      permissionDecision: "allow",
                      permissionReason: reason,
                    }, "PreToolUse:allow");
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "allow" as const,
                        permissionDecisionReason: reason,
                      },
                    };
                  }

                  if (decision === "deny") {
                    // Emit permission:decided + tool:denied for blocked tools
                    drainManager.emit(DrainEventName.PERMISSION_DECIDED, {
                      toolName: input.tool_name,
                      toolUseId: toolUseId ?? "unknown",
                      decision: "deny",
                      reason,
                      modeId: permissionEvaluator.getModeId(),
                      evaluationTimeMs,
                    }, "PreToolUse:permission");
                    drainManager.emit(DrainEventName.TOOL_DENIED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      reason: reason ?? "Permission denied",
                      deniedBy: "rule",
                    }, "PreToolUse:deny");
                    return {
                      hookSpecificOutput: {
                        hookEventName: "PreToolUse" as const,
                        permissionDecision: "deny" as const,
                        permissionDecisionReason: reason,
                      },
                    };
                  }

                  // decision === "ask" — block and wait for user
                  const requestId = crypto.randomUUID();
                  const threadId = context.threadId;
                  const askStart = Date.now();
                  const response = await permissionGate.waitForResponse(
                    requestId,
                    {
                      threadId,
                      toolName: input.tool_name,
                      toolInput: input.tool_input,
                      toolUseId,
                      reason,
                      signal,
                    },
                    emitEvent,
                  );

                  if (response === "timeout" || signal.aborted) {
                    drainManager.emit(DrainEventName.PERMISSION_DECIDED, {
                      toolName: input.tool_name,
                      toolUseId: toolUseId ?? "unknown",
                      decision: "ask",
                      reason,
                      modeId: permissionEvaluator.getModeId(),
                      evaluationTimeMs,
                      waitTimeMs: Date.now() - askStart,
                      userDecision: "timeout",
                    }, "PreToolUse:permission");
                    return {
                      continue: false,
                      stopReason: "Permission request timed out — agent stopped",
                    };
                  }

                  const userDecision = response.approved
                    ? ("allow" as const)
                    : ("deny" as const);
                  const waitTimeMs = Date.now() - askStart;

                  drainManager.emit(DrainEventName.PERMISSION_DECIDED, {
                    toolName: input.tool_name,
                    toolUseId: toolUseId ?? "unknown",
                    decision: "ask",
                    reason,
                    modeId: permissionEvaluator.getModeId(),
                    evaluationTimeMs,
                    waitTimeMs,
                    userDecision,
                  }, "PreToolUse:permission");

                  if (userDecision === "allow") {
                    drainManager.emit(DrainEventName.TOOL_STARTED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      toolInput: JSON.stringify(input.tool_input).slice(0, 2000),
                      permissionDecision: "allow",
                      permissionReason: response.reason ?? "User approved",
                    }, "PreToolUse:allow");
                  } else {
                    drainManager.emit(DrainEventName.TOOL_DENIED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      reason: response.reason ?? "User denied",
                      deniedBy: "user",
                    }, "PreToolUse:deny");
                  }

                  return {
                    hookSpecificOutput: {
                      hookEventName: "PreToolUse" as const,
                      permissionDecision: userDecision,
                      permissionDecisionReason:
                        response.reason ??
                        (response.approved ? "User approved" : "User denied"),
                    },
                  };
                },
              ],
            },
          ]
        : []),
      // Sub-agent hook: handles both "Task" (SDK <0.2.64) and "Agent" (SDK ≥0.2.64)
      ...["Task", "Agent"].map((toolName) => ({
        matcher: toolName,
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as PreToolUseHookInput;
            const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };

            // Dedup: both "Task" and "Agent" matchers may fire for the same tool use
            if (toolUseIdToChildThreadId.has(input.tool_use_id)) {
              return { continue: true };
            }

            // Skip if missing required context for thread creation
            if (!context.repoId || !context.worktreeId) {
              logger.warn(`[PreToolUse:SubAgent] Cannot create sub-agent thread: missing repoId or worktreeId`);
              return { continue: true };
            }

            const childThreadId = crypto.randomUUID();
            const toolUseId = input.tool_use_id;
            const agentType = taskInput.subagent_type ?? "general-purpose";
            const taskPrompt = taskInput.prompt ?? `Sub-agent: ${agentType}`;

            // Create child thread directory and metadata
            const childThreadPath = join(config.mortDir, "threads", childThreadId);
            const now = Date.now();

            const childMetadata = {
              id: childThreadId,
              repoId: context.repoId,
              worktreeId: context.worktreeId,
              status: "running",
              turns: [{
                index: 0,
                prompt: taskPrompt,
                startedAt: now,
                completedAt: null,
              }],
              isRead: true,
              name: `${agentType}: <pending>`,
              createdAt: now,
              updatedAt: now,
              parentThreadId: context.threadId,
              parentToolUseId: toolUseId,  // Full toolu_01ABC... format
              agentType: agentType,
              visualSettings: {
                parentId: context.threadId,  // sub-agent → parent thread
              },
              permissionMode: permissionEvaluator?.getModeId() ?? context.permissionModeId ?? "implement",
            };

            try {
              mkdirSync(childThreadPath, { recursive: true });
              writeFileSync(
                join(childThreadPath, "metadata.json"),
                JSON.stringify(childMetadata, null, 2)
              );

              // Create initial state.json with the user message (the task prompt)
              const initialUserMessage = {
                role: "user",
                content: [{ type: "text", text: taskPrompt }],
                id: crypto.randomUUID(),
              };
              const initialState = {
                messages: [initialUserMessage],
                fileChanges: [],
                workingDirectory: context.workingDir,
                status: "running",
                timestamp: now,
                toolStates: {},
                wipMap: {},
                blockIdMap: {},
              };
              writeFileSync(
                join(childThreadPath, "state.json"),
                JSON.stringify(initialState, null, 2)
              );

              // Map toolUseId → childThreadId (the ONLY map we need)
              toolUseIdToChildThreadId.set(toolUseId, childThreadId);

              // Send INIT action so client-side reducer constructs state
              // with wipMap/blockIdMap (same event-sourcing pattern as parent threads)
              const hub = getHubClient();
              hub?.sendActionForThread(childThreadId, {
                type: "INIT",
                payload: {
                  workingDirectory: context.workingDir,
                  messages: [initialUserMessage],
                },
              });

              // Emit THREAD_CREATED event
              emitEvent(EventName.THREAD_CREATED, {
                threadId: childThreadId,
                repoId: context.repoId,
                worktreeId: context.worktreeId,
              }, "runAgentLoop:subagent-spawn");

              logger.info(`[PreToolUse:SubAgent] Created child thread: ${childThreadId} for toolUseId: ${toolUseId}`);

              // Emit subagent:spawned drain event and start timer
              drainManager.startTimer(`subagent:${childThreadId}`);
              drainManager.emit(DrainEventName.SUBAGENT_SPAWNED, {
                childThreadId,
                agentType,
                toolUseId,
                promptLength: taskPrompt.length,
              }, "PreToolUse:subagent-spawn");

              // Fire-and-forget: generate thread name
              const apiKey = process.env.ANTHROPIC_API_KEY;
              if (apiKey) {
                generateThreadName(taskPrompt, apiKey)
                  .then(({ name: generatedName, usedFallback }) => {
                    const metadataPath = join(childThreadPath, "metadata.json");
                    if (existsSync(metadataPath)) {
                      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                      metadata.name = generatedName;
                      metadata.updatedAt = Date.now();
                      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                      emitEvent(EventName.THREAD_NAME_GENERATED, {
                        threadId: childThreadId,
                        name: generatedName,
                      }, "runAgentLoop:name-generation");
                      logger.info(`[PreToolUse:SubAgent] Generated name for thread ${childThreadId}: ${generatedName}${usedFallback ? " (fallback model)" : ""}`);
                    }
                    if (usedFallback) {
                      emitEvent(EventName.API_DEGRADED, {
                        service: "thread-naming",
                        message: "Haiku unavailable, used Sonnet fallback for thread naming",
                      }, "runAgentLoop:name-generation");
                    }
                  })
                  .catch((err) => {
                    logger.warn(`[PreToolUse:SubAgent] Failed to generate name: ${err}`);
                    emitEvent(EventName.API_DEGRADED, {
                      service: "thread-naming",
                      message: "Thread naming failed — Anthropic API may be down",
                    }, "runAgentLoop:name-generation");
                  });
              }
            } catch (err) {
              logger.error(`[PreToolUse:SubAgent] Failed to create child thread: ${err}`);
            }

            return { continue: true };
          },
        ],
      })),
    ],
    PostToolUse: [
      {
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as PostToolUseHookInput;

            // Mark tool as complete in state
            const toolResponse =
              typeof input.tool_response === "string"
                ? input.tool_response
                : JSON.stringify(input.tool_response);

            await markToolComplete(input.tool_use_id, toolResponse, false);

            // Emit tool:completed drain event
            const toolDurationMs = drainManager.endTimer(input.tool_use_id);
            drainManager.emit(DrainEventName.TOOL_COMPLETED, {
              toolUseId: input.tool_use_id,
              toolName: input.tool_name,
              durationMs: toolDurationMs,
              resultLength: toolResponse.length,
              resultTruncated: toolResponse.length > 10000,
            }, "PostToolUse:complete");

            // Track file changes for file-modifying tools
            // This must be done here because PostToolUse hooks fire before/instead of
            // SDK user messages, so MessageHandler may never see the tool result.
            const fileChange = extractFileChange(
              input.tool_name,
              input.tool_input as Record<string, unknown>,
              context.workingDir,
            );
            if (fileChange) {
              await updateFileChange(fileChange, context.workingDir);
              const filePath = fileChange.path;
              logger.info(`[PostToolUse] Recorded file change: ${fileChange.operation} ${filePath}`);

              // Detect plan files and create/update plan entity + relation
              if (isPlanPath(filePath, context.workingDir)) {
                if (!context.repoId || !context.worktreeId) {
                  logger.warn(`[PostToolUse] Cannot create plan: missing repoId or worktreeId`);
                } else if (!context.threadId) {
                  logger.warn(`[PostToolUse] Cannot create relation: missing threadId`);
                } else {
                  const absolutePath = isAbsolute(filePath)
                    ? filePath
                    : resolve(context.workingDir, filePath);

                  let phaseInfo: PhaseInfo | null = null;
                  try {
                    const content = readFileSync(absolutePath, 'utf-8');
                    phaseInfo = parsePhases(content);
                    if (phaseInfo) {
                      logger.info(`[PostToolUse] Parsed phases: ${phaseInfo.completed}/${phaseInfo.total}`);
                      currentPlanPhaseInfo = phaseInfo;
                    }
                  } catch (parseErr) {
                    logger.warn(`[PostToolUse] Failed to parse phases: ${parseErr}`);
                  }

                  try {
                    const { id: planId, isNew } = await persistence.ensurePlanExists(
                      context.repoId,
                      context.worktreeId,
                      absolutePath,
                      context.workingDir,
                      phaseInfo
                    );
                    logger.info(`[PostToolUse] About to emit PLAN_DETECTED event: planId=${planId}`);
                    emitEvent(EventName.PLAN_DETECTED, { planId }, "PostToolUse:plan-detection");
                    logger.info(`[PostToolUse] PLAN_DETECTED event emitted to stdout: ${filePath} -> ${planId}`);

                    const relationType = isNew ? 'created' : 'modified';
                    try {
                      const relation = await persistence.createOrUpgradeRelation(
                        planId,
                        context.threadId,
                        relationType as 'created' | 'modified'
                      );
                      logger.info(`[PostToolUse] Created/upgraded relation: ${planId}-${context.threadId} (${relation.type})`);
                      emitEvent(EventName.RELATION_CREATED, {
                        planId,
                        threadId: context.threadId,
                        type: relation.type,
                      }, "PostToolUse:plan-relation");
                    } catch (relErr) {
                      logger.warn(`[PostToolUse] Failed to create relation: ${relErr}`);
                    }

                    const threadMetadataPath = join(context.threadPath, "metadata.json");
                    try {
                      const threadMetadata = JSON.parse(readFileSync(threadMetadataPath, "utf-8"));
                      if (!threadMetadata.planId) {
                        threadMetadata.planId = planId;
                        threadMetadata.updatedAt = Date.now();
                        writeFileSync(threadMetadataPath, JSON.stringify(threadMetadata, null, 2));
                        emitEvent(EventName.THREAD_UPDATED, {
                          threadId: context.threadId,
                        }, "PostToolUse:plan-association");
                        logger.info(`[PostToolUse] Associated thread ${context.threadId} with plan ${planId}`);
                      }
                    } catch (metaErr) {
                      logger.warn(`[PostToolUse] Failed to associate thread with plan: ${metaErr}`);
                    }
                  } catch (err) {
                    logger.warn(`[PostToolUse] Failed to create plan entity: ${err}`);
                  }
                }
              }
            }

            // Side effect: notify strategy of file changes
            if (options.onFileChange) {
              options.onFileChange(input.tool_name);
            }

            // Phase reminder: nudge agent to mark plan phases complete (implement mode only)
            {
              const toolInput = input.tool_input as { file_path?: string; notebook_path?: string };
              const filePath = toolInput.file_path ?? toolInput.notebook_path;

              if (shouldIncrementFileModCount(input.tool_name, filePath, context.workingDir)) {
                fileModToolsSinceLastReminder++;
              }

              if (shouldFirePhaseReminder({
                toolName: input.tool_name,
                filePath,
                workingDir: context.workingDir,
                permissionModeId: context.permissionModeId,
                phaseInfo: currentPlanPhaseInfo,
                fileModCount: fileModToolsSinceLastReminder,
              })) {
                fileModToolsSinceLastReminder = 0;
                return {
                  hookSpecificOutput: {
                    hookEventName: "PostToolUse" as const,
                    additionalContext: PHASE_REMINDER_TEXT,
                  },
                };
              }
            }

            // Context short-circuit: nudge agent to save progress when context is high
            if (config.contextShortCircuit) {
              const utilization = handler.getUtilization();
              if (utilization !== null && utilization >= config.contextShortCircuit.limitPercent) {
                logger.info(
                  `[PostToolUse] Context short-circuit: ${utilization.toFixed(1)}% >= ${config.contextShortCircuit.limitPercent}%, nudging agent`
                );
                return {
                  hookSpecificOutput: {
                    hookEventName: "PostToolUse" as const,
                    additionalContext: config.contextShortCircuit.message,
                  },
                };
              }
            }

            // Detect git worktree creation via Bash — trigger worktree sync
            if (input.tool_name === "Bash") {
              const toolInput = input.tool_input as { command?: string };
              const command = toolInput.command ?? "";

              if (/git\s+worktree\s+add\b/.test(command)) {
                if (context.repoId) {
                  emitEvent(EventName.WORKTREE_SYNCED, {
                    repoId: context.repoId,
                  }, "PostToolUse:git-worktree-add");

                  logger.info(`[PostToolUse] Detected git worktree add command, triggering sync`);
                }
              }

              // Detect PR creation via Bash — trigger PR sync
              if (/gh\s+pr\s+create\b/.test(command)) {
                const response = typeof input.tool_response === "string"
                  ? input.tool_response
                  : JSON.stringify(input.tool_response);

                // gh pr create outputs the URL on success: https://github.com/owner/repo/pull/123
                const prUrlMatch = response.match(
                  /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/
                );

                if (prUrlMatch && context.repoId && context.worktreeId) {
                  const repoSlug = prUrlMatch[1];
                  const prNumber = parseInt(prUrlMatch[2], 10);

                  emitEvent(EventName.PR_DETECTED, {
                    repoId: context.repoId,
                    worktreeId: context.worktreeId,
                    repoSlug,
                    prNumber,
                  }, "PostToolUse:gh-pr-create");

                  logger.info(`[PostToolUse] Detected gh pr create: #${prNumber} on ${repoSlug}`);
                }
              }
            }

            // Handle Task tool completion: mark thread completed, add response to state.json
            // For background tasks (run_in_background: true), the tool result is an
            // async_launched marker — the task hasn't finished yet. Skip premature completion;
            // the real completion arrives via task_notification system messages.
            if (input.tool_name === "Task" || input.tool_name === "Agent") {
              try {
                const toolUseId = input.tool_use_id;
                const childThreadId = toolUseIdToChildThreadId.get(toolUseId);

                if (!childThreadId) {
                  logger.warn(`[PostToolUse:SubAgent] No child thread for toolUseId: ${toolUseId}`);
                  return { continue: true };
                }

                let taskResponse: Record<string, unknown>;
                try {
                  taskResponse = typeof input.tool_response === "string"
                    ? JSON.parse(input.tool_response)
                    : (input.tool_response as Record<string, unknown>);
                } catch {
                  // tool_response is a plain string (error message, cancellation, etc.)
                  // Wrap it as content so we still mark the child as completed
                  taskResponse = { content: [{ type: "text", text: String(input.tool_response) }] };
                }

                // Detect background tasks: the SDK returns an output_file path and
                // task_id when a task is launched in background, instead of the full result.
                const isBackground = !!(taskResponse.task_id || taskResponse.output_file);
                if (isBackground) {
                  logger.info(
                    `[PostToolUse:SubAgent] Background task detected for ${childThreadId} — ` +
                    `skipping premature completion (task_id=${taskResponse.task_id})`
                  );
                  // Leave status as "running", don't clean up the map.
                  // task_notification will handle real completion.
                  return { continue: true };
                }

                const childThreadPath = join(config.mortDir, "threads", childThreadId);
                const metadataPath = join(childThreadPath, "metadata.json");
                const statePath = join(childThreadPath, "state.json");

                // === Update metadata.json ===
                let childAgentType = "unknown";
                if (existsSync(metadataPath)) {
                  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                  childAgentType = metadata.agentType ?? "unknown";

                  metadata.status = "completed";

                  if (metadata.turns?.length > 0) {
                    const lastTurn = metadata.turns[metadata.turns.length - 1];
                    lastTurn.completedAt = Date.now();

                    const textContent = taskResponse.content?.find(
                      (c: { type: string }) => c.type === "text"
                    );
                    lastTurn.response = textContent?.text ?? JSON.stringify(taskResponse.content);
                  }

                  // Write usage from task result if not already present from handleForChildThread
                  if (!metadata.lastCallUsage && taskResponse.usage) {
                    const u = taskResponse.usage;
                    const usage = {
                      inputTokens: u.input_tokens ?? 0,
                      outputTokens: u.output_tokens ?? 0,
                      cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
                      cacheReadTokens: u.cache_read_input_tokens ?? 0,
                    };
                    metadata.lastCallUsage = usage;
                    metadata.cumulativeUsage = usage;
                  }

                  // Write totalCostUsd to child metadata (canonical cost location)
                  if (taskResponse.total_cost_usd !== undefined) {
                    metadata.totalCostUsd = taskResponse.total_cost_usd;
                  }

                  metadata.updatedAt = Date.now();
                  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                  logger.info(`[PostToolUse:SubAgent] Updated metadata for thread ${childThreadId}`);

                  // Roll up child's tree cost to parent's cumulativeCostUsd
                  if (taskResponse.total_cost_usd !== undefined) {
                    const childTreeCost = (taskResponse.total_cost_usd as number) + ((metadata.cumulativeCostUsd as number) ?? 0);
                    rollUpCostToParent(config.mortDir, context.threadId, childTreeCost);
                  }
                }

                // === Append final response to state.json ===
                // The SDK returns the final response as the tool result, not as a separate
                // assistant message event. Append it so the child thread shows the complete conversation.
                if (taskResponse.content && Array.isArray(taskResponse.content)) {
                  interface ThreadState {
                    messages: Array<{ role: string; content: unknown; id?: string }>;
                    fileChanges: unknown[];
                    workingDirectory: string;
                    status: string;
                    timestamp: number;
                    toolStates: Record<string, unknown>;
                  }

                  let state: ThreadState;

                  if (existsSync(statePath)) {
                    state = JSON.parse(readFileSync(statePath, "utf-8")) as ThreadState;
                  } else {
                    state = {
                      messages: [],
                      fileChanges: [],
                      workingDirectory: context.workingDir,
                      status: "running",
                      timestamp: Date.now(),
                      toolStates: {},
                    };
                  }

                  state.messages.push({
                    role: "assistant",
                    content: taskResponse.content,
                    id: crypto.randomUUID(),
                  });

                  state.status = "complete";
                  state.timestamp = Date.now();

                  writeFileSync(statePath, JSON.stringify(state, null, 2));
                  logger.info(`[PostToolUse:SubAgent] Appended final response to state.json`);
                }

                // Emit subagent:completed drain event
                const subagentDurationMs = drainManager.endTimer(`subagent:${childThreadId}`);
                drainManager.emit(DrainEventName.SUBAGENT_COMPLETED, {
                  childThreadId,
                  agentType: childAgentType,
                  durationMs: subagentDurationMs,
                  resultLength: toolResponse.length,
                }, "PostToolUse:subagent");

                // Send COMPLETE action via hub (triggers markOrphanedTools in reducer)
                const hub = getHubClient();
                hub?.sendActionForThread(childThreadId, {
                  type: "COMPLETE",
                  payload: { metrics: {} },
                });

                // Emit THREAD_STATUS_CHANGED
                emitEvent(EventName.THREAD_STATUS_CHANGED, {
                  threadId: childThreadId,
                  status: "completed",
                }, "PostToolUse:subagent");

                // Emit AGENT_COMPLETED so listeners fire (loadThreadState, mark unread)
                emitEvent(EventName.AGENT_COMPLETED, {
                  threadId: childThreadId,
                  exitCode: 0,
                  costUsd: taskResponse.total_cost_usd as number | undefined,
                }, "PostToolUse:subagent");

                // Cleanup the map (foreground tasks only — bg tasks cleaned up by task_notification)
                toolUseIdToChildThreadId.delete(toolUseId);
                logger.info(`[PostToolUse:SubAgent] Completed thread ${childThreadId}, cleaned up mapping`);

              } catch (err) {
                logger.warn(`[PostToolUse:SubAgent] Failed to update child thread: ${err}`);
              }
            }

            return { continue: true };
          },
        ],
      },
    ],
    PostToolUseFailure: [
      {
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as PostToolUseFailureHookInput;

            // Mark tool as error in state
            await markToolComplete(input.tool_use_id, input.error, true);

            // Emit tool:failed drain event
            const failDurationMs = drainManager.endTimer(input.tool_use_id);
            drainManager.emit(DrainEventName.TOOL_FAILED, {
              toolUseId: input.tool_use_id,
              toolName: input.tool_name,
              durationMs: failDurationMs,
              error: input.error.slice(0, 1000),
              errorType: classifyError(input.error),
            }, "PostToolUse:fail");

            logger.debug(
              `[PostToolUseFailure] ${input.tool_name}: ${input.error}`
            );

            // Mark child thread as errored so it doesn't stay "running" forever
            if (input.tool_name === "Task" || input.tool_name === "Agent") {
              const childThreadId = toolUseIdToChildThreadId.get(input.tool_use_id);
              if (childThreadId) {
                const childThreadPath = join(config.mortDir, "threads", childThreadId);
                const metadataPath = join(childThreadPath, "metadata.json");
                if (existsSync(metadataPath)) {
                  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                  metadata.status = "error";
                  metadata.updatedAt = Date.now();
                  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                }
                // Send ERROR action via hub (triggers markOrphanedTools in reducer)
                const hub = getHubClient();
                hub?.sendActionForThread(childThreadId, {
                  type: "ERROR",
                  payload: { message: input.error },
                });

                emitEvent(EventName.THREAD_STATUS_CHANGED, {
                  threadId: childThreadId,
                  status: "error",
                }, "PostToolUseFailure:subagent");

                // Emit AGENT_COMPLETED so listeners fire (loadThreadState, mark unread)
                emitEvent(EventName.AGENT_COMPLETED, {
                  threadId: childThreadId,
                  exitCode: 1,
                }, "PostToolUseFailure:subagent");

                toolUseIdToChildThreadId.delete(input.tool_use_id);
              }
            }

            return { continue: true };
          },
        ],
      },
    ],
    // NOTE: SubagentStart and SubagentStop hooks have been removed.
    // Thread creation is now handled in PreToolUse:Task, and completion in PostToolUse:Task.
    // This eliminates orphan threads from warmup agents and simplifies the architecture.
    ...(options.stopHook && {
      Stop: [{ hooks: [options.stopHook] }],
    }),
  };

  // Check for mock mode
  const useMockMode = isMockModeEnabled();
  if (useMockMode) {
    logger.info("[runner] Mock LLM mode enabled");
  }

  // Use provided abortController or create one for cancellation support
  const abortController = options.abortController ?? new AbortController();

  // Determine prompt: use message stream if provided (enables queued messages via socket),
  // otherwise use plain string prompt
  const ackManager = options.messageStream
    ? new QueuedAckManager(emitEvent, moveMessageToEnd)
    : undefined;

  let prompt: string | AsyncGenerator<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>;
  if (options.messageStream && ackManager) {
    // Create async iterable from the message stream for SDK consumption
    prompt = options.messageStream.createWrappedStream(config.prompt, ackManager);
    logger.info("[runAgentLoop] Using message stream for queued message support");
  } else {
    prompt = config.prompt;
    logger.info(`[runAgentLoop] Using plain string prompt`);
  }

  // Run the agent (real or mock)
  // Note: Mock mode does NOT support message streams - it uses scripted responses.
  const result = useMockMode
    ? mockQuery({
        onToolResult: async (toolName, toolUseId, result) => {
          // Mark tool as complete in state
          await markToolComplete(toolUseId, result, false);
          if (options.onFileChange) {
            options.onFileChange(toolName);
          }
        },
        onToolFailure: async (toolName, toolUseId, error) => {
          // Mark tool as error in state
          await markToolComplete(toolUseId, error, true);
          logger.debug(`[PostToolUseFailure] ${toolName}: ${error}`);
        },
      })
    : query({
        prompt,
        options: {
          // Strip CLAUDECODE env var to prevent "nested session" error on SDK v0.2.59+.
          // The bundled CLI refuses to start if this variable is present.
          // Inject proxy vars here (not process.env) so only SDK API calls go through
          // the proxy — Bash tool subprocesses (gh, git, curl) stay unaffected.
          env: {
            ...process.env,
            CLAUDECODE: undefined,
            // When ANTHROPIC_API_KEY is empty (claude-login mode), remove it so
            // the CLI falls back to keychain credentials instead of sending "".
            ...(process.env.ANTHROPIC_API_KEY === "" && { ANTHROPIC_API_KEY: undefined }),
            ...(options.proxyConfig && {
              HTTPS_PROXY: `http://127.0.0.1:${options.proxyConfig.port}`,
              HTTP_PROXY: `http://127.0.0.1:${options.proxyConfig.port}`,
              NODE_EXTRA_CA_CERTS: options.proxyConfig.certPath,
            }),
          },
          cwd: context.workingDir,
          additionalDirectories: [config.mortDir],
          plugins: [{ type: "local" as const, path: config.mortDir }],
          settingSources: ["user", "project"],
          betas: ["fast-mode-2026-02-01" as any],
          model: agentConfig.model ?? "claude-opus-4-6",
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: systemPrompt,
          },
          tools: agentConfig.tools,
          disallowedTools: [...DISALLOWED_TOOLS],
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: true,
          // Resume from prior SDK session if available (enables conversation continuity)
          ...(priorSessionId && { resume: priorSessionId }),
          abortController,
          hooks,
          // Two-phase AskUserQuestion: canUseTool picks up stashed answers
          // and delivers them via the official updatedInput.answers path.
          // For all other tools, auto-allow (replicates bypassPermissions).
          ...(questionGate && {
            canUseTool: async (
              toolName: string,
              input: Record<string, unknown>,
              options: { toolUseID: string },
            ) => {
              if (toolName === "AskUserQuestion") {
                const answers = answerStash.get(options.toolUseID);
                if (answers) {
                  answerStash.delete(options.toolUseID);
                  return {
                    behavior: "allow" as const,
                    updatedInput: { ...input, answers },
                  };
                }
                // No stashed answers — shouldn't happen, but deny gracefully
                return { behavior: "deny" as const, message: "No answers available" };
              }
              // All other tools: auto-allow (bypassPermissions behavior)
              return { behavior: "allow" as const, updatedInput: input };
            },
          }),
          // Custom agent definitions - override built-in agents or define new ones
          // The manager agent can spawn sub-agents via the Agent tool (Task in SDK <0.2.64)
          agents: {
            "manager": {
              description: "Manager agent that coordinates complex multi-step tasks by delegating to specialized sub-agents. Use this when a task requires orchestrating multiple agents or when you need to break down a complex problem into sub-tasks.",
              prompt: "You are a manager agent that coordinates complex tasks. You can spawn specialized sub-agents using the Agent tool to delegate work. Break down complex problems into focused sub-tasks and coordinate the results.",
              tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "Agent"],
            },
          },
        },
      });

  // Create stream accumulator for live streaming display (if hub is available)
  const hubClient = getHubClient();
  const accumulator = hubClient && context.threadId
    ? new StreamAccumulator(hubClient, context.threadId)
    : undefined;

  // Process messages with dedicated handler
  // Pass mortDir for sub-agent message routing, drainManager for analytics
  // Default context window (200k) allows getUtilization() to work before the result message arrives
  const handler = new MessageHandler(config.mortDir, accumulator, drainManager, 200_000, ackManager);

  let loopError: string | undefined;
  try {
    for await (const message of result) {
      // Capture session_id from init message for message stream
      if (options.messageStream && message.type === "system" && (message as { subtype?: string }).subtype === "init") {
        const sessionId = (message as { session_id: string }).session_id;
        options.messageStream.setSessionId(sessionId);
        logger.debug(`[runAgentLoop] Updated message stream session_id: ${sessionId}`);
      }

      logger.debug(`[runner] Message: type=${message.type}`);
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }
  } catch (err) {
    loopError = String(err);
    throw err;
  } finally {
    // Emit thread lifecycle completion drain event
    drainManager.emit(DrainEventName.THREAD_LIFECYCLE, {
      transition: loopError ? "errored" : "completed",
      durationMs: Date.now() - loopStartTime,
      error: loopError,
    }, "runAgentLoop:lifecycle");

    // Clean up message stream on completion
    if (options.messageStream) {
      options.messageStream.close();
      logger.debug("[runAgentLoop] Closed message stream");
    }
    // Clean up pending permission requests
    if (permissionGate) {
      permissionGate.clear();
      logger.debug("[runAgentLoop] Cleared permission gate");
    }
    // Clean up pending question requests
    if (questionGate) {
      questionGate.clear();
      answerStash.clear();
      logger.debug("[runAgentLoop] Cleared question gate and answer stash");
    }
  }
}

import {
  query,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type PostToolUseFailureHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { relative, isAbsolute, join, resolve } from "path";
import { readFileSync, writeFileSync, readdirSync, realpathSync, mkdirSync, existsSync } from "fs";
import crypto from "crypto";
import { parsePhases } from "../lib/phase-parser.js";
import type { PhaseInfo } from "@core/types/plans.js";
import type { RunnerConfig, OrchestrationContext } from "./types.js";
import type { AgentConfig } from "../agent-types/index.js";
import {
  initState,
  appendUserMessage,
  markToolComplete,
  relayEventsFromToolOutput,
  updateFileChange,
  getHubClient,
} from "../output.js";
import { NodePersistence } from "../lib/persistence-node.js";
import { EventName } from "@core/types/events.js";
import type { ToolExecutionState } from "@core/types/events.js";
import { MessageHandler } from "./message-handler.js";
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
  payload: Record<string, unknown>
): void {
  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendEvent(name, payload);
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
        });
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
}

/**
 * Prior state loaded from a previous run.
 * Contains messages (for UI history), sessionId (for SDK resume), and toolStates (for UI rendering).
 */
export interface PriorState {
  /** Prior conversation messages - kept for UI display */
  messages: MessageParam[];
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
  });

  // Initialize state with prior messages (for UI), sessionId (for resume), toolStates (for UI rendering),
  // and token usage (so context meter stays visible during resume)
  await initState(context.threadPath, context.workingDir, priorMessages, options.threadWriter, priorSessionId, priorToolStates, lastCallUsage, cumulativeUsage, priorFileChanges);
  await appendUserMessage(config.prompt);

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

  // Tools that modify files and should be tracked for diffing
  const FILE_MODIFYING_TOOLS = ["Edit", "Write", "NotebookEdit"];

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
                    });
                    drainManager.emit(DrainEventName.TOOL_STARTED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      toolInput: JSON.stringify(input.tool_input).slice(0, 2000),
                      permissionDecision: "allow",
                      permissionReason: reason,
                    });
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
                    });
                    drainManager.emit(DrainEventName.TOOL_DENIED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      reason: reason ?? "Permission denied",
                      deniedBy: "rule",
                    });
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
                    });
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
                  });

                  if (userDecision === "allow") {
                    drainManager.emit(DrainEventName.TOOL_STARTED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      toolInput: JSON.stringify(input.tool_input).slice(0, 2000),
                      permissionDecision: "allow",
                      permissionReason: response.reason ?? "User approved",
                    });
                  } else {
                    drainManager.emit(DrainEventName.TOOL_DENIED, {
                      toolUseId: toolUseId ?? "unknown",
                      toolName: input.tool_name,
                      reason: response.reason ?? "User denied",
                      deniedBy: "user",
                    });
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
      {
        matcher: "Task",
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as PreToolUseHookInput;
            const taskInput = input.tool_input as { prompt?: string; subagent_type?: string };

            // Skip if missing required context for thread creation
            if (!context.repoId || !context.worktreeId) {
              logger.warn(`[PreToolUse:Task] Cannot create sub-agent thread: missing repoId or worktreeId`);
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
              permissionMode: permissionEvaluator?.getModeId() ?? context.permissionModeId ?? "implement",
            };

            try {
              mkdirSync(childThreadPath, { recursive: true });
              writeFileSync(
                join(childThreadPath, "metadata.json"),
                JSON.stringify(childMetadata, null, 2)
              );

              // Create initial state.json with the user message (the task prompt)
              const initialState = {
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: taskPrompt }],
                  },
                ],
                fileChanges: [],
                workingDirectory: context.workingDir,
                status: "running",
                timestamp: now,
                toolStates: {},
              };
              writeFileSync(
                join(childThreadPath, "state.json"),
                JSON.stringify(initialState, null, 2)
              );

              // Map toolUseId → childThreadId (the ONLY map we need)
              toolUseIdToChildThreadId.set(toolUseId, childThreadId);

              // Emit THREAD_CREATED event
              emitEvent(EventName.THREAD_CREATED, {
                threadId: childThreadId,
                repoId: context.repoId,
                worktreeId: context.worktreeId,
              });

              logger.info(`[PreToolUse:Task] Created child thread: ${childThreadId} for toolUseId: ${toolUseId}`);

              // Emit subagent:spawned drain event and start timer
              drainManager.startTimer(`subagent:${childThreadId}`);
              drainManager.emit(DrainEventName.SUBAGENT_SPAWNED, {
                childThreadId,
                agentType,
                toolUseId,
                promptLength: taskPrompt.length,
              });

              // Fire-and-forget: generate thread name
              const apiKey = process.env.ANTHROPIC_API_KEY;
              if (apiKey) {
                generateThreadName(taskPrompt, apiKey)
                  .then((generatedName) => {
                    const metadataPath = join(childThreadPath, "metadata.json");
                    if (existsSync(metadataPath)) {
                      const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                      metadata.name = generatedName;
                      metadata.updatedAt = Date.now();
                      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                      emitEvent(EventName.THREAD_NAME_GENERATED, {
                        threadId: childThreadId,
                        name: generatedName,
                      });
                      logger.info(`[PreToolUse:Task] Generated name for thread ${childThreadId}: ${generatedName}`);
                    }
                  })
                  .catch((err) => {
                    logger.warn(`[PreToolUse:Task] Failed to generate name: ${err}`);
                  });
              }
            } catch (err) {
              logger.error(`[PreToolUse:Task] Failed to create child thread: ${err}`);
            }

            return { continue: true };
          },
        ],
      },
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
            });

            // Side effect: relay embedded events to stdout
            relayEventsFromToolOutput(toolResponse);

            // Track file changes for file-modifying tools
            // This must be done here because PostToolUse hooks fire before/instead of
            // SDK user messages, so MessageHandler may never see the tool result.
            if (FILE_MODIFYING_TOOLS.includes(input.tool_name)) {
              const toolInput = input.tool_input as { file_path?: string; notebook_path?: string };
              const filePath = toolInput.file_path ?? toolInput.notebook_path;

              if (filePath) {
                const operation = input.tool_name === "Write" ? "create" : "modify";
                await updateFileChange(
                  {
                    path: filePath,
                    operation,
                  },
                  context.workingDir
                );
                logger.info(`[PostToolUse] Recorded file change: ${operation} ${filePath}`);

                // Detect plan files and create/update plan entity + relation
                // Requires repoId and worktreeId for proper plan creation
                if (isPlanPath(filePath, context.workingDir)) {
                  // Require repoId and worktreeId for plan creation
                  if (!context.repoId || !context.worktreeId) {
                    logger.warn(`[PostToolUse] Cannot create plan: missing repoId or worktreeId`);
                  } else if (!context.threadId) {
                    logger.warn(`[PostToolUse] Cannot create relation: missing threadId`);
                  } else {
                    // Normalize to absolute path for conversion
                    const absolutePath = isAbsolute(filePath)
                      ? filePath
                      : resolve(context.workingDir, filePath);

                    // Parse phases from plan file content
                    let phaseInfo: PhaseInfo | null = null;
                    try {
                      const content = readFileSync(absolutePath, 'utf-8');
                      phaseInfo = parsePhases(content);
                      if (phaseInfo) {
                        logger.info(`[PostToolUse] 📋 Parsed phases: ${phaseInfo.completed}/${phaseInfo.total}`);
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
                      logger.info(`[PostToolUse] 📋 About to emit PLAN_DETECTED event: planId=${planId}`);
                      emitEvent(EventName.PLAN_DETECTED, { planId });
                      logger.info(`[PostToolUse] 📋 PLAN_DETECTED event emitted to stdout: ${filePath} -> ${planId}`);

                      // Write plan-thread relation directly to disk
                      // 'created' if this thread just created the plan, 'modified' otherwise
                      const relationType = isNew ? 'created' : 'modified';
                      try {
                        const relation = await persistence.createOrUpgradeRelation(
                          planId,
                          context.threadId,
                          relationType as 'created' | 'modified'
                        );
                        logger.info(`[PostToolUse] 📋 Created/upgraded relation: ${planId}-${context.threadId} (${relation.type})`);
                        // Emit relation event for UI refresh
                        emitEvent(EventName.RELATION_CREATED, {
                          planId,
                          threadId: context.threadId,
                          type: relation.type,
                        });
                      } catch (relErr) {
                        logger.warn(`[PostToolUse] Failed to create relation: ${relErr}`);
                      }

                      // Associate thread with plan by updating thread metadata
                      const threadMetadataPath = join(context.threadPath, "metadata.json");
                      try {
                        const threadMetadata = JSON.parse(readFileSync(threadMetadataPath, "utf-8"));
                        // Only associate if thread doesn't already have a plan
                        if (!threadMetadata.planId) {
                          threadMetadata.planId = planId;
                          threadMetadata.updatedAt = Date.now();
                          writeFileSync(threadMetadataPath, JSON.stringify(threadMetadata, null, 2));
                          // Emit thread:updated so frontend refreshes
                          emitEvent(EventName.THREAD_UPDATED, {
                            threadId: context.threadId,
                          });
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
            }

            // Side effect: notify strategy of file changes
            if (options.onFileChange) {
              options.onFileChange(input.tool_name);
            }

            // Handle Task tool completion: mark thread completed, add response to state.json
            // For background tasks (run_in_background: true), the tool result is an
            // async_launched marker — the task hasn't finished yet. Skip premature completion;
            // the real completion arrives via task_notification system messages.
            if (input.tool_name === "Task") {
              try {
                const toolUseId = input.tool_use_id;
                const childThreadId = toolUseIdToChildThreadId.get(toolUseId);

                if (!childThreadId) {
                  logger.warn(`[PostToolUse:Task] No child thread for toolUseId: ${toolUseId}`);
                  return { continue: true };
                }

                const taskResponse = typeof input.tool_response === "string"
                  ? JSON.parse(input.tool_response)
                  : input.tool_response;

                // Detect background tasks: the SDK returns an output_file path and
                // task_id when a task is launched in background, instead of the full result.
                const isBackground = !!(taskResponse.task_id || taskResponse.output_file);
                if (isBackground) {
                  logger.info(
                    `[PostToolUse:Task] Background task detected for ${childThreadId} — ` +
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

                  metadata.updatedAt = Date.now();
                  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                  logger.info(`[PostToolUse:Task] Updated metadata for thread ${childThreadId}`);
                }

                // === Append final response to state.json ===
                // The SDK returns the final response as the tool result, not as a separate
                // assistant message event. Append it so the child thread shows the complete conversation.
                if (taskResponse.content && Array.isArray(taskResponse.content)) {
                  interface ThreadState {
                    messages: Array<{ role: string; content: unknown }>;
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
                  });

                  state.status = "complete";
                  state.timestamp = Date.now();

                  writeFileSync(statePath, JSON.stringify(state, null, 2));
                  logger.info(`[PostToolUse:Task] Appended final response to state.json`);
                }

                // Emit subagent:completed drain event
                const subagentDurationMs = drainManager.endTimer(`subagent:${childThreadId}`);
                drainManager.emit(DrainEventName.SUBAGENT_COMPLETED, {
                  childThreadId,
                  agentType: childAgentType,
                  durationMs: subagentDurationMs,
                  resultLength: toolResponse.length,
                });

                // Emit THREAD_STATUS_CHANGED
                emitEvent(EventName.THREAD_STATUS_CHANGED, {
                  threadId: childThreadId,
                  status: "completed",
                });

                // Cleanup the map (foreground tasks only — bg tasks cleaned up by task_notification)
                toolUseIdToChildThreadId.delete(toolUseId);
                logger.info(`[PostToolUse:Task] Completed thread ${childThreadId}, cleaned up mapping`);

              } catch (err) {
                logger.warn(`[PostToolUse:Task] Failed to update child thread: ${err}`);
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
            });

            logger.debug(
              `[PostToolUseFailure] ${input.tool_name}: ${input.error}`
            );

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
  let prompt: string | AsyncGenerator<import("@anthropic-ai/claude-agent-sdk").SDKUserMessage>;
  if (options.messageStream) {
    // Create async iterable from the message stream for SDK consumption
    prompt = options.messageStream.createStream(config.prompt);
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
          // Side effect: relay embedded events
          relayEventsFromToolOutput(result);
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
          env: { ...process.env, CLAUDECODE: undefined },
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
          // The manager agent can spawn sub-agents via the Task tool
          agents: {
            "manager": {
              description: "Manager agent that coordinates complex multi-step tasks by delegating to specialized sub-agents. Use this when a task requires orchestrating multiple agents or when you need to break down a complex problem into sub-tasks.",
              prompt: "You are a manager agent that coordinates complex tasks. You can spawn specialized sub-agents using the Task tool to delegate work. Break down complex problems into focused sub-tasks and coordinate the results.",
              tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
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
  const handler = new MessageHandler(config.mortDir, accumulator, drainManager);

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
    });

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

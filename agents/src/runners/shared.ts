import {
  query,
  type PostToolUseHookInput,
  type PostToolUseFailureHookInput,
  type SDKUserMessage,
  type SubagentStartHookInput,
  type SubagentStopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { relative, isAbsolute, join, resolve } from "path";
import { readFileSync, writeFileSync, realpathSync, mkdirSync, existsSync } from "fs";
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
} from "../output.js";
import { NodePersistence } from "../lib/persistence-node.js";
import { EventName } from "@core/types/events.js";
import type { ToolExecutionState } from "@core/types/events.js";
import { MessageHandler } from "./message-handler.js";
import type { ThreadWriter } from "../services/thread-writer.js";
import {
  buildEnvironmentContext,
  buildGitContext,
  formatSystemPromptContext,
} from "../context.js";
import { logger } from "../lib/logger.js";
import { isMockModeEnabled, mockQuery } from "../testing/mock-query.js";
import { generateThreadName } from "../services/thread-naming-service.js";
import {
  createStdinMessageStream,
  type StdinMessageStream,
} from "./stdin-message-stream.js";

// ============================================================================
// Sub-agent Tracking
// ============================================================================

/**
 * In-memory mapping from SDK agent_id to child thread ID.
 * The SDK's agent_id equals the parent_tool_use_id on messages from that subagent.
 * Cleared on process exit.
 */
const agentIdToChildThreadId = new Map<string, string>();

/**
 * Get the child thread ID for a given agent_id (which equals parent_tool_use_id).
 * Used by MessageHandler to route sub-agent messages.
 */
export function getChildThreadId(agentId: string): string | undefined {
  return agentIdToChildThreadId.get(agentId);
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
 * Emit event to stdout as JSON line.
 * Used for lifecycle events like thread:created.
 */
export function emitEvent(
  name: string,
  payload: Record<string, unknown>
): void {
  const jsonLine = JSON.stringify({ type: "event", name, payload });
  logger.info(`[shared] 📤 emitEvent: name="${name}" payload=${JSON.stringify(payload)}`);
  logger.info(`[shared] 📤 stdout JSON: ${jsonLine}`);
  console.log(jsonLine);
}

/**
 * Build system prompt for agent by interpolating template variables
 * and appending runtime context (environment, git status, thread info).
 */
export function buildSystemPrompt(
  config: AgentConfig,
  context: {
    repoId?: string;
    threadId?: string;
    slug?: string;
    branchName?: string | null;
    cwd: string;
    mortDir: string;
    parentThreadId?: string;
  }
): string {
  // Interpolate template variables
  let prompt = config.appendedPrompt;
  prompt = prompt.replace(/\{\{repoId\}\}/g, context.repoId ?? "none");
  prompt = prompt.replace(/\{\{slug\}\}/g, context.slug ?? "none");
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
  prompt = prompt.replace(/\{\{mortDir\}\}/g, context.mortDir);
  prompt = prompt.replace(/\{\{threadId\}\}/g, context.threadId ?? "none");

  // Build runtime context
  const envContext = buildEnvironmentContext(context.cwd);
  const gitContext = buildGitContext(context.cwd);
  const threadContext = {
    repoId: context.repoId ?? null,
    parentThreadId: context.parentThreadId,
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
    logger.info(`[runner] AbortController present: ${!!abortController}`);

    if (abortController) {
      // Signal abort - let the main loop handle graceful exit
      logger.info(`[runner] Calling abortController.abort()...`);
      abortController.abort();
      logger.info(`[runner] abortController.abort() called, waiting for SDK to handle...`);
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

        logger.info(`[processPlanMentions] Created/found relation for ${relativePath}: ${relation.type}`);

        // Emit relation event
        emitEvent(EventName.RELATION_CREATED, {
          planId: plan.id,
          threadId: context.threadId,
          type: relation.type,
        });
      } else {
        logger.info(`[processPlanMentions] Plan not found for path: ${relativePath}`);
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
  /** Enable stdin message queue for queued user messages (simple agent only) */
  enableStdinQueue?: boolean;
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
  const { messages: priorMessages, sessionId: priorSessionId, toolStates: priorToolStates } = priorState;

  // Log prior state for debugging
  logger.info(`[runAgentLoop] Starting with ${priorMessages.length} prior messages`);
  if (priorSessionId) {
    logger.info(`[runAgentLoop] Resuming SDK session: ${priorSessionId}`);
  }
  if (priorToolStates) {
    logger.info(`[runAgentLoop] Preserving ${Object.keys(priorToolStates).length} prior tool states`);
  }
  if (priorMessages.length > 0) {
    logger.info(`[runAgentLoop] Prior message roles: ${priorMessages.map(m => m.role).join(", ")}`);
  }

  // Initialize state with prior messages (for UI), sessionId (for resume), and toolStates (for UI rendering)
  await initState(context.threadPath, context.workingDir, priorMessages, options.threadWriter, priorSessionId, priorToolStates);
  await appendUserMessage(config.prompt);

  // Persistence instance for plan detection and mention tracking
  const persistence = new NodePersistence(config.mortDir);

  // Process plan mentions in the initial prompt (e.g., @plans/my-feature.md)
  await processPlanMentions(config.prompt, persistence, context);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentConfig, {
    threadId: context.threadId,
    cwd: context.workingDir,
    mortDir: config.mortDir,
  });

  logger.info(
    `[runner] System prompt: ${systemPrompt.length} chars, cwd=${context.workingDir}`
  );

  // Tools that modify files and should be tracked for diffing
  const FILE_MODIFYING_TOOLS = ["Edit", "Write", "NotebookEdit"];

  // Build hooks for state tracking and side effects
  const hooks = {
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

            logger.debug(
              `[PostToolUseFailure] ${input.tool_name}: ${input.error}`
            );

            return { continue: true };
          },
        ],
      },
    ],
    SubagentStart: [
      {
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as SubagentStartHookInput;

            // Skip if we don't have required context for thread creation
            if (!context.repoId || !context.worktreeId) {
              logger.warn(`[SubagentStart] Cannot create sub-agent thread: missing repoId or worktreeId`);
              return { continue: true };
            }

            const childThreadId = crypto.randomUUID();
            const agentId = input.agent_id;
            const agentType = input.agent_type;

            // Create child thread directory and metadata
            const childThreadPath = join(config.mortDir, "threads", childThreadId);
            const now = Date.now();

            // Initial name is "{agentType}: <pending>" - will be renamed via thread-naming-service
            const initialName = `${agentType}: <pending>`;

            const childMetadata = {
              id: childThreadId,
              repoId: context.repoId,
              worktreeId: context.worktreeId,
              status: "running",
              turns: [{
                index: 0,
                prompt: `Sub-agent: ${agentType}`,
                startedAt: now,
                completedAt: null,
              }],
              isRead: true,
              name: initialName,
              createdAt: now,
              updatedAt: now,
              // Sub-agent specific fields
              parentThreadId: context.threadId,
              parentToolUseId: agentId, // agent_id is the tool_use_id of the Task tool
              agentType: agentType,
            };

            // Create thread directory and write metadata
            try {
              mkdirSync(childThreadPath, { recursive: true });
              writeFileSync(
                join(childThreadPath, "metadata.json"),
                JSON.stringify(childMetadata, null, 2)
              );
              logger.info(`[SubagentStart] Created sub-agent thread: ${childThreadId} (parent: ${context.threadId})`);

              // Store mapping for message routing (agent_id -> childThreadId)
              agentIdToChildThreadId.set(agentId, childThreadId);

              // Emit THREAD_CREATED event
              emitEvent(EventName.THREAD_CREATED, {
                threadId: childThreadId,
                repoId: context.repoId,
                worktreeId: context.worktreeId,
              });

              // Fire-and-forget: Request name via thread-naming-service
              // The initial prompt is the agent type, but we use a descriptive prompt
              const apiKey = process.env.ANTHROPIC_API_KEY;
              if (apiKey) {
                generateThreadName(`Sub-agent task: ${agentType}`, apiKey)
                  .then((generatedName) => {
                    // Update metadata with generated name
                    try {
                      const metadataPath = join(childThreadPath, "metadata.json");
                      if (existsSync(metadataPath)) {
                        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                        metadata.name = generatedName;
                        metadata.updatedAt = Date.now();
                        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                        // Emit name generated event
                        emitEvent(EventName.THREAD_NAME_GENERATED, {
                          threadId: childThreadId,
                          name: generatedName,
                        });
                        logger.info(`[SubagentStart] Generated name for sub-agent: ${generatedName}`);
                      }
                    } catch (err) {
                      logger.warn(`[SubagentStart] Failed to update name: ${err}`);
                    }
                  })
                  .catch((err) => {
                    logger.warn(`[SubagentStart] Failed to generate name: ${err}`);
                  });
              }
            } catch (err) {
              logger.error(`[SubagentStart] Failed to create sub-agent thread: ${err}`);
            }

            return { continue: true };
          },
        ],
      },
    ],
    SubagentStop: [
      {
        hooks: [
          async (hookInput: unknown) => {
            const input = hookInput as SubagentStopHookInput;
            const agentId = input.agent_id;

            const childThreadId = agentIdToChildThreadId.get(agentId);
            if (childThreadId) {
              // Update child thread status to idle (completed)
              const metadataPath = join(config.mortDir, "threads", childThreadId, "metadata.json");
              try {
                if (existsSync(metadataPath)) {
                  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
                  metadata.status = "completed";
                  metadata.updatedAt = Date.now();
                  // Mark the turn as completed
                  if (metadata.turns && metadata.turns.length > 0) {
                    metadata.turns[metadata.turns.length - 1].completedAt = Date.now();
                  }
                  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
                  logger.info(`[SubagentStop] Marked sub-agent thread as completed: ${childThreadId}`);

                  // Emit THREAD_STATUS_CHANGED event
                  emitEvent(EventName.THREAD_STATUS_CHANGED, {
                    threadId: childThreadId,
                    status: "completed",
                  });
                }
              } catch (err) {
                logger.warn(`[SubagentStop] Failed to update sub-agent status: ${err}`);
              }

              // Clean up mapping
              agentIdToChildThreadId.delete(agentId);
            } else {
              logger.warn(`[SubagentStop] No mapping found for agent_id: ${agentId}`);
            }

            return { continue: true };
          },
        ],
      },
    ],
    ...(options.stopHook && {
      Stop: [{ hooks: [options.stopHook] }],
    }),
  };

  // Check for mock mode
  const useMockMode = isMockModeEnabled();
  if (useMockMode) {
    logger.info("[runner] Mock LLM mode enabled");
  }

  // Determine prompt: stdin stream for simple agent, string for task-based
  // Use provided abortController or create one for stdin stream cleanup
  const abortController = options.abortController ?? new AbortController();
  let prompt: string | AsyncGenerator<SDKUserMessage>;
  let streamController: StdinMessageStream | null = null;

  if (options.enableStdinQueue && !useMockMode) {
    // Simple agent with stdin queue enabled
    const stdinStream = createStdinMessageStream(config.prompt, abortController.signal);
    prompt = stdinStream.stream;
    streamController = stdinStream.controller;
    logger.info("[runAgentLoop] Stdin message queue enabled");
  } else {
    // Task-based agent or mock mode - use simple string prompt
    prompt = config.prompt;
  }

  // Run the agent (real or mock)
  // Note: Mock mode does NOT support stdin queue - it uses scripted responses.
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
          cwd: context.workingDir,
          additionalDirectories: [config.mortDir],
          model: agentConfig.model ?? "claude-opus-4-5-20251101",
          systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: systemPrompt,
          },
          tools: agentConfig.tools,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          includePartialMessages: false,
          // Resume from prior SDK session if available (enables conversation continuity)
          ...(priorSessionId && { resume: priorSessionId }),
          abortController,
          hooks,
        },
      });

  // Process messages with dedicated handler
  // Pass mortDir for sub-agent message routing
  const handler = new MessageHandler(config.mortDir);

  try {
    for await (const message of result) {
      // Capture session_id from init message for stdin streaming
      if (
        streamController &&
        message.type === "system" &&
        "subtype" in message &&
        message.subtype === "init" &&
        "session_id" in message
      ) {
        streamController.setSessionId(message.session_id as string);
        logger.debug(`[runAgentLoop] SDK session_id: ${message.session_id}`);
      }

      logger.debug(`[runner] Message: type=${message.type}`);
      const shouldContinue = await handler.handle(message);
      if (!shouldContinue) break;
    }
  } finally {
    // Clean up stdin stream if used
    streamController?.close();
  }
}

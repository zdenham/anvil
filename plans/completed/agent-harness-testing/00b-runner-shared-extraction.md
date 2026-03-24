# Phase 0b: Extract Shared Runner Code

## Overview

Extract common code shared between `runner.ts` and `simple-runner.ts` into a reusable module at `agents/src/runners/shared.ts`. This enables the strategy pattern by providing a common agent loop that both `TaskRunnerStrategy` and `SimpleRunnerStrategy` can use.

## Dependencies

- `00a-runner-types.md` (types must exist first)

## Parallel With

- Nothing (blocks 00c and 00d)

## Analysis: Shared Code Between Runners

Based on examining both `runner.ts` (550 lines) and `simple-runner.ts` (305 lines), the following code is shared:

### Definitely Shared (~70% of agent loop logic)

1. **Agent loop** - `query()` call, async iteration over messages, tool call handling
2. **Message handling** - `appendUserMessage()`, `appendAssistantMessage()`, `markToolRunning()`
3. **Tool hooks** - `PostToolUse` and `PostToolUseFailure` hook setup with `appendToolResult()`
4. **State emission** - Already extracted to `output.ts` (`emitState()`, `initState()`, etc.)
5. **System prompt construction** - Template interpolation (`{{taskId}}`, `{{threadId}}`, etc.) and runtime context building
6. **Signal handling** - SIGTERM/SIGINT cleanup (currently only in `runner.ts` via `setupCleanup()`)
7. **Metadata updates** - Updating thread status, timestamps, turn completion

### Strategy-Specific (NOT extracted)

1. **Orchestration setup** - Task-based uses `orchestrate()`, simple uses direct directory setup
2. **Worktree allocation** - Only task-based (via `WorktreeAllocationService`)
3. **Thread creation** - Task-based uses `ThreadService`, simple writes files directly
4. **File change tracking** - Task-based uses git diff from merge-base, simple does not track
5. **Validation hooks** - Only task-based has `Stop` hook with validators
6. **Task metadata** - Simple creates task-level metadata, task-based relies on existing tasks

## Files to Create

### `agents/src/runners/shared.ts`

```typescript
import {
  query,
  type PostToolUseHookInput,
  type PostToolUseFailureHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { RunnerConfig, OrchestrationContext } from "./types";
import type { AgentConfig } from "../agent-types/index";
import {
  initState,
  appendUserMessage,
  appendAssistantMessage,
  appendToolResult,
  complete,
  error,
  markToolRunning,
  relayEventsFromToolOutput,
} from "../output";
import {
  buildEnvironmentContext,
  buildGitContext,
  formatSystemPromptContext,
} from "../context";
import { logger } from "../lib/logger";

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
  console.log(JSON.stringify({ type: "event", name, payload }));
}

/**
 * Build system prompt for agent by interpolating template variables
 * and appending runtime context (environment, git status, task info).
 */
export function buildSystemPrompt(
  config: AgentConfig,
  context: {
    taskId?: string;
    threadId?: string;
    slug?: string;
    branchName?: string;
    cwd: string;
    anvilDir: string;
    parentTaskId?: string;
  }
): string {
  // Interpolate template variables
  let prompt = config.appendedPrompt;
  prompt = prompt.replace(/\{\{taskId\}\}/g, context.taskId ?? "none");
  prompt = prompt.replace(/\{\{slug\}\}/g, context.slug ?? "none");
  prompt = prompt.replace(/\{\{branchName\}\}/g, context.branchName ?? "none");
  prompt = prompt.replace(/\{\{anvilDir\}\}/g, context.anvilDir);
  prompt = prompt.replace(/\{\{threadId\}\}/g, context.threadId ?? "none");

  // Build runtime context
  const envContext = buildEnvironmentContext(context.cwd);
  const gitContext = buildGitContext(context.cwd);
  const taskContext = {
    taskId: context.taskId ?? null,
    parentTaskId: context.parentTaskId,
  };
  const runtimeContext = formatSystemPromptContext(
    envContext,
    gitContext,
    taskContext
  );

  return `${prompt}\n\n${runtimeContext}`;
}

/**
 * Set up signal handlers for graceful shutdown.
 * Invokes cleanup function on SIGTERM and SIGINT.
 */
export function setupSignalHandlers(cleanup: () => Promise<void>): void {
  const handler = async (signal: string) => {
    logger.info(`[runner] Received ${signal}, cleaning up...`);
    await cleanup();
    process.exit(0);
  };

  process.on("SIGTERM", () => handler("SIGTERM"));
  process.on("SIGINT", () => handler("SIGINT"));
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
  threadWriter?: unknown;
}

/**
 * Main agent loop - shared between all agent types.
 * Handles LLM queries, tool calls, state updates.
 *
 * @param config - Runner configuration from CLI args
 * @param context - Orchestration context with working directory and task info
 * @param agentConfig - Agent-specific configuration (model, tools, prompts)
 * @param priorMessages - Prior messages for multi-turn context
 * @param options - Optional hooks for strategy-specific behavior
 */
export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,
  agentConfig: AgentConfig,
  priorMessages: MessageParam[] = [],
  options: AgentLoopOptions = {}
): Promise<void> {
  // Initialize state
  initState(context.threadPath, context.workingDir, priorMessages, options.threadWriter);
  appendUserMessage(config.prompt);

  // Build system prompt
  const systemPrompt = buildSystemPrompt(agentConfig, {
    taskId: context.task?.id,
    threadId: context.threadId,
    slug: context.task?.slug,
    branchName: context.task?.branch,
    cwd: context.workingDir,
    anvilDir: config.anvilDir,
  });

  logger.info(
    `[runner] System prompt: ${systemPrompt.length} chars, cwd=${context.workingDir}`
  );

  // Build hooks
  const hooks = {
    PostToolUse: [
      {
        hooks: [
          async (hookInput: unknown, toolUseID?: string) => {
            const input = hookInput as PostToolUseHookInput;

            logger.debug(
              `[PostToolUse] tool_name=${input.tool_name}, tool_use_id=${toolUseID}`
            );

            const toolResponse =
              typeof input.tool_response === "string"
                ? input.tool_response
                : JSON.stringify(input.tool_response);

            relayEventsFromToolOutput(toolResponse);
            appendToolResult(toolUseID ?? "unknown", toolResponse);

            // Strategy-specific file change handling
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
          async (hookInput: unknown, toolUseID?: string) => {
            const input = hookInput as PostToolUseFailureHookInput;

            logger.debug(
              `[PostToolUseFailure] tool_name=${input.tool_name}, error=${input.error}`
            );

            appendToolResult(toolUseID ?? "unknown", input.error, true);
            return { continue: true };
          },
        ],
      },
    ],
    ...(options.stopHook && {
      Stop: [{ hooks: [options.stopHook] }],
    }),
  };

  // Run the agent
  const result = query({
    prompt: config.prompt,
    options: {
      cwd: context.workingDir,
      additionalDirectories: [config.anvilDir],
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
      ...(priorMessages.length > 0 && { messages: priorMessages }),
      hooks,
    },
  });

  // Process messages
  for await (const message of result) {
    logger.debug(`[runner] Message: type=${message.type}`);

    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          markToolRunning(block.id);
        }
      }
      appendAssistantMessage({
        role: "assistant",
        content: message.message.content,
      });
    } else if (message.type === "result" && message.subtype === "success") {
      complete({
        durationApiMs: message.duration_ms,
        totalCostUsd: message.total_cost_usd,
        numTurns: message.num_turns,
      });
    }
  }
}
```

### `agents/src/runners/index.ts`

```typescript
export * from "./types";
export * from "./shared";
```

## Extraction Steps

1. **Create `agents/src/runners/` directory** if it does not exist

2. **Create `shared.ts`** with the functions above, extracting from:
   - `emitState()` pattern from `output.ts` (already extracted, just re-export pattern)
   - `buildAppendedPrompt()` from `runner.ts` lines 90-119
   - Signal handling from `orchestration.ts` `setupCleanup()`
   - Main agent loop from `runner.ts` lines 324-523

3. **Add `AgentLoopOptions`** interface to allow strategies to inject:
   - File change tracking (task-based only)
   - Validation stop hooks (task-based only)
   - ThreadWriter for resilient writes

4. **Update imports** in existing files temporarily (will be replaced in 00e)

5. **Run type checks** to verify compilation: `pnpm --filter agents tsc --noEmit`

## Testing Strategy

Since this is an extraction refactor, verify by:

1. **Compile check**: `pnpm --filter agents tsc --noEmit`
2. **Manual test**: Run existing runner with task-based agent, verify identical stdout output
3. **Diff output**: Capture stdout before/after extraction, compare for identical protocol messages

## Acceptance Criteria

- [ ] `agents/src/runners/shared.ts` compiles without errors
- [ ] `agents/src/runners/index.ts` exports all types and functions
- [ ] `emitLog()`, `emitEvent()`, `buildSystemPrompt()`, `setupSignalHandlers()`, `runAgentLoop()` are exported
- [ ] `AgentLoopOptions` interface allows strategy-specific hooks
- [ ] No circular dependencies (shared.ts depends on output.ts and context.ts, not runner.ts)
- [ ] Existing `runner.ts` behavior unchanged (manual verification)

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing runner behavior | Keep existing runner.ts unchanged until 00e; shared.ts is additive |
| Circular dependencies | shared.ts only imports from leaf modules (output.ts, context.ts, types.ts) |
| Hook type complexity | Use `unknown` with type assertions for hook inputs until SDK types stabilize |

## Estimated Effort

Medium (~2-3 hours)
- 1 hour: Create shared.ts with extracted functions
- 30 min: Set up AgentLoopOptions for strategy hooks
- 30 min: Type checking and fixing any issues
- 30 min: Manual verification of existing behavior

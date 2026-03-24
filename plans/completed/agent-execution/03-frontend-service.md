# Frontend Service

React hooks and service layer for spawning agents and streaming their output.

## Entity Integration

All state is managed through entity services. The frontend:
1. Creates conversations via `conversationService.create()` before spawning agents
2. Updates conversation status via `conversationService.update()` after completion
3. Reads state from entity stores (`useConversationStore`, `useTaskStore`)

**Entity imports:**
```typescript
import { conversationService, useConversationStore } from "@/entities";
import { taskService, useTaskStore } from "@/entities";
import { settingsService, useSettingsStore } from "@/entities";
import type { ConversationMetadata, CreateConversationInput } from "@/entities/conversations/types";
```

## Type Strategy

**Entity types from `src/entities/`:**
- `ConversationMetadata`, `ConversationTurn`, `ConversationStatus`
- `TaskMetadata`, `TaskStatus`
- `WorkspaceSettings`

**SDK types from `@anthropic-ai/sdk`:**
```typescript
import type { ContentBlock, TextBlock, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
```

Only use app-specific types (from `src/lib/types/agent-messages.ts`) for streaming message concepts not in the SDK or entities.

## Files Owned

- `src/lib/agent-service.ts` - Core spawn function
- `src/hooks/use-agent-execution.ts` - Real-time execution hook (uses entity services)
- `src/hooks/use-conversation-messages.ts` - Message stream hook (for display)

## Dependencies

Requires Tauri integration (02-tauri-integration.md) to be complete for runtime, but code can be written in parallel.

**Entity dependencies (already exist):**
- `src/entities/conversations/` - Conversation state management
- `src/entities/tasks/` - Task state management
- `src/entities/settings/` - Settings (API key)

**Tauri plugin dependencies in `package.json`:**
- `@tauri-apps/plugin-shell` - spawn processes
- `@tauri-apps/plugin-fs` - file operations (for reading messages.jsonl)
- `@tauri-apps/api` - path utilities (join, resolveResource)

## Implementation

### 1. Create agent-service.ts

```typescript
import { Command } from "@tauri-apps/plugin-shell";
import { join, resolveResource } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";
import { conversationService, settingsService } from "@/entities";
import { logger } from "./logger-client";
import type { AgentMessage } from "@/lib/types/agent-messages";
import type { ConversationMetadata } from "@/entities/conversations/types";

export interface StartAgentOptions {
  agentType: string;
  workingDirectory: string;
  prompt: string;
  taskId: string;
}

export interface AgentStreamCallbacks {
  onMessage: (message: AgentMessage) => void;
  onComplete: (exitCode: number, costUsd?: number) => void;
  onError: (error: string) => void;
}

/**
 * Starts an agent execution for a task.
 *
 * Flow:
 * 1. Creates conversation entity via conversationService.create()
 * 2. Creates conversation directory for message streams
 * 3. Spawns agent runner process
 * 4. Streams messages via callbacks
 * 5. Updates conversation entity on completion via conversationService.update()
 *
 * @returns The created conversation metadata
 */
export async function startAgent(
  options: StartAgentOptions,
  callbacks: AgentStreamCallbacks
): Promise<ConversationMetadata> {
  const settings = settingsService.get();

  if (!settings.anthropicApiKey) {
    throw new Error("Anthropic API key not configured");
  }

  // 1. Create conversation entity FIRST (disk always wins)
  const conversation = await conversationService.create({
    taskId: options.taskId,
    agentType: options.agentType,
    workingDirectory: options.workingDirectory,
    prompt: options.prompt,
  });

  // 2. Create directory for message streams
  const conversationPath = await join(
    options.workingDirectory,
    ".anvil",
    "conversations",
    conversation.id
  );
  await mkdir(conversationPath, { recursive: true });

  // 3. Mark conversation as running
  await conversationService.markRunning(conversation.id);

  // Resolve the runner.js path relative to the app bundle
  const runnerPath = await resolveResource("agents/dist/runner.js");

  // 4. Spawn the agent process
  const command = Command.create(
    "node",
    [
      runnerPath,
      "--agent",
      options.agentType,
      "--cwd",
      options.workingDirectory,
      "--prompt",
      options.prompt,
      "--conversation-id",
      conversation.id,
      "--conversation-path",
      conversationPath,
    ],
    {
      cwd: options.workingDirectory,
      env: {
        ANTHROPIC_API_KEY: settings.anthropicApiKey,
      },
    }
  );

  // Line buffer for stdout - shell plugin may split JSON across chunks
  let stdoutBuffer = "";
  let lastCostUsd: number | undefined;

  command.stdout.on("data", (chunk: string) => {
    stdoutBuffer += chunk;

    // Process complete lines (JSONL format)
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line) as AgentMessage;
        // Extract cost from result_metrics messages
        if (message.type === "result_metrics" && "totalCostUsd" in message) {
          lastCostUsd = message.totalCostUsd as number;
        }
        callbacks.onMessage(message);
      } catch {
        logger.debug(`[agent:${conversation.id}] ${line}`);
      }
    }
  });

  command.stderr.on("data", (line: string) => {
    logger.error(`[agent:${conversation.id}] stderr: ${line}`);
    callbacks.onError(line);
  });

  command.on("close", async (data) => {
    // 5. Update conversation entity based on exit code
    if (data.code === 0) {
      await conversationService.completeTurn(conversation.id, data.code, lastCostUsd);
      await conversationService.markCompleted(conversation.id);
    } else {
      await conversationService.completeTurn(conversation.id, data.code);
      await conversationService.markError(conversation.id);
    }
    callbacks.onComplete(data.code, lastCostUsd);
  });

  try {
    await command.spawn();
  } catch (error) {
    // Update entity on spawn failure
    await conversationService.markError(conversation.id);
    throw new Error(
      `Failed to spawn agent: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  return conversation;
}
```

### 2. Create use-agent-execution.ts

```typescript
import { useState, useCallback, useRef } from "react";
import { startAgent, type StartAgentOptions } from "@/lib/agent-service";
import { useConversationStore } from "@/entities";
import type { AgentMessage } from "@/lib/types/agent-messages";
import type { ConversationMetadata } from "@/entities/conversations/types";

/**
 * Local state for real-time message streaming.
 * Entity state (conversation metadata) is read from useConversationStore.
 */
export interface AgentExecutionState {
  conversationId: string | null;
  messages: AgentMessage[];  // Transient: only for real-time display
  error: string | null;
}

export interface UseAgentExecutionResult {
  /** Local streaming state */
  state: AgentExecutionState;
  /** The conversation entity (from store) */
  conversation: ConversationMetadata | undefined;
  /** Start agent execution for a task */
  start: (options: StartAgentOptions) => Promise<ConversationMetadata>;
  /** Reset local state (conversation entity persists) */
  reset: () => void;
}

/**
 * Hook to execute an agent and stream messages in real-time.
 *
 * State strategy:
 * - Entity state (ConversationMetadata) is managed by conversationService and
 *   read from useConversationStore. This persists across app restarts.
 * - Message array is transient local state for real-time display during execution.
 *   For viewing past conversations, use useConversationMessages hook to read from disk.
 */
export function useAgentExecution(): UseAgentExecutionResult {
  const [state, setState] = useState<AgentExecutionState>({
    conversationId: null,
    messages: [],
    error: null,
  });

  const messagesRef = useRef<AgentMessage[]>([]);

  // Read conversation from entity store (reactive)
  const conversation = useConversationStore((s) =>
    state.conversationId ? s.conversations[state.conversationId] : undefined
  );

  const start = useCallback(
    async (options: StartAgentOptions): Promise<ConversationMetadata> => {
      messagesRef.current = [];
      setState({
        conversationId: null,
        messages: [],
        error: null,
      });

      // startAgent creates conversation entity, spawns runner, and updates entity on completion
      const conv = await startAgent(options, {
        onMessage: (message) => {
          messagesRef.current = [...messagesRef.current, message];
          setState((prev) => ({
            ...prev,
            messages: messagesRef.current,
          }));
        },
        onComplete: (_exitCode, _costUsd) => {
          // Entity already updated by startAgent callback
          // No local state update needed - useConversationStore will re-render
        },
        onError: (error) => {
          setState((prev) => ({
            ...prev,
            error,
          }));
        },
      });

      setState((prev) => ({
        ...prev,
        conversationId: conv.id,
      }));

      return conv;
    },
    []
  );

  const reset = useCallback(() => {
    messagesRef.current = [];
    setState({
      conversationId: null,
      messages: [],
      error: null,
    });
  }, []);

  return { state, conversation, start, reset };
}
```

### 3. Create use-conversation-messages.ts

```typescript
import { useState, useEffect } from "react";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { conversationService, useConversationStore } from "@/entities";
import type { AgentMessage } from "@/lib/types/agent-messages";
import type { ConversationMetadata } from "@/entities/conversations/types";

export interface ConversationMessagesState {
  messages: AgentMessage[];
  status: "loading" | "loaded" | "error" | "not_found";
  error?: string;
}

/**
 * Hook to read conversation messages from disk.
 *
 * Use this for:
 * - Viewing completed conversations
 * - Crash recovery (messages persisted but not in memory)
 * - Multi-window scenarios
 *
 * For real-time streaming during execution, use useAgentExecution instead.
 */
export function useConversationMessages(
  conversationId: string | null
): ConversationMessagesState & { conversation: ConversationMetadata | undefined } {
  const [state, setState] = useState<ConversationMessagesState>({
    messages: [],
    status: "loading",
  });

  // Get conversation entity from store
  const conversation = useConversationStore((s) =>
    conversationId ? s.conversations[conversationId] : undefined
  );

  useEffect(() => {
    if (!conversationId || !conversation) {
      setState({ messages: [], status: "not_found" });
      return;
    }

    let cancelled = false;

    async function loadMessages() {
      try {
        // Build path to messages.jsonl based on conversation's working directory
        const messagesPath = await join(
          conversation!.workingDirectory,
          ".anvil",
          "conversations",
          conversationId!,
          "messages.jsonl"
        );

        if (!(await exists(messagesPath))) {
          if (!cancelled) {
            setState({ messages: [], status: "not_found" });
          }
          return;
        }

        const content = await readTextFile(messagesPath);
        const messages = content
          .trim()
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => JSON.parse(line) as AgentMessage);

        if (!cancelled) {
          setState({ messages, status: "loaded" });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            messages: [],
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    loadMessages();

    return () => {
      cancelled = true;
    };
  }, [conversationId, conversation?.workingDirectory]);

  return { ...state, conversation };
}
```

## Usage Example

```typescript
import { useAgentExecution } from "@/hooks/use-agent-execution";
import { useConversationMessages } from "@/hooks/use-conversation-messages";
import { useTaskStore } from "@/entities";

function TaskRunner({ taskId }: { taskId: string }) {
  const { state, conversation, start, reset } = useAgentExecution();
  const task = useTaskStore((s) => s.tasks[taskId]);

  const handleStart = async () => {
    await start({
      agentType: "simplifier",
      workingDirectory: "/path/to/repo",
      prompt: "Simplify the auth module",
      taskId,
    });
  };

  return (
    <div>
      <button
        onClick={handleStart}
        disabled={conversation?.status === "running"}
      >
        Start Agent
      </button>
      {/* Status from entity (persisted) */}
      <div>Status: {conversation?.status ?? "idle"}</div>
      {/* Messages from real-time stream (transient) */}
      {state.messages.map((msg, i) => (
        <div key={i}>{JSON.stringify(msg)}</div>
      ))}
    </div>
  );
}

// Viewing a past conversation (loads messages from disk)
function ConversationViewer({ conversationId }: { conversationId: string }) {
  const { messages, conversation, status } = useConversationMessages(conversationId);

  if (status === "loading") return <div>Loading...</div>;
  if (status === "not_found") return <div>Conversation not found</div>;

  return (
    <div>
      <div>Agent: {conversation?.agentType}</div>
      <div>Status: {conversation?.status}</div>
      {messages.map((msg, i) => (
        <div key={i}>{JSON.stringify(msg)}</div>
      ))}
    </div>
  );
}
```

## Testing

1. Ensure Tauri integration is complete
2. Ensure entities are hydrated on app startup (`hydrateEntities()`)
3. Import `useAgentExecution` in a test component
4. Verify messages stream in real-time
5. Verify conversation entity is created in store before agent runs
6. Verify entity status updates to "completed" or "error" on completion
7. Kill the app mid-run, reload, and use `useConversationMessages` to recover messages from disk

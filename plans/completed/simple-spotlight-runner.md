# Simple Spotlight Task Runner

## Overview

A simplified version of the spotlight task runner that:

1. Operates on the main worktree (no branching or worktree allocation)
2. Uses a single agent type with Claude Code defaults
3. Provides a minimal UI showing only the conversation thread with response capability

## Goals

- Reduce complexity by removing orchestration layer (worktree allocation, branch management)
- Provide a simpler entry point for quick tasks that don't need isolation
- Create a focused UI for conversational interaction with the agent

## Architecture

### Current Flow (Full Spotlight)

```
Spotlight → createDraft() → openTask() → spawnAgentWithOrchestration()
                                              ↓
                                        orchestrate()
                                              ↓
                                    allocateWorktree()
                                    createBranch()
                                    createThread()
                                              ↓
                                        query() loop
```

### Proposed Flow (Simple Runner)

```
Spotlight → createDraft() → openSimpleTask() → spawnSimpleAgent()
                                                    ↓
                                              createThread()
                                                    ↓
                                              query() loop
                                        (runs in source repo directly)
```

## Implementation Plan

### Step 1: Create Simple Agent Spawner

**File:** `src/lib/simple-agent-service.ts`

Create a simplified agent spawn function that:
- Skips worktree allocation entirely
- Uses the repository's source path directly as `cwd`
- Uses a generic agent type with Claude Code defaults
- Stores task data in `~/.mort/simple-tasks/` (separate from full tasks)

```typescript
import { Command } from "@tauri-apps/plugin-shell";
import { FilesystemClient } from "./filesystem-client";
import { logger } from "./logger-client";

const fs = new FilesystemClient();

export interface SpawnSimpleAgentOptions {
  taskId: string;
  threadId: string;
  prompt: string;
  /** Repository source path - agent runs here directly */
  sourcePath: string;
}

export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  // Get mortDir via FilesystemClient (uses Tauri invoke internally)
  const mortDir = await fs.getDataDir();

  // Build command args for simple runner
  // Note: uses simple-runner.js, NOT runner.js
  const commandArgs = [
    simpleRunnerPath,  // agents/dist/simple-runner.js
    "--task-id", options.taskId,
    "--thread-id", options.threadId,
    "--cwd", options.sourcePath,  // Direct path, no worktree allocation
    "--prompt", options.prompt,
    "--mort-dir", mortDir,
  ];
  // ... spawn command via Tauri Command.create() - see agent-service.ts pattern
}

export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
): Promise<void> {
  // Get paths via FilesystemClient
  const mortDir = await fs.getDataDir();
  const threadFolderName = `simple-${threadId}`;
  const stateFilePath = fs.joinPath(mortDir, "simple-tasks", taskId, "threads", threadFolderName, "state.json");

  // Resume with new prompt - passes --history-file for prior messages
  const commandArgs = [
    simpleRunnerPath,
    "--task-id", taskId,
    "--thread-id", threadId,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
  ];
  // ... spawn command via Tauri
}
```

**Note:** Simple task metadata is created by the simple-runner (Node process), not the frontend. The frontend only spawns the runner and reacts to events. This follows the "Agent Process Architecture" principle from AGENTS.md.

### Step 2: Create Simple Agent Type

**File:** `agents/src/agent-types/simple.ts`

Define a minimal agent configuration that uses Claude Code defaults with no specialized prompts:

```typescript
import type { AgentConfig } from "./index.js";

export const simple: AgentConfig = {
  name: "simple",
  description: "Simple Claude Code agent - runs directly in repository",
  model: "claude-sonnet-4-20250514",  // Faster model for quick tasks
  tools: { type: "preset", preset: "claude_code" },
  appendedPrompt: `## Context

You are helping the user with a task in their codebase.

- Task ID: {{taskId}}
- Thread ID: {{threadId}}

Work directly in the current repository. Make changes as requested.
Request human review when you need input or approval.`,
};
```

**File:** `src/entities/threads/types.ts`

Update AgentType to include "simple":

```typescript
export type AgentType = "entrypoint" | "execution" | "review" | "merge" | "research" | "simple";
```

### Step 3: Create Simple Runner Entry Point

**File:** `agents/src/simple-runner.ts`

A simplified runner that:
- Accepts `--cwd` directly (no orchestration)
- Creates thread metadata and state on disk (using existing patterns)
- Runs the agent with Claude Code preset
- Emits state updates via existing `output.ts` functions

Key differences from `runner.ts`:
- No `orchestrate()` call
- No worktree allocation/release
- No branch tracking or merge base
- No file change diff tracking (since no merge base)
- Uses same metadata.json + state.json structure as full runner

**File structure:** Split into modules to stay under 250 lines per AGENTS.md:
- `agents/src/simple-runner.ts` - Entry point and main loop (~150 lines)
- `agents/src/simple-runner-args.ts` - Argument parsing (~50 lines)

```typescript
// agents/src/simple-runner.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { getAgentConfig } from "./agent-types/index.js";
import { buildAppendedPrompt } from "./context.js";
import {
  initState,
  appendUserMessage,
  appendAssistantMessage,
  appendToolResult,
  complete,
  error,
  markToolRunning,
} from "./output.js";  // Reuse existing output.ts for state emission
import { logger, stdout } from "./lib/logger.js";
import { parseSimpleArgs } from "./simple-runner-args.js";

async function main() {
  const args = parseSimpleArgs(process.argv.slice(2));
  const agentConfig = getAgentConfig("simple");
  const startTime = Date.now();

  // Simple tasks use: ~/.mort/simple-tasks/{taskId}/threads/{agentType}-{threadId}/
  const taskDir = join(args.mortDir, "simple-tasks", args.taskId);
  const threadFolderName = `simple-${args.threadId}`;
  const threadPath = join(taskDir, "threads", threadFolderName);

  // Ensure directories exist
  mkdirSync(threadPath, { recursive: true });

  // Create task-level metadata if this is a new task (not resume)
  const taskMetadataPath = join(taskDir, "metadata.json");
  if (!existsSync(taskMetadataPath)) {
    const taskMetadata = {
      id: args.taskId,
      type: "simple",
      prompt: args.prompt,
      sourcePath: args.cwd,
      status: "running",
      createdAt: startTime,
      updatedAt: startTime,
    };
    writeFileSync(taskMetadataPath, JSON.stringify(taskMetadata, null, 2));
  }

  const metadataPath = join(threadPath, "metadata.json");
  let turnIndex = 0;
  let priorMessages: MessageParam[] = [];

  if (args.historyFile && existsSync(args.historyFile)) {
    // Resume: load prior messages from state.json
    const stateContent = readFileSync(args.historyFile, "utf-8");
    const priorState = JSON.parse(stateContent);
    priorMessages = priorState.messages;

    // Read existing metadata, add new turn
    const existingMetadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    turnIndex = existingMetadata.turns.length;
    existingMetadata.status = "running";
    existingMetadata.updatedAt = startTime;
    existingMetadata.turns.push({
      index: turnIndex,
      prompt: args.prompt,
      startedAt: startTime,
      completedAt: null,
    });
    writeFileSync(metadataPath, JSON.stringify(existingMetadata, null, 2));
  } else {
    // New thread: create metadata.json
    const metadata = {
      id: args.threadId,
      taskId: args.taskId,
      agentType: "simple",
      workingDirectory: args.cwd,
      status: "running",
      createdAt: startTime,
      updatedAt: startTime,
      turns: [{
        index: 0,
        prompt: args.prompt,
        startedAt: startTime,
        completedAt: null,
      }],
    };
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    // Emit thread:created event via stdout protocol
    stdout({ type: "event", name: "thread:created", payload: { threadId: args.threadId, taskId: args.taskId, thread: metadata } });
  }

  // Initialize state using existing output.ts (creates state.json, emits via stdout)
  initState(threadPath, args.cwd, priorMessages);
  appendUserMessage(args.prompt);

  // Build appended prompt with template interpolation
  const appendedPrompt = buildAppendedPrompt(agentConfig, {
    taskId: args.taskId,
    threadId: args.threadId,
    cwd: args.cwd,
    mortDir: args.mortDir,
  });

  try {
    const result = query({
      prompt: args.prompt,
      options: {
        cwd: args.cwd,
        model: agentConfig.model ?? "claude-sonnet-4-20250514",
        systemPrompt: { type: "preset", preset: "claude_code", append: appendedPrompt },
        tools: agentConfig.tools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        ...(priorMessages.length > 0 && { messages: priorMessages }),
        hooks: {
          PostToolUse: [{ hooks: [async (input, toolUseId) => {
            const toolResponse = typeof input.tool_response === "string"
              ? input.tool_response
              : JSON.stringify(input.tool_response);
            appendToolResult(toolUseId ?? "unknown", toolResponse);
            return { continue: true };
          }] }],
        },
      },
    });

    for await (const message of result) {
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") {
            markToolRunning(block.id);
          }
        }
        appendAssistantMessage({ role: "assistant", content: message.message.content });
      } else if (message.type === "result" && message.subtype === "success") {
        // Update metadata on completion
        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
        metadata.status = "completed";
        metadata.updatedAt = Date.now();
        if (metadata.turns[turnIndex]) {
          metadata.turns[turnIndex].completedAt = Date.now();
        }
        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

        complete({
          durationApiMs: message.duration_ms,
          totalCostUsd: message.total_cost_usd,
          numTurns: message.num_turns,
        });
      }
    }
  } catch (err) {
    // Update metadata on error
    const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
    metadata.status = "error";
    metadata.updatedAt = Date.now();
    writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

    error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

main();
```

```typescript
// agents/src/simple-runner-args.ts
import { logger } from "./lib/logger.js";

export interface SimpleArgs {
  taskId: string;
  threadId: string;
  prompt: string;
  cwd: string;
  mortDir: string;
  historyFile?: string;
}

export function parseSimpleArgs(argv: string[]): SimpleArgs {
  const args: Partial<SimpleArgs> = {};

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case "--task-id":
        args.taskId = argv[++i];
        break;
      case "--thread-id":
        args.threadId = argv[++i];
        break;
      case "--prompt":
        args.prompt = argv[++i];
        break;
      case "--cwd":
        args.cwd = argv[++i];
        break;
      case "--mort-dir":
        args.mortDir = argv[++i];
        break;
      case "--history-file":
        args.historyFile = argv[++i];
        break;
    }
  }

  if (!args.taskId || !args.threadId || !args.prompt || !args.cwd || !args.mortDir) {
    logger.error("Missing required arguments: --task-id, --thread-id, --prompt, --cwd, --mort-dir");
    throw new Error("Missing required arguments");
  }

  return args as SimpleArgs;
}
```

### Step 4: Create Simple Task Window Component

**File:** `src/components/simple-task/use-simple-task-params.ts`

Hook to extract task/thread IDs from window URL or Tauri window label:

```typescript
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "@/lib/logger-client";

interface SimpleTaskParams {
  taskId: string;
  threadId: string;
  prompt?: string;
}

/**
 * Extracts task parameters from the window.
 * Window label format: simple-task-{threadId}
 * Query params: ?taskId=xxx&threadId=xxx&prompt=xxx
 */
export function useSimpleTaskParams(): SimpleTaskParams | null {
  const [params, setParams] = useState<SimpleTaskParams | null>(null);

  useEffect(() => {
    // Parse from URL query params (set by open_simple_task command)
    const searchParams = new URLSearchParams(window.location.search);
    const taskId = searchParams.get("taskId");
    const threadId = searchParams.get("threadId");
    const prompt = searchParams.get("prompt") ?? undefined;

    if (taskId && threadId) {
      setParams({ taskId, threadId, prompt });
    } else {
      logger.error("[useSimpleTaskParams] Missing taskId or threadId in URL");
    }
  }, []);

  return params;
}
```

**File:** `src/components/simple-task/simple-task-window.tsx`

A minimal UI component that shows:
- Task title/prompt at top
- Scrollable conversation thread (messages)
- Input area at bottom for user responses
- Status indicator (running/idle/completed)

```typescript
import { useSimpleTaskParams } from "./use-simple-task-params";
import { useThreadStore } from "@/entities/threads/store";
import { resumeSimpleAgent } from "@/lib/simple-agent-service";
import { SimpleTaskHeader } from "./simple-task-header";
import { SimpleTaskInput } from "./simple-task-input";
import { MessageList } from "@/components/thread/message-list";

export const SimpleTaskWindow = () => {
  const params = useSimpleTaskParams();

  if (!params) {
    return <div>Loading...</div>;
  }

  const { taskId, threadId } = params;
  const activeState = useThreadStore(s => s.threadStates[threadId]);
  const activeMetadata = useThreadStore(s => s.threads[threadId]);

  const messages = activeState?.messages ?? [];
  const status = activeMetadata?.status ?? "idle";

  const handleSubmit = async (prompt: string) => {
    // Pass taskId, threadId, and prompt to resume
    await resumeSimpleAgent(taskId, threadId, prompt);
  };

  return (
    <div className="simple-task-window">
      <SimpleTaskHeader taskId={taskId} status={status} />
      <MessageList messages={messages} />
      <SimpleTaskInput onSubmit={handleSubmit} disabled={status === "running"} />
    </div>
  );
};
```

### Step 5: Create Simple Task Entry Point

**File:** `src/simple-task-main.tsx`

New window entry point for simple tasks:

```typescript
import { SimpleTaskWindow } from "./components/simple-task/simple-task-window";
import { hydrateEntities } from "./entities";

async function bootstrap() {
  await hydrateEntities();
}

bootstrap().then(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <SimpleTaskWindow />
    </StrictMode>
  );
});
```

### Step 6: Update Spotlight Keyboard Handling

**File:** `src/components/spotlight/spotlight.tsx`

The key change: **Enter = simple task (default), Command+Enter = full task**

```typescript
// In useEffect keyboard handler - replace the Enter case:
case "Enter":
  e.preventDefault();
  if (results.length > 0 && results[selectedIndex]) {
    const result = results[selectedIndex];
    // Command+Enter triggers full task flow
    const useFullFlow = e.metaKey;
    await activateResult(result, { useFullFlow });
  }
  break;

// Update activateResult signature:
const activateResult = useCallback(async (
  result: SpotlightResult,
  options?: { useFullFlow?: boolean }
) => {
  const controller = controllerRef.current;
  const useFullFlow = options?.useFullFlow ?? false;

  // ... existing app/calculator/action handlers ...

  if (result.type === "task") {
    const repos = controller.getRepositories();
    const selectedRepo = controller.getDefaultRepository() ?? repos[0];

    if (repos.length === 0) {
      logger.error("No repositories available.");
      return;
    }

    // Save to history
    promptHistoryService.add(result.data.query).catch(console.error);

    if (useFullFlow) {
      // Command+Enter: Full worktree flow (existing behavior)
      controller.createTask(result.data.query, selectedRepo).catch(handleError);
    } else {
      // Enter: Simple flow (new default)
      controller.createSimpleTask(result.data.query, selectedRepo).catch(handleError);
    }

    await controller.hideSpotlight();
  }
}, []);
```

**New method on SpotlightController:**

```typescript
/**
 * Creates a simple task that runs directly in the source repository.
 * No worktree allocation, no branch management - just direct execution.
 *
 * Note: Task metadata is created by the simple-runner process, not here.
 * This follows the "Agent Process Architecture" principle from AGENTS.md.
 */
async createSimpleTask(content: string, repo: Repository): Promise<void> {
  const taskId = crypto.randomUUID();
  const threadId = crypto.randomUUID();

  logger.log(`[spotlight:createSimpleTask] Creating simple task: ${taskId}`);

  // Open simple task window immediately (optimistic UI)
  // Window shows prompt while agent starts up
  await openSimpleTask(threadId, taskId, content);

  // Spawn simple agent (no orchestration)
  // The runner creates task metadata and thread data on disk
  await spawnSimpleAgent({
    taskId,
    threadId,
    prompt: content,
    sourcePath: repo.sourcePath,
    // Note: mortDir is obtained inside spawnSimpleAgent via FilesystemClient
  });
}
```

### Step 7: Add Tauri Commands for Simple Task Window

**File:** `src-tauri/src/commands/window.rs`

Add commands to open/manage simple task windows:

```rust
#[tauri::command]
pub async fn open_simple_task(
    app: AppHandle,
    thread_id: String,
    task_id: String,
    prompt: Option<String>,
) -> Result<(), String> {
    // Create panel similar to task panel but with simple-task entry point
    // ...
}
```

### Step 8: Add Hotkey Service Methods

**File:** `src/lib/hotkey-service.ts`

```typescript
export async function openSimpleTask(
  threadId: string,
  taskId: string,
  prompt?: string,
): Promise<void> {
  await invoke("open_simple_task", { threadId, taskId, prompt });
}
```

### Step 9: Update Task Types

**File:** `core/types/tasks.ts`

Add a new task type to distinguish simple tasks:

```typescript
export type TaskType = "work" | "investigate" | "simple";
```

**File:** `src/entities/tasks/types.ts`

Update TaskMetadata to include the new type.

## UI Components

### SimpleTaskHeader

Minimal header showing:
- Task title (truncated prompt or generated title)
- Status badge (running/completed/error)
- Close button

### MessageList

Reuse existing `src/components/thread/message-list.tsx` for rendering:
- User messages
- Assistant messages
- Tool calls and results

### SimpleTaskInput

Simple input component:
- Textarea for multi-line input
- Submit button (disabled when running)
- Keyboard shortcut (Cmd+Enter)

## Data Flow

### Simple Task (Enter - DEFAULT)

```
1. User types prompt in Spotlight, presses Enter
2. Spotlight calls createSimpleTask()
3. Opens simple-task window immediately (optimistic UI with prompt)
4. Spawns simple-runner.js with --cwd (source path), --task-id, --thread-id
5. Runner creates task metadata in ~/.mort/simple-tasks/{taskId}/metadata.json
6. Runner creates thread dir: ~/.mort/simple-tasks/{taskId}/threads/simple-{threadId}/
7. Runner writes metadata.json and emits thread:created event via stdout
8. Runner calls initState() from output.ts - creates state.json, emits initial state
9. Runner starts query() with claude_code preset
10. output.ts functions emit state updates via stdout (JSON protocol)
11. Frontend parses stdout via agent-output-parser.ts (same as full flow)
12. Frontend emits AGENT_STATE events to eventBus
13. UI receives events via thread listeners, updates threadStates[threadId]
14. User can type response when agent completes or requests input
15. resumeSimpleAgent() spawns runner with --history-file pointing to state.json
```

### Event Protocol

The simple-runner uses the same stdout protocol as the full runner:

```typescript
// State updates (parsed by agent-output-parser.ts)
{ "type": "state", "state": { messages: [...], status: "running", ... } }

// Events (handled by handleAgentEvent in agent-service.ts)
{ "type": "event", "name": "thread:created", "payload": { threadId, taskId, thread } }

// Logs (parsed and forwarded to logger)
{ "type": "log", "level": "INFO", "message": "..." }
```

This ensures the frontend can use the same parsing logic for both full and simple tasks.

### Full Task (Command+Enter)

```
1. User types prompt in Spotlight, presses Command+Enter
2. Spotlight calls createTask() (existing flow)
3. Creates draft task in ~/.mort/tasks/{slug}/
4. Opens task window with threadId, taskId, prompt
5. Spawns runner.js with --task-slug (orchestration)
6. Runner allocates worktree, creates branch
7. Runner creates thread in ~/.mort/tasks/{slug}/threads/{threadId}/
8. ... continues with full orchestration flow
```

### Keyboard Shortcut Summary

| Shortcut | Flow | Where it runs | Storage |
|----------|------|---------------|---------|
| **Enter** | Simple | Source repo | `~/.mort/simple-tasks/` |
| **Cmd+Enter** | Full | Allocated worktree | `~/.mort/tasks/` |

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/simple-agent-service.ts` | Spawn/resume simple agents |
| `agents/src/agent-types/simple.ts` | Simple agent config |
| `agents/src/simple-runner.ts` | Simplified runner entry point (~150 lines) |
| `agents/src/simple-runner-args.ts` | Argument parsing for simple runner (~50 lines) |
| `src/components/simple-task/simple-task-window.tsx` | Main window component |
| `src/components/simple-task/simple-task-header.tsx` | Header with status |
| `src/components/simple-task/simple-task-input.tsx` | Response input |
| `src/components/simple-task/use-simple-task-params.ts` | Hook to extract taskId/threadId from URL |
| `src/simple-task-main.tsx` | Window entry point |
| `simple-task.html` | HTML entry point for simple-task window |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/spotlight/spotlight.tsx` | Add `createSimpleTask()` method, handle `metaKey` for full flow |
| `src/lib/hotkey-service.ts` | Add `openSimpleTask()` function |
| `src-tauri/src/commands/window.rs` | Add `open_simple_task` command |
| `src-tauri/src/lib.rs` | Register new command |
| `agents/src/agent-types/index.ts` | Register simple agent config |
| `src/entities/threads/types.ts` | Add "simple" to AgentType union |
| `vite.config.ts` | Add simple-task entry point (see below) |
| `src-tauri/tauri.conf.json` | Add simple-task window config (see below) |

### vite.config.ts Changes

Add new entry point for simple-task window:

```typescript
// In build.rollupOptions.input:
input: {
  main: resolve(__dirname, "index.html"),
  spotlight: resolve(__dirname, "spotlight.html"),
  task: resolve(__dirname, "task.html"),
  "simple-task": resolve(__dirname, "simple-task.html"),  // NEW
  // ... other entries
},
```

Create `simple-task.html`:
```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Simple Task</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/simple-task-main.tsx"></script>
  </body>
</html>
```

### tauri.conf.json Changes

Add window configuration for simple-task panels:

```json
{
  "windows": [
    // ... existing windows ...
    {
      "label": "simple-task-template",
      "title": "Simple Task",
      "url": "simple-task.html",
      "visible": false,
      "width": 600,
      "height": 500,
      "resizable": true,
      "decorations": true
    }
  ]
}
```

**Note:** Actual simple-task windows are created dynamically via `open_simple_task` command with unique labels like `simple-task-{threadId}`.

## Simplifications vs Full Flow

| Feature | Full Flow | Simple Flow |
|---------|-----------|-------------|
| Worktree allocation | Yes | No |
| Branch creation | Yes | No |
| Merge base tracking | Yes | No |
| File change diffs | Yes (from merge base) | No |
| Agent orchestration | Yes | No |
| Agent types | research/execution/merge | single (simple) |
| Multi-stage workflow | Yes | No |
| Task status progression | draft→todo→in-progress→etc | running→completed |
| UI complexity | Full workspace | Thread only |

## Process Lifecycle Management

Simple tasks need to handle the agent process lifecycle properly:

### Window Close Behavior

When the user closes a simple-task window while the agent is running:

1. **Option A (Recommended):** Let the agent continue running in the background
   - Agent completes its work and writes final state to disk
   - User can re-open the task from task list to see results
   - Matches "disk is truth" principle

2. **Option B:** Kill the agent process
   - Would require tracking process PID and calling `process.kill()`
   - More complex, interrupts work in progress

Implementation in `simple-task-window.tsx`:
```typescript
useEffect(() => {
  const unlisten = getCurrentWindow().onCloseRequested(async (event) => {
    // Option A: Just close the window, let agent continue
    // The agent will write final state to disk
    logger.info("[SimpleTaskWindow] Window closing, agent continues in background");
  });

  return () => { unlisten.then(fn => fn()); };
}, []);
```

### Agent Crash Handling

When the agent process crashes or exits with non-zero code:

1. Frontend receives `command.on("close")` event with error code
2. Update thread status to "error" via `threadService.markError()`
3. Emit `agent:error` event for UI feedback
4. User sees error state in the simple-task window

This is already handled in `simple-agent-service.ts` via the `Command.on("close")` handler (same pattern as `agent-service.ts`).

### Cancellation

To cancel a running simple agent:

1. Store the `Child` process handle returned by `command.spawn()`
2. Call `child.kill()` when user requests cancellation
3. Update thread metadata to reflect cancellation

```typescript
// In simple-agent-service.ts
let activeProcesses = new Map<string, Child>();

export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = activeProcesses.get(threadId);
  if (process) {
    await process.kill();
    activeProcesses.delete(threadId);
    // Thread will be marked as error by the close handler
  }
}
```

## Resolved Design Decisions

### Keyboard Shortcuts (RESOLVED)

**Simple path is the DEFAULT:**
- **Enter** → Creates a simple task (runs in source repo, no worktree)
- **Command+Enter** → Creates a full task (worktree allocation, branch management)

This means:
- Most tasks run directly in the source repository
- Only explicitly "heavy" tasks get worktree isolation
- Reduces friction for quick queries/changes

### Filesystem Separation

Simple tasks are stored in a **separate directory** from full tasks, but use the **same thread structure** (metadata.json + state.json):

```
~/.mort/
├── tasks/                    # Full tasks (with worktree orchestration)
│   └── {task-slug}/
│       ├── metadata.json
│       └── threads/
│           └── {agentType}-{threadId}/
│               ├── metadata.json
│               └── state.json
└── simple-tasks/             # Simple tasks (no orchestration)
    └── {task-id}/
        ├── metadata.json     # Task-level metadata (created by runner)
        └── threads/
            └── simple-{threadId}/
                ├── metadata.json   # Thread metadata (status, turns)
                └── state.json      # Message history (SDK format)
```

Key differences:
- Full tasks use `tasks/{slug}/` with task slug as folder name
- Simple tasks use `simple-tasks/{taskId}/` with UUID as folder name
- Both use identical thread structure: `threads/{agentType}-{threadId}/` with metadata.json + state.json
- Clear separation enables different retention policies, easier cleanup
- Consistent thread format allows reuse of existing ThreadService and UI components

### Model Selection

Simple tasks use **claude-sonnet-4-20250514** by default:
- Faster responses for quick interactions
- Lower cost for exploratory queries
- Users can override in settings if needed

### Task Persistence

Simple tasks **do** appear in the task list:
- Consistent with "disk is truth" principle
- UI filters/groups by task type (`simple` vs `work`/`investigate`)
- Simple tasks may have shorter retention (e.g., auto-cleanup after 7 days)

### Window Behavior

Simple tasks use **panels** (floating windows):
- Quick access, stays above other apps
- Matches the "quick task" mental model
- Can be dismissed easily

## Success Criteria

1. **Enter creates simple task** - Default action in Spotlight runs simple flow
2. **Command+Enter creates full task** - Modifier key triggers worktree flow
3. **Simple task window opens immediately** - Optimistic UI with prompt shown
4. **Agent runs in source repository** - No worktree allocation delay
5. **Messages stream in real-time** - UI updates as agent works
6. **User can respond** - Input enabled when agent completes or requests input
7. **Separate storage** - Simple tasks in `~/.mort/simple-tasks/`, full tasks in `~/.mort/tasks/`
8. **Task history preserved** - Simple tasks appear in task list (filterable by type)

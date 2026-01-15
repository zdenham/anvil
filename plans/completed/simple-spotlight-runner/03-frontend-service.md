# 03 - Frontend Service

**Parallelizable:** Yes (no dependencies)
**Estimated scope:** 1 file created, 1 file modified

## Overview

Create the frontend service for spawning and resuming simple agents via Tauri shell commands.

## Tasks

### 1. Create simple agent service

**File:** `src/lib/simple-agent-service.ts`

```typescript
import { Command, type Child } from "@tauri-apps/plugin-shell";
import { FilesystemClient } from "./filesystem-client";
import { logger } from "./logger-client";
import { join } from "@tauri-apps/api/path";

const fs = new FilesystemClient();

// Track active processes for cancellation
const activeProcesses = new Map<string, Child>();

export interface SpawnSimpleAgentOptions {
  taskId: string;
  threadId: string;
  prompt: string;
  /** Repository source path - agent runs here directly */
  sourcePath: string;
}

/**
 * Spawns a simple agent that runs directly in the source repository.
 * No worktree allocation, no branch management.
 */
export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  const mortDir = await fs.getDataDir();
  const simpleRunnerPath = await getSimpleRunnerPath();

  const commandArgs = [
    simpleRunnerPath,
    "--task-id", options.taskId,
    "--thread-id", options.threadId,
    "--cwd", options.sourcePath,
    "--prompt", options.prompt,
    "--mort-dir", mortDir,
  ];

  logger.info("[simple-agent-service] Spawning simple agent", { taskId: options.taskId });

  const command = Command.create("node", commandArgs);

  // Handle stdout (JSON protocol from runner)
  command.stdout.on("data", (data) => {
    handleAgentOutput(options.threadId, data);
  });

  // Handle stderr (logs)
  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  // Handle process exit
  command.on("close", (code) => {
    activeProcesses.delete(options.threadId);
    if (code.code !== 0) {
      logger.error("[simple-agent] Process exited with code", { code: code.code });
    }
  });

  const child = await command.spawn();
  activeProcesses.set(options.threadId, child);
}

/**
 * Resumes a simple agent with a new prompt.
 */
export async function resumeSimpleAgent(
  taskId: string,
  threadId: string,
  prompt: string,
): Promise<void> {
  const mortDir = await fs.getDataDir();
  const simpleRunnerPath = await getSimpleRunnerPath();

  const threadFolderName = `simple-${threadId}`;
  const stateFilePath = await join(mortDir, "simple-tasks", taskId, "threads", threadFolderName, "state.json");

  const commandArgs = [
    simpleRunnerPath,
    "--task-id", taskId,
    "--thread-id", threadId,
    "--prompt", prompt,
    "--mort-dir", mortDir,
    "--history-file", stateFilePath,
  ];

  logger.info("[simple-agent-service] Resuming simple agent", { taskId, threadId });

  const command = Command.create("node", commandArgs);

  command.stdout.on("data", (data) => {
    handleAgentOutput(threadId, data);
  });

  command.stderr.on("data", (data) => {
    logger.debug("[simple-agent] stderr:", data);
  });

  command.on("close", (code) => {
    activeProcesses.delete(threadId);
  });

  const child = await command.spawn();
  activeProcesses.set(threadId, child);
}

/**
 * Cancels a running simple agent.
 */
export async function cancelSimpleAgent(threadId: string): Promise<void> {
  const process = activeProcesses.get(threadId);
  if (process) {
    await process.kill();
    activeProcesses.delete(threadId);
    logger.info("[simple-agent-service] Cancelled agent", { threadId });
  }
}

async function getSimpleRunnerPath(): Promise<string> {
  // Resolve path to agents/dist/simple-runner.js
  // Implementation depends on how paths are resolved in the app
  return "agents/dist/simple-runner.js";
}

function handleAgentOutput(threadId: string, data: string): void {
  // Parse JSON lines and emit events to eventBus
  // Reuse existing agent-output-parser.ts patterns
}
```

### 2. Update hotkey service

**File:** `src/lib/hotkey-service.ts`

Add the `openSimpleTask` function:

```typescript
export async function openSimpleTask(
  threadId: string,
  taskId: string,
  prompt?: string,
): Promise<void> {
  await invoke("open_simple_task", { threadId, taskId, prompt });
}
```

## Verification

```bash
pnpm typecheck
```

The service should compile without type errors. Full integration testing happens in Phase 2.

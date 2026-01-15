# 05 - Agent Service Integration

**Tier:** 3
**Depends on:** 03-workspace-service, 04-runner-updates, 00a-task-entity
**Blocking:** 06-ui-integration

---

## Contracts

### Exports (Other Plans Depend On)

```typescript
// Used by: 06-ui-integration
export interface StartAgentOptions {
  agentType: string;
  repoName: string;        // NEW: For workspace allocation
  prompt: string;
  taskId: string;
  parentTaskId?: string;   // NEW: For subtasks
}

export interface AgentService {
  startAgent(options: StartAgentOptions): Promise<{
    conversationId: string;
    workingDirectory: string;
  }>;

  stopAgent(conversationId: string): Promise<void>;
}
```

### Imports (This Plan Depends On)

```typescript
// From 03-workspace-service
import {
  createWorkspaceService,
  type WorkspaceService,
  type WorkspaceAllocation,
} from "@/lib/workspace-service";
```

---

## Implementation

### File: `src/lib/agent-service.ts`

```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  createWorkspaceService,
  type WorkspaceService,
  type WorkspaceAllocation,
} from "./workspace-service";
import { processCommands } from "./tauri-commands";

export interface StartAgentOptions {
  agentType: string;
  repoName: string;
  prompt: string;
  taskId: string;
  parentTaskId?: string;
}

export interface AgentService {
  startAgent(options: StartAgentOptions): Promise<{
    conversationId: string;
    workingDirectory: string;
  }>;
  stopAgent(conversationId: string): Promise<void>;
  initialize(): Promise<void>;
  dispose(): void;
}

/**
 * Conversation tracking info.
 * This is also persisted to recover after app restart.
 */
interface ConversationTrackingInfo {
  repoName: string;
  taskId: string;
  worktreePath: string;
}

// Singleton instance
let agentServiceInstance: AgentService | null = null;

/**
 * Get the singleton AgentService instance.
 * Creates one if it doesn't exist.
 */
export function getAgentService(): AgentService {
  if (!agentServiceInstance) {
    agentServiceInstance = createAgentService();
  }
  return agentServiceInstance;
}

export function createAgentService(): AgentService {
  const workspaceService = createWorkspaceService();

  // In-memory tracking for fast lookups
  // This is rebuilt on startup from persisted data
  const activeConversations = new Map<string, ConversationTrackingInfo>();

  // Event listener cleanup function
  let unlistenProcessEvents: (() => void) | null = null;

  return {
    /**
     * Initialize the agent service.
     * Call this on app startup to restore state and set up event listeners.
     */
    async initialize(): Promise<void> {
      // Restore active conversations from persisted storage
      await restoreActiveConversations(activeConversations);

      // Set up Tauri event listener for process lifecycle events
      // (Tauri uses events, not callbacks, for IPC)
      unlistenProcessEvents = await listen<ProcessEvent>(
        "agent-process-event",
        async (event) => {
          const { conversationId, eventType } = event.payload;

          if (eventType === "completed" || eventType === "error") {
            await this.stopAgent(conversationId);
          }
        }
      );
    },

    /**
     * Clean up event listeners on shutdown.
     */
    dispose(): void {
      if (unlistenProcessEvents) {
        unlistenProcessEvents();
        unlistenProcessEvents = null;
      }
    },

    async startAgent(options: StartAgentOptions): Promise<{
      conversationId: string;
      workingDirectory: string;
    }> {
      // Generate conversation ID
      const conversationId = generateConversationId();

      // Allocate workspace (creates branch if needed, claims worktree)
      const allocation = await workspaceService.allocateWorkspace(
        options.repoName,
        options.taskId,
        conversationId
      );

      // Track for cleanup (both in-memory and persisted)
      const trackingInfo: ConversationTrackingInfo = {
        repoName: options.repoName,
        taskId: options.taskId,
        worktreePath: allocation.worktree.path,
      };
      activeConversations.set(conversationId, trackingInfo);
      await persistConversationTracking(conversationId, trackingInfo);

      // Build runner command
      const runnerPath = await processCommands.getRunnerPath();
      const commandArgs = [
        runnerPath,
        "--agent", options.agentType,
        "--cwd", allocation.worktree.path,
        "--prompt", options.prompt,
        "--conversation-id", conversationId,
        "--task-id", options.taskId,
        "--merge-base", allocation.mergeBase,
      ];

      // Add parent task ID for subtasks
      if (options.parentTaskId) {
        commandArgs.push("--parent-task-id", options.parentTaskId);
      }

      // Start the runner process
      try {
        await processCommands.spawnAgentProcess(commandArgs, conversationId);
      } catch (error) {
        // Release workspace on failure
        await this.stopAgent(conversationId);
        throw error;
      }

      return {
        conversationId,
        workingDirectory: allocation.worktree.path,
      };
    },

    async stopAgent(conversationId: string): Promise<void> {
      const tracked = activeConversations.get(conversationId);

      if (tracked) {
        // Release the workspace
        await workspaceService.releaseWorkspace(
          tracked.repoName,
          conversationId
        );

        // Clean up tracking
        activeConversations.delete(conversationId);
        await removeConversationTracking(conversationId);
      }

      // Also try to terminate the process if still running
      try {
        await processCommands.terminateAgentProcess(conversationId);
      } catch {
        // Process may have already exited
      }
    },
  };
}

// Types for process events (emitted by Rust backend)
interface ProcessEvent {
  conversationId: string;
  eventType: "started" | "completed" | "error";
  exitCode?: number;
}

function generateConversationId(): string {
  return `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persist conversation tracking info to recover after restart.
 * Stored in: ~/.mort/active-conversations/{conversationId}.json
 */
async function persistConversationTracking(
  conversationId: string,
  info: ConversationTrackingInfo
): Promise<void> {
  const path = await getTrackingPath(conversationId);
  await invoke("write_file", {
    path,
    content: JSON.stringify(info),
  });
}

async function removeConversationTracking(conversationId: string): Promise<void> {
  const path = await getTrackingPath(conversationId);
  try {
    await invoke("delete_file", { path });
  } catch {
    // File may not exist
  }
}

async function getTrackingPath(conversationId: string): Promise<string> {
  const home = await invoke<string>("get_home_dir");
  return `${home}/.mort/active-conversations/${conversationId}.json`;
}

/**
 * Restore active conversations from persisted storage on startup.
 * For each persisted conversation, check if process is still running.
 */
async function restoreActiveConversations(
  map: Map<string, ConversationTrackingInfo>
): Promise<void> {
  const home = await invoke<string>("get_home_dir");
  const trackingDir = `${home}/.mort/active-conversations`;

  try {
    const files = await invoke<string[]>("list_directory", { path: trackingDir });

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      const conversationId = file.replace(".json", "");
      const path = `${trackingDir}/${file}`;

      try {
        const content = await invoke<string>("read_file", { path });
        const info: ConversationTrackingInfo = JSON.parse(content);

        // Check if process is still running
        const isRunning = await processCommands.isProcessRunning(conversationId);

        if (isRunning) {
          // Restore to in-memory map
          map.set(conversationId, info);
        } else {
          // Process exited while app was closed - clean up
          await removeConversationTracking(conversationId);
          // Note: Workspace will be released by stale detection
        }
      } catch {
        // Corrupted file, remove it
        await removeConversationTracking(conversationId);
      }
    }
  } catch {
    // Directory doesn't exist yet, that's fine
  }
}
```

---

### Process Lifecycle Integration

The Rust backend emits Tauri events when process state changes. The agent service listens to these events via `@tauri-apps/api/event`.

#### Rust Event Emission

Add to `src-tauri/src/process_commands.rs`:

```rust
use tauri::Manager;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessEvent {
    conversation_id: String,
    event_type: String,  // "started", "completed", "error"
    exit_code: Option<i32>,
}

/// Monitor a spawned process and emit events on state changes
async fn monitor_process(
    app_handle: tauri::AppHandle,
    conversation_id: String,
    mut child: Child,
) {
    // Emit started event
    app_handle.emit("agent-process-event", ProcessEvent {
        conversation_id: conversation_id.clone(),
        event_type: "started".to_string(),
        exit_code: None,
    }).ok();

    // Wait for process to complete
    match child.wait() {
        Ok(status) => {
            let event_type = if status.success() { "completed" } else { "error" };
            app_handle.emit("agent-process-event", ProcessEvent {
                conversation_id,
                event_type: event_type.to_string(),
                exit_code: status.code(),
            }).ok();
        }
        Err(_) => {
            app_handle.emit("agent-process-event", ProcessEvent {
                conversation_id,
                event_type: "error".to_string(),
                exit_code: None,
            }).ok();
        }
    }
}
```

#### Frontend Listener

The agent service's `initialize()` method sets up the event listener:

```typescript
// Already shown in implementation above
unlistenProcessEvents = await listen<ProcessEvent>(
  "agent-process-event",
  async (event) => {
    const { conversationId, eventType } = event.payload;
    if (eventType === "completed" || eventType === "error") {
      await this.stopAgent(conversationId);
    }
  }
);
```

---

## Changes from Current Implementation

### Before (Current)

```typescript
// spotlight.tsx:129-130
const repo = repos[0];
const latestVersion = repoService.getLatestVersion(repo.name);
const workingDirectory = latestVersion.path;

// Then starts agent without workspace management
startAgent({
  agentType: "planner",
  cwd: workingDirectory,
  prompt: prompt,
  // ... no task/branch tracking
});
```

### After (New)

```typescript
// spotlight.tsx (simplified)
const result = await agentService.startAgent({
  agentType: "planner",
  repoName: repo.name,
  prompt: prompt,
  taskId: task.id,
  parentTaskId: task.parentId,  // If subtask
});

// workingDirectory comes from allocation
const workingDirectory = result.workingDirectory;
```

---

## Error Handling

| Scenario | Handling |
|----------|----------|
| Workspace allocation fails | Throw error, no process started |
| Process spawn fails | Release workspace, throw error |
| Process exits unexpectedly | Lifecycle handler releases workspace |
| stopAgent called twice | Second call is no-op (idempotent) |

---

## Testing

```typescript
describe("AgentService", () => {
  it("allocates workspace before starting agent", async () => {
    const service = createAgentService();
    const result = await service.startAgent({
      agentType: "coder",
      repoName: "my-app",
      prompt: "Test prompt",
      taskId: "task-123",
    });

    expect(result.workingDirectory).toContain("my-app");
    expect(result.conversationId).toMatch(/^conv-/);
  });

  it("releases workspace when agent stops", async () => {
    const service = createAgentService();
    const { conversationId } = await service.startAgent({...});

    await service.stopAgent(conversationId);

    // Verify workspace is released
  });

  it("passes merge base to runner", async () => {
    // Verify spawn_agent_process is called with --merge-base
  });

  it("handles subtasks with parent task ID", async () => {
    const service = createAgentService();
    await service.startAgent({
      agentType: "coder",
      repoName: "my-app",
      prompt: "Implement feature",
      taskId: "task-sub-1",
      parentTaskId: "task-123",  // Parent task
    });

    // Verify --parent-task-id is passed to runner
  });
});
```

---

## Verification

- [ ] Workspace allocated before agent starts
- [ ] Merge base passed to runner
- [ ] Parent task ID passed for subtasks
- [ ] Workspace released on normal completion
- [ ] Workspace released on error
- [ ] Workspace released when manually stopped
- [ ] Singleton pattern works correctly
- [ ] Conversation tracking persisted to disk
- [ ] State restored correctly after app restart
- [ ] Tauri events properly trigger cleanup
- [ ] `initialize()` called on app startup
- [ ] `dispose()` called on app shutdown

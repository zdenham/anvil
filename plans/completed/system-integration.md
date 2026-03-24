# System Integration Plan

## Overview

This document defines how the three core systems work together.

**SDK Documentation:**
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/api/agent-sdk/typescript)
- [Hooks Guide](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [NPM: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
- [NPM: @anthropic-ai/sdk](https://www.npmjs.com/package/@anthropic-ai/sdk)

**Key Principles:**

- **Disk always wins**: All systems use persisted files as the source of truth. Stdout streaming is for low-latency display only—not persistence. On reconnect, page refresh, or any ambiguity, reload from disk. This eliminates race conditions and deduplication complexity.
- **Stdout for display, files for persistence**: Real-time updates stream via stdout (purpose-built for child process output). File watching was evaluated and rejected (OS-level APIs coalesce rapid events, causing latency issues).
- **Install and use Anthropic SDK types**: Install `@anthropic-ai/sdk` as an explicit dependency and use its types directly. Do NOT define custom types for concepts that already exist in the SDK. Only create app-specific types for concepts not in the SDK (like `FileChangeMessage`, `ConversationMetadata`). See "Type Strategy" section below.
- **Git required**: Working directories must be git repositories. This simplifies diff generation and change tracking.

The three core systems:

1. **Agent Execution System** (`agent-execution-system.md`) - Spawns and runs Claude agents
2. **Conversation Chat UI** (`conversation-chat-ui.md`) - Displays streaming agent responses
3. **Diff Viewer** (`diff-viewer.md`) - Renders code changes made by agents

## User Flow

```
┌─────────────┐     ┌────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Spotlight  │────►│  Task Created  │────►│  Agent Spawned   │────►│  Chat Panel │
│  (input)    │     │  (metadata)    │     │  (Node.js)       │     │  (streaming)│
└─────────────┘     └────────────────┘     └──────────────────┘     └─────────────┘
                                                   │
                                                   │ stdout (real-time)
                                                   │ + appends to files
                                                   ▼
                                           ┌──────────────────┐
                                           │ .anvil/           │
                                           │ conversations/   │
                                           │ {id}/            │
                                           │ ├── messages.jsonl
                                           │ ├── metadata.json│
                                           │ └── changes.jsonl│ ◄── incremental file changes
                                           └──────────────────┘
                                                   │
                                                   │ real-time via stdout
                                                   │ (files for recovery)
                                                   ▼
                                           ┌──────────────────┐
                                           │  Diff Viewer     │
                                           │  (live updates)  │
                                           └──────────────────┘
```

---

## Shared Contracts

### Conversation ID Linking

The `conversationId` is the key that links Task → Agent → Chat UI → Diff Viewer. A task can have multiple conversations (e.g., multiple agent runs).

**Task Metadata Extension** (in `task-store-client.ts`):

```typescript
export interface TaskMetadata {
  id: string;
  title: string;
  subtasks: Subtask[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  /** IDs of associated agent conversations (empty array if none spawned yet) */
  conversationIds: string[];
}
```

### Type Strategy

**Install `@anthropic-ai/sdk` as an explicit dependency in both the agents package and the root frontend package:**

```bash
# In agents/
pnpm add @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk

# In root (frontend)
pnpm add @anthropic-ai/sdk
```

**Use SDK types directly - do NOT redefine them:**

```typescript
// ✅ CORRECT: Import and use SDK types directly
import type {
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  Message,
  MessageParam
} from "@anthropic-ai/sdk/resources/messages";

// ✅ CORRECT: Extend SDK types when adding app-specific fields
interface TimestampedTextBlock extends TextBlock {
  timestamp: number;
}

// ❌ WRONG: Do NOT redefine types that exist in the SDK
interface TextMessage {
  type: "text";
  content: string;  // TextBlock already has this!
}

// ❌ WRONG: Do NOT create parallel type hierarchies
interface ToolUseMessage {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;  // ToolUseBlock already has all of this!
}
```

**Only define custom types for concepts NOT in the SDK:**
- `FileChangeMessage` - git diff tracking (app-specific)
- `CompleteMessage` - run completion with metrics (app-specific)
- `ConversationMetadata` - conversation state (app-specific)
- `SystemMessage` with `subtype: "init"` - initialization info (app-specific)

### Unified Message Types

The message format combines SDK types with app-specific extensions. **Import SDK types; only define what doesn't exist in the SDK.**

**`src/lib/types/agent-messages.ts`**:

```typescript
// ============================================================
// IMPORTANT: Import SDK types - do NOT redefine them
// ============================================================
import type {
  TextBlock,
  ToolUseBlock,
  ThinkingBlock,
  ContentBlock,
} from "@anthropic-ai/sdk/resources/messages";

// ============================================================
// App-specific base interface (adds timestamp to all messages)
// ============================================================
interface BaseMessage {
  timestamp: number;
}

// ============================================================
// SDK-derived types (extend SDK types with timestamp)
// ============================================================

/** Text content from SDK with timestamp */
export type TextMessage = TextBlock & BaseMessage;

/** Thinking content from SDK with timestamp */
export type ThinkingMessage = ThinkingBlock & BaseMessage;

/** Tool use from SDK with timestamp */
export type ToolUseMessage = ToolUseBlock & BaseMessage;

/** Tool result - SDK has ToolResultBlockParam, we extend it */
export interface ToolResultMessage extends BaseMessage {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  /** Whether the tool execution resulted in an error */
  is_error?: boolean;
}

// ============================================================
// App-specific types (concepts NOT in the SDK)
// ============================================================

/** System initialization message (app-specific) */
export interface SystemMessage extends BaseMessage {
  type: "system";
  subtype: "init";
  model: string;
  tools: string[];
}

/** File change operation - emitted after each file modification (app-specific)
 *  Binary files are skipped (not emitted) - similar to GitHub's behavior
 */
export interface FileChangeMessage extends BaseMessage {
  type: "file_change";
  /** Relative path from working directory */
  path: string;
  /** Type of change */
  operation: "create" | "modify" | "delete" | "rename";
  /** For renames, the original path */
  oldPath?: string;
  /** Full cumulative unified diff from HEAD (git diff HEAD -- <file>)
   *  Each emission contains the COMPLETE diff, not a delta.
   *  Later messages for the same file supersede earlier ones entirely.
   */
  diff: string;
}

/** Agent run completed (app-specific) */
export interface CompleteMessage extends BaseMessage {
  type: "complete";
  durationMs: number;
  durationApiMs?: number;
  success: boolean;
  totalCostUsd?: number;
  numTurns?: number;
  /** Summary of all file changes */
  summary?: {
    filesChanged: number;
    additions: number;
    deletions: number;
  };
}

/** Error during agent execution (app-specific) */
export interface ErrorMessage extends BaseMessage {
  type: "error";
  message: string;
  code?: string;
}

/** Union of all message types */
export type AgentMessage =
  | SystemMessage
  | TextMessage
  | ThinkingMessage
  | ToolUseMessage
  | ToolResultMessage
  | FileChangeMessage
  | CompleteMessage
  | ErrorMessage;

// Re-export SDK types for convenience
export type { ContentBlock, TextBlock, ToolUseBlock, ThinkingBlock };
```

### Conversation Metadata

A conversation can have multiple "turns" - back-and-forth exchanges between user and agent. Each turn represents one agent run within the conversation.

**`.anvil/conversations/{id}/metadata.json`**:

```typescript
export interface ConversationMetadata {
  /** Unique conversation ID */
  id: string;
  /** Associated task ID (links back to task system) */
  taskId: string;
  /** Agent type used (e.g., "simplifier", "coder") */
  agentType: string;
  /** Working directory for this conversation */
  workingDirectory: string;
  /** Current status of the conversation */
  status: "idle" | "running" | "completed" | "error";
  /** Creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  updatedAt: number;
  /** TTL in milliseconds (for future cleanup - not implemented in v1) */
  ttlMs?: number;
  /** Git info at start of conversation */
  git?: {
    branch: string;
    commitHash: string;
  };
  /** Track each turn/run in the conversation */
  turns: ConversationTurn[];
}

export interface ConversationTurn {
  /** Turn index (0-based) */
  index: number;
  /** User prompt for this turn */
  prompt: string;
  /** Timestamp when turn started */
  startedAt: number;
  /** Timestamp when turn completed (null if still running) */
  completedAt: number | null;
  /** Exit code if process exited */
  exitCode?: number;
  /** Cost for this turn in USD */
  costUsd?: number;
}
```

---

## Integration Points

### 1. Spotlight → Task → Agent

When a task is created from spotlight, optionally spawn an agent immediately.

**`SpotlightController.createTask()` pseudocode**:

```typescript
async createTask(content: string, shouldSpawnAgent: boolean = true): Promise<void> {
  // Create task metadata
  const task = await taskStoreClient.create({ content })

  if (shouldSpawnAgent && settings.repository && settings.anthropicApiKey) {
    // Spawn agent process, get conversation ID
    const { conversationId } = await agentService.spawn({
      agentType: "coder",
      workingDirectory: settings.repository,
      prompt: content,
      taskId: task.id,
    })

    // Link conversation to task
    await taskStoreClient.addConversation(task.id, conversationId)

    // Open conversation panel
    await openConversationPanel(conversationId)
  }
}
```

**`TaskStoreClient.addConversation()` pseudocode**:

```typescript
async addConversation(taskId: string, conversationId: string): Promise<void> {
  // Load task metadata
  const task = await this.get(taskId)

  // Append conversation ID to array
  task.conversationIds.push(conversationId)

  // Persist updated metadata
  await this.save(task)
}
```

### 2. Agent → File Changes → Diff

File changes are emitted as the agent modifies files. Each `FileChangeMessage` contains the **full cumulative diff from HEAD** - not a delta. This means:

- No aggregation logic needed in the frontend
- Later messages for the same file simply replace earlier ones
- Binary files are skipped (not emitted) - similar to GitHub's behavior

**Data flow**:

```
Agent modifies file
       │
       ▼
Check if binary (skip if so)
       │
       ▼
Generate FULL diff: git diff HEAD -- <file>
       │
       ├──► stdout: FileChangeMessage (real-time to frontend)
       │
       └──► append to changes.jsonl (persistence / source of truth)
```

**`changes.jsonl` format** (one FileChangeMessage per line):

```jsonl
{"type":"file_change","path":"src/main.ts","operation":"modify","diff":"@@ -1,3 +1,4 @@...","timestamp":1702000001}
{"type":"file_change","path":"src/main.ts","operation":"modify","diff":"@@ -1,3 +1,8 @@...","timestamp":1702000005}
{"type":"file_change","path":"src/utils.ts","operation":"create","diff":"@@ -0,0 +1,10 @@...","timestamp":1702000002}
{"type":"file_change","path":"src/old.ts","operation":"delete","diff":"@@ -1,5 +0,0 @@...","timestamp":1702000003}
```

Note: `src/main.ts` appears twice - the second entry (timestamp 1702000005) contains the complete cumulative diff and supersedes the first.

**Agent runner pseudocode**:

```typescript
// After each file write/edit tool completes
onFileModified(filePath, operation) {
  // Skip binary files
  if (isBinaryFile(filePath)) {
    return
  }

  // Generate FULL cumulative diff from HEAD using git
  // Use execFileSync with array args to avoid shell injection
  const diff = execFileSync("git", ["diff", "HEAD", "--", filePath], { cwd })

  const message = {
    type: "file_change",
    path: relativePath(filePath),
    operation,  // "create" | "modify" | "delete" | "rename"
    diff,
    timestamp: Date.now()
  }

  // Real-time: emit to stdout for frontend
  console.log(JSON.stringify(message))

  // Persistence: append to changes.jsonl (SOURCE OF TRUTH)
  appendFileSync(changesPath, JSON.stringify(message) + "\n")
}
```

**Diff viewer consumption**:

- **Disk always wins**: On mount/refresh, read `changes.jsonl` and build file map
- Real-time: stdout updates displayed immediately for low latency
- To get current state per file: take the LAST entry for each unique path

### 3. Conversation → Chat UI + Diff Viewer

The frontend receives agent output via two channels:

1. **Stdout streaming (display)**: Real-time updates for immediate rendering (low latency, purpose-built for child process output)
2. **File system (source of truth)**: Persisted files read on mount, refresh, or any ambiguity

**Disk Always Wins**: The persisted files (`messages.jsonl`, `changes.jsonl`) are the source of truth. Stdout streaming is purely for low-latency display—never for persistence. On any reconnect, page refresh, or state ambiguity, reload from disk.

**Why not file watching?** OS-level file watching APIs (FSEvents, inotify) are designed for detecting occasional changes, not high-frequency streaming. They coalesce rapid events, causing latency issues. Tauri's shell plugin channels are explicitly designed for streaming child process output.

**`useConversation` hook pseudocode**:

```typescript
interface ConversationState {
  messages: AgentMessage[];
  fileChanges: Map<string, FileChangeMessage>; // Keyed by path, last write wins
  status: "idle" | "running" | "completed" | "error";
}

function useConversation(conversationId: string | null): ConversationState {
  // DISK ALWAYS WINS: Load persisted state on mount
  // This is the SOURCE OF TRUTH
  useEffect(() => {
    if (!conversationId) return;

    loadPersistedState(conversationId).then(
      ({ messages, fileChanges, status }) => {
        setMessages(messages);
        setFileChanges(fileChanges);
        setStatus(status);
      }
    );
  }, [conversationId]);

  // Real-time: subscribe to stdout for low-latency updates
  // This is for DISPLAY ONLY - not source of truth
  useAgentStream(conversationId, {
    onMessage: (msg) => {
      if (msg.type === "file_change") {
        // Replace entry for this path (last write wins)
        setFileChanges((prev) => new Map(prev).set(msg.path, msg));
      } else {
        addMessage(msg);
      }
    },
    onComplete: () => setStatus("completed"),
  });

  return { messages, fileChanges, status };
}

// Helper to load from .anvil/conversations/{id}/
async function loadPersistedState(conversationId) {
  const basePath = `.anvil/conversations/${conversationId}`;

  // Read messages.jsonl (JSONL format)
  const messages = await readJsonLines(`${basePath}/messages.jsonl`);

  // Read changes.jsonl and build map (last entry per path wins)
  const changesArray = await readJsonLines(`${basePath}/changes.jsonl`);
  const fileChanges = new Map<string, FileChangeMessage>();
  for (const change of changesArray) {
    fileChanges.set(change.path, change); // Later entries overwrite
  }

  // Read metadata for status
  const metadata = await readJson(`${basePath}/metadata.json`);

  return { messages, fileChanges, status: metadata.status };
}
```

### 4. Chat UI ↔ Diff Viewer

The conversation window displays chat and diff viewer in tabs. The diff viewer receives `FileChangeMessage` map (already keyed by path, no aggregation needed).

**Conversation window pseudocode**:

```typescript
function ConversationWindow({ conversationId }) {
  const { messages, fileChanges, status } = useConversation(conversationId);
  const [activeTab, setActiveTab] = useState("chat");

  // Auto-switch to diff tab when agent completes with changes
  useEffect(() => {
    if (status === "completed" && fileChanges.size > 0) {
      setActiveTab("diff");
    }
  }, [status, fileChanges]);

  const handleFileChangeClick = (path: string) => {
    setActiveTab("diff");
    // DiffViewer can scroll to this file
  };

  return (
    <Tabs value={activeTab}>
      <Tab value="chat">
        <ConversationView
          messages={messages}
          isStreaming={status === "running"}
          onFileChangeClick={handleFileChangeClick}
        />
      </Tab>
      <Tab value="diff">
        <DiffViewer
          fileChanges={fileChanges} // Map<path, FileChangeMessage>
          workingDirectory={workingDirectory}
          onOpenInVSCode={handleOpenInVSCode}
        />
      </Tab>
    </Tabs>
  );
}
```

**Diff viewer display**:

The diff viewer receives `Map<string, FileChangeMessage>` plus full file contents (loaded upfront):

- Each path maps to its latest cumulative diff
- Full file contents loaded upfront by parent (`useFileContents` hook) to enable virtualization
- Supports collapsed regions (unchanged lines) with all data available immediately
- Large files (>1000 lines) use virtualized rendering via `@tanstack/react-virtual`
- Binary files are never in the map (skipped at emission time)

---

## Conversation Store

All conversations are loaded into a Zustand store on app startup. This provides:

- Fast enumeration of all conversations
- Reactive updates when conversations change
- Linking conversations to tasks

**`useConversationStore` pseudocode**:

```typescript
interface ConversationStore {
  conversations: Map<string, ConversationMetadata>;
  isLoading: boolean;

  // Actions
  loadAll: () => Promise<void>;
  get: (id: string) => ConversationMetadata | undefined;
  getByTaskId: (taskId: string) => ConversationMetadata[];
  create: (
    taskId: string,
    agentType: string,
    workingDirectory: string
  ) => Promise<string>;
  updateStatus: (
    id: string,
    status: ConversationMetadata["status"]
  ) => Promise<void>;
  addTurn: (id: string, prompt: string) => Promise<void>;
}

// On app startup
await conversationStore.loadAll(); // Scans .anvil/conversations/*/metadata.json
```

**Loading from disk**:

```typescript
async loadAll() {
  // Scan conversation directories
  const dirs = await readDir(".anvil/conversations")

  for (const dir of dirs) {
    const metadata = await readJson(`${dir.path}/metadata.json`)
    this.conversations.set(metadata.id, metadata)
  }
}
```

---

## File System Layout

```
.anvil/
├── tasks/                          # Task metadata (existing)
│   └── {task-name}-{id}/
│       ├── metadata.json           # Now includes conversationIds array
│       ├── content.md
│       └── subtasks/
│
├── conversations/                  # Agent conversations (new)
│   └── {conversationId}/
│       ├── metadata.json           # Conversation config & status
│       ├── messages.jsonl          # JSONL stream (one AgentMessage per line)
│       └── changes.jsonl           # JSONL stream (one FileChangeMessage per line)
│
└── settings/                       # User settings (existing)
    └── workspace.json              # Includes anthropicApiKey
```

---

## Window Architecture

### Main Window

- Task list / Kanban board
- Shows task status and links to conversations

### Conversation Window (per-conversation)

- Opens when task is created or when user clicks a task
- Contains Chat UI + Diff Viewer in tabs
- URL: `conversation.html?id={conversationId}`

**Window management pseudocode**:

```typescript
// Track open windows to avoid duplicates
const conversationWindows = new Map<string, WebviewWindow>();

async function openConversationWindow(conversationId: string) {
  // Reuse existing window if open
  if (conversationWindows.has(conversationId)) {
    try {
      await conversationWindows.get(conversationId).setFocus();
      return;
    } catch {
      // Window was destroyed, remove from map
      conversationWindows.delete(conversationId);
    }
  }

  // Create new window
  const window = new WebviewWindow(`conversation-${conversationId}`, {
    url: `conversation.html?id=${conversationId}`,
    title: "Conversation",
    width: 900,
    height: 700,
  });

  conversationWindows.set(conversationId, window);

  // Clean up on close
  window.once("tauri://destroyed", () => {
    conversationWindows.delete(conversationId);
  });
}
```

---

## State Synchronization

### Disk Always Wins

**Files are the source of truth**. stdout streaming is for display performance only.

```
Agent Process                         Frontend
     │                                   │
     │ stdout: JSON message              │
     ├──────────────────────────────────►│ Display immediately (low latency)
     │                                   │
     │ append to messages.jsonl          │
     │ append to changes.jsonl           │
     │ (SOURCE OF TRUTH)                 │
     │                                   │
     │                                   │ On mount/refresh: RELOAD FROM DISK
     │                                   │ (overwrites any in-memory state)
```

This approach eliminates:

- Deduplication complexity
- Race conditions between streams
- State reconciliation bugs

### Cross-Window Communication

When conversation status changes, notify other windows via Tauri events:

```typescript
// On agent process close (in agent-service)
onAgentClose(conversationId, exitCode) {
  // Update conversation metadata
  updateConversationStatus(conversationId, exitCode === 0 ? "completed" : "error")

  // Emit event for other windows
  emit("conversation-status-changed", { conversationId, status })
}

// In task list component (listens for updates)
listen("conversation-status-changed", (event) => {
  refreshTasks()
})
```

---

## Implementation Order

### Phase 1: Shared Types & Contracts

1. [ ] Create `src/lib/types/agent-messages.ts` with unified message types
2. [ ] Extend `TaskMetadata` to include `conversationIds: string[]` array
3. [ ] Define `ConversationMetadata` interface
4. [ ] Add `taskStoreClient.addConversation()` method

### Phase 2: Agent Execution (from `agent-execution-system.md`)

5. [ ] Implement agent runner with incremental file change tracking
6. [ ] Add Tauri shell plugin integration
7. [ ] Create agent service with stdout streaming

### Phase 3: Spotlight Integration

8. [ ] Modify `SpotlightController.createTask()` to spawn agent
9. [ ] Add conversation window opening logic
10. [ ] Create window management service

### Phase 4: Chat UI (from `conversation-chat-ui.md`)

11. [ ] Implement `useConversation` hook with stdout streaming + file recovery
12. [ ] Build chat message components
13. [ ] Create conversation window entry point

### Phase 5: Diff Viewer (from `diff-viewer.md`)

14. [ ] Implement diff parser (handles incremental FileChangeMessage aggregation)
15. [ ] Build diff viewer components
16. [ ] Integrate into conversation window with real-time updates

### Phase 6: Polish

17. [ ] Add loading states and error handling
18. [ ] Implement cross-window event synchronization
19. [ ] Add keyboard navigation between tabs

---

## Resolved Decisions

1. **Split view vs tabs**: Tabs for v1 (simpler), add split view option later

2. **Diff persistence**: `changes.jsonl` (JSONL format, one FileChangeMessage per line). Each entry contains full cumulative diff.

3. **Multiple turns per conversation**: Yes. Conversations support back-and-forth with multiple turns tracked in `metadata.turns[]`.

4. **Cancel running agents**: Defer to v2 (listed as non-goal in agent-execution-system.md)

5. **Message file format**: JSONL (append-only, better for streaming performance)

6. **API key passing**: Environment variable via shell plugin. Will be replaced with secure solution later.

7. **Diff format**: Full cumulative diff from HEAD (`git diff HEAD -- <file>`). No deltas, no aggregation needed.

8. **Real-time delivery**: Stdout streaming for low-latency display, file system for persistence. File watching rejected (not designed for high-frequency streaming). **Disk always wins** - files are source of truth.

9. **Binary files**: Skipped entirely (not emitted as FileChangeMessage), similar to GitHub's behavior.

10. **Human-in-the-loop**: Diff viewer enables review of changes as they happen.

11. **Git required**: Working directories must be git repositories. Simplifies diff generation.

12. **Collapsed regions in diff**: Supported. Full file content loaded upfront to enable virtualization; collapsed regions expand instantly without additional loading.

13. **Conversation listing**: ConversationStore loads all conversations on startup, available via Zustand store.

14. **Type derivation**: Install `@anthropic-ai/sdk` as explicit dependency. Import and use SDK types directly (`TextBlock`, `ToolUseBlock`, etc.). Only define custom types for app-specific concepts not in SDK (`FileChangeMessage`, `ConversationMetadata`, `CompleteMessage`).

15. **TTL/cleanup**: `ttlMs` field in ConversationMetadata for future cleanup. Not implemented in v1.

---

## Deferred to v2

1. **Conflict detection**: When human edits a file while agent is running - detection and notification
2. **Cancel running agents**: Ability to stop an agent mid-execution
3. **TTL cleanup**: Automatic cleanup of old conversations based on `ttlMs`
4. **Schema versioning**: Migration path for changed message formats

---

## References

- Agent Execution System: `plans/agent-execution-system.md`
- Conversation Chat UI: `plans/conversation-chat-ui.md`
- Diff Viewer: `plans/diff-viewer.md`

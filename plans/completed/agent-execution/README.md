# Agent Execution System

Implements a system to spawn Node.js processes from Tauri that execute agents using `@anthropic-ai/claude-agent-sdk`, streaming results back to the frontend in real-time.

**SDK Documentation:**
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/api/agent-sdk/typescript)
- [Hooks Guide](https://platform.claude.com/docs/en/agent-sdk/hooks)
- [NPM: @anthropic-ai/claude-agent-sdk](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)

## Key Principles

- **Disk always wins**: All state is persisted to disk. Entity services (`src/entities/`) manage this persistence - they write JSON files that are the source of truth.
- **State backed by entities**: All application state flows through entity services. The agent runner receives pre-created conversation IDs and paths from the frontend. Entity metadata is loaded from disk on app startup via `hydrateEntities()`.
- **Entity persistence vs message logs**: Entity metadata (`ConversationMetadata`, `TaskMetadata`) is persisted via entity services to `.anvil/*.json`. Raw message streams (`messages.jsonl`, `changes.jsonl`) are written directly by the agent runner to a subdirectory.
- **Use Anthropic SDK types**: Install `@anthropic-ai/sdk` and use its types directly. Do NOT define custom types for concepts that already exist in the SDK (e.g., `ContentBlock`, `ToolUseBlock`, `TextBlock`). Only define custom types for app-specific concepts.
- **Git required**: Working directories must be git repositories.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Tauri App                               │
│                                                                      │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │                      React Frontend                            │   │
│  │  ┌──────────────────┐  ┌─────────────────────────────────────┐ │   │
│  │  │ Entity Services  │  │ useAgentExecution() hook            │ │   │
│  │  │ • taskService    │  │ • calls conversationService.create()│ │   │
│  │  │ • conversationSvc│◄─┤ • spawns agent runner               │ │   │
│  │  │ • settingsService│  │ • updates entity status via service │ │   │
│  │  └──────────────────┘  └─────────────────────────────────────┘ │   │
│  │           │                           │                        │   │
│  │           ▼                           │ shell plugin: spawn    │   │
│  │  .anvil/{tasks,conversations}/*.json   │                        │   │
│  │                                       ▼                        │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ agents/runner.ts                                              │    │
│  │ • Receives conversation path from frontend                    │    │
│  │ • Writes messages.jsonl, changes.jsonl (raw streams)          │    │
│  │ • Emits JSONL to stdout for real-time display                 │    │
│  │ • Uses @anthropic-ai/claude-agent-sdk                         │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

## Entity Integration

All state flows through the entity layer (`src/entities/`):

| Entity | Service | Responsibility |
|--------|---------|----------------|
| Task | `taskService` | Creates tasks, links conversations via `conversationIds` |
| Conversation | `conversationService` | Creates/updates conversation metadata, status, turns |
| Settings | `settingsService` | Provides `anthropicApiKey` for agent execution |
| Repository | `repoService` | Provides working directory path |

**Flow:**
1. Frontend calls `conversationService.create({ taskId, agentType, ... })` → persists metadata
2. Frontend spawns agent runner with `--conversation-path` pointing to created conversation
3. Agent runner writes `messages.jsonl` to that path, emits to stdout
4. Frontend updates entity via `conversationService.update()` on completion/error
5. Entity stores update → React components re-render

## Subplans

These can be executed in parallel:

| Plan | Description | Files Owned |
|------|-------------|-------------|
| [01-agent-runner.md](./01-agent-runner.md) | Node.js agent runner using Claude SDK | `agents/**` |
| [02-tauri-integration.md](./02-tauri-integration.md) | Tauri shell plugin setup & config | `src-tauri/**`, root `package.json` |
| [03-frontend-service.md](./03-frontend-service.md) | React hooks and agent service | `src/lib/agent-service.ts`, `src/hooks/use-agent-*.ts` |

## Contracts

All subplans share these contracts.

### Type Strategy

**Entity types are defined in `src/entities/`:**

```typescript
// ✅ DO: Import entity types from the entity layer
import type { ConversationMetadata, ConversationTurn } from "@/entities/conversations/types";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { WorkspaceSettings } from "@/entities/settings/types";
```

**SDK types from `@anthropic-ai/sdk`:**

```typescript
// ✅ DO: Import and use SDK types directly for message content
import type { ContentBlock, ToolUseBlock, TextBlock } from "@anthropic-ai/sdk/resources/messages";

// ✅ DO: Extend SDK types when adding app-specific fields
interface AgentTextMessage extends TextBlock {
  timestamp: number;
}

// ❌ DON'T: Redefine types that exist in the SDK or entities
interface TextMessage {
  type: "text";
  content: string;  // This already exists in TextBlock!
}
```

### Entity Types (from `src/entities/`)

**ConversationMetadata** (`src/entities/conversations/types.ts`):
```typescript
interface ConversationMetadata {
  id: string;
  taskId: string;
  agentType: string;
  workingDirectory: string;
  status: "idle" | "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  git?: { branch: string; commitHash?: string; };
  turns: ConversationTurn[];
}
```

**TaskMetadata** (`src/entities/tasks/types.ts`):
```typescript
interface TaskMetadata {
  id: string;
  title: string;
  status: "backlog" | "todo" | "in-progress" | "done";
  conversationIds: string[];  // Links to conversations
  // ... other fields
}
```

### Message Types

The agent runner emits messages based on SDK types. App-specific message types (defined in `src/lib/types/agent-messages.ts`) should:
- Derive from `@anthropic-ai/sdk` types where applicable
- Only add custom types for concepts not in SDK (`FileChangeMessage`, `CompleteMessage`, etc.)

### Storage Layout

```
.anvil/
├── tasks/
│   ├── {taskId}.json       # TaskMetadata (managed by taskService)
│   └── {taskId}.md         # Task content
├── conversations/
│   ├── {convId}.json       # ConversationMetadata (managed by conversationService)
│   ├── {convId}/
│   │   ├── messages.jsonl  # Raw message stream (managed by agent runner)
│   │   └── changes.jsonl   # File changes (managed by agent runner)
└── settings.json           # WorkspaceSettings (managed by settingsService)
```

### CLI Interface

The agent runner accepts these arguments:
```
node runner.js \
  --agent <agentType> \
  --cwd <workingDirectory> \
  --prompt <prompt> \
  --conversation-id <uuid> \
  --conversation-path <path>
```

**Important:** The frontend creates the conversation via `conversationService.create()` BEFORE spawning the runner. The runner receives:
- `--conversation-id`: The ID of the already-created conversation entity
- `--conversation-path`: The path where the runner writes `messages.jsonl` and `changes.jsonl`

The runner manages:
- Creating and checking out a task branch (`anvil/{conversation-id}`)
- Writing `messages.jsonl` and `changes.jsonl` to the conversation path
- Emitting JSONL to stdout for real-time streaming

The runner does NOT manage:
- Creating conversation metadata (done by `conversationService.create()`)
- Updating conversation status (done by frontend via `conversationService.update()`)

Environment variables:
- `ANTHROPIC_API_KEY` - Required for Claude SDK

### stdout Protocol

Agent outputs JSONL to stdout (one JSON object per line):
```jsonl
{"type":"text","content":"...","timestamp":1702000001000}
{"type":"tool_use","id":"tool_1","name":"Read","input":{...},"timestamp":1702000002000}
{"type":"complete","durationMs":60000,"success":true,"diff":"...","timestamp":1702000060000}
```

## Non-Goals (Deferred)

- Cancel running agents mid-execution
- Queue multiple agent runs
- History of past runs
- Complex agent configuration UI

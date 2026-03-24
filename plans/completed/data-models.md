# Anvil Data Models - Implementation Guide

This document provides scaffolding for implementing entity stores and services. For complete type definitions, see the type files directly. For architectural context, see `system-integration.md`.

---

## Architecture: Service Layer Pattern

We use a **service layer** pattern to separate concerns:

```
Component → Service → Persistence
               ↘ Store (via events)
```

### Why Services Over Hooks

Putting business logic in custom hooks leads to:
- Logic scattered across dozens of hook files
- Hard to test (React dependency)
- Hard to reuse outside React (workers, Tauri commands)

Services provide:
- **Testability**: Plain functions, no React dependency
- **Colocated logic**: Business logic grouped by domain
- **Portability**: Works outside React (Tauri commands, workers, etc.)
- **Thin stores**: Stores stay dumb, services own orchestration

### Layer Responsibilities

| Layer | Responsibility |
|-------|----------------|
| **Components** | UI rendering, call services on user actions |
| **Services** | Business logic, validation, persistence, event emission |
| **Stores** | State container, reducers for events, selectors |
| **Persistence** | Low-level disk I/O via Tauri commands |

### Data Flow

**User action (e.g., create task):**
```
Component calls taskService.create(input)
  → Service validates input
  → Service persists to disk
  → Service emits event
  → Store reducer updates state
  → Component re-renders via selector
```

**External event (e.g., agent completes):**
```
Tauri IPC receives agent exit
  → Agent service emits event
  → Store reducer updates state
  → Component re-renders via selector
```

---

## File Structure

```
src/entities/
├── index.ts                         # Re-exports all stores, services, event bus
├── events.ts                        # Mitt event bus + event type definitions
│
├── tasks/
│   ├── index.ts                     # Re-exports store, service, types
│   ├── store.ts                     # useTaskStore() - thin state + reducers
│   ├── service.ts                   # taskService - business logic + CRUD
│   └── types.ts                     # TaskMetadata, TaskStatus, Subtask
│
├── conversations/
│   ├── index.ts                     # Re-exports store, service, types
│   ├── store.ts                     # useConversationStore()
│   ├── service.ts                   # conversationService
│   └── types.ts                     # ConversationMetadata, ConversationTurn
│
├── repositories/
│   ├── index.ts                     # Re-exports store, service, types
│   ├── store.ts                     # useRepoStore()
│   ├── service.ts                   # repoService
│   └── types.ts                     # RepositoryMetadata, RepositoryVersion
│
├── settings/
│   ├── index.ts                     # Re-exports store, service, types
│   ├── store.ts                     # useSettingsStore()
│   ├── service.ts                   # settingsService
│   └── types.ts                     # WorkspaceSettings
│
└── ...

src/lib/
├── persistence.ts                   # Low-level Tauri persistence wrapper
└── types/
    └── agent-messages.ts            # AgentMessage union (shared across systems)
```

**Naming convention**: Entity folders are always plural (`tasks/`, `conversations/`, `repositories/`, `settings/`).

**Key principle**: Each entity is a folder with:
- `types.ts` - Type definitions (contracts)
- `store.ts` - Thin Zustand store (state + reducers + selectors)
- `service.ts` - Business logic (CRUD, validation, orchestration)
- `index.ts` - Re-exports for clean imports

This enables:
- Clean imports: `import { taskService, useTaskStore, TaskMetadata } from "@/entities/tasks"`
- Testable services independent of React
- Thin stores that only handle state transitions

---

## Event-Driven Architecture

We use **mitt** for event emission with a **reducer pattern** in Zustand stores. This provides:
- Consistent event handling across all stores
- Decoupled event producers (services, Node/Rust processes) from consumers (stores)
- Explicit state machines via reducer-style handlers

### Event Bus Setup

**`src/entities/events.ts`**:

```typescript
import mitt from "mitt";
import type { ConversationMetadata } from "@/entities/conversations/types";
import type { TaskMetadata } from "@/entities/tasks/types";
import type { AgentMessage } from "@/lib/types/agent-messages";

/** All application events */
export type AppEvents = {
  // ═══════════════════════════════════════════════════════
  // Agent Process Events (emitted from Node/Rust via IPC)
  // ═══════════════════════════════════════════════════════
  "agent:spawned": { conversationId: string; taskId: string };
  "agent:message": { conversationId: string; message: AgentMessage };
  "agent:completed": { conversationId: string; exitCode: number };
  "agent:error": { conversationId: string; error: string };

  // ═══════════════════════════════════════════════════════
  // Conversation Events
  // ═══════════════════════════════════════════════════════
  "conversation:created": { metadata: ConversationMetadata };
  "conversation:updated": { id: string; updates: Partial<ConversationMetadata> };
  "conversation:status-changed": { id: string; status: ConversationMetadata["status"] };

  // ═══════════════════════════════════════════════════════
  // Task Events
  // ═══════════════════════════════════════════════════════
  "task:created": { metadata: TaskMetadata };
  "task:updated": { id: string; updates: Partial<TaskMetadata> };
  "task:deleted": { id: string };
  "task:status-changed": { id: string; status: TaskMetadata["status"] };

  // ═══════════════════════════════════════════════════════
  // Settings Events
  // ═══════════════════════════════════════════════════════
  "settings:updated": { key: string; value: unknown };
};

/** Global event bus - single instance for the app */
export const eventBus = mitt<AppEvents>();
```

---

## Thin Store Pattern

Stores contain only:
- **State**: The data
- **Reducers**: Pure state transitions (prefixed with `_handle`)
- **Selectors**: Derived data helpers
- **Hydration**: Initial load from disk

Stores do NOT contain business logic, validation, or persistence calls.

### Example: Task Store

**`src/entities/tasks/store.ts`**:

```typescript
import { create } from "zustand";
import { eventBus } from "../events";
import type { TaskMetadata, TaskStatus } from "./types";

interface TaskState {
  tasks: Record<string, TaskMetadata>;
  taskContent: Record<string, string>;
  _hydrated: boolean;
}

interface TaskActions {
  // Hydration (called once at app start)
  hydrate: (tasks: Record<string, TaskMetadata>) => void;

  // Selectors
  getRootTasks: () => TaskMetadata[];
  getSubtasks: (parentId: string) => TaskMetadata[];
  getTasksByStatus: (status: TaskStatus) => TaskMetadata[];

  // Reducers (called by event handlers - prefixed with _handle)
  _handleCreated: (metadata: TaskMetadata) => void;
  _handleUpdated: (id: string, updates: Partial<TaskMetadata>) => void;
  _handleDeleted: (id: string) => void;
  _handleContentLoaded: (id: string, content: string) => void;
}

export const useTaskStore = create<TaskState & TaskActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════
  tasks: {},
  taskContent: {},
  _hydrated: false,

  // ═══════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════
  hydrate: (tasks) => {
    set({ tasks, _hydrated: true });
  },

  // ═══════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════
  getRootTasks: () => Object.values(get().tasks).filter((t) => !t.parentId),
  getSubtasks: (parentId) => Object.values(get().tasks).filter((t) => t.parentId === parentId),
  getTasksByStatus: (status) => Object.values(get().tasks).filter((t) => t.status === status),

  // ═══════════════════════════════════════════════════════
  // Reducers (pure state transitions)
  // ═══════════════════════════════════════════════════════
  _handleCreated: (metadata) => {
    set((state) => ({ tasks: { ...state.tasks, [metadata.id]: metadata } }));
  },

  _handleUpdated: (id, updates) => {
    set((state) => ({
      tasks: { ...state.tasks, [id]: { ...state.tasks[id], ...updates } },
    }));
  },

  _handleDeleted: (id) => {
    set((state) => {
      const { [id]: _, ...rest } = state.tasks;
      const { [id]: __, ...restContent } = state.taskContent;
      return { tasks: rest, taskContent: restContent };
    });
  },

  _handleContentLoaded: (id, content) => {
    set((state) => ({ taskContent: { ...state.taskContent, [id]: content } }));
  },
}));

// ═══════════════════════════════════════════════════════
// Event Subscriptions (set up once at module load)
// ═══════════════════════════════════════════════════════
eventBus.on("task:created", ({ metadata }) => useTaskStore.getState()._handleCreated(metadata));
eventBus.on("task:updated", ({ id, updates }) => useTaskStore.getState()._handleUpdated(id, updates));
eventBus.on("task:deleted", ({ id }) => useTaskStore.getState()._handleDeleted(id));
```

---

## Service Layer Pattern

Services contain:
- **CRUD operations**: Create, read, update, delete
- **Business logic**: Validation, transformation, orchestration
- **Persistence**: Calls to Tauri commands
- **Event emission**: Notifies stores of changes

Services access stores via `getState()` for reads, and emit events for writes.

### Example: Task Service

**`src/entities/tasks/service.ts`**:

```typescript
import { persistence } from "@/lib/persistence";
import { eventBus } from "../events";
import { useTaskStore } from "./store";
import type { TaskMetadata, CreateTaskInput, UpdateTaskInput } from "./types";

export const taskService = {
  // ═══════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════
  async hydrate(): Promise<void> {
    const files = await persistence.listDir("tasks");
    const tasks: Record<string, TaskMetadata> = {};

    for (const file of files) {
      if (file.endsWith(".json")) {
        const metadata = await persistence.readJson<TaskMetadata>(`tasks/${file}`);
        if (metadata) tasks[metadata.id] = metadata;
      }
    }

    useTaskStore.getState().hydrate(tasks);
  },

  // ═══════════════════════════════════════════════════════
  // CRUD Operations
  // ═══════════════════════════════════════════════════════
  async create(input: CreateTaskInput): Promise<TaskMetadata> {
    const now = Date.now();
    const metadata: TaskMetadata = {
      id: crypto.randomUUID(),
      title: input.title,
      subtasks: [],
      status: input.status ?? "backlog",
      createdAt: now,
      updatedAt: now,
      parentId: input.parentId ?? null,
      conversationIds: [],
      tags: input.tags ?? [],
      sortOrder: now,
    };

    await persistence.writeJson(`tasks/${metadata.id}.json`, metadata);
    eventBus.emit("task:created", { metadata });
    return metadata;
  },

  async update(id: string, updates: UpdateTaskInput): Promise<void> {
    const existing = useTaskStore.getState().tasks[id];
    if (!existing) throw new Error(`Task not found: ${id}`);

    const updatedMetadata: TaskMetadata = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    await persistence.writeJson(`tasks/${id}.json`, updatedMetadata);
    eventBus.emit("task:updated", { id, updates: updatedMetadata });
  },

  async delete(id: string): Promise<void> {
    await persistence.deleteFile(`tasks/${id}.json`);
    await persistence.deleteFile(`tasks/${id}.md`);
    eventBus.emit("task:deleted", { id });
  },

  // ═══════════════════════════════════════════════════════
  // Content (lazy-loaded markdown body)
  // ═══════════════════════════════════════════════════════
  async getContent(id: string): Promise<string> {
    const cached = useTaskStore.getState().taskContent[id];
    if (cached !== undefined) return cached;

    const content = (await persistence.readText(`tasks/${id}.md`)) ?? "";
    useTaskStore.getState()._handleContentLoaded(id, content);
    return content;
  },

  async setContent(id: string, content: string): Promise<void> {
    await persistence.writeText(`tasks/${id}.md`, content);
    useTaskStore.getState()._handleContentLoaded(id, content);
  },
};
```

### Example: Conversation Service

**`src/entities/conversations/service.ts`**:

```typescript
import { persistence } from "@/lib/persistence";
import { eventBus } from "../events";
import { useConversationStore } from "./store";
import { taskService } from "../tasks/service";
import { useTaskStore } from "../tasks/store";
import type { ConversationMetadata, ConversationTurn, CreateConversationInput } from "./types";

export const conversationService = {
  async hydrate(): Promise<void> {
    const files = await persistence.listDir("conversations");
    const conversations: Record<string, ConversationMetadata> = {};

    for (const file of files) {
      if (file.endsWith(".json")) {
        const metadata = await persistence.readJson<ConversationMetadata>(`conversations/${file}`);
        if (metadata) conversations[metadata.id] = metadata;
      }
    }

    useConversationStore.getState().hydrate(conversations);
  },

  async create(input: CreateConversationInput): Promise<ConversationMetadata> {
    const now = Date.now();
    const metadata: ConversationMetadata = {
      id: crypto.randomUUID(),
      taskId: input.taskId,
      agentType: input.agentType,
      workingDirectory: input.workingDirectory,
      status: "idle",
      createdAt: now,
      updatedAt: now,
      git: input.git,
      turns: [{
        index: 0,
        prompt: input.prompt,
        startedAt: now,
        completedAt: null,
      }],
    };

    await persistence.writeJson(`conversations/${metadata.id}.json`, metadata);
    eventBus.emit("conversation:created", { metadata });

    // Link conversation to task
    const task = useTaskStore.getState().tasks[input.taskId];
    if (task) {
      await taskService.update(input.taskId, {
        conversationIds: [...task.conversationIds, metadata.id],
      });
    }

    return metadata;
  },

  async addTurn(id: string, prompt: string): Promise<void> {
    const conv = useConversationStore.getState().conversations[id];
    if (!conv) throw new Error(`Conversation not found: ${id}`);

    const newTurn: ConversationTurn = {
      index: conv.turns.length,
      prompt,
      startedAt: Date.now(),
      completedAt: null,
    };

    const updates = {
      turns: [...conv.turns, newTurn],
      updatedAt: Date.now(),
    };

    await persistence.writeJson(`conversations/${id}.json`, { ...conv, ...updates });
    eventBus.emit("conversation:updated", { id, updates });
  },

  async completeTurn(id: string, exitCode: number, costUsd?: number): Promise<void> {
    const conv = useConversationStore.getState().conversations[id];
    if (!conv) throw new Error(`Conversation not found: ${id}`);

    const turns = [...conv.turns];
    const lastTurn = turns[turns.length - 1];
    turns[turns.length - 1] = { ...lastTurn, completedAt: Date.now(), exitCode, costUsd };

    const updates = { turns, updatedAt: Date.now() };

    await persistence.writeJson(`conversations/${id}.json`, { ...conv, ...updates });
    eventBus.emit("conversation:updated", { id, updates });
  },
};
```

### Example: Settings Service

**`src/entities/settings/service.ts`**:

```typescript
import { persistence } from "@/lib/persistence";
import { eventBus } from "../events";
import { useSettingsStore } from "./store";
import type { WorkspaceSettings } from "./types";

export const settingsService = {
  async hydrate(): Promise<void> {
    const settings = await persistence.readJson<WorkspaceSettings>("settings.json");
    useSettingsStore.getState().hydrate(settings ?? { repository: null, anthropicApiKey: null });
  },

  async set<K extends keyof WorkspaceSettings>(key: K, value: WorkspaceSettings[K]): Promise<void> {
    const current = useSettingsStore.getState().workspace;
    const updated = { ...current, [key]: value };
    await persistence.writeJson("settings.json", updated);
    eventBus.emit("settings:updated", { key, value });
  },
};
```

---

## Persistence Layer

**`src/lib/persistence.ts`**:

```typescript
import { invoke } from "@tauri-apps/api/core";

/**
 * Low-level persistence via Tauri commands.
 * All paths are relative to .anvil/ directory.
 */
export const persistence = {
  async readJson<T>(path: string): Promise<T | null> {
    return invoke("read_json", { path });
  },

  async writeJson<T>(path: string, data: T): Promise<void> {
    return invoke("write_json", { path, data });
  },

  async readText(path: string): Promise<string | null> {
    return invoke("read_text", { path });
  },

  async writeText(path: string, content: string): Promise<void> {
    return invoke("write_text", { path, content });
  },

  async deleteFile(path: string): Promise<void> {
    return invoke("delete_file", { path });
  },

  async listDir(path: string): Promise<string[]> {
    return invoke("list_dir", { path });
  },
};
```

---

## Type Definitions

### Task Types

**`src/entities/tasks/types.ts`**:

```typescript
export type TaskStatus = "backlog" | "todo" | "in-progress" | "done";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskMetadata {
  id: string;
  title: string;
  subtasks: Subtask[];
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
  parentId: string | null;
  conversationIds: string[];
  tags: string[];
  sortOrder: number;
}

export interface Task extends TaskMetadata {
  content: string;
}

/** Input for creating a new task */
export interface CreateTaskInput {
  title: string;
  status?: TaskStatus;
  parentId?: string | null;
  tags?: string[];
}

/** Input for updating a task */
export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  subtasks?: Subtask[];
  tags?: string[];
  sortOrder?: number;
}
```

### Conversation Types

**`src/entities/conversations/types.ts`**:

```typescript
export interface ConversationTurn {
  index: number;
  prompt: string;
  startedAt: number;
  completedAt: number | null;
  exitCode?: number;
  costUsd?: number;
}

export interface ConversationMetadata {
  id: string;
  taskId: string;
  agentType: string;
  workingDirectory: string;
  status: "idle" | "running" | "completed" | "error";
  createdAt: number;
  updatedAt: number;
  ttlMs?: number;
  git?: {
    branch: string;
    commitHash?: string;
  };
  turns: ConversationTurn[];
}

/** Input for creating a new conversation */
export interface CreateConversationInput {
  taskId: string;
  agentType: string;
  workingDirectory: string;
  prompt: string;
  git?: {
    branch: string;
  };
}
```

### Repository Types

**`src/entities/repositories/types.ts`**:

```typescript
export interface RepositoryMetadata {
  name: string;
  originalUrl: string | null;
  sourcePath: string | null;
  useWorktrees: boolean;
  createdAt: number;
}

export interface RepositoryVersion {
  version: number;
  createdAt: number;
  path: string;
}

export interface Repository extends RepositoryMetadata {
  versions: RepositoryVersion[];
}
```

### Settings Types

**`src/entities/settings/types.ts`**:

```typescript
export interface WorkspaceSettings {
  repository: string | null;
  anthropicApiKey: string | null;
}
```

---

## Entity Index (re-exports)

**`src/entities/index.ts`**:

```typescript
// Event bus
export { eventBus, type AppEvents } from "./events";

// Tasks
export { useTaskStore } from "./tasks/store";
export { taskService } from "./tasks/service";
export * from "./tasks/types";

// Conversations
export { useConversationStore } from "./conversations/store";
export { conversationService } from "./conversations/service";
export * from "./conversations/types";

// Repositories
export { useRepoStore } from "./repositories/store";
export { repoService } from "./repositories/service";
export * from "./repositories/types";

// Settings
export { useSettingsStore } from "./settings/store";
export { settingsService } from "./settings/service";
export * from "./settings/types";
```

**`src/entities/tasks/index.ts`** (per-entity index):

```typescript
export { useTaskStore } from "./store";
export { taskService } from "./service";
export * from "./types";
```

---

## Usage Examples

### Component calling service

```tsx
import { taskService, useTaskStore } from "@/entities/tasks";

function TaskList() {
  // Subscribe to state
  const tasks = useTaskStore((s) => s.getRootTasks());

  // Call service for mutations
  const handleCreate = async () => {
    await taskService.create({ title: "New task" });
  };

  const handleDelete = async (id: string) => {
    await taskService.delete(id);
  };

  return (
    <ul>
      {tasks.map((task) => (
        <li key={task.id}>
          {task.title}
          <button onClick={() => handleDelete(task.id)}>Delete</button>
        </li>
      ))}
      <button onClick={handleCreate}>Add Task</button>
    </ul>
  );
}
```

### App-level hydration

```tsx
import { taskService, conversationService, settingsService } from "@/entities";

async function hydrateApp() {
  await Promise.all([
    taskService.hydrate(),
    conversationService.hydrate(),
    settingsService.hydrate(),
  ]);
}
```

---

## Implementation Phases

### Phase 1: Persistence Layer
- [ ] Create Tauri commands: `read_json`, `write_json`, `read_text`, `write_text`, `delete_file`, `list_dir`
- [ ] Create `src/lib/persistence.ts` wrapper

### Phase 2: Event Bus
- [ ] Create `src/entities/events.ts` with mitt event bus and AppEvents type

### Phase 3: Settings Entity (simplest)
- [ ] `src/entities/settings/types.ts`
- [ ] `src/entities/settings/store.ts` (thin store)
- [ ] `src/entities/settings/service.ts` (hydrate, set)
- [ ] `src/entities/settings/index.ts`

### Phase 4: Task Entity
- [ ] `src/entities/tasks/types.ts`
- [ ] `src/entities/tasks/store.ts` (thin store)
- [ ] `src/entities/tasks/service.ts` (full CRUD)
- [ ] `src/entities/tasks/index.ts`

### Phase 5: Conversation Entity
- [ ] `src/entities/conversations/types.ts`
- [ ] `src/entities/conversations/store.ts` (thin store)
- [ ] `src/entities/conversations/service.ts` (CRUD + turn management)
- [ ] `src/entities/conversations/index.ts`

### Phase 6: Repository Entity
- [ ] `src/entities/repositories/types.ts`
- [ ] `src/entities/repositories/store.ts`
- [ ] `src/entities/repositories/service.ts`
- [ ] `src/entities/repositories/index.ts`

### Phase 7: Entities Index & Integration
- [ ] `src/entities/index.ts` (re-exports)
- [ ] Bridge agent process stdout to event bus
- [ ] Bridge Tauri events to event bus
- [ ] App-level hydration orchestration

---

## NPM Dependencies

```bash
pnpm add zustand mitt
pnpm add @anthropic-ai/sdk  # For agent message types
```

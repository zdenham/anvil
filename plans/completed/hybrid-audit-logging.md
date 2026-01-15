# Hybrid Audit Logging for .mort Directory

## Overview

Implement a hybrid approach to tracking history in the `.mort` directory that combines:

1. **Structured audit logs** - Queryable JSON arrays per entity for UI display
2. **Git tracking** - Full content history with commit references in audit entries

This gives us the best of both worlds: easy-to-query structured data for the UI, plus full git history for content diffs and point-in-time reconstruction.

---

## Goals

- Display task/conversation history timeline to users
- Track who/what made changes (user, agent, system)
- Reference git commits for content changes
- Support queries like "show all status changes for task X"
- Enable "what changed" diffs via git

---

## Architecture

```
~/.mort/
├── .git/                          # Git repo for full history
├── tasks/
│   ├── {task-id}.json             # TaskMetadata (current state)
│   ├── {task-id}.md               # Task content
│   └── {task-id}.audit.json       # AuditLog (structured history)
├── conversations/
│   ├── {conv-id}.json
│   └── {conv-id}.audit.json
└── ...
```

### Audit Entry Structure

```typescript
interface AuditEntry {
  id: string;                       // UUID for the entry
  timestamp: number;                // Unix ms
  action: AuditAction;              // Typed action enum
  actor: AuditActor;                // Who made the change
  details: Record<string, unknown>; // Action-specific data
  commitHash?: string;              // Git commit if content changed
}

type AuditAction =
  // Task actions
  | "task:created"
  | "task:status_changed"
  | "task:title_changed"
  | "task:content_changed"
  | "task:subtask_added"
  | "task:subtask_completed"
  | "task:subtask_removed"
  | "task:tag_added"
  | "task:tag_removed"
  | "task:conversation_linked"
  | "task:conversation_unlinked"
  | "task:deleted"
  // Conversation actions
  | "conversation:created"
  | "conversation:status_changed"
  | "conversation:turn_added"
  | "conversation:completed"
  | "conversation:error";

interface AuditActor {
  type: "user" | "agent" | "system";
  id?: string;                      // conversationId for agents
  name?: string;                    // Display name
}

interface AuditLog {
  entityId: string;
  entityType: "task" | "conversation";
  entries: AuditEntry[];
}
```

### Example Audit Log

```json
{
  "entityId": "task-abc123",
  "entityType": "task",
  "entries": [
    {
      "id": "entry-1",
      "timestamp": 1703300000000,
      "action": "task:created",
      "actor": { "type": "user" },
      "details": { "title": "Implement dark mode" }
    },
    {
      "id": "entry-2",
      "timestamp": 1703300100000,
      "action": "task:status_changed",
      "actor": { "type": "user" },
      "details": { "from": "backlog", "to": "in-progress" }
    },
    {
      "id": "entry-3",
      "timestamp": 1703300200000,
      "action": "task:content_changed",
      "actor": { "type": "agent", "id": "conv-xyz789" },
      "details": { "summary": "Added implementation notes" },
      "commitHash": "a1b2c3d"
    },
    {
      "id": "entry-4",
      "timestamp": 1703300300000,
      "action": "task:subtask_completed",
      "actor": { "type": "agent", "id": "conv-xyz789" },
      "details": { "subtaskId": "st-1", "title": "Create theme context" }
    }
  ]
}
```

---

## Implementation

### 1. Initialize Git in .mort Directory

**File: `src/lib/persistence.ts`**

Add method to initialize git repo on first run:

```typescript
async initGitRepo(): Promise<void> {
  const gitDir = path.join(this.basePath, ".git");
  if (await this.exists(gitDir)) return;

  await this.runGit(["init"]);
  await this.runGit(["config", "user.name", "Mort"]);
  await this.runGit(["config", "user.email", "mort@local"]);

  // Create .gitignore for files we don't want to track
  await this.writeText(".gitignore", [
    "# Ignore lock files",
    "*.lock",
    "",
    "# Ignore temporary files",
    "*.tmp",
  ].join("\n"));

  await this.commitAll("Initialize .mort directory");
}

async commitAll(message: string): Promise<string | null> {
  await this.runGit(["add", "-A"]);

  // Check if there are changes to commit
  const status = await this.runGit(["status", "--porcelain"]);
  if (!status.trim()) return null;

  await this.runGit(["commit", "-m", message]);

  // Return the commit hash
  const hash = await this.runGit(["rev-parse", "HEAD"]);
  return hash.trim();
}

private async runGit(args: string[]): Promise<string> {
  // Run git command in .mort directory
  // Use Tauri command or child_process
}
```

### 2. Create Audit Types

**File: `src/entities/audit/types.ts`** (new)

```typescript
export interface AuditEntry {
  id: string;
  timestamp: number;
  action: AuditAction;
  actor: AuditActor;
  details: Record<string, unknown>;
  commitHash?: string;
}

export type AuditAction =
  // Task actions
  | "task:created"
  | "task:status_changed"
  | "task:title_changed"
  | "task:content_changed"
  | "task:subtask_added"
  | "task:subtask_completed"
  | "task:subtask_removed"
  | "task:tag_added"
  | "task:tag_removed"
  | "task:conversation_linked"
  | "task:conversation_unlinked"
  | "task:deleted"
  // Conversation actions
  | "conversation:created"
  | "conversation:status_changed"
  | "conversation:turn_added"
  | "conversation:completed"
  | "conversation:error";

export interface AuditActor {
  type: "user" | "agent" | "system";
  id?: string;
  name?: string;
}

export interface AuditLog {
  entityId: string;
  entityType: "task" | "conversation";
  entries: AuditEntry[];
}

export interface AuditContext {
  actor: AuditActor;
}
```

### 3. Create Audit Service

**File: `src/entities/audit/service.ts`** (new)

```typescript
import { v4 as uuid } from "uuid";
import { persistence } from "@/lib/persistence";
import type { AuditEntry, AuditLog, AuditAction, AuditActor } from "./types";

const AUDIT_SUFFIX = ".audit.json";

class AuditService {
  private currentActor: AuditActor = { type: "user" };

  /**
   * Set the current actor context (call this when agent starts/stops)
   */
  setActor(actor: AuditActor): void {
    this.currentActor = actor;
  }

  resetActor(): void {
    this.currentActor = { type: "user" };
  }

  /**
   * Append an audit entry for an entity
   */
  async append(
    entityType: "task" | "conversation",
    entityId: string,
    action: AuditAction,
    details: Record<string, unknown>,
    options?: { commitMessage?: string }
  ): Promise<AuditEntry> {
    const dir = entityType === "task" ? "tasks" : "conversations";
    const auditPath = `${dir}/${entityId}${AUDIT_SUFFIX}`;

    // Load or create audit log
    let log: AuditLog;
    try {
      log = await persistence.readJson<AuditLog>(auditPath);
    } catch {
      log = { entityId, entityType, entries: [] };
    }

    // Commit to git if requested (for content changes)
    let commitHash: string | undefined;
    if (options?.commitMessage) {
      commitHash = await persistence.commitAll(options.commitMessage) ?? undefined;
    }

    // Create entry
    const entry: AuditEntry = {
      id: uuid(),
      timestamp: Date.now(),
      action,
      actor: { ...this.currentActor },
      details,
      commitHash,
    };

    log.entries.push(entry);

    await persistence.writeJson(auditPath, log);

    return entry;
  }

  /**
   * Get audit log for an entity
   */
  async getLog(
    entityType: "task" | "conversation",
    entityId: string
  ): Promise<AuditLog | null> {
    const dir = entityType === "task" ? "tasks" : "conversations";
    const auditPath = `${dir}/${entityId}${AUDIT_SUFFIX}`;

    try {
      return await persistence.readJson<AuditLog>(auditPath);
    } catch {
      return null;
    }
  }

  /**
   * Query entries by action type
   */
  async queryByAction(
    entityType: "task" | "conversation",
    entityId: string,
    actions: AuditAction[]
  ): Promise<AuditEntry[]> {
    const log = await this.getLog(entityType, entityId);
    if (!log) return [];
    return log.entries.filter((e) => actions.includes(e.action));
  }

  /**
   * Get diff for a specific commit
   */
  async getCommitDiff(commitHash: string): Promise<string> {
    return persistence.runGit(["show", commitHash, "--stat"]);
  }

  /**
   * Get content at a specific commit
   */
  async getContentAtCommit(
    entityType: "task" | "conversation",
    entityId: string,
    commitHash: string
  ): Promise<string | null> {
    const dir = entityType === "task" ? "tasks" : "conversations";
    const contentPath = `${dir}/${entityId}.md`;

    try {
      return await persistence.runGit(["show", `${commitHash}:${contentPath}`]);
    } catch {
      return null;
    }
  }
}

export const auditService = new AuditService();
```

### 4. Integrate Audit into Task Service

**File: `src/entities/tasks/service.ts`**

Modify existing methods to append audit entries:

```typescript
import { auditService } from "@/entities/audit/service";

// In create()
async create(input: CreateTaskInput): Promise<TaskMetadata> {
  const task = { /* ... */ };

  await optimistic(/* ... */);

  await auditService.append("task", task.id, "task:created", {
    title: task.title,
    status: task.status,
  });

  return task;
}

// In update()
async update(id: string, updates: UpdateTaskInput): Promise<TaskMetadata> {
  const existing = useTaskStore.getState().tasks[id];
  const updated = { ...existing, ...updates, updatedAt: Date.now() };

  await optimistic(/* ... */);

  // Audit status changes
  if (updates.status && updates.status !== existing.status) {
    await auditService.append("task", id, "task:status_changed", {
      from: existing.status,
      to: updates.status,
    });
  }

  // Audit title changes
  if (updates.title && updates.title !== existing.title) {
    await auditService.append("task", id, "task:title_changed", {
      from: existing.title,
      to: updates.title,
    });
  }

  return updated;
}

// In updateContent()
async updateContent(id: string, content: string): Promise<void> {
  await persistence.writeText(`tasks/${id}.md`, content);

  await auditService.append(
    "task",
    id,
    "task:content_changed",
    { contentLength: content.length },
    { commitMessage: `Update task ${id} content` }
  );
}

// In addSubtask()
async addSubtask(taskId: string, subtask: Subtask): Promise<void> {
  // ... existing logic ...

  await auditService.append("task", taskId, "task:subtask_added", {
    subtaskId: subtask.id,
    title: subtask.title,
  });
}

// In completeSubtask()
async completeSubtask(taskId: string, subtaskId: string): Promise<void> {
  const task = useTaskStore.getState().tasks[taskId];
  const subtask = task.subtasks.find((s) => s.id === subtaskId);

  // ... existing logic ...

  await auditService.append("task", taskId, "task:subtask_completed", {
    subtaskId,
    title: subtask?.title,
  });
}
```

### 5. Set Actor Context for Agents

**File: `src/services/agent-service.ts`** (or equivalent)

```typescript
import { auditService } from "@/entities/audit/service";

async startAgent(options: StartAgentOptions) {
  // Set actor context before agent runs
  auditService.setActor({
    type: "agent",
    id: options.conversationId,
    name: options.agentType,
  });

  try {
    // ... run agent ...
  } finally {
    // Reset actor when done
    auditService.resetActor();
  }
}
```

### 6. Create Audit History UI Component

**File: `src/components/history/history-timeline.tsx`** (new)

```typescript
interface HistoryTimelineProps {
  entityType: "task" | "conversation";
  entityId: string;
}

export function HistoryTimeline({ entityType, entityId }: HistoryTimelineProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);

  useEffect(() => {
    auditService.getLog(entityType, entityId).then((log) => {
      if (log) setEntries(log.entries.reverse()); // Newest first
    });
  }, [entityType, entityId]);

  return (
    <div className="history-timeline">
      {entries.map((entry) => (
        <HistoryEntry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function HistoryEntry({ entry }: { entry: AuditEntry }) {
  return (
    <div className="history-entry">
      <div className="timestamp">{formatRelativeTime(entry.timestamp)}</div>
      <div className="action">{formatAction(entry.action, entry.details)}</div>
      <div className="actor">{formatActor(entry.actor)}</div>
      {entry.commitHash && (
        <button onClick={() => showDiff(entry.commitHash)}>
          View changes
        </button>
      )}
    </div>
  );
}

function formatAction(action: AuditAction, details: Record<string, unknown>): string {
  switch (action) {
    case "task:created":
      return `Created task "${details.title}"`;
    case "task:status_changed":
      return `Changed status from ${details.from} to ${details.to}`;
    case "task:content_changed":
      return "Updated content";
    case "task:subtask_completed":
      return `Completed "${details.title}"`;
    // ... etc
  }
}

function formatActor(actor: AuditActor): string {
  if (actor.type === "user") return "You";
  if (actor.type === "agent") return actor.name || "Agent";
  return "System";
}
```

### 7. Add History Panel to Task Detail View

**File: `src/components/task/task-detail.tsx`**

Add a collapsible history panel:

```typescript
import { HistoryTimeline } from "@/components/history/history-timeline";

function TaskDetail({ taskId }: { taskId: string }) {
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div>
      {/* ... existing task detail UI ... */}

      <button onClick={() => setShowHistory(!showHistory)}>
        {showHistory ? "Hide" : "Show"} History
      </button>

      {showHistory && (
        <HistoryTimeline entityType="task" entityId={taskId} />
      )}
    </div>
  );
}
```

### 8. Initialize Git on App Startup

**File: `src/app.tsx`** (or startup location)

```typescript
useEffect(() => {
  persistence.initGitRepo().catch(console.error);
}, []);
```

---

## Files to Create

| File | Description |
|------|-------------|
| `src/entities/audit/types.ts` | Audit entry and log types |
| `src/entities/audit/service.ts` | Audit service with append/query methods |
| `src/entities/audit/index.ts` | Public exports |
| `src/components/history/history-timeline.tsx` | Timeline UI component |
| `src/components/history/history-entry.tsx` | Individual entry component |

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/persistence.ts` | Add git methods (init, commit, show) |
| `src/entities/tasks/service.ts` | Add audit calls to all mutations |
| `src/entities/conversations/service.ts` | Add audit calls |
| `src/services/agent-service.ts` | Set/reset actor context |
| `src/components/task/task-detail.tsx` | Add history panel |
| `src/app.tsx` | Initialize git on startup |

---

## Implementation Order

1. [ ] Add git methods to `persistence.ts` (init, commitAll, runGit)
2. [ ] Create `src/entities/audit/` with types and service
3. [ ] Initialize git repo on app startup
4. [ ] Integrate audit into `taskService` mutations
5. [ ] Integrate audit into `conversationService` mutations
6. [ ] Add actor context management for agents
7. [ ] Create `HistoryTimeline` component
8. [ ] Add history panel to task detail view
9. [ ] Add history panel to conversation view

---

## Git Commit Strategy

**When to commit:**
- Content changes (`.md` files) - always commit with descriptive message
- Metadata changes (`.json` files) - batch commits periodically or on significant changes

**Commit message format:**
```
[task|conversation] <entity-id-prefix>: <action>

Examples:
- task abc123: Update content
- task abc123: Status changed to in-progress
- conversation xyz789: Turn 3 completed
```

**Batching consideration:**
For high-frequency changes (like conversation turns), consider:
- Commit on conversation completion rather than every turn
- Or use a debounced commit (commit if no changes for N seconds)

---

## Query Examples

```typescript
// Get all status changes for a task
const statusChanges = await auditService.queryByAction(
  "task",
  taskId,
  ["task:status_changed"]
);

// Get timeline for UI (all entries)
const log = await auditService.getLog("task", taskId);
const timeline = log?.entries.reverse(); // Newest first

// Get content diff for a specific change
const entry = timeline.find(e => e.commitHash);
if (entry?.commitHash) {
  const diff = await auditService.getCommitDiff(entry.commitHash);
}

// Reconstruct content at point in time
const oldContent = await auditService.getContentAtCommit(
  "task",
  taskId,
  commitHash
);
```

---

## Future Enhancements

- **Audit log pruning** - Archive old entries to separate files
- **Undo support** - Use git to revert specific commits
- **Activity feed** - Aggregate audit entries across all entities
- **Search** - Full-text search across audit logs
- **Export** - Export history as markdown/PDF
- **Diff viewer** - Side-by-side content comparison using git diff

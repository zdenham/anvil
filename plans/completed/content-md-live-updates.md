# Content.md Live Updates Architecture

## Problem Summary

Live content.md updates don't work reliably because:
1. The current mechanism relies on a fragile `contentMdUpdatedAt` timestamp chain with prop drilling
2. Task directory renames can cause stale paths when fetching content
3. Detection only happens for content.md writes specifically (pattern matching in runner)

---

## Current Architecture (Fragile)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AGENT PROCESS                                  │
│                                                                          │
│   Write/Edit tool ──▶ PostToolUse hook ──▶ Pattern match content.md?    │
│                                                   │                      │
│                                          YES      │      NO              │
│                                           ▼       │       ▼              │
│                              markContentMdUpdated()    (nothing)         │
│                                           │                              │
│                                           ▼                              │
│                              emitState() with contentMdUpdatedAt         │
└───────────────────────────────────────────┼─────────────────────────────┘
                                            │ stdout
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
│                                                                          │
│   Parse JSON ──▶ eventBus.emit("agent:state") ──▶ useStreamingThread    │
│                                                          │               │
│                                                          ▼               │
│                                              setStreamingState()         │
│                                                          │               │
│                                                          ▼               │
│                                           task-workspace.tsx             │
│                                           extracts contentMdUpdatedAt    │
│                                                          │               │
│                                                    (prop drilling)       │
│                                                          ▼               │
│                                              MainContentPane             │
│                                                          │               │
│                                                    (prop drilling)       │
│                                                          ▼               │
│                                              TaskOverview                │
│                                              useEffect([contentMdUpdatedAt])
│                                                          │               │
│                                                          ▼               │
│                                              refreshContent(taskId)      │
│                                              uses task.slug from store   │
│                                                     ▲                    │
│                                                     │                    │
│                                              PROBLEM: slug may be stale! │
└─────────────────────────────────────────────────────────────────────────┘
```

### Failure Points

1. **Pattern match in runner** - Only content.md writes trigger update
2. **Timestamp lost in transit** - Multiple serialization/parsing steps
3. **Prop drilling** - contentMdUpdatedAt must pass through 3 components
4. **Stale slug** - Task can be renamed, but we read from old path

---

## Proposed Architecture (Event-Based)

Add a new event `agent:tool-completed` that fires on any tool result, letting TaskOverview subscribe directly.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AGENT PROCESS                                  │
│                                                                          │
│   Any tool completes ──▶ emitState() with updated messages[]            │
│                                                                          │
│   (No special content.md detection needed - remove markContentMdUpdated)│
└───────────────────────────────────────────┼─────────────────────────────┘
                                            │ stdout
                                            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           FRONTEND                                       │
│                                                                          │
│   agent-service.ts:                                                     │
│                                                                          │
│   Parse JSON ──▶ callbacks.onState(state)                               │
│                      │                                                   │
│                      ├──▶ eventBus.emit("agent:state", {threadId, state})
│                      │                                                   │
│                      └──▶ Detect new tool_results in messages?          │
│                                   │                                      │
│                              YES  │                                      │
│                                   ▼                                      │
│                           eventBus.emit("agent:tool-completed", {       │
│                             threadId,                                    │
│                             taskId  // from thread metadata              │
│                           })                                             │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                            │
           ┌────────────────────────────────┴─────────────────────────────┐
           │                                                              │
           ▼                                                              ▼
┌─────────────────────────┐                              ┌─────────────────────────┐
│  useStreamingThread     │                              │  TaskOverview           │
│  (existing behavior)    │                              │                         │
│                         │                              │  useEffect(() => {      │
│  Subscribes to          │                              │    const handler = () =>│
│  "agent:state"          │                              │      refreshWithSlug(); │
│                         │                              │    eventBus.on(         │
└─────────────────────────┘                              │      "agent:tool-completed",
                                                         │      handler            │
                                                         │    );                   │
                                                         │  }, [taskId]);          │
                                                         │                         │
                                                         │  async refreshWithSlug()│
                                                         │  {                      │
                                                         │    // 1. Refresh task   │
                                                         │    //    metadata first │
                                                         │    await taskService    │
                                                         │      .refreshTask(id);  │
                                                         │                         │
                                                         │    // 2. Now refresh    │
                                                         │    //    content with   │
                                                         │    //    correct slug   │
                                                         │    const content =      │
                                                         │      await taskService  │
                                                         │        .refreshContent();│
                                                         │    setContent(content); │
                                                         │  }                      │
                                                         └─────────────────────────┘
```

---

## Implementation Steps

### 1. Add New Event Type

**File:** `src/entities/events.ts`

```typescript
export type AppEvents = {
  // ... existing events ...

  /**
   * Emitted when a tool completes execution.
   * TaskOverview subscribes to refresh content.md after any tool use.
   */
  "agent:tool-completed": {
    threadId: string;
    taskId: string | null;
  };
};
```

### 2. Add to Broadcast Events

**File:** `src/lib/event-bridge.ts`

```typescript
const BROADCAST_EVENTS = [
  "agent:spawned",
  "agent:state",
  "agent:completed",
  "agent:error",
  "agent:tool-completed",  // ← Add this
  // ...
] as const;
```

### 3. Emit Event on Tool Completion

**File:** `src/lib/agent-service.ts`

Track the previous tool result count and emit when it increases:

```typescript
// Inside prepareAgent, before command setup:
let lastToolResultCount = 0;

command.stdout.on("data", (chunk: string) => {
  // ... existing parsing logic ...

  for (const line of lines) {
    try {
      const state = JSON.parse(line) as ThreadState;
      callbacks.onState(state);
      detectAnvilMutations(state);

      // NEW: Detect tool completion and emit event
      const currentCount = countToolResults(state.messages);
      if (currentCount > lastToolResultCount) {
        lastToolResultCount = currentCount;
        eventBus.emit("agent:tool-completed", {
          threadId: thread.id,
          taskId: options.taskId,
        });
      }
    } catch {
      // ...
    }
  }
});

// Helper function
function countToolResults(messages: MessageParam[]): number {
  let count = 0;
  for (const msg of messages) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_result") count++;
      }
    }
  }
  return count;
}
```

### 4. Add `resolveSlug` Helper to Task Service

**File:** `src/entities/tasks/service.ts`

Add a helper that finds the correct slug given a task ID, handling cases where the task directory was renamed:

```typescript
/**
 * Resolves the correct slug for a task, handling potential renames.
 *
 * When the agent renames a task (e.g., draft-123 → fix-auth-bug), the cached
 * slug in the store becomes stale. This helper:
 * 1. Checks if metadata.json exists at the cached slug
 * 2. If not, uses grep to quickly find the task by ID across all metadata files
 * 3. Updates the store with the correct metadata
 *
 * Returns the correct slug, or null if task not found anywhere.
 */
async resolveSlug(taskId: string): Promise<string | null> {
  const cachedTask = useTaskStore.getState().tasks[taskId];

  if (cachedTask) {
    // Check if metadata.json exists at the cached slug
    const metadataExists = await persistence.exists(
      `${TASKS_DIR}/${cachedTask.slug}/metadata.json`
    );
    if (metadataExists) {
      // Cached slug is still valid
      return cachedTask.slug;
    }
    // Cached slug is stale - fall through to grep search
    logger.debug(`[taskService.resolveSlug] Stale slug detected for ${taskId}: ${cachedTask.slug}`);
  }

  // Fast grep search across all metadata files
  const slug = await persistence.grepTaskId(taskId);
  if (slug) {
    // Found the task - read full metadata and update store
    const metadata = await persistence.readJson<TaskMetadata>(
      `${TASKS_DIR}/${slug}/metadata.json`
    );
    if (metadata) {
      logger.debug(`[taskService.resolveSlug] Found task ${taskId} at slug: ${slug}`);
      useTaskStore.getState()._applyUpdate(taskId, metadata);
      return slug;
    }
  }

  // Task not found anywhere
  if (cachedTask) {
    // Remove stale entry from store
    logger.debug(`[taskService.resolveSlug] Task ${taskId} not found on disk, removing from store`);
    useTaskStore.getState()._applyDelete(taskId);
  }
  return null;
},
```

### 4b. Add `grepTaskId` Helper to Persistence

**File:** `src/lib/persistence.ts`

Add a helper that uses grep to quickly find a task ID across metadata files:

```typescript
/**
 * Searches for a task ID across all metadata.json files using grep.
 * Returns the slug (directory name) if found, null otherwise.
 *
 * Much faster than iterating directories and parsing each JSON file.
 */
async grepTaskId(taskId: string): Promise<string | null> {
  const tasksDir = await this.resolvePath(TASKS_DIR);

  // grep -l returns only filenames that match
  // Search pattern: "id": "taskId" (exact match to avoid partial matches)
  const result = await this.fs.grep({
    pattern: `"id":\\s*"${taskId}"`,
    path: tasksDir,
    glob: "*/metadata.json",
    filesOnly: true,
  });

  if (result.length > 0) {
    // Extract slug from path: /path/to/tasks/{slug}/metadata.json
    const match = result[0].match(/([^/]+)\/metadata\.json$/);
    return match ? match[1] : null;
  }

  return null;
}
```

### 5. Update `refreshContent` to Use `resolveSlug`

**File:** `src/entities/tasks/service.ts`

Update `refreshContent` to resolve the slug first, ensuring it handles renames:

```typescript
/**
 * Refreshes content from disk, bypassing cache.
 * Use when agent may have written to content.md.
 * Handles task renames by resolving the correct slug first.
 */
async refreshContent(id: string): Promise<string> {
  // Resolve the correct slug (handles renames)
  const slug = await this.resolveSlug(id);
  if (!slug) {
    logger.debug(`[taskService.refreshContent] Task not found: ${id}`);
    return "";
  }

  const path = `${TASKS_DIR}/${slug}/content.md`;
  logger.debug(`[taskService.refreshContent] Reading: ${path}`);
  const content = (await persistence.readText(path)) ?? "";
  logger.debug(`[taskService.refreshContent] Read ${content.length} chars from ${path}`);
  useTaskStore.getState()._applyContentLoaded(id, content);
  return content;
},
```

### 6. Subscribe in TaskOverview

**File:** `src/components/workspace/task-overview.tsx`

```typescript
import { eventBus } from "@/entities/events";

export function TaskOverview({ taskId, /* ... */ }: TaskOverviewProps) {
  const [content, setContent] = useState<string>("");
  const [contentLoading, setContentLoading] = useState(true);
  const task = useTaskStore((state) => state.tasks[taskId]);

  // Subscribe to tool completion events for this task
  useEffect(() => {
    const refreshContent = async () => {
      setContentLoading(true);
      try {
        // refreshContent now handles slug resolution internally
        const newContent = await taskService.refreshContent(taskId);
        setContent(newContent);
      } finally {
        setContentLoading(false);
      }
    };

    const handleToolCompleted = ({ taskId: eventTaskId }: { taskId: string | null }) => {
      if (eventTaskId === taskId) {
        logger.log(`[TaskOverview] Tool completed for task ${taskId}, refreshing content`);
        refreshContent();
      }
    };

    // Initial load
    refreshContent();

    // Subscribe to tool completions
    eventBus.on("agent:tool-completed", handleToolCompleted);
    return () => eventBus.off("agent:tool-completed", handleToolCompleted);
  }, [taskId]);

  // ... rest of component
}
```

### 7. Add Tests for Slug Resolution

**File:** `src/entities/tasks/service.test.ts`

```typescript
describe("resolveSlug", () => {
  beforeEach(() => {
    // Reset store and mock persistence
  });

  it("returns cached slug when metadata.json exists at cached path", async () => {
    // Setup: task in store with slug "my-task"
    // Mock: persistence.exists("tasks/my-task/metadata.json") → true
    const slug = await taskService.resolveSlug("task-123");
    expect(slug).toBe("my-task");
    // Verify grep was NOT called (fast path)
  });

  it("uses grep to find task when cached slug is stale", async () => {
    // Setup: task in store with stale slug "draft-123"
    // Mock: persistence.exists("tasks/draft-123/metadata.json") → false
    // Mock: persistence.grepTaskId("task-123") → "my-task"
    // Mock: persistence.readJson("tasks/my-task/metadata.json") → metadata
    const slug = await taskService.resolveSlug("task-123");
    expect(slug).toBe("my-task");
    // Verify store was updated with new metadata
  });

  it("returns null and removes from store when task not found anywhere", async () => {
    // Setup: task in store with slug "deleted-task"
    // Mock: persistence.exists → false
    // Mock: persistence.grepTaskId → null
    const slug = await taskService.resolveSlug("task-123");
    expect(slug).toBeNull();
    // Verify task was removed from store
  });

  it("returns null when task not in store and not on disk", async () => {
    // Setup: empty store
    // Mock: persistence.grepTaskId → null
    const slug = await taskService.resolveSlug("nonexistent");
    expect(slug).toBeNull();
  });
});
```

**File:** `src/lib/persistence.test.ts`

```typescript
describe("grepTaskId", () => {
  it("finds task ID and returns slug from file path", async () => {
    // Mock: fs.grep returns ["/path/to/tasks/my-task/metadata.json"]
    const slug = await persistence.grepTaskId("task-123");
    expect(slug).toBe("my-task");
  });

  it("returns null when task ID not found", async () => {
    // Mock: fs.grep returns []
    const slug = await persistence.grepTaskId("nonexistent");
    expect(slug).toBeNull();
  });

  it("searches with correct pattern and glob", async () => {
    await persistence.grepTaskId("task-123");
    expect(mockFs.grep).toHaveBeenCalledWith({
      pattern: '"id":\\s*"task-123"',
      path: expect.stringContaining("tasks"),
      glob: "*/metadata.json",
      filesOnly: true,
    });
  });
});
```

**File:** `src/entities/tasks/service.integration.test.ts` (optional)

```typescript
describe("resolveSlug integration", () => {
  it("handles task rename end-to-end", async () => {
    // 1. Create task with slug "draft-123"
    const task = await taskService.create({ title: "Draft" });
    expect(task.slug).toBe("draft");

    // 2. Simulate agent renaming the task folder on disk
    await persistence.rename("tasks/draft", "tasks/my-feature");
    await persistence.writeJson("tasks/my-feature/metadata.json", {
      ...task,
      slug: "my-feature",
      title: "My Feature",
    });

    // 3. resolveSlug should find the new location
    const slug = await taskService.resolveSlug(task.id);
    expect(slug).toBe("my-feature");

    // 4. Store should be updated
    const updated = taskService.get(task.id);
    expect(updated?.slug).toBe("my-feature");
    expect(updated?.title).toBe("My Feature");
  });
});
```

### 8. Remove Old Mechanism (Cleanup)

After the new approach is working:

1. **Remove from runner.ts:** Delete `markContentMdUpdated()` calls and pattern matching
2. **Remove from output.ts:** Delete `contentMdUpdatedAt` field and setter
3. **Remove prop drilling:** Remove `contentMdUpdatedAt` from:
   - `task-workspace.tsx`
   - `main-content-pane.tsx`
   - `task-overview.tsx` props
4. **Remove from types:** Delete `contentMdUpdatedAt` from `ThreadState`

---

## Comparison

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Trigger** | `contentMdUpdatedAt` timestamp | `agent:tool-completed` event |
| **Detection** | Agent-side pattern match | Frontend counts tool_results |
| **Data flow** | Prop drilling (3 levels) | Direct event subscription |
| **Handles renames** | No | Yes (`resolveSlug` validates and rescans) |
| **Refresh scope** | Only content.md writes | Any tool completion |
| **Complexity** | High | Low |

---

## Key Files

| File | Changes |
|------|---------|
| `src/entities/events.ts` | Add `agent:tool-completed` event |
| `src/lib/event-bridge.ts` | Add to `BROADCAST_EVENTS` |
| `src/lib/agent-service.ts` | Emit event on new tool results |
| `src/lib/persistence.ts` | Add `grepTaskId()` for fast task ID lookup |
| `src/lib/persistence.test.ts` | Tests for `grepTaskId()` |
| `src/entities/tasks/service.ts` | Add `resolveSlug()` helper, update `refreshContent()` |
| `src/entities/tasks/service.test.ts` | Tests for `resolveSlug()` |
| `src/components/workspace/task-overview.tsx` | Subscribe to event, refresh content |
| `agents/src/runner.ts` | Remove content.md detection (cleanup) |
| `agents/src/output.ts` | Remove contentMdUpdatedAt (cleanup) |

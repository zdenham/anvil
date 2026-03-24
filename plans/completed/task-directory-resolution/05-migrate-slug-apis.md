# 05: Migrate Slug-Based APIs to ID-Based

**Group:** C (Gate - must complete before D)
**Dependencies:** 02, 03, 04 (all adapters + resolution service)
**Blocks:** 06, 07

---

## Goal

Change APIs that accept slugs to accept task IDs instead, using the resolution service internally.

---

## Principle

> All lookups MUST use task ID. Slugs are derived/display-only values that can change.

---

## Functions to Change

### `agents/src/core/persistence.ts`

| Line | Function | Current | Change To |
|------|----------|---------|-----------|
| 225 | `getTaskContent` | `(slug: string)` | `(taskId: string)` - resolve internally |
| 232 | `setTaskContent` | `(slug: string, content)` | `(taskId: string, content)` |
| 239 | `associateThread` | `(taskSlug: string, threadId)` | `(taskId: string, threadId)` |

### Functions to Deprecate

| Line | Function | Action |
|------|----------|--------|
| 142 | `updateTaskBySlug` | Add `@deprecated`, migrate callers to `updateTask(id)` |
| 174 | `deleteTaskBySlug` | Add `@deprecated`, migrate callers to `deleteTask(id)` |

### Functions to Keep (Legitimate Slug Usage)

| Function | Reason |
|----------|--------|
| `findTaskBySlug` | Internal use by rename flow |
| `refreshTaskBySlug` | File watcher only knows directory name |
| `handleRemoteDeleteBySlug` | File watcher only knows directory name |

---

## Implementation Steps

### Step 1: Add Resolution Service to Persistence

```typescript
// agents/src/core/persistence.ts
import { ResolutionService } from "./resolution-service";
import { NodeFSAdapter } from "../adapters/node-fs-adapter";

// Initialize once
let resolutionService: ResolutionService | null = null;

function getResolution(): ResolutionService {
  if (!resolutionService) {
    resolutionService = new ResolutionService(
      new NodeFSAdapter(),
      join(getAnvilDir(), "tasks")
    );
  }
  return resolutionService;
}
```

### Step 2: Update `getTaskContent`

```typescript
// Before
export async function getTaskContent(slug: string): Promise<string | null> {
  const contentPath = join(getTasksDir(), slug, "content.md");
  // ...
}

// After
export async function getTaskContent(taskId: string): Promise<string | null> {
  const resolved = await getResolution().resolveTask(taskId);
  if (!resolved) return null;
  const contentPath = join(resolved.taskDir, "content.md");
  // ...
}
```

### Step 3: Update Callers

| File | Line | Current | Change To |
|------|------|---------|-----------|
| `agents/src/cli/anvil.ts` | 399 | `getTaskContent(task.slug)` | `getTaskContent(task.id)` |

---

## Verification

- [ ] `getTaskContent(taskId)` resolves correctly
- [ ] `setTaskContent(taskId, content)` resolves and writes correctly
- [ ] `associateThread(taskId, threadId)` resolves correctly
- [ ] Deprecated functions have `@deprecated` JSDoc
- [ ] All callers updated to pass IDs
- [ ] TypeScript compiles without errors
- [ ] Existing tests pass

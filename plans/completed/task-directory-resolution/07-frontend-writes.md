# 07: Frontend Write Path Updates

**Group:** D (Parallel with 06)
**Dependencies:** 05-migrate-slug-apis
**Blocks:** 08-cleanup

---

## Goal

Update frontend services to use resolution before writes, ensuring correct paths even when tasks are renamed.

---

## Files to Modify

### `src/entities/threads/service.ts`

#### Update `getThreadPath` with Hint Support

```typescript
// Before (line ~46-50)
async function getThreadPath(
  taskId: string,
  agentType: string,
  threadId: string
): Promise<string> {
  const slug = getTaskSlug(taskId);
  // ... direct path construction
}

// After
async function getThreadPath(
  taskId: string,
  agentType: string,
  threadId: string,
  hintSlug?: string  // Optional: try this slug first
): Promise<string> {
  const slug = hintSlug ?? getTaskSlug(taskId);
  if (slug) {
    const directPath = `${TASKS_DIR}/${slug}/threads/${getThreadFolderName(agentType, threadId)}`;
    if (await persistence.exists(`${directPath}/metadata.json`)) {
      return directPath;
    }
  }

  // Fallback to glob search
  const found = await findThreadPath(threadId);
  if (found) return found;

  throw new Error(`Thread not found: ${threadId}`);
}
```

#### Locations Using `getThreadPath`

| Line | Operation | Update Needed |
|------|-----------|---------------|
| 179-180 | Thread creation | Pass hint from task |
| 235-240 | Thread update | Already has task context |
| 292-297 | Turn addition | Already has task context |
| 345-357 | Turn completion | Already has task context |
| 418 | Thread deletion | Already has task context |

---

### `src/entities/tasks/service.ts`

#### Add Resolution Before Writes

For methods that write to task directories, add resolution check:

```typescript
// Pattern to apply
async function writeToTask(taskId: string, filename: string, content: string) {
  const task = useTaskStore.getState().tasks.get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  // Verify path exists, resolve if needed
  const taskPath = `${TASKS_DIR}/${task.slug}`;
  if (!await persistence.exists(`${taskPath}/metadata.json`)) {
    // Slug is stale, re-resolve
    const resolved = await resolveSlug(taskId);
    if (!resolved) throw new Error(`Task directory not found: ${taskId}`);
    // Use resolved slug
    await persistence.writeJson(`${TASKS_DIR}/${resolved}/${filename}`, content);
    return;
  }

  await persistence.writeJson(`${taskPath}/${filename}`, content);
}
```

#### Locations Needing Resolution

| Line | Operation | Current Path | Risk |
|------|-----------|--------------|------|
| 359 | `writeJson(metadata)` | `task.slug` from store | Medium |
| 447 | `writeText(content.md)` | `task.slug` from store | Medium |
| 390 | `removeDir` | `task.slug` from store | High |

---

### `src/lib/agent-service.ts`

#### Line 484: State File Path

```typescript
// Before
const statePath = await fs.joinPath(anvilDir, "tasks", task.slug, "threads", threadFolder, "state.json");

// After
const taskPath = await resolveTaskPath(task.id, task.slug);
const statePath = await fs.joinPath(taskPath, "threads", threadFolder, "state.json");
```

---

## Resolution Helper for Frontend

Create or use existing resolution in frontend:

```typescript
// src/entities/tasks/service.ts - existing resolveSlug function
// Can be reused or wrapped for consistency

export async function resolveTaskPath(taskId: string, hintSlug?: string): Promise<string> {
  if (hintSlug) {
    const path = `${TASKS_DIR}/${hintSlug}`;
    if (await persistence.exists(`${path}/metadata.json`)) {
      return path;
    }
  }

  const resolvedSlug = await resolveSlug(taskId);
  if (!resolvedSlug) throw new Error(`Task not found: ${taskId}`);
  return `${TASKS_DIR}/${resolvedSlug}`;
}
```

---

## Verification

- [ ] `getThreadPath` accepts optional `hintSlug` parameter
- [ ] `getThreadPath` falls back to glob when hint fails
- [ ] Task write operations verify path before writing
- [ ] `agent-service.ts` resolves task path before constructing state path
- [ ] Frontend builds without errors
- [ ] Manual test: rename task while viewing thread, verify writes still work

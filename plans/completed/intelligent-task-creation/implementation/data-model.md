# Data Model Changes

## Task Type

**`src/entities/tasks/types.ts`**

```typescript
interface Task {
  id: string;
  slug: string; // Unique, slugified from title
  title: string;
  description?: string;
  branchName: string; // task/<slug>
  type: "work" | "investigate";
  status: "active" | "completed" | "archived";
  parentId?: string; // For subtasks
  tags: string[];
  createdAt: string;
  updatedAt: string;
}
```

## Thread Type

**`src/entities/threads/types.ts`**

```typescript
interface Thread {
  id: string;
  taskId: string | null; // null until routed
  // ...
}
```

## Service Changes

**`src/entities/threads/service.ts`**

- Allow `create()` without taskId
- Add `associateWithTask(threadId, taskId)` method

**`src/entities/tasks/service.ts`**

- Update `create()` to generate slug, check conflicts, store branch name
- Add `findBySlug(slug)` method
- Add `listSlugs()` for conflict checking

## Slug Utilities

**`src/lib/slug.ts`** - **NEW**

```typescript
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove special chars
    .replace(/\s+/g, "-") // Spaces to hyphens
    .replace(/-+/g, "-") // Collapse multiple hyphens
    .replace(/^-|-$/g, "") // Trim hyphens
    .slice(0, 50); // Max length
}

export function resolveSlugConflict(
  baseSlug: string,
  existingSlugs: Set<string>
): string {
  if (!existingSlugs.has(baseSlug)) return baseSlug;

  let n = 1;
  while (existingSlugs.has(`${baseSlug}-${n}`)) {
    n++;
  }
  return `${baseSlug}-${n}`;
}
```

## Files to Modify

- `src/entities/tasks/types.ts` - Add `slug`, `branchName`, `type`, `parentId`
- `src/entities/tasks/service.ts` - Slug generation, conflict resolution, branch name storage
- `src/entities/threads/types.ts` - `taskId: string | null`
- `src/entities/threads/service.ts` - Allow null taskId, add `associateWithTask`
- `src/lib/slug.ts` - **NEW** - slugify and conflict resolution utilities

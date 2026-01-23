# Inbox Icons Removal and Archive Strategy

## Overview

This plan covers three changes:
1. Remove message/plan icons from the mission control inbox list
2. Implement archive functionality for both plans and threads
3. Add double-click trash button to inbox items (restore from old task list)

---

## Part 1: Remove Inbox Item Icons

### Current State

In `src/components/inbox/inbox-item.tsx` (lines 44-54), each inbox row displays a type icon:
- Threads: `MessageSquare` icon (Lucide React)
- Plans: `FileText` icon (Lucide React)

```tsx
<span
  className="w-4 h-4 flex items-center justify-center text-surface-400 flex-shrink-0"
  data-testid="inbox-item-icon"
>
  {item.type === "thread" ? (
    <MessageSquare size={14} data-testid="thread-icon" />
  ) : (
    <FileText size={14} data-testid="plan-icon" />
  )}
</span>
```

### Changes Required

1. **Remove the icon span entirely** from `inbox-item.tsx`
   - Delete the entire `<span>` block containing the icons
   - Remove the `MessageSquare` and `FileText` imports from Lucide React

2. **Update tests** in `src/components/inbox/__tests__/inbox-item.test.tsx`
   - Remove any tests that query for `thread-icon` or `plan-icon` test IDs
   - Remove tests for `inbox-item-icon` test ID

### Files to Modify

- `src/components/inbox/inbox-item.tsx` - Remove icon rendering
- `src/components/inbox/__tests__/inbox-item.test.tsx` - Update tests

---

## Part 2: Archive Strategy

### Current State

**Threads** already have archive functionality:
- `threadService.archive(threadId)` moves thread from `~/.mort/threads/{id}/` to `~/.mort/archive/threads/{id}/`
- Emits `THREAD_ARCHIVED` event
- Relations are marked as `archived: true` (preserved, not deleted)

**Plans** do NOT have archive functionality yet:
- Metadata stored in `~/.mort/plans/{id}/metadata.json`
- Markdown files stored in repo at `{repoRoot}/plans/{relativePath}`
- No archive directory or method exists

### Archive Strategy Design

#### Thread Archive (Already Implemented)
- Moves thread directory to `~/.mort/archive/threads/{threadId}/`
- Removes from mission control inbox (store is updated)
- Emits event for relation archival

#### Plan Archive (New)

When archiving a plan, two operations must happen in sequence:

**Step 1: Move repo markdown file to completed directory**
- Source: `{repoRoot}/plans/{relativePath}`
- Destination: `{repoRoot}/plans/completed/{relativePath}`
- Example: `plans/my-feature.md` → `plans/completed/my-feature.md`
- For nested plans (directories), move the entire directory

**Step 2: Move metadata mirror to archive directory AND update relativePath**
- Source: `~/.mort/plans/{id}/metadata.json`
- Destination: `~/.mort/archive/plans/{id}/metadata.json`
- Update `relativePath` field to reflect new location: `completed/{originalPath}`
- This ensures archived metadata still correctly references the file

**Ordering Rationale:**
- File move happens first so the markdown file exists at the new location
- Metadata move happens second so we can update `relativePath` to point to `completed/...`
- If metadata moved first, it would briefly reference a non-existent path

### Implementation Details

#### 1. Add Archive Directory Constant

In `src/entities/plans/service.ts`:

```typescript
const ARCHIVE_PLANS_DIR = "archive/plans";
```

#### 2. Add Plan Archive Method

In `src/entities/plans/service.ts`, add:

```typescript
async archive(planId: string): Promise<void> {
  const plan = this.get(planId);
  if (!plan) return;

  // Step 1: Move markdown file to completed directory
  const { resolvePlanPath, resolveCompletedPlanPath } = await import("./utils");
  const sourcePath = await resolvePlanPath(plan);
  const destPath = await resolveCompletedPlanPath(plan);

  // Use filesystem operations to move the file/directory
  await this.moveMarkdownFile(sourcePath, destPath);

  // Step 2: Move metadata to archive with updated relativePath
  const metadataSourcePath = `${PLANS_DIRECTORY}/${planId}`;
  const metadataDestPath = `${ARCHIVE_PLANS_DIR}/${planId}`;

  // Update relativePath to reflect new location
  const updatedPlan = {
    ...plan,
    relativePath: `completed/${plan.relativePath}`,
    updatedAt: Date.now(),
  };

  // Optimistically remove from store
  const rollback = usePlanStore.getState()._applyDelete(planId);

  try {
    await persistence.ensureDir(ARCHIVE_PLANS_DIR);
    await persistence.ensureDir(metadataDestPath);
    await persistence.writeJson(`${metadataDestPath}/metadata.json`, updatedPlan);
    await persistence.removeDir(metadataSourcePath);

    // Emit event for relation archival
    eventBus.emit(EventName.PLAN_ARCHIVED, { planId });

    logger.info(`[planService.archive] Archived plan ${planId}`);
  } catch (error) {
    rollback();
    throw error;
  }
}
```

#### 3. Add Helper for Completed Path Resolution

In `src/entities/plans/utils.ts`:

```typescript
export async function resolveCompletedPlanPath(plan: PlanMetadata): Promise<string> {
  const repo = useRepositoryStore.getState().getRepository(plan.repoId);
  if (!repo) throw new Error(`Repository not found: ${plan.repoId}`);

  const worktree = useRepositoryStore.getState().getWorktree(plan.worktreeId);
  const basePath = worktree?.path ?? repo.path;

  return `${basePath}/plans/completed/${plan.relativePath}`;
}
```

#### 4. Add File Move Helper

In `src/entities/plans/service.ts`:

```typescript
private async moveMarkdownFile(sourcePath: string, destPath: string): Promise<void> {
  const { FilesystemClient } = await import("@/lib/filesystem-client");
  const fs = new FilesystemClient();

  // Ensure destination directory exists
  const destDir = destPath.substring(0, destPath.lastIndexOf('/'));
  await fs.ensureDir(destDir);

  // Check if source is a directory (nested plan) or file
  const isDirectory = await fs.isDirectory(sourcePath);

  if (isDirectory) {
    await fs.copyDir(sourcePath, destPath);
    await fs.removeDir(sourcePath);
  } else {
    await fs.copyFile(sourcePath, destPath);
    await fs.removeFile(sourcePath);
  }
}
```

#### 5. Add Event Type

In `core/types/events.ts`, ensure `PLAN_ARCHIVED` event exists:

```typescript
PLAN_ARCHIVED: "plan-archived",
```

With payload:
```typescript
[EventName.PLAN_ARCHIVED]: { planId: string };
```

#### 6. Add Relation Listener

The relation listener already exists in `src/entities/relations/listeners.ts`:

```typescript
eventBus.on(EventName.PLAN_ARCHIVED, async ({ planId }) => {
  await relationService.archiveByPlan(planId);
});
```

#### 7. Add listArchived Method

```typescript
async listArchived(): Promise<PlanMetadata[]> {
  const pattern = `${ARCHIVE_PLANS_DIR}/*/metadata.json`;
  const files = await persistence.glob(pattern);
  const plans: PlanMetadata[] = [];

  for (const filePath of files) {
    const raw = await persistence.readJson(filePath);
    const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
    if (result?.success) {
      plans.push(result.data);
    }
  }

  return plans;
}
```

### Files to Modify

- `src/entities/plans/service.ts` - Add archive method and helpers
- `src/entities/plans/utils.ts` - Add completed path resolver
- `core/types/events.ts` - Ensure PLAN_ARCHIVED event exists (likely already there)
- `src/entities/relations/listeners.ts` - Already has plan archive listener

---

## Part 3: Double-Click Trash Button

### Previous Implementation (from commit history)

The old task list had a `DeleteButton` component in `src/components/tasks/delete-button.tsx` with a two-click confirmation pattern:

```tsx
import { useState, useEffect, useRef } from "react";
import { Trash2, Loader2 } from "lucide-react";

interface DeleteButtonProps {
  onDelete: () => void | Promise<void>;
}

export function DeleteButton({ onDelete }: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Click outside to cancel confirmation
  useEffect(() => {
    if (!confirming) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setConfirming(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [confirming]);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDeleting) return;

    if (confirming) {
      // Second click - execute deletion
      setIsDeleting(true);
      try {
        await onDelete();
      } finally {
        setIsDeleting(false);
        setConfirming(false);
      }
    } else {
      // First click - show confirmation
      setConfirming(true);
    }
  };

  if (isDeleting) {
    return (
      <span className="p-1 text-surface-500">
        <Loader2 size={14} className="animate-spin" />
      </span>
    );
  }

  return (
    <button
      ref={buttonRef}
      className={`opacity-0 group-hover:opacity-100 p-1 transition-all ${
        confirming
          ? "opacity-100 text-red-400 text-xs font-medium"
          : "text-surface-500 hover:text-red-400"
      }`}
      onClick={handleClick}
    >
      {confirming ? "Confirm" : <Trash2 size={14} />}
    </button>
  );
}
```

### Behavior

1. **Hidden by default**: `opacity-0` until row hover (`group-hover:opacity-100`)
2. **First click**: Shows trash icon, then changes to "Confirm" text (red)
3. **Second click**: Executes the delete/archive action with loading spinner
4. **Click outside**: Cancels confirmation state, returns to trash icon
5. **Loading state**: Shows spinning `Loader2` icon while action executes

### Changes Required

1. **Create new component** at `src/components/inbox/delete-button.tsx`
   - Adapt the old DeleteButton component for inbox use
   - Rename to `ArchiveButton` since it triggers archive, not delete
   - Keep the same two-click confirmation UX

2. **Integrate into InboxItem** (`src/components/inbox/inbox-item.tsx`)
   - Add ArchiveButton to each inbox row
   - Pass appropriate archive handler based on item type:
     - Threads: `threadService.archive(threadId)`
     - Plans: `planService.archive(planId)` (new, from Part 2)

3. **Add tests** in `src/components/inbox/__tests__/delete-button.test.tsx`
   - Test first click shows confirmation
   - Test second click triggers archive
   - Test click outside cancels confirmation
   - Test loading state during archive

### Files to Create/Modify

- `src/components/inbox/archive-button.tsx` - New component (adapted from old DeleteButton)
- `src/components/inbox/inbox-item.tsx` - Add ArchiveButton integration
- `src/components/inbox/__tests__/archive-button.test.tsx` - New tests

---

## Testing Considerations

### Icon Removal Tests (Part 1)
- Verify inbox items render without icons
- Verify layout/spacing still looks correct
- Remove icon-specific test assertions

### Archive Button Tests (Part 3)
- First click shows "Confirm" text
- Second click triggers archive callback
- Click outside resets to trash icon
- Loading spinner shown during async operation
- Button hidden until row hover (opacity transition)
- Stop propagation prevents row click when clicking button

### Archive Tests

**Thread Archive (existing, verify):**
- Thread moves to archive directory
- Thread removed from inbox/store
- Relations marked as archived
- Can list archived threads

**Plan Archive (new):**
- Markdown file moves to `plans/completed/` in repo
- Metadata moves to `~/.mort/archive/plans/`
- `relativePath` updated to `completed/{original}`
- Plan removed from inbox/store
- Relations marked as archived
- Can list archived plans
- Nested plan directories handled correctly

---

## Implementation Order

1. Remove inbox icons (Part 1) - simple, isolated change
2. Add plan archive method and helpers (Part 2)
3. Add event handling (verify existing)
4. Add listArchived method
5. Create ArchiveButton component (Part 3)
6. Integrate ArchiveButton into InboxItem
7. Test archive flow end-to-end (service + UI)

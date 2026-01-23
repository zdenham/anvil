# 03: Repository Management UI

## Prerequisites
- `01-add-repository.md` complete (add functionality works)

## Goal
Add remove/rename functionality and status indicators in settings.

## Tasks

### 1. Add repository removal

**File**: `src/components/main-window/settings/repository-settings.tsx`

Add remove button per repository row:
```typescript
const handleRemoveRepository = async (repoId: string) => {
  // Show confirmation dialog
  const confirmed = await confirm(
    "Remove repository? This won't delete files on disk.",
    { title: "Remove Repository", kind: "warning" }
  );

  if (confirmed) {
    await repoService.remove(repoId);
    await repoService.hydrate();
  }
};
```

**Add to service** (`src/entities/repositories/service.ts`):
```typescript
async remove(repoId: string): Promise<void> {
  // Remove from store
  // Delete settings folder from ~/.mort/repositories/{slug}
  // Do NOT delete source files on disk
}
```

### 2. Add repository rename

**File**: `src/components/main-window/settings/repository-settings.tsx`

Add inline editing for repository display name:
```typescript
const [editingRepoId, setEditingRepoId] = useState<string | null>(null);
const [editName, setEditName] = useState("");

const handleRename = async (repoId: string, newName: string) => {
  await repoService.rename(repoId, newName);
  setEditingRepoId(null);
  await repoService.hydrate();
};
```

Handle slug migration in service if name affects folder structure.

### 3. Add status indicators

**File**: `src/components/main-window/settings/repository-settings.tsx`

Display per-repository:
- Worktree count badge
- Active threads count
- Path validity indicator (green check / red X if path missing)

```typescript
interface RepoStatus {
  worktreeCount: number;
  activeThreads: number;
  pathValid: boolean;
}

// Compute on mount or use effect
const getRepoStatus = async (repo: Repository): Promise<RepoStatus> => {
  const worktrees = await worktreeService.sync(repo.name);
  const pathValid = await checkPathExists(repo.sourcePath);
  // Count threads...
  return { worktreeCount: worktrees.length, activeThreads: 0, pathValid };
};
```

### 4. Style the repository list

Enhance the UI to show:
- Repository name (editable)
- Source path (truncated, with tooltip)
- Status badges
- Action buttons (remove, locate if missing)

## Success Criteria
- [ ] User can remove repository from settings
- [ ] Confirmation dialog before removal
- [ ] User can rename repository display name
- [ ] Worktree count shown per repository
- [ ] Path validity indicator (exists/missing)
- [ ] Missing path shows "Locate" action

## Files Modified
- `src/components/main-window/settings/repository-settings.tsx`
- `src/entities/repositories/service.ts` (add remove/rename methods)

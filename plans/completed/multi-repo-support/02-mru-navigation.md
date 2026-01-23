# 02: Unified MRU Navigation

## Prerequisites
- `01-add-repository.md` complete (multi-repo data exists)

## Goal
Replace single-repo worktree list with a flat MRU list of repo+worktree combinations. Left/right arrow keys cycle through this unified list.

## Tasks

### 1. Define RepoWorktree type

**File**: `core/types/repositories.ts`

```typescript
export interface RepoWorktree {
  repoName: string;
  repoId: string;
  worktree: WorktreeState;
}
```

### 2. Update spotlight state

**File**: `src/components/spotlight/spotlight.tsx`

Replace worktree state:
```typescript
// Current:
interface SpotlightState {
  availableWorktrees: WorktreeState[];
  selectedWorktreeIndex: number;
}

// New:
interface SpotlightState {
  repoWorktrees: RepoWorktree[];  // Flat MRU list
  selectedWorktreeIndex: number;   // Index into repoWorktrees
}
```

### 3. Load worktrees from ALL repositories

**File**: `src/components/spotlight/spotlight.tsx`

Replace `loadWorktrees` function:
```typescript
const loadWorktrees = useCallback(async () => {
  const repos = controller.getRepositories();
  const allRepoWorktrees: RepoWorktree[] = [];

  for (const repo of repos) {
    try {
      const worktrees = await worktreeService.sync(repo.name);
      for (const wt of worktrees) {
        allRepoWorktrees.push({
          repoName: repo.name,
          repoId: repo.id,
          worktree: wt,
        });
      }
    } catch (err) {
      logger.error(`Failed to load worktrees for ${repo.name}:`, err);
    }
  }

  // Sort by MRU across ALL repos
  allRepoWorktrees.sort((a, b) =>
    (b.worktree.lastAccessedAt ?? 0) - (a.worktree.lastAccessedAt ?? 0)
  );

  setState(prev => ({
    ...prev,
    repoWorktrees: allRepoWorktrees,
    selectedWorktreeIndex: 0,
  }));
}, []);
```

### 4. Update arrow key references

**File**: `src/components/spotlight/spotlight.tsx`

The existing arrow key handlers already cycle `selectedWorktreeIndex`. Just update references from `availableWorktrees` to `repoWorktrees`:

```typescript
case "ArrowRight": {
  setState((prev) => ({
    ...prev,
    selectedWorktreeIndex: (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
  }));
}
```

### 5. Update thread creation

**File**: `src/components/spotlight/spotlight.tsx`

```typescript
// Current:
const selectedRepo = defaultRepo ?? repos[0];
const selectedWorktree = availableWorktrees[selectedWorktreeIndex];

// New:
const selected = repoWorktrees[selectedWorktreeIndex];
if (!selected) throw new Error("No worktree selected");

const selectedRepo = repos.find(r => r.id === selected.repoId);
const selectedWorktree = selected.worktree;

controller.createSimpleThread(query, selectedRepo, selectedWorktree.path);
```

### 6. Update worktree display

**File**: `src/components/spotlight/spotlight.tsx`

Show repo context when multiple repos exist:
- Single repo: `main`
- Multiple repos: `myrepo/main` or `myrepo: main`

```typescript
const displayName = repos.length > 1
  ? `${selected.repoName}/${selected.worktree.name}`
  : selected.worktree.name;
```

### 7. Add touch() method to update MRU

**File**: `src/entities/worktrees/service.ts`

```typescript
async touch(repoName: string, worktreeId: string): Promise<void> {
  // Update lastAccessedAt to Date.now()
  // Persist to settings
}
```

Call this after thread creation succeeds.

## Success Criteria
- [ ] Arrow keys cycle through worktrees from ALL repositories
- [ ] List is sorted by most recently used (across all repos)
- [ ] Repository name visible when multiple repos exist
- [ ] Creating thread in worktree updates its lastAccessedAt
- [ ] Most recent worktree selected by default on spotlight open

## Files Modified
- `core/types/repositories.ts`
- `src/components/spotlight/spotlight.tsx`
- `src/entities/worktrees/service.ts`

# 05: Polish & Edge Cases

## Prerequisites
- `02-mru-navigation.md` complete (MRU navigation works)

## Goal
Handle edge cases and add inbox integration.

## Tasks

### 1. Handle repository path changes

**Scenario**: User moves repository folder on disk

**File**: `src/entities/repositories/service.ts`

```typescript
async validateAllPaths(): Promise<{ repoId: string; valid: boolean }[]> {
  const repos = this.getRepositories();
  const results = [];

  for (const repo of repos) {
    const valid = await validateRepository(repo.sourcePath);
    results.push({ repoId: repo.id, valid: valid.exists && valid.is_git_repo });
  }

  return results;
}
```

**On app startup/focus**: Check paths, show banner for missing repos with "Locate" action.

```typescript
const handleLocateRepository = async (repoId: string) => {
  const newPath = await open({ directory: true, title: "Locate Repository" });
  if (newPath) {
    await repoService.updatePath(repoId, newPath);
  }
};
```

### 2. Handle duplicate worktree names

**Scenario**: Both repos have a worktree named "main"

**File**: `src/components/spotlight/spotlight.tsx`

Always show repo prefix when multiple repos exist:
```typescript
const getWorktreeDisplayName = (
  repoWorktree: RepoWorktree,
  totalRepos: number
): string => {
  if (totalRepos === 1) {
    return repoWorktree.worktree.name;
  }
  return `${repoWorktree.repoName}/${repoWorktree.worktree.name}`;
};
```

Visual indicator when cycling crosses repo boundary:
```typescript
const prevRepo = repoWorktrees[prevIndex]?.repoName;
const currRepo = repoWorktrees[currIndex]?.repoName;
const crossedRepoBoundary = prevRepo !== currRepo;
// Trigger subtle animation or highlight
```

### 3. Add repository filter to inbox

**File**: `src/components/inbox/inbox-list.tsx` or similar

Add filter dropdown:
```typescript
const [repoFilter, setRepoFilter] = useState<string | "all">("all");

const filteredThreads = useMemo(() => {
  if (repoFilter === "all") return threads;
  return threads.filter(t => t.repoId === repoFilter);
}, [threads, repoFilter]);
```

### 4. Add repository badge to inbox items

**File**: `src/components/inbox/inbox-item.tsx`

Show small repo badge when multiple repos exist:
```typescript
{repos.length > 1 && (
  <span className="repo-badge">{thread.repoName}</span>
)}
```

### 5. (Optional) Group threads by repository

**File**: `src/components/inbox/inbox-list.tsx`

Add view toggle for grouped view:
```typescript
const [groupByRepo, setGroupByRepo] = useState(false);

// Group threads by repoId
const groupedThreads = useMemo(() => {
  if (!groupByRepo) return null;
  return threads.reduce((acc, thread) => {
    const key = thread.repoId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(thread);
    return acc;
  }, {} as Record<string, Thread[]>);
}, [threads, groupByRepo]);
```

### 6. Empty state for no repositories

**File**: `src/components/spotlight/spotlight.tsx`

Handle case where no repositories are configured:
```typescript
if (repoWorktrees.length === 0) {
  return (
    <EmptyState
      message="No repositories configured"
      action="Add a repository in Settings"
    />
  );
}
```

## Success Criteria
- [ ] Missing repository paths detected on startup
- [ ] "Locate" action allows relocating moved repos
- [ ] Duplicate worktree names show repo prefix
- [ ] Inbox shows repository badge when multiple repos
- [ ] Inbox can be filtered by repository
- [ ] Empty state when no repos configured

## Files Modified
- `src/entities/repositories/service.ts` (path validation)
- `src/components/spotlight/spotlight.tsx` (display, empty state)
- `src/components/inbox/inbox-list.tsx` (filter, grouping)
- `src/components/inbox/inbox-item.tsx` (repo badge)

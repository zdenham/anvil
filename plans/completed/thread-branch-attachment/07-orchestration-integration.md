# Plan 07: Orchestration Integration

**Phase:** 4 (Final Integration)
**Depends on:** `06-allocation-service-refactor.md`

## Objective

Update the orchestration layer to pass `taskId` and `taskBranch` to the allocation service, enabling branch attachment and task affinity.

## Files to Modify

| File | Changes |
|------|---------|
| `agents/src/orchestration.ts` | Pass task metadata to `allocate()` |

## Implementation

### 1. Update Orchestration Call

**File:** `agents/src/orchestration.ts`

Find the `allocate()` call and update it:

**Before:**
```typescript
const allocation = allocationService.allocate(repoName, args.threadId);
```

**After:**
```typescript
// Read task metadata - frontend already created draft on disk
const taskMeta = taskMetadataService.get(args.taskSlug);
const repoName = taskMeta.repositoryName;

if (!repoName) {
  throw new Error(`Task ${args.taskSlug} has no repositoryName`);
}

// Allocate worktree with task affinity and branch attachment
const allocation = allocationService.allocate(repoName, args.threadId, {
  taskId: taskMeta.id,              // For worktree affinity
  taskBranch: taskMeta.branchName,  // For branch checkout/creation
});
```

### 2. Ensure Task Metadata Has Required Fields

Verify that `TaskMetadata` type includes:

```typescript
interface TaskMetadata {
  id: string;           // Stable task ID
  repositoryName: string;
  branchName: string;   // e.g., "task/add-hello-world"
  // ... other fields
}
```

### 3. Handle Missing Branch Name

If `branchName` might be undefined (e.g., for ad-hoc tasks):

```typescript
const allocation = allocationService.allocate(repoName, args.threadId, {
  taskId: taskMeta.id,
  taskBranch: taskMeta.branchName, // undefined is valid - will use detached HEAD
});
```

## Verification

### Manual Testing

```bash
# 1. Create a task and verify branch is created
anvil tasks create "Test branch attachment" --slug test-branch-attach

# 2. Check the worktree is on the branch (not detached HEAD)
git -C ~/.anvil-dev/repositories/anvil/anvil-1 status
# Should show: On branch task/test-branch-attach

# 3. Verify merge base is from origin/main
git -C ~/.anvil-dev/repositories/anvil fetch origin
git log --oneline origin/main -1
# The worktree should be based on this commit

# 4. Make a commit via the agent and verify it's on the branch
git -C ~/.anvil-dev/repositories/anvil log --oneline task/test-branch-attach
# Should show the new commit

# 5. Test multi-thread concurrent access
# Spawn two threads for the same task
cat ~/.anvil-dev/repositories/anvil/settings.json | jq '.worktrees[] | select(.claim.taskId != null)'
# Should show claim.threadIds: ["thread-1", "thread-2"]

# 6. Test task affinity on re-open
# Complete task, then reopen
# Should reuse the same worktree
```

### Automated Tests

```typescript
describe('orchestrate', () => {
  it('passes task metadata to allocate()', async () => {
    const taskMeta = {
      id: 'task-123',
      repositoryName: 'my-repo',
      branchName: 'task/add-feature',
    };
    mockTaskMetadataService.get.mockReturnValue(taskMeta);

    await orchestrate({ taskSlug: 'add-feature', threadId: 'thread-1' });

    expect(mockAllocationService.allocate).toHaveBeenCalledWith(
      'my-repo',
      'thread-1',
      {
        taskId: 'task-123',
        taskBranch: 'task/add-feature',
      }
    );
  });

  it('throws when task has no repositoryName', async () => {
    mockTaskMetadataService.get.mockReturnValue({
      id: 'task-123',
      repositoryName: null,
      branchName: 'task/foo',
    });

    await expect(
      orchestrate({ taskSlug: 'foo', threadId: 'thread-1' })
    ).rejects.toThrow('has no repositoryName');
  });

  it('handles missing branchName (detached HEAD mode)', async () => {
    mockTaskMetadataService.get.mockReturnValue({
      id: 'task-123',
      repositoryName: 'my-repo',
      branchName: undefined,
    });

    await orchestrate({ taskSlug: 'ad-hoc', threadId: 'thread-1' });

    expect(mockAllocationService.allocate).toHaveBeenCalledWith(
      'my-repo',
      'thread-1',
      {
        taskId: 'task-123',
        taskBranch: undefined,
      }
    );
  });
});
```

## Verification Commands

```bash
# TypeScript compilation
pnpm typecheck

# Run orchestration tests
pnpm test agents/src/orchestration.test.ts

# Integration test
pnpm test:integration
```

## Verification Checklist

After implementation, verify:

- [ ] Worktree is on task branch (not detached HEAD)
- [ ] Merge base is from `origin/{defaultBranch}` (fresh, not stale)
- [ ] Commits are on the task branch
- [ ] Multiple threads share the same worktree
- [ ] Task affinity works on resume
- [ ] Merge agent can find commits on the branch

## Notes

- This is a thin integration layer - most logic is in AllocationService
- The orchestration should fail fast if task metadata is incomplete
- Branch name can be undefined for ad-hoc/unplanned tasks

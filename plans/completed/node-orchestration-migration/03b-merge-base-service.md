# Phase 3b: Merge Base Service

## Goal

Create a single-responsibility service for computing git merge-base commits.

## Prerequisites

- [02b-git-adapter.md](./02b-git-adapter.md) complete

## Parallel With

- [03a-settings-service.md](./03a-settings-service.md)
- [03c-task-services.md](./03c-task-services.md)
- [03d-thread-service.md](./03d-thread-service.md)
- [03e-branch-service.md](./03e-branch-service.md)

## Files to Create

- `core/services/git/merge-base-service.ts`
- `core/services/git/merge-base-service.test.ts`

## Implementation

```typescript
// core/services/git/merge-base-service.ts
import type { GitAdapter } from '@core/adapters/types';

export class MergeBaseService {
  constructor(private git: GitAdapter) {}

  /**
   * Computes the merge base between HEAD and the specified branch.
   * This is the commit where the current work should be based.
   */
  compute(repoPath: string, baseBranch: string): string {
    return this.git.getMergeBase(repoPath, 'HEAD', baseBranch);
  }

  /**
   * Computes merge base between two arbitrary refs.
   */
  computeBetween(repoPath: string, ref1: string, ref2: string): string {
    return this.git.getMergeBase(repoPath, ref1, ref2);
  }
}
```

## Tasks

1. Implement MergeBaseService class
2. Wrap GitAdapter.getMergeBase with clearer semantics
3. Write unit tests with mock GitAdapter

## Test Cases

- Compute merge base between HEAD and main
- Compute merge base between two branches
- Handle case where refs share no history (error)

## Single Responsibility

This service ONLY:
- Computes merge-base commits

It does NOT:
- Checkout commits
- Manage branches
- Cache results

## Notes

- Merge base is the common ancestor commit
- Used to determine what commit a worktree should be checked out at
- Enables agents to work from a known-good state

## Verification

- [ ] All tests pass
- [ ] No async/await used
- [ ] Service has single responsibility

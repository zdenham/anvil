# Phase 1: Adapter Interfaces

## Goal

Define the adapter interfaces that all platform implementations will conform to.

## Prerequisites

- [00-import-boundary.md](./00-import-boundary.md) complete

## Files to Create

- `core/adapters/types.ts`
- `core/adapters/async-wrapper.ts` (for backward compatibility)

## Breaking Changes from Existing FSAdapter

The existing `FSAdapter` interface (`core/services/fs-adapter.ts`) has two key differences that must be addressed:

### 1. Async to Sync Migration

**Current interface (async):**
```typescript
interface FSAdapter {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
}
```

**New interface (sync):**
All methods are synchronous for simpler control flow in the orchestration layer.

**Migration Strategy:**

Option A - Wrapper Adapter (Recommended for gradual migration):
```typescript
/**
 * Wraps the new sync FileSystemAdapter to provide the old async interface.
 * Use this during migration to avoid breaking existing consumers.
 */
class AsyncFileSystemAdapter implements FSAdapter {
  constructor(private sync: FileSystemAdapter) {}

  async exists(path: string): Promise<boolean> {
    return this.sync.exists(path);
  }
  async readFile(path: string): Promise<string> {
    return this.sync.readFile(path);
  }
  async writeFile(path: string, content: string): Promise<void> {
    return this.sync.writeFile(path, content);
  }
  async readDir(path: string): Promise<string[]> {
    return this.sync.readDir(path);
  }
  async glob(pattern: string, cwd: string): Promise<string[]> {
    return this.sync.glob(pattern, cwd);
  }
  async mkdir(path: string, recursive?: boolean): Promise<void> {
    return this.sync.mkdir(path, { recursive });
  }
}
```

Option B - Migrate consumers to sync calls:
- Update `ResolutionService` to use sync calls (remove await)
- Update `ThreadWriter` to use sync calls (remove await)
- Update tests to use sync assertions

**Affected consumers:**
- `core/services/resolution-service.ts` - Uses `exists`, `readFile`, `readDir`, `glob`
- `agents/src/services/thread-writer.ts` - Uses `exists`, `writeFile`
- `src/lib/persistence.ts` - Uses `remove`
- `src/lib/settings-store-client.ts` - Uses `remove`

### 2. Missing `glob()` Method

The existing interface includes `glob(pattern: string, cwd: string): Promise<string[]>` which is **required** by `ResolutionService.scanForThread()`. This method must be included in the new interface.

## Interface Definitions

All methods are **synchronous** (no async/await).

### FileSystemAdapter

```typescript
interface FileSystemAdapter {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  exists(path: string): boolean;
  remove(path: string): void;
  readDir(path: string): string[];
  glob(pattern: string, cwd: string): string[];
}
```

### GitAdapter

```typescript
interface WorktreeInfo {
  path: string;
  branch: string | null;
  commit: string;
  bare: boolean;
}

interface GitAdapter {
  createWorktree(repoPath: string, worktreePath: string, options?: { branch?: string; commit?: string }): void;
  removeWorktree(repoPath: string, worktreePath: string, options?: { force?: boolean }): void;
  listWorktrees(repoPath: string): WorktreeInfo[];
  getDefaultBranch(repoPath: string): string;
  getBranchCommit(repoPath: string, branch: string): string;
  checkoutCommit(worktreePath: string, commit: string): void;
  checkoutBranch(worktreePath: string, branch: string): void;
  getMergeBase(repoPath: string, ref1: string, ref2: string): string;
}
```

### PathLock

```typescript
interface LockInfo {
  acquiredAt: number;
  pid: number;
  hostname: string;
}

interface AcquireOptions {
  maxRetries?: number;
  retryDelayMs?: number;
}

interface PathLock {
  acquire(lockPath: string, options?: AcquireOptions): void;
  release(lockPath: string): void;
  isHeld(lockPath: string): boolean;
}
```

## Tasks

1. Create `core/adapters/types.ts` with all interface definitions
2. Export all interfaces and types
3. Add JSDoc comments explaining each method
4. **Create `AsyncFileSystemAdapter` wrapper in `core/adapters/async-wrapper.ts` for backward compatibility**
5. **Update existing consumers or use the async wrapper during migration**

## Notes

- Interfaces only - no implementations in this file
- All methods sync for simpler control flow
- PathLock uses file-based locking with 30s stale TTL
- **The `glob()` method is required for thread resolution fallback (see `ResolutionService.scanForThread()`)**
- **`AcquireOptions` added to PathLock for retry with exponential backoff**

## Verification

- [ ] File compiles without errors
- [ ] Types are importable from `@core/adapters/types`
- [ ] **`glob()` method is included in FileSystemAdapter**
- [ ] **AsyncFileSystemAdapter wrapper compiles and provides backward compatibility**
- [ ] **Existing tests pass with either sync interface or async wrapper**

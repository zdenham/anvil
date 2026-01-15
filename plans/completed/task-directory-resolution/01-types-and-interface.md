# 01: Types and Interface Definitions

**Group:** A (Start immediately)
**Dependencies:** None
**Blocks:** 02, 03, 04

---

## Goal

Create the shared type definitions and interface that all other components depend on.

---

## Files to Create

### 1. `core/types/resolution.ts`

```typescript
/**
 * Result of resolving a task by ID.
 */
export interface TaskResolution {
  /** The task's unique ID (stable, never changes) */
  taskId: string;
  /** Current slug (directory name, may change on rename) */
  slug: string;
  /** Full path to task directory */
  taskDir: string;
  /** Git branch name for this task */
  branchName: string;
}

/**
 * Result of resolving a thread by ID.
 */
export interface ThreadResolution {
  /** The thread's unique ID */
  threadId: string;
  /** Parent task's ID */
  taskId: string;
  /** Parent task's current slug */
  taskSlug: string;
  /** Full path to thread directory */
  threadDir: string;
  /** Agent type (e.g., "work", "planning") */
  agentType: string;
}
```

### 2. `core/services/fs-adapter.ts`

```typescript
/**
 * Platform-agnostic filesystem adapter.
 * Implementations: NodeFSAdapter (agents), TauriFSAdapter (frontend)
 */
export interface FSAdapter {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  glob(pattern: string, cwd: string): Promise<string[]>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
}
```

---

## Verification

- [ ] `core/types/resolution.ts` exports `TaskResolution` and `ThreadResolution`
- [ ] `core/services/fs-adapter.ts` exports `FSAdapter` interface
- [ ] TypeScript compiles without errors
- [ ] No runtime dependencies (types only)

# Node Orchestration Migration Plan

## Goal

Move task creation orchestration from Tauri frontend to the Node process. This enables:
1. **Simpler testing** - Agent can be tested headlessly without Tauri
2. **Agent-friendly architecture** - Node is better for orchestration than round-trips through Rust
3. **Cleaner frontend** - Tauri just reacts to events, doesn't orchestrate

## Guiding Principles

1. **Worktree terminology** - Use "worktree" consistently (not "workspace")
2. **Adapter pattern** - Core business logic in TypeScript, adapters for platform I/O
3. **Thin Rust** - Rust provides low-level primitives only, business logic lives in TypeScript
4. **Single Responsibility Classes** - Each class does ONE thing well. No god objects.
5. **Delete workspace-service.ts** - Use its logic as inspiration, but rewrite with proper separation
6. **Synchronous Node operations** - Use sync fs/git operations in Node (simpler control flow, works with process.on('exit'))

---

## Single Responsibility Breakdown

**CRITICAL:** Each service class must have a single, focused responsibility. Break down large services into composable pieces.

### Bad (workspace-service.ts today)
```typescript
// Does too many things:
class WorkspaceService {
  allocateRoutingWorkspace()    // worktree claiming
  releaseWorkspace()            // worktree releasing
  initializeTaskBranch()        // branch creation
  deleteTaskBranch()            // branch deletion
  getWorktreeForTask()          // worktree lookup
  syncWithDisk()                // disk synchronization
  // ... 400+ lines
}
```

### Good (single responsibility)
```typescript
// Each class does ONE thing:
// Note: All methods are synchronous in Node (simpler control flow)

class WorktreeAllocationService {
  allocate(repoName: string, threadId: string): WorktreeAllocation
  release(repoName: string, threadId: string): void
}

class BranchService {
  create(repoName: string, branchName: string, base: string): void
  delete(repoName: string, branchName: string): void
  exists(repoName: string, branchName: string): boolean
}

class MergeBaseService {
  constructor(anvilDir: string, git: GitAdapter)
  compute(repoPath: string, branch: string): string
}

class RepositorySettingsService {
  constructor(anvilDir: string, fs: FileSystemAdapter)
  load(repoName: string): RepositorySettings
  save(repoName: string, settings: RepositorySettings): void
}
```

### Benefits
- **Testable** - Mock one service, test another in isolation
- **Readable** - Each file is < 100 lines
- **Composable** - Orchestrators combine simple services
- **Maintainable** - Change one thing without breaking others

---

## Adapter Pattern Architecture

Services that need to work in both Node and Tauri frontend use an adapter pattern:

```
┌─────────────────────────────────────────────────────────────┐
│                    Shared Business Logic                     │
│                      (TypeScript)                            │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │ WorktreeService │  │   TaskService   │  │  GitService  │ │
│  └────────┬────────┘  └────────┬────────┘  └──────┬───────┘ │
│           │                    │                   │         │
│           ▼                    ▼                   ▼         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    Adapter Interface                     ││
│  │  FileSystemAdapter, GitAdapter, PathLock                 ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
           │                                    │
           ▼                                    ▼
┌─────────────────────┐              ┌─────────────────────┐
│   Node Adapter      │              │   Tauri Adapter     │
│                     │              │                     │
│ - fs (sync)         │              │ - invoke("fs_*")    │
│ - execSync          │              │ - invoke("git_*")   │
│ - O_EXCL locks      │              │ - (no locking)      │
└─────────────────────┘              └─────────────────────┘
```

### Adapter Interfaces

```typescript
// core/adapters/types.ts (Node-only, synchronous)

interface FileSystemAdapter {
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  mkdir(path: string, options?: { recursive?: boolean }): void;
  exists(path: string): boolean;
  remove(path: string): void;
  readDir(path: string): string[];
}

interface GitAdapter {
  createWorktree(repoPath: string, worktreePath: string): void;
  removeWorktree(repoPath: string, worktreePath: string): void;
  listWorktrees(repoPath: string): WorktreeInfo[];
  getDefaultBranch(repoPath: string): string;
  getBranchCommit(repoPath: string, branch: string): string;
  checkoutCommit(worktreePath: string, commit: string): void;
  checkoutBranch(worktreePath: string, branch: string): void;
  getMergeBase(repoPath: string, branch: string): string;
}

// PathLock - always requires a path, uses O_EXCL for atomic creation
interface PathLock {
  acquire(lockPath: string): void;
  release(lockPath: string): void;
  isHeld(lockPath: string): boolean;
}
```

### Stale Lock Handling

PathLock uses a 30-second TTL for stale lock detection:
- Lock file contains `{ acquiredAt, pid, hostname }` JSON
- On acquire, if lock exists and is older than 30s, assume holder crashed and remove it
- 30 seconds is long enough for slow git operations on large repos

### Adapter Implementations

All adapters live in `core/adapters/` with platform-specific subfolders.

**Node Adapters** (`core/adapters/node/`):
- `fs-adapter.ts` - Uses `fs.readFileSync`, `fs.writeFileSync`, etc.
- `git-adapter.ts` - Uses `child_process.execSync` for git commands
- `path-lock.ts` - Uses `O_EXCL` file creation with 30s stale TTL

**Tauri Adapters** (`core/adapters/tauri/`) - on-demand:
- Create only when frontend needs to share service logic
- Locking not needed (worktree claiming is Node-only)

---

## Current vs Target Architecture

### Current Flow (Frontend-Centric)

```
Spotlight
    ├── 1. taskService.createDraft() → create task folder + metadata
    ├── 2. crypto.randomUUID() → generate threadId
    ├── 3. openTask() → show window optimistically
    ├── 4. worktreeService.allocateRoutingWorktree() → claim worktree via Tauri
    ├── 5. prepareAgent() → create thread entity, build command
    ├── 6. spawn() → start Node process
    └── 7. Forward agent:state events to UI
```

### Target Flow (Node-Centric)

```
Spotlight (optimistic UI)
    ├── 1. crypto.randomUUID() → generate taskId + threadId
    ├── 2. taskService.createDraft() → write task metadata to disk
    ├── 3. openTask() → show window immediately (no thread yet)
    ├── 4. spawn Node process with (taskId, threadId, prompt, anvilDir)
    └── 5. Forward events to UI → create/update thread entity

Node Process (orchestration)
    ├── 1. Read task metadata from disk → get repositoryName
    ├── 2. Allocate routing worktree (claim + checkout)
    ├── 3. Create thread entity on disk (status: "running", workingDirectory, mergeBase)
    ├── 4. Emit thread:created event → Frontend creates thread in store
    ├── 5. Run agent
    └── 6. Release worktree on completion

Events (Node → Frontend)
    ├── thread:created → Frontend creates thread entity in store
    ├── worktree:allocated → Frontend logs/ignores
    ├── agent:state → Frontend updates UI with messages
    └── agent:completed → Frontend marks thread complete
```

**Thread creation in Node:**
- Frontend spawns Node with taskId + threadId (just UUIDs, no entity yet)
- Node creates the thread entity on disk after allocating worktree
- Node emits `thread:created` event with full thread data
- Frontend reacts to event and creates thread in store
- This ensures thread has workingDirectory and mergeBase from the start

---

## Shared Services (Single Responsibility)

Each service class has ONE responsibility. See "Single Responsibility Breakdown" section above for the full pattern.

### Service Summary

| Service | Responsibility | Adapter Dependencies |
|---------|---------------|---------------------|
| `WorktreeAllocationService` | Allocate/release worktrees for threads | GitAdapter, PathLock, FileSystemAdapter |
| `TaskDraftService` | Create draft tasks | FileSystemAdapter |
| `TaskMetadataService` | Read/update task metadata | FileSystemAdapter |
| `ThreadService` | Create/read/update thread metadata | FileSystemAdapter |
| `BranchService` | Create/delete git branches | GitAdapter |
| `MergeBaseService` | Compute merge base commits | GitAdapter |
| `RepositorySettingsService` | Load/save repository settings.json | FileSystemAdapter |

### Example: WorktreeAllocationService

```typescript
// core/services/worktree/allocation-service.ts

export class WorktreeAllocationService {
  constructor(
    private anvilDir: string,
    private settingsService: RepositorySettingsService,
    private mergeBaseService: MergeBaseService,
    private git: GitAdapter,
    private pathLock: PathLock
  ) {}

  allocate(repoName: string, threadId: string): WorktreeAllocation {
    const lockPath = `${this.anvilDir}/repositories/${repoName}/.lock`;
    return this.withLock(lockPath, () => {
      const settings = this.settingsService.load(repoName);

      // Find available or create new
      let worktree = settings.worktrees.find(w => !w.claim);
      if (!worktree) {
        worktree = this.createWorktree(repoName, settings);
      }

      // Claim it
      worktree.claim = { threadId, taskId: null, claimedAt: Date.now() };
      this.settingsService.save(repoName, settings);

      // Checkout at merge base
      const mergeBase = this.mergeBaseService.compute(
        settings.sourcePath,
        settings.defaultBranch
      );
      this.git.checkoutCommit(worktree.path, mergeBase);

      return { worktree, mergeBase };
    });
  }

  release(repoName: string, threadId: string): void {
    const lockPath = `${this.anvilDir}/repositories/${repoName}/.lock`;
    this.withLock(lockPath, () => {
      const settings = this.settingsService.load(repoName);
      const worktree = settings.worktrees.find(w => w.claim?.threadId === threadId);
      if (worktree) {
        worktree.claim = null;
        this.settingsService.save(repoName, settings);
      }
    });
  }

  // Helper that acquires lock, runs callback, releases lock
  private withLock<T>(lockPath: string, fn: () => T): T {
    this.pathLock.acquire(lockPath);
    try {
      return fn();
    } finally {
      this.pathLock.release(lockPath);
    }
  }
}
```

---

## New Runner Arguments

Current runner args:
```
--agent, --cwd, --prompt, --thread-id, --task-id, --anvil-dir, --merge-base
```

New runner args (simplified):
```
--agent         Agent type (planning, execution, etc.)
--prompt        User's query
--anvil-dir      Data directory (~/.anvil)
--task-id       UUID - task must exist on disk (frontend creates draft before spawning)
--thread-id     UUID - Node will create the thread entity
```

**Removed arguments:**
- `--cwd` - Node allocates worktree and sets cwd
- `--merge-base` - Node computes from allocated worktree
- `--repo-name` - Node reads repositoryName from task metadata on disk

**Key simplification:** The frontend ALWAYS creates a draft task before spawning Node. This means:
- Task metadata always exists on disk when Node starts
- Node reads `repositoryName` from task metadata (no need for `--repo-name` arg)
- Repository settings are looked up by `repositoryName`

**Resolution logic:**
```typescript
// Both IDs are required (frontend generates and passes them)
const { taskId, threadId, prompt, anvilDir } = args;

// Read task metadata from disk - frontend already created draft
const taskMetadataService = new TaskMetadataService(anvilDir, fs);
const taskMeta = taskMetadataService.get(taskId);
const repoName = taskMeta.repositoryName;

// Allocate worktree
const allocation = allocationService.allocate(repoName, threadId);

// Create thread entity on disk
const threadService = new ThreadService(anvilDir, fs);
threadService.create({
  id: threadId,
  taskId,
  status: 'running',
  workingDirectory: allocation.worktree.path,
  mergeBase: allocation.mergeBase,
  createdAt: Date.now(),
});

// Emit event for frontend
emitEvent({ type: 'thread:created', thread: { id: threadId, ... } });
```

**Usage example:**
```bash
# Frontend creates task draft, then spawns Node with IDs
node runner.js --agent planning --task-id abc --thread-id def --prompt "..." --anvil-dir ~/.anvil
```

---

## Implementation Phases

### Phase 0: Import Boundary Setup

Configure tsconfig paths so `agents/` can import from `core/`.

**Files:**
- `tsconfig.json` (root)
- `agents/tsconfig.json`

**Tasks:**
1. Add path alias in root tsconfig:
   ```json
   {
     "compilerOptions": {
       "paths": {
         "@core/*": ["./core/*"]
       }
     }
   }
   ```
2. Extend root tsconfig in agents:
   ```json
   {
     "extends": "../tsconfig.json",
     "compilerOptions": {
       "baseUrl": ".",
       "paths": {
         "@core/*": ["../core/*"]
       }
     }
   }
   ```
3. Update agents bundler (esbuild/tsup) to resolve `@core/*` paths
4. Verify imports work: `import { GitAdapter } from '@core/adapters/types'`

**Why tsconfig paths over pnpm workspace:**
- Simpler setup - no need to publish/link packages
- Single source of truth - no version sync issues
- IDE support works out of the box

**Note:** `core/` already exists with `services/fs-adapter.ts` - extend this structure.

---

### Phase 1: Adapter Interfaces & Node Implementation

**Files:**
- `core/adapters/types.ts` - Shared adapter interfaces (all sync)
- `core/adapters/node/fs-adapter.ts` - Node filesystem adapter
- `core/adapters/node/git-adapter.ts` - Node git adapter
- `core/adapters/node/path-lock.ts` - Node path lock

**Tasks:**
1. Define adapter interfaces in `core/adapters/types.ts` (all methods sync)
2. Implement Node filesystem adapter using `fs.readFileSync`, `fs.writeFileSync`, etc.
3. Implement Node git adapter using `child_process.execSync`
4. Implement Node PathLock using `O_EXCL` atomic file creation
5. Write tests for each adapter

---

### Phase 2: PathLock (Node Lock Adapter)

**Files:**
- `core/adapters/node/path-lock.ts`

**Tasks:**
1. Implement `acquire(lockPath)` with O_EXCL atomic creation
2. Implement stale lock detection (30 second TTL - long enough for slow git operations)
3. Lock file contains `{ acquiredAt, pid, hostname }` JSON for debugging
4. Implement `release(lockPath)` - removes the lock file
5. Implement `isHeld(lockPath)` - checks if lock file exists and is not stale
6. All methods are synchronous (use `fs.openSync`, `fs.unlinkSync`, etc.)
7. Write comprehensive tests

---

### Phase 3: Shared Services (Single Responsibility)

**IMPORTANT:** Each service class has ONE responsibility. Do not create monolithic services.

**Files:**
```
core/services/
├── repository/
│   └── settings-service.ts       # Load/save settings.json
├── worktree/
│   └── allocation-service.ts     # Allocate/release worktrees
├── task/
│   ├── draft-service.ts          # Create draft tasks
│   └── metadata-service.ts       # Read/update metadata
├── thread/
│   └── thread-service.ts         # Create/read/update threads
└── git/
    ├── branch-service.ts         # Create/delete branches
    └── merge-base-service.ts     # Compute merge base
```

**Tasks:**
1. Create RepositorySettingsService (load/save only)
2. Create MergeBaseService (compute only)
3. Create WorktreeAllocationService (allocate/release)
4. Create TaskDraftService and TaskMetadataService
5. Create ThreadService (create/read/update - Node creates threads)
6. Create BranchService
7. All services are synchronous (no async/await)
8. Write tests for each service in isolation (mock dependencies)

**Delete:** `src/lib/workspace-service.ts` - do not migrate, rewrite from scratch

---

### Phase 4: Wire Up Node Runner

**Files:**
- `agents/src/runner.ts`
- `agents/src/orchestration.ts` (new)

**Tasks:**
1. Simplify argument parsing (remove `--cwd`, `--merge-base` flags; require `--task-id` and `--thread-id`)
2. Create Node adapter instances
3. Create service instances with Node adapters
4. Create orchestration flow (all synchronous):
   ```typescript
   function orchestrate(args: RunnerArgs): OrchestrationResult {
     // Create adapters (all sync)
     const fs = new NodeFileSystemAdapter();
     const git = new NodeGitAdapter();
     const pathLock = new NodePathLock();

     // Create services (single responsibility, composed via DI)
     const settingsService = new RepositorySettingsService(args.anvilDir, fs);
     const mergeBaseService = new MergeBaseService(args.anvilDir, git);
     const taskMetadataService = new TaskMetadataService(args.anvilDir, fs);
     const threadService = new ThreadService(args.anvilDir, fs);
     const allocationService = new WorktreeAllocationService(
       args.anvilDir,
       settingsService,
       mergeBaseService,
       git,
       pathLock
     );

     // Read task metadata - frontend already created draft on disk
     const taskMeta = taskMetadataService.get(args.taskId);
     const repoName = taskMeta.repositoryName;

     // Allocate worktree
     const allocation = allocationService.allocate(repoName, args.threadId);
     emitEvent({ type: 'worktree:allocated', allocation });

     // Create thread entity on disk (Node owns thread creation)
     const thread = threadService.create({
       id: args.threadId,
       taskId: args.taskId,
       status: 'running',
       workingDirectory: allocation.worktree.path,
       mergeBase: allocation.mergeBase,
       createdAt: Date.now(),
     });
     emitEvent({ type: 'thread:created', thread });

     return {
       taskId: args.taskId,
       threadId: args.threadId,
       cwd: allocation.worktree.path,
       mergeBase: allocation.mergeBase,
       repoName,
     };
   }

   // Cleanup handler for process exit (sync, so it works with process.on('exit'))
   function setupCleanup(
     allocationService: WorktreeAllocationService,
     repoName: string,
     threadId: string
   ) {
     const cleanup = () => {
       try {
         allocationService.release(repoName, threadId);
         emitEvent({ type: 'worktree:released', threadId });
       } catch {
         // Ignore cleanup errors
       }
     };

     process.on('exit', cleanup);
     process.on('SIGINT', () => { cleanup(); process.exit(0); });
     process.on('SIGTERM', () => { cleanup(); process.exit(0); });
   }
   ```
5. Add cleanup on exit (release worktree) - works because everything is sync
6. Write integration tests

**Single mode:** Frontend always creates task draft first, then spawns Node with task-id and thread-id.

---

### Phase 5: Tauri Adapters (On-Demand)

Create Tauri adapters only when there's a concrete need in the frontend. Don't speculatively create adapters.

**Likely NOT needed:**
- `tauri-lock-adapter.ts` - Locking is only for worktree claiming, which lives in Node now

**Create on-demand if needed:**
- `tauri-fs-adapter.ts` - Only if frontend needs to share a service that uses FileSystemAdapter
- `tauri-git-adapter.ts` - Only if frontend needs git operations through shared services

**Principle:** Start with Node adapters only. Add Tauri adapters later if/when a concrete use case emerges that requires sharing service logic with the frontend.

---

### Phase 6: Simplify Frontend

**Files:**
- `src/components/spotlight/spotlight.tsx`
- `src/lib/agent-service.ts`

**Tasks:**
1. Remove worktree allocation from spotlight (Node does this now)
2. Keep draft creation in spotlight (frontend creates task, Node creates thread)
3. Simplify `prepareAgent()` - only pass minimal args:
   - `--agent`, `--prompt`, `--thread-id`, `--task-id`, `--anvil-dir`
   - Remove `--cwd`, `--merge-base` (Node computes these)
4. Add event handlers for new Node events:
   - `thread:created` → Create thread entity in store
   - `worktree:allocated` → Log/debug only
5. Remove unused imports and workspace-service dependency
6. Delete `src/lib/workspace-service.ts`

---

### Phase 7: Cleanup

**Files:**
- `src-tauri/src/anvil_commands.rs`
- `src-tauri/src/git_commands.rs`
- `src/lib/workspace-service.ts` (rename to worktree-service or delete)

**Tasks:**
1. Rename any remaining "workspace" references to "worktree"
2. Keep Rust commands that are still needed (low-level primitives)
3. Remove business logic from Rust that's now in TypeScript
4. Delete unused frontend orchestration code

---

## Directory Structure

All shared code lives in `core/` (already exists). Each service is a single-responsibility class.

```
core/
├── adapters/
│   ├── types.ts                  # Shared adapter interfaces
│   ├── node/                     # Node implementations (all sync)
│   │   ├── fs-adapter.ts
│   │   ├── git-adapter.ts
│   │   └── path-lock.ts
│   └── tauri/                    # Tauri implementations (on-demand)
│       └── (empty initially)
├── services/
│   ├── worktree/
│   │   └── allocation-service.ts # Allocate/release worktrees
│   ├── task/
│   │   ├── draft-service.ts      # Create draft tasks
│   │   └── metadata-service.ts   # Read/update task metadata
│   ├── thread/
│   │   └── thread-service.ts     # Create/read/update threads
│   ├── git/
│   │   ├── branch-service.ts     # Create/delete branches
│   │   └── merge-base-service.ts # Compute merge bases
│   └── repository/
│       └── settings-service.ts   # Load/save repository settings
└── types/
    └── index.ts                  # Shared domain types

agents/src/
├── orchestration.ts              # Composes core services with node adapters
└── runner.ts                     # Entry point
```

**Note:** `core/` already exists. Delete `src/lib/workspace-service.ts` - do not migrate, rewrite with single-responsibility services.

**Import boundaries:**
- `agents/` imports from `core/adapters/node/` and `core/services/`
- Frontend imports from `core/adapters/tauri/` and `core/services/` (when needed)
- Platform-specific adapters are never cross-imported

---

## New Event Types

Node process will emit these new events to stdout:

```typescript
// Emitted after worktree allocation
interface WorktreeAllocatedEvent {
  type: 'worktree:allocated';
  worktree: WorktreeState;
  branch: string;
  mergeBase: string;
}

// Emitted after thread creation (Node creates threads, not frontend)
interface ThreadCreatedEvent {
  type: 'thread:created';
  thread: {
    id: string;
    taskId: string;
    status: 'running';
    workingDirectory: string;
    mergeBase: string;
    createdAt: number;
  };
}

// Emitted on worktree release
interface WorktreeReleasedEvent {
  type: 'worktree:released';
  threadId: string;
}
```

Frontend handles these in the stdout handler alongside `ThreadState`.

---

## Testing Strategy

### Unit Tests
- **Adapters:** Test each adapter in isolation
- **Services:** Test with mock adapters (easy to inject test doubles)
- **Orchestration:** Test full flow with mock adapters

### Integration Tests
- Full orchestration flow with real git repo
- Worktree allocation and release
- Concurrent worktree claims (lock contention)

### E2E Tests
- Spotlight → Task creation → Agent runs → Completion
- Verify events received correctly

---

## Migration Path

1. **Parallel implementation:** Build adapters and services without changing frontend
2. **Feature flag:** Add `--allocate-worktree` flag, default off
3. **Gradual rollout:** Enable flag in dev, test thoroughly
4. **Cutover:** Change default, remove old frontend orchestration
5. **Cleanup:** Remove deprecated code, rename workspace → worktree

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Git operations behave differently | Extensive tests, compare output with Tauri version |
| Lock contention in Node vs Rust | Use same file-based locking strategy |
| Shared code complexity | Clear adapter boundaries, thorough testing |
| State inconsistency during migration | Feature flag allows quick rollback |

---

## Open Questions

1. **Thread entity creation:** Keep in frontend for optimistic UI, or move to Node?
   - **Decision:** Node creates threads
   - Node emits `thread:created` event after allocating worktree
   - Thread has workingDirectory and mergeBase from the start (no partial state)

2. **Shared code location:** Where should `core/` live?
   - **Decision:** Use tsconfig paths (see Phase 0)
   - `agents/` imports from `@core/*` which resolves to `../core/*`

3. **Existing workspace-service.ts:** Refactor to use adapters, or delete and use shared?
   - **Decision:** Delete once Node orchestration is complete

4. **Sync vs async operations:**
   - **Decision:** All Node operations are synchronous
   - Simpler control flow, works with `process.on('exit')` cleanup
   - Uses `fs.readFileSync`, `execSync`, etc.

---

## Success Criteria

- [ ] Runner accepts: `node runner.js --agent planning --task-id xxx --thread-id yyy --prompt "..." --anvil-dir ~/.anvil`
- [ ] Node reads task metadata from disk to get repositoryName
- [ ] Node allocates worktree without any frontend involvement
- [ ] Node creates thread entity on disk and emits `thread:created` event
- [ ] No Tauri round-trips for worktree operations during agent start
- [ ] All operations are synchronous (cleanup works on process exit)
- [ ] All "workspace" terminology replaced with "worktree"
- [ ] Shared services work with Node adapters (Tauri adapters on-demand later)
- [ ] Existing tests pass
- [ ] New unit tests for adapters and services
- [ ] Spotlight code reduced significantly (worktree + thread logic removed)

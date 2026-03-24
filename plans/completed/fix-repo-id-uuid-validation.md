# Fix Repository ID and Worktree ID UUID Validation

## Problem Summary

When spawning agents from the spotlight, the repository **name** (e.g., "anvil") is being passed instead of the repository **UUID**. This causes Zod validation failures because `ThreadMetadataSchema` now requires `repoId` and `worktreeId` to be valid UUIDs.

### Error from logs:
```
Invalid thread metadata during cleanup: [
  {
    "path": ["repoId"],
    "message": "Invalid UUID"
  },
  {
    "path": ["worktreeId"],
    "message": "Invalid UUID"
  }
]
```

## Root Cause Analysis

### 1. Spotlight passes repo.name instead of repo ID

**File:** `src/components/spotlight/spotlight.tsx:245`
```typescript
await spawnSimpleAgent({
  repoId: repo.name,  // BUG: "anvil" instead of UUID
  threadId,
  prompt: content,
  sourcePath: workingDir,
});
```

The `Repository` type from `core/types/repositories.ts` does not include an `id` field - only `RepositorySettings` has the UUID `id`.

### 2. worktreeId is set equal to repoId in runner

**File:** `agents/src/runners/simple-runner-strategy.ts:172`
```typescript
const worktreeId = repoId;  // Inherits the invalid name value
```

### 3. ThreadMetadataSchema requires UUIDs

**File:** `core/types/threads.ts:27-28`
```typescript
repoId: z.string().uuid(),      // Must be UUID
worktreeId: z.string().uuid(),  // Must be UUID
```

### 4. SpawnSimpleAgentOptions accepts any string

**File:** `src/lib/agent-service.ts`
```typescript
export interface SpawnSimpleAgentOptions {
  repoId: string;  // No UUID enforcement at type level
  threadId: string;
  prompt: string;
  sourcePath: string;
}
```

## Data Flow

```
Spotlight Controller (spotlight.tsx)
    ↓
    repo.name ("anvil") → spawnSimpleAgent()
    ↓
Agent Service (agent-service.ts)
    ↓
    --repo-id anvil → Runner CLI
    ↓
Simple Runner Strategy (simple-runner-strategy.ts)
    ↓
    worktreeId = repoId ("anvil")
    ↓
Thread Metadata Creation
    ↓
    ThreadMetadataSchema validation FAILS
```

## Solution

### Phase 1: Pass correct IDs from Spotlight

#### 1.1 Add worktreeId to SpawnSimpleAgentOptions

**File:** `src/lib/agent-service.ts`

```typescript
export interface SpawnSimpleAgentOptions {
  repoId: string;      // Repository UUID
  worktreeId: string;  // Worktree UUID (can be same as repoId for main worktree)
  threadId: string;
  prompt: string;
  sourcePath: string;
}
```

Add `--worktree-id` to CLI args:
```typescript
const commandArgs = [
  runnerPath,
  "--repo-id", options.repoId,
  "--worktree-id", options.worktreeId,  // NEW
  "--thread-id", options.threadId,
  "--cwd", options.sourcePath,
  "--prompt", options.prompt,
  "--anvil-dir", anvilDir,
];
```

#### 1.2 Update SimpleRunnerStrategy to accept worktreeId

**File:** `agents/src/runners/simple-runner-strategy.ts`

Update `parseArgs()` to accept `--worktree-id`:
```typescript
interface SimpleRunnerArgs {
  repoId: string;
  worktreeId: string;  // NEW
  threadId: string;
  cwd: string;
  prompt: string;
  anvilDir: string;
}
```

Remove the line `const worktreeId = repoId;` and use the parsed worktreeId directly.

#### 1.3 Lookup repository settings in Spotlight

**File:** `src/components/spotlight/spotlight.tsx`

Before calling `spawnSimpleAgent`, lookup the repository settings to get the UUID:

```typescript
import { loadSettings } from "@/lib/persistence";

async createSimpleThread(content: string, repo: Repository, worktreePath?: string): Promise<void> {
  // ... existing code ...

  // Lookup repository settings to get the UUID
  const slug = repo.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const settings = await loadSettings(slug);

  // Determine worktree ID - either from selected worktree or use main worktree
  let worktreeId: string;
  if (worktreePath) {
    // Find worktree by path
    const worktree = settings.worktrees.find(w => w.path === worktreePath);
    if (!worktree) {
      throw new Error(`Worktree not found for path: ${worktreePath}`);
    }
    worktreeId = worktree.id;
  } else {
    // Use main worktree (first in list, or create if missing)
    const mainWorktree = settings.worktrees.find(w => w.name === 'main');
    if (!mainWorktree) {
      throw new Error(`Main worktree not found for repository: ${repo.name}`);
    }
    worktreeId = mainWorktree.id;
  }

  await spawnSimpleAgent({
    repoId: settings.id,     // UUID from settings
    worktreeId,              // UUID from worktree
    threadId,
    prompt: content,
    sourcePath: workingDir,
  });
}
```

### Phase 2: Ensure UUID validation across all schemas

#### 2.1 Verify thread-related schemas use UUID

Files to check:
- `core/types/threads.ts` - Already has `.uuid()` validation
- `agents/src/runners/types.ts` - Check if thread types match

#### 2.2 Add runtime validation in agent-service

**File:** `src/lib/agent-service.ts`

Add validation before spawning:
```typescript
import { z } from "zod";

const SpawnOptionsSchema = z.object({
  repoId: z.string().uuid(),
  worktreeId: z.string().uuid(),
  threadId: z.string().uuid(),
  prompt: z.string(),
  sourcePath: z.string(),
});

export async function spawnSimpleAgent(options: SpawnSimpleAgentOptions): Promise<void> {
  // Validate UUIDs early to fail fast with clear error
  const parsed = SpawnOptionsSchema.parse(options);
  // ... rest of function uses parsed values
}
```

### Phase 3: Update tests

#### 3.1 Update agent service tests

Ensure tests pass valid UUIDs:
```typescript
await spawnSimpleAgent({
  repoId: crypto.randomUUID(),
  worktreeId: crypto.randomUUID(),
  threadId: crypto.randomUUID(),
  prompt: "test",
  sourcePath: "/tmp/test",
});
```

#### 3.2 Update spotlight tests

Update any mocks that pass repo names instead of UUIDs.

### Phase 4: Event emissions

#### 4.1 Update event bridge typing

**File:** `agents/src/lib/events.ts`

The `threadCreated` event emits `repoId` and `worktreeId`. These should now always be UUIDs since we're fixing the source.

No changes needed to event types, but verify that all event handlers expect UUIDs.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/agent-service.ts` | Add `worktreeId` to options, add validation, update CLI args |
| `src/components/spotlight/spotlight.tsx` | Lookup settings to get UUID, pass worktreeId |
| `agents/src/runners/simple-runner-strategy.ts` | Parse `--worktree-id` arg, remove `worktreeId = repoId` |
| `agents/src/runners/types.ts` | Add `worktreeId` to args interface if separate |

## Testing Checklist

- [ ] Create new thread from spotlight - verify repoId and worktreeId are UUIDs in metadata.json
- [ ] Create thread in worktree - verify worktreeId matches the worktree's UUID
- [ ] Thread events contain valid UUIDs
- [ ] Control panel loads thread correctly (no validation errors)
- [ ] Thread list in main window shows threads correctly

## Rollback Plan

If issues arise, the schema can be temporarily relaxed back to `z.string()` in `core/types/threads.ts` while the fix is completed. However, this should be avoided as it masks the underlying data integrity issue.

## Success Criteria

1. No "Invalid UUID" errors in logs when creating threads
2. All thread metadata files contain valid UUIDs for `repoId` and `worktreeId`
3. Threads correctly associate with their repository and worktree
4. Control panel displays thread state correctly after agent completion

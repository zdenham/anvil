# Thread Storage Consolidation Plan

> **NO MIGRATION. NO BACKWARDS COMPATIBILITY.**
>
> This is a clean break. Existing `.anvil/threads/` data will be orphaned and ignored.
> Users must delete their `.anvil/threads/` directory before using the new version.
> We have not launched yet, so there is no need to preserve old data.

## Problem Statement

The `.anvil/threads/` directory contains both flat JSON files and folders for threads:

```
.anvil/threads/
├── c4f6f401-fb01-4a57-bf6f-9bf66773190f.json     # Flat file (frontend)
├── c4f6f401-fb01-4a57-bf6f-9bf66773190f/         # Folder (runner)
│   ├── metadata.json
│   └── state.json
```

Every thread has BOTH formats, creating duplicate and divergent metadata.

## Root Cause Analysis

Two separate systems write thread storage with different formats:

### 1. Frontend (threadService)
**File:** `src/entities/threads/service.ts`
**Writes:** `threads/{uuid}.json`

```typescript
// threadService.create() writes flat file
await persistence.writeJson(`${THREADS_DIR}/${thread.id}.json`, thread)
```

Called from `agent-service.ts:prepareAgent()` → `threadService.create()`

### 2. Agent Runner
**File:** `agents/src/runner.ts`
**Writes:** `threads/{uuid}/metadata.json` + `threads/{uuid}/state.json`

```typescript
// runner.ts creates folder structure
const threadPath = join(args.anvilDir, "threads", args.threadId);
mkdirSync(threadPath, { recursive: true });
writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
```

The runner also uses `output.ts` to write `state.json` with full message history.

### 3. Duplicating Effort in agent-service.ts

**File:** `src/lib/agent-service.ts` (lines 143-149)

```typescript
// Step 1: Creates flat file via threadService
const thread = await threadService.create({ ... });

// Step 2: ALSO creates the folder (but no files yet)
const threadPath = fs.joinPath(anvilDir, "threads", thread.id);
await fs.mkdir(threadPath);
```

Then when the runner spawns, it writes `metadata.json` and `state.json` into that folder.

## Data Divergence

The two metadata files contain different data:

### Flat file (`{uuid}.json`) has:
- `exitCode` and `costUsd` in turns (set by `threadService.completeTurn()`)
- Final status from frontend perspective

### Folder metadata (`{uuid}/metadata.json`) has:
- `git.branch` and `git.mergeBase` (set by runner)
- Timestamps from runner's perspective

Neither is complete on its own.

## Touchpoints (Files to Modify)

### Primary Touchpoints

| File | Current Behavior | Change Needed |
|------|-----------------|---------------|
| `src/entities/threads/service.ts` | Writes `{id}.json`, reads `*.json` files | Change to folder structure |
| `src/lib/agent-service.ts` | Creates thread + folder | Remove duplicate folder creation |
| `agents/src/runner.ts` | Writes `{id}/metadata.json` | Keep - runner is primary writer, use read-modify-write |
| `agents/src/output.ts` | Writes `{id}/state.json` | Keep (state.json is correct) |

### Secondary Touchpoints

| File | Current Behavior | Change Needed |
|------|-----------------|---------------|
| `src/hooks/use-thread-messages.ts` | Reads `{id}/state.json` | No change (already folder-based) |
| `src/lib/persistence.ts` | Generic persistence layer | Add `listDirEntries()` method |

## Proposed Solution

**Target Structure:**
```
.anvil/threads/{uuid}/
├── metadata.json    # Thread metadata (single source of truth, written by frontend only)
└── state.json       # Message history + file changes (written by runner)
```

### Step 1: Update threadService (src/entities/threads/service.ts)

Change all operations to use folder structure:

```typescript
// Current
`${THREADS_DIR}/${thread.id}.json`

// New
`${THREADS_DIR}/${thread.id}/metadata.json`
```

Methods to update:
- `hydrate()` - Change from scanning `*.json` to scanning directories
- `create()` - Write to `{id}/metadata.json` instead of `{id}.json`
- `update()` - Write to `{id}/metadata.json`
- `addTurn()` - Write to `{id}/metadata.json`
- `completeTurn()` - Write to `{id}/metadata.json`
- `delete()` - Delete entire `{id}/` folder

### Step 2: Runner owns metadata.json (disk is source of truth)

The runner writes to disk and disk is the source of truth. This is a requirement for other parts of the system.

**Solution: Runner is primary writer, frontend reads before writing**
- Runner creates and updates `metadata.json` on disk
- Frontend ALWAYS reads from disk before any update (read-modify-write)
- Frontend updates specific fields (`costUsd`, `exitCode`) via read-modify-write
- No in-memory caching of metadata in frontend - always go to disk

**Race condition mitigation:**
- Frontend must read current state from disk immediately before writing
- Runner writes are authoritative for: `status`, `git`, `turns[].prompt`, timestamps
- Frontend writes are authoritative for: `turns[].costUsd`, `turns[].exitCode`
- Both use read-modify-write pattern to preserve other fields

### Step 3: Update agent-service.ts

Remove the redundant `fs.mkdir(threadPath)` call since `threadService.create()` will now create the folder.

### Step 4: Handle state.json lifecycle

Clarify `state.json` ownership:
- **Writer:** Runner only (via `output.ts`)
- **Initial creation:** Runner creates on first message
- **Edge case:** If thread created but runner never starts (user cancels), folder will have `metadata.json` but no `state.json`
- **Reading:** Frontend reads `state.json` if it exists, treats missing file as empty message history

## Implementation Order

1. **Add persistence.listDirEntries()**
   - Add method to persistence layer to list directory entries with `isDirectory` flag
   - Required for folder-based hydration

2. **Update threadService**
   - Change all paths from `{id}.json` to `{id}/metadata.json`
   - Update `hydrate()` to scan directories only (flat files are ignored)
   - Use read-modify-write pattern for all updates

3. **Clean up agent-service.ts**
   - Remove redundant `fs.mkdir()` call
   - `threadService.create()` handles folder creation

4. **Delete existing .anvil/threads/ directory** (manual step for developers)
   - Old data is not migrated, just delete it

## Performance Considerations

**Concern:** Scanning directories then reading `metadata.json` from each is slower than glob-matching `*.json`.

**Mitigations:**
1. Use parallel reads: `Promise.all()` for reading multiple `metadata.json` files
2. Acceptable tradeoff: Folder structure provides cleaner data model, startup cost is one-time

## Code Changes Detail

### persistence.ts Addition

```typescript
// Add to persistence layer
async listDirEntries(path: string): Promise<Array<{ name: string; isDirectory: boolean }>> {
  const entries = await fs.readDir(path);
  return entries.map(entry => ({
    name: entry.name,
    isDirectory: entry.isDirectory,
  }));
}
```

### threadService.ts Changes

```typescript
// hydrate() - scan directories, read metadata.json from each
async hydrate(): Promise<void> {
  await persistence.ensureDir(THREADS_DIR);
  const entries = await persistence.listDirEntries(THREADS_DIR);
  const threads: Record<string, ThreadMetadata> = {};

  // Read all metadata files in parallel
  await Promise.all(
    entries
      .filter(entry => entry.isDirectory)
      .map(async entry => {
        const metadata = await persistence.readJson<ThreadMetadata>(
          `${THREADS_DIR}/${entry.name}/metadata.json`
        );
        if (metadata) threads[metadata.id] = metadata;
      })
  );

  useThreadStore.getState().hydrate(threads);
}

// create() - create folder with metadata.json
async create(input: CreateThreadInput): Promise<ThreadMetadata> {
  // ... create metadata object ...

  await persistence.ensureDir(`${THREADS_DIR}/${metadata.id}`);
  await persistence.writeJson(`${THREADS_DIR}/${metadata.id}/metadata.json`, metadata);

  return metadata;
}

// delete() - remove entire folder
async delete(id: string): Promise<void> {
  // ... unlink from task ...

  await persistence.removeDir(`${THREADS_DIR}/${id}`);
}

// completeTurn() - read-modify-write pattern
async completeTurn(id: string, turnIndex: number, data: { exitCode: number; costUsd: number }): Promise<void> {
  const metadataPath = `${THREADS_DIR}/${id}/metadata.json`;

  // Always read from disk first
  const current = await persistence.readJson<ThreadMetadata>(metadataPath);
  if (!current) throw new Error(`Thread ${id} not found`);

  // Update only our fields
  current.turns[turnIndex] = {
    ...current.turns[turnIndex],
    exitCode: data.exitCode,
    costUsd: data.costUsd,
  };
  current.updatedAt = new Date().toISOString();

  // Write back
  await persistence.writeJson(metadataPath, current);
}
```

### runner.ts Changes

```typescript
// Runner continues to write metadata.json - this is correct
// Use read-modify-write to preserve frontend-written fields

const metadataPath = join(threadPath, "metadata.json");
let metadata: ThreadMetadata;

if (existsSync(metadataPath)) {
  // Read existing metadata (may have frontend-written fields)
  const existing = JSON.parse(readFileSync(metadataPath, "utf-8"));
  metadata = {
    ...existing,  // Preserve exitCode, costUsd from frontend
    status: "running",
    updatedAt: startTime,
    git: {
      branch: taskBranch || getCurrentBranch(args.cwd),
      ...(args.mergeBase && { mergeBase: args.mergeBase }),
    },
  };
} else {
  // Create new metadata
  metadata = { /* initial fields */ };
}

writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
```

### agent-service.ts Changes

```typescript
// Remove these lines (lines 144-149):
// const threadPath = fs.joinPath(anvilDir, "threads", thread.id);
// await fs.mkdir(threadPath);

// threadService.create() now handles folder creation
```

## Testing Checklist

- [ ] New threads created with folder structure
- [ ] Thread hydration works with folder structure
- [ ] Thread messages load correctly from state.json
- [ ] Thread deletion removes entire folder
- [ ] Multi-turn threads work correctly
- [ ] Resume thread works correctly
- [ ] Thread created but runner cancelled: metadata.json exists, no state.json, UI handles gracefully
- [ ] Parallel thread creation doesn't cause conflicts

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Runner/frontend write conflict | Medium | Read-modify-write pattern; each side owns specific fields |
| Performance regression on hydrate | Low | Parallel reads; acceptable one-time cost |
| Missing state.json (cancelled thread) | Low | UI treats missing file as empty history |

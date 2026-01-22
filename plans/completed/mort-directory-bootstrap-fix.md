# Plan: Fix .mort Directory Bootstrapping

## Problem

The thread-plan-architecture specification (`02-storage-layer.md`) defines a specific directory structure for the `.mort` directory, but the current bootstrapping does not create the full structure upfront.

The current `bootstrapMortDirectory()` function in `src/lib/mort-bootstrap.ts` only ensures:
- `tasks/` (legacy directory that should be removed)
- `repositories/` (via repos.bootstrap())

All other directories are created lazily by services on first use rather than at bootstrap time.

## Goals

1. Remove legacy `tasks/` directory from bootstrap
2. Bootstrap the complete directory structure upfront:
   - `threads/` - active threads
   - `plans/` - active plans
   - `plan-thread-edges/` - relation files
   - `archive/threads/` - archived threads
   - `archive/plans/` - archived plans
   - `archive/plan-thread-edges/` - archived relations
3. Ensure consistent initial state when app starts
4. Enable moving entities to archive rather than deleting them

## Target Directory Structure

```
~/.mort/
├── threads/{threadId}/
│   ├── metadata.json
│   └── state.json
├── plans/{planId}/
│   └── metadata.json
├── plan-thread-edges/
│   └── {planId}-{threadId}.json
└── archive/
    ├── threads/{threadId}/
    │   ├── metadata.json
    │   └── state.json
    ├── plans/{planId}/
    │   └── metadata.json
    └── plan-thread-edges/
        └── {planId}-{threadId}.json
```

## Implementation Steps

### Step 1: Update `bootstrapMortDirectory()` in `src/lib/mort-bootstrap.ts`

Replace the legacy `tasks` directory bootstrapping with the new structure:

```typescript
export async function bootstrapMortDirectory(): Promise<MortStores> {
  const fs = new FilesystemClient();
  const repos = new RepoStoreClient(fs);
  const settings = new SettingsStoreClient(fs);

  await Promise.all([
    // Active entity directories
    persistence.ensureDir("threads"),
    persistence.ensureDir("plans"),
    persistence.ensureDir("plan-thread-edges"),
    // Archive directories (mirror structure for all entities)
    persistence.ensureDir("archive/threads"),
    persistence.ensureDir("archive/plans"),
    persistence.ensureDir("archive/plan-thread-edges"),
    // Other stores
    repos.bootstrap(),
    settings.bootstrap(),
  ]);

  return { fs, repos, settings };
}
```

### Step 2: Update directory constants

Verify/add the following constants are defined and used consistently across services:
- `THREADS_DIRECTORY = "threads"`
- `PLANS_DIRECTORY = "plans"`
- `RELATIONS_DIR = "plan-thread-edges"`
- `ARCHIVE_THREADS_DIR = "archive/threads"`
- `ARCHIVE_PLANS_DIR = "archive/plans"`
- `ARCHIVE_RELATIONS_DIR = "archive/plan-thread-edges"`

### Step 3: Update tests

Update any tests that mock or verify the bootstrap behavior to expect the new directory structure instead of `tasks/`.

### Step 4: Update archive services

Ensure the archive functionality for plans and relations uses the new archive directories:
- `planService` should archive to `archive/plans/{planId}/`
- `relationService` should archive to `archive/plan-thread-edges/`

## Files to Modify

1. `src/lib/mort-bootstrap.ts` - Main bootstrap function
2. `src/entities/plans/service.ts` - Add archive constants and archive functionality
3. `src/entities/relations/service.ts` - Add archive constants and archive functionality
4. Tests for mort-bootstrap and affected services

## Verification

After implementation:
1. Run existing tests to ensure nothing breaks
2. Delete local `.mort` directory and restart app - verify all directories are created:
   - `threads/`
   - `plans/`
   - `plan-thread-edges/`
   - `archive/threads/`
   - `archive/plans/`
   - `archive/plan-thread-edges/`
3. Confirm services still work correctly (threads, plans, relations can be created/archived)
4. Verify archiving moves entities to the correct archive subdirectory

## Notes

- Services will continue to call `ensureDir()` for their specific paths - this is fine as it's idempotent
- The bootstrap ensures a consistent initial state without relying on lazy creation
- This aligns with the "greenfield implementation" approach from the architecture docs where users can delete their `.mort` directory and start fresh
- Archive structure mirrors active structure, making it easy to restore entities if needed

## Files to Modify

1. `src/lib/mort-bootstrap.ts` - Main bootstrap function
2. Tests for mort-bootstrap if they exist
3. Potentially `src/lib/persistence.ts` if directory constant definitions need updating

## Verification

After implementation:
1. Run existing tests to ensure nothing breaks
2. Delete local `.mort` directory and restart app - verify all directories are created
3. Confirm services still work correctly (threads, plans, relations can be created/archived)

## Notes

- Services will continue to call `ensureDir()` for their specific paths - this is fine as it's idempotent
- The bootstrap ensures a consistent initial state without relying on lazy creation
- This aligns with the "greenfield implementation" approach from the architecture docs where users can delete their `.mort` directory and start fresh

# 02d — Migration for Existing Entities

**Layer 1 — parallel with 02a, 02b, 02c. Depends on 01.**

## Summary

One-time startup migration: scan all threads, plans, and PRs on disk that lack a `visualSettings` field and backfill `visualSettings.parentId` from domain relationships (`parentThreadId`, `parentId`) and `worktreeId`. Without this, existing sub-agents and child plans would lose their nesting when the new tree builder (which reads only `visualSettings.parentId`) is deployed.

This migration lives in the **standalone TypeScript migration runner** (`migrations/`), not in the Tauri frontend. The migration runner is a pure Node.js process invoked by Rust during app startup, **before** entity stores hydrate. This ensures entities on disk are already backfilled by the time the frontend reads them.

## Dependencies

- **01-visual-settings-foundation** — `visualSettings` field must exist on entity Zod schemas (so that entities with the new field still parse cleanly)

## Disk Layout Reference

All paths are relative to `$ANVIL_DATA_DIR` (typically `~/.anvil` or `~/.anvil-dev`).

| Entity | Disk path pattern | Schema key for domain parent | `worktreeId` field |
| --- | --- | --- | --- |
| Thread (new) | `threads/{uuid}/metadata.json` | `parentThreadId` (optional UUID) | `worktreeId` (required UUID) |
| Thread (legacy) | `tasks/*/threads/*/metadata.json` | same | same |
| Plan | `plans/{uuid}/metadata.json` | `parentId` (optional UUID) | `worktreeId` (required UUID) |
| Pull Request | `pull-requests/{uuid}/metadata.json` | none | `worktreeId` (required UUID) |

## Key Files

| File | Change |
| --- | --- |
| `migrations/src/migrations/002-visual-settings-backfill.ts` | **New** — migration logic |
| `migrations/src/migrations/index.ts` | Register new migration |

## Implementation

### 1. Create `migrations/src/migrations/002-visual-settings-backfill.ts`

```typescript
/**
 * Migration 002: Backfill visualSettings on existing entities
 *
 * Scans all threads, plans, and PRs on disk. For any entity missing
 * the `visualSettings` field, computes `visualSettings.parentId` from
 * domain relationships and writes it back.
 *
 * Rules:
 *   Thread with parentThreadId    → parentId = parentThreadId
 *   Thread without parentThreadId → parentId = worktreeId
 *   Plan with parentId            → parentId = parentId (domain)
 *   Plan without parentId         → parentId = worktreeId
 *   PR (always)                   → parentId = worktreeId
 *
 * Idempotent: entities that already have `visualSettings` are skipped.
 */

import type { Migration, MigrationContext } from '../types.js';
import { readJsonFile, writeJsonFile, joinPath } from '../utils.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface EntityMetadata {
  visualSettings?: { parentId?: string; sortKey?: string };
  parentThreadId?: string;
  parentId?: string;
  worktreeId?: string;
  [key: string]: unknown;
}

/**
 * Recursively find all metadata.json files under a directory.
 * Handles both flat ({dir}/{uuid}/metadata.json) and nested
 * (tasks/*/threads/*/metadata.json) layouts.
 */
function findMetadataFiles(baseDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(baseDir)) return results;

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const subDir = path.join(baseDir, entry.name);
    const metadataPath = path.join(subDir, 'metadata.json');
    if (fs.existsSync(metadataPath)) {
      results.push(metadataPath);
    }
  }
  return results;
}

/**
 * Find legacy thread metadata files at tasks/*/threads/*/metadata.json.
 */
function findLegacyThreadFiles(dataDir: string): string[] {
  const results: string[] = [];
  const tasksDir = path.join(dataDir, 'tasks');
  if (!fs.existsSync(tasksDir)) return results;

  const taskEntries = fs.readdirSync(tasksDir, { withFileTypes: true });
  for (const taskEntry of taskEntries) {
    if (!taskEntry.isDirectory()) continue;
    const threadsDir = path.join(tasksDir, taskEntry.name, 'threads');
    if (!fs.existsSync(threadsDir)) continue;

    const threadEntries = fs.readdirSync(threadsDir, { withFileTypes: true });
    for (const threadEntry of threadEntries) {
      if (!threadEntry.isDirectory()) continue;
      const metadataPath = path.join(
        threadsDir,
        threadEntry.name,
        'metadata.json',
      );
      if (fs.existsSync(metadataPath)) {
        results.push(metadataPath);
      }
    }
  }
  return results;
}

type EntityKind = 'thread' | 'plan' | 'pull-request';

function computeParentId(kind: EntityKind, entity: EntityMetadata): string | undefined {
  switch (kind) {
    case 'thread':
      return entity.parentThreadId ?? entity.worktreeId;
    case 'plan':
      return entity.parentId ?? entity.worktreeId;
    case 'pull-request':
      return entity.worktreeId;
  }
}

function backfillFiles(
  files: string[],
  kind: EntityKind,
  log: MigrationContext['log'],
): number {
  let count = 0;
  for (const filePath of files) {
    const entity = readJsonFile<EntityMetadata>(filePath);
    if (!entity) {
      log.warn(`Could not read ${filePath}, skipping`);
      continue;
    }

    // Skip if already has visualSettings
    if (entity.visualSettings !== undefined) continue;

    const parentId = computeParentId(kind, entity);
    if (!parentId) {
      log.warn(`No parentId resolvable for ${kind} at ${filePath}, skipping`);
      continue;
    }

    entity.visualSettings = { parentId };
    writeJsonFile(filePath, entity);
    count++;
  }
  return count;
}

export const migration: Migration = {
  version: 3,
  description: 'Backfill visualSettings on existing threads, plans, and PRs',

  async up(ctx: MigrationContext): Promise<void> {
    const { dataDir, log } = ctx;

    // --- Threads ---
    const newThreadFiles = findMetadataFiles(joinPath(dataDir, 'threads'));
    const legacyThreadFiles = findLegacyThreadFiles(dataDir);
    const allThreadFiles = [...newThreadFiles, ...legacyThreadFiles];
    const threadCount = backfillFiles(allThreadFiles, 'thread', log);

    // --- Plans ---
    const planFiles = findMetadataFiles(joinPath(dataDir, 'plans'));
    const planCount = backfillFiles(planFiles, 'plan', log);

    // --- Pull Requests ---
    const prFiles = findMetadataFiles(joinPath(dataDir, 'pull-requests'));
    const prCount = backfillFiles(prFiles, 'pull-request', log);

    const total = threadCount + planCount + prCount;
    log.info('visualSettings backfill complete', {
      threads: threadCount,
      plans: planCount,
      pullRequests: prCount,
      total,
    });
  },
};
```

### 2. Register in `migrations/src/migrations/index.ts`

Add the import and entry to the `migrations` array:

```typescript
import type { Migration } from '../types.js';
import { migration as noop } from './000-noop.js';
import { migration as quickActionsProject } from './001-quick-actions-project.js';
import { migration as visualSettingsBackfill } from './002-visual-settings-backfill.js';

export const migrations: Migration[] = [
  noop,
  quickActionsProject,
  visualSettingsBackfill,
];
```

**Version number: 3.** The existing migrations use version 1 (noop) and version 2 (quick-actions-project). The runner skips migrations whose `version <= config.migration_version`, so this only runs once.

### 3. How Idempotency Works

The migration runner (`migrations/src/runner.ts`) reads `migration_version` from `~/.anvil/settings/app-config.json`. After this migration runs successfully, it writes `migration_version: 3`. On subsequent startups, the runner sees `currentVersion >= 3` and skips this migration entirely.

Within a single run, the migration also guards per-entity: it checks `entity.visualSettings !== undefined` and skips any entity that already has the field. This means even if the version check were somehow bypassed, re-running is safe.

### 4. Execution Order

Rust `run_ts_migrations()` in `src-tauri/src/lib.rs:1061` runs **before** the Tauri webview loads. The webview calls `hydrateEntities()` in `src/entities/index.ts:140` after the window renders. Therefore:

1. Rust spawns `node migrations/dist/runner.js` (runs migration 002)
2. All entity JSON files on disk now have `visualSettings`
3. Tauri webview loads
4. `hydrateEntities()` reads the already-migrated JSON files into stores

No frontend code changes needed for migration wiring.

### 5. Build Step

The migrations package must be rebuilt before the new migration takes effect:

```bash
cd migrations && pnpm build
```

This compiles `src/migrations/002-visual-settings-backfill.ts` to `dist/migrations/002-visual-settings-backfill.js`. The Rust startup code resolves `migrations/dist/runner.js` (dev mode) or the bundled resource (production).

### 6. What About Worktrees?

`WorktreeState` entities live inside `~/.anvil/repositories/{repo-slug}/settings.json` as entries in a `worktrees[]` array. Worktree nodes are tree roots (their `visualSettings.parentId` is `undefined`), so **no backfill is needed** for worktrees. The tree builder treats `undefined` parentId as "root-level node", which is the correct default for worktrees.

### 7. What About Terminals?

Terminal sessions are currently runtime-only (no disk persistence). Sub-plan 02a adds disk persistence with `visualSettings` seeded at creation time. There are no existing persisted terminals to migrate.

## Acceptance Criteria

- [ ] `migrations/src/migrations/002-visual-settings-backfill.ts` exists and exports a `Migration` with `version: 3`
- [ ] `migrations/src/migrations/index.ts` includes the new migration in the array
- [ ] After migration, every thread on disk has `visualSettings.parentId`
- [ ] Sub-agent threads have `visualSettings.parentId` = their `parentThreadId`
- [ ] Child plans have `visualSettings.parentId` = their domain `parentId`
- [ ] Root threads/plans (no domain parent) have `visualSettings.parentId` = their `worktreeId`
- [ ] PRs have `visualSettings.parentId` = their `worktreeId`
- [ ] Legacy threads at `tasks/*/threads/*/metadata.json` are also backfilled
- [ ] Migration is idempotent: running it on already-migrated data changes nothing
- [ ] `migration_version` in `~/.anvil/settings/app-config.json` is set to `3` after success
- [ ] Migration logs entity counts (threads, plans, PRs migrated)
- [ ] `cd migrations && pnpm build` succeeds with no TypeScript errors

## Phases

- [x] Create `migrations/src/migrations/002-visual-settings-backfill.ts` with `findMetadataFiles`, `findLegacyThreadFiles`, `computeParentId`, `backfillFiles`, and the exported `migration` object

- [x] Register in `migrations/src/migrations/index.ts` (import + add to array)

- [x] Build: `cd migrations && pnpm build` — verify it compiles

- [ ] Test manually: create a test `~/.anvil-dev/` directory with sample thread/plan/PR metadata files (some with `visualSettings`, some without), run `ANVIL_DATA_DIR=~/.anvil-dev ANVIL_TEMPLATE_DIR=core/sdk/template ANVIL_SDK_TYPES_PATH=core/sdk/dist/index.d.ts node migrations/dist/runner.js`, verify JSON files are updated and logs show correct counts

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

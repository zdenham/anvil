# 03: Skills Service

## Overview

Create the **single `SkillsService` class** that contains ALL business logic for skill discovery, parsing, and management. This service accepts a `FilesystemAdapter` as a constructor dependency, allowing the same business logic to run in both frontend (Tauri) and agent (Node.js) environments.

> **Architecture Note - Adapter Pattern**:
>
> ```
> ┌─────────────────────────────────────────────────────────────┐
> │                     SkillsService                           │
> │  (ONE class with ALL business logic)                        │
> │  - Discovery (scanning directories, priority ordering)      │
> │  - Parsing (frontmatter, slug normalization)                │
> │  - Caching (in-memory skill metadata)                       │
> │  - Lookup (getBySlug, search, readContent)                  │
> │                                                             │
> │  constructor(fs: FilesystemAdapter)                         │
> └───────────────────────────┬─────────────────────────────────┘
>                             │ depends on (injected)
>                             ▼
> ┌─────────────────────────────────────────────────────────────┐
> │                   FilesystemAdapter                         │
> │  (interface - low-level FS ops ONLY)                        │
> │  - readFile(path) → string | null                           │
> │  - exists(path) → boolean                                   │
> │  - listDir(path) → DirEntry[]                               │
> │  - joinPath(...segments) → string                           │
> └───────────────────────────┬─────────────────────────────────┘
>                             │
>             ┌───────────────┴───────────────┐
>             ▼                               ▼
> ┌───────────────────────┐       ┌───────────────────────┐
> │ NodeFilesystemAdapter │       │TauriFilesystemAdapter │
> │ (uses Node fs module) │       │(uses FilesystemClient)│
> └───────────────────────┘       └───────────────────────┘
> ```
>
> **Key principle**: Business logic is written ONCE in `SkillsService`. The adapters
> only provide filesystem transport - they have NO discovery logic, NO parsing logic.

## Phases

- [x] Implement frontmatter parser
- [x] Create skill location configuration
- [x] Implement discovery logic
- [x] Add content reading
- [x] Export service from entity

---

## Dependencies

- **01-types-foundation** - Needs all types and shared utilities (`parseFrontmatter`, `SOURCE_PRIORITY`)
- **02-skills-store** - Needs `useSkillsStore` (for frontend instance only)

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `core/lib/skills/skills-service.ts` | **CREATE** - The single SkillsService class |
| `core/services/fs-adapter.ts` | **MODIFY** - Add `listDirWithMetadata()` method to interface |
| `core/adapters/node/fs-adapter.ts` | **MODIFY** - Add Node implementation of `listDirWithMetadata()` |
| `src/adapters/tauri-fs-adapter.ts` | **MODIFY** - Add Tauri implementation using `FilesystemClient.listDir()` |
| `src/lib/skills-service-instance.ts` | **CREATE** - Frontend instance (TauriFSAdapter) |
| `agents/src/lib/skills-service-instance.ts` | **CREATE** - Agent instance (NodeFSAdapter) |
| `src/entities/skills/index.ts` | **MODIFY** - Re-export frontend instance |

> **Note**: We already have `FSAdapter` interface with Node and Tauri implementations. We just need to add one method: `listDirWithMetadata()` that returns `{ name, path, isDirectory, isFile }[]`. The Tauri adapter can delegate to `FilesystemClient.listDir()` which already has this.

---

## Implementation

### 1. Extend FSAdapter Interface

Update `core/services/fs-adapter.ts`:

```typescript
/**
 * Directory entry with metadata.
 */
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
}

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

  // NEW: List directory with metadata (for skill discovery)
  listDirWithMetadata(path: string): Promise<DirEntry[]>;

  // NEW: Join path segments
  joinPath(...segments: string[]): string;
}
```

### 2. Add to Node Adapter

Update `core/adapters/node/fs-adapter.ts`:

```typescript
import * as path from 'path';

// Add to NodeFileSystemAdapter class:
listDirWithMetadata(dirPath: string): DirEntry[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  return entries.map(e => ({
    name: e.name,
    path: path.join(dirPath, e.name),
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
  }));
}

joinPath(...segments: string[]): string {
  return path.join(...segments);
}
```

### 3. Add to Tauri Adapter

Update `src/adapters/tauri-fs-adapter.ts`:

```typescript
import { FilesystemClient } from '@/lib/filesystem-client';

// Add to TauriFSAdapter class:
private fsClient = new FilesystemClient();

async listDirWithMetadata(path: string): Promise<DirEntry[]> {
  // FilesystemClient.listDir already returns the correct format
  return this.fsClient.listDir(path);
}

joinPath(...segments: string[]): string {
  return this.fsClient.joinPath(...segments);
}
```

### 4. SkillsService (Single Implementation)

Create `core/lib/skills/skills-service.ts`:

```typescript
import type { FSAdapter, DirEntry } from '@core/services/fs-adapter';
import type { SkillMetadata, SkillSource, SkillContent, SkillFrontmatter } from '@core/types/skills';
import { parseFrontmatter, SOURCE_PRIORITY } from '@core/skills';

interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

const SKILL_LOCATIONS: SkillLocation[] = [
  { getPath: (repo) => `${repo}/.claude/skills`, source: 'project', isLegacy: false },
  { getPath: (repo) => `${repo}/.claude/commands`, source: 'project_command', isLegacy: true },
  { getPath: (_, home) => `${home}/.anvil/skills`, source: 'anvil', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/skills`, source: 'personal', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/commands`, source: 'personal_command', isLegacy: true },
];

/**
 * SkillsService - single implementation with injected filesystem adapter.
 *
 * Usage:
 *   // In frontend (Tauri)
 *   const service = new SkillsService(tauriFsAdapter);
 *
 *   // In agent (Node.js)
 *   const service = new SkillsService(nodeFsAdapter);
 */
export class SkillsService {
  private skills: Map<string, SkillMetadata> = new Map();
  private slugIndex: Map<string, string> = new Map();
  private lastDiscoveryPath: string | null = null;

  constructor(private fs: FSAdapter) {}

  /**
   * Discover all skills from configured locations.
   */
  async discover(repoPath: string, homeDir: string): Promise<SkillMetadata[]> {
    this.skills.clear();
    this.slugIndex.clear();
    this.lastDiscoveryPath = repoPath;

    for (const location of SKILL_LOCATIONS) {
      const dirPath = location.getPath(repoPath, homeDir);

      if (!await this.fs.exists(dirPath)) {
        continue;
      }

      try {
        const entries = await this.fs.listDirWithMetadata(dirPath);

        for (const entry of entries) {
          let skillPath: string;
          let slug: string;

          if (location.isLegacy) {
            if (!entry.isFile || !entry.name.endsWith('.md')) continue;
            skillPath = entry.path;
            slug = entry.name.replace(/\.md$/, '').toLowerCase();
          } else {
            if (!entry.isDirectory) continue;
            skillPath = this.fs.joinPath(entry.path, 'SKILL.md');
            if (!await this.fs.exists(skillPath)) continue;
            slug = entry.name.toLowerCase();
          }

          if (this.slugIndex.has(slug)) continue;

          try {
            const content = await this.fs.readFile(skillPath);
            const { frontmatter } = parseFrontmatter(content);

            if (frontmatter['user-invocable'] === false) continue;

            const id = crypto.randomUUID();
            this.slugIndex.set(slug, id);

            this.skills.set(id, {
              id,
              slug,
              name: frontmatter.name || slug,
              description: frontmatter.description || '',
              source: location.source,
              path: skillPath,
              isLegacyCommand: location.isLegacy,
              userInvocable: frontmatter['user-invocable'] !== false,
              disableModelInvocation: frontmatter['disable-model-invocation'] === true,
            });
          } catch {
            // Skip malformed skills
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    }

    return this.getAll();
  }

  getById(id: string): SkillMetadata | undefined {
    return this.skills.get(id);
  }

  getBySlug(slug: string): SkillMetadata | undefined {
    const id = this.slugIndex.get(slug.toLowerCase());
    return id ? this.skills.get(id) : undefined;
  }

  getAll(): SkillMetadata[] {
    const order: Record<SkillSource, number> = {
      project: 0, project_command: 1, anvil: 2, personal: 3, personal_command: 4,
    };
    return Array.from(this.skills.values())
      .filter(s => s.userInvocable)
      .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  }

  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return this.getAll().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  }

  async readContent(slug: string): Promise<SkillContent | null> {
    const skill = this.getBySlug(slug);
    if (!skill) return null;

    try {
      const raw = await this.fs.readFile(skill.path);
      const { body } = parseFrontmatter(raw);
      return { content: body, source: skill.source };
    } catch {
      return null;
    }
  }

  needsRediscovery(repoPath: string): boolean {
    return this.lastDiscoveryPath !== repoPath;
  }
}
```

### 5. Create Service Instances

**Frontend instance** (`src/lib/skills-service-instance.ts`):

```typescript
import { SkillsService } from '@core/lib/skills/skills-service';
import { TauriFSAdapter } from '@/adapters/tauri-fs-adapter';

export const skillsService = new SkillsService(new TauriFSAdapter());
```

**Agent instance** (`agents/src/lib/skills-service-instance.ts`):

```typescript
import { SkillsService } from '@core/lib/skills/skills-service';
import { NodeFileSystemAdapter } from '@core/adapters/node/fs-adapter';
import { AsyncFSAdapterWrapper } from '@core/adapters/async-wrapper';

// Wrap sync Node adapter in async wrapper for FSAdapter compatibility
const nodeFs = new AsyncFSAdapterWrapper(new NodeFileSystemAdapter());
export const skillsService = new SkillsService(nodeFs);
```

### 6. Update Entity Index

Add to `src/entities/skills/index.ts`:

```typescript
export { skillsService } from '@/lib/skills-service-instance';
```

---

## Acceptance Criteria

- [x] `skillsService.discover()` scans all 5 locations
- [x] Priority ordering works (project skills shadow personal with same slug)
- [x] Slugs normalized to lowercase
- [x] Frontmatter parsed correctly
- [x] Non-user-invocable skills excluded
- [x] `readContent()` returns skill body with frontmatter stripped
- [x] `needsRediscovery()` detects repo changes
- [x] Malformed skills logged but don't crash discovery

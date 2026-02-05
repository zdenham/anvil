# 01: Types Foundation

## Overview

Define all TypeScript types for the skills system. This includes both the frontend entity types AND the adapter interfaces used by agents. Combining these allows maximum parallelization downstream.

## Phases

- [ ] Create skills entity types
- [ ] Create adapter interface types
- [ ] Export from appropriate indexes

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/entities/skills/types.ts` | **CREATE** |
| `core/adapters/types.ts` | **MODIFY** - Add SkillsAdapter |

---

## Implementation

### 1. Skills Entity Types

Create `src/entities/skills/types.ts`:

```typescript
export interface SkillMetadata {
  id: string;                    // Stable UUID
  name: string;                  // Display name (from frontmatter or directory name)
  slug: string;                  // Directory/file name for lookups (lowercase)
  description: string;
  source: SkillSource;
  path: string;                  // Full path to SKILL.md or command.md
  isLegacyCommand: boolean;
  userInvocable: boolean;        // From frontmatter, default true
  disableModelInvocation: boolean; // From frontmatter, default false
}

export type SkillSource =
  | 'project'           // <repo>/.claude/skills/
  | 'project_command'   // <repo>/.claude/commands/
  | 'mort'              // ~/.mort/skills/
  | 'personal'          // ~/.claude/skills/
  | 'personal_command'; // ~/.claude/commands/

export interface SkillContent {
  content: string;      // Markdown content (frontmatter stripped)
  source: SkillSource;
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  'user-invocable'?: boolean;
  'disable-model-invocation'?: boolean;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  model?: string;
  context?: 'fork';
  agent?: string;
}
```

### 2. Adapter Interface

Add to `core/adapters/types.ts`:

```typescript
import type { SkillMetadata } from '@/entities/skills/types';

export interface SkillsAdapter {
  /**
   * Discover all skills from configured locations.
   * @param repoPath - The repository path for project-level skills
   * @param homeDir - The user's home directory for personal skills
   */
  discover(repoPath: string, homeDir: string): Promise<SkillMetadata[]>;

  /**
   * Read full content of a skill by its path.
   * @param skillPath - Absolute path to SKILL.md or command.md
   */
  readContent(skillPath: string): Promise<string | null>;

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * List directory contents.
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;

  /**
   * Join path segments.
   */
  joinPath(...segments: string[]): string;
}
```

---

## Acceptance Criteria

- [ ] `SkillMetadata`, `SkillSource`, `SkillContent`, `SkillFrontmatter` types exist
- [ ] `SkillsAdapter` interface exists in core/adapters
- [ ] Types compile without errors
- [ ] No circular dependencies

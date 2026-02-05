# 03: Skills Service

## Overview

Create the skills discovery service that scans all skill/command locations and hydrates the store. Uses the FilesystemClient adapter for Tauri compatibility.

> **Architecture Note**: This service is a high-level frontend service that:
> - Uses `FilesystemClient` (Tauri-compatible adapter) for filesystem operations
> - Hydrates the Zustand store with discovered skills
> - Provides convenience methods (`getBySlug`, `search`, etc.) that read from the store
>
> It does NOT implement the `SkillsAdapter` interface directly. The `SkillsAdapter` interface
> (defined in plan 01) is for lower-level filesystem adapters. The service's `discover()` method
> signature differs from the interface because it retrieves `homeDir` from `FilesystemClient.getPathsInfo()`
> internally (Tauri provides this via IPC).

## Phases

- [ ] Implement frontmatter parser
- [ ] Create skill location configuration
- [ ] Implement discovery logic
- [ ] Add content reading
- [ ] Export service from entity

---

## Dependencies

- **01-types-foundation** - Needs all types and shared utilities (`parseFrontmatter`, `SOURCE_PRIORITY`)
- **02-skills-store** - Needs `useSkillsStore`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/entities/skills/service.ts` | **CREATE** |
| `src/entities/skills/index.ts` | **MODIFY** - Add service export |

---

## Implementation

### Skills Service

Create `src/entities/skills/service.ts`:

```typescript
import { useSkillsStore } from './store';
import type { SkillMetadata, SkillSource, SkillContent } from './types';
import { parseFrontmatter, SOURCE_PRIORITY } from '@core/skills';
import { FilesystemClient } from '@/lib/filesystem-client';
import { logger } from '@/lib/logger-client';

const fs = new FilesystemClient();

// Skill directory configurations
// NOTE: Order matches SOURCE_PRIORITY from @core/skills/constants
interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

const SKILL_LOCATIONS: SkillLocation[] = [
  // Priority order matches SOURCE_PRIORITY: project > project_command > mort > personal > personal_command
  {
    getPath: (repo) => `${repo}/.claude/skills`,
    source: 'project',
    isLegacy: false,
  },
  {
    getPath: (repo) => `${repo}/.claude/commands`,
    source: 'project_command',
    isLegacy: true,
  },
  {
    getPath: (_, home) => `${home}/.mort/skills`,
    source: 'mort',
    isLegacy: false,
  },
  {
    getPath: (_, home) => `${home}/.claude/skills`,
    source: 'personal',
    isLegacy: false,
  },
  {
    getPath: (_, home) => `${home}/.claude/commands`,
    source: 'personal_command',
    isLegacy: true,
  },
];

// Verify SKILL_LOCATIONS order matches SOURCE_PRIORITY at module load time
if (process.env.NODE_ENV !== 'production') {
  const locationSources = SKILL_LOCATIONS.map(l => l.source);
  const mismatch = locationSources.some((s, i) => s !== SOURCE_PRIORITY[i]);
  if (mismatch) {
    console.warn('[skills-service] SKILL_LOCATIONS order does not match SOURCE_PRIORITY');
  }
}

export const skillsService = {
  /**
   * Discover and hydrate skills from all locations.
   */
  async discover(repoPath: string): Promise<void> {
    logger.log('[skillsService:discover] Starting skill discovery...');

    const pathsInfo = await fs.getPathsInfo();
    const homeDir = pathsInfo.home_dir;

    const skills: Record<string, SkillMetadata> = {};
    const slugToId: Record<string, string> = {};

    for (const location of SKILL_LOCATIONS) {
      const dirPath = location.getPath(repoPath, homeDir);

      if (!await fs.exists(dirPath)) {
        continue;
      }

      try {
        const entries = await fs.listDir(dirPath);

        for (const entry of entries) {
          let skillPath: string;
          let slug: string;

          if (location.isLegacy) {
            // Legacy: single .md files
            if (!entry.isFile || !entry.name.endsWith('.md')) continue;
            skillPath = entry.path;
            slug = entry.name.replace(/\.md$/, '').toLowerCase();
          } else {
            // Modern: directories with SKILL.md
            if (!entry.isDirectory) continue;
            skillPath = await fs.joinPath(entry.path, 'SKILL.md');
            if (!await fs.exists(skillPath)) continue;
            slug = entry.name.toLowerCase();
          }

          // Skip if we already have this slug from a higher-priority source
          if (slugToId[slug]) continue;

          try {
            const content = await fs.readFile(skillPath);
            const { frontmatter } = parseFrontmatter(content);

            // Skip non-user-invocable skills
            if (frontmatter['user-invocable'] === false) continue;

            const id = crypto.randomUUID();
            slugToId[slug] = id;

            skills[id] = {
              id,
              slug,
              name: frontmatter.name || slug,
              description: frontmatter.description || '',
              source: location.source,
              path: skillPath,
              isLegacyCommand: location.isLegacy,
              userInvocable: frontmatter['user-invocable'] !== false,
              disableModelInvocation: frontmatter['disable-model-invocation'] === true,
            };
          } catch (err) {
            logger.warn(`[skillsService:discover] Failed to parse ${skillPath}:`, err);
          }
        }
      } catch (err) {
        logger.warn(`[skillsService:discover] Failed to read ${dirPath}:`, err);
      }
    }

    logger.log(`[skillsService:discover] Found ${Object.keys(skills).length} skills`);
    useSkillsStore.getState().hydrate(skills, repoPath);
  },

  /**
   * Get skill by slug.
   */
  getBySlug(slug: string): SkillMetadata | undefined {
    return useSkillsStore.getState().getBySlug(slug);
  },

  /**
   * Get all skills (filtered for user-invocable).
   */
  getAll(): SkillMetadata[] {
    return useSkillsStore.getState().getAll();
  },

  /**
   * Search skills by query.
   */
  search(query: string): SkillMetadata[] {
    return useSkillsStore.getState().search(query);
  },

  /**
   * Read full skill content by slug.
   */
  async readContent(slug: string): Promise<SkillContent | null> {
    const skill = this.getBySlug(slug);
    if (!skill) return null;

    try {
      const content = await fs.readFile(skill.path);
      const { body } = parseFrontmatter(content);

      return {
        content: body,
        source: skill.source,
      };
    } catch {
      return null;
    }
  },

  /**
   * Check if discovery is needed (repo changed).
   */
  needsRediscovery(repoPath: string): boolean {
    const state = useSkillsStore.getState();
    return !state._hydrated || state._lastDiscoveryPath !== repoPath;
  },
};
```

### Update Entity Index

Add to `src/entities/skills/index.ts`:

```typescript
export { skillsService } from './service';
```

---

## Acceptance Criteria

- [ ] `skillsService.discover()` scans all 5 locations
- [ ] Priority ordering works (project skills shadow personal with same slug)
- [ ] Slugs normalized to lowercase
- [ ] Frontmatter parsed correctly
- [ ] Non-user-invocable skills excluded
- [ ] `readContent()` returns skill body with frontmatter stripped
- [ ] `needsRediscovery()` detects repo changes
- [ ] Malformed skills logged but don't crash discovery

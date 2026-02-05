# 03: Skills Service

## Overview

Create the skills discovery service that scans all skill/command locations and hydrates the store. Uses the FilesystemClient adapter for Tauri compatibility.

## Phases

- [ ] Implement frontmatter parser
- [ ] Create skill location configuration
- [ ] Implement discovery logic
- [ ] Add content reading
- [ ] Export service from entity

---

## Dependencies

- **01-types-foundation** - Needs all types
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
import type { SkillMetadata, SkillSource, SkillContent, SkillFrontmatter } from './types';
import { FilesystemClient } from '@/lib/filesystem-client';
import { logger } from '@/lib/logger-client';

const fs = new FilesystemClient();

// Skill directory configurations
interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

const SKILL_LOCATIONS: SkillLocation[] = [
  // Priority order: project > mort > personal
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

/**
 * Parse YAML frontmatter from skill content.
 * Simple parser - handles key: value pairs only.
 */
function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  if (!content.startsWith('---')) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = content.indexOf('---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const yamlContent = content.slice(3, endIndex).trim();
  const body = content.slice(endIndex + 3).trim();

  const frontmatter: SkillFrontmatter = {};
  for (const line of yamlContent.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      const cleanKey = key.trim();
      const cleanValue = value.trim().replace(/^["']|["']$/g, '');

      switch (cleanKey) {
        case 'name':
          frontmatter.name = cleanValue;
          break;
        case 'description':
          frontmatter.description = cleanValue;
          break;
        case 'user-invocable':
          frontmatter['user-invocable'] = cleanValue !== 'false';
          break;
        case 'disable-model-invocation':
          frontmatter['disable-model-invocation'] = cleanValue === 'true';
          break;
        case 'argument-hint':
          frontmatter['argument-hint'] = cleanValue;
          break;
        case 'allowed-tools':
          frontmatter['allowed-tools'] = cleanValue;
          break;
        case 'model':
          frontmatter.model = cleanValue;
          break;
        case 'context':
          if (cleanValue === 'fork') frontmatter.context = 'fork';
          break;
        case 'agent':
          frontmatter.agent = cleanValue;
          break;
      }
    }
  }

  return { frontmatter, body };
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

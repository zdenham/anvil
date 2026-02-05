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
| `core/types/skills.ts` | **CREATE** - Canonical type definitions |
| `src/entities/skills/types.ts` | **CREATE** - Re-exports from @core/types/skills |
| `core/adapters/types.ts` | **MODIFY** - Add SkillsAdapter |

> **Architecture Note**: Types are defined canonically in `core/types/skills.ts` to ensure proper dependency direction. The `core` package has no dependencies on other packages, while `agents` and `src` can import from `core`. The frontend re-exports from `src/entities/skills/types.ts` for convenience.

---

## Implementation

### 1. Canonical Skills Types (Core)

Create `core/types/skills.ts`:

```typescript
/**
 * Canonical type definitions for the skills system.
 * These types are the single source of truth and should be imported
 * by all other packages via @core/types/skills.
 */

export type SkillSource =
  | 'project'           // <repo>/.claude/skills/
  | 'project_command'   // <repo>/.claude/commands/
  | 'mort'              // ~/.mort/skills/
  | 'personal'          // ~/.claude/skills/
  | 'personal_command'; // ~/.claude/commands/

/**
 * Full skill metadata - used by frontend for display and management.
 */
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

/**
 * Minimal skill reference - used by agent for skill lookup.
 * This is a subset of SkillMetadata containing only fields needed for injection.
 */
export interface SkillReference {
  slug: string;                  // Directory/file name for lookups (lowercase)
  path: string;                  // Full path to SKILL.md or command.md
  source: SkillSource;
}

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

/**
 * Result of parsing skill matches from a message.
 */
export interface SkillMatch {
  skillSlug: string;
  args: string;
  fullMatch: string;
}

/**
 * Result of processing a message for skill injection.
 */
export interface SkillInjection {
  displayMessage: string;           // Original message (stored in thread, shown in UI)
  userMessage: string;              // What goes in user message (same as display)
  systemPromptAppend: string | null; // What gets appended to system prompt
  skills: Array<{ slug: string; source: SkillSource }>;
}
```

### 2. Frontend Re-exports

Create `src/entities/skills/types.ts`:

```typescript
/**
 * Re-export canonical types from core for frontend use.
 * This maintains proper dependency direction: src -> core
 */
export type {
  SkillSource,
  SkillMetadata,
  SkillReference,
  SkillContent,
  SkillFrontmatter,
  SkillMatch,
  SkillInjection,
} from '@core/types/skills';
```

### 3. Adapter Interface

Add to `core/adapters/types.ts`:

```typescript
import type { SkillMetadata, SkillReference } from '@core/types/skills';

/**
 * Skills adapter interface for filesystem operations.
 *
 * Implementations may implement one or both of the discovery methods depending on use case:
 * - Frontend service (03): Uses `discover()` for full discovery and store hydration
 * - Agent runner (07): Uses `findBySlug()` for single skill lookup during injection
 *
 * All methods are async for consistency, even if the underlying implementation
 * uses synchronous operations (e.g., Node.js fs).
 */
export interface SkillsAdapter {
  /**
   * Discover all skills from configured locations.
   * Used by the frontend service to hydrate the skills store.
   * @param repoPath - The repository path for project-level skills
   * @param homeDir - The user's home directory for personal skills
   * @returns All discovered skills (respects priority ordering)
   */
  discover(repoPath: string, homeDir: string): Promise<SkillMetadata[]>;

  /**
   * Find a single skill by its slug across all locations.
   * Used by the agent runner for skill injection.
   * Returns the first match respecting priority order (project > mort > personal).
   * @param slug - The skill slug (case-insensitive)
   * @param repoPath - The repository path for project-level skills
   * @param homeDir - The user's home directory for personal skills
   * @returns The skill reference if found, null otherwise
   */
  findBySlug(slug: string, repoPath: string, homeDir: string): Promise<SkillReference | null>;

  /**
   * Read full content of a skill by its path.
   * @param skillPath - Absolute path to SKILL.md or command.md
   * @returns The raw file content, or null if not found
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

## Shared Utilities

These utilities should be defined once in `core/skills/` and imported by both frontend and agent code. This prevents duplication and ensures consistent behavior across the codebase.

### File: `core/skills/constants.ts`

```typescript
import type { SkillSource } from '@core/types/skills';

/**
 * Source priority order for skill resolution.
 * Lower index = higher priority. When multiple skills have the same slug,
 * the one from the higher priority source wins (project shadows personal).
 */
export const SOURCE_PRIORITY: readonly SkillSource[] = [
  'project',           // 0 - highest priority
  'project_command',   // 1
  'mort',              // 2
  'personal',          // 3
  'personal_command',  // 4 - lowest priority
] as const;

/**
 * Icons for each skill source.
 * Uses Lucide icon names for consistency across UI components.
 * @see https://lucide.dev/icons
 */
export const SOURCE_ICONS: Record<SkillSource, string> = {
  project: 'folder',           // Project-level skills
  project_command: 'folder-code', // Legacy project commands
  mort: 'sparkles',            // Mort-specific skills
  personal: 'user',            // User's personal skills
  personal_command: 'terminal', // Legacy personal commands
};

/**
 * Display labels for skill sources.
 * Used in dropdowns, badges, and tooltips.
 */
export const SOURCE_LABELS: Record<SkillSource, string> = {
  project: 'Project',
  project_command: 'Project',
  mort: 'Mort',
  personal: 'Personal',
  personal_command: 'Personal',
};

/**
 * Badge styling for each source in settings UI.
 * Uses Tailwind classes for consistent theming.
 */
export const SOURCE_BADGE_STYLES: Record<SkillSource, { label: string; className: string }> = {
  project: { label: 'Project', className: 'bg-blue-500/10 text-blue-600' },
  project_command: { label: 'Project', className: 'bg-blue-500/10 text-blue-600' },
  mort: { label: 'Mort', className: 'bg-purple-500/10 text-purple-600' },
  personal: { label: 'Personal', className: 'bg-green-500/10 text-green-600' },
  personal_command: { label: 'Personal', className: 'bg-green-500/10 text-green-600' },
};
```

### File: `core/skills/patterns.ts`

```typescript
/**
 * Regex pattern for matching skill invocations in messages.
 *
 * Matches: /skill-name or /skill-name args
 * - Only at word boundary (start of string or after whitespace)
 * - Skill names: lowercase letters, numbers, underscores, hyphens
 * - Args: everything after the skill name until newline
 *
 * Capture groups:
 * - [1] skill slug (e.g., "commit", "review-pr")
 * - [2] args (optional, e.g., "fix authentication bug")
 *
 * LIMITATIONS:
 * - Uses lookbehind (?<=\s) which requires ES2018+
 * - Browser support: Chrome 62+, Firefox 78+, Safari 16.4+
 * - Node.js support: v8.10+
 * - Does NOT handle URLs (http://...) - caller must filter
 * - Does NOT handle escape sequences (// for literal /) - handled by trigger system
 *
 * @example
 * "/commit fix bug" => ["commit", "fix bug"]
 * "hello /review-pr 123" => ["review-pr", "123"]
 * "/deploy" => ["deploy", ""]
 */
export const SKILL_PATTERN = /(?:^|(?<=\s))\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;

/**
 * Non-lookbehind version for environments that don't support it.
 * Requires manual filtering of matches at non-word-boundary positions.
 * Capture groups shift: [1] = preceding whitespace, [2] = slug, [3] = args
 */
export const SKILL_PATTERN_COMPAT = /(^|\s)\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;
```

### File: `core/skills/parse-frontmatter.ts`

```typescript
import type { SkillFrontmatter } from '@core/types/skills';

export interface ParsedFrontmatter {
  frontmatter: SkillFrontmatter;
  body: string;
}

/**
 * Parse YAML frontmatter from skill content.
 *
 * Supports standard YAML frontmatter delimited by `---`:
 * ```
 * ---
 * name: My Skill
 * description: Does something useful
 * ---
 * # Skill content here
 * ```
 *
 * This is a simple parser that handles key: value pairs only.
 * It does NOT support:
 * - Nested objects
 * - Arrays (except inline in allowed-tools)
 * - Multi-line strings
 * - YAML anchors/aliases
 *
 * @param content - Raw skill file content
 * @returns Parsed frontmatter and body content
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
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

/**
 * Extract only the body content, stripping frontmatter.
 * Use when you don't need the frontmatter data.
 *
 * @param content - Raw skill file content
 * @returns Body content with frontmatter removed
 */
export function stripFrontmatter(content: string): string {
  return parseFrontmatter(content).body;
}
```

### File: `core/skills/extract-matches.ts`

```typescript
import { SKILL_PATTERN } from './patterns';
import type { SkillMatch } from '@core/types/skills';

/**
 * Extract all skill invocations from a message.
 *
 * @param message - User message text
 * @returns Array of skill matches with slugs, args, and full match text
 *
 * @example
 * extractSkillMatches("/commit fix bug")
 * // => [{ skillSlug: "commit", args: "fix bug", fullMatch: "/commit fix bug" }]
 *
 * extractSkillMatches("Please /review-pr 123 and /deploy")
 * // => [
 * //   { skillSlug: "review-pr", args: "123", fullMatch: "/review-pr 123" },
 * //   { skillSlug: "deploy", args: "", fullMatch: "/deploy" }
 * // ]
 */
export function extractSkillMatches(message: string): SkillMatch[] {
  const matches: SkillMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state (important for global regex)
  SKILL_PATTERN.lastIndex = 0;

  while ((match = SKILL_PATTERN.exec(message)) !== null) {
    matches.push({
      skillSlug: match[1].toLowerCase(),
      args: (match[2] || '').trim(),
      fullMatch: match[0],
    });
  }

  return matches;
}
```

### File: `core/skills/index.ts`

```typescript
// Re-export types from canonical location
export type {
  SkillFrontmatter,
  SkillSource,
  SkillMetadata,
  SkillReference,
  SkillContent,
  SkillMatch,
  SkillInjection,
} from '@core/types/skills';

// Constants
export {
  SOURCE_PRIORITY,
  SOURCE_ICONS,
  SOURCE_LABELS,
  SOURCE_BADGE_STYLES,
} from './constants';

// Patterns
export { SKILL_PATTERN, SKILL_PATTERN_COMPAT } from './patterns';

// Utilities
export { parseFrontmatter, stripFrontmatter } from './parse-frontmatter';
export type { ParsedFrontmatter } from './parse-frontmatter';
export { extractSkillMatches } from './extract-matches';
```

---

## Acceptance Criteria

- [ ] Canonical types defined in `core/types/skills.ts`: `SkillMetadata`, `SkillReference`, `SkillSource`, `SkillContent`, `SkillFrontmatter`, `SkillMatch`, `SkillInjection`
- [ ] `src/entities/skills/types.ts` re-exports from `@core/types/skills`
- [ ] `SkillsAdapter` interface exists in core/adapters
- [ ] Shared utilities exist in `core/skills/`
- [ ] `SKILL_PATTERN` regex documented with limitations
- [ ] `SOURCE_PRIORITY`, `SOURCE_ICONS`, `SOURCE_LABELS` constants defined
- [ ] `parseFrontmatter()` is the single source of truth
- [ ] Types compile without errors
- [ ] No circular dependencies
- [ ] Dependency direction is correct: `agents` -> `core`, `src` -> `core`

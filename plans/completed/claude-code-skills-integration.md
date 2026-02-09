# Claude Code Skills & Commands Integration for Mort

## Overview

This document outlines how to integrate **both Claude Code skills AND legacy commands** into mort, enabling users to define custom capabilities that extend agent functionality.

**Important**: Mort will support BOTH formats:
- **Skills** (modern) - Directory-based with `SKILL.md` and bundled files
- **Commands** (legacy) - Single `.md` files, simpler but less powerful

## Design Decision: System Prompt Injection (Not SDK-Native)

Rather than using the SDK's `settingSources` approach (which injects skill metadata into the system prompt for all conversations), Mort uses a **system prompt append** strategy:

1. **Custom Discovery** - TypeScript service scans skill directories (including `~/.mort/skills/`)
2. **Discovery Timing** - Skills are discovered at app startup, then refreshed when user types `/`
3. **On-Demand Injection** - Skill content is appended to the system prompt only when explicitly invoked with `/skill-name`
4. **Display Message Preserved** - The original `/skill-name args` message is stored and displayed in UI
5. **Agent Awareness** - The system prompt explicitly instructs the agent to follow the injected skill

**Why this approach?**

| Aspect | SDK-Native (`settingSources`) | System Prompt Append |
|--------|------------------------------|----------------------|
| Token cost | Metadata always in system prompt | Zero cost when skills unused |
| Auto-invocation | Claude can auto-invoke skills | Explicit `/` invocation only |
| Custom paths | Limited to SDK's paths | Full control (`~/.mort/skills/`) |
| Thread persistence | N/A | Display message stored, skill injected per-run only |
| Complexity | Simple (1-line config) | More implementation work |

Since Mort users explicitly invoke skills via `/` and we need custom paths, system prompt append is the better fit.

## Skill & Command Sources Summary

**Mort will discover and load from ALL of the following locations:**

### Skills (Modern Format)
| Priority | Location | Path | Description |
|----------|----------|------|-------------|
| 1 | Repo-level Skills | `<repo>/.claude/skills/<name>/SKILL.md` | Project-specific, shared with team |
| 2 | Mort Personal Skills | `~/.mort/skills/<name>/SKILL.md` | **Mort-specific** personal skills |
| 3 | Claude Personal Skills | `~/.claude/skills/<name>/SKILL.md` | Standard Claude Code personal skills |

### Commands (Legacy Format)
| Priority | Location | Path | Description |
|----------|----------|------|-------------|
| 4 | Repo-level Commands | `<repo>/.claude/commands/<name>.md` | Project-specific legacy commands |
| 5 | Personal Commands | `~/.claude/commands/<name>.md` | Personal legacy commands |

This means users can:
- Use standard Claude Code skills they've already created
- Use existing legacy commands without migration
- Create mort-specific skills in `~/.mort/skills/` for workflows unique to mort
- Share project skills/commands via the repo's `.claude/` directory

---

## What Are Claude Code Skills?

Skills are modular, filesystem-based resources that extend Claude's capabilities. They follow the [Agent Skills open standard](https://agentskills.io) and package instructions, scripts, templates, and reference materials into organized directories.

**Key characteristics:**
- **Model-invoked**: Claude automatically uses them based on context
- **User-invoked**: Users can explicitly trigger them with `/skill-name`
- **Progressive disclosure**: Only metadata loads at startup; full content loads when triggered
- **Support bundled files**: Can include scripts, templates, examples, and reference documentation

### Skills vs Commands (Legacy) - Both Supported!

| Feature | Skills (Modern) | Commands (Legacy) |
|---------|-----------------|-------------------|
| Location | `.claude/skills/<name>/SKILL.md` | `.claude/commands/<name>.md` |
| Structure | Directory with multiple files | Single `.md` file |
| Bundled files | Yes (scripts, templates, examples) | No |
| Model invocation | Configurable via frontmatter | Always available |
| Format | YAML frontmatter + Markdown | YAML frontmatter + Markdown |
| Invocation | `/skill-name` | `/command-name` |

**Both formats create slash commands** (e.g., `/review`). Skills are the modern, recommended approach, but **mort will fully support both** to ensure backwards compatibility and ease of migration.

#### Command Format Example

```markdown
# ~/.claude/commands/test.md
---
description: Run the test suite
---
Run all tests using the project's test runner. Report any failures.
```

#### Skill Format Example

```markdown
# ~/.claude/skills/review/SKILL.md
---
description: Review code changes
argument_hint: "[file or PR number]"
---
Review the specified code for issues, best practices, and potential bugs.
```

---

## Directory Configuration

### Standard Claude Code Skill Locations (Priority Order)

| Priority | Location | Path | Scope |
|----------|----------|------|-------|
| 1 | Enterprise | Managed settings | Organization-wide |
| 2 | Personal | `~/.claude/skills/<skill-name>/SKILL.md` | All user projects |
| 3 | Project | `.claude/skills/<skill-name>/SKILL.md` | Single project |
| 4 | Plugin | `<plugin>/skills/<skill-name>/SKILL.md` | Where plugin enabled |

### Mort-Specific Skill Locations

In addition to the standard Claude Code locations, **mort will also support its own skills directory**:

| Priority | Location | Path | Scope |
|----------|----------|------|-------|
| 1 | Mort Personal | `~/.mort/skills/<skill-name>/SKILL.md` | All mort projects |
| 2 | Repo | `<repo>/.claude/skills/<skill-name>/SKILL.md` | Single repository |

**Why both?**
- `~/.claude/skills/` - Standard Claude Code skills that work across all Claude tools
- `~/.mort/skills/` - Mort-specific skills (e.g., UI automation, mort-specific workflows)

### Command Locations

| Location | Path | Scope |
|----------|------|-------|
| Personal | `~/.claude/commands/` | All user projects |
| Project | `.claude/commands/` | Single project |

---

## SKILL.md Format

Every skill requires a `SKILL.md` file with YAML frontmatter + Markdown content:

```yaml
---
name: my-skill-name
description: A clear description of what this skill does and when to use it
argument-hint: [optional-argument-hint]
disable-model-invocation: false  # Set true to prevent auto-invocation
user-invocable: true             # Set false to hide from / menu
allowed-tools: Read, Grep, Glob  # Tools Claude can use without permission
model: claude-sonnet-4-20250514  # Optional model override
---

# My Skill Name

Instructions for Claude to follow when this skill is invoked.

## Additional Resources

- For API details, see [reference.md](reference.md)
- For examples, see [examples/](examples/)
```

### Frontmatter Fields Reference

| Field | Required | Description |
|-------|----------|-------------|
| `name` | No | Display name (defaults to directory name). Lowercase, hyphens, max 64 chars. |
| `description` | Recommended | What the skill does and when to use it. Max 1024 chars. Used for discovery. |
| `argument-hint` | No | Hint shown during autocomplete, e.g., `[issue-number]` |
| `disable-model-invocation` | No | `true` = user must invoke manually with `/name`. Default: `false` |
| `user-invocable` | No | `false` = hidden from `/` menu. For background knowledge. Default: `true` |
| `allowed-tools` | No | Tools Claude can use without asking permission |
| `model` | No | Model to use when skill is active |
| `context` | No | `fork` to run in a forked subagent context |
| `agent` | No | Subagent type when `context: fork` (`Explore`, `Plan`, `general-purpose`) |

### String Substitutions

| Variable | Description |
|----------|-------------|
| `$ARGUMENTS` | Arguments passed when invoking the skill |
| `${CLAUDE_SESSION_ID}` | Current session ID |
| `` !`command` `` | Dynamic context injection - shell command output |

---

## Integration Strategy for Mort

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SKILL WORKFLOW                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

App starts
        │
        ▼
┌───────────────────────────────────┐
│ skillsService.discover()         │
│ Scans:                           │
│  • <repo>/.claude/skills/*/...   │
│  • <repo>/.claude/commands/*.md  │
│  • ~/.mort/skills/*/SKILL.md     │
│  • ~/.claude/skills/*/SKILL.md   │
│  • ~/.claude/commands/*.md       │
└───────────────┬───────────────────┘
                │ Hydrates store
                ▼
User types "/" in input
        │
        ▼
┌───────────────────────────────────┐
│ skillsService.discover() refresh │
│ (ensures fresh skill list)       │
└───────────────┬───────────────────┘
                │ Returns SkillMetadata[]
                ▼
┌───────────────────────────────────┐
│ Dropdown shows available skills  │
│ User selects "/review-pr"        │
└───────────────┬───────────────────┘
                │
                ▼
User types: "/review-pr 123 check for security issues"
                │
                ▼
┌───────────────────────────────────┐
│ Frontend detects "/review-pr"    │
│ Reads full SKILL.md content      │
│ Substitutes $ARGUMENTS           │
└───────────────┬───────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT GETS SENT TO AGENT                      │
│                                                                 │
│  SYSTEM PROMPT (appended):                                      │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ <skill-instruction>                                       │  │
│  │ The user has invoked a skill. You MUST follow the        │  │
│  │ instructions in the <skill> block below. This skill was  │  │
│  │ loaded from outside your standard skill directories and  │  │
│  │ was explicitly requested by the user.                     │  │
│  │                                                           │  │
│  │ <skill name="review-pr" source="personal">               │  │
│  │ # Review PR                                               │  │
│  │                                                           │  │
│  │ Review the pull request for code quality, bugs, and      │  │
│  │ security issues.                                          │  │
│  │                                                           │  │
│  │ ## Steps                                                  │  │
│  │ 1. Fetch PR diff with `gh pr diff 123`                   │  │
│  │ 2. Analyze each file for issues                          │  │
│  │ ...                                                       │  │
│  │ </skill>                                                  │  │
│  │ </skill-instruction>                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  USER MESSAGE (display version):                                │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ /review-pr 123 check for security issues                 │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT USER SEES IN UI                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ ┌──────────────────┐                                      │  │
│  │ │ ⚡ /review-pr    │  ← Skill chip (expandable)           │  │
│  │ └──────────────────┘                                      │  │
│  │ 123 check for security issues                             │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────┐
│ Agent receives skill in system   │
│ prompt, follows instructions     │
│ Returns response                 │
└───────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Skill Discovery (Rust Backend)

Add `discover_skills` Tauri command that scans all skill/command locations and returns metadata for the dropdown UI.

#### Phase 2: Slash Command UI

Add `/` trigger handler that shows the dropdown and allows selection. This follows the existing trigger pattern used for `@` search and spotlight tray:
- `/` triggers dropdown anywhere in message (not just at start)
- Dropdown reuses existing trigger infrastructure and styling
- Skills searchable by name and description

#### Phase 3: System Prompt Injection

When user submits a message starting with `/skill-name`:
1. Parse all skill invocations from the message (supports multiple skills)
2. Read the full skill content from disk for each skill
3. Substitute `$ARGUMENTS` with the provided args
4. Wrap each in `<skill-instruction>` with explicit agent instructions and `<skill>` tags
5. Append all skill instructions to system prompt (not user message)
6. Send original message as the user message (for display and persistence)

**Multi-skill support**: Users can invoke multiple skills in a single message. Each skill gets its own `<skill-instruction>` block appended to the system prompt.

**Per-run injection**: Skills are only injected into the system prompt for the current agent run. Thread reload does not re-inject skills - they apply only to the turn they were invoked.

#### Phase 4: UI Display

In the message renderer, regex match `<skill>` tags and render as collapsed chips instead of raw content.

---

## Detailed Implementation

### Phase 1: Skills Entity & Discovery Service

Skills follow the same entity pattern as quick-actions: types, store, service, with discovery via TypeScript using the FS adapter.

#### 1.1 Types (`src/entities/skills/types.ts`)

```typescript
export interface SkillMetadata {
  id: string;                    // Stable UUID
  name: string;                  // Display name (from frontmatter or directory name)
  slug: string;                  // Directory/file name for lookups
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
}
```

#### 1.2 Store (`src/entities/skills/store.ts`)

```typescript
import { create } from 'zustand';
import type { SkillMetadata, SkillSource } from './types';

interface SkillsState {
  skills: Record<string, SkillMetadata>;  // Keyed by ID
  _hydrated: boolean;
  _lastDiscoveryPath: string | null;      // Track which repo we discovered for

  // Selectors
  getSkill: (id: string) => SkillMetadata | undefined;
  getBySlug: (slug: string) => SkillMetadata | undefined;
  getAll: () => SkillMetadata[];
  getForSource: (source: SkillSource) => SkillMetadata[];
  search: (query: string) => SkillMetadata[];

  // Mutations
  hydrate: (skills: Record<string, SkillMetadata>, repoPath: string) => void;
  _setHydrated: (hydrated: boolean) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: {},
  _hydrated: false,
  _lastDiscoveryPath: null,

  getSkill: (id) => get().skills[id],

  getBySlug: (slug) => {
    return Object.values(get().skills).find(s => s.slug === slug);
  },

  getAll: () => {
    // Sort by source priority, then name
    const order: Record<SkillSource, number> = {
      project: 0,
      project_command: 1,
      mort: 2,
      personal: 3,
      personal_command: 4,
    };
    return Object.values(get().skills)
      .filter(s => s.userInvocable)
      .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  },

  getForSource: (source) => {
    return Object.values(get().skills)
      .filter(s => s.source === source && s.userInvocable);
  },

  search: (query) => {
    const q = query.toLowerCase();
    return get().getAll().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  },

  hydrate: (skills, repoPath) => set({
    skills,
    _hydrated: true,
    _lastDiscoveryPath: repoPath
  }),

  _setHydrated: (hydrated) => set({ _hydrated: hydrated }),
}));
```

#### 1.3 Service (`src/entities/skills/service.ts`)

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

  // Simple YAML parsing for key: value pairs
  const frontmatter: SkillFrontmatter = {};
  for (const line of yamlContent.split('\n')) {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      const cleanKey = key.trim();
      const cleanValue = value.trim().replace(/^["']|["']$/g, '');

      if (cleanKey === 'name') frontmatter.name = cleanValue;
      else if (cleanKey === 'description') frontmatter.description = cleanValue;
      else if (cleanKey === 'user-invocable') frontmatter['user-invocable'] = cleanValue !== 'false';
      else if (cleanKey === 'disable-model-invocation') frontmatter['disable-model-invocation'] = cleanValue === 'true';
    }
  }

  return { frontmatter, body };
}

export const skillsService = {
  /**
   * Discover and hydrate skills from all locations
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
            slug = entry.name.replace(/\.md$/, '').toLowerCase();  // Normalize to lowercase
          } else {
            // Modern: directories with SKILL.md
            if (!entry.isDirectory) continue;
            skillPath = await fs.joinPath(entry.path, 'SKILL.md');
            if (!await fs.exists(skillPath)) continue;
            slug = entry.name.toLowerCase();  // Normalize to lowercase
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
   * Get skill by slug
   */
  getBySlug(slug: string): SkillMetadata | undefined {
    return useSkillsStore.getState().getBySlug(slug);
  },

  /**
   * Get all skills (filtered for user-invocable)
   */
  getAll(): SkillMetadata[] {
    return useSkillsStore.getState().getAll();
  },

  /**
   * Search skills by query
   */
  search(query: string): SkillMetadata[] {
    return useSkillsStore.getState().search(query);
  },

  /**
   * Read full skill content by slug
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
   * Check if discovery is needed (repo changed)
   */
  needsRediscovery(repoPath: string): boolean {
    const state = useSkillsStore.getState();
    return !state._hydrated || state._lastDiscoveryPath !== repoPath;
  },
};
```

#### 1.4 Index (`src/entities/skills/index.ts`)

```typescript
export * from './types';
export { useSkillsStore } from './store';
export { skillsService } from './service';
```

### Phase 2: Slash Command UI

Uses the **existing trigger system** (same as `@` file mentions). Create `src/lib/triggers/handlers/skill-handler.ts`:

```typescript
import type { TriggerConfig, TriggerHandler, TriggerResult, TriggerContext } from "../types";
import { skillsService } from "@/entities/skills";
import type { SkillSource } from "@/entities/skills";

/**
 * Skill trigger handler for "/" - follows same pattern as FileTriggerHandler for "@"
 * See: src/lib/triggers/handlers/file-handler.ts
 */
class SkillTriggerHandler implements TriggerHandler {
  readonly config: TriggerConfig = {
    char: "/",
    name: "Skill",
    placeholder: "Search skills and commands...",
    minQueryLength: 0,
  };

  async search(
    query: string,
    context: TriggerContext,
    _signal?: AbortSignal
  ): Promise<TriggerResult[]> {
    if (!context.rootPath) {
      return [];
    }

    // Refresh skills on each "/" trigger (ensures fresh list)
    await skillsService.discover(context.rootPath);

    const skills = query
      ? skillsService.search(query)
      : skillsService.getAll();

    return skills.map(skill => ({
      id: skill.id,
      label: `/${skill.slug}`,
      description: skill.description || "",
      icon: this.getIconForSource(skill.source),
      insertText: `/${skill.slug} `,
      // Subtle source label displayed in dropdown (e.g., "Personal", "Project")
      secondaryLabel: this.getSourceLabel(skill.source),
    }));
  }

  private getIconForSource(source: SkillSource): string {
    switch (source) {
      case "mort": return "mort";
      case "personal": return "user";
      case "project": return "folder";
      case "personal_command": return "terminal";
      case "project_command": return "folder-terminal";
      default: return "command";
    }
  }

  private getSourceLabel(source: SkillSource): string {
    switch (source) {
      case "mort": return "Mort";
      case "personal": return "Personal";
      case "project": return "Project";
      case "personal_command": return "Personal";
      case "project_command": return "Project";
      default: return "";
    }
  }
}

export const skillTriggerHandler = new SkillTriggerHandler();
```

Register in `src/lib/triggers/index.ts` (alongside existing FileTriggerHandler):

```typescript
import { triggerRegistry } from "./registry";
import { FileTriggerHandler } from "./handlers/file-handler";
import { SkillTriggerHandler } from "./handlers/skill-handler";

let initialized = false;

export function initializeTriggers(): void {
  if (initialized) return;
  initialized = true;

  triggerRegistry.register(new FileTriggerHandler());
  triggerRegistry.register(new SkillTriggerHandler());  // ADD THIS
}
```

**Note**: The existing `TriggerRegistry`, `useTriggerAutocomplete` hook, `TriggerSearchInput`, and `TriggerDropdown` components handle all the UI behavior automatically. The "/" trigger will:
- Activate anywhere in the message (same word-boundary detection as "@")
- Support escape sequence "//" for literal "/"
- Debounce searches (150ms)
- Handle keyboard navigation (arrow keys, Enter, Tab, Escape)

**DRY principle**: The word-boundary detection logic in `useTriggerAutocomplete` already handles:
- Scanning backwards from cursor to find trigger character
- Checking if at word boundary (start of input or after whitespace)
- Detecting escape sequences (double trigger char)
- Preventing false positives in URLs and file paths

This same logic applies to "/" automatically - no need to duplicate.

### Phase 3: System Prompt Injection

**Important**: Skill parsing and system prompt injection happens at the **agent level**, not the frontend. This allows skills to be read from both UI and agent processes using the adapter pattern.

#### 3.1 Adapter Pattern: One Service, Pluggable Transports

The adapter pattern means:
- **One `SkillsService` class** containing ALL business logic (discovery, parsing, priority ordering, slug normalization)
- **One `FilesystemAdapter` interface** defining the low-level FS operations
- **Two adapter implementations** (Node and Tauri) that are injected into the service

```
┌─────────────────────────────────────────────────────────────────┐
│                         SkillsService                           │
│  (contains all business logic: discovery, parsing, caching)     │
│                                                                 │
│  constructor(fs: FilesystemAdapter)                             │
│  ─────────────────────────────────────────────────────────────  │
│  discover(repoPath, homeDir) → SkillMetadata[]                  │
│  readContent(skillPath) → SkillContent                          │
│  getBySlug(slug) → SkillMetadata                                │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            │ depends on (injected)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                     FilesystemAdapter                           │
│  (interface - low-level FS operations only)                     │
│  ─────────────────────────────────────────────────────────────  │
│  readFile(path) → string | null                                 │
│  exists(path) → boolean                                         │
│  listDir(path) → DirEntry[]                                     │
│  joinPath(...segments) → string                                 │
└───────────────────────────┬─────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│  NodeFilesystemAdapter │       │ TauriFilesystemAdapter │
│  (uses Node fs module) │       │ (uses FilesystemClient)│
└───────────────────────┘       └───────────────────────┘
```

Define the filesystem adapter interface in `core/adapters/types.ts`:

```typescript
// Add to existing types.ts

/**
 * Low-level filesystem operations adapter.
 * Implementations provide platform-specific file access (Node fs, Tauri IPC, etc.)
 * SkillsService depends on this interface, not concrete implementations.
 */
export interface FilesystemAdapter {
  /**
   * Read file content as string.
   * @param filePath - Absolute path to file
   * @returns File content or null if not found/unreadable
   */
  readFile(filePath: string): Promise<string | null>;

  /**
   * Check if a path exists.
   */
  exists(path: string): Promise<boolean>;

  /**
   * List directory contents.
   */
  listDir(path: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>>;

  /**
   * Join path segments.
   */
  joinPath(...segments: string[]): string;
}
```

#### 3.2 Node.js Filesystem Adapter

Create `core/adapters/node/filesystem-adapter.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { FilesystemAdapter } from "../types";

/**
 * Node.js implementation of FilesystemAdapter.
 * Used by agent processes running in Node environment.
 */
export class NodeFilesystemAdapter implements FilesystemAdapter {
  async readFile(filePath: string): Promise<string | null> {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  async exists(p: string): Promise<boolean> {
    return fs.existsSync(p);
  }

  async listDir(p: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>> {
    const entries = fs.readdirSync(p, { withFileTypes: true });
    return entries.map(e => ({
      name: e.name,
      path: path.join(p, e.name),
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }));
  }

  joinPath(...segments: string[]): string {
    return path.join(...segments);
  }
}
```

#### 3.3 Tauri Filesystem Adapter

Create `src/adapters/tauri-filesystem-adapter.ts`:

```typescript
import { FilesystemClient } from "@/lib/filesystem-client";
import type { FilesystemAdapter } from "@core/adapters/types";

/**
 * Tauri implementation of FilesystemAdapter.
 * Used by frontend code running in Tauri webview.
 */
export class TauriFilesystemAdapter implements FilesystemAdapter {
  private fs = new FilesystemClient();

  async readFile(filePath: string): Promise<string | null> {
    try {
      return await this.fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async exists(p: string): Promise<boolean> {
    return await this.fs.exists(p);
  }

  async listDir(p: string): Promise<Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }>> {
    return await this.fs.listDir(p);
  }

  joinPath(...segments: string[]): string {
    return segments.join("/"); // Tauri uses forward slashes
  }
}
```

#### 3.4 SkillsService (Single Implementation)

There is **one `SkillsService` class** that contains all business logic. It receives a `FilesystemAdapter` via constructor injection.

Create `core/lib/skills/skills-service.ts`:

```typescript
import type { FilesystemAdapter } from "@core/adapters/types";
import type { SkillMetadata, SkillSource, SkillFrontmatter, SkillContent } from "./types";

// Skill directory configurations
interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

const SKILL_LOCATIONS: SkillLocation[] = [
  // Priority order: project > mort > personal
  { getPath: (repo) => `${repo}/.claude/skills`, source: 'project', isLegacy: false },
  { getPath: (repo) => `${repo}/.claude/commands`, source: 'project_command', isLegacy: true },
  { getPath: (_, home) => `${home}/.mort/skills`, source: 'mort', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/skills`, source: 'personal', isLegacy: false },
  { getPath: (_, home) => `${home}/.claude/commands`, source: 'personal_command', isLegacy: true },
];

/**
 * SkillsService - single implementation with injected filesystem adapter.
 *
 * Usage:
 *   // In frontend (Tauri)
 *   const service = new SkillsService(new TauriFilesystemAdapter());
 *
 *   // In agent (Node.js)
 *   const service = new SkillsService(new NodeFilesystemAdapter());
 */
export class SkillsService {
  private skills: Map<string, SkillMetadata> = new Map();
  private slugIndex: Map<string, string> = new Map(); // slug -> id
  private lastDiscoveryPath: string | null = null;

  constructor(private fs: FilesystemAdapter) {}

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
        const entries = await this.fs.listDir(dirPath);

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
            skillPath = this.fs.joinPath(entry.path, 'SKILL.md');
            if (!await this.fs.exists(skillPath)) continue;
            slug = entry.name.toLowerCase();
          }

          // Skip if we already have this slug from a higher-priority source
          if (this.slugIndex.has(slug)) continue;

          try {
            const content = await this.fs.readFile(skillPath);
            if (!content) continue;

            const { frontmatter } = this.parseFrontmatter(content);

            // Skip non-user-invocable skills
            if (frontmatter['user-invocable'] === false) continue;

            const id = crypto.randomUUID();
            this.slugIndex.set(slug, id);

            const skill: SkillMetadata = {
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

            this.skills.set(id, skill);
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

  /**
   * Get skill by ID.
   */
  getById(id: string): SkillMetadata | undefined {
    return this.skills.get(id);
  }

  /**
   * Get skill by slug.
   */
  getBySlug(slug: string): SkillMetadata | undefined {
    const id = this.slugIndex.get(slug.toLowerCase());
    return id ? this.skills.get(id) : undefined;
  }

  /**
   * Get all discovered skills, sorted by priority then name.
   */
  getAll(): SkillMetadata[] {
    const order: Record<SkillSource, number> = {
      project: 0,
      project_command: 1,
      mort: 2,
      personal: 3,
      personal_command: 4,
    };
    return Array.from(this.skills.values())
      .filter(s => s.userInvocable)
      .sort((a, b) => order[a.source] - order[b.source] || a.name.localeCompare(b.name));
  }

  /**
   * Search skills by query (matches name and description).
   */
  search(query: string): SkillMetadata[] {
    const q = query.toLowerCase();
    return this.getAll().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  }

  /**
   * Read full skill content from disk.
   */
  async readContent(slug: string): Promise<SkillContent | null> {
    const skill = this.getBySlug(slug);
    if (!skill) return null;

    const raw = await this.fs.readFile(skill.path);
    if (!raw) return null;

    const { body } = this.parseFrontmatter(raw);
    return { content: body, source: skill.source };
  }

  /**
   * Check if rediscovery is needed (repo changed).
   */
  needsRediscovery(repoPath: string): boolean {
    return this.lastDiscoveryPath !== repoPath;
  }

  private parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
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

        if (cleanKey === 'name') frontmatter.name = cleanValue;
        else if (cleanKey === 'description') frontmatter.description = cleanValue;
        else if (cleanKey === 'user-invocable') frontmatter['user-invocable'] = cleanValue !== 'false';
        else if (cleanKey === 'disable-model-invocation') frontmatter['disable-model-invocation'] = cleanValue === 'true';
      }
    }

    return { frontmatter, body };
  }
}
```

#### 3.5 Instantiation in Different Environments

**Frontend (Tauri)** - `src/lib/skills-service-instance.ts`:

```typescript
import { SkillsService } from "@core/lib/skills/skills-service";
import { TauriFilesystemAdapter } from "@/adapters/tauri-filesystem-adapter";

// Single instance for the frontend, using Tauri's filesystem
export const skillsService = new SkillsService(new TauriFilesystemAdapter());
```

**Agent (Node.js)** - `agents/src/lib/skills-service-instance.ts`:

```typescript
import { SkillsService } from "@core/lib/skills/skills-service";
import { NodeFilesystemAdapter } from "@core/adapters/node/filesystem-adapter";

// Single instance for agents, using Node's fs module
export const skillsService = new SkillsService(new NodeFilesystemAdapter());
```

Both use the **exact same `SkillsService` class** - only the adapter differs.
```

#### 3.4 Skill Injection Logic

Create shared skill processing in `agents/src/lib/skills/inject-skill.ts`:

```typescript
import type { SkillSource, SkillContent } from "./types";

export interface SkillMatch {
  skillSlug: string;
  args: string;
  fullMatch: string;
}

export interface SkillInjection {
  displayMessage: string;           // Original message (stored in thread, shown in UI)
  userMessage: string;              // What goes in user message (same as display)
  systemPromptAppend: string | null; // What gets appended to system prompt
  skills: Array<{ slug: string; source: SkillSource }>; // All skills found
}

// Matches /skill-name or /skill-name args
// Uses same word-boundary detection as @ trigger (see use-trigger-autocomplete.ts)
// Only matches when / is at word boundary (start of input, after whitespace, or after newline)
const SKILL_PATTERN = /(?:^|(?<=\s))\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;

/**
 * Extract all skill invocations from a message.
 * Supports multiple skills per message.
 */
export function extractSkillMatches(message: string): SkillMatch[] {
  const matches: SkillMatch[] = [];
  let match: RegExpExecArray | null;

  // Reset regex state
  SKILL_PATTERN.lastIndex = 0;

  while ((match = SKILL_PATTERN.exec(message)) !== null) {
    matches.push({
      skillSlug: match[1].toLowerCase(),  // Normalize to lowercase
      args: (match[2] || "").trim(),
      fullMatch: match[0],
    });
  }

  return matches;
}

/**
 * Build system prompt content for a single skill.
 */
export function buildSkillInstruction(
  skillSlug: string,
  source: SkillSource,
  content: string,
  args: string
): string {
  // Substitute $ARGUMENTS in skill content
  const processedContent = content.replace(/\$ARGUMENTS/g, args);

  return `<skill-instruction>
The user has invoked a skill. You MUST follow the instructions in the <skill> block below. This skill was loaded from outside your standard skill directories and was explicitly requested by the user.

<skill name="${skillSlug}" source="${source}">
${processedContent}
</skill>
</skill-instruction>`;
}

/**
 * Process a message and build skill injections.
 * Called by the agent runner, not the frontend.
 *
 * @param message - The user's message
 * @param readSkillContent - Adapter function to read skill content (works in UI or agent)
 */
export async function processMessageWithSkills(
  message: string,
  readSkillContent: (slug: string) => Promise<SkillContent | null>
): Promise<SkillInjection> {
  const skillMatches = extractSkillMatches(message);

  if (skillMatches.length === 0) {
    return {
      displayMessage: message,
      userMessage: message,
      systemPromptAppend: null,
      skills: [],
    };
  }

  const skillInstructions: string[] = [];
  const foundSkills: Array<{ slug: string; source: SkillSource }> = [];

  for (const match of skillMatches) {
    const skillContent = await readSkillContent(match.skillSlug);

    if (!skillContent) {
      // Skill not found, skip it
      continue;
    }

    foundSkills.push({ slug: match.skillSlug, source: skillContent.source });

    const instruction = buildSkillInstruction(
      match.skillSlug,
      skillContent.source,
      skillContent.content,
      match.args
    );

    skillInstructions.push(instruction);
  }

  return {
    displayMessage: message,
    userMessage: message,
    systemPromptAppend: skillInstructions.length > 0
      ? skillInstructions.join("\n\n")
      : null,
    skills: foundSkills,
  };
}
```

#### 3.5 Integration with Agent Runner

In `agents/src/runners/shared.ts`, modify `runAgentLoop()` to process skills before building the system prompt:

```typescript
// In runAgentLoop(), after receiving user message but before building system prompt:

import { processMessageWithSkills } from "../lib/skills/inject-skill";
import { NodeSkillsAdapter } from "@core/adapters/node/skills-adapter";

// ... existing code ...

// Process skill invocations in the user message
const skillsAdapter = new NodeSkillsAdapter();
const skillInjection = await processMessageWithSkills(
  userMessage,
  async (slug) => {
    // Read skill content using adapter
    const skill = await findSkillBySlug(slug, skillsAdapter, context.workingDir, os.homedir());
    if (!skill) return null;
    const content = await skillsAdapter.readContent(skill.path);
    if (!content) return null;
    const { body } = parseFrontmatter(content);
    return { content: body, source: skill.source };
  }
);

// Build system prompt with skill injection appended
const baseSystemPrompt = buildSystemPrompt(agentConfig, { ... });
const systemPrompt = skillInjection.systemPromptAppend
  ? `${baseSystemPrompt}\n\n${skillInjection.systemPromptAppend}`
  : baseSystemPrompt;

// Pass to SDK query() with existing append mechanism
query({
  prompt: skillInjection.userMessage,  // Original message unchanged
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,  // Now includes skill instructions
    },
    // ... rest of options
  },
});
```

**Key points:**
- Skills are read fresh from disk on each invocation (no caching)
- The existing `systemPrompt.append` mechanism is used
- Skill injection only affects the current turn, not persisted in thread
- Empty skill content (frontmatter-only files) still gets injected with empty `<skill>` block - this allows commands that are just a description to work
- Slug names are normalized to lowercase during discovery and matching

### Phase 4: UI Display

Since we store the original display message (e.g., `/review-pr 123 check for security issues`), the UI parses the skill invocation pattern to render it nicely. Supports multiple skills per message.

Create `src/lib/skills/parse-skill-display.ts`:

```typescript
import { extractSkillMatches, type SkillMatch } from "@/agents/lib/skills/inject-skill";

interface ParsedSkillMessage {
  skills: SkillMatch[];  // All skills found in message
  remainingText: string; // Text after removing skill invocations
}

export function parseSkillsFromDisplayMessage(message: string): ParsedSkillMessage {
  const skills = extractSkillMatches(message);

  // Remove skill invocations from message to get remaining text
  let remainingText = message;
  for (const skill of skills) {
    remainingText = remainingText.replace(skill.fullMatch, "").trim();
  }

  return { skills, remainingText };
}
```

Update `src/components/thread/user-message.tsx` to render skill chips:

```tsx
import { parseSkillsFromDisplayMessage } from "@/lib/skills/parse-skill-display";
import { useSkillsStore } from "@/entities/skills";

function UserMessage({ message }: { message: ThreadMessage }) {
  const { skills, remainingText } = parseSkillsFromDisplayMessage(message.content);

  return (
    <div className="user-message">
      {skills.map((skill, idx) => (
        <SkillChip
          key={`${skill.skillSlug}-${idx}`}
          slug={skill.skillSlug}
          args={skill.args}
        />
      ))}
      {remainingText && <p>{remainingText}</p>}
    </div>
  );
}

function SkillChip({ slug, args }: {
  slug: string;
  args: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const skill = useSkillsStore(state => state.getBySlug(slug));
  const source = skill?.source;

  const sourceIcon = {
    mort: "🔮",
    personal: "👤",
    project: "📁",
    personal_command: "💻",
    project_command: "📂",
  }[source || ""] || "⚡";

  const handleExpand = async () => {
    if (!expanded && !content) {
      // Lazy load skill content on first expand
      const skillContent = await skillsService.readContent(slug);
      if (skillContent) {
        setContent(skillContent.content);
      } else {
        // Skill file no longer exists - mark as stale
        setIsStale(true);
        setContent(null);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <div className={cn("skill-chip", isStale && "skill-chip--stale")}>
      <button onClick={handleExpand}>
        {sourceIcon} /{slug}
        {args && <span className="skill-args">{args}</span>}
        {isStale && <span className="skill-stale-badge">stale</span>}
        <ChevronIcon direction={expanded ? "down" : "right"} />
      </button>
      {expanded && (
        isStale ? (
          <div className="skill-stale-message">
            This skill is no longer available. The file may have been moved or deleted.
          </div>
        ) : (
          <pre className="skill-content">{content}</pre>
        )
      )}
    </div>
  );
}
```

**Stale skill handling**: Similar to how plans handle moved files, if a skill file has been deleted or moved since the message was sent:
- The chip displays with a "stale" indicator
- Expanding shows "This skill is no longer available" message
- The chip remains functional for historical context

### Phase 5: Settings UI

Add skills list to settings, following existing patterns:

```tsx
// src/components/settings/skills-settings.tsx

function SkillsSettings() {
  const skills = useSkillsStore(state => state.getAll());

  return (
    <SettingsSection title="Skills">
      <p className="settings-description">
        Skills extend agent capabilities. Create skills in ~/.mort/skills/ or ~/.claude/skills/
      </p>

      {skills.length === 0 ? (
        <EmptyState message="No skills found" />
      ) : (
        <div className="skills-list">
          {skills.map(skill => (
            <SkillListItem key={skill.id} skill={skill} />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function SkillListItem({ skill }: { skill: SkillMetadata }) {
  return (
    <div className="skill-list-item">
      <div className="skill-info">
        <span className="skill-name">/{skill.slug}</span>
        <span className="skill-source-badge">{skill.source}</span>
      </div>
      <p className="skill-description">{skill.description}</p>
      <span className="skill-path">{skill.path}</span>
    </div>
  );
}
```

### Phase 6: Future Enhancements

1. **Built-in skills**: Ship default skills with mort (e.g., `/mort-commit`, `/mort-review`)
2. **Skill templates**: Provide starter templates for common workflows
3. **Skill enable/disable**: Toggle individual skills on/off from settings

---

## Examples: Creating Skills and Commands

Both formats are fully supported. Use skills (modern) for new work, but existing commands continue to work.

### Project-Level Skill (Modern Format)

Create `.claude/skills/review-changes/SKILL.md` in a repository:

```yaml
---
name: review-changes
description: Reviews staged git changes and provides feedback on code quality, potential bugs, and improvements
argument-hint: [optional-focus-area]
allowed-tools: Bash, Read, Grep
---

# Review Changes

Review the currently staged git changes and provide constructive feedback.

## Steps

1. Run `git diff --staged` to see what's staged
2. Analyze each change for:
   - Code quality issues
   - Potential bugs
   - Security concerns
   - Performance implications
3. Provide specific, actionable feedback

## Focus Area

If specified, focus primarily on: $ARGUMENTS

## Output Format

For each file with issues:
- **File**: path/to/file.ts
- **Issue**: Description
- **Suggestion**: How to improve
```

### Personal Skill (Modern Format)

Create `~/.claude/skills/quick-commit/SKILL.md`:

```yaml
---
name: quick-commit
description: Creates a commit with an auto-generated message based on staged changes
disable-model-invocation: true
allowed-tools: Bash
---

# Quick Commit

Generate a commit message and create a commit for staged changes.

1. Run `git diff --staged` to see changes
2. Generate a concise commit message following conventional commits format
3. Run `git commit -m "generated message"`
4. Report the commit hash
```

### Legacy Command (Still Supported!)

Create `~/.claude/commands/test.md` (single file, not a directory):

```markdown
---
description: Run the project test suite and report results
---

Run the test suite for this project. Detect the test framework being used
(jest, vitest, pytest, etc.) and run the appropriate command.

Report:
1. Total tests run
2. Passed/failed counts
3. Any error messages for failed tests
```

Or a repo-level command at `<repo>/.claude/commands/build.md`:

```markdown
---
description: Build the project for production
---

Run the production build command for this project. Handle any errors gracefully.
```

**Note**: Legacy commands work identically to skills but are simpler (single file vs directory). They cannot bundle additional files like scripts or templates.

---

## Key Files to Modify

### Phase 1: Skills Entity

| File | Purpose | Changes |
|------|---------|---------|
| `src/entities/skills/types.ts` | **NEW** | SkillMetadata, SkillSource, SkillContent types |
| `src/entities/skills/store.ts` | **NEW** | Zustand store for skill state |
| `src/entities/skills/service.ts` | **NEW** | Discovery and content reading via FS adapter |
| `src/entities/skills/index.ts` | **NEW** | Public exports |
| `src/entities/index.ts` | Entity exports | Add skills export |

### Phase 2: Slash Command UI

| File | Purpose | Changes |
|------|---------|---------|
| `src/lib/triggers/handlers/skill-handler.ts` | **NEW** | Skill trigger handler for `/` |
| `src/lib/triggers/index.ts` | Trigger initialization | Register skill handler |
| `src/components/reusable/trigger-dropdown.tsx` | Dropdown UI | Add `secondaryLabel` display for source |
| `src/components/reusable/thread-input.tsx` | Input placeholder | Update to "Type a message, @ to mention files, / for skills..." |

### Phase 3: System Prompt Injection (Agent-Level)

| File | Purpose | Changes |
|------|---------|---------|
| `core/services/fs-adapter.ts` | Existing FS adapter interface | Add `listDirWithMetadata()` and `joinPath()` methods |
| `core/adapters/node/fs-adapter.ts` | Existing Node adapter | Add new method implementations |
| `src/adapters/tauri-fs-adapter.ts` | Existing Tauri adapter | Add new method implementations (delegates to `FilesystemClient`) |
| `core/lib/skills/skills-service.ts` | **NEW** | **Single SkillsService class** - all business logic, accepts FSAdapter |
| `core/lib/skills/types.ts` | **NEW** | SkillMetadata, SkillContent, SkillFrontmatter types |
| `src/lib/skills-service-instance.ts` | **NEW** | Frontend instance: `new SkillsService(tauriFsAdapter)` |
| `agents/src/lib/skills-service-instance.ts` | **NEW** | Agent instance: `new SkillsService(nodeFsAdapter)` |
| `agents/src/lib/skills/inject-skill.ts` | **NEW** | Skill parsing and injection logic |
| `agents/src/runners/shared.ts` | Agent runner | Call `processMessageWithSkills()`, use shared `skillsService` |

### Phase 4: UI Display

| File | Purpose | Changes |
|------|---------|---------|
| `src/lib/skills/parse-skill-display.ts` | **NEW** | Parse skill invocations from display messages (uses shared `extractSkillMatches`) |
| `src/components/thread/user-message.tsx` | User message display | Render skill indicators for `/skill` messages |
| `src/components/thread/skill-indicator.tsx` | **NEW** | Expandable skill indicator with stale state handling |

### Phase 5: Settings UI

| File | Purpose | Changes |
|------|---------|---------|
| `src/components/settings/skills-settings.tsx` | **NEW** | Skills list in settings panel |
| `src/components/settings/skill-list-item.tsx` | **NEW** | Individual skill row with name, source, description |
| `src/components/settings/index.tsx` | Settings routes | Add Skills section |

### Architecture Overview: Complete Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 1 & 2: DISCOVERY & SELECTION                     │
└─────────────────────────────────────────────────────────────────────────────────┘

App startup
        │
        ▼
skillsService.discover(repoPath)
        │  Scans directories:
        │  - <repo>/.claude/skills/*/SKILL.md  (project)
        │  - <repo>/.claude/commands/*.md      (project_command)
        │  - ~/.mort/skills/*/SKILL.md         (mort)
        │  - ~/.claude/skills/*/SKILL.md       (personal)
        │  - ~/.claude/commands/*.md           (personal_command)
        ▼
Hydrates useSkillsStore with SkillMetadata[]

        ...later...

User types "/" in input
        │
        ▼
skillsService.discover() (refresh)
        │
        ▼
TriggerDropdown shows available skills
        │  User selects "/review-pr"
        ▼
Input now contains: "/review-pr 123 check for security issues"


┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 3: SYSTEM PROMPT INJECTION                       │
│                              (happens at agent level)                            │
└─────────────────────────────────────────────────────────────────────────────────┘

User presses Enter to submit
        │
        ▼
Frontend sends message to agent runner
        │
        ▼
Agent runner: processMessageWithSkills(message, readSkillContentAdapter)
        │
        ├─ extractSkillMatches() finds all /skill invocations
        │  (supports multiple: /review-pr 123 \n /summarize)
        │
        ├─ For each skill match:
        │   ├─ readSkillContentAdapter(slug) → reads from disk
        │   └─ buildSkillInstruction() → creates <skill-instruction> block
        │
        └─ Returns SkillInjection:
            {
              displayMessage: "/review-pr 123...",
              userMessage: "/review-pr 123...",
              systemPromptAppend: "<skill-instruction>...</skill-instruction>",
              skills: [{ slug: "review-pr", source: "personal" }]
            }
        │
        ▼
Agent runner uses EXISTING systemPrompt.append mechanism (see shared.ts:527-547)
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  WHAT AGENT RECEIVES:                                                           │
│                                                                                 │
│  System Prompt (with appended skills):                                          │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ [base system prompt...]                                                   │  │
│  │                                                                           │  │
│  │ <skill-instruction>                                                       │  │
│  │ The user has invoked a skill. You MUST follow the instructions in the    │  │
│  │ <skill> block below. This skill was loaded from outside your standard    │  │
│  │ skill directories and was explicitly requested by the user.               │  │
│  │                                                                           │  │
│  │ <skill name="review-pr" source="personal">                               │  │
│  │ # Review PR                                                               │  │
│  │ Review the pull request for code quality, bugs, and security issues.     │  │
│  │ ## Steps                                                                  │  │
│  │ 1. Fetch PR diff with `gh pr diff 123 check for security issues`         │  │
│  │ 2. Analyze each file...                                                   │  │
│  │ </skill>                                                                  │  │
│  │ </skill-instruction>                                                      │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
│  User Message (unchanged):                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────┐  │
│  │ /review-pr 123 check for security issues                                 │  │
│  └───────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
Store displayMessage in thread (skill NOT re-injected on thread reload)


┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PHASE 4: UI DISPLAY                                    │
└─────────────────────────────────────────────────────────────────────────────────┘

When rendering user message in thread:
        │
        ▼
parseSkillFromDisplayMessage(storedMessage)
        │
        ├─ Regex match: /review-pr 123 check for security issues
        │
        └─ Extract: { skillSlug: "review-pr", userArgs: "123 check for security issues" }
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐                                                       │
│  │ 👤 /review-pr    ▶   │  ← Chip (click to expand, lazy-loads skill content)   │
│  └──────────────────────┘                                                       │
│  123 check for security issues                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Testing Plan

### Phase 1: Skill Discovery

1. **Create test skills**
   - `~/.mort/skills/test-mort/SKILL.md`
   - `~/.claude/skills/test-personal/SKILL.md`
   - `<repo>/.claude/skills/test-project/SKILL.md`
   - `~/.claude/commands/test-command.md`

2. **Test discovery**
   - Call `skillsService.discover()` with repo path
   - Verify all skills returned with correct `source` values
   - Verify priority ordering (project > mort > personal)

3. **Test malformed skills**
   - Create skill with invalid YAML frontmatter
   - Verify skill is skipped during discovery (not in results)
   - Verify warning logged: `[skillsService:discover] Failed to parse <path>`

### Phase 2: Slash Command UI

1. **Test dropdown trigger** (same word-boundary rules as `@` trigger)
   - Type `/` at start of input → dropdown appears
   - Type `/` mid-message after space (e.g., "Please /") → dropdown appears
   - Type `/` after newline → dropdown appears
   - Type `//` → literal `/` inserted, no dropdown (escape sequence)
   - Type `@src/components/foo.tsx` → NO dropdown (/ in file path, no word boundary)
   - Type `http://example.com` → NO dropdown (/ not at word boundary)

2. **Test dropdown content**
   - Skills shown with icons for source type
   - Subtle source label displayed (e.g., "Personal", "Project")
   - Filter works on name and description

3. **Test selection**
   - Arrow keys navigate
   - Enter/Tab inserts `/skill-name `
   - Escape closes dropdown

### Phase 3: System Prompt Injection

1. **Test single skill injection**
   - Submit `/test-skill some args`
   - Verify system prompt receives `<skill-instruction>` with skill content
   - Verify user message remains as `/test-skill some args`
   - Verify `$ARGUMENTS` substituted correctly in system prompt

2. **Test multi-skill injection**
   - Submit `/review-pr 123\n/summarize`
   - Verify system prompt receives TWO `<skill-instruction>` blocks
   - Verify each skill has correct `$ARGUMENTS`

3. **Test edge cases**
   - Skill not found → message sent as-is, no system prompt append
   - No arguments (`/review-pr` with no space) → valid invocation, `$ARGUMENTS` becomes empty string
   - Skill with no `$ARGUMENTS` placeholder → content unchanged
   - Mixed found/not-found skills → only found skills get injected
   - Empty skill content (frontmatter only) → still injected with empty `<skill>` block
   - Uppercase skill directory (`~/.claude/skills/MySkill/`) → normalized to `/myskill`
   - Skill in file path (`@src/components/foo.tsx`) → NOT treated as skill invocation

4. **Test per-run behavior**
   - Send message with skill → skill injected
   - Send follow-up message without skill → NO skill in system prompt
   - Reload thread → skills NOT re-injected (only applies to original turn)

### Phase 4: UI Display

1. **Test skill chip rendering**
   - User message starting with `/skill-name` shows chip
   - Click expands to lazy-load and show skill content from disk
   - User args appear below chip

2. **Test source icons**
   - Correct icon for each source type
   - Tooltip shows full source path

3. **Test persistence behavior**
   - Reload thread → skill chip still renders from stored `/skill-name args`
   - Expanding chip reads current skill file (may differ from original if skill updated)

4. **Test stale skill handling**
   - Delete a skill file after sending a message with it
   - Reload thread → chip shows with "stale" indicator
   - Expand chip → shows "skill no longer available" message

5. **Test multi-skill display**
   - Message with multiple skills → renders multiple indicators
   - Each indicator independently expandable
   - Remaining text (after skill invocations) displayed below indicators

### Phase 5: Settings UI

1. **Test skills list**
   - Settings → Skills shows all discovered skills
   - Each skill shows: name, source badge, description, path
   - Empty state when no skills found

2. **Test skill sources**
   - Project skills show "Project" badge
   - Personal skills show "Personal" badge
   - Mort skills show "Mort" badge

---

## References

- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Agent Skills API Documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Agent Skills in SDK](https://platform.claude.com/docs/en/agent-sdk/skills)
- [Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices)
- [Agent Skills Open Standard](https://agentskills.io)

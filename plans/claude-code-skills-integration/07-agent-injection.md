# 07: Agent Injection

## Overview

Implement system prompt injection at the agent level. When a user message contains `/skill-name`, the agent reads the skill from disk and appends instructions to the system prompt. This happens in the agent runner, not the frontend.

## Phases

- [ ] Create Node.js skills adapter
- [ ] Create shared skill injection logic
- [ ] Integrate with agent runner
- [ ] Handle multi-skill messages

---

## Dependencies

- **01-types-foundation** - Needs:
  - Adapter interfaces (`SkillsAdapter` from `@core/adapters/types`)
  - Skill types (`SkillSource`, `SkillReference`, `SkillMetadata`, etc. from `@core/types/skills`)
  - Shared utilities (`extractSkillMatches`, `stripFrontmatter` from `@core/skills`)

**Note**: This plan can run in parallel with 02, 03, 04, 05, 06 since it only needs the types and utilities from 01.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `core/adapters/node/skills-adapter.ts` | **CREATE** |
| `agents/src/lib/skills/inject-skill.ts` | **CREATE** |
| `agents/src/lib/skills/index.ts` | **CREATE** |
| `agents/src/runners/shared.ts` | **MODIFY** - Integrate skill injection |

> **Note**: Types are NOT defined here. All types are imported from `@core/types/skills` (defined canonically in plan 01). This ensures proper dependency direction where `agents` depends on `core`, not the other way around.

---

## Implementation

### 1. Node.js Skills Adapter

Create `core/adapters/node/skills-adapter.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { SkillSource, SkillReference, SkillMetadata } from "@core/types/skills";
import type { SkillsAdapter } from "@core/adapters/types";

interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

import { SOURCE_PRIORITY } from "@core/skills";

// SKILL_LOCATIONS order MUST match SOURCE_PRIORITY from @core/skills/constants
// This ensures consistent priority ordering across frontend and agent.
const SKILL_LOCATIONS: SkillLocation[] = [
  { getPath: (repo) => path.join(repo, ".claude", "skills"), source: "project", isLegacy: false },
  { getPath: (repo) => path.join(repo, ".claude", "commands"), source: "project_command", isLegacy: true },
  { getPath: (_, home) => path.join(home, ".mort", "skills"), source: "mort", isLegacy: false },
  { getPath: (_, home) => path.join(home, ".claude", "skills"), source: "personal", isLegacy: false },
  { getPath: (_, home) => path.join(home, ".claude", "commands"), source: "personal_command", isLegacy: true },
];

// Runtime verification that SKILL_LOCATIONS order matches SOURCE_PRIORITY
if (process.env.NODE_ENV !== 'production') {
  const locationSources = SKILL_LOCATIONS.map(l => l.source);
  const mismatch = locationSources.some((s, i) => s !== SOURCE_PRIORITY[i]);
  if (mismatch) {
    console.warn('[NodeSkillsAdapter] SKILL_LOCATIONS order does not match SOURCE_PRIORITY');
  }
}

/**
 * Node.js implementation of SkillsAdapter.
 *
 * This adapter implements the SkillsAdapter interface for use in the agent runner.
 * It uses synchronous fs operations internally but exposes async methods for
 * interface consistency.
 *
 * Primary use case: `findBySlug()` for skill injection in agent runner.
 * The `discover()` method is implemented for interface compliance but the frontend
 * service (plan 03) uses its own implementation with FilesystemClient.
 */
export class NodeSkillsAdapter implements SkillsAdapter {
  /**
   * Discover all skills from configured locations.
   * Note: The frontend service (plan 03) uses FilesystemClient for this.
   * This implementation is provided for interface compliance.
   */
  async discover(_repoPath: string, _homeDir: string): Promise<SkillMetadata[]> {
    // This adapter is primarily used for findBySlug in the agent.
    // Full discovery with metadata parsing is handled by the frontend service.
    // Throwing here to make it clear this shouldn't be used.
    throw new Error(
      "NodeSkillsAdapter.discover() is not implemented. " +
      "Use the frontend skillsService.discover() for full discovery."
    );
  }

  /**
   * Find a skill by slug across all locations.
   * Returns first match (respects priority order).
   * Note: Uses SkillReference (subset of SkillMetadata) since only slug, path, and source
   * are needed for agent injection.
   */
  async findBySlug(slug: string, repoPath: string, homeDir: string): Promise<SkillReference | null> {
    const normalizedSlug = slug.toLowerCase();

    for (const location of SKILL_LOCATIONS) {
      const dirPath = location.getPath(repoPath, homeDir);

      if (!fs.existsSync(dirPath)) continue;

      try {
        if (location.isLegacy) {
          // Legacy: <dir>/<slug>.md
          const filePath = path.join(dirPath, `${normalizedSlug}.md`);
          if (fs.existsSync(filePath)) {
            return { slug: normalizedSlug, path: filePath, source: location.source };
          }
        } else {
          // Modern: <dir>/<slug>/SKILL.md
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && entry.name.toLowerCase() === normalizedSlug) {
              const skillPath = path.join(dirPath, entry.name, "SKILL.md");
              if (fs.existsSync(skillPath)) {
                return { slug: normalizedSlug, path: skillPath, source: location.source };
              }
            }
          }
        }
      } catch {
        // Skip on error
      }
    }

    return null;
  }

  /**
   * Read skill content from disk.
   */
  async readContent(skillPath: string): Promise<string | null> {
    try {
      return fs.readFileSync(skillPath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Check if a path exists.
   */
  async exists(filePath: string): Promise<boolean> {
    return fs.existsSync(filePath);
  }

  /**
   * List directory contents.
   */
  async listDir(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        path: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      }));
    } catch {
      return [];
    }
  }

  /**
   * Join path segments.
   */
  joinPath(...segments: string[]): string {
    return path.join(...segments);
  }
}
```

### 2. Skill Injection Logic

Create `agents/src/lib/skills/inject-skill.ts`:

```typescript
import type { SkillSource, SkillContent, SkillInjection } from "@core/types/skills";
import { extractSkillMatches, stripFrontmatter } from "@core/skills";

// Re-export extractSkillMatches for convenience
export { extractSkillMatches };

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

### 3. Index Export

Create `agents/src/lib/skills/index.ts`:

```typescript
// Re-export types from core for convenience
export type {
  SkillSource,
  SkillContent,
  SkillMatch,
  SkillInjection,
  SkillReference,
} from "@core/types/skills";

// Export skill processing functions
export { extractSkillMatches, buildSkillInstruction, processMessageWithSkills } from "./inject-skill";
```

### 4. Agent Runner Integration

Update `agents/src/runners/shared.ts`:

```typescript
import * as os from "os";
import { processMessageWithSkills } from "../lib/skills";
import { stripFrontmatter } from "@core/skills";
import { NodeSkillsAdapter } from "@core/adapters/node/skills-adapter";

// In runAgentLoop(), after receiving user message:

const skillsAdapter = new NodeSkillsAdapter();

const skillInjection = await processMessageWithSkills(
  userMessage,
  async (slug) => {
    const skill = await skillsAdapter.findBySlug(slug, context.workingDir, os.homedir());
    if (!skill) return null;

    const rawContent = await skillsAdapter.readContent(skill.path);
    if (!rawContent) return null;

    // Strip frontmatter using shared utility from core
    const body = stripFrontmatter(rawContent);

    return {
      content: body,
      source: skill.source,
    };
  }
);

// Log found skills
if (skillInjection.skills.length > 0) {
  logger.log(`[skills] Found ${skillInjection.skills.length} skill(s):`,
    skillInjection.skills.map(s => `/${s.slug}`).join(", ")
  );
}

// Build system prompt with skill injection appended
const baseSystemPrompt = buildSystemPrompt(agentConfig, { ... });
const systemPrompt = skillInjection.systemPromptAppend
  ? `${baseSystemPrompt}\n\n${skillInjection.systemPromptAppend}`
  : baseSystemPrompt;

// Use existing systemPrompt.append mechanism
query({
  prompt: skillInjection.userMessage,
  options: {
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
    // ... rest
  },
});
```

---

## Key Behaviors

1. **Per-run injection**: Skills only injected for current turn, not persisted
2. **Multi-skill support**: Multiple `/skill` invocations in one message all get injected
3. **Priority order**: Project skills shadow personal skills with same slug
4. **Fresh read**: Skills read from disk each time (no caching)
5. **Missing skills**: Silently skipped (not an error)
6. **$ARGUMENTS substitution**: Args from message replace `$ARGUMENTS` in skill content

---

## Acceptance Criteria

- [ ] `/skill args` in message triggers skill injection
- [ ] Skill content appended to system prompt in `<skill-instruction>` tags
- [ ] `$ARGUMENTS` substituted correctly
- [ ] Multiple skills in one message all get injected
- [ ] Missing skills don't cause errors
- [ ] Frontmatter stripped from skill content
- [ ] Project skills have priority over personal
- [ ] Skill injection logged for debugging

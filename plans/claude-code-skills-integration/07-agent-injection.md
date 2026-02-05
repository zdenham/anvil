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

- **01-types-foundation** - Needs adapter interfaces and skill types

**Note**: This plan can run in parallel with 02, 03, 04, 05, 06 since it only needs the types from 01.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `core/adapters/node/skills-adapter.ts` | **CREATE** |
| `agents/src/lib/skills/types.ts` | **CREATE** |
| `agents/src/lib/skills/inject-skill.ts` | **CREATE** |
| `agents/src/lib/skills/index.ts` | **CREATE** |
| `agents/src/runners/shared.ts` | **MODIFY** - Integrate skill injection |

---

## Implementation

### 1. Shared Types for Agent

Create `agents/src/lib/skills/types.ts`:

```typescript
export type SkillSource =
  | 'project'
  | 'project_command'
  | 'mort'
  | 'personal'
  | 'personal_command';

export interface SkillContent {
  content: string;
  source: SkillSource;
}

export interface SkillMatch {
  skillSlug: string;
  args: string;
  fullMatch: string;
}

export interface SkillInjection {
  displayMessage: string;           // Original message (stored in thread, shown in UI)
  userMessage: string;              // What goes in user message (same as display)
  systemPromptAppend: string | null; // What gets appended to system prompt
  skills: Array<{ slug: string; source: SkillSource }>;
}

export interface SkillMetadata {
  slug: string;
  path: string;
  source: SkillSource;
}
```

### 2. Node.js Skills Adapter

Create `core/adapters/node/skills-adapter.ts`:

```typescript
import * as fs from "fs";
import * as path from "path";
import type { SkillSource, SkillMetadata } from "../../../agents/src/lib/skills/types";

interface SkillLocation {
  getPath: (repoPath: string, homeDir: string) => string;
  source: SkillSource;
  isLegacy: boolean;
}

const SKILL_LOCATIONS: SkillLocation[] = [
  { getPath: (repo) => path.join(repo, ".claude", "skills"), source: "project", isLegacy: false },
  { getPath: (repo) => path.join(repo, ".claude", "commands"), source: "project_command", isLegacy: true },
  { getPath: (_, home) => path.join(home, ".mort", "skills"), source: "mort", isLegacy: false },
  { getPath: (_, home) => path.join(home, ".claude", "skills"), source: "personal", isLegacy: false },
  { getPath: (_, home) => path.join(home, ".claude", "commands"), source: "personal_command", isLegacy: true },
];

export class NodeSkillsAdapter {
  /**
   * Find a skill by slug across all locations.
   * Returns first match (respects priority order).
   */
  findBySlug(slug: string, repoPath: string, homeDir: string): SkillMetadata | null {
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
  readContent(skillPath: string): string | null {
    try {
      return fs.readFileSync(skillPath, "utf-8");
    } catch {
      return null;
    }
  }
}
```

### 3. Skill Injection Logic

Create `agents/src/lib/skills/inject-skill.ts`:

```typescript
import type { SkillSource, SkillContent, SkillMatch, SkillInjection } from "./types";

// Matches /skill-name or /skill-name args at word boundary
const SKILL_PATTERN = /(?:^|(?<=\s))\/([a-z0-9_-]+)(?:\s+([^\n]*))?/gim;

/**
 * Extract all skill invocations from a message.
 */
export function extractSkillMatches(message: string): SkillMatch[] {
  const matches: SkillMatch[] = [];
  let match: RegExpExecArray | null;

  SKILL_PATTERN.lastIndex = 0;

  while ((match = SKILL_PATTERN.exec(message)) !== null) {
    matches.push({
      skillSlug: match[1].toLowerCase(),
      args: (match[2] || "").trim(),
      fullMatch: match[0],
    });
  }

  return matches;
}

/**
 * Parse YAML frontmatter from skill content.
 */
function parseFrontmatter(content: string): { body: string } {
  if (!content.startsWith("---")) {
    return { body: content };
  }

  const endIndex = content.indexOf("---", 3);
  if (endIndex === -1) {
    return { body: content };
  }

  return { body: content.slice(endIndex + 3).trim() };
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

### 4. Index Export

Create `agents/src/lib/skills/index.ts`:

```typescript
export * from "./types";
export { extractSkillMatches, buildSkillInstruction, processMessageWithSkills } from "./inject-skill";
```

### 5. Agent Runner Integration

Update `agents/src/runners/shared.ts`:

```typescript
import * as os from "os";
import { processMessageWithSkills } from "../lib/skills";
import { NodeSkillsAdapter } from "@core/adapters/node/skills-adapter";

// In runAgentLoop(), after receiving user message:

const skillsAdapter = new NodeSkillsAdapter();

const skillInjection = await processMessageWithSkills(
  userMessage,
  async (slug) => {
    const skill = skillsAdapter.findBySlug(slug, context.workingDir, os.homedir());
    if (!skill) return null;

    const rawContent = skillsAdapter.readContent(skill.path);
    if (!rawContent) return null;

    // Strip frontmatter
    const { body } = parseFrontmatter(rawContent);

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

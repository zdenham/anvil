# 07: Agent Injection

## Overview

Implement system prompt injection at the agent level. When a user message contains `/skill-name`, the agent reads the skill from disk and appends instructions to the system prompt. This happens in the agent runner, not the frontend.

**Key**: The agent uses the **same `SkillsService` class** as the frontend (from plan 03), just with a different adapter injected. NO duplicate discovery/parsing logic.

## Phases

- [x] Create skill injection logic
- [x] Integrate with agent runner
- [x] Handle multi-skill messages

---

## Dependencies

- **01-types-foundation** - Needs:
  - Skill types (`SkillSource`, `SkillContent`, etc. from `@core/types/skills`)
  - Shared utilities (`extractSkillMatches`, `stripFrontmatter` from `@core/skills`)
- **03-skills-service** - Needs:
  - `SkillsService` class (the single implementation)
  - `skillsService` instance for agents (uses Node adapter)

**Note**: This plan depends on 03 for the SkillsService. It does NOT create its own discovery logic.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `agents/src/lib/skills/inject-skill.ts` | **CREATE** - Skill injection logic |
| `agents/src/lib/skills/index.ts` | **CREATE** - Exports |
| `agents/src/runners/shared.ts` | **MODIFY** - Integrate skill injection |

> **Note**: We do NOT create a separate adapter here. The agent uses `SkillsService` from `core/lib/skills/skills-service.ts` with `NodeFileSystemAdapter` injected (instantiated in `agents/src/lib/skills-service-instance.ts` per plan 03).

---

## Implementation

### 1. Skill Injection Logic

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

### 2. Index Export

Create `agents/src/lib/skills/index.ts`:

```typescript
// Re-export types from core for convenience
export type {
  SkillSource,
  SkillContent,
  SkillMatch,
  SkillInjection,
} from "@core/types/skills";

// Export skill processing functions
export { extractSkillMatches, buildSkillInstruction, processMessageWithSkills } from "./inject-skill";

// Export the service instance for agent use
export { skillsService } from "../skills-service-instance";
```

### 3. Agent Runner Integration

Update `agents/src/runners/shared.ts`:

```typescript
import * as os from "os";
import { processMessageWithSkills, skillsService } from "../lib/skills";

// In runAgentLoop(), after receiving user message:

// Ensure skills are discovered for this repo
if (skillsService.needsRediscovery(context.workingDir)) {
  await skillsService.discover(context.workingDir, os.homedir());
}

const skillInjection = await processMessageWithSkills(
  userMessage,
  // Uses the same SkillsService as frontend - no duplicate logic
  (slug) => skillsService.readContent(slug)
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

- [x] `/skill args` in message triggers skill injection
- [x] Skill content appended to system prompt in `<skill-instruction>` tags
- [x] `$ARGUMENTS` substituted correctly
- [x] Multiple skills in one message all get injected
- [x] Missing skills don't cause errors
- [x] Frontmatter stripped from skill content (handled by SkillsService.readContent)
- [x] Project skills have priority over personal (handled by SkillsService.discover)
- [x] Skill injection logged for debugging
- [x] Uses shared SkillsService - NO duplicate discovery/parsing logic

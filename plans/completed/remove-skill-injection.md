# Remove Skill Injection

Remove all skill injection functionality that appends content to the system prompt. Keep skill detection (extractSkillMatches) but remove all injection behavior.

## Background

The current skill injection system:
1. Detects skill invocations in user messages (e.g., `/commit fix bug`)
2. Reads skill content from filesystem (`.claude/skills/`, `~/.mort/skills/`, etc.)
3. **Wraps skill content in `<skill-instruction>` tags with "MUST follow" language**
4. **Appends these instructions to the system prompt**
5. Transforms the user message to avoid SDK slash command rejection

This deviates from "standard" Claude skills behavior where skills are handled via the SDK's Skill tool, not injected into the system prompt.

## What to Remove

### 1. `agents/src/lib/skills/inject-skill.ts` - Delete entire file

This file contains:
- `buildSkillInstruction()` - Creates `<skill-instruction>` XML blocks
- `transformUnfoundSkillMessage()` - Transforms messages for unfound skills
- `transformFoundSkillMessage()` - Transforms messages for found skills
- `processMessageWithSkills()` - Main entry point that orchestrates injection

### 2. `agents/src/lib/skills/index.ts` - Remove injection exports

Current exports:
```typescript
export { extractSkillMatches, buildSkillInstruction, processMessageWithSkills } from "./inject-skill.js";
export { skillsService } from "../skills-service-instance.js";
```

Keep only:
```typescript
export { skillsService } from "../skills-service-instance.js";
```

Note: `extractSkillMatches` comes from `@core/skills/index.js` and is used for skill detection (not injection). It can remain available from core but should not be re-exported from this agent-side skills module.

### 3. `agents/src/runners/shared.ts` - Remove injection integration

**Line 39 - Remove import:**
```typescript
import { processMessageWithSkills, skillsService } from "../lib/skills/index.js";
```

**Lines 412-442 - Remove skill discovery and processing:**
```typescript
// Process skill invocations in the user message (e.g., /commit fix bug)
// ... all skill discovery and processMessageWithSkills code
```

**Lines 458-460 - Remove system prompt append:**
```typescript
const systemPrompt = skillInjection.systemPromptAppend
  ? `${baseSystemPrompt}\n\n${skillInjection.systemPromptAppend}`
  : baseSystemPrompt;
```

Replace with:
```typescript
const systemPrompt = baseSystemPrompt;
```

**Remove references to `skillInjection.userMessage`** - The actual user prompt should remain unchanged (no transformation).

### 4. `agents/src/testing/__tests__/skills.integration.test.ts` - Remove injection tests

Remove or update tests that cover:
- `buildSkillInstruction()` tests (lines 211-260)
- `processMessageWithSkills()` tests (lines 266-400)
- Message transformation tests
- System prompt append verification

Keep tests for:
- `extractSkillMatches()` (lines 29-112) - This is skill detection, not injection
- `parseFrontmatter()` (lines 118-205) - This is metadata parsing, not injection
- Filesystem fixture tests that don't rely on injection

## What to Keep

1. **Skill detection** - `extractSkillMatches()` from `@core/skills/index.js` (detects `/skillname` patterns)
2. **SkillsService** - For discovering and reading skill files from filesystem
3. **Skill types** - `SkillMatch`, `SkillContent`, `SkillSource` from `@core/types/skills.js`
4. **Frontmatter parsing** - `parseFrontmatter()` from core
5. **Skills service instance** - `agents/src/lib/skills-service-instance.ts`

## Impact Analysis

**After removal:**
- Users can still have `.claude/skills/` directories with skill files
- Skills will be discovered and available via `skillsService`
- The SDK's built-in Skill tool will handle skill invocations (standard behavior)
- No custom `<skill-instruction>` content will be added to system prompts
- User messages will pass through unchanged (no transformation)

**Behavior change:**
- `/commit fix bug` will no longer inject commit skill instructions into system prompt
- Instead, the SDK handles it like any other slash command (via Skill tool)

## Phases

- [x] Delete `agents/src/lib/skills/inject-skill.ts`
- [x] Update `agents/src/lib/skills/index.ts` to remove injection exports
- [x] Update `agents/src/runners/shared.ts` to remove all injection code
- [x] Update `agents/src/testing/__tests__/skills.integration.test.ts` to remove injection tests
- [x] Run tests to verify nothing is broken

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files Summary

| File | Action |
|------|--------|
| `agents/src/lib/skills/inject-skill.ts` | DELETE |
| `agents/src/lib/skills/index.ts` | MODIFY - remove injection exports |
| `agents/src/runners/shared.ts` | MODIFY - remove injection integration |
| `agents/src/testing/__tests__/skills.integration.test.ts` | MODIFY - remove injection tests |

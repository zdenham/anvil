# Fix: Commands/Skills Not Working

## Status: RESOLVED

The initial message skill processing issue has been fixed. Queued message skill processing remains as a separate issue to address.

---

## Problem

When users type a command (e.g., `/commit`) either as:
1. The initial message when starting a thread, or
2. A follow-up message while an agent is already running

The command doesn't work - the agent sees "Unknown skill: commit" and exits immediately.

---

## Root Cause (FOUND)

The issue was in how the Claude Agent SDK handles slash commands:

1. User types `/commit`
2. `extractSkillMatches` correctly extracts `commit` as a skill match
3. `skillsService.readContent('commit')` returns `null` because `/commit` is a **built-in Claude Code skill**, not a local custom skill in `.claude/commands/` or similar directories
4. The code silently skips unfound skills and passes the original `/commit` message to the SDK unchanged
5. **The SDK intercepts `/commit`** and checks if "commit" is in its known local commands list
6. Since it's not found, the SDK returns `"Unknown skill: commit"` with `shouldQuery: false`
7. The agent exits immediately without ever calling Claude

The key insight: The SDK was rejecting the slash command before Claude ever saw it.

### Log Evidence

The original logs clearly showed this happening:

```json
{
  "message": "[skill-handler] Processing skill result",
  "result": "Unknown skill: commit"
}
```

```json
{
  "message": "[runner] Agent loop finished",
  "result": "Unknown skill: commit"
}
```

The agent finished immediately with "Unknown skill: commit" as the result - no Claude API call was ever made because the SDK rejected the command with `shouldQuery: false`.

---

## Solution Implemented

Modified `processMessageWithSkills` in `agents/src/lib/skills/inject-skill.ts` to transform messages when skills are not found locally:

### Changes Made

**1. `agents/src/lib/skills/inject-skill.ts`**

Added a `transformUnfoundSkillMessage` function that:
- Detects when ALL skills in a message are unfound (not in local skill directories)
- Transforms `/commit fix bug` → `run //commit fix bug`
- This avoids SDK rejection while preserving the skill invocation for Claude

The `processMessageWithSkills` function now:
- Tracks unfound skills separately from found skills
- Returns a `userMessage` that may be transformed (different from `displayMessage`)
- Only transforms when ALL skills are unfound (if any local skill is found, keep original message)

**2. `agents/src/runners/shared.ts`**

Updated to use `skillInjection.userMessage` instead of `config.prompt` when passing to the SDK:
```typescript
const effectivePrompt = skillInjection.userMessage;
if (effectivePrompt !== config.prompt) {
  logger.info(`[runAgentLoop] Transformed prompt to avoid SDK slash command rejection`);
}
```

**3. `agents/src/testing/__tests__/skills.integration.test.ts`**

Added 2 new tests:
- `transforms message when all skills are unfound to avoid SDK rejection`
- `does not transform message when at least one skill is found`

### How It Works Now

1. User types `/commit fix bug`
2. `extractSkillMatches` extracts the skill match
3. `skillsService.readContent('commit')` returns `null` (built-in skill, not local)
4. Since ALL skills are unfound, `transformUnfoundSkillMessage` transforms:
   - `/commit fix bug` → `run //commit fix bug`
5. The transformed message passes through the SDK to Claude
6. Claude sees "run //commit fix bug" and uses the `Skill` tool to invoke the built-in `/commit` skill

---

## Issue 2: Queued Messages (NOT YET FIXED)

### Location
`agents/src/runner.ts` lines 169-176

### The Code (Still needs fix)
```typescript
case "queued_message": {
  const { content } = msg.payload;
  const messageId = crypto.randomUUID();
  logger.info(`[runner] Received queued message, injecting into stream: ${messageId}`);
  messageStream.push(messageId, content);  // ← Raw content, no skill processing!
  break;
}
```

### The Problem
Queued messages (follow-up messages while agent is running) completely bypass `processMessageWithSkills()`. The raw `/commit fix bug` text goes directly into the message stream. This is a separate issue from the initial message processing.

### Proposed Fix
```typescript
case "queued_message": {
  const { content } = msg.payload;
  const messageId = crypto.randomUUID();

  // Process skills from the queued message
  const skillInjection = await processMessageWithSkills(
    content,
    (slug) => skillsService.readContent(slug)
  );

  // Use transformed message to avoid SDK rejection of unfound skills
  logger.info(`[runner] Received queued message (skills: ${skillInjection.skills.length}), injecting: ${messageId}`);
  messageStream.push(messageId, skillInjection.userMessage);
  break;
}
```

---

## Phases

- [x] Investigate why /commit wasn't working
- [x] Implement fix for initial message skill processing (transform unfound skills)
- [x] Add tests for the transformation behavior
- [ ] Add skill processing to queued message handler in runner.ts (separate issue)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files Modified

1. `agents/src/lib/skills/inject-skill.ts` - Added `transformUnfoundSkillMessage` function and updated `processMessageWithSkills` to track/transform unfound skills
2. `agents/src/runners/shared.ts` - Use `skillInjection.userMessage` instead of raw `config.prompt`
3. `agents/src/testing/__tests__/skills.integration.test.ts` - Added 2 new tests for transformation behavior

## Testing

All 42 skill tests pass including the 2 new transformation tests.

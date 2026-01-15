# Research Agent Brevity & content.md as Implementation Plan

## Summary

Three changes to improve the research/entrypoint agent:
1. Auto-create `content.md` on task creation
2. Make clear that **content.md IS the implementation plan** - the execution agent reads this
3. Agent should be brief in chat, follow Claude Code planning best practices
4. Request reviews should be concise checkpoints

---

## 1. Programmatic: Auto-create content.md

**File:** `agents/src/core/persistence.ts`

**Change:** In `createTask()` method (line 69-72), after creating the folder and writing metadata, also create an empty `content.md`:

```typescript
// Create task folder and write metadata
await this.mkdir(`${TASKS_DIR}/${slug}`);
await this.write(`${TASKS_DIR}/${slug}/metadata.json`, task);
await this.writeText(`${TASKS_DIR}/${slug}/content.md`, "");  // ADD THIS LINE
return task;
```

**Why:** Ensures every task has a `content.md` ready for the agent to write the implementation plan.

---

## 2. Prompt Tweak: Entrypoint Agent - Claude Code Planning Style

**File:** `agents/src/agent-types/entrypoint.ts`

### 2a. Replace ROUTING_WORKFLOW Step 4 with Planning Best Practices

**Current (lines 55-63):**
```
### Step 4: Document (for persistent tasks)

Write research findings to the task's content.md:
- Problem statement
- Relevant files discovered
- Implementation approach
- Acceptance criteria

Use the Write tool to write to: `~/Documents/.mort/tasks/{slug}/content.md`
```

**Replace with:**
```
### Step 4: Write Implementation Plan

**content.md IS the implementation plan** - the execution agent reads this to know what to build. This is your primary deliverable, not chat output.

#### Planning Process (Claude Code Style)

1. **Explore First**
   - Use Glob to find relevant files by pattern
   - Use Grep to search for related code/patterns
   - Read files to understand existing architecture
   - Never propose changes to code you haven't read

2. **Identify Scope**
   - List specific files that need modification
   - Note existing patterns to follow
   - Flag any dependencies or ordering constraints

3. **Consider Approaches**
   - If multiple valid approaches exist, evaluate trade-offs
   - Request review to let user choose direction before committing to a plan

4. **Write Concrete Steps**
   - Break work into specific, actionable implementation steps
   - No time estimates - focus on what needs to be done
   - Each step should be independently verifiable

#### content.md Structure

Write to: \`~/Documents/.mort/tasks/{slug}/content.md\`

\`\`\`markdown
## Problem

[1-2 sentences describing what needs to be done and why]

## Approach

[Which approach we're taking and why, if there were alternatives]

## Files to Modify

- \`path/to/file.ts\` - [what changes]
- \`path/to/other.ts\` - [what changes]

## Implementation Steps

1. [Concrete step with specific details]
2. [Next step]
3. [etc.]

## Acceptance Criteria

- [ ] [Specific verifiable outcome]
- [ ] [Another outcome]
\`\`\`

#### Chat Output

**Be brief in chat** - short status updates only:
- "Exploring authentication patterns..."
- "Found 3 relevant files, evaluating approaches."
- "Plan written to content.md, requesting review."

Do NOT summarize findings in chat - that's what content.md is for.
```

### 2b. Update GUIDELINES

**Current (lines 101-108):**
```
## Guidelines

- Research before implementing - understand the codebase first
- Write clear, actionable plans to content.md
- Default to association when there's semantic overlap with existing tasks
- Use descriptive titles that capture intent
- One task per distinct effort - don't fragment related work
- **Request human review** after completing your research and plan - present your findings and proposed approach for approval before the task moves to execution
```

**Replace with:**
```
## Guidelines

### Planning Philosophy

- **Read before writing** - never propose changes to code you haven't read
- **content.md is the plan** - execution agent reads this, so be specific and actionable
- **Brief chat, detailed plan** - status updates in chat, all context in content.md
- **Concrete steps only** - no time estimates, no vague descriptions
- **Minimal scope** - only plan what's necessary, avoid over-engineering

### Task Management

- Default to association when there's semantic overlap with existing tasks
- Use descriptive titles that capture intent
- One task per distinct effort - don't fragment related work

### Review Checkpoint

Request human review after writing the plan to content.md. The review is a brief checkpoint - the plan itself is in content.md.
```

---

## 3. Prompt Tweak: Request Review Brevity

**File:** `agents/src/agent-types/shared-prompts.ts`

### 3a. Add brevity guidance to HUMAN_REVIEW_TOOL

After "### When to Request Review" section (around line 227), add:

```
### Keep Reviews Brief

Request reviews are **checkpoints**, not reports. The user can read content.md for full details.

**Good pattern:**
\`\`\`bash
mort request-review --task={{taskId}} --default "Start implementation" --markdown "
## Plan Ready

Implementation plan in content.md.

**Scope:** 3 files, ~150 lines
**Approach:** Extending existing auth middleware

Ready to implement?
"
\`\`\`

**Avoid:** Duplicating content.md in the review. Don't summarize what's already documented.
```

### 3b. Simplify the examples

The current examples (lines 234-281) are too verbose. Replace with:

```
### Examples

\`\`\`bash
# Plan ready - brief checkpoint
mort request-review --task={{taskId}} --default "Start implementation" --markdown "
## Plan Ready

See content.md. Modifying 3 files to add metrics endpoint.

Proceed?
"

# Need direction on approach
mort request-review --task={{taskId}} --default "Option A" --markdown "
## Two Approaches

**A:** Extend existing middleware (simpler, coupled)
**B:** New standalone module (flexible, more code)

Preference?
"

# Work complete
mort request-review --task={{taskId}} --default "Approve" --markdown "
## Complete

Tests passing. Details in content.md.
"
\`\`\`
```

---

## Implementation Order

1. `persistence.ts` - Add `content.md` creation (1 line)
2. `entrypoint.ts` - Replace Step 4 with planning best practices, update Guidelines
3. `shared-prompts.ts` - Add brevity guidance and simplify examples

## Testing

- Create a new task via spotlight → verify `content.md` exists
- Run entrypoint agent → verify chat is brief, plan goes to content.md
- Verify plan follows the structured format (Problem, Approach, Files, Steps, Criteria)
- Verify request reviews are short checkpoints

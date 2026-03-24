# Planning Agent Refactor

## Overview

Two related changes:
1. **Rename "entrypoint" to "planning"** - More descriptive, aligns with future user-facing agent selection
2. **Use Claude Code's planning mode** - Less prescriptive plan format, leverage existing tooling

---

## Part 1: Rename "entrypoint" → "planning"

### File Rename
- `agents/src/agent-types/entrypoint.ts` → `agents/src/agent-types/planning.ts`

### Code Changes

**agents/src/agent-types/planning.ts** (renamed file)
- Line 177: `export const entrypoint` → `export const planning`
- Lines 11-13: Update ROLE text to use "planning agent" terminology

**agents/src/agent-types/index.ts**
- Line 1: `import { entrypoint }` → `import { planning }`
- Line 15: `entrypoint,` → `planning,` (in agents record)

**agents/src/cli/anvil.ts**
- Line 60: Update VALID_AGENT_TYPES array
- Lines 191, 193: Update help text

**agents/src/agent-types/shared-prompts.ts**
- Line 116: Table entry `entrypoint` → `planning`
- Line 122: Example command update

**src/components/spotlight/spotlight.tsx**
- Line 294: `agentType: "entrypoint"` → `agentType: "planning"`

**src/components/workspace/threads-list.tsx**
- Lines 13, 27: `case "entrypoint":` → `case "planning":`

**src/components/workspace/action-panel.tsx**
- Line 119: Update fallback array

**src/lib/tauri-commands.ts**
- Line 245: Update comment

**src-tauri/src/anvil_commands.rs**
- Line 463: `"entrypoint"` → `"planning"` in returned vec

---

## Part 2: Leverage Claude Code's Planning Mode

### Current State
The entrypoint agent has a rigid plan format (Lines 80-110 in entrypoint.ts):
- Problem
- Approach
- Files to Modify
- Implementation Steps
- Acceptance Criteria

This is overly prescriptive and duplicates what Claude Code's planning mode already does well.

### Target State
Instead of enforcing a specific markdown structure:
1. Tell the agent to use Claude Code's built-in planning workflow
2. Have the agent write its plan output to `content.md`
3. Let Claude naturally structure the plan based on task complexity

### Changes to planning.ts

**Remove the rigid CLI_OUTPUT_FORMAT prompt section (Lines 80-110)**

Current:
```typescript
const CLI_OUTPUT_FORMAT = `
## Step 4: Write Implementation Plan

Write to: {{anvilDir}}/tasks/{{slug}}/content.md

## Problem
[1-2 sentences describing what needs to be done and why]
...
`;
```

**Replace with planning-mode-aware instructions:**

```typescript
const PLANNING_APPROACH = `
## Step 4: Plan the Implementation

Use Claude Code's planning mode to design your approach:

1. **Enter planning mode** - Call the EnterPlanMode tool
2. **Explore thoroughly** - Use Glob, Grep, and Read to understand the codebase
3. **Consider alternatives** - Identify trade-offs between approaches
4. **Exit planning mode** - Call ExitPlanMode when your approach is clear

After exiting planning mode, write your implementation plan to content.md. Structure it naturally based on task complexity - simple tasks need simple plans, complex tasks need more detail. Don't follow a rigid template.

Key principles:
- Read code before proposing changes
- Be concrete and specific about what files to modify
- Include acceptance criteria that can be verified
- Keep scope minimal - don't over-engineer
`;
```

**Update the appendedPrompt composition:**
- Remove `CLI_OUTPUT_FORMAT`
- Add `PLANNING_APPROACH`

**Update GUIDELINES section:**
- Remove references to the specific markdown format
- Keep the principles (read before write, concrete steps, minimal scope)

### Behavior Change

Before:
1. Agent researches
2. Agent manually writes rigidly-structured markdown to content.md

After:
1. Agent researches
2. Agent calls EnterPlanMode to think through approach
3. Agent explores codebase in planning mode
4. Agent exits planning mode
5. Agent writes plan to content.md (flexibly structured)

---

## Implementation Order

1. Rename `entrypoint.ts` → `planning.ts` and update all imports/references
2. Update Rust backend to return "planning" instead of "entrypoint"
3. Update frontend components
4. Refactor the planning agent's system prompt to use planning mode
5. Test the full workflow

---

## Files to Modify Summary

| File | Changes |
|------|---------|
| `agents/src/agent-types/entrypoint.ts` | Rename to planning.ts, update export, refactor prompts |
| `agents/src/agent-types/index.ts` | Update import and export |
| `agents/src/cli/anvil.ts` | Update VALID_AGENT_TYPES and help text |
| `agents/src/agent-types/shared-prompts.ts` | Update agent table and examples |
| `src/components/spotlight/spotlight.tsx` | Update default agentType |
| `src/components/workspace/threads-list.tsx` | Update switch cases |
| `src/components/workspace/action-panel.tsx` | Update fallback array |
| `src/lib/tauri-commands.ts` | Update comment |
| `src-tauri/src/anvil_commands.rs` | Update returned agent types |

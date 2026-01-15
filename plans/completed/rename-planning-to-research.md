# Rename Planning Agent to Research Agent

## Overview

Rename the "planning" agent to "research" throughout the codebase and add explicit constraints that the research agent must NEVER write code to the repository - only output findings and plans to `content.md`.

## Motivation

1. "Research" better describes the agent's purpose: exploring, investigating, and documenting
2. Clear separation of concerns: research agent researches/plans, execution agent writes code
3. Prevents confusion about what the agent should produce

## Key Constraint to Add

The research agent should:
- Explore the codebase (read-only)
- Write findings, plans, and context to `content.md`
- Use Claude Code's planning mode (EnterPlanMode/ExitPlanMode)
- Route tasks appropriately
- **NEVER write, edit, or modify code files in the repository**

## Files to Modify

### 1. Agent Type Definition (Core)

**`agents/src/agent-types/planning.ts` → `agents/src/agent-types/research.ts`**
- Rename file
- Change export: `export const planning` → `export const research`
- Update `name: "Planning"` → `name: "Research"`
- Update `description: "Task routing, refinement, and research"` → `description: "Task research, planning, and routing"`
- Add explicit "NO CODE" constraint to the ROLE section:
  ```
  ## CRITICAL CONSTRAINT

  You are a READ-ONLY agent. You must NEVER:
  - Write, edit, or create code files in the repository
  - Use the Write or Edit tools on source code
  - Make commits or modify the git state

  Your ONLY output is writing to content.md in the task directory.
  ```

### 2. Agent Types Index

**`agents/src/agent-types/index.ts`**
- Change import: `import { planning }` → `import { research }`
- Update agents record: `planning,` → `research,`

### 3. CLI Valid Agent Types

**`agents/src/cli/mort.ts` (Line 75-76)**
- Change: `["planning", "execution", "review", "merge"]` → `["research", "execution", "review", "merge"]`

### 4. Rust Backend

**`src-tauri/src/mort_commands.rs` (Line 463)**
- Change: `vec!["planning", "execution", "review", "merge"]` → `vec!["research", "execution", "review", "merge"]`

### 5. TypeScript Type Definition

**`src/entities/threads/types.ts` (Line 3)**
- Change: `"entrypoint" | "execution" | "review" | "merge" | "planning"` → `"entrypoint" | "execution" | "review" | "merge" | "research"`

### 6. Tauri Commands Documentation

**`src/lib/tauri-commands.ts` (Line 245)**
- Update comment: `['planning', 'execution', 'review', 'merge']` → `['research', 'execution', 'review', 'merge']`

### 7. Frontend Components

**`src/components/workspace/threads-list.tsx` (Lines 13-28)**
- Change switch case: `case "planning":` → `case "research":`
- Update label: `return "Planning";` → `return "Research";`
- Update icon case: `case "planning":` → `case "research":`

**`src/components/workspace/action-panel.tsx`**
- Update any references to "planning" agent type

**`src/components/spotlight/spotlight.tsx` (Line 294)**
- Change default: `agentType: "planning"` → `agentType: "research"`

### 8. Validators

**`agents/src/validators/planning-naming.ts` → `agents/src/validators/research-naming.ts`**
- Rename file
- Update export name
- Update any "planning" references in code

**`agents/src/validators/index.ts`**
- Update import and reference

### 9. Shared Prompts

**`agents/src/agent-types/shared-prompts.ts` (Lines 114-123)**
- Update agent table:
  ```
  | `research` | Task research & planning | Need to explore codebase, gather context, or create plans |
  ```

### 10. Documentation

**`DATA-MODELS.md` (Line 62)**
- Update: `"planning"` → `"research"`

**`AGENTS.md`**
- Update any references to planning agent

**`plans/completed/planning-agent-refactor.md`**
- Note: This is historical documentation, can leave as-is or add note about subsequent rename

### 11. Backend Services

**`src/lib/agent-service.ts`**
- Update any "planning" references

## Implementation Order

1. **Phase 1: Agent Core**
   - [ ] Rename `planning.ts` → `research.ts`
   - [ ] Update agent config with new name and NO CODE constraint
   - [ ] Update `index.ts` imports

2. **Phase 2: Backend**
   - [ ] Update Rust `mort_commands.rs`
   - [ ] Update TypeScript types (`threads/types.ts`)
   - [ ] Update CLI valid types (`mort.ts`)

3. **Phase 3: Frontend**
   - [ ] Update `threads-list.tsx` switch cases
   - [ ] Update `spotlight.tsx` default
   - [ ] Update `action-panel.tsx` if needed

4. **Phase 4: Validators**
   - [ ] Rename validator file
   - [ ] Update validator index

5. **Phase 5: Documentation & Prompts**
   - [ ] Update `shared-prompts.ts`
   - [ ] Update `DATA-MODELS.md`
   - [ ] Update `AGENTS.md`
   - [ ] Update `tauri-commands.ts` comments

6. **Phase 6: Verification**
   - [ ] Run `pnpm typecheck` across all packages
   - [ ] Search for any remaining "planning" references
   - [ ] Test agent spawning with new name

## Research Agent System Prompt Additions

Add this to the ROLE section in `research.ts`:

```markdown
## CRITICAL: Read-Only Agent

You are strictly a READ-ONLY agent. Your purpose is research and planning, not implementation.

### You MUST NOT:
- Write, edit, or create source code files
- Use the Write or Edit tools on any code files
- Make git commits
- Modify any files in the repository

### You MUST:
- Read and explore the codebase
- Use Glob, Grep, Read tools freely
- Write ALL findings and plans to content.md
- Use EnterPlanMode/ExitPlanMode for planning
- Request human review when done

### The ONLY file you write to:
`{{mortDir}}/tasks/{{slug}}/content.md`

This is in the Mort data directory, NOT the code repository. All research, context, and implementation plans go here for the execution agent to read.
```

## Acceptance Criteria

- [ ] All "planning" references replaced with "research"
- [ ] Research agent explicitly prohibited from writing code
- [ ] Frontend displays "Research" label with appropriate icon
- [ ] CLI accepts "research" as valid agent type
- [ ] Type definitions updated
- [ ] No TypeScript errors
- [ ] Agent can be spawned and operates correctly

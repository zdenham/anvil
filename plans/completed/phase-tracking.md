# Phase Tracking

## Overview

Parse GitHub markdown todo lists as "phases" and display progress (e.g., "5/7") in the sidebar tree. This provides visual feedback on plan completion status.

**Key Decisions:**
- Phases are defined within a delimited `## Phases` section (strict match, case-insensitive)
- "Phase" and "task" are synonymous - both represent things that need to be done
- Display format: `[completed]/[total]` prepended to plan name, or `✓` when fully complete
- Plans without a `## Phases` section show no phase indicator (not forced)
- **Architecture**: Agent process parses phases on file write, persists to metadata on disk, emits events to frontend
- **No client-side parsing**: Frontend reads phase data from plan metadata store only
- **Existing plans**: No backfill - only future plans written by agent will have phase tracking
- **External edits**: Not detected in v1 - phases only update when agent modifies the file
- **Types**: `PhaseInfo` defined in `core/types/plans.ts`, imported by agents

---

## Architecture

### Data Flow

```
Plan file written (by agent or external)
    ↓
Agent PostToolUse hook detects plan file change
    ↓
Agent reads file content, parses ## Phases section
    ↓
Agent updates ~/.mort/plans/{id}/metadata.json with phaseInfo
    ↓
Agent emits plan:detected event (existing) or plan:phases-updated event (new)
    ↓
Frontend receives event, refreshes plan metadata from disk
    ↓
Tree menu reads phaseInfo from plan store, displays count
```

### Why Agent-Side Parsing?

1. **Single source of truth**: Phase data stored on disk, consistent across windows
2. **Performance**: No content fetching/parsing in frontend render path
3. **Scalability**: Tree can display many plans without loading content
4. **Consistency**: Same parsing logic for all plan updates

---

## Implementation

### 1. Phase Parsing (Agent-Side)

**`agents/src/lib/phase-parser.ts`** (new file)

```typescript
import type { PhaseInfo } from "@core/types/plans.js";

/**
 * Parse markdown content for GitHub-style todo lists within a ## Phases section.
 *
 * Supported formats:
 * - [ ] Uncompleted phase
 * - [x] Completed phase
 * - [X] Completed phase (uppercase)
 *
 * Only parses todos within a delimited "## Phases" section.
 * The section ends at the next heading (##) or horizontal rule (---).
 */
export function parsePhases(markdown: string): PhaseInfo | null {
  const lines = markdown.split('\n');

  const phaseSectionPattern = /^##\s+Phases\s*$/i;
  const sectionEndPattern = /^(##\s|---)/;
  const todoPattern = /^(\s*)- \[([ xX])\] (.+)$/;

  let inPhasesSection = false;
  let phaseSectionStart = -1;
  let completed = 0;
  let total = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (phaseSectionPattern.test(line)) {
      inPhasesSection = true;
      phaseSectionStart = i;
      continue;
    }

    if (inPhasesSection && i > phaseSectionStart && sectionEndPattern.test(line)) {
      break;
    }

    if (inPhasesSection) {
      const match = line.match(todoPattern);
      if (match) {
        const [, indent, checked] = match;
        if (indent.length <= 2) {
          total++;
          if (checked.toLowerCase() === 'x') {
            completed++;
          }
        }
      }
    }
  }

  // Return null if no Phases section found
  // Return { completed: 0, total: 0 } if section exists but is empty
  if (!inPhasesSection) {
    return null;
  }

  return { completed, total };
}
```

### 2. Plan Metadata Schema Update

**`core/types/plans.ts`** - Add phaseInfo to PlanMetadata:

```typescript
export interface PhaseInfo {
  completed: number;
  total: number;
}

export interface PlanMetadata {
  id: string;
  repoId: string;
  worktreeId: string;
  relativePath: string;
  parentId?: string;
  isFolder?: boolean;
  isRead: boolean;
  markedUnreadAt?: number;
  stale?: boolean;
  lastVerified?: number;
  createdAt: number;
  updatedAt: number;
  phaseInfo?: PhaseInfo;  // NEW: null/undefined means no ## Phases section
}
```

### 3. Agent Hook Integration

**`agents/src/runners/shared.ts`** - Update PostToolUse hook to parse phases:

In the existing plan detection block (after `isPlanPath()` check):

```typescript
import { parsePhases } from "../lib/phase-parser.js";
import { readFileSync } from "fs";

// Inside PostToolUse hook, after detecting a plan file:
if (isPlanPath(filePath, context.workingDir)) {
  // Read file content to parse phases
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : join(context.workingDir, filePath);

  let phaseInfo: PhaseInfo | null = null;
  try {
    const content = readFileSync(absolutePath, 'utf-8');
    phaseInfo = parsePhases(content);
  } catch (err) {
    // File read error - phaseInfo stays null
  }

  // Update ensurePlanExists to accept phaseInfo
  const planId = await persistence.ensurePlanExists({
    repoId,
    worktreeId,
    relativePath,
    phaseInfo,  // NEW
  });

  emitEvent(EventName.PLAN_DETECTED, { planId });
}
```

### 4. Persistence Layer Update

**`agents/src/core/persistence.ts`** - Update `ensurePlanExists` signature to accept phaseInfo:

Current signature (positional args):
```typescript
async ensurePlanExists(
  repoId: string,
  worktreeId: string,
  absolutePath: string,
  workingDir: string
): Promise<{ id: string; isNew: boolean }>
```

Updated signature (add phaseInfo parameter):
```typescript
async ensurePlanExists(
  repoId: string,
  worktreeId: string,
  absolutePath: string,
  workingDir: string,
  phaseInfo?: PhaseInfo | null  // NEW
): Promise<{ id: string; isNew: boolean }>
```

Update the implementation to pass phaseInfo to both `updatePlan` (for existing) and `createPlan` (for new):

```typescript
async ensurePlanExists(
  repoId: string,
  worktreeId: string,
  absolutePath: string,
  workingDir: string,
  phaseInfo?: PhaseInfo | null
): Promise<{ id: string; isNew: boolean }> {
  const relativePath = isAbsolute(absolutePath)
    ? this.toRelativePath(absolutePath, workingDir)
    : absolutePath;

  const existing = await this.findPlanByPath(repoId, relativePath);
  if (existing) {
    // Update with new phaseInfo (convert null to undefined for clean JSON)
    await this.updatePlan(existing.id, {
      isRead: false,
      phaseInfo: phaseInfo ?? undefined,
    });
    return { id: existing.id, isNew: false };
  }

  // Create new plan with phaseInfo
  const plan = await this.createPlan({
    repoId,
    worktreeId,
    relativePath,
    phaseInfo: phaseInfo ?? undefined,
  });
  return { id: plan.id, isNew: true };
}
```

Also update `createPlan` input type to accept optional phaseInfo.

### 5. Frontend Store Update

**`src/entities/plans/store.ts`** - Ensure store type includes phaseInfo:

The store already uses `PlanMetadata` type from `core/types/plans.ts`, so adding `phaseInfo` to the type will automatically flow through.

### 6. Tree Menu Display

**`src/components/tree-menu/plan-item.tsx`** - Add phase display to existing component:

The `PlanItem` component receives `item: TreeItemNode`. The `TreeItemNode` type will need to include
`phaseInfo` from the plan metadata. Update the title rendering (line 213) to prepend phase display:

```typescript
// Helper function for phase display
function getPhaseDisplay(phaseInfo: PhaseInfo | undefined) {
  if (!phaseInfo) return null;

  const { completed, total } = phaseInfo;
  const isComplete = completed === total && total > 0;

  if (isComplete) {
    return <span className="text-green-500 mr-1">✓</span>;
  }

  return (
    <span className="text-surface-500 font-mono text-xs mr-1">
      {completed}/{total}
    </span>
  );
}

// In the JSX (around line 213):
<span className="truncate flex-1">
  {getPhaseDisplay(item.phaseInfo)}
  {item.title}
</span>
```

Example tree rendering:
```
├── 3/7 authentication.md
├── 0/4 session-management.md
└── ✓ oauth-integration.md
```

---

## Agent Prompt Conventions

### Plan Conventions Prompt

**`agents/src/agent-types/shared-prompts.ts`**

```typescript
export const PLAN_CONVENTIONS = `## Plan File Conventions

When creating or updating plan files in the \`plans/\` directory, follow these conventions:

### File Structure
- Plans are markdown files in the \`plans/\` directory
- Use nested directories for related plans: \`plans/feature-name/sub-task.md\`
- Create a parent plan file matching directory name: \`plans/feature-name.md\` for \`plans/feature-name/\`

### Phase Tracking
- Define phases within a dedicated \`## Phases\` section (required for detection)
- The section must be delimited by the next \`##\` heading or \`---\` horizontal rule
- Use GitHub-style todo lists:
  \`\`\`markdown
  ## Phases

  - [ ] Research and design
  - [ ] Implement core functionality
  - [ ] Add tests
  - [ ] Documentation
  - [x] Code review (completed)

  ---
  \`\`\`
- Mark phases complete with \`[x]\` as work progresses
- Keep phases at the top level (not nested under other list items)
- Use clear, actionable phase descriptions

### Plan Hierarchy
- Parent plans provide overview and context
- Child plans detail specific implementation tasks
- Example structure:
  \`\`\`
  plans/
    authentication.md          # Overview of auth system
    authentication/
      oauth-integration.md     # Detailed OAuth implementation
      session-management.md    # Session handling details
  \`\`\`
`;
```

### Append to Agent Config

**`agents/src/agent-types/simple.ts`**

```typescript
import { composePrompt, PLAN_CONVENTIONS } from "./shared-prompts.js";

export const simple: AgentConfig = {
  name: "simple",
  // ...
  appendedPrompt: composePrompt(
    `## Context

You are helping the user with a task in their codebase.

- Task ID: {{taskId}}
- Thread ID: {{threadId}}

Work directly in the current repository. Make changes as requested.
Request human review when you need input or approval.`,
    PLAN_CONVENTIONS
  ),
};
```

---

## Phases

- [x] Add `PhaseInfo` type to `core/types/plans.ts`
- [x] Create `agents/src/lib/phase-parser.ts` with `parsePhases()` function
- [x] Update `agents/src/core/persistence.ts` abstract interface for phaseInfo
- [x] Update `agents/src/lib/persistence-node.ts` to persist phaseInfo
- [x] Update `agents/src/runners/shared.ts` PostToolUse hook to parse and persist phases
- [x] Update tree menu component to display phase count inline
- [x] Add `PLAN_CONVENTIONS` to `agents/src/agent-types/shared-prompts.ts`
- [x] Update `simple` agent config to include conventions (only agent that modifies plans)

---

## Testing Considerations

### Unit Tests
- `parsePhases()` with various markdown formats
- No `## Phases` section returns null
- Empty Phases section (header but no todos) returns `{ completed: 0, total: 0 }` → displays "0/0"
- All completed, none completed, mixed
- Nested todos (should be ignored)
- Mixed case `[x]` vs `[X]`
- Section delimiters: `---` and `## Other Section`

### Integration Tests
- Agent writes plan file → phases detected and persisted
- Plan metadata.json includes phaseInfo
- Frontend receives event and displays updated count

### Manual Testing
- Create plan with phases, verify count appears in tree
- Mark phase complete, verify count updates after save
- Plan without `## Phases` section shows no count

---

## Future Considerations

1. **Phase completion from UI** - Click to toggle phase completion
2. **Progress rollup** - Parent shows aggregate child progress
3. **Plan templates** - Pre-defined phase structures for common tasks
4. **External file changes** - File watcher for changes made outside agent (VS Code, etc.)
5. **Backfill existing plans** - Migration to parse phases for pre-existing plan files

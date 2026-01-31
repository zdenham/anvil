# Phase Tracking

## Overview

Parse GitHub markdown todo lists as "phases" and display progress (e.g., "5/7 phases done") in the sidebar and content pane. This provides visual feedback on plan completion status.

---

## Implementation

### 1. Phase Parsing

**`src/entities/plans/phase-parser.ts`** (new file)

Parse GitHub markdown todo lists as phases:

```typescript
interface Phase {
  text: string;
  completed: boolean;
  lineNumber: number;
}

interface PhaseInfo {
  phases: Phase[];
  completed: number;
  total: number;
}

/**
 * Parse markdown content for GitHub-style todo lists.
 *
 * Supported formats:
 * - [ ] Uncompleted phase
 * - [x] Completed phase
 * - [X] Completed phase (uppercase)
 *
 * Only parses top-level todos (not nested under other list items).
 */
export function parsePhases(markdown: string): PhaseInfo {
  const phases: Phase[] = [];
  const lines = markdown.split('\n');

  const todoPattern = /^(\s*)- \[([ xX])\] (.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(todoPattern);
    if (match) {
      const [, indent, checked, text] = match;
      // Only count top-level todos (no indentation or 0-2 spaces)
      if (indent.length <= 2) {
        phases.push({
          text: text.trim(),
          completed: checked.toLowerCase() === 'x',
          lineNumber: i + 1,
        });
      }
    }
  }

  return {
    phases,
    completed: phases.filter(p => p.completed).length,
    total: phases.length,
  };
}
```

### 2. Phase Data Strategy

**Option A: Compute on demand** (recommended for v1)
- Parse phases when plan content is loaded
- Store in React state/context, not persisted
- Re-parse when content changes

**Option B: Persist to metadata** (for v2 if performance needed)
- Add `phaseInfo: { completed: number, total: number }` to PlanMetadata
- Update on plan content save

**Recommended: Option A for simplicity**

### 3. Phase Hook

**`src/entities/plans/hooks/use-plan-phases.ts`** (new file)

```typescript
import { usePlanContent } from './use-plan-content';
import { parsePhases, PhaseInfo } from '../phase-parser';

export function usePlanPhases(planId: string): PhaseInfo | null {
  const content = usePlanContent(planId);

  return useMemo(() => {
    if (!content) return null;
    return parsePhases(content);
  }, [content]);
}
```

### 4. Phase Progress Display

**`src/components/tree-menu/phase-badge.tsx`** (new file)

```typescript
interface PhaseBadgeProps {
  completed: number;
  total: number;
  className?: string;
}

export function PhaseBadge({ completed, total, className }: PhaseBadgeProps) {
  if (total === 0) return null;

  const isComplete = completed === total;

  return (
    <span className={cn(
      "text-[10px] font-medium px-1.5 rounded",
      isComplete
        ? "bg-green-500/20 text-green-400"
        : "bg-surface-700 text-surface-400",
      className
    )}>
      {completed}/{total}
    </span>
  );
}
```

### 5. Phase List in Content Pane

When viewing a plan, show phase progress in the header or as a sidebar:

**`src/components/content-pane/plan-phases-panel.tsx`** (new file)

```typescript
interface PlanPhasesPanelProps {
  phases: Phase[];
  onPhaseClick?: (lineNumber: number) => void;
}

export function PlanPhasesPanel({ phases, onPhaseClick }: PlanPhasesPanelProps) {
  return (
    <div className="border-l border-surface-700 p-3 w-48">
      <h3 className="text-xs font-semibold text-surface-400 mb-2">Phases</h3>
      <ul className="space-y-1">
        {phases.map((phase, i) => (
          <li
            key={i}
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-surface-800 rounded px-1 py-0.5"
            onClick={() => onPhaseClick?.(phase.lineNumber)}
          >
            {phase.completed ? (
              <CheckCircle size={12} className="text-green-400" />
            ) : (
              <Circle size={12} className="text-surface-500" />
            )}
            <span className={phase.completed ? "line-through text-surface-500" : ""}>
              {phase.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
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
- Use GitHub-style todo lists to define phases/milestones:
  \`\`\`markdown
  ## Phases

  - [ ] Phase 1: Research and design
  - [ ] Phase 2: Implement core functionality
  - [ ] Phase 3: Add tests
  - [ ] Phase 4: Documentation
  - [x] Phase 5: Code review (completed)
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

## Implementation Phases

- [ ] Create `phase-parser.ts` with `parsePhases()` function
- [ ] Create `use-plan-phases.ts` hook
- [ ] Create `PhaseBadge` component
- [ ] Add phase badge to existing `PlanItem` component
- [ ] Add `PlanPhasesPanel` to content pane
- [ ] Add `PLAN_CONVENTIONS` to shared prompts
- [ ] Update simple agent config to include conventions
- [ ] Test that agents follow conventions

---

## Testing Considerations

### Unit Tests
- `parsePhases()` with various markdown formats
- Empty content, no todos, all completed, none completed
- Nested todos (should be ignored)
- Mixed case `[x]` vs `[X]`

### Integration Tests
- Mark phases complete, verify badge updates
- Plan content changes, verify phase count updates

### Manual Testing
- Verify phase badges update as content changes
- Click phase in panel, verify scroll to line

---

## Future Considerations

1. **Phase completion from UI** - Click to toggle phase completion
2. **Progress rollup** - Parent shows aggregate child progress
3. **Plan templates** - Pre-defined phase structures for common tasks

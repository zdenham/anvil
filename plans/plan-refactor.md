# Plan Refactor: Nested Plans and Phase Tracking

## Overview

This refactor introduces two major features:
1. **Nested Plan Directories** - Support arbitrary folder nesting in the sidebar with collapsible plan folders
2. **Phase Tracking** - Parse GitHub markdown todo lists as "phases" and display progress (e.g., "5/7 phases done")

Both features leverage the existing `parentId` architecture but require significant UI and parsing changes.

---

## Current Architecture

### Plan Storage
- Plans stored at `~/.mort/plans/{id}/metadata.json`
- `relativePath` field stores path relative to repo (e.g., `plans/auth/login.md`)
- `parentId` field exists but only auto-detects immediate parent plan file

### Current Parent Detection Logic
```typescript
// plans/auth/login.md -> looks for plans/auth.md as parent
const parentDir = parts.slice(0, -1).join('/');
const parentPlanPath = parentDir + '.md';
```

### Tree Menu Display
- Plans displayed as flat list items under repo/worktree sections
- No collapsible folder structure
- No nested indentation

---

## Part 1: Nested Plan Directories

### 1.1 Type Changes

**`core/types/plans.ts`**
```typescript
export const PlanMetadataSchema = z.object({
  // ... existing fields
  parentId: z.string().uuid().optional(),
  // NEW: Track if this is a "folder" plan (has a corresponding directory)
  isFolder: z.boolean().optional(),
});
```

### 1.2 Parent Detection Enhancement

**`src/entities/plans/service.ts`**

Enhance `detectParentPlan()` to support two parent patterns:
1. **Sibling file pattern**: `plans/auth/login.md` -> parent is `plans/auth.md`
2. **Index file pattern**: `plans/auth/overview.md` -> parent is `plans/auth.md` (folder plan)

```typescript
/**
 * Detect parent plan from file structure.
 * Supports arbitrary nesting depth.
 *
 * Examples:
 * - plans/auth/login.md -> parent: plans/auth.md (if exists)
 * - plans/auth/oauth/google.md -> parent: plans/auth/oauth.md (if exists)
 *                              -> fallback: plans/auth.md (if oauth.md doesn't exist)
 */
detectParentPlan(relativePath: string, repoId: string): string | undefined {
  const parts = relativePath.split('/');
  if (parts.length <= 2) return undefined; // Just "plans/file.md"

  // Walk up directory tree looking for parent plan
  for (let depth = parts.length - 2; depth >= 1; depth--) {
    const parentPath = parts.slice(0, depth).join('/') + '.md';
    const parent = this.findByRelativePath(repoId, parentPath);
    if (parent) return parent.id;
  }

  return undefined;
}
```

### 1.3 Folder Plan Detection

When a plan file like `plans/auth.md` exists AND a directory `plans/auth/` exists with child plans, mark it as a folder plan:

**`src/entities/plans/service.ts`**

```typescript
/**
 * Check if a plan acts as a folder (has children).
 */
isFolder(planId: string): boolean {
  return usePlanStore.getState().getChildren(planId).length > 0;
}

/**
 * Recalculate and persist isFolder status for a plan.
 */
async updateFolderStatus(planId: string): Promise<void> {
  const hasChildren = this.isFolder(planId);
  const plan = this.get(planId);
  if (plan && plan.isFolder !== hasChildren) {
    await this.update(planId, { isFolder: hasChildren });
  }
}
```

### 1.4 Tree Data Structure Changes

**`src/stores/tree-menu/types.ts`**

```typescript
export interface TreeItemNode {
  type: "thread" | "plan";
  id: string;
  title: string;
  status: StatusDotVariant;
  updatedAt: number;
  createdAt: number;
  sectionId: string;
  // NEW: For nested plans
  depth: number;           // Indentation level (0 = root)
  isFolder: boolean;       // Has children
  isExpanded: boolean;     // If folder, is it expanded?
  parentId?: string;       // Parent plan ID
  childCount?: number;     // Number of direct children
}
```

### 1.5 New Component: PlanFolderItem

**`src/components/tree-menu/plan-folder-item.tsx`**

A collapsible folder component for plan folders:
- Shows chevron toggle (expand/collapse)
- Shows folder name (derived from plan filename)
- Shows child count badge
- Shows phase progress if plan has phases
- Clicking expands/collapses, double-click opens plan content

```typescript
interface PlanFolderItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  isExpanded: boolean;
  onToggle: (planId: string) => void;
  onSelect: (planId: string) => void;
  children: React.ReactNode; // Nested items
}
```

### 1.6 Tree Building Enhancement

**`src/hooks/use-tree-data.ts`**

Update to build hierarchical tree structure:

```typescript
function buildPlanTree(plans: PlanMetadata[], repoId: string): TreeItemNode[] {
  const rootPlans = plans.filter(p => !p.parentId);
  const childrenMap = new Map<string, PlanMetadata[]>();

  // Group children by parent
  for (const plan of plans) {
    if (plan.parentId) {
      const siblings = childrenMap.get(plan.parentId) || [];
      siblings.push(plan);
      childrenMap.set(plan.parentId, siblings);
    }
  }

  // Recursive tree builder
  function buildNode(plan: PlanMetadata, depth: number): TreeItemNode {
    const children = childrenMap.get(plan.id) || [];
    return {
      // ... existing fields
      depth,
      isFolder: children.length > 0,
      isExpanded: getFolderExpandState(plan.id),
      childCount: children.length,
      children: children.map(c => buildNode(c, depth + 1)),
    };
  }

  return rootPlans.map(p => buildNode(p, 0));
}
```

### 1.7 Folder Expand State Persistence

**`src/stores/tree-menu/store.ts`**

Add folder expand state (separate from section expand):

```typescript
interface TreeMenuState {
  // ... existing
  expandedFolders: Set<string>; // Plan IDs that are expanded
}

// Actions
toggleFolder(planId: string): void;
expandFolder(planId: string): void;
collapseFolder(planId: string): void;
```

---

## Part 2: Phase Tracking (Markdown Todo Lists)

### 2.1 Phase Parsing

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

### 2.2 Phase Data in Plan Metadata

Option A: **Compute on demand** (recommended for v1)
- Parse phases when plan content is loaded
- Store in React state/context, not persisted
- Re-parse when content changes

Option B: **Persist to metadata** (for v2 if performance needed)
- Add `phaseInfo: { completed: number, total: number }` to PlanMetadata
- Update on plan content save

**Recommended: Option A for simplicity**

### 2.3 Phase Hook

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

### 2.4 Phase Progress Display

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

### 2.5 Phase List in Content Pane

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

## Part 3: Agent Prompt Conventions

### 3.1 Plan Conventions Prompt

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

### 3.2 Append to Agent Config

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

## Implementation Order

### Phase 1: Phase Parsing (Low Risk)
- [ ] Create `phase-parser.ts` with `parsePhases()` function
- [ ] Create `use-plan-phases.ts` hook
- [ ] Create `PhaseBadge` component
- [ ] Add phase badge to existing `PlanItem` component
- [ ] Add `PlanPhasesPanel` to content pane

### Phase 2: Agent Prompt Updates (Low Risk)
- [ ] Add `PLAN_CONVENTIONS` to shared prompts
- [ ] Update simple agent config to include conventions
- [ ] Test that agents follow conventions

### Phase 3: Nested Plan Types (Medium Risk)
- [ ] Add `isFolder` to PlanMetadata schema
- [ ] Add `depth`, `isFolder`, `isExpanded` to TreeItemNode
- [ ] Update `detectParentPlan()` for multi-level detection

### Phase 4: Tree Building (Medium Risk)
- [ ] Update `use-tree-data.ts` to build hierarchical structure
- [ ] Add folder expand state to tree-menu store
- [ ] Create `PlanFolderItem` component

### Phase 5: UI Polish (Medium Risk)
- [ ] Implement proper indentation for nested plans
- [ ] Add expand/collapse animations
- [ ] Keyboard navigation for nested items
- [ ] Persist folder expand state

---

## Testing Considerations

### Unit Tests
- `parsePhases()` with various markdown formats
- Parent detection with deep nesting
- Tree building with complex hierarchies

### Integration Tests
- Create nested plan structure, verify tree renders correctly
- Mark phases complete, verify badge updates
- Archive folder plan, verify children handled

### Manual Testing
- Create plans: `plans/auth.md`, `plans/auth/login.md`, `plans/auth/oauth/google.md`
- Verify proper nesting in sidebar
- Verify phase badges update as content changes
- Test keyboard navigation with nested items

---

## Future Considerations

1. **Drag-and-drop reordering** - Allow users to reorganize plan hierarchy
2. **Phase completion from UI** - Click to toggle phase completion
3. **Progress rollup** - Parent shows aggregate child progress
4. **Plan templates** - Pre-defined phase structures for common tasks

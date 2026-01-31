# Nested Plan Directories

## Overview

Support arbitrary folder nesting in the sidebar with collapsible plan folders. This allows organizing related plans in a hierarchical structure that mirrors the file system.

---

## Design Decisions

- **Casing**: Use lowercase `readme.md` consistently. Detection is case-insensitive.
- **Conflict resolution**: When both `plans/auth/readme.md` and `plans/auth.md` exist, prefer `readme.md` silently.
- **Click behavior**: Single-click opens plan content (consistent with regular plans). Separate chevron toggles expand/collapse.
- **Expand state scope**: Per-worktree, following existing patterns.
- **Archive behavior**: Cascading - archiving a parent archives all children (no extra confirmation, double-click already required).
- **Orphaned plans**: No special styling - they simply bubble up to root level or nearest ancestor.
- **Nesting depth**: No maximum limit.
- **Refresh strategy**: Event-driven only (no polling) - use file watcher and explicit hook points.

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

## Implementation

### 1. Type Changes

**`core/types/plans.ts`**
```typescript
export const PlanMetadataSchema = z.object({
  // ... existing fields
  parentId: z.string().uuid().optional(),
  // NEW: Track if this is a "folder" plan (has a corresponding directory)
  isFolder: z.boolean().optional(),
});
```

### 2. Parent Detection Enhancement

**`src/entities/plans/service.ts`**

Enhance `detectParentPlan()` to support two parent patterns:

1. **Readme pattern**: `plans/my-plan/readme.md` is the parent of `plans/my-plan/other.md`
2. **Sibling file pattern**: `plans/my-plan.md` is the parent of `plans/my-plan/other.md`

Priority: Check for readme.md in the same directory first, then fall back to sibling .md file.

Note: Detection is case-insensitive to handle user-created files with any casing (README.md, Readme.md, readme.md).

```typescript
/**
 * Detect parent plan from file structure.
 * Supports arbitrary nesting depth.
 *
 * Examples:
 * - plans/auth/login.md -> parent: plans/auth/readme.md (if exists, case-insensitive)
 *                       -> fallback: plans/auth.md (sibling file pattern)
 * - plans/auth/oauth/google.md -> parent: plans/auth/oauth/readme.md (if exists, case-insensitive)
 *                              -> fallback: plans/auth/oauth.md (if exists)
 */
detectParentPlan(relativePath: string, repoId: string): string | undefined {
  const parts = relativePath.split('/');
  const filename = parts[parts.length - 1];

  // readme.md files have no parent within their own directory
  // Their parent would be at the next level up
  if (filename.toLowerCase() === 'readme.md') {
    if (parts.length <= 2) return undefined; // Just "plans/readme.md"
    // Look for parent at directory level above
    const parentDir = parts.slice(0, -2).join('/');
    const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${parentDir}/readme.md`);
    if (readmeParent) return readmeParent.id;
    const siblingParent = this.findByRelativePath(repoId, parts.slice(0, -2).join('/') + '.md');
    if (siblingParent) return siblingParent.id;
    return undefined;
  }

  if (parts.length <= 2) return undefined; // Just "plans/file.md"

  // Pattern 1: Look for readme.md in same directory (case-insensitive)
  const dirPath = parts.slice(0, -1).join('/');
  const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${dirPath}/readme.md`);
  if (readmeParent) return readmeParent.id;

  // Pattern 2: Look for sibling .md file (e.g., plans/auth.md for plans/auth/*)
  const siblingPath = dirPath + '.md';
  const siblingParent = this.findByRelativePath(repoId, siblingPath);
  if (siblingParent) return siblingParent.id;

  return undefined;
}

/**
 * Find a plan by relative path with case-insensitive filename matching.
 * Used for readme.md detection to handle README.md, Readme.md, etc.
 */
findByRelativePathCaseInsensitive(repoId: string, relativePath: string): PlanMetadata | undefined {
  const dir = relativePath.substring(0, relativePath.lastIndexOf('/'));
  const filename = relativePath.substring(relativePath.lastIndexOf('/') + 1).toLowerCase();

  return this.getByRepo(repoId).find(plan => {
    const planDir = plan.relativePath.substring(0, plan.relativePath.lastIndexOf('/'));
    const planFilename = plan.relativePath.substring(plan.relativePath.lastIndexOf('/') + 1).toLowerCase();
    return planDir === dir && planFilename === filename;
  });
```

### 3. Repo as Source of Truth

The repository file system is the source of truth for plan hierarchy. Parent relationships are refreshed via event-driven hooks (no polling).

**Refresh Hook Points:**
- On app startup: scan all plan files and rebuild parent relationships
- On file system change (via watcher): re-detect parents for affected plans
- On plan creation: detect parent for new plan, update folder status of potential parents
- On plan archive/delete: update folder status of parent, cascade archive to children
- On plan open: verify parent relationship still valid
- On worktree switch: refresh relationships for the newly focused worktree

**`src/entities/plans/service.ts`**

```typescript
/**
 * Refresh parent relationships for all plans in a repo.
 * Called on startup, file changes, and periodically.
 */
async refreshParentRelationships(repoId: string): Promise<void> {
  const plans = this.getByRepo(repoId);

  for (const plan of plans) {
    const detectedParentId = this.detectParentPlan(plan.relativePath, repoId);
    if (plan.parentId !== detectedParentId) {
      await this.update(plan.id, { parentId: detectedParentId });
    }
  }

  // Update folder status for all plans that might have children
  for (const plan of plans) {
    await this.updateFolderStatus(plan.id);
  }
}

/**
 * Refresh parent for a single plan (after file change).
 */
async refreshSinglePlanParent(planId: string): Promise<void> {
  const plan = this.get(planId);
  if (!plan) return;

  const detectedParentId = this.detectParentPlan(plan.relativePath, plan.repoId);
  if (plan.parentId !== detectedParentId) {
    await this.update(planId, { parentId: detectedParentId });
  }

  // Also update the old and new parent's folder status
  if (plan.parentId) await this.updateFolderStatus(plan.parentId);
  if (detectedParentId) await this.updateFolderStatus(detectedParentId);
}
```

### 5. Folder Plan Detection

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

### 6. Tree Data Structure Changes

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
}
```

### 7. New Component: PlanFolderItem

**`src/components/tree-menu/plan-folder-item.tsx`**

A collapsible folder component for plan folders:
- Shows chevron toggle (expand/collapse) - clicking chevron toggles children visibility
- Shows folder name (derived from plan filename)
- Shows phase progress if plan has phases
- Single-click on item opens plan content (consistent with regular plans)
- Chevron is separate click target for expand/collapse

```typescript
interface PlanFolderItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  isExpanded: boolean;
  onToggleExpand: (planId: string) => void;  // Chevron click
  onSelect: (planId: string) => void;         // Item click - opens content
  children: React.ReactNode; // Nested items
}
```

### 8. Tree Building Enhancement

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
      children: children.map(c => buildNode(c, depth + 1)),
    };
  }

  return rootPlans.map(p => buildNode(p, 0));
}
```

### 9. Folder Expand State Persistence

**`src/stores/tree-menu/store.ts`**

Add folder expand state per-worktree (following existing patterns for per-worktree state):

```typescript
interface TreeMenuState {
  // ... existing
  expandedFoldersByWorktree: Map<string, Set<string>>; // worktreeId -> Set of expanded plan IDs
}

// Actions
toggleFolder(worktreeId: string, planId: string): void;
expandFolder(worktreeId: string, planId: string): void;
collapseFolder(worktreeId: string, planId: string): void;
getExpandedFolders(worktreeId: string): Set<string>;
```

### 10. Agent System Prompt - Plan Conventions

Add instructions to the simple agent system prompt to guide plan file organization:

**`agents/src/prompts/simple-agent.ts`** (or wherever system prompt is defined)

Add to the system prompt:

```markdown
## Plan File Conventions

When creating or organizing plan files:

1. **Folder-based plans**: When a plan needs to be broken down into multiple files, create a folder structure:
   - Use `readme.md` as the main/overview plan in the folder
   - Child plans go in the same folder alongside the readme.md
   - Example structure:
     ```
     plans/
       auth/
         readme.md      <- Main auth plan (parent)
         login.md       <- Child plan
         oauth.md       <- Child plan
     ```

2. **Single-file plans**: For simpler plans that don't need breakdown:
   - Place directly in the plans directory: `plans/my-feature.md`

3. **Nesting deeper**: For complex features with sub-features:
   ```
   plans/
     auth/
       readme.md           <- Main auth plan
       login/
         readme.md         <- Main login plan (child of auth)
         password-reset.md <- Child of login
       oauth/
         readme.md         <- Main oauth plan (child of auth)
         google.md         <- Child of oauth
   ```

4. **Naming**: Use kebab-case for plan filenames (e.g., `user-authentication.md`)
```

---

## Implementation Phases

- [ ] Add `isFolder` to PlanMetadata schema
- [ ] Add `depth`, `isFolder`, `isExpanded`, `parentId` to TreeItemNode
- [ ] Update `detectParentPlan()` for readme.md (case-insensitive) and sibling file patterns
- [ ] Add `refreshParentRelationships()` for repo sync
- [ ] Wire up refresh on startup, file changes, plan create/archive, and worktree switch (no polling)
- [ ] Update `use-tree-data.ts` to build hierarchical structure
- [ ] Add per-worktree folder expand state to tree-menu store
- [ ] Create `PlanFolderItem` component
- [ ] Implement proper indentation for nested plans
- [ ] Add expand/collapse animations
- [ ] Keyboard navigation for nested items
- [ ] Persist folder expand state per-worktree
- [ ] Implement cascading archive for parent plans
- [ ] Add plan conventions to agent system prompt

---

## Testing Considerations

### Unit Tests
- Parent detection with deep nesting
- Tree building with complex hierarchies

### Integration Tests
- Create nested plan structure, verify tree renders correctly
- Archive folder plan, verify children are cascaded archived

### Manual Testing
- Create plans: `plans/auth.md`, `plans/auth/login.md`, `plans/auth/oauth/google.md`
- Verify proper nesting in sidebar
- Test keyboard navigation with nested items

---

## Grandchild Plan Creation

### The Problem

When a user creates a deeply nested plan like `plans/auth/oauth/google.md`, but intermediate parent plans don't exist yet (`plans/auth/oauth/readme.md` or `plans/auth/oauth.md`), what should happen?

### Design Decision: No Automatic Parent Creation

**We do NOT automatically create parent plans.** Here's why:

1. **Plans are intentional** - A plan represents a deliberate decision to track work. Auto-creating empty parent plans pollutes the plan list with meaningless entries.

2. **File system is the source of truth** - The plan hierarchy mirrors the file system. If `plans/auth/oauth/google.md` exists but `plans/auth/oauth/readme.md` doesn't, that's a valid state - it just means `google.md` has no direct parent plan.

3. **Graceful degradation** - An orphaned grandchild plan simply bubbles up to the root level (or under its nearest existing ancestor) until a parent plan is created. No special styling is applied.

### Behavior

When creating `plans/auth/oauth/google.md`:

1. **Parent detection runs** - Looks for `plans/auth/oauth/readme.md` (case-insensitive) → not found
2. **Falls back to sibling pattern** - Looks for `plans/auth/oauth.md` → not found
3. **Continues up the tree** - Looks for `plans/auth/readme.md` (case-insensitive) → found? Use as parent
4. **If no ancestor found** - Plan appears at root level under the repo section

```typescript
/**
 * Find the nearest ancestor plan for a given path.
 * Walks up the directory tree until a parent plan is found.
 */
detectParentPlan(relativePath: string, repoId: string): string | undefined {
  const parts = relativePath.split('/');

  // Start from immediate parent directory, walk up
  for (let i = parts.length - 2; i >= 1; i--) {
    const ancestorDir = parts.slice(0, i + 1).join('/');

    // Check for readme.md in this directory (case-insensitive)
    const readmeParent = this.findByRelativePathCaseInsensitive(repoId, `${ancestorDir}/readme.md`);
    if (readmeParent) return readmeParent.id;

    // Check for sibling .md file
    const siblingParent = this.findByRelativePath(repoId, `${ancestorDir}.md`);
    if (siblingParent) return siblingParent.id;
  }

  return undefined; // No ancestor found, will be root-level
}
```

### Agent Guidance

When the agent creates nested plans, it should be guided to create parent plans first:

**Add to agent system prompt:**
```markdown
5. **Creating nested plans**: When creating a nested plan structure, create parent plans first:
   - ✅ First create `plans/auth/readme.md`, then `plans/auth/login.md`
   - ❌ Don't create `plans/auth/login.md` without a parent plan existing

   If you need to create a deeply nested plan, create the hierarchy top-down:
   1. `plans/auth/readme.md` (main auth plan)
   2. `plans/auth/oauth/readme.md` (oauth sub-plan)
   3. `plans/auth/oauth/google.md` (specific implementation)
```

---

## Future Considerations

1. **Drag-and-drop reordering** - Allow users to reorganize plan hierarchy
2. **Progress rollup** - Parent shows aggregate child progress
3. **Auto-suggest parent creation** - When creating a nested plan with no parent, offer to create the parent readme.md

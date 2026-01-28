# Phase 3: Tree Menu UI Implementation

## Overview

This plan covers building the visual tree menu components that display repo/worktree sections with their thread and plan items. The tree menu replaces the current sidebar navigation and provides a VSCode-like file explorer experience.

**Status:** Not Started
**Depends On:** Phase 2 (tree data store and types)
**Required By:** Phase 4 (layout assembly)
**Parallelization:** CANNOT run in parallel with Phase 2 - tree components depend on Phase 2 types and hooks. CAN run in parallel with Phase 1 (no direct dependency).

> **Note:** Tree menu components are self-contained in Phase 3. Phase 1 provides `ContentPaneView` types and `ResizablePanel`, but these are used in Phase 4 layout assembly, not in the tree menu itself.

---

## Pre-Implementation: Files to Read

Before starting implementation, read these files to understand existing patterns:

### Status and Styling Patterns
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/components/ui/status-dot.tsx` - Reusable status dot component (8x8px, variants: running/unread/read/stale)
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/components/ui/status-legend.tsx` - Legend explaining dot colors
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/utils/thread-colors.ts` - `getThreadStatusVariant()` and `getPlanStatusVariant()` helpers

### Existing Item Patterns
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/components/inbox/inbox-item.tsx` - Current inbox item row (reference for click handling, status dot usage)
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/components/inbox/unified-inbox.tsx` - Current unified list rendering

### Type Definitions
- [ ] `/Users/zac/Documents/juice/mort/mortician/core/types/threads.ts` - ThreadMetadata schema (id, name, status, isRead, repoId, worktreeId)
- [ ] `/Users/zac/Documents/juice/mort/mortician/src/entities/plans/types.ts` - PlanMetadata structure

### Store Patterns (from Phase 2)
- [ ] `src/stores/tree-menu-store.ts` (created in Phase 2) - expansion state, selection, actions

---

## File Structure

```
src/components/tree-menu/
├── index.ts                    # Public exports
├── types.ts                    # (from Phase 2, extend if needed)
├── tree-menu.tsx               # Main container with keyboard nav
├── repo-worktree-section.tsx   # Section header with +/- toggle
├── section-divider.tsx         # Horizontal divider between sections
├── thread-item.tsx             # Thread row with status dot
└── plan-item.tsx               # Plan row with status dot
```

---

## Component Specifications

### 1. Section Divider (`section-divider.tsx`)

A simple horizontal line separating repo/worktree sections.

```typescript
// src/components/tree-menu/section-divider.tsx

interface SectionDividerProps {
  className?: string;
}

/**
 * Horizontal divider line between repo/worktree sections.
 * Not rendered before the first section.
 */
export function SectionDivider({ className }: SectionDividerProps) {
  return (
    <div
      className={cn(
        "h-px bg-surface-700 mx-3 my-2",
        className
      )}
      role="separator"
      aria-orientation="horizontal"
    />
  );
}
```

**Tasks:**
- [ ] Create `section-divider.tsx`
- [ ] Use `bg-surface-700` for the line color (matches existing border colors)
- [ ] Add horizontal margin (`mx-3`) to inset from edges
- [ ] Add vertical margin (`my-2`) for spacing
- [ ] Include `role="separator"` for accessibility

---

### 2. Repo/Worktree Section (`repo-worktree-section.tsx`)

The section header showing repo/worktree name with expand/collapse toggle.

```typescript
// src/components/tree-menu/repo-worktree-section.tsx

import { Plus, Minus, GitBranch } from "lucide-react";
import type { RepoWorktreeSection as SectionData } from "./types";

interface RepoWorktreeSectionProps {
  section: SectionData;
  isExpanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode; // Tree items rendered when expanded
}

/**
 * Section header for a repo/worktree combination.
 *
 * Key behaviors:
 * - Click +/- icon to toggle (NOT entire header)
 * - Shows "repoName/worktreeName" format
 * - Section divider rendered by parent (not included here)
 */
export function RepoWorktreeSection({
  section,
  isExpanded,
  onToggle,
  children,
}: RepoWorktreeSectionProps) {
  const displayName = `${section.repoName}/${section.worktreeName}`;

  return (
    <div
      role="treeitem"
      aria-expanded={isExpanded}
      aria-label={displayName}
    >
      {/* Section Header */}
      <div className="px-3 py-2 font-semibold text-[13px] flex items-center gap-2 text-surface-100 select-none">
        {/* Toggle icon - clickable */}
        <button
          onClick={onToggle}
          className="p-0.5 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label={isExpanded ? "Collapse section" : "Expand section"}
        >
          {isExpanded ? <Minus size={14} /> : <Plus size={14} />}
        </button>

        {/* Branch icon */}
        <GitBranch size={14} className="text-surface-400 flex-shrink-0" />

        {/* Section name (not clickable for toggle) */}
        <span className="truncate">{displayName}</span>
      </div>

      {/* Children (items) - only rendered when expanded */}
      {isExpanded && (
        <div role="group" aria-label={`Items in ${displayName}`}>
          {children}
        </div>
      )}
    </div>
  );
}
```

**Tasks:**
- [ ] Create `repo-worktree-section.tsx`
- [ ] Use Tailwind classes inline (NO separate CSS file)
- [ ] Use `Plus` icon when collapsed, `Minus` icon when expanded (from lucide-react)
- [ ] Only the +/- button is clickable for toggle (not entire header)
- [ ] Use `GitBranch` icon for visual indicator
- [ ] Display name as `repoName/worktreeName`
- [ ] Render children only when `isExpanded` is true
- [ ] Add ARIA attributes: `role="treeitem"`, `aria-expanded`

---

### 3. Thread Tree Item (`thread-item.tsx`)

A single thread row with status dot and title.

```typescript
// src/components/tree-menu/thread-item.tsx

import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import type { TreeItemNode } from "./types";
import { cn } from "@/lib/utils";

interface ThreadItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  isFocused: boolean;
  onClick: () => void;
  depth?: number;
}

/**
 * Tree item for a thread.
 *
 * Displays:
 * - Status dot (running = green pulse, unread = blue, read = grey)
 * - Thread name (or "New Thread" placeholder if name not yet generated)
 */
export function ThreadItem({
  item,
  isSelected,
  isFocused,
  onClick,
  depth = 1,
}: ThreadItemProps) {
  // Display "New Thread" until AI-generated name arrives
  const displayTitle = item.title || "New Thread";

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "py-0.5 px-2 text-[13px] leading-[22px] cursor-pointer flex items-center gap-1.5 text-surface-200 select-none",
        "hover:bg-white/5",
        isSelected && "bg-blue-500/20",
        isFocused && "outline outline-1 outline-blue-500/50 outline-offset-[-1px]"
      )}
      style={{ paddingLeft: `calc(${depth} * 16px + 8px)` }}
      data-testid="thread-tree-item"
      data-item-id={item.id}
      data-item-type="thread"
    >
      <StatusDot variant={item.status} />
      <span className="truncate flex-1">{displayTitle}</span>
    </div>
  );
}
```

**Tasks:**
- [ ] Create `thread-item.tsx`
- [ ] Reuse existing `StatusDot` component from `@/components/ui/status-dot`
- [ ] Show "New Thread" as placeholder when `item.title` is empty/undefined
- [ ] Apply indentation via inline style based on `depth` prop
- [ ] Handle click to select, keyboard Enter/Space to activate
- [ ] Add ARIA: `role="treeitem"`, `aria-selected`, `tabIndex`
- [ ] Add data attributes for testing: `data-testid`, `data-item-id`, `data-item-type`

---

### 4. Plan Tree Item (`plan-item.tsx`)

A single plan row with status dot and filename.

```typescript
// src/components/tree-menu/plan-item.tsx

import { StatusDot, type StatusDotVariant } from "@/components/ui/status-dot";
import { FileText } from "lucide-react";
import type { TreeItemNode } from "./types";
import { cn } from "@/lib/utils";

interface PlanItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  isFocused: boolean;
  onClick: () => void;
  depth?: number;
}

/**
 * Tree item for a plan.
 *
 * Displays:
 * - Status dot (running = green if has running threads, stale = amber, etc.)
 * - File icon + plan filename
 */
export function PlanItem({
  item,
  isSelected,
  isFocused,
  onClick,
  depth = 1,
}: PlanItemProps) {
  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "py-0.5 px-2 text-[13px] leading-[22px] cursor-pointer flex items-center gap-1.5 text-surface-200 select-none",
        "hover:bg-white/5",
        isSelected && "bg-blue-500/20",
        isFocused && "outline outline-1 outline-blue-500/50 outline-offset-[-1px]"
      )}
      style={{ paddingLeft: `calc(${depth} * 16px + 8px)` }}
      data-testid="plan-tree-item"
      data-item-id={item.id}
      data-item-type="plan"
    >
      <StatusDot variant={item.status} />
      <FileText size={14} className="text-surface-400 flex-shrink-0" />
      <span className="truncate flex-1">{item.title}</span>
    </div>
  );
}
```

**Tasks:**
- [ ] Create `plan-item.tsx`
- [ ] Use Tailwind classes inline (same pattern as `ThreadItem`)
- [ ] Reuse `StatusDot` component
- [ ] Include `FileText` icon from lucide-react to differentiate from threads
- [ ] Same keyboard and ARIA patterns as `ThreadItem`

---

### 5. Tree Menu Container (`tree-menu.tsx`)

The main container that renders all sections and handles keyboard navigation.

```typescript
// src/components/tree-menu/tree-menu.tsx

import { useCallback, useRef, useEffect, useState, useMemo } from "react";
import { useTreeMenuStore } from "@/stores/tree-menu-store";
import { useTreeData } from "@/hooks/use-tree-data"; // Hook from Phase 2
import { RepoWorktreeSection } from "./repo-worktree-section";
import { SectionDivider } from "./section-divider";
import { ThreadItem } from "./thread-item";
import { PlanItem } from "./plan-item";
import type { TreeItemNode } from "./types";
import { cn } from "@/lib/utils";

interface TreeMenuProps {
  /**
   * Callback when an item is selected.
   * IMPORTANT: Parameter order is (itemId, itemType) to match Phase 4's handleTreeItemSelect.
   */
  onItemSelect: (itemId: string, itemType: "thread" | "plan") => void;
  className?: string;
}

/**
 * Main tree menu container.
 *
 * Features:
 * - Renders repo/worktree sections with horizontal dividers
 * - Handles keyboard navigation (Arrow keys, Enter, Home, End)
 * - Manages focus for accessibility
 * - Connects to tree-menu-store for state
 */
export function TreeMenu({ onItemSelect, className }: TreeMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // State from store (Phase 2)
  const sections = useTreeData();
  const expandedSections = useTreeMenuStore((s) => s.expandedSections);
  const selectedItemId = useTreeMenuStore((s) => s.selectedItemId);
  const toggleSection = useTreeMenuStore((s) => s.toggleSection);
  const setSelectedItem = useTreeMenuStore((s) => s.setSelectedItem);

  // Track focused item for keyboard navigation (may differ from selected)
  const [focusedItemId, setFocusedItemId] = useState<string | null>(selectedItemId);

  // Build flat list of navigable items for keyboard nav
  const navigableItems = useMemo(() => {
    const items: { type: "section" | "thread" | "plan"; id: string; sectionId?: string }[] = [];

    for (const section of sections) {
      items.push({ type: "section", id: section.id });

      if (expandedSections[section.id]) {
        for (const item of section.items) {
          items.push({
            type: item.type,
            id: item.id,
            sectionId: section.id,
          });
        }
      }
    }

    return items;
  }, [sections, expandedSections]);

  // Keyboard navigation handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const currentIndex = navigableItems.findIndex((item) => item.id === focusedItemId);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, navigableItems.length - 1);
        const newId = navigableItems[nextIndex]?.id ?? null;
        setFocusedItemId(newId);
        // Scroll focused item into view
        if (newId) {
          requestAnimationFrame(() => {
            document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: "nearest" });
          });
        }
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        const newId = navigableItems[prevIndex]?.id ?? null;
        setFocusedItemId(newId);
        // Scroll focused item into view
        if (newId) {
          requestAnimationFrame(() => {
            document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: "nearest" });
          });
        }
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const current = navigableItems[currentIndex];
        if (current?.type === "section" && !expandedSections[current.id]) {
          toggleSection(current.id);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const current = navigableItems[currentIndex];
        if (current?.type === "section" && expandedSections[current.id]) {
          toggleSection(current.id);
        } else if (current?.sectionId) {
          // Move focus to parent section
          setFocusedItemId(current.sectionId);
        }
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        const current = navigableItems[currentIndex];
        if (current?.type === "section") {
          toggleSection(current.id);
        } else if (current?.type === "thread" || current?.type === "plan") {
          setSelectedItem(current.id);
          onItemSelect(current.id, current.type);
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        const newId = navigableItems[0]?.id ?? null;
        setFocusedItemId(newId);
        if (newId) {
          requestAnimationFrame(() => {
            document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: "nearest" });
          });
        }
        break;
      }
      case "End": {
        e.preventDefault();
        const newId = navigableItems[navigableItems.length - 1]?.id ?? null;
        setFocusedItemId(newId);
        if (newId) {
          requestAnimationFrame(() => {
            document.querySelector(`[data-item-id="${newId}"]`)?.scrollIntoView({ block: "nearest" });
          });
        }
        break;
      }
    }
  }, [navigableItems, focusedItemId, expandedSections, toggleSection, setSelectedItem, onItemSelect]);

  // Handle item click
  const handleItemClick = useCallback((item: TreeItemNode) => {
    setSelectedItem(item.id);
    setFocusedItemId(item.id);
    onItemSelect(item.id, item.type);
  }, [setSelectedItem, onItemSelect]);

  return (
    <div
      ref={containerRef}
      role="tree"
      aria-label="Threads and Plans"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={cn("flex flex-col overflow-y-auto", className)}
    >
      {sections.map((section, index) => (
        <div key={section.id}>
          {/* Divider before each section except the first */}
          {index > 0 && <SectionDivider />}

          <RepoWorktreeSection
            section={section}
            isExpanded={expandedSections[section.id] ?? true}
            onToggle={() => toggleSection(section.id)}
          >
            {/* Render items sorted by updatedAt (most recent first) */}
            {/* Note: updatedAt is a Unix timestamp (number), not a Date object */}
            {section.items
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((item) => {
                const isSelected = selectedItemId === item.id;
                const isFocused = focusedItemId === item.id;

                if (item.type === "thread") {
                  return (
                    <ThreadItem
                      key={item.id}
                      item={item}
                      isSelected={isSelected}
                      isFocused={isFocused}
                      onClick={() => handleItemClick(item)}
                    />
                  );
                } else {
                  return (
                    <PlanItem
                      key={item.id}
                      item={item}
                      isSelected={isSelected}
                      isFocused={isFocused}
                      onClick={() => handleItemClick(item)}
                    />
                  );
                }
              })}
          </RepoWorktreeSection>
        </div>
      ))}
    </div>
  );
}
```

**Tasks:**
- [ ] Create `tree-menu.tsx`
- [ ] Import `useTreeData` from `@/hooks/use-tree-data` (Phase 2)
- [ ] Import `useTreeMenuStore` from `@/stores/tree-menu-store` for expansion/selection state
- [ ] Render sections with `SectionDivider` between them (not before first)
- [ ] Sort items within each section by `updatedAt` descending (number comparison, not Date)
- [ ] Implement keyboard navigation with scroll-into-view (see next section)
- [ ] Add `role="tree"` and `aria-label` for accessibility
- [ ] Wire up `onItemSelect(itemId, itemType)` callback - note parameter order matches Phase 4

---

### 6. Index Exports (`index.ts`)

```typescript
// src/components/tree-menu/index.ts

export { TreeMenu } from "./tree-menu";
export { RepoWorktreeSection } from "./repo-worktree-section";
export { SectionDivider } from "./section-divider";
export { ThreadItem } from "./thread-item";
export { PlanItem } from "./plan-item";

// Re-export types
export type {
  RepoWorktreeSection as RepoWorktreeSectionData,
  TreeItemNode,
  TreeNode,
} from "./types";
```

**Tasks:**
- [ ] Create `index.ts` with all public exports

---

## Keyboard Navigation Specification

The tree menu must support standard tree keyboard navigation patterns:

| Key | Action |
|-----|--------|
| `ArrowDown` | Move focus to next visible item, scroll into view |
| `ArrowUp` | Move focus to previous visible item, scroll into view |
| `ArrowRight` | Expand focused section (if collapsed), or no-op if expanded |
| `ArrowLeft` | Collapse focused section (if expanded), or move focus to parent section |
| `Enter` / `Space` | Select focused item (opens in content pane) or toggle section |
| `Home` | Move focus to first item, scroll into view |
| `End` | Move focus to last visible item, scroll into view |

**Implementation Notes:**
- Focus tracking is separate from selection (you can navigate without selecting)
- Selection happens on Enter/Space or click
- Focus is visible via outline styling (`.focused` class)
- Selection is visible via background color (`.selected` class)
- **Scroll-into-view:** When focus moves via keyboard, use `scrollIntoView({ block: "nearest" })` to ensure the focused item is visible in the scrollable container

---

## Connecting to Tree Menu Store

The `TreeMenu` component consumes state from stores/hooks created in Phase 2:

```typescript
// Store from Phase 2: src/stores/tree-menu-store.ts
interface TreeMenuState {
  expandedSections: Record<string, boolean>;
  selectedItemId: string | null;

  toggleSection: (sectionId: string) => void;
  setSelectedItem: (itemId: string | null) => void;
  expandSection: (sectionId: string) => void;
  collapseSection: (sectionId: string) => void;
}

// Hook from Phase 2: src/hooks/use-tree-data.ts
// NOTE: This is in hooks/, NOT in stores/
function useTreeData(): RepoWorktreeSection[];
```

**Integration Points:**
- [ ] `useTreeData()` from `@/hooks/use-tree-data` provides the tree structure (sections with items)
- [ ] `expandedSections` from `useTreeMenuStore` determines which sections show their children
- [ ] `selectedItemId` from `useTreeMenuStore` tracks which item is currently selected
- [ ] `toggleSection()` called when +/- button clicked
- [ ] `setSelectedItem()` called when item clicked/activated

**Note on Reactivity:** Tree data automatically updates via Zustand subscriptions to entity stores (thread/plan stores). No additional listeners are needed in Phase 3 - reactivity comes from Phase 2's `useTreeData()` hook subscribing to underlying entity stores.

---

## Accessibility Requirements (ARIA Tree)

The tree menu must follow WAI-ARIA tree pattern for accessibility.

### Container
```html
<div role="tree" aria-label="Threads and Plans" tabindex="0">
```

### Section Headers
```html
<div role="treeitem" aria-expanded="true|false" aria-label="repoName/worktreeName">
```

### Items
```html
<div role="treeitem" aria-selected="true|false" tabindex="-1|0">
```

### Item Groups (within sections)
```html
<div role="group" aria-label="Items in repoName/worktreeName">
```

### Dividers
```html
<div role="separator" aria-orientation="horizontal">
```

**Tasks:**
- [ ] Add `role="tree"` to container
- [ ] Add `role="treeitem"` to sections and items
- [ ] Add `role="group"` to item containers within sections
- [ ] Add `role="separator"` to dividers
- [ ] Use `aria-expanded` on section headers
- [ ] Use `aria-selected` on items
- [ ] Manage `tabindex` for roving focus (only focused item has tabindex="0")
- [ ] Provide `aria-label` for meaningful announcements

---

## Styling Summary

**IMPORTANT: Use Tailwind classes inline with `cn()` utility.** Do NOT create separate CSS files or CSS modules. The CSS snippets below are for reference/documentation only - implement using Tailwind equivalents.

### Design Tokens (Tailwind equivalents)
```
hover-bg:       hover:bg-white/5 or hover:bg-surface-800/50
selection-bg:   bg-blue-500/20 or bg-surface-800
focus-outline:  outline outline-1 outline-blue-500/50 outline-offset-[-1px]
```

### Section Header Styling (Tailwind)
```tsx
// Use in repo-worktree-section.tsx
className="px-3 py-2 font-semibold text-[13px] flex items-center gap-2 cursor-default text-surface-100 select-none"
```

### Tree Item Styling (Tailwind)
```tsx
// Use in thread-item.tsx and plan-item.tsx with cn()
className={cn(
  "py-0.5 px-2 text-[13px] leading-[22px] cursor-pointer flex items-center gap-1.5 text-surface-200 select-none",
  "hover:bg-white/5",
  isSelected && "bg-blue-500/20",
  isFocused && "outline outline-1 outline-blue-500/50 outline-offset-[-1px]"
)}
```

**Tasks:**
- [ ] Implement all styles using Tailwind classes inline with `cn()` utility
- [ ] Do NOT create separate `.tree-item` or `.repo-worktree-section` CSS classes
- [ ] Verify status dot animation works in tree context
- [ ] Ensure focus outline is visible against dark background

---

## Acceptance Criteria

### Functional Requirements
- [ ] Tree menu renders repo/worktree sections grouped by repo+worktree combination
- [ ] Each section displays as `"repoName/worktreeName"` (e.g., "mortician/main")
- [ ] Horizontal dividers appear between sections (not before first)
- [ ] Clicking +/- icon toggles section expansion (not clicking header text)
- [ ] Plus icon shown when collapsed, minus icon when expanded
- [ ] Thread items show status dot + thread name (or "New Thread" placeholder)
- [ ] Plan items show status dot + file icon + filename
- [ ] Items within sections sorted by most recently updated first
- [ ] Clicking item selects it and triggers `onItemSelect` callback
- [ ] Selection state persists in tree-menu-store

### Keyboard Navigation
- [ ] Arrow keys navigate between visible items
- [ ] Enter/Space selects item or toggles section
- [ ] ArrowRight expands collapsed section
- [ ] ArrowLeft collapses expanded section or moves to parent
- [ ] Home/End jump to first/last item
- [ ] Focus visible via outline styling

### Accessibility
- [ ] Container has `role="tree"` and `aria-label`
- [ ] Sections have `role="treeitem"` and `aria-expanded`
- [ ] Items have `role="treeitem"` and `aria-selected`
- [ ] Dividers have `role="separator"`
- [ ] Roving tabindex implemented correctly

### Visual Design
- [ ] VSCode-like styling for tree items
- [ ] Status dots use existing component and variants
- [ ] Hover state visible
- [ ] Selected state visible
- [ ] Focus state visible and distinct from selection
- [ ] Text truncates with ellipsis when too long

### Integration
- [ ] Works with tree-menu-store from Phase 2
- [ ] Calls `onItemSelect` when item selected
- [ ] Reads expansion state from store
- [ ] Persists expansion changes to store

---

## Testing Checklist

### Manual Testing
- [ ] Verify sections render with correct repo/worktree names
- [ ] Verify +/- toggles work and only respond to icon click
- [ ] Verify items appear/disappear when sections toggled
- [ ] Verify items sorted by updatedAt (check with console log)
- [ ] Verify status dots show correct colors (running/unread/read/stale)
- [ ] Verify "New Thread" placeholder for threads without names
- [ ] Test all keyboard shortcuts
- [ ] Test with screen reader (VoiceOver)
- [ ] Test with 50+ items for performance

### Edge Cases
- [ ] Empty tree (no sections) - should render empty container
- [ ] Section with no items - should still render section header
- [ ] Very long thread/plan names - should truncate
- [ ] Rapid clicking between items - should not break state
- [ ] Keyboard nav with all sections collapsed

---

## Implementation Order

1. **Start with primitives:**
   - [ ] `section-divider.tsx` (simplest)
   - [ ] `thread-item.tsx`
   - [ ] `plan-item.tsx`

2. **Build section component:**
   - [ ] `repo-worktree-section.tsx`

3. **Assemble container:**
   - [ ] `tree-menu.tsx` (keyboard nav + store integration)

4. **Finalize exports:**
   - [ ] `index.ts`

5. **Test and iterate:**
   - [ ] Manual testing per checklist
   - [ ] Accessibility audit

---

## Dependencies

### From Phase 1 (for reference, not blocking)
- `ContentPaneView` type from `@/components/content-pane/types` (if needed for Phase 4 integration)
- `ResizablePanel` from `@/components/ui/resizable-panel` (used in Phase 4, not Phase 3 directly)
- **Note:** Phase 1 does NOT provide tree primitives. Tree menu components are self-contained in Phase 3.

### From Phase 2 (must be complete)
- `src/stores/tree-menu-store.ts` with:
  - `useTreeMenuStore` hook
  - `expandedSections` state
  - `selectedItemId` state
  - `toggleSection` action
  - `setSelectedItem` action
- `src/hooks/use-tree-data.ts` with:
  - `useTreeData()` hook returning `RepoWorktreeSection[]`
- `src/components/tree-menu/types.ts` with:
  - `RepoWorktreeSection` interface
  - `TreeItemNode` interface (with `updatedAt: number`, NOT Date)
  - `TreeNode` union type

### Existing Components (reuse)
- `StatusDot` from `@/components/ui/status-dot`
- `cn` utility from `@/lib/utils`
- Icons from `lucide-react`: `Plus`, `Minus`, `GitBranch`, `FileText`

---

## Notes

- The tree menu does NOT handle the "pop out to NSPanel" behavior - that's in Phase 4/6
- Context menus (right-click) are deferred per master plan decisions
- Virtualization is deferred until performance issues are measured
- Search/filter within tree is deferred per master plan decisions
- **UI State Pattern:** The tree-menu-store is UI-only state, so direct store mutations (without a service layer) are acceptable. This differs from entity stores which require service wrappers.
- **`updatedAt` is a Unix timestamp (number)**, not a Date object. Do not call `.getTime()` on it.
- **`ContentPaneView` type:** When Phase 4 integration requires this type, import it from `@/components/content-pane/types` (defined in Phase 1). Do NOT redefine it.

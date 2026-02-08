# Workspace Pin & Hide Feature

Implement the ability to "pin" a workspace to filter out all other workspaces, and "hide" individual worktrees with an option to unhide all from the header dropdown.

## Overview

- **Pin**: Click pin icon on a repo/worktree section header to show only that workspace (all others filtered out)
- **Hide**: Click hide icon on a repo/worktree section header to hide that specific workspace
- **Unhide All**: Add "Show all workspaces" option to the three-dots menu in the tree panel header

## Phases

- [x] Add pinned/hidden state to tree-menu store and types
- [x] Add pin/hide service methods with persistence
- [x] Add pin button UI to RepoWorktreeSection header (visible on hover)
- [x] Add hide button UI to RepoWorktreeSection header (visible on hover)
- [x] Implement filtering logic in useTreeData hook
- [x] Add "Show all workspaces" option to MenuDropdown
- [x] Handle edge cases (last visible workspace, pinned workspace hidden, etc.)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Technical Approach

### 1. State Management

Extend the existing `tree-menu` store pattern which already persists to `~/.mort/ui/tree-menu.json`.

**File: `src/stores/tree-menu/types.ts`**

Add to `TreeMenuPersistedStateSchema`:
```typescript
export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
  // NEW:
  pinnedSectionId: z.string().nullable(),  // "repoId:worktreeId" or null
  hiddenSectionIds: z.array(z.string()),   // Array of "repoId:worktreeId"
});
```

**File: `src/stores/tree-menu/store.ts`**

Add state fields and apply methods:
```typescript
interface TreeMenuState {
  expandedSections: Record<string, boolean>;
  selectedItemId: string | null;
  // NEW:
  pinnedSectionId: string | null;
  hiddenSectionIds: string[];
  _hydrated: boolean;
}

interface TreeMenuActions {
  // ... existing ...
  _applySetPinned: (sectionId: string | null) => Rollback;
  _applySetHidden: (sectionId: string, hidden: boolean) => Rollback;
  _applyUnhideAll: () => Rollback;
}
```

### 2. Service Methods

**File: `src/stores/tree-menu/service.ts`**

Add new methods:
```typescript
async pinSection(sectionId: string | null): Promise<void>
async togglePinSection(sectionId: string): Promise<void>
async hideSection(sectionId: string): Promise<void>
async unhideSection(sectionId: string): Promise<void>
async unhideAll(): Promise<void>
```

### 3. UI Components

**File: `src/components/tree-menu/repo-worktree-section.tsx`**

Add pin and hide buttons to section header (next to the plus button):

```tsx
{/* Pin button - visible on hover */}
<button
  type="button"
  onClick={(e) => {
    e.stopPropagation();
    onPinToggle?.(section.id);
  }}
  className={cn(
    "flex items-center justify-center w-5 h-5 rounded",
    isPinned
      ? "text-accent-400"  // Always visible when pinned
      : "opacity-0 group-hover:opacity-100 text-surface-400 hover:text-surface-200 hover:bg-surface-700"
  )}
  aria-label={isPinned ? "Unpin workspace" : "Pin workspace"}
>
  <Pin size={12} />
</button>

{/* Hide button - visible on hover, not shown when pinned */}
{!isPinned && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      onHide?.(section.id);
    }}
    className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded text-surface-400 hover:text-surface-200 hover:bg-surface-700"
    aria-label="Hide workspace"
  >
    <EyeOff size={12} />
  </button>
)}
```

Icons to use from lucide-react:
- Pin: `Pin` icon for pin action
- Hide: `EyeOff` icon for hide action

**File: `src/components/tree-menu/menu-dropdown.tsx`**

Add "Show all workspaces" menu item (only visible when there are hidden workspaces):

```typescript
const menuItems: MenuItem[] = [
  // NEW - conditional:
  ...(hasHiddenWorkspaces ? [{
    id: "unhide-all",
    label: "Show all workspaces",
    icon: <Eye size={12} />,
    onClick: onUnhideAll
  }] : []),
  // ... existing items ...
];
```

### 4. Filtering Logic

**File: `src/hooks/use-tree-data.ts`**

Add filtering after building sections:

```typescript
// Filter based on pin/hide state
const { pinnedSectionId, hiddenSectionIds } = useTreeMenuStore(
  (state) => ({
    pinnedSectionId: state.pinnedSectionId,
    hiddenSectionIds: state.hiddenSectionIds,
  })
);

let filteredSections = sections;

// If a section is pinned, show only that section
if (pinnedSectionId) {
  filteredSections = sections.filter(s => s.id === pinnedSectionId);
} else {
  // Otherwise, filter out hidden sections
  filteredSections = sections.filter(s => !hiddenSectionIds.includes(s.id));
}

return filteredSections;
```

### 5. Props Threading

**File: `src/components/tree-menu/tree-menu.tsx`**

Add new props to TreeMenu and pass down to RepoWorktreeSection:

```typescript
interface TreeMenuProps {
  // ... existing ...
  onPinToggle?: (sectionId: string) => void;
  onHide?: (sectionId: string) => void;
}
```

**File: `src/components/tree-menu/tree-panel-header.tsx`**

Pass `onUnhideAll` and `hasHiddenWorkspaces` to MenuDropdown:

```typescript
interface TreePanelHeaderProps {
  // ... existing ...
  onUnhideAll?: () => void;
  hasHiddenWorkspaces?: boolean;
}
```

### 6. Edge Cases

1. **Pinned workspace gets hidden**: Clear the pin first, then hide
2. **Last visible workspace**: Prevent hiding the last workspace (show toast/warning)
3. **Pin toggle**: If already pinned, clicking pin unpins; otherwise pins
4. **Hydration**: Validate pinned/hidden IDs still exist on hydrate (remove stale refs)

## File Changes Summary

| File | Change Type |
|------|-------------|
| `src/stores/tree-menu/types.ts` | Extend schema |
| `src/stores/tree-menu/store.ts` | Add state + actions |
| `src/stores/tree-menu/service.ts` | Add service methods |
| `src/hooks/use-tree-data.ts` | Add filtering logic |
| `src/components/tree-menu/repo-worktree-section.tsx` | Add pin/hide buttons |
| `src/components/tree-menu/tree-menu.tsx` | Thread new props |
| `src/components/tree-menu/menu-dropdown.tsx` | Add "Show all" option |
| `src/components/tree-menu/tree-panel-header.tsx` | Pass unhide props |

## Visual Design

```
┌─────────────────────────────────────┐
│ MORT                    ↻ ⋮        │  ← "⋮" has "Show all workspaces" when hidden exist
├─────────────────────────────────────┤
│ ▼ mortician / main      3  📌 👁 + │  ← Pin/Hide visible on hover, Pin highlighted if active
│   ├─ Thread 1                      │
│   ├─ Thread 2                      │
│   └─ plan.md                       │
├───────────────────────────────────-─┤
│ ▼ other-repo / feature  1    👁 +  │  ← No pin shown when another is pinned
│   └─ Thread 3                      │
└─────────────────────────────────────┘
```

When pinned:
- Only the pinned section is visible
- Pin icon stays highlighted (not hidden on hover)
- Hide button not shown for pinned section
- Click pin again to unpin

When workspaces are hidden:
- Hidden sections don't appear in the list
- "Show all workspaces" appears in the header dropdown menu
- Clicking it reveals all hidden workspaces

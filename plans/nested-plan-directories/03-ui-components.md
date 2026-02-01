# UI Components - Rendering & Interaction

## Overview

Implement the visual components for nested plan display, including folder items, indentation, animations, and keyboard navigation.

**Dependencies**: 01-data-layer, 02-tree-state
**Parallel with**: None (must run after Phase 1)

---

## Implementation

### 1. PlanFolderItem Component

**`src/components/tree-menu/plan-folder-item.tsx`**

A collapsible folder component for plans that have children:

```typescript
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TreeItemNode } from '@/stores/tree-menu/types';

interface PlanFolderItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onToggleExpand: (planId: string) => void;
  onSelect: (planId: string) => void;
}

export function PlanFolderItem({
  item,
  isSelected,
  onToggleExpand,
  onSelect,
}: PlanFolderItemProps) {
  const ChevronIcon = item.isExpanded ? ChevronDown : ChevronRight;

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(item.id);
  };

  const handleItemClick = () => {
    onSelect(item.id);
  };

  return (
    <div
      className={cn(
        'flex items-center gap-1 px-2 py-1 cursor-pointer rounded',
        'hover:bg-accent',
        isSelected && 'bg-accent'
      )}
      style={{ paddingLeft: `${8 + item.depth * 16}px` }}
      onClick={handleItemClick}
      role="treeitem"
      aria-expanded={item.isFolder ? item.isExpanded : undefined}
      aria-selected={isSelected}
    >
      {item.isFolder && (
        <button
          className="p-0.5 hover:bg-accent-foreground/10 rounded"
          onClick={handleChevronClick}
          aria-label={item.isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronIcon className="h-4 w-4 text-muted-foreground" />
        </button>
      )}

      {!item.isFolder && (
        <span className="w-5" /> // Spacer for alignment
      )}

      <span className="flex-1 truncate">{item.title}</span>

      {/* Status indicator if needed */}
      <StatusDot variant={item.status} />
    </div>
  );
}
```

### 2. Indentation System

Use depth-based padding for visual hierarchy:

```typescript
// Base padding + (depth * indent step)
const INDENT_BASE = 8;  // px
const INDENT_STEP = 16; // px per level

function getIndentStyle(depth: number): React.CSSProperties {
  return {
    paddingLeft: `${INDENT_BASE + depth * INDENT_STEP}px`,
  };
}
```

### 3. Tree Menu Integration

**`src/components/tree-menu/tree-section.tsx`**

Update to render nested items:

```typescript
import { PlanFolderItem } from './plan-folder-item';
import { useTreeMenuStore } from '@/stores/tree-menu/store';

function TreeSection({ worktreeId, items }: TreeSectionProps) {
  const toggleFolder = useTreeMenuStore((s) => s.toggleFolder);
  const selectedPlanId = useSelectedPlanId();

  return (
    <div role="tree" aria-label="Plans">
      {items.map((item) => (
        <PlanFolderItem
          key={item.id}
          item={item}
          isSelected={selectedPlanId === item.id}
          onToggleExpand={(id) => toggleFolder(worktreeId, id)}
          onSelect={handlePlanSelect}
        />
      ))}
    </div>
  );
}
```

### 4. Expand/Collapse Animations

**Using CSS transitions:**

```css
/* In your CSS or Tailwind config */
.tree-children {
  overflow: hidden;
  transition: max-height 150ms ease-out, opacity 150ms ease-out;
}

.tree-children.collapsed {
  max-height: 0;
  opacity: 0;
}

.tree-children.expanded {
  max-height: 1000px; /* Large enough for content */
  opacity: 1;
}
```

**Or using Framer Motion:**

```typescript
import { motion, AnimatePresence } from 'framer-motion';

function AnimatedTreeChildren({
  isExpanded,
  children,
}: {
  isExpanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence initial={false}>
      {isExpanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

### 5. Keyboard Navigation

**`src/components/tree-menu/use-tree-keyboard-nav.ts`**

Extend keyboard navigation for nested items:

```typescript
export function useTreeKeyboardNav(
  items: TreeItemNode[],
  worktreeId: string
) {
  const toggleFolder = useTreeMenuStore((s) => s.toggleFolder);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent, currentIndex: number) => {
      const currentItem = items[currentIndex];

      switch (e.key) {
        case 'ArrowRight':
          // Expand folder or move to first child
          if (currentItem.isFolder) {
            if (!currentItem.isExpanded) {
              e.preventDefault();
              toggleFolder(worktreeId, currentItem.id);
            } else {
              // Move to first child (next item in flat list)
              e.preventDefault();
              focusItem(currentIndex + 1);
            }
          }
          break;

        case 'ArrowLeft':
          // Collapse folder or move to parent
          if (currentItem.isFolder && currentItem.isExpanded) {
            e.preventDefault();
            toggleFolder(worktreeId, currentItem.id);
          } else if (currentItem.parentId) {
            // Find and focus parent
            e.preventDefault();
            const parentIndex = items.findIndex(
              (i) => i.id === currentItem.parentId
            );
            if (parentIndex >= 0) {
              focusItem(parentIndex);
            }
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          focusItem(Math.max(0, currentIndex - 1));
          break;

        case 'ArrowDown':
          e.preventDefault();
          focusItem(Math.min(items.length - 1, currentIndex + 1));
          break;

        case 'Enter':
        case ' ':
          e.preventDefault();
          selectItem(currentItem.id);
          break;
      }
    },
    [items, worktreeId, toggleFolder]
  );

  return { handleKeyDown };
}
```

**Key behaviors:**
- `ArrowRight` on collapsed folder → expand
- `ArrowRight` on expanded folder → move to first child
- `ArrowLeft` on expanded folder → collapse
- `ArrowLeft` on child → move to parent
- `ArrowUp/Down` → move through visible items (respects collapsed state)
- `Enter/Space` → select/open plan

### 6. Focus Management

Ensure proper focus handling for accessibility:

```typescript
// Add data attribute for focus management
<div
  data-tree-item-index={index}
  tabIndex={isSelected ? 0 : -1}
  // ...
/>

function focusItem(index: number) {
  const element = document.querySelector(
    `[data-tree-item-index="${index}"]`
  ) as HTMLElement;
  element?.focus();
}
```

---

## Checklist

- [ ] Create `PlanFolderItem` component with chevron toggle
- [ ] Implement depth-based indentation system
- [ ] Update `TreeSection` to render with new component
- [ ] Wire up expand/collapse actions to store
- [ ] Add expand/collapse animations (CSS or Framer Motion)
- [ ] Implement keyboard navigation hook with arrow key support
- [ ] Handle ArrowRight expand/enter-child behavior
- [ ] Handle ArrowLeft collapse/go-to-parent behavior
- [ ] Ensure proper ARIA attributes for accessibility
- [ ] Test keyboard navigation with nested items
- [ ] Test animations are smooth at various nesting depths
